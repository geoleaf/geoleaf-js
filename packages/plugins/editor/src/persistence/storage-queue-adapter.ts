/*!
 * @geoleaf-plugins/editor — Storage-queue persistence adapter (offline)
 * © 2026 Mattieu Pottier — MIT License
 *
 * Offline backend: write-through to the core's optimistic write cycle
 * (`GeoLeaf.Storage.applyEdit`), which writes the entity and its outbox entry in ONE
 * transaction. Replaying on reconnect is owned by {@link ./editor-sync-replay}, which
 * delegates to the core drain — not by addpoi's handler.
 *
 * ⚠️ **This header described the v3 queue until 04/08/2026**, and it had been
 * false for a while: "write-through to the shared IndexedDB sync queue
 * (`addToSyncQueue`) […] stores a generic editor envelope under the entry
 * `payload`". Neither `addToSyncQueue`, nor the `payload` envelope, nor the
 * queue sharing with `addpoi` exist any more. Prose outlives code because no
 * gate can read it: a sentence's TRUTH has no verifier, and never will.
 *
 * The Storage façade is read at call time (`globalThis.GeoLeaf.Storage`), never
 * imported — importing it would bundle a dead copy with no live `.DB`.
 * https://geoleaf.dev
 */
import { _getLabel } from "../internal.js";
import { storageFacade } from "./storage-seam.js";
import {
    PersistenceError,
    type EditorFeature,
    type EditorPersistenceAdapter,
    type SavedFeature,
} from "./adapter-interface.js";
import { dispatchEditorEvent } from "../editor-events.js";
import { claimImages } from "./image-store.js";

/** Emits `geoleaf:editor:feature-sync-queued` once an entry is persisted. */
function _dispatchQueued(kind: string, layerId: string, entryId: string): void {
    dispatchEditorEvent("geoleaf:editor:feature-sync-queued", { kind, layerId, entryId });
}

/**
 * Enqueues ONE operation, through the core's write point.
 *
 * 🛑 **THE SECOND VOCABULARY DISAPPEARS HERE.** This plugin stacked
 * `editor.save` / `editor.update` / `editor.delete` under a `payload` key,
 * while `addpoi` stacked `add_poi*` under a `poiData` key, **in the same v3
 * queue**. Two vocabularies that never met: `poi-restore` knew only one and
 * discarded the other as "foreign" — so a geometry drawn off-network **was
 * never re-displayed**. The contract freezes `SyncOperationKind` precisely for
 * that, entity-generic because the store is.
 *
 * ⚠️ **Nothing is refused here.** The editability guard and the geometry guard
 * live in the core, the only place reading the layer declaration. Refusing an
 * already-made capture would be losing it.
 *
 * @param kind - The operation, in the contract's vocabulary.
 * @param layerId - Host layer.
 * @param localId - Entity identity; absent for a create, which the core mints.
 * @param feature - The edited entity. Absent for a delete.
 * @returns The queue entry's identifier.
 * @throws When the storage engine is absent, or the core refuses the edit.
 */
