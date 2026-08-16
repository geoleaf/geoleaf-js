/*!
 * GeoLeaf Core (offline capability) — Per-layer sync report
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Le rapport de synchronisation par couche — l'implémentation de `LayerSyncReport` (tâche 4.8).
 *
 * Le contrat déclarait `LayerSyncReport` et `LayerOfflineStatus` depuis l'Étape 1bis, et
 * **rien ne les implémentait** : mesuré au pré-vol du 04/08, zéro implémenteur hors
 * `contracts/sync.contract.ts`. Ce module les rend réels.
 *
 * 🛑 **Ce que ce rapport existe pour rendre visible** — le contrat le nomme : une couche
 * déclarée hors-ligne mais jamais rapatriée « ressemble exactement à une couche rapatriée,
 * jusqu'à l'instant où le réseau tombe ». C'est le seul défaut de cette famille qui ne se voit
 * pas en marchant : tout fonctionne, jusqu'au terrain.
 *
 * ⚠️ **Aucun statut n'est deviné.** `pulledStale` n'est rendu que si la couche DÉCLARE une
 * péremption (`offline.maxAgeMs`) ; sans déclaration une couche rapatriée reste `pulled`,
 * indéfiniment. Inventer un seuil par défaut ferait de ce rapport une source d'alertes qu'aucun
 * intégrateur n'a demandées, et qu'il ne pourrait pas faire taire.
 *
 * @version 1.0.0
 */

import { Log } from "../../../utils/log/index.js";
import { StorageContract } from "../../../kernel/shared/index.js";
import { coreProfileLayers } from "../config-seam.js";
import { readPullState, type LayerPullState, type PullStateMap } from "./pull-state.js";
import type { LayerOfflineStatus, LayerSyncReport } from "../../../contracts/sync.contract.js";

/** La part de la déclaration de couche que ce module lit. */
interface OfflineLayerDeclaration {
    readonly id?: string;
    readonly offline?: {
        readonly enabled?: boolean;
        readonly maxAgeMs?: number;
    };
}

/** Les seuls membres du seam de stockage que ce module utilise. */
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
 * Décide le statut d'UNE couche à partir de sa déclaration et de son marqueur.
 *
 * L'ordre des tests est le sens de lecture, et il n'est pas commutatif : `notDeclared` prime
 * sur tout (une couche non déclarée n'a pas d'état hors-ligne à rapporter), puis l'absence de
 * marqueur, puis l'échec, et la péremption ne se pose qu'en dernier — sur un rapatriement qui
 * a réussi.
 *
 * @param declared - Vrai quand la couche porte `offline.enabled`.
 * @param state - Le marqueur persisté, ou `undefined` quand aucun rapatriement n'a eu lieu.
 * @param maxAgeMs - Péremption déclarée par la couche, ou `undefined`.
 * @param now - Instant de référence, injecté pour rester testable à horloge figée.
 * @returns Le statut, jamais deviné.
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
 * Construit le rapport de synchronisation de toutes les couches du profil actif.
 *
 * Ne jette jamais : une capacité de stockage absente rend un rapport où chaque couche déclarée
 * est `declaredNeverPulled` avec des décomptes à zéro. C'est vrai du point de vue de
 * l'observateur — rien n'a été rapatrié qu'on puisse constater — et c'est le repli qui ALERTE,
 * plutôt que celui qui rassure.
 *
 * @param now - Instant de référence. Injectable pour les tests ; vaut `Date.now()` par défaut.
 * @returns Un rapport par couche du profil, dans l'ordre du profil.
 * @example
 * const report = (await GeoLeaf?.Storage?.getSyncReport?.()) ?? [];
 * const jamais = report.filter((r) => r.status === "declaredNeverPulled");
 * if (jamais.length) console.warn("déclarées hors-ligne, jamais rapatriées :", jamais);
 */
export async function buildSyncReport(
    now: number = Date.now()
): Promise<readonly LayerSyncReport[]> {
    // ⚠️ `coreProfileLayers()` et NON `getAllLayerConfigs()` — même piège que la tâche 4.1 :
    // ce baril rend une projection en liste blanche qui ne porte pas `offline`, et toute
    // couche y serait lue « non déclarée ». Le rapport aurait alors sorti `notDeclared`
    // partout : un rapport vert qui n'a rien regardé.
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
