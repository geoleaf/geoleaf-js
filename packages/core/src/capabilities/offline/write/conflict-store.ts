/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The server row READ BEFORE IT IS CRUSHED — and kept.
 *
 * 🛑 **THE HOLE THIS CLOSES.** `lastWriteWins` became observable on 17/09/2026: the drain
 * detects the conflict, logs it, then re-sends the write unfiltered. What no part of the
 * cycle ever did was LOOK at the row it was about to overwrite. After a settled update the
 * server still holds a row; after a settled DELETE it holds nothing, and neither did anything
 * else — the only irrecoverable loss of the whole write cycle.
 *
 * 🛑 **THE RE-READ NEVER DECIDES WHETHER THE WRITE HAPPENS** (decision of 17/09/2026). A
 * server granting `UPDATE` without `SELECT` is an ordinary permission split; making the
 * overwrite conditional on the read would turn every conflict into a spent budget and then a
 * quarantine — i.e. repeal the arbitrated policy without a single gate noticing. When the
 * read cannot conclude, the record is written with `readOutcome: "unreadable"` and the
 * overwrite proceeds: the gap is recorded rather than invented.
 *
 * ⚠️ **NOTHING HERE WRITES INTO `features`.** The server's row is evidence, never a source.
 * Writing it back would overwrite what the operator captured, which is the sixth defect
 * closed on 17/09/2026 reappearing in a new place. Pinned by
 * `__tests__/capabilities/offline/conflict-store.test.ts`.
 *
 * ⚠️ **It lives beside `push-engine.ts` rather than inside it.** That file is already at
 * 1287 lines against a 700-line ceiling, and the dependency is one-directional — the drain
 * imports this module, never the reverse — which is also what keeps {@link markerOf} to a
 * single author.
 */

import { Log } from "../../../utils/log/index.js";
import { StorageContract } from "../../../kernel/shared/index.js";
import { fetchBounded } from "../../../utils/general/fetch-bounded.js";
import type {
    ConflictReadOutcome,
    ConflictRecord,
    FeatureRecord,
    OutboxEntry,
    VersionMarker,
} from "../../../contracts/sync.contract.js";

/** The layer's write target, reduced to what a re-read needs. */
interface ReadTarget {
    endpoint: string;
    versionProperty: string;
}

/** The conflicts store, reduced to what this module uses. */
interface ConflictsModule {
    put(record: ConflictRecord): Promise<void>;
    list(): Promise<ConflictRecord[]>;
    listByLayer(layerId: string): Promise<ConflictRecord[]>;
    clear(layerId?: string): Promise<void>;
}

/** The storage seam, reduced to what this module reads. */
interface ConflictStore {
    _ensureModule?: (name: string) => unknown;
}

/**
 * What the re-read established, and what it read.
 *
 * ⚠️ NOT exported: it is the shape passed from {@link readServerVersion} to
 * {@link recordConflict}, and `push-engine.ts` — the only caller of both — gets it by
 * inference. Exporting it would add a public name nobody imports, which
 * `check-orphan-exports` counts as a regression; it was seen doing exactly that.
 */
interface ServerSnapshot {
    outcome: ConflictReadOutcome;
    /** The crushed row, as the server returned it. `null` unless `outcome` is `"read"`. */
    row: Record<string, unknown> | null;
    /** Its freshness marker. `null` unless `outcome` is `"read"` and the column carried one. */
    version: VersionMarker | null;
}

/**
 * Reads a freshness marker off a row.
 *
 * 🛑 **ONE AUTHOR, AND IT IS HERE.** `push-engine.ts` reads the marker the server returns
 * after a write; this module reads the one it returns before being overwritten. Two copies
 * would be two definitions of "what counts as a marker" — and the half of the cycle that
 * drifted would compare against something the other half never wrote.
 *
 * 🛑 **THE SERVER MOVES ITS MARKER ON EVERY WRITE, AND THE RECORD KEPT THE OLD ONE.** The
 * next modification of the same entity then left filtered on a marker the server no longer
 * held, matched nothing, and counted the device's own write as someone else's — a false
 * conflict, which a journal of conflicts would have recorded as real. That defect is what
 * made this function exist (17/09/2026); it moved here when the re-read became its second
 * caller.
 *
 * ⚠️ An empty string, `null` and `undefined` all mean "no marker": a row without the column,
 * or no row at all. Keeping the old one would guarantee that false conflict on a server that
 * moves it; `null` sends the next write unfiltered, which is what a layer without a marker
 * does anyway.
 *
 * @param row - The row, as the server returned it.
 * @param versionProperty - The layer's marker column.
 * @returns The marker, or `null`.
 */
