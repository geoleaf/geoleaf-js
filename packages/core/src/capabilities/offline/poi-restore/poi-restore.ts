/*!
 * GeoLeaf Core (offline capability) — Offline POI Restore
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Offline POI restore — pushes queued POIs onto their host GeoJSON layer.
 *
 * S9 D5 (dissolution POI, merge inversé). Historically the CORE pulled the
 * offline sync-queue and merged it into an aggregate layer source. D5
 * inverts the flow: this capability PUSHES its pending POIs onto the host
 * layer `gl-src-<layerId>` via `GeoLeaf.Layers.mergeFeatures`, so restored POIs
 * render identically to addpoi's runtime POIs (D4) and to static features.
 *
 * The pass is READ-ONLY over the queue (no status mutation, no network) and
 * IDEMPOTENT (`mergeFeatures` dedups by id, `removeFeature` no-ops when absent),
 * so it is safe to replay on every boot event. It is distinct from the REST
 * replay (`POISyncHandler`/sync-manager), which pushes to the server and prunes
 * synced entries — that pruning naturally shrinks what this pass re-displays.
 *
 * ═══ TÂCHE 4.7 — IL LIT L'`outbox`, ET IL N'EST PLUS « POI » ═══
 *
 * 🛑 **Le filtre par vocabulaire de PRODUCTEUR a disparu, et c'était un DÉFAUT.** Ce module ne
 * gardait que `add_poi` / `update_poi` / `delete_poi` et écartait `editor.*` comme
 * « foreign » : une géométrie tracée hors réseau avec l'éditeur n'était **jamais réaffichée**
 * au rechargement. L'`outbox` ne parle qu'un vocabulaire — `SyncOperationKind`, entity-generic
 * parce que le magasin l'est — donc il n'y a plus rien à filtrer, ni personne à écarter.
 *
 * ⚠️ **La charge utile vient du magasin `features`, plus de l'entrée.** Celle-ci ne référence
 * que `[layerId, localId]` (contrat) ; l'état courant vit dans l'enregistrement, tenu par
 * l'écriture optimiste de 4.4. `poiToFeature` devient donc inutile ici — le magasin stocke
 * déjà du GeoJSON.
 *
 * ⚠️ **Le nom `poi-restore` est un abus depuis 4.7** : il restaure des ENTITÉS, quel que soit
 * le plugin qui les a saisies. Le renommage touche `ENGINE_DIRS`, les annotations d'arbre et
 * ses importeurs — groupé avec la tâche 4.9, qui reprend ce répertoire.
 */
import { Log } from "../../../utils/log/index.js";
import { StorageContract } from "../../../kernel/shared/index.js";

/**
 * États d'entrée qui restent à l'écran.
 *
 * `synced` sort : le serveur l'a, la couche la sert déjà. `quarantined` RESTE — le contrat dit
 * qu'une entrée mise de côté « reste visible », et la faire disparaître de la carte serait la
 * perte silencieuse contre laquelle elle a précisément été mise de côté.
 */
const VISIBLE_STATES = new Set(["pending", "inFlight", "failed", "quarantined"]);
const DELETE_KIND = "delete";

/**
 * Sync status baked on restored POIs before merge. `"pending"` lights the badge
 * (a queued POI is not yet REST-replayed → parity with the D4 badge, which would
 * otherwise vanish on reload); `null` bakes nothing (strict no-badge parity).
 * Single switch — the paint reads `coalesce(feature-state, property _syncStatus)`.
 */
const RESTORED_SYNC_STATUS: "pending" | null = "pending";

/** Structural subset of `GeoLeaf.Layers` consumed here (avoids a contract import). */
interface LayerLike {
    hasLayer(layerId: string): boolean;
    mergeFeatures(layerId: string, features: readonly GeoJSON.Feature[]): void;
    removeFeature(layerId: string, id: string | number): boolean;
}

/** Une entrée d'outbox, réduite à ce que la restauration en lit. */
interface QueueRow {
    [key: string]: unknown;
    kind?: unknown;
    layerId?: unknown;
    localId?: unknown;
    state?: unknown;
    createdAt?: unknown;
}

/** Les deux sous-modules lus ici, réduits à leur usage. */
interface OutboxReader {
    list(): Promise<QueueRow[]>;
}
interface FeaturesReader {
    get(layerId: string, localId: string): Promise<{ feature?: unknown } | null>;
}

/** Opération nette pour une entité d'une couche (dernière écriture gagnante). */
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

/** Accès aux sous-modules de la base, par le contrat — jamais par un import de `db/`. */
function _module<T>(name: string): T | null {
    const db = StorageContract.DB as { _ensureModule?: (n: string) => unknown } | null;
    if (!StorageContract.isAvailable() || typeof db?._ensureModule !== "function") return null;
    return (db._ensureModule(name) as T | null) ?? null;
}

/** Lit toute l'`outbox` via le contrat ; `[]` quand le moteur est absent. */
function _readOutbox(): Promise<QueueRow[]> {
    const outbox = _module<OutboxReader>("Outbox");
    if (!outbox?.list) return Promise.resolve([]);
    return outbox.list();
}

/** Identifiant de couche hôte — porté par l'entrée elle-même depuis 4.4. */
function _resolveLayerId(rec: QueueRow): string | null {
    return typeof rec.layerId === "string" && rec.layerId ? rec.layerId : null;
}

/** Identité locale — clé de dédup et cible de `removeFeature`. Portée par l'entrée. */
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
    entries: Record<string, unknown>[],
    result: PoiRestoreResult,
    logDropped?: PoiRestoreDeps["logDropped"]
): Map<string, Map<string, NetOp>> {
    const byLayer = new Map<string, Map<string, NetOp>>();
    for (const entry of entries) {
        const rec = entry as QueueRow;
        const kind = typeof rec.kind === "string" ? rec.kind : "";
        // ⚠️ AUCUN filtre par producteur : c'est ce qui fait qu'une géométrie tracée par
        // l'éditeur revient enfin à l'écran.
        if (!VISIBLE_STATES.has(String(rec.state))) continue;
        const layerId = _resolveLayerId(rec);
        const id = _entityId(rec);
        if (!layerId) {
            _drop(result, kind, "null/absent layerId", entry, logDropped);
            continue;
        }
        if (!id) {
            _drop(result, kind, "missing localId", entry, logDropped);
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

/** Applies the net ops per layer: delete → `removeFeature`, else batched upsert. */
async function _applyNetOps(
    byLayer: Map<string, Map<string, NetOp>>,
    layers: LayerLike,
    result: PoiRestoreResult,
    readFeature: (layerId: string, localId: string) => Promise<{ feature?: unknown } | null>
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
            // 🛑 La charge vient du MAGASIN : l'entrée ne référence que `[layerId, localId]`,
            // et l'état courant est tenu par l'écriture optimiste de 4.4.
            const record = await readFeature(layerId, op.localId);
            const feature = record?.feature as GeoJSON.Feature | undefined;
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
 * Reads every pending/failed POI op, resolves its host layer, drops rows without
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
    let entries: Record<string, unknown>[];
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
            const features = _module<FeaturesReader>("Features");
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
