/*!
 * GeoLeaf Core (offline capability) — Bounded layer pull
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Bounded pull — the FIRST writer of the `features` store.
 *
 * The store existed and had received its reader (`IndexedDB.getLayerFeatureCollection`).
 * It had no writer: `DBFeatures.put` counted zero callers in `src/`. This module gives
 * it one.
 *
 * It applies the sync contract's `PullGranularity = "bboxCapped"` — extent plus hard cap
 * — and **writes no transport code**: `fetchOgcApiFeatures` already carries `next`-link
 * pagination, `bbox`, `maxFeatures` and the `AbortSignal`.
 *
 * Three properties this module exists to hold:
 *
 * 1. **The cap is HARD.** ⚠️ **This clause said "`ogc-api-loader` […] never truncates"
 *    until 19/08/2026, and that is no longer true**: the loader now cuts at the exact
 *    bound and signals the cut through a `truncated` member on the collection. The
 *    original finding was right — `maxFeatures: 15` with `limit: 10` yielded **20**
 *    entities — and this module compensated, **alone**. The DISPLAY path, meanwhile,
 *    received the overflow unknowingly: the fix moved to the source to serve both. The
 *    cut below therefore becomes **redundant, not wrong** — cutting an already-cut list
 *    has no effect — and it is kept deliberately: it also bounds the case where the
 *    source is reached through another path, and `capped` remains the indicator the
 *    pull report exposes.
 * 2. **A local capture is never overwritten.** The decision lives in
 *    `db/features.ts#putManyPreservingLocal`, in **one** transaction; here we only
 *    report its tally.
 * 3. **Pulling NEVER confers editability** (standing invariant). Records come out
 *    `syncState: "synced"`, and this module does not touch the `outbox`.
 *
 * ⚠️ **Does not import `../db/indexeddb.js`.** `packages/core/vitest.config.ts` aliases
 * `^\.\./db/indexeddb\.(js|ts)$` to the in-house mock, which has neither
 * `_ensureModule` nor the `features` store: the test would be green against a fiction.
 * Writing goes through `StorageContract.DB`, as the local read already does in
 * `loader/single-layer.ts`.
 *
 * @version 1.0.0
 */

import { Log } from "../../../utils/log/index.js";
import { StorageContract } from "../../../kernel/shared/index.js";
import { coreProfileLayerConfig } from "../config-seam.js";
import { writePullState } from "../report/pull-state.js";
import type { FeatureRecord } from "../../../contracts/sync.contract.js";

/** Property name carrying the freshness timestamp, when the layer declares none. */
const DEFAULT_VERSION_PROPERTY = "updated_at";

/** Why a pull did not happen. Never `null` without an attempted write. */
type PullRefusal =
    /** No layer of that name in the active profile. */
    | "layerUnknown"
    /** The layer declares no `offline.source` — it is not pullable. */
    | "noSource"
    /** The storage engine is not wired (`modules.offline` disabled, or not ready yet). */
    | "engineUnavailable"
    /** The source answered with an error, or did not answer. */
    | "sourceUnreachable";

/** What a caller can bound at call time. */
interface LayerPullOptions {
    /** Extent `[west, south, east, north]`. A field zone is not a profile constant. */
    readonly bbox?: [number, number, number, number];
    /** Cooperative abort. The batch already received is written, and `aborted` says so. */
    readonly signal?: AbortSignal;
}

/** What the pull really did — every field is assertable. */
interface LayerPullReport {
    readonly layerId: string;
    /** Entities the source returned, **before** the cap. */
    readonly fetched: number;
    /** Entities inserted or refreshed. */
    readonly written: number;
    /** Entities left intact because they carry an unsynchronised capture. */
    readonly preserved: number;
    /** Entities without a usable server identity — discarded, never silently. */
    readonly skipped: number;
    /** True when the cap truncated the batch. */
    readonly capped: boolean;
    /** True when the caller's signal was raised: the batch is PARTIAL. */
    readonly aborted: boolean;
    /** `null` when the pull happened. */
    readonly refused: PullRefusal | null;
}

/** Minimal shape of a layer configuration's `offline` block. */
interface OfflineDeclaration {
    readonly maxFeatures?: number;
    readonly source?: {
        readonly url?: string;
        readonly collectionId?: string;
        readonly versionProperty?: string;
    };
}

/**
 * The only members of the storage seam this module uses.
 *
 * `putLayerFeatures` writes the batch; the two preference accessors carry the pull
 * marker. ⚠️ The `engineUnavailable` refusal tests only `putLayerFeatures`: an engine
 * that could write the entities but not its marker must still pull — losing the report
 * is annoying, losing the pull is not annoying at all.
 */
interface FeatureWriter {
    putLayerFeatures?: (
        records: readonly FeatureRecord[]
    ) => Promise<{ written: number; preserved: number } | null>;
    getPreference?: (key: string, defaultValue?: unknown) => Promise<unknown>;
    setPreference?: (key: string, value: unknown) => Promise<unknown>;
}