export function markerOf(
    row: Record<string, unknown> | null | undefined,
    versionProperty: string
): VersionMarker | null {
    const marker = row?.[versionProperty];
    if (marker === undefined || marker === null || marker === "") return null;
    return { kind: "timestamp", value: String(marker) };
}

/**
 * Reads the server's current row for an entity — the version the overwrite is about to crush.
 *
 * ⚠️ **A GET, and it writes nothing.** The row is returned to the caller; storing it is
 * {@link recordConflict}'s job, and neither touches `features`.
 *
 * ⚠️ **An empty JSON array is `"absent"`, anything unreadable is `"unreadable"`**, and the
 * distinction is the same one the drain draws on a `200 []`: an array proves the server
 * answered in representation, a body we cannot read proves nothing. Reading the second as
 * the first would make the store claim "the server held nothing" about a row it simply
 * could not see.
 *
 * @param record - The entity whose server row is wanted; its `serverId` names the row.
 * @param target - The layer's endpoint and marker column.
 * @returns What could be established — never throws.
 * @example
 * const snapshot = await readServerVersion(record, target);
 * if (snapshot.outcome === "read") console.log(snapshot.version);
 */
export async function readServerVersion(
    record: FeatureRecord,
    target: ReadTarget
): Promise<ServerSnapshot> {
    // An entity the server has never seen has nothing to crush — and no filter could have
    // produced the conflict that brought us here in the first place.
    if (record.serverId == null) return { outcome: "absent", row: null, version: null };

    const url = `${target.endpoint}?id=eq.${encodeURIComponent(String(record.serverId))}`;
    let response: Response;
    try {
        response = await fetchBounded(url, { headers: { Accept: "application/json" } });
    } catch (error) {
        Log.warn(
            `[Offline.Conflict] relecture muette pour ${record.layerId}/${record.localId} :`,
            String(error)
        );
        return { outcome: "unreadable", row: null, version: null };
    }
    if (!response.ok) {
        Log.warn(
            `[Offline.Conflict] relecture refusée (${response.status}) pour ${record.layerId}/${record.localId}.`
        );
        return { outcome: "unreadable", row: null, version: null };
    }
    const payload = (await response.json().catch(() => null)) as
        Record<string, unknown> | Array<Record<string, unknown>> | null;
    const row = Array.isArray(payload) ? payload[0] : payload;
    if (row) return { outcome: "read", row, version: markerOf(row, target.versionProperty) };
    // A JSON array proves the server answered in representation: empty means it holds no
    // such row. Anything else — a `null` body, a 204 — proves nothing.
    if (Array.isArray(payload)) return { outcome: "absent", row: null, version: null };
    return { outcome: "unreadable", row: null, version: null };
}

/** Resolves the conflicts module, or `null` when the engine is not wired. */
function _conflicts(): ConflictsModule | null {
    const db = StorageContract.DB as ConflictStore | null;
    const mod = db?._ensureModule?.("Conflicts") as Partial<ConflictsModule> | null | undefined;
    // `typeof … === "function"` and not truthiness: the module comes from a string-keyed
    // registry, so it CAN be missing, and that is the case being guarded (TS2774 otherwise).
    return typeof mod?.put === "function" ? (mod as ConflictsModule) : null;
}

/**
 * The conflicts kept for one layer, or for every layer.
 *
 * 🛑 **A STORE NOBODY CAN READ IS THE DEFECT, NOT THE FEATURE.** `local_images` spent a month
 * as a write-only store — images went in, its reader had been removed as "redundant", and a
 * successful upload had nowhere to send the URL back to. The fiche records it. A conflict
 * archive nothing can enumerate would be the same shape: the crushed version would be kept
 * and unreachable, which is indistinguishable from not keeping it.
 *
 * ⚠️ Empty rather than throwing when the engine is not wired — a host asking "what did I
 * crush?" on an application without the offline capability gets "nothing", which is true.
 *
 * @param layerId - Restrict to this layer; omitted, every layer.
 * @returns The archived conflicts, newest write of each entity.
 * @example
 * const crushed = await GeoLeaf?.Storage?.listConflicts?.("sites");
 * console.info(`${crushed?.length ?? 0} version(s) écrasée(s) conservée(s)`);
 */
export async function listConflicts(layerId?: string): Promise<ConflictRecord[]> {
    const store = _conflicts();
    if (!store) return [];
    try {
        return layerId === undefined ? await store.list() : await store.listByLayer(layerId);
    } catch (error) {
        Log.warn("[Offline.Conflict] lecture du magasin impossible :", String(error));
        return [];
    }
}

