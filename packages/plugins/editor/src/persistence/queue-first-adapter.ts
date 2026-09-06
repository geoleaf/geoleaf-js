/*!
 * @geoleaf-plugins/editor — Queue-first persistence adapter
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * ONE write path: the outbox, whenever this device can hold the write and send it later.
 *
 * 🛑 **IT REPLACES `auto-adapter.ts`, AND THE DIFFERENCE IS THE DECISION RULE, NOT THE
 * SHAPE.** That adapter chose by REACHABILITY: a HEAD ping, then REST, then — on a
 * transport failure only — the queue. Three consequences, each measured:
 *
 *  1. **A duplicate nobody can detect.** The online path put NO client identity on the wire
 *     (no `local_id`, no `Idempotency-Key`), while the core's drain does. A response lost
 *     after an accepted POST is a transport failure, so the edit fell back into the queue
 *     and was replayed — with an identity the first request never carried. The server had
 *     no key to recognise it.
 *  2. **Two protocols for one contract.** REST spoke the plugin's envelope to
 *     `modules.editor.api.baseUrl`; the drain speaks the layer's `write.dialect` to
 *     `write.endpoint`. Which one a capture met depended on whether the radio answered.
 *  3. **The fallback was invisible.** Nothing said a write had just changed protocol.
 *
 * Here the question is asked BEFORE the write and it is about capability, not weather:
 * `GeoLeaf.Storage.canQueueWrites(layerId)` — "can this device HOLD the write?". Yes → the
 * queue, always, online or not, and the drain sends it. No → the online adapter, because
 * without a local store there is nowhere to hold anything.
 *
 * ⚠️ **That predicate asked "can the DRAIN PUSH it?" in a first draft, and the E2E suite
 * refuted it on the shipped bundle.** Deliverables have their write endpoints stripped
 * (DNS-05), so nothing was holdable on the demo and an offline save stopped reaching the
 * outbox. Holding beats losing: a held capture is visible, counted by the sync banner, and
 * eventually set aside with a named motive; one sent to a dead endpoint is simply gone.
 *
 * ⚠️ **THE ONLINE PATH IS NOT A FALLBACK — IT IS A DIFFERENT DEPLOYMENT.** It is reached
 * when the offline capability is off (it is opt-in), or when the profile does not carry the
 * layer at all. Never because the network blinked. That distinction is what removes the duplicate: a write never changes path
 * mid-flight.
 */

import { Log } from "@geoleaf/host-runtime";
import { storageFacade } from "./storage-seam.js";
import type {
    EditorFeature,
    EditorPersistenceAdapter,
    UpdateOptions,
} from "./adapter-interface.js";

/**
 * Can the core hold a write to this layer?
 *
 * ⚠️ The absence of the predicate means NO: an older core, or the offline capability simply
 * not enabled. Treating "cannot ask" as "yes" would queue into a store that does not exist.
 *
 * @param layerId - The layer being written to.
 * @param warned - Layers already reported, held BY ADAPTER rather than by module: a fresh
 *   adapter is a fresh boot, and it owes the operator the warning again. A module-level set
 *   would also have needed a reset seam exported for tests alone.
 */
function _queueable(layerId: string, warned: Set<string>): boolean {
    const can = storageFacade()?.canQueueWrites?.(layerId);
    if (can === true) return true;
    if (!warned.has(layerId)) {
        warned.add(layerId);
        // 🛑 SAID ONCE, AND SAID AT ALL. Before this, a layer without a `write` block simply
        // produced a quarantined entry per capture — the loss was visible only to whoever
        // opened IndexedDB. Naming the layer at the first write is the cheapest thing that
        // turns a silent misconfiguration into a question someone can answer.
        Log?.warn?.(
            `[editor/persistence] "${layerId}" ne peut pas être tenue localement : ` +
                "la capacité `offline` est absente, ou le profil ne porte pas cette couche. " +
                "Les écritures partent en direct, donc une coupure les perd."
        );
    }
    return false;
}

/** Configuration for {@link createQueueFirstAdapter}. */
interface QueueFirstOptions {
    /** The outbox path — the core's optimistic write cycle. */
    queue: EditorPersistenceAdapter;
    /** The direct path, for layers this device cannot hold. */
    online: EditorPersistenceAdapter;
}

/**
 * Creates an adapter that queues whenever the core can carry the layer's writes.
 *
 * @param opts - The two backends.
 * @returns The routing adapter.
 */
export function createQueueFirstAdapter(opts: QueueFirstOptions): EditorPersistenceAdapter {
    const warned = new Set<string>();
    const pick = (layerId: string) => (_queueable(layerId, warned) ? opts.queue : opts.online);
    return {
        save: (feature: EditorFeature, layerId: string) => pick(layerId).save(feature, layerId),
        update: (feature: EditorFeature, layerId: string, updateOpts?: UpdateOptions) =>
            pick(layerId).update(feature, layerId, updateOpts),
        delete: (featureId: string, layerId: string) => pick(layerId).delete(featureId, layerId),
        // ⚠️ Reports the NETWORK, not the routing: callers use it to decide what to show a
        // user, and a queue-first adapter claiming to be "online" because it can queue would
        // tell them the opposite of the truth.
        isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine),
    };
}
