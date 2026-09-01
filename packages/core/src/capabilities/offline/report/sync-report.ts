/*!
 * GeoLeaf Core (offline capability) — Per-layer sync report
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * The per-layer synchronisation report — the implementation of `LayerSyncReport`.
 *
 * The contract had declared `LayerSyncReport` and `LayerOfflineStatus` for a long
 * time, and **nothing implemented them**: measured at pre-flight on 04/08, zero
 * implementers outside `contracts/sync.contract.ts`. This module makes them real.
 *
 * 🛑 **What this report exists to make visible** — the contract names it: a layer
 * declared offline but never pulled "looks exactly like a pulled layer, until the
 * instant the network drops". It is the only defect of this family that cannot be
 * seen by walking around: everything works, until the field.
 *
 * ⚠️ **No status is guessed.** `pulledStale` is only returned when the layer DECLARES
 * an expiry (`offline.maxAgeMs`); without a declaration a pulled layer stays
 * `pulled`, indefinitely. Inventing a default threshold would make this report a
 * source of alerts no integrator asked for, and that they could not silence.
 *
 * @version 1.0.0
 */

import { Log } from "../../../utils/log/index.js";
import { StorageContract } from "../../../kernel/shared/index.js";
import { coreProfileLayers } from "../config-seam.js";
import { readPullState, type LayerPullState, type PullStateMap } from "./pull-state.js";
import type { LayerOfflineStatus, LayerSyncReport } from "../../../contracts/sync.contract.js";

/** The part of the layer declaration this module reads. */
interface OfflineLayerDeclaration {
    readonly id?: string;
    readonly offline?: {
        readonly enabled?: boolean;
        readonly maxAgeMs?: number;
    };
}

/** The only members of the storage seam this module uses. */
interface ReportStore {
    getPreference?: (key: string, defaultValue?: unknown) => Promise<unknown>;
    getSyncCounts?: (
        layerIds: readonly string[]
    ) => Promise<Record<
        string,
        { featureCount: number; pendingCount: number; quarantinedCount: number }
    > | null>;
}

/**
 * Decides ONE layer's status from its declaration and its marker.
 *
 * The test order is the reading order, and it is not commutative: `notDeclared`
 * trumps everything (an undeclared layer has no offline state to report), then the
 * absent marker, then the failure, and staleness only comes last — on a pull that
 * succeeded.
 *
 * @param declared - True when the layer carries `offline.enabled`.
 * @param state - The persisted marker, or `undefined` when no pull ever happened.
 * @param maxAgeMs - Expiry declared by the layer, or `undefined`.
 * @param now - Reference instant, injected to stay testable at a frozen clock.
 * @returns The status, never guessed.
 */
export function deriveStatus(
    declared: boolean,
    state: LayerPullState | undefined,
    maxAgeMs: number | undefined,
    now: number
): LayerOfflineStatus {
    if (!declared) return "notDeclared";
    if (!state) return "declaredNeverPulled";
    if (state.outcome === "failed") return "pullFailed";
    if (typeof maxAgeMs === "number" && maxAgeMs > 0 && now - state.at > maxAgeMs) {
        return "pulledStale";
    }
    return "pulled";
}

/**
 * Builds the synchronisation report for every layer of the active profile.
 *
 * Never throws: an absent storage capability yields a report where every declared
 * layer is `declaredNeverPulled` with zero tallies. That is true from the observer's
 * point of view — nothing observably pulled — and it is the fallback that ALERTS,
 * rather than the one that reassures.
 *
 * @param now - Reference instant. Injectable for tests; defaults to `Date.now()`.
 * @returns One report per profile layer, in profile order.
 * @example
 * const report = (await GeoLeaf?.Storage?.getSyncReport?.()) ?? [];
 * const jamais = report.filter((r) => r.status === "declaredNeverPulled");
 * if (jamais.length) console.warn("déclarées hors-ligne, jamais rapatriées :", jamais);
 */
export async function buildSyncReport(
    now: number = Date.now()
): Promise<readonly LayerSyncReport[]> {
    // ⚠️ `coreProfileLayers()` and NOT `getAllLayerConfigs()` — same trap as the
    // pull: that barrel returns a whitelist projection that does not carry `offline`,
    // and every layer would read as "not declared". The report would then have said
    // `notDeclared` everywhere: a green report that looked at nothing.
    const layers = coreProfileLayers() as readonly OfflineLayerDeclaration[];
    if (layers.length === 0) return [];

    const db = StorageContract.DB as ReportStore | null;
    const pullState: PullStateMap = await readPullState(db);

    const layerIds = layers.map((l) => String(l.id ?? "")).filter((id) => id.length > 0);
    let counts: Record<
        string,
        { featureCount: number; pendingCount: number; quarantinedCount: number }
    > | null = null;
    try {
        counts = (await db?.getSyncCounts?.(layerIds)) ?? null;
    } catch (err) {
        Log.warn("[Offline.Report] Décomptes indisponibles :", (err as Error).message);
    }

    return layers
        .filter((layer) => String(layer.id ?? "").length > 0)
        .map((layer) => {
            const layerId = String(layer.id);
            const state = pullState[layerId];
            const tally = counts?.[layerId];
            return {
                layerId,
                status: deriveStatus(
                    layer.offline?.enabled === true,
                    state,
                    layer.offline?.maxAgeMs,
                    now
                ),
                featureCount: tally?.featureCount ?? 0,
                pendingCount: tally?.pendingCount ?? 0,
                quarantinedCount: tally?.quarantinedCount ?? 0,
                lastPullAt: state?.at ?? null,
            };
        });
}