/**
 * Drops the archived conflicts of one layer, or all of them.
 *
 * ⚠️ **The only purge there is, and it is DELIBERATE that it is manual.** `db/eviction.ts`
 * names a single store (`layers`), so nothing reclaims this one on its own — the same
 * property that protects `features` from being evicted with unsynchronised work in it. The
 * key bounds the store at one record per entity; this is what empties it once an operator
 * has looked at what was crushed.
 *
 * @param layerId - Restrict to this layer; omitted, every layer.
 * @returns `true` when the purge ran, `false` when the engine is not wired.
 * @example
 * await GeoLeaf?.Storage?.clearConflicts?.("sites");
 */
export async function clearConflicts(layerId?: string): Promise<boolean> {
    const store = _conflicts();
    if (!store) return false;
    try {
        await store.clear(layerId);
        return true;
    } catch (error) {
        Log.warn("[Offline.Conflict] purge du magasin impossible :", String(error));
        return false;
    }
}

/**
 * Stores one settled conflict and announces it.
 *
 * ⚠️ **CALLED AFTER THE OVERWRITE SUCCEEDED, never before.** A record written for a write
 * that never landed would be an observation about something that did not happen — and the
 * entry is still in the queue at that point, so it will come back and be settled again.
 *
 * ⚠️ **Never throws, and never fails the drain.** A conflict that could not be archived is
 * worth a warning; losing the capture that was being pushed because the archive refused
 * would trade the defect for a worse one.
 *
 * @param entry - The queue entry whose send met the conflict.
 * @param record - The entity it names.
 * @param snapshot - What the re-read established about the crushed row.
 * @returns Nothing — the outcome is the stored record and the event.
 */
export async function recordConflict(
    entry: OutboxEntry,
    record: FeatureRecord,
    snapshot: ServerSnapshot
): Promise<void> {
    const conflict: ConflictRecord = {
        layerId: entry.layerId,
        localId: entry.localId,
        serverId: record.serverId,
        kind: entry.kind,
        entryId: entry.id,
        detectedAt: Date.now(),
        baseVersion: entry.baseVersion ?? null,
        serverVersion: snapshot.version,
        serverFeature: snapshot.row,
        readOutcome: snapshot.outcome,
        settledBy: "lastWriteWins",
    };

    const store = _conflicts();
    if (store) {
        try {
            await store.put(conflict);
        } catch (error) {
            Log.warn(`[Offline.Conflict] conflit non archivé pour ${entry.id} :`, String(error));
        }
    } else {
        Log.warn(`[Offline.Conflict] magasin indisponible — conflit non archivé pour ${entry.id}.`);
    }

    _announceConflict(conflict);
}

/**
 * Emits `geoleaf:offline:write-conflict`.
 *
 * 🛑 **THE DRAIN ONLY EVER SAID A NUMBER.** `geoleaf:offline:outbox-drained` carries a
 * `conflicts` tally, which tells a banner that something was settled and tells no one WHAT.
 * The other conflict event of the repository — `geoleaf:editor:feature-conflict` — belongs to
 * the editor's ONLINE adapter and its 409; it never fires for a queued write. A host that
 * wants to show the crushed version had no signal at all.
 *
 * ⚠️ Guarded on the EXISTENCE of `document`, like `_announceDrained`: this engine also runs
 * where there is none (worker, prerender, the Service Worker context sharing these modules),
 * and an unguarded emitter takes the whole drain down with it.
 *
 * @param conflict - The record just stored; the event carries it verbatim.
 */
function _announceConflict(conflict: ConflictRecord): void {
    if (typeof document === "undefined") return;
    document.dispatchEvent(
        new CustomEvent("geoleaf:offline:write-conflict", {
            detail: {
                layerId: conflict.layerId,
                localId: conflict.localId,
                serverId: conflict.serverId,
                kind: conflict.kind,
                entryId: conflict.entryId,
                detectedAt: conflict.detectedAt,
                baseVersion: conflict.baseVersion,
                serverVersion: conflict.serverVersion,
                // ⚠️ The crushed row travels WITH the event, as it does on
                // `geoleaf:editor:feature-conflict`: a host that wants to offer "restore what
                // was there" would otherwise have to re-read the store to act on a signal it
                // just received.
                serverFeature: conflict.serverFeature,
                readOutcome: conflict.readOutcome,
                settledBy: conflict.settledBy,
            },
        })
    );
}
