/*!
 * GeoLeaf Core (offline capability) — Offline POI Restore
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Offline entity restore — pushes queued offline edits onto their host GeoJSON layer.
 *
 * S9 D5 (dissolution POI, merge inversé). Historically the CORE pulled the
 * offline sync-queue and merged it into an aggregate layer source. D5
 * inverts the flow: this capability PUSHES pending entities onto the host
 * layer `gl-src-<layerId>` via `GeoLeaf.Layers.mergeFeatures`, so restored
 * entities render identically to features created at runtime and to static features.
 *
 * The pass is READ-ONLY over the queue (no status mutation, no network) and
 * IDEMPOTENT (`mergeFeatures` dedups by id, `removeFeature` no-ops when absent),
 * so it is safe to replay on every boot event. It is distinct from the REST
 * replay (`POISyncHandler`/sync-manager), which pushes to the server and prunes
 * synced entries — that pruning naturally shrinks what this pass re-displays.
 *
 * ═══ IT READS THE `outbox`, AND IT IS NO LONGER "POI" ═══
 *
 * 🛑 **The PRODUCER-vocabulary filter is gone, and it was a DEFECT.** This module kept
 * only `add_poi` / `update_poi` / `delete_poi` and discarded `editor.*` as "foreign":
 * a geometry drawn off-network with the editor was **never re-displayed** on reload.
 * The `outbox` speaks one vocabulary — `SyncOperationKind`, entity-generic because
 * the store is — so there is nothing left to filter, and nobody to discard.
 *
 * ⚠️ **The payload comes from the `features` store, no longer from the entry.** The
 * entry references only `[layerId, localId]` (contract); the current state lives in
 * the record, held by the optimistic write. `poiToFeature` therefore becomes useless
 * here — the store already holds GeoJSON.
 *
 * ⚠️ **The name `poi-restore` is historical: this module restores ENTITIES**, whatever plugin
 * captured them, ever since the producer-vocabulary filter above was removed. The name is KEPT
 * deliberately, not by neglect: `registerPoiRestore`, `restorePendingPois`, `PoiRestoreDeps`
 * and `PoiRestoreResult` are part of the published API surface of a package released as a
 * stable major version, and renaming a published symbol is a removal followed by an addition —
 * a breaking change. The rename is therefore due at the NEXT MAJOR version, all at once
 * (directory, identifiers, tree annotations, importers), never piecemeal. Until then the prose
 * around these names says "entities", and only the identifiers keep the old word.
 */
import { Log } from "../../../utils/log/index.js";
import { StorageContract } from "../../../kernel/shared/index.js";
// ⚠️ The one `db/` import of this module, and it does not break the rule below: that rule keeps
// the store's INSTANCES behind the contract (a deep import would reach a copy the engine never
// wired). This is a pure function with no state — how a record presents itself to a layer.
import { presentRecordFeature } from "../db/features.js";

/**
 * Entry states that stay on screen.
 *
 * `synced` leaves: the server has it, the layer already serves it. `quarantined`
 * STAYS — the contract says a set-aside entry "stays visible", and making it vanish
 * from the map would be the silent loss it was set aside against in the first place.
 */
const VISIBLE_STATES = new Set(["pending", "inFlight", "failed", "quarantined"]);
const DELETE_KIND = "delete";

/**
 * Sync status baked on restored entities before merge. `"pending"` lights the badge
 * (a queued entity is not yet REST-replayed → parity with the runtime badge, which
 * would otherwise vanish on reload); `null` bakes nothing (strict no-badge parity).
 * Single switch — the paint reads `coalesce(feature-state, property _syncStatus)`.
 */
const RESTORED_SYNC_STATUS: "pending" | null = "pending";

/** Structural subset of `GeoLeaf.Layers` consumed here (avoids a contract import). */
interface LayerLike {
    hasLayer(layerId: string): boolean;
    mergeFeatures(layerId: string, features: readonly GeoJSON.Feature[]): void;
    removeFeature(layerId: string, id: string | number): boolean;
}

/** An outbox entry, reduced to what restoration reads from it. */
interface QueueRow {
    kind?: unknown;
    layerId?: unknown;
    localId?: unknown;
    state?: unknown;
    createdAt?: unknown;
}

