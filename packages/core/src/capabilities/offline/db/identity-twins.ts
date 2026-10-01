/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The v7 repair: merges the twin records the identity defect left on a device.
 *
 * 🛑 THE STOCK. Until 3.4.0, modifying an EXISTING entity through the queue wrote a SECOND
 * record for it — keyed by the bare server id, with `serverId: null` — beside the one the pull
 * left under `srv:<id>`. The producer is closed since then (an edit resolves the entity to its
 * store key, `local-edit.ts`), but a device that edited before keeps the pair: the layer draws
 * the entity twice. No pull merges them — `null` is not a key the `serverId` index holds, so the
 * pull never finds the twin, and the sweep of a complete pull skips it as unsynchronised work.
 *
 * A stock and not a flow, so one pass at the upgrade: its version-change transaction covers
 * `features` AND `outbox`, which a pull does not — and "which twin does the queue name?" is
 * the question the rule turns on.
 *
 * The rule, arbitrated on 27/09/2026:
 *  - the twin carrying work (not `synced`, or named by an outbox entry) is KEPT, and gets back
 *    the server identity the defect dropped; the record without work goes;
 *  - neither carrying work: the pull's record stays, the bare twin goes;
 *  - both carrying work: nothing is removed — two captures are never merged blind — and it is
 *    logged.
 *
 * @version 3.12.0
 */

import { Log } from "../../../utils/log/index.js";
import { CLIENT_KEY_PREFIX, SERVER_KEY_PREFIX } from "./local-edit.js";
import { guarded, spare } from "./upgrade-guards.js";

/** A `features` record, reduced to what the repair reads. */
interface TwinCandidate {
    layerId: string;
    localId: string;
    serverId: string | null;
    syncState?: string;
    [key: string]: unknown;
}

/** What {@link planTwinMerge} decided. */
interface TwinPlan {
    /** Records to rewrite — a kept twin with its server identity back. */
    puts: TwinCandidate[];
    /** Keys (`[layerId, localId]`) of the records to remove. */
    deletes: [string, string][];
    /** Server ids whose twins both carry work, left as they are. */
    undecided: string[];
}

/** The key an outbox entry and a record share. */
const keyOf = (layerId: string, localId: string): string => `${layerId}\u0000${localId}`;

/**
 * Decides, for every twin pair of the store, which record stays. Pure: it reads the records and
 * the keys the outbox names, and returns the writes.
 *
 * A twin is a record keyed by a BARE id — neither a client key nor a pull key — whose server
 * identity is absent or that same id, while another record of the SAME layer carries that id as
 * its server identity. A bare key alone is not a twin: it is left as it is.
 *
 * @param records - Every record of the `features` store.
 * @param named - The `[layerId, localId]` keys the outbox names, as built by `keyOf`.
 * @returns The writes to apply, and the pairs left undecided.
 */
function planTwinMerge(records: TwinCandidate[], named: Set<string>): TwinPlan {
    const plan: TwinPlan = { puts: [], deletes: [], undecided: [] };
    const bySid = new Map<string, TwinCandidate[]>();
    for (const r of records) {
        if (r.serverId == null) continue;
        const k = keyOf(r.layerId, String(r.serverId));
        bySid.set(k, [...(bySid.get(k) ?? []), r]);
    }
    const carriesWork = (r: TwinCandidate) =>
        r.syncState !== "synced" || named.has(keyOf(r.layerId, r.localId));

    for (const twin of records) {
        const bare = String(twin.localId);
        if (bare.startsWith(CLIENT_KEY_PREFIX) || bare.startsWith(SERVER_KEY_PREFIX)) continue;
        if (twin.serverId != null && String(twin.serverId) !== bare) continue;
        const others = (bySid.get(keyOf(twin.layerId, bare)) ?? []).filter((r) => r !== twin);
        if (others.length === 0) continue;

        if (carriesWork(twin) && others.some(carriesWork)) {
            plan.undecided.push(`${twin.layerId}/${bare}`);
        } else if (carriesWork(twin)) {
            plan.puts.push({ ...twin, serverId: bare });
            for (const o of others) plan.deletes.push([o.layerId, o.localId]);
        } else {
            plan.deletes.push([twin.layerId, twin.localId]);
        }
    }
    return plan;
}

/** How the log names this step. */
const STEP = "v7 repair";

/**
 * Applies {@link planTwinMerge} inside the version-change transaction. Never throws and never
 * aborts: a rejected upgrade leaves the whole database unopenable, which is far worse than a
 * twin drawn twice — a failed read or write is logged, its error event cancelled (uncancelled,
 * it aborts the transaction), and the upgrade goes on with the twins it could not merge.
 *
 * @param tx - The upgrade's version-change transaction.
 * @example
 * const request = indexedDB.open("geoleaf-db", 7);
 * request.onupgradeneeded = (e) => {
 *     if (e.oldVersion >= 4 && request.transaction) mergeIdentityTwins(request.transaction);
 * };
 */
export function mergeIdentityTwins(tx: IDBTransaction): void {
    const features = tx.objectStore("features");
    const readRecords = features.getAll();
    spare(readRecords, STEP, "read features");
    readRecords.onsuccess = guarded(STEP, () => {
        const readQueue = tx.objectStore("outbox").getAll();
        spare(readQueue, STEP, "read the outbox");
        readQueue.onsuccess = guarded(STEP, () => {
            const entries = (readQueue.result ?? []) as { layerId: string; localId: string }[];
            const named = new Set(entries.map((e) => keyOf(e.layerId, e.localId)));
            const plan = planTwinMerge((readRecords.result ?? []) as TwinCandidate[], named);
            for (const r of plan.puts)
                spare(features.put(r), STEP, `write ${r.layerId}/${r.localId}`);
            for (const key of plan.deletes)
                spare(features.delete(key), STEP, `remove ${key.join("/")}`);
            if (plan.puts.length + plan.deletes.length > 0) {
                Log.info(
                    `[StorageDB] v7 repair: ${plan.deletes.length} twin record(s) removed, ` +
                        `${plan.puts.length} given back their server identity`
                );
            }
            if (plan.undecided.length > 0) {
                Log.warn(
                    `[StorageDB] v7 repair: both twins carry work, left as they are: ` +
                        plan.undecided.join(", ")
                );
            }
        });
    });
}
