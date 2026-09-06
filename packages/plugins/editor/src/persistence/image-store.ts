/*!
 * @geoleaf-plugins/editor — Offline-capable image upload
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * The "stateful" half of the image chain, absorbed from `addpoi`.
 *
 * The **pure** half — adaptive compression and resizing — lives in
 * `@geoleaf/field-renderer` (`types/image-compress.ts`), which applies it
 * before calling the transport. This module is that transport: it tries the
 * network, and **falls back to local storage** when the network is missing. It
 * pulls IndexedDB and the core's CSRF token, which a field-rendering library
 * has no business knowing how to do.
 *
 * 🛑 **IT PLUGS IN BY STRATEGY, NOT COMPONENT OVERRIDE.** `addpoi` registered
 * an `"addpoi-image"` of **229 lines to change 4 calls**, of which ~225
 * re-implemented a component `field-renderer` already carries.
 * `setImageUploadStrategy` replaces all of it.
 */
import { Log } from "@geoleaf/host-runtime";
import { setImageUploadStrategy, setImagePreviewResolver } from "@geoleaf/field-renderer";
import { storageFacade } from "./storage-seam.js";

/** The core's image store, read at call time — the plugin does not depend on `offline-ui`. */
interface ImagesDb {
    storeImageLocally?(data: unknown): Promise<unknown>;
    getPendingImages?(): Promise<unknown>;
    /**
     * ⚠️ **`status` IS AN OBJECT, and this line said `string`.** The core reads
     * `status.uploaded` and `status.url`; this plugin passed the literal `"uploaded"`.
     * `("uploaded").uploaded` is `undefined`, so the record came back written as still
     * pending and the server URL was never stored — the same photo left again on every
     * reconnection and every boot, and the purge (a cursor over the index at `1`) found
     * nothing to reclaim, forever. Three layers declared it loose and none of them could
     * complain: this interface, the core's relay, and `DBModuleAPI`'s index signature.
     */
    updateImageUploadStatus?(
        id: string,
        status: { uploaded: boolean; url?: string }
    ): Promise<unknown>;
    /** Reads one stored image back, for the preview — see {@link _resolveImagePreview}. */
    getLocalImage?(id: string): Promise<unknown>;
    /** Records which feature an image belongs to — see {@link claimImages}. */
    bindLocalImage?(id: string, owner: { layerId: string; localId: string }): Promise<unknown>;
    /** Reclaims the space of entries the server has acknowledged. See {@link retryPendingImages}. */
    cleanUploadedImages?(): Promise<unknown>;
}

/**
 * Prefix of the stable token a locally-stored image is represented by.
 *
 * 🛑 A TOKEN, AND NO LONGER A DATA-URL. The base64 of the photo used to be written straight
 * into the feature's attribute, so it travelled to the server inside the create — a
 * multi-megabyte string in a text column — while the real upload's URL, obtained later, was
 * discarded. The token is a few bytes, it survives a reload, and it is what the
 * reconciliation replaces once the file has genuinely been delivered.
 */
const _TOKEN_PREFIX = "gl-img:";

/**
 * @param value - Any attribute value.
 * @returns the image id inside a token, or `null` when the value is not one.
 */
function _imageIdOfToken(value: unknown): string | null {
    if (typeof value !== "string" || !value.startsWith(_TOKEN_PREFIX)) return null;
    const id = value.slice(_TOKEN_PREFIX.length);
    return id === "" ? null : id;
}

function _imagesDb(): ImagesDb | null {
    const g = Reflect.get(globalThis, "GeoLeaf") as
        | { Storage?: { DB?: ImagesDb }; Security?: { CSRFToken?: { getToken?(): string | null } } }
        | undefined;
    return g?.Storage?.DB ?? null;
}

function _csrfToken(): string | null {
    const g = Reflect.get(globalThis, "GeoLeaf") as
        { Security?: { CSRFToken?: { getToken?(): string | null } } } | undefined;
    return g?.Security?.CSRFToken?.getToken?.() ?? null;
}