/** The two sub-modules read here, reduced to their use. */
interface OutboxReader {
    list(): Promise<QueueRow[]>;
}
interface FeaturesReader {
    get(layerId: string, localId: string): Promise<StoredEntity | null>;
}

/** A `features` record, reduced to what restoration reads from it. */
interface StoredEntity {
    feature?: unknown;
    /** Present once the server created the entity — it then names the entity on a layer. */
    serverId?: string | null;
}

/** Net operation for one entity of one layer (last write wins). */
interface NetOp {
    kind: string;
    localId: string;
    ts: number;
}

/** Outcome of a single restore pass (drives logs + tests). */
interface PoiRestoreResult {
    /** Features upserted via `mergeFeatures`. */
    merged: number;
    /** Features removed via `removeFeature`. */
    deleted: number;
    /** Rows dropped (null layerId / missing id / non-convertible). */
    skipped: number;
    /** Host layers not yet present (`hasLayer` false) — retried by the next pass. */
    deferredLayers: string[];
}

/** Injectable seams (default to the live sync-queue + `GeoLeaf.Layers`). */
export interface PoiRestoreDeps {
    /** Overrides the outbox reader (tests). */
    getEntries?: () => Promise<Record<string, unknown>[]>;
    /** Overrides the feature-store reader (tests). */
    readFeature?: (layerId: string, localId: string) => Promise<{ feature?: unknown } | null>;
    /** Overrides the layer seam (tests). */
    layers?: LayerLike;
    /** Sink for dropped rows (defaults to `Log.warn`). */
    logDropped?: (message: string, entry?: Record<string, unknown>) => void;
}

/** Resolves `GeoLeaf.Layers` off the global namespace (matches entry.ts's access). */
function _resolveLayers(): LayerLike | undefined {
    const g = (typeof globalThis !== "undefined" ? globalThis : {}) as {
        GeoLeaf?: { Layers?: LayerLike };
    };
    return g.GeoLeaf?.Layers;
}

/** The name of a database sub-module, as the engine's own accessor types it. */
type DbModuleName = Parameters<NonNullable<typeof StorageContract.DB>["_ensureModule"]>[0];

/**
 * Access to a database sub-module, through the contract — never a `db/` import. Typed by the
 * engine: a reader below is checked against the module it actually reads.
 */
function _module<K extends DbModuleName>(name: K) {
    const db = StorageContract.DB;
    if (!StorageContract.isAvailable() || typeof db?._ensureModule !== "function") return null;
    return db._ensureModule(name) ?? null;
}

/** Reads the whole `outbox` through the contract; `[]` when the engine is absent. */
function _readOutbox(): Promise<QueueRow[]> {
    const outbox: OutboxReader | null = _module("Outbox");
    if (!outbox?.list) return Promise.resolve([]);
    return outbox.list();
}

/** Host layer identifier — carried by the entry itself. */
function _resolveLayerId(rec: QueueRow): string | null {
    return typeof rec.layerId === "string" && rec.layerId ? rec.layerId : null;
}

/** Local identity — dedup key and `removeFeature` target. Carried by the entry. */
function _entityId(rec: QueueRow): string | null {
    return typeof rec.localId === "string" && rec.localId ? rec.localId : null;
}

/** Records a dropped row (never silently truncate). */
function _drop(
    result: PoiRestoreResult,
    type: string,
    reason: string,
    entry: Record<string, unknown>,
    logDropped?: PoiRestoreDeps["logDropped"]
): void {
    result.skipped++;
    const message = `[PoiRestore] dropped ${type || "?"} entry: ${reason}`;
    if (logDropped) logDropped(message, entry);
    else Log.warn(message);
}

/**
 * Reduces the raw queue to the net op per `(layerId, id)` — last-write-wins by
 * timestamp, so `add` then `delete` collapses to `delete` regardless of order.
 */