/**
 * Converts an OGC feature into a store record.
 *
 * Three rules, each measured against the proof backend (`docker/backend/README.md`):
 *
 * - **`serverId`** comes from `feature.id`, with `properties.id` second — pygeoapi
 *   serves both, and a server serving only one stays readable.
 * - **`localId`** reuses `properties.local_id` when the server carries one, otherwise
 *   it derives from the `serverId`. Seeded rows have `local_id: null`; the ones the
 *   push will send carry the client identity, and reusing it is what makes a re-pull
 *   find the SAME record instead of creating a second one.
 * - **`updatedAt` stays local.** The contract documents it as "Local modification
 *   time": writing the server timestamp there would make the index mean two things
 *   depending on the writer. The server marker goes into `version`, and nowhere else —
 *   it is what the conflict filter will compare.
 *
 * @param layerId - Destination layer.
 * @param feature - The GeoJSON feature as the source returned it.
 * @param versionProperty - Property carrying the freshness timestamp.
 * @param now - Local timestamp applied to the whole batch.
 * @returns The record, or `null` when the feature has no server identity.
 */
function toFeatureRecord(
    layerId: string,
    feature: unknown,
    versionProperty: string,
    now: number
): FeatureRecord | null {
    if (!feature || typeof feature !== "object") return null;
    const shape = feature as { id?: unknown; properties?: unknown };
    const properties = (
        shape.properties && typeof shape.properties === "object" ? shape.properties : {}
    ) as Record<string, unknown>;

    const rawServerId = shape.id ?? properties.id;
    if (rawServerId === undefined || rawServerId === null || rawServerId === "") return null;
    const serverId = String(rawServerId);

    const declaredLocalId = properties.local_id;
    const localId =
        typeof declaredLocalId === "string" && declaredLocalId.length > 0
            ? declaredLocalId
            : `srv:${serverId}`;

    const marker = properties[versionProperty];
    return {
        layerId,
        localId,
        serverId,
        syncState: "synced",
        updatedAt: now,
        version:
            marker === undefined || marker === null
                ? null
                : { kind: "timestamp", value: String(marker) },
        feature,
    };
}

/** What must be gathered before hitting the source — or the motive not to. */
interface PullPlan {
    readonly refused: PullRefusal | null;
    readonly ogcConfig: { url: string; collectionId: string; maxFeatures?: number };
    readonly maxFeatures: number | undefined;
    readonly versionProperty: string;
    readonly db: FeatureWriter;
}

/**
 * Gathers the layer declaration and the write seam, or names what is missing.
 *
 * Extracted from {@link pullLayer} for a mechanical reason — the function exceeded the
 * complexity ceiling — but the cut is also the right one: everything that can refuse
 * BEFORE the first network request fits here, and nothing else.
 *
 * @param layerId - Identifier of the layer to pull.
 * @returns The plan, or a plan whose `refused` is set (its other fields are then inert).
 */
function resolvePullPlan(layerId: string): PullPlan {
    const inert = {
        ogcConfig: { url: "", collectionId: layerId },
        maxFeatures: undefined,
        versionProperty: DEFAULT_VERSION_PROPERTY,
        db: {} as FeatureWriter,
    };

    const config = coreProfileLayerConfig(layerId);
    if (!config) return { ...inert, refused: "layerUnknown" };

    const offline = config.offline as OfflineDeclaration | undefined;
    const source = offline?.source;
    if (!source?.url) return { ...inert, refused: "noSource" };

    const db = StorageContract.DB as FeatureWriter | null;
    if (!db?.putLayerFeatures) return { ...inert, refused: "engineUnavailable" };

    const maxFeatures = typeof offline?.maxFeatures === "number" ? offline.maxFeatures : undefined;

    // `collectionId` default = the layer identifier: that is the real mapping on the
    // proof backend, and it avoids saying the same name twice in the profile. A `url`
    // already pointing at `/items` is served as-is by `_buildItemsUrl`.
    // Built with no `undefined` keys: `exactOptionalPropertyTypes` distinguishes
    // "absent" from "present and undefined".
    return {
        refused: null,
        ogcConfig: {
            url: source.url,
            collectionId: source.collectionId ?? layerId,
            ...(maxFeatures !== undefined ? { maxFeatures } : {}),
        },
        maxFeatures,
        versionProperty: source.versionProperty ?? DEFAULT_VERSION_PROPERTY,
        db,
    };
}

/**
 * Pulls a declared layer, bounded by extent and cap, into the `features` store.
 *
 * Does not throw: every outcome is a report. An unreachable source, an unknown layer
 * or an absent engine yield a named `refused` — a pull failing with zero and no motive
 * is indistinguishable from a genuinely empty layer, and that confusion is what this
 * closes.
 *
 * @param layerId - Identifier of the layer to pull.
 * @param options - Extent and abort signal.
 * @returns The report of what was done.
 * @example
 * const report = await GeoLeaf?.Storage?.pullLayer?.("sites_rosario");
 * if (report?.refused) console.warn("pas de rapatriement :", report.refused);
 * else console.info(`${report?.written} entités écrites`);
 */
