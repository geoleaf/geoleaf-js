/*!
 * @geoleaf-plugins/editor — Layer edition permission gate
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * @description
 * The layer permission, applied BEFORE the path choice.
 *
 * ## What was measured, and why one guard suffices
 *
 * 🛑 **The permission was only applied OFFLINE.** `applyEdit` (core) refuses on
 * `edition.{create,update,delete}`, but it is only reached when the network is
 * absent. Connected, `rest-adapter.ts` emits an **unconditional** `DELETE`: a
 * layer declaring `edition.delete: false` stayed deletable as soon as there
 * was network.
 *
 * ⚠️ **And placing it in `auto-adapter._route` would not have sufficed.**
 * `createPersistenceAdapter` returns the **bare** REST adapter in
 * `persistence.mode: "online"` — without ever building the auto adapter. A
 * guard set in the routing would thus have left the most exposed mode entirely
 * open. It sits here, as a decorator of the only object **all** modes cross.
 *
 * ## Why this is not just a label
 *
 * The refusal throws `PersistenceError("forbidden")`, and `_isTransportError`
 * (`auto-adapter.ts`) only knows `"network"` and `"timeout"`. A permission
 * refusal therefore does **not** fall back into the queue: the half that
 * matters. Typed `"network"` as before, it would have been presented as
 * retryable and requeued — a write that can never succeed, retried
 * indefinitely.
 *
 * ## Absent means REFUSED, the predicate itself included
 *
 * ⚠️ When the facade cannot answer (`GeoLeaf.Storage` absent, or without
 * `mayEdit`), the guard **refuses**. The rule `LayerEditionPermissions` already
 * sets for the keys — "declaring is not granting, absent means refused" —
 * extended to the case where the declaration cannot be read. The opposite
 * would make every assembly failure a silent authorisation, i.e. would bring
 * the authorisation hole back with nothing turning red.
 *
 * 🛑 **Assumed consequence for test doubles**: a suite mounting
 * `GeoLeaf.Storage = { applyEdit }` without `mayEdit` gets refused. Intended —
 * an incomplete double is "a plugin green against its own fiction of the
 * global", this work's root cause no. 1. The doubles now declare the
 * predicate.
 */
import { _getLabel } from "../internal.js";
import { storageFacade } from "./storage-seam.js";
import {
    PersistenceError,
    type EditorFeature,
    type EditorPersistenceAdapter,
    type UpdateOptions,
} from "./adapter-interface.js";

/** The submitted operation, in the sync contract's vocabulary. */
type EditKind = "create" | "update" | "delete";

/**
 * Refuses the operation when the layer does not grant it.
 *
 * @param layerId - Host layer targeted by the write.
 * @param kind - The submitted operation.
 * @throws {PersistenceError} `kind: "forbidden"` when the layer refuses, or the
 *   facade cannot be queried.
 */
function _assertPermitted(layerId: string, kind: EditKind): void {
    const facade = storageFacade();
    if (typeof facade?.mayEdit !== "function") {
        throw new PersistenceError(
            "forbidden",
            `editor: cannot check edition permission for "${layerId}" — GeoLeaf.Storage.mayEdit ` +
                `is unavailable. Refusing rather than assuming the layer grants ${kind}.`
        );
    }
    // Receiver kept — `facade.mayEdit(...)` and NOT a detached call. The core's
    // facade is not a closure, and this is the detached-call class (cf.
    // `storage-queue-adapter`).
    if (!facade.mayEdit(layerId, kind)) {
        throw new PersistenceError("forbidden", _getLabel("editor.error.editionNotPermitted"), {});
    }
}

/**
 * Wraps a persistence adapter in a layer-permission guard.
 *
 * Applied by `adapter-factory.ts` to **every** mode (`online`, `offline`,
 * `auto`, `collection` dialect), so the permission no longer depends on the
 * path taken.
 *
 * ⚠️ **Does NOT wrap the replay's adapter.** `createOnlineAdapter` stays bare
 * for `editor-sync-replay.ts`: an already-queued entry passed the guard at
 * enqueue time, and a layer since become unwritable falls under the core's
 * **quarantine** (`layerNoLongerWritable`), not an on-the-fly drain refusal.
 *
 * @param inner - The concrete adapter to protect.
 * @returns The same contract, refusing what the layer does not grant.
 */
export function withEditionPermissions(inner: EditorPersistenceAdapter): EditorPersistenceAdapter {
    // 🛑 ALL THREE METHODS ARE `async`, AND THAT IS NOT COSMETIC.
    //
    // `_assertPermitted` throws SYNCHRONOUSLY. Without `async`, the refusal
    // would surface as an exception instead of a rejected promise — yet the
    // contract (`EditorPersistenceAdapter`) says "Every method rejects with a
    // PersistenceError on failure", and a caller writing
    // `adapter.save(…).catch(…)` without `await` would see the exception cross
    // its `.catch`. Measured: this decorator's first draft did exactly that,
    // and the guard caught it on the first run.
    return {
        async save(feature: EditorFeature, layerId: string) {
            _assertPermitted(layerId, "create");
            return inner.save(feature, layerId);
        },
        async update(feature: EditorFeature, layerId: string, opts?: UpdateOptions) {
            _assertPermitted(layerId, "update");
            return inner.update(feature, layerId, opts);
        },
        async delete(featureId: string, layerId: string) {
            _assertPermitted(layerId, "delete");
            return inner.delete(featureId, layerId);
        },
        isOnline: () => inner.isOnline(),
    };
}