function _reduceNetOps(
    entries: QueueRow[],
    result: PoiRestoreResult,
    logDropped?: PoiRestoreDeps["logDropped"]
): Map<string, Map<string, NetOp>> {
    const byLayer = new Map<string, Map<string, NetOp>>();
    for (const rec of entries) {
        const kind = typeof rec.kind === "string" ? rec.kind : "";
        // ⚠️ NO producer filter: this is what finally brings a geometry drawn with
        // the editor back on screen.
        if (!VISIBLE_STATES.has(String(rec.state))) continue;
        const layerId = _resolveLayerId(rec);
        const id = _entityId(rec);
        if (!layerId) {
            _drop(result, kind, "null/absent layerId", { ...rec }, logDropped);
            continue;
        }
        if (!id) {
            _drop(result, kind, "missing localId", { ...rec }, logDropped);
            continue;
        }
        const ts = typeof rec.createdAt === "number" ? rec.createdAt : 0;
        let layerMap = byLayer.get(layerId);
        if (!layerMap) {
            layerMap = new Map<string, NetOp>();
            byLayer.set(layerId, layerMap);
        }
        const prev = layerMap.get(id);
        if (!prev || ts >= prev.ts) layerMap.set(id, { kind, localId: id, ts });
    }
    return byLayer;
}

/** Bakes the restored sync status onto the feature (survives the merge rebuild). */
function _applyRestoredStatus(feature: GeoJSON.Feature): void {
    if (!RESTORED_SYNC_STATUS) return;
    const props = (feature.properties ?? {}) as Record<string, unknown>;
    props["_syncStatus"] = RESTORED_SYNC_STATUS;
    feature.properties = props;
}

/** The layer members {@link clearRestoredStatus} reads, beyond the restore's own. */
interface BadgeLayerLike {
    hasLayer?(layerId: string): boolean;
    removeFeature?(layerId: string, id: string | number): boolean;
    getFeatureById?(layerId: string, id: string | number): GeoJSON.Feature | null;
    patchFeature?(
        layerId: string,
        id: string | number,
        patch: Record<string, unknown>,
        opts?: { rerender?: boolean }
    ): void;
}

/**
 * The identity an entity of the store has on its LAYER — the one {@link clearRestoredStatus}
 * and the restore address it by.
 *
 * Read from the record: a creation is named by its client key until the server names it, a
 * served entity by the server's id, which is not the key the queue holds it under.
 *
 * @param layerId - The entity's layer.
 * @param localId - The key the queue holds the entity under.
 * @returns The identity on the layer; the key itself when the record cannot be read.
 */
export async function layerIdentityOf(layerId: string, localId: string): Promise<string | number> {
    try {
        const features: FeaturesReader | null = _module("Features");
        const record = features?.get ? await features.get(layerId, localId) : null;
        if (!record) return localId;
        const presented = presentRecordFeature({
            feature: record.feature,
            localId,
            serverId: record.serverId ?? null,
        }) as { id?: string | number; properties?: { id?: unknown } } | null | undefined;
        return (
            presented?.id ?? (presented?.properties?.id as string | number | undefined) ?? localId
        );
    } catch (err) {
        Log.warn(`[PoiRestore] identity of ${layerId}/${localId} not read:`, err);
        return localId;
    }
}

/**
 * Bakes the "pending" badge on an entity queued in THIS session, if its layer holds it.
 *
 * 🛑 THE RESTORE WAS THE ONLY ONE TO SET IT, at boot. A capture made since was owed to the
 * server and drawn like any other entity, until the page was reloaded — the badge told the
 * truth about yesterday's work and nothing about today's.
 *
 * Same property as the restore's, on purpose: {@link clearRestoredStatus} lifts either one when
 * the entity is pushed, and a re-read of the layer carries either one over.
 *
 * Never throws: a decoration must not fail the write that asked for it.
 *
 * @param layerId - The entity's layer.
 * @param id - Its identity on that layer ({@link layerIdentityOf}).
 * @returns Whether the layer HOLDS the entity — marked now, or carrying the badge already.
 *   `false` means it is not there yet: the caller asks again when the layer is written.
 * @example
 * const id = await layerIdentityOf("sites", "loc:3f2…");
 * if (!markPendingStatus("sites", id)) waiting.add("loc:3f2…");
 */
