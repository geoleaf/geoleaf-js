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
 * — and **writes no transport code**: `streamOgcApiFeatures` already carries `next`-link
 * pagination, `bbox`, `maxFeatures` and the `AbortSignal`.
 *
 * ⚠️ **It consumes the source PAGE BY PAGE since R9, and no longer as one array.** The
 * previous shape held the whole collection twice — once as the loader's accumulator, once
 * as store records — and wrote it in a SINGLE IndexedDB transaction: on the 30 000-entity
 * target of Lot 2, that is roughly 90 000 sequential requests in one block, with no
 * progress and nothing to show for an interruption. One OGC page is now one batch and one
 * transaction; `DEFAULT_LIMIT` is 1 000, so the slice size is the source's own page size
 * rather than a constant invented here.
 *
 * Three properties this module exists to hold:
 *
 * 1. **The cap is HARD, and this module no longer applies it.** The clause here read
 *    "`ogc-api-loader` […] never truncates" until 19/08/2026, when the exact cut moved to
 *    the source — the original finding was right (`maxFeatures: 15` with `limit: 10`
 *    yielded **20**) and this module compensated **alone**, while the DISPLAY path
 *    received the overflow unknowingly. From then on the local cut was redundant, and it
 *    was kept "for the case where the collection comes through another path".
 *    🛑 **R9 removed it, because that case ceased to exist.** No collection reaches this
 *    module any more: it consumes a walk it starts itself, from the only walker there is.
 *    A kept-just-in-case half of a predicate that nothing can reach is not redundancy, it
 *    is a branch no test can cover — and `capped` now reads from one place,
 *    `outcome.truncated`, instead of two.
 * 2. **A local capture is never overwritten.** The decision lives in
 *    `db/features.ts#putManyPreservingLocal`, in **one** transaction; here we only
 *    report its tally.
 *    🛑 **Chunking did NOT relax this, and reading it as "one transaction for the whole
 *    pull" would make the change look unsafe.** The property that module holds is that
 *    the read of a record's state and the write that follows it sit in the SAME
 *    transaction — otherwise the optimistic write of 4.4 slips between them. That holds
 *    per CALL, so N calls hold it N times. What chunking gives up is atomicity ACROSS
 *    pages, which was never a stated property and never true of anything downstream: an
 *    aborted pull already left the store partly filled, it just had no way to say so.
 *    That is what `outcome: "partial"` now records.
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
import type { GeoLeafOfflinePullProgressDetail } from "../../../contracts/event-bus.contract.js";

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
    /**
     * True when the run stopped on the caller's signal: the batch is PARTIAL.
     *
     * ⚠️ **Read from the RUN, not from the signal.** It used to be `signal.aborted` at
     * return time, because `fetchOgcApiFeatures` handed a partial collection back through
     * the same path as a complete one, unmarked. The stream reports what it observed, so a
     * signal raised AFTER the source was exhausted no longer makes a complete batch call
     * itself partial.
     */
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
        versionProperty: source.versionProperty ?? DEFAULT_VERSION_PROPERTY,
        db,
    };
}

/**
 * Publishes one page's progress on `document`.
 *
 * ⚠️ **A DOM event and not a callback**, unlike the resource downloader next door: this
 * pull is reached through the facade, whose signature is public and frozen, and through
 * `cacheProfile`, which does not forward one. An event reaches `offline-ui` without
 * either of them growing a parameter — and on `deploy-core`, where no plugin listens, it
 * costs a dispatch nobody hears rather than an API nobody calls.
 *
 * @param layerId - Layer being pulled.
 * @param written - Entities written so far, this page included.
 * @param matched - The source's own total, when it served one.
 */
function emitPullProgress(layerId: string, written: number, matched: number | undefined): void {
    // `document` is absent under Node — the engine's own tests run there, and a pull
    // that threw on its progress signal would fail for the one thing that is decoration.
    if (typeof document === "undefined") return;
    const totalIsKnown = typeof matched === "number" && matched > 0;
    const total = totalIsKnown ? matched : written;
    const detail: GeoLeafOfflinePullProgressDetail = {
        layerId,
        current: written,
        total,
        totalIsKnown,
        // Bounded at 100: `written` can exceed `matched` when the source grew between the
        // first page and the last, and a bar past its end reads as a bug in the bar.
        percentage: total > 0 ? Math.min(100, Math.round((written / total) * 100)) : 0,
    };
    document.dispatchEvent(new CustomEvent("geoleaf:offline:pull-progress", { detail }));
}