export async function pullLayer(
    layerId: string,
    options: LayerPullOptions = {}
): Promise<LayerPullReport> {
    const nothing = {
        layerId,
        fetched: 0,
        written: 0,
        preserved: 0,
        skipped: 0,
        capped: false,
        aborted: false,
    };

    const plan = resolvePullPlan(layerId);
    if (plan.refused) return { ...nothing, refused: plan.refused };

    const { ogcConfig, maxFeatures, versionProperty, db } = plan;

    let collection;
    try {
        // 🛑 DYNAMIC IMPORT, and it is not cosmetic. The `kernel/geojson/index.js`
        // barrel is the only route the deep-import rule opens towards the OGC
        // transport, but it pulls the whole geojson subsystem: statically, it entered
        // the import graph of `offline-engine-entry.ts` and pushed the wiring test past
        // its 10 s timeout under the parallel suite (24 workers). The transport is only
        // needed at pull time — loading it there is also what lightens the chunk.
        const { fetchOgcApiFeatures } = await import("../../../kernel/geojson/index.js");
        collection = await fetchOgcApiFeatures(ogcConfig, options.signal, options.bbox);
    } catch (error) {
        Log.warn(
            `[Offline.Pull] "${layerId}" — source injoignable :`,
            error instanceof Error ? error.message : String(error)
        );
        // 🛑 THE FAILURE IS PERSISTED, and that is the marker's useful half. Without
        // it, a layer whose source went down would fall back to `declaredNeverPulled` —
        // the same status as a layer never attempted. `pullFailed` says we tried and
        // the source said no: that is actionable, the other is not.
        await writePullState(db, layerId, { at: Date.now(), outcome: "failed", written: 0 });
        return { ...nothing, refused: "sourceUnreachable" };
    }

    const fetched = collection?.features ?? [];
    // The HARD cap. ⚠️ Since 19/08/2026 the loader cuts at the exact bound itself, so
    // this line is REDUNDANT, not wrong: it no longer removes anything on this path.
    // Kept on purpose — it bounds the case where the collection comes from elsewhere,
    // and it feeds `capped`, the indicator the pull report exposes.
    // 🛑 `capped` IS NOW READ FROM BOTH SIDES, and forgetting that would have killed
    // the signal.
    //
    // Since the loader cuts at the exact bound itself, the local comparison can NO
    // LONGER be true: this module already receives 15 for a cap of 15. A `capped`
    // deduced from that comparison alone would therefore have become **definitively
    // false** — the report would have stopped saying a pull was partial, precisely the
    // day the cut became reliable. That is the failure mode where one thing is fixed
    // and its witness is extinguished.
    //
    // The loader sets `truncated` when it cuts; the local comparison stays, for the
    // case where the collection comes through another path. One OR the other
    // suffices.
    const loaderTruncated = collection?.truncated;
    const capped =
        loaderTruncated !== undefined ||
        (maxFeatures !== undefined && fetched.length > maxFeatures);
    const bounded =
        maxFeatures !== undefined && fetched.length > maxFeatures
            ? fetched.slice(0, maxFeatures)
            : fetched;

    const now = Date.now();
    const records: FeatureRecord[] = [];
    for (const feature of bounded) {
        const record = toFeatureRecord(layerId, feature, versionProperty, now);
        if (record) records.push(record);
    }

    const tally = (await db.putLayerFeatures?.(records)) ?? { written: 0, preserved: 0 };

    // ⚠️ `outcome: "ok"` even when `written` is 0 — that is exactly the case the sync
    // report exists to make distinguishable. A source answering "no entity in this
    // extent" WAS reached; confusing it with "never pulled" is the confusion the
    // contract names "the case with no observable until the outage".
    await writePullState(db, layerId, {
        at: now,
        outcome: "ok",
        written: tally.written,
    });

    // ⚠️ Re-read on the signal, not on the return: `fetchOgcApiFeatures` returns a
    // partial collection through the SAME path as a success, with no marker. A partial
    // batch is written — in the field, entities beat nothing — but it must not pass
    // itself off as complete.
    return {
        layerId,
        // What the SOURCE returned before the cut, not what survived: the loader
        // carries it in `truncated.fetched`. Reporting the post-cut length would make
        // the report say the source fit exactly within the bound — the opposite of
        // what it observed.
        fetched: loaderTruncated?.fetched ?? fetched.length,
        written: tally.written,
        preserved: tally.preserved,
        skipped: bounded.length - records.length,
        capped,
        aborted: options.signal?.aborted === true,
        refused: null,
    };
}