export function markPendingStatus(layerId: string, id: string | number): boolean {
    if (!RESTORED_SYNC_STATUS) return true;
    try {
        const layers = _resolveLayers() as BadgeLayerLike | undefined;
        if (!layers?.patchFeature || !layers.getFeatureById || !layers.hasLayer?.(layerId)) {
            return false;
        }
        const held = layers.getFeatureById(layerId, id);
        if (!held) return false;
        if (held.properties?.["_syncStatus"] !== RESTORED_SYNC_STATUS) {
            layers.patchFeature(
                layerId,
                id,
                { _syncStatus: RESTORED_SYNC_STATUS },
                { rerender: true }
            );
        }
        return true;
    } catch (err) {
        Log.warn(`[PoiRestore] pending badge not set on ${layerId}:`, err);
        return false;
    }
}

/**
 * Lifts the "pending" badge off an entity the drain has just pushed.
 *
 * The badge is baked into the layer's copy of an entity — by the restore at boot, or by
 * {@link markPendingStatus} for a capture of the session; the drain writes the server's answer
 * into the RECORD only. Without this, the layer kept saying "owed" of an entity the server
 * already held, until the next load. The module that sets the badge is the one that lifts it.
 *
 * The feature is addressed by the identity the restore gave it, derived from the record AS
 * SENT — before the server's identity was written back: a pushed creation is still named by its
 * client key on its layer. Only a feature carrying the badge is touched, so a push never
 * re-renders a layer nothing decorated.
 *
 * Never throws: a decoration must not fail a drain.
 *
 * @param layerId - The entity's layer.
 * @param sent - The record the drain sent: its feature, its key, and its server identity.
 * @example
 * clearRestoredStatus("sites", { feature, localId: "loc:3f2…", serverId: null });
 */
export function clearRestoredStatus(
    layerId: string,
    sent: { feature?: unknown; localId: string; serverId?: string | null }
): void {
    if (!RESTORED_SYNC_STATUS) return;
    try {
        const layers = _resolveLayers() as BadgeLayerLike | undefined;
        if (!layers?.patchFeature || !layers.getFeatureById || !layers.hasLayer?.(layerId)) return;
        const presented = presentRecordFeature({
            feature: sent.feature,
            localId: sent.localId,
            serverId: sent.serverId ?? null,
        }) as { id?: string | number; properties?: { id?: unknown } } | null | undefined;
        const id = presented?.id ?? (presented?.properties?.id as string | number | undefined);
        if (id == null) return;
        const held = layers.getFeatureById(layerId, id);
        if (held?.properties?.["_syncStatus"] !== RESTORED_SYNC_STATUS) return;
        // `null`, not a status of our own: the paint tests for "pending", and absent is plain.
        layers.patchFeature(layerId, id, { _syncStatus: null }, { rerender: true });
    } catch (err) {
        Log.warn(`[PoiRestore] pending badge not lifted on ${layerId}:`, err);
    }
}

/**
 * Takes off its layer an entity whose capture was abandoned and that the server does not hold.
 *
 * A creation that never landed, or an entity the server deleted: once the queue entry is
 * destroyed and the record removed, nothing will ever push it nor pull it back. Left on the
 * layer it stayed drawn — badge included — until the next page load. An abandoned EDIT of an
 * entity the server still holds is not this gesture's: it keeps its drawing and loses its badge
 * ({@link clearRestoredStatus}).
 *
 * Addressed the way the badge is: by the identity the record gives the entity on its layer.
 * Never throws: the capture is already destroyed, and a layer that cannot follow must not turn
 * the operator's confirmed gesture into a failure.
 *
 * @param layerId - The entity's layer.
 * @param abandoned - The record as it was BEFORE its removal: its feature, key and server identity.
 * @returns Whether the layer held the entity and let it go.
 * @example
 * removeAbandonedFeature("sites", { feature, localId: "loc:3f2…", serverId: null });
 */