/** A pending image, as `getPendingImages` returns it. */
interface PendingImage {
    id: string;
    blob: Blob;
    filename?: string;
    /** `null` when the field declared no `uploadEndpoint` — display only, never retried. */
    endpoint?: string | null;
    layerId?: string | null;
    localId?: string | null;
    fieldPath?: string | null;
}

/**
 * Uploads to the server, CSRF token included.
 *
 * ⚠️ `fetch` and not `XMLHttpRequest` — `addpoi` used XHR for its **progress
 * bar**, which `field-renderer`'s component does not display. Porting XHR would
 * have carried 60 lines for an indicator nothing reads.
 *
 * @param file     - File to send.
 * @param endpoint - POST endpoint.
 * @returns the URL the server returned.
 */
async function _postToServer(file: File, endpoint: string): Promise<string> {
    const form = new FormData();
    form.append("file", file);
    const token = _csrfToken();
    const res = await fetch(endpoint, {
        method: "POST",
        body: form,
        ...(token && { headers: { "X-CSRF-Token": token } }),
    });
    if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`);
    const data = (await res.json()) as { url?: string; path?: string };
    const url = data.url ?? data.path;
    if (!url) throw new Error("Upload response carried no url");
    return url;
}

/**
 * Convertit un fichier en data-URL base64.
 *
 * @param file - File to read.
 * @returns the data-URL, or an empty string when the read yields no text.
 */
function _toDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
        reader.onerror = () => reject(new Error("form.error.imageRead"));
        reader.readAsDataURL(file);
    });
}

/**
 * Sets the image aside locally and returns an **immediately displayable** URL.
 *
 * Writes two things, and both count: a data-URL returned to the caller, so the
 * preview paints without re-reading the database; and the database record, so
 * the retry can upload it later.
 *
 * ⚠️ **`uploaded: 0`, NEVER `false`** — a boolean is not a valid IndexedDB key,
 * and the store carries an `uploaded` index: a record written with `false`
 * stays **out** of that index, hence invisible to `getPendingImages()`, hence
 * never uploaded and never cleaned. The defect fixed once in `addpoi`; it does
 * not get reintroduced here.
 *
 * ⚠️ **`crypto.randomUUID()`, never `Math.random()`**: this identifier is a
 * field photo's primary key, and a collision overwrites a capture.
 *
 * @param file      - File to keep.
 * @param endpoint  - Endpoint to retry later, or `null` when the field declared none.
 * @param fieldPath - Schema path of the field holding the token, so the upload that
 *   eventually succeeds knows which attribute to reconcile.
 * @returns a stable token, or a data-URL when the store could not be reached.
 */
export async function storeImageLocally(
    file: File,
    endpoint: string | null,
    fieldPath?: string
): Promise<string> {
    const db = _imagesDb();
    const id = `image_${crypto.randomUUID()}`;
    if (db?.storeImageLocally) {
        try {
            await db.storeImageLocally({
                id,
                blob: file,
                filename: file.name,
                type: file.type,
                size: file.size,
                timestamp: Date.now(),
                endpoint,
                ...(fieldPath !== undefined && { fieldPath }),
                uploaded: 0,
            });
            return `${_TOKEN_PREFIX}${id}`;
        } catch (e) {
            Log?.warn?.("[editor/image] Local image store failed, falling back to a data-URL:", e);
        }
    }
    // 🛑 THE DATA-URL IS NOW THE FALLBACK, NOT THE RETURN VALUE. It used to be handed back
    // always, so the base64 of the photo went into the feature's attribute and travelled to
    // the server inside the create. It survives here for the one case where the store is
    // unreachable: losing the capture to protect a queue would be the wrong arbitration on a
    // field device — but the capture is then unreconcilable, which is why it is a last resort.
    return _toDataUrl(file);
}

/**
 * Binds every image token found in a feature's properties to that feature.
 *
 * 🛑 WHY THIS RUNS AT SAVE TIME AND NOT AT CAPTURE TIME. A photo is taken while the form is
 * open, BEFORE the feature exists: off-network the client identity is only minted when the
 * edit is enqueued. Until then the stored image knows its field but not its feature — and an
 * image with no feature is one whose upload has nowhere to send the resulting URL back to,
 * which is precisely why that URL used to be discarded.
 *
 * Failures are swallowed on purpose: a save must not be lost because a photo could not be
 * bound. The photo stays, unreconciled, and says so at the next retry.
 *
 * @param properties - The values submitted with the feature.
 * @param layerId    - Layer the feature belongs to.
 * @param localId    - Client identity the core minted for it.
 * @example
 * await claimImages(feature.properties, "candelabres", report.localId);
 */
export async function claimImages(
    properties: Record<string, unknown> | undefined,
    layerId: string,
    localId: string
): Promise<void> {
    const db = _imagesDb();
    if (!properties || !db?.bindLocalImage || !layerId || !localId) return;
    for (const value of Object.values(properties)) {
        // A gallery holds several; a single image holds one. Both are walked the same way.
        for (const candidate of Array.isArray(value) ? value : [value]) {
            const imageId = _imageIdOfToken(candidate);
            if (!imageId) continue;
            try {
                await db.bindLocalImage(imageId, { layerId, localId });
            } catch (e) {
                Log?.debug?.("[editor/image] Could not bind image to its feature:", imageId, e);
            }
        }
    }
}

/**
 * The upload strategy: network first, local storage as backup.
 *
 * @param file      - File already validated and compressed by `field-renderer`.
 * @param endpoint  - The field's POST endpoint, or `null` when it declared none.
 * @param fieldPath - Schema path of the field, forwarded to the local store.
 * @returns the server URL, or a stable token when the file was kept locally.
 */
export async function uploadImage(
    file: File,
    endpoint: string | null,
    fieldPath?: string
): Promise<string> {
    // ⚠️ NO ENDPOINT AT ALL — the field declared no `uploadEndpoint`. The library's own
    // fallback wrote an object URL into the attribute, which dies with the document: the
    // photo was gone at the next reload, and anything sent to a server was a string
    // designating nothing. Storing it under a token is not a smaller loss, it is none: the
    // record is kept with `endpoint: null`, displayed from the store, and NEVER retried —
    // a state that must stay distinguishable from "the endpoint was lost".
    if (!endpoint) return storeImageLocally(file, null, fieldPath);
    if (typeof navigator !== "undefined" && !navigator.onLine) {
        Log?.debug?.("[editor/image] Offline — storing locally");
        return storeImageLocally(file, endpoint, fieldPath);
    }
    try {
        return await _postToServer(file, endpoint);
    } catch (e) {
        Log?.warn?.("[editor/image] Upload failed, storing locally for retry:", e);
        return storeImageLocally(file, endpoint, fieldPath);
    }
}

/** A retry's tally. */
export interface RetryReport {
    attempted: number;
    uploaded: number;
    failed: number;
    /**
     * Images deliberately not attempted, because their field declared no upload endpoint.
     *
     * ⚠️ Counted SEPARATELY from `failed`, and that separation is the point: for a long time
     * a record whose `endpoint` had been LOST — dropped by the core, which did not persist
     * the field — was skipped by the same silent `continue` as one that never had a
     * destination. The loud case hid behind the quiet one, and the retry reported
     * `{attempted: 0}` while every photo waited forever.
     */
    skipped: number;
}

let _retrying = false;

/**
 * Decides whether one pending image can be retried, and counts it when it cannot.
 *
 * 🛑 TWO REASONS TO SKIP, AND THEY MUST NOT LOOK ALIKE. `endpoint: null` is a field that
 * declared no `uploadEndpoint` — expected, permanent, silent beyond a tally. `endpoint`
 * MISSING on a record that should carry one is a defect, and it is the one that cost the
 * whole mechanism: the core did not persist the field, so `if (!img.endpoint) continue`
 * skipped EVERY image and the retry became a complete no-op — while reporting success.
 *
 * @param img    - The stored image.
 * @param report - Tally to increment.
 * @returns whether the caller should attempt an upload.
 */
function _isRetryable(img: PendingImage, report: RetryReport): boolean {
    if (!img?.blob) return false;
    if (img.endpoint === null) {
        report.skipped += 1;
        return false;
    }
    if (!img.endpoint) {
        report.skipped += 1;
        Log?.warn?.(
            "[editor/image] Stored image carries no endpoint and cannot be uploaded:",
            img.id
        );
        return false;
    }
    return true;
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
 * @param img - The stored image, carrying its return address.
 * @param url - The URL the server returned.
 */
async function _reconcile(img: PendingImage, url: string): Promise<void> {
    if (!img.layerId || !img.localId || !img.fieldPath) {
        Log?.debug?.("[editor/image] Uploaded image has no owning feature to reconcile:", img.id);
        return;
    }
    const facade = storageFacade();
    if (!facade?.applyEdit) return;
    // ⚠️ Method call on the facade, never detached: it reads `this._modules` to reach the
    // engine. The same mistake once made every offline save write nothing, silently.
    const report = await facade.applyEdit({
        layerId: img.layerId,
        kind: "update",
        localId: img.localId,
        feature: { type: "Feature", properties: { [img.fieldPath]: url } },
    });
    if (report.refused) {
        Log?.warn?.("[editor/image] Reconciling edit refused:", img.id, report.refused);
    }
}

/**
 * Gives back to the store the space of images the server just acknowledged.
 *
 * Extracted from {@link retryPendingImages} for the sole reason that inlining
 * it pushed its complexity from 20 to 25 — the repo's limit is 20, and working
 * around it with a disable comment would have been the gesture this repo
 * forbids on ESLint rules: a lowering with no written motive next to it is
 * indistinguishable from an oversight six months later.
 *
 * 🛑 **Two invariants, each proven by its own test case**: the purge is only
 * attempted when **at least one** image was acknowledged — otherwise every
 * empty retry would open a `readwrite` transaction to delete nothing — and
 * **its failure does not bubble up**. The bytes stay, they will go again at the
 * next acknowledgement; losing the retry over a cleanup defect would be the
 * wrong arbitration on a field device.
 *
 * @param db - The core's image store, as {@link _imagesDb} returns it.
 * @param report - The tally of the retry that just finished.
 */
async function _purgeAcknowledged(db: ImagesDb, report: RetryReport): Promise<void> {
    if (report.uploaded === 0 || !db.cleanUploadedImages) return;
    try {
        await db.cleanUploadedImages();
    } catch (e) {
        Log?.debug?.("[editor/image] Purge of uploaded images failed:", e);
    }
}

/**
 * Re-uploads the images left pending.
 *
 * 🛑 **THIS FUNCTION EXISTS BECAUSE `addpoi` HAD ONE WITH NO CALLER.** There,
 * `retryPendingUploads` was documented "dead but not disposable" and
 * requalified towards a task that never wired it. Measured at pre-flight:
 * `storeImageLocally` wrote field photos that **nothing in the world uploaded
 * any more**. Porting it as-is would have transported the orphan; it therefore
 * receives its caller in {@link initImageUpload}, and it is a **new** feature,
 * owned as such.
 *
 * ⚠️ This reference named `initImageRetry` until 08/08/2026 — **a symbol that
 * never existed**, in the very sentence asserting the orphan had received its
 * caller. The mechanism itself was right. No gate could see it:
 * `check-tsdoc-conformity.cjs` does not resolve `{@link}`s.
 *
 * ⚠️ An image without an `endpoint` is **left pending**, not destroyed: we do
 * not know where to send it, and the outbox contract like this one forbids
 * losing a capture for lack of a destination.
 *
 * 🛑 **THE PURGE IS CALLED HERE, AND ONLY IF SOMETHING WAS ACKNOWLEDGED.**
 * `local_images` had a live writer (`storeImageLocally`) and **no reachable
 * purge**: `cleanUploadedImages` had no caller, no facade relay, no namespace
 * exposure — an orphan that crossed several sprint closures unseen. On a field
 * device the quota decides everything. The `uploaded > 0` condition is not
 * cosmetic: without it, every empty retry would open a `readwrite` transaction
 * to delete nothing.
 *
 * @returns the tally, or `null` when the retry did not happen (off-network,
 *   already running, or store absent).
 */
export async function retryPendingImages(): Promise<RetryReport | null> {
    if (_retrying) return null;
    if (typeof navigator !== "undefined" && !navigator.onLine) return null;
    const db = _imagesDb();
    if (!db?.getPendingImages || !db.updateImageUploadStatus) return null;

    _retrying = true;
    try {
        const pending = ((await db.getPendingImages()) ?? []) as PendingImage[];
        const report: RetryReport = { attempted: 0, uploaded: 0, failed: 0, skipped: 0 };
        for (const img of pending) {
            if (!_isRetryable(img, report)) continue;
            report.attempted += 1;
            try {
                const file = new File([img.blob], img.filename ?? "image.jpg", {
                    type: img.blob.type || "image/jpeg",
                });
                // 🛑 THE URL IS KEPT. It used to be thrown away — `await _postToServer(...)`
                // with no assignment — so the file reached the server and the feature never
                // learnt where it landed.
                const url = await _postToServer(file, img.endpoint as string);
                // 🛑 AN OBJECT, NOT THE STRING `"uploaded"`. The core reads `status.uploaded`;
                // a string made it `undefined`, the record was rewritten as still pending, the
                // URL was never stored and the purge never found anything to reclaim. The same
                // photo therefore left again on every reconnection and every boot, forever.
                await db.updateImageUploadStatus(img.id, { uploaded: true, url });
                await _reconcile(img, url);
                report.uploaded += 1;
            } catch (e) {
                // The entry STAYS pending — a failure destroys nothing.
                report.failed += 1;
                Log?.debug?.("[editor/image] Retry failed, image stays pending:", img.id, e);
            }
        }
        if (report.attempted > 0) Log?.info?.("[editor/image] Retry:", report);
        await _purgeAcknowledged(db, report);
        return report;
    } finally {
        _retrying = false;
    }
}

/**
 * Object URLs minted for previews, one per image id.
 *
 * ⚠️ Memoised, and revoked at teardown. Minting a fresh one on every repaint leaks a handle
 * to the blob for the lifetime of the document — on a field session that repaints a gallery
 * on every keystroke, that is the whole photo set held twice over.
 */
const _previewUrls = new Map<string, string>();

/**
 * Paints a locally-stored image from its token — the preview half of the token contract.
 *
 * ⚠️ Returns `null` for anything that is not a token, which is the ordinary case: a server
 * URL needs no resolving and must be handed back untouched.
 *
 * @param value - The value held by the field.
 * @returns a `blob:` URL, or `null` to let the library display the value as-is.
 */
async function _resolveImagePreview(value: string): Promise<string | null> {
    const id = _imageIdOfToken(value);
    if (!id) return null;
    const cached = _previewUrls.get(id);
    if (cached) return cached;
    const db = _imagesDb();
    if (!db?.getLocalImage) return null;
    try {
        const record = (await db.getLocalImage(id)) as { blob?: Blob } | null | undefined;
        if (!record?.blob) return null;
        const url = URL.createObjectURL(record.blob);
        _previewUrls.set(id, url);
        return url;
    } catch (e) {
        Log?.debug?.("[editor/image] Preview unavailable for:", id, e);
        return null;
    }
}

/**
 * Wires the upload strategy and **arms the retry on network return**.
 *
 * Idempotent: a second call does not stack a listener.
 */
export function initImageUpload(): void {
    setImageUploadStrategy(uploadImage);
    // An offline capture is held as an opaque token, so the library cannot paint it on its
    // own — only this plugin can read the local store the token points into.
    setImagePreviewResolver(_resolveImagePreview);
    // 🛑 NO `online` LISTENER OF ITS OWN ANY MORE, AND THAT IS THE FIX. This module and the
    // outbox replay each registered one, the replay's first — so on reconnection the queue
    // was pushed while the photos were still local, and the create left carrying a token no
    // server can resolve. The retry is now SEQUENCED by the replay (`beforeDrain`), which
    // holds the drain lock while it runs. The boot flush follows the same path.
}

/** Removes the listener and returns the strategy to the library's default `fetch`. */
export function destroyImageUpload(): void {
    _retrying = false;
    setImageUploadStrategy(null);
    setImagePreviewResolver(null);
    for (const url of _previewUrls.values()) URL.revokeObjectURL(url);
    _previewUrls.clear();
}