/**
 * Pulls a declared layer, bounded by extent and cap, into the `features` store.
 *
 * Does not throw: every outcome is a report. An unreachable source, an unknown layer
 * or an absent engine yield a named `refused` — a pull failing with zero and no motive
 * is indistinguishable from a genuinely empty layer, and that confusion is what this
 * closes.
 *
 * One OGC page is one transaction and one progress tick. An interruption therefore keeps
 * what was already committed, and the persisted marker says the run did not finish — see
 * `report/pull-state.ts` for why that marker carries no cursor.
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

    const { ogcConfig, versionProperty, db } = plan;

    // One timestamp for the whole run, pages included: `updatedAt` dates the pull, and
    // giving each page its own would make the store's index say the layer was written
    // over a spread of instants it never was.
    const now = Date.now();
    let written = 0;
    let preserved = 0;
    let skipped = 0;
    let matched: number | undefined;

    let outcome;
    let geojson;
    try {
        // 🛑 DYNAMIC IMPORT, and it is not cosmetic. The `kernel/geojson/index.js`
        // barrel is the only route the deep-import rule opens towards the OGC
        // transport, but it pulls the whole geojson subsystem: statically, it entered
        // the import graph of `offline-engine-entry.ts` and pushed the wiring test past
        // its 10 s timeout under the parallel suite (24 workers). The transport is only
        // needed at pull time — loading it there is also what lightens the chunk.
        //
        // ⚠️ `announceTruncation` rides the SAME import, and it is not a convenience.
        // Reaching `loader/truncation-notice.js` directly is what R.8 forbids
        // `capabilities/**` to do, and a static import through the barrel would drag the
        // whole geojson subsystem into the offline chunk's eager graph — the very cost
        // this dynamic import exists to avoid.
        geojson = await import("../../../kernel/geojson/index.js");
        outcome = await geojson.streamOgcApiFeatures(
            ogcConfig,
            async (page) => {
                if (page.matched !== undefined) matched = page.matched;

                const records: FeatureRecord[] = [];
                for (const feature of page.features) {
                    const record = toFeatureRecord(layerId, feature, versionProperty, now);
                    if (record) records.push(record);
                }
                skipped += page.features.length - records.length;

                // ONE transaction for this page. The rule that decides what is preserved
                // stays inside it — see property 2 in the module header.
                const tally = (await db.putLayerFeatures?.(records)) ?? {
                    written: 0,
                    preserved: 0,
                };
                written += tally.written;
                preserved += tally.preserved;

                // 🛑 The marker is written HERE, not only at the end, and that is the
                // whole value of committing per page. A tab killed mid-pull runs no
                // epilogue: whatever this wrote is what the next session reads, and
                // without it the store would hold half a layer under a status saying
                // either "never pulled" or nothing at all.
                await writePullState(db, layerId, { at: now, outcome: "partial", written });
                emitPullProgress(layerId, written, matched);
            },
            options.signal,
            options.bbox
        );
    } catch (error) {
        Log.warn(
            `[Offline.Pull] "${layerId}" — source injoignable :`,
            error instanceof Error ? error.message : String(error)
        );
        // 🛑 THE FAILURE IS PERSISTED, and that is the marker's useful half. Without
        // it, a layer whose source went down would fall back to `declaredNeverPulled` —
        // the same status as a layer never attempted. `pullFailed` says we tried and
        // the source said no: that is actionable, the other is not.
        //
        // ⚠️ `written` is reported as it stands, not as 0. Pages committed before the
        // failure ARE in the store; a marker claiming zero would describe a store that
        // does not exist.
        await writePullState(db, layerId, { at: Date.now(), outcome: "failed", written });
        return { ...nothing, written, preserved, skipped, refused: "sourceUnreachable" };
    }

    // 🛑 `capped` NOW HAS ONE SOURCE, where it used to have two. The old shape OR-ed the
    // loader's `truncated` with a local `fetched.length > maxFeatures` comparison, kept
    // "for the case where the collection comes through another path". That case is gone:
    // this module no longer receives a collection at all, it receives the run's own
    // report from the only walker there is. A second, unreachable half of a predicate is
    // not redundancy — it is a branch no test can ever cover.
    const capped = outcome.truncated !== undefined;

    // ⚠️ **THE PULL ANNOUNCES ITS OWN CUT, and the display path cannot do it for it.**
    // A layer with `offline.enabled` reads the local store, so its display path never sees
    // a `truncated` member — it sees whatever the pull wrote, which looks complete by
    // construction. The cap that bit here is `offline.maxFeatures`, a different key from
    // the display one, and this is the only moment anyone knows it bit.
    //
    // ⚠️ **OUTSIDE the `try`, deliberately.** Inside it, any throw from the notice — an
    // i18n dictionary failing to initialise, a renderer misbehaving — would be caught by
    // the handler above and reported as `sourceUnreachable`: a pull that fully succeeded
    // would announce that the source could not be reached. A decoration must not be able
    // to change a verdict.
    geojson.announceTruncation(layerId, layerId, outcome.truncated);

    // ⚠️ `outcome: "ok"` even when `written` is 0 — that is exactly the case the sync
    // report exists to make distinguishable. A source answering "no entity in this
    // extent" WAS reached; confusing it with "never pulled" is the confusion the
    // contract names "the case with no observable until the outage".
    await writePullState(db, layerId, {
        at: now,
        outcome: outcome.aborted ? "partial" : "ok",
        written,
    });

    return {
        layerId,
        // What the SOURCE returned before the cut, not what survived: reporting the
        // post-cut length would make the report say the source fit exactly within the
        // bound — the opposite of what it observed.
        fetched: outcome.fetched,
        written,
        preserved,
        skipped,
        capped,
        aborted: outcome.aborted,
        refused: null,
    };
}