export function removeAbandonedFeature(
    layerId: string,
    abandoned: { feature?: unknown; localId: string; serverId?: string | null }
): boolean {
    try {
        const layers = _resolveLayers() as BadgeLayerLike | undefined;
        if (!layers?.removeFeature || !layers.hasLayer?.(layerId)) return false;
        const presented = presentRecordFeature({
            feature: abandoned.feature,
            localId: abandoned.localId,
            serverId: abandoned.serverId ?? null,
        }) as { id?: string | number; properties?: { id?: unknown } } | null | undefined;
        const id = presented?.id ?? (presented?.properties?.id as string | number | undefined);
        return id == null ? false : layers.removeFeature(layerId, id);
    } catch (err) {
        Log.warn(`[PoiRestore] abandoned entity not removed from ${layerId}:`, err);
        return false;
    }
}

/** Applies the net ops per layer: delete → `removeFeature`, else batched upsert. */
async function _applyNetOps(
    byLayer: Map<string, Map<string, NetOp>>,
    layers: LayerLike,
    result: PoiRestoreResult,
    readFeature: (layerId: string, localId: string) => Promise<StoredEntity | null>
): Promise<void> {
    for (const [layerId, ops] of byLayer) {
        if (!layers.hasLayer(layerId)) {
            result.deferredLayers.push(layerId);
            Log.debug(`[PoiRestore] host layer not ready, deferred: ${layerId}`);
            continue;
        }
        const upserts: GeoJSON.Feature[] = [];
        for (const op of ops.values()) {
            if (op.kind === DELETE_KIND) {
                layers.removeFeature(layerId, op.localId);
                result.deleted++;
                continue;
            }
            // 🛑 The payload comes from the STORE: the entry references only
            // `[layerId, localId]`, and the current state is held by the optimistic
            // write.
            const record = await readFeature(layerId, op.localId);
            // 🛑 WITH THE RECORD'S IDENTITY. A creation is stored without one, and an id-less
            // feature is never deduped by `mergeFeatures`: every pass of this restore (up to
            // two per boot) drew one more copy, none findable by `getFeatureById`.
            const feature = (
                record
                    ? presentRecordFeature({
                          feature: record.feature,
                          localId: op.localId,
                          serverId: record.serverId ?? null,
                      })
                    : undefined
            ) as GeoJSON.Feature | undefined;
            if (!feature || typeof feature !== "object") {
                result.skipped++;
                continue;
            }
            _applyRestoredStatus(feature);
            upserts.push(feature);
        }
        if (upserts.length > 0) {
            layers.mergeFeatures(layerId, upserts);
            result.merged += upserts.length;
        }
    }
}

/**
 * Runs one idempotent restore pass: sync-queue → host layers via `GeoLeaf.Layers`.
 *
 * Reads every pending/failed entity op, resolves its host layer, drops rows without
 * a host layer (logged, never silent), collapses multiple ops per id to their net
 * state, then upserts (`mergeFeatures`) or removes (`removeFeature`). Safe to call
 * repeatedly — dedup by id makes replays no-ops for already-present features.
 *
 * @param deps - Optional injected seams (queue reader, layer api, drop sink).
 * @returns Counts of merged/deleted/skipped features and deferred host layers.
 */
export async function restorePendingPois(deps: PoiRestoreDeps = {}): Promise<PoiRestoreResult> {
    const result: PoiRestoreResult = { merged: 0, deleted: 0, skipped: 0, deferredLayers: [] };
    const layers = deps.layers ?? _resolveLayers();
    if (!layers) {
        Log.debug("[PoiRestore] GeoLeaf.Layers unavailable — skip");
        return result;
    }
    let entries: QueueRow[];
    try {
        entries = deps.getEntries ? await deps.getEntries() : await _readOutbox();
    } catch (err: unknown) {
        Log.error("[PoiRestore] Failed to read the outbox:", err);
        return result;
    }
    if (!Array.isArray(entries) || entries.length === 0) return result;

    const readFeature =
        deps.readFeature ??
        ((layerId: string, localId: string) => {
            const features: FeaturesReader | null = _module("Features");
            return features?.get ? features.get(layerId, localId) : Promise.resolve(null);
        });
    await _applyNetOps(
        _reduceNetOps(entries, result, deps.logDropped),
        layers,
        result,
        readFeature
    );
    Log.info(
        `[PoiRestore] ${result.merged} merged, ${result.deleted} deleted, ` +
            `${result.skipped} skipped, ${result.deferredLayers.length} deferred`
    );
    return result;
}