async function _enqueue(
    kind: "create" | "update" | "delete",
    layerId: string,
    localId: string | undefined,
    feature?: EditorFeature
): Promise<string> {
    // 🛑 THE RECEIVER IS MANDATORY, AND ITS ABSENCE WAS THE DEFECT.
    //
    // This body did `const applyEdit = facade?.applyEdit` then `applyEdit({…})` —
    // a DETACHED call. The core's facade is not a closure: `applyEdit` reads
    // `this._modules` there to reach the engine. Without a receiver, `this` is
    // `undefined` and the call throws
    // `TypeError: Cannot read properties of undefined (reading '_modules')`.
    //
    // ⚠️ The typecheck cannot catch it: this plugin **redeclares** the surface it
    // expects (INV-NS forbids it to import the core's sources), and a redeclared
    // method loses the `this` constraint the core expresses. Same family as this
    // work's root cause no. 1 — a plugin green against its own fiction of the
    // global.
    //
    // Measured: the offline save closed its modal, wrote NOTHING, and did not
    // emit `geoleaf:editor:feature-sync-queued`. The rejection went to
    // `unhandledrejection`, hence no user notification — a field capture lost
    // silently.
    const facade = storageFacade();
    if (!facade?.applyEdit) {
        throw new PersistenceError("network", _getLabel("editor.error.storageUnavailable"));
    }
    const report = await facade.applyEdit({
        layerId,
        kind,
        ...(localId !== undefined && { localId }),
        ...(feature && {
            feature: {
                type: "Feature",
                geometry: feature.geometry,
                properties: feature.properties,
            },
        }),
    });
    if (report.refused) {
        // 🛑 A PERMISSION REFUSAL IS NOT A NETWORK OUTAGE.
        //
        // This line typed EVERY refusal as `"network"`, `deleteNotPermitted` and
        // `layerNotEditable` included. The removed `auto-adapter._isTransportError`
        // treated `"network"` as **retryable**: the refusal was presented as a
        // connectivity problem, i.e. as something that will work at the next
        // attempt. It never will, and the write went back into the queue on
        // every try. ⚠️ That adapter is gone (R7), and the typing still decides how the
        // CORE's drain treats the refusal — the split below keeps its subject.
        //
        // ⚠️ The split follows what the motive SAYS, not its shape:
        // `engineUnavailable` and `malformedEdit` are not permission refusals
        // and keep their type.
        const isPermissionRefusal =
            report.refused === "deleteNotPermitted" ||
            report.refused === "layerNotEditable" ||
            report.refused === "layerUnknown";
        throw new PersistenceError(
            isPermissionRefusal ? "forbidden" : "network",
            `editor: edit refused (${report.refused})`
        );
    }
    const entryId = report.entryId ?? "";
    // 🛑 THE PHOTOS ARE BOUND TO THEIR FEATURE HERE, AND NOWHERE EARLIER. A capture happens
    // while the form is open, BEFORE the entity exists: off-network its client identity is
    // only minted by this very call. Until now the stored image knew its field and not its
    // feature — so the upload that eventually succeeded had nowhere to send the resulting
    // URL back to, and that URL was simply dropped.
    if (feature && report.localId) {
        await claimImages(feature.properties, layerId, report.localId);
    }
    _dispatchQueued(kind, layerId, entryId);
    // 🛑 ASK FOR A DRAIN NOW — this is what makes "everything goes through the queue"
    // cost nothing when the network is there. Without it, a capture made in coverage
    // would sit until the next trigger (a network transition, a tab wake-up, or up to a
    // minute of the retry tick), and the queue-first routing would read as a regression:
    // "it used to leave immediately".
    //
    // ⚠️ Fire-and-forget, deliberately: awaiting it would tie the form's closing latency
    // to the network, which is the very coupling the outbox exists to break. The drain
    // serialises itself, so a burst of captures produces one pass, not one per capture.
    storageFacade()?._requestOutboxDrain?.("write");
    return entryId;
}

/**
 * Optimistic {@link SavedFeature} echoed back to the caller. Offline we have no
 * server id, so we keep the local id — enough for host-reconcile to commit the
 * geometry to the host layer; the real id arrives when the queue is flushed.
 */
function _optimisticSaved(feature: EditorFeature, layerId: string): SavedFeature {
    return {
        id: feature.id ?? "",
        layerId,
        geometry: feature.geometry,
        properties: feature.properties,
    };
}

/**
 * Creates an offline {@link EditorPersistenceAdapter} that write-throughs to the core's
 * write cycle. `isOnline()` is always `false`: this adapter never reaches the backend
 * directly — {@link ./queue-first-adapter} decides when to use it, and the core's own drain
 * triggers empty the queue.
 *
 * ⚠️ This doc named `./auto-adapter` until R7 removed that file: it chose by REACHABILITY and
 * fell back here on a transport error, which is how a lost response after an accepted POST
 * became a duplicate. The routing now asks a capability question before the write.
 */
export function createStorageQueueAdapter(): EditorPersistenceAdapter {
    return {
        async save(feature: EditorFeature, layerId: string): Promise<SavedFeature> {
            await _enqueue("create", layerId, feature.id, feature);
            return _optimisticSaved(feature, layerId);
        },

        async update(feature: EditorFeature, layerId: string): Promise<SavedFeature> {
            await _enqueue("update", layerId, feature.id, feature);
            return _optimisticSaved(feature, layerId);
        },

        async delete(featureId: string, layerId: string): Promise<void> {
            await _enqueue("delete", layerId, featureId);
        },

        isOnline(): boolean {
            return false;
        },
    };
}
