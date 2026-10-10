/*!
 * @geoleaf-plugins/editor — A delivered photo's URL, written where its token stood
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * The second half of a deferred upload: once the file has reached the server, the token the
 * feature held for it becomes the URL — on the entity the device stores, and on the copy the
 * layer draws. The upload itself, and the store the file waited in, are `image-store.ts`.
 */
import { Log } from "@geoleaf/host-runtime";
import { readStoredEntity, storageFacade } from "./storage-seam.js";

/** A stored image whose upload just succeeded, reduced to its return address. */
interface DeliveredImage {
    id: string;
    layerId?: string | null;
    localId?: string | null;
    fieldPath?: string | null;
}

/** `GeoLeaf.Layers`, reduced to what the reconciliation reaches a layer's copy through. */
interface LayerCopies {
    getFeatureById?(layerId: string, id: string | number): unknown;
    patchFeature?(
        layerId: string,
        id: string | number,
        patch: Record<string, unknown>,
        opts?: { rerender?: boolean }
    ): void;
}

function _layerCopies(): LayerCopies | null {
    const g = Reflect.get(globalThis, "GeoLeaf") as { Layers?: LayerCopies } | undefined;
    return g?.Layers ?? null;
}

/**
 * Replaces an image token by the URL the server gave the file, on the owning feature.
 *
 * 🛑 A SECOND OUTBOX ENTRY, NOT AN EDIT OF THE FIRST. The create may already be in flight,
 * and rewriting an entry under a drain is how a queue loses work. An `update` is the
 * contract's own way of saying "this attribute is now that" — and while the create is still
 * `pending` or `failed` the core COALESCES the two, so the server never even sees the token.
 * ⚠️ That coalescence also resets the create's retry budget (`_rearmAbsorber`): it is the
 * behaviour we want, and it is written here so nobody rediscovers it under a drain.
 *
 * A photo whose feature was never bound cannot be reconciled — it is uploaded and kept, and
 * says so, rather than silently patching the wrong record.
 *
 * 🛑 THE TOKEN IS REPLACED WHERE IT STANDS, AND ONLY IF IT STILL STANDS THERE. The entity is
 * read first, and the edit carries the attribute's current value with this one token turned
 * into its URL. A gallery holds a list, so writing the URL onto the key would have replaced
 * the list by a string; and its entries are reordered and removed while a photo waits, so the
 * token is found by VALUE, never by position. A token the attribute no longer holds — the
 * photo was removed, or replaced, before its upload landed — is not written back at all:
 * the URL would overwrite what the user put there since.
 *
 * 🛑 AND THE LAYER'S COPY IS WRITTEN TOO ({@link _accordLayerCopy}) — once the edit is
 * accepted, never on a refusal: the copy would then be alone in holding the URL.
 *
 * @param img   - The stored image, carrying its return address.
 * @param token - The token the feature holds for it.
 * @param url   - The URL the server returned.
 * @example
 * await reconcileDeliveredImage(img, `gl-img:${img.id}`, "https://files.example/p.jpg");
 */
export async function reconcileDeliveredImage(
    img: DeliveredImage,
    token: string,
    url: string
): Promise<void> {
    if (!img.layerId || !img.localId || !img.fieldPath) {
        Log?.debug?.("[editor/image] Uploaded image has no owning feature to reconcile:", img.id);
        return;
    }
    const facade = storageFacade();
    if (!facade?.applyEdit) return;
    const entity = await readStoredEntity(img.layerId, img.localId);
    const value = _withUrl(entity?.feature?.properties?.[img.fieldPath], token, url);
    if (value === undefined) {
        Log?.debug?.("[editor/image] The owning feature no longer holds this image:", img.id);
        return;
    }
    // ⚠️ Method call on the facade, never detached: it reads `this._modules` to reach the
    // engine. The same mistake once made every offline save write nothing, silently.
    const report = await facade.applyEdit({
        layerId: img.layerId,
        kind: "update",
        localId: img.localId,
        feature: { type: "Feature", properties: { [img.fieldPath]: value } },
    });
    if (report.refused) {
        Log?.warn?.("[editor/image] Reconciling edit refused:", img.id, report.refused);
        return;
    }
    _accordLayerCopy(
        { layerId: img.layerId, fieldPath: img.fieldPath },
        [img.localId, entity?.serverId],
        token,
        url
    );
}

/**
 * Turns the token into its URL on the copy the LAYER holds of the owning feature.
 *
 * 🛑 THE STORED ENTITY IS NOT THE ONLY HOLDER OF THE TOKEN. A layer keeps its own copy of
 * every feature it draws, and a geometry commit sends that copy's attributes back. Left with
 * its tokens, a gallery holding a delivered photo AND a waiting one went back whole —
 * `dropSettledImageTokens` only leaves out a list with nothing waiting — and replaced,
 * on the stored entity and on the server, the URL by a token whose file had been purged.
 * Measured in a browser: moving the point was enough. A reload hid it, the layer being then
 * read back from the device.
 *
 * The token is replaced where it stands in THAT copy, by the rule of {@link _withUrl}: the
 * layer's value is not assumed to be the stored one, and a copy that no longer holds the
 * token is left alone.
 *
 * ⚠️ Announced (`rerender`), not silent: the layer's readers — a table, the search — hold
 * what the layer held, and nothing else would tell them the attribute changed.
 *
 * ⚠️ WHAT THIS DOES NOT REACH: a copy taken BEFORE the reconciliation and still open — a
 * feature selected in the drawing engine keeps the attributes it was picked with.
 *
 * A layer that does not hold the feature is not an error: vector tiles keep none, and a layer
 * not loaded will read the stored entity when it is.
 *
 * @param owner       - The layer, and the attribute holding the token.
 * @param identities  - The names the layer may hold the feature under: its client key, and
 *   the server's once pushed.
 * @param token       - The image token to replace.
 * @param url         - The URL to put in its place.
 */
function _accordLayerCopy(
    owner: { layerId: string; fieldPath: string },
    identities: ReadonlyArray<string | number | null | undefined>,
    token: string,
    url: string
): void {
    const layers = _layerCopies();
    if (!layers?.getFeatureById || !layers.patchFeature) return;
    for (const id of identities) {
        if (id == null) continue;
        const held = layers.getFeatureById(owner.layerId, id) as
            { properties?: Record<string, unknown> | null } | null | undefined;
        if (!held) continue;
        const value = _withUrl(held.properties?.[owner.fieldPath], token, url);
        if (value !== undefined) {
            layers.patchFeature(
                owner.layerId,
                id,
                { [owner.fieldPath]: value },
                { rerender: true }
            );
        }
        return;
    }
}

/**
 * An attribute's value with one image token turned into its URL.
 *
 * @param current     - What the attribute holds: a token, a list holding it, or anything else.
 * @param placeholder - The image token to replace.
 * @param url         - The URL to put in its place.
 * @returns the new value, or `undefined` when `current` does not hold the token.
 */
function _withUrl(current: unknown, placeholder: string, url: string): unknown {
    if (current === placeholder) return url;
    if (Array.isArray(current) && current.includes(placeholder)) {
        return current.map((entry: unknown) => (entry === placeholder ? url : entry));
    }
    return undefined;
}
