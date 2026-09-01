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
import { setImageUploadStrategy } from "@geoleaf/field-renderer";

/** The core's image store, read at call time — the plugin does not depend on `offline-ui`. */
interface ImagesDb {
    storeImageLocally?(data: unknown): Promise<unknown>;
    getPendingImages?(): Promise<unknown>;
    updateImageUploadStatus?(id: string, status: string): Promise<unknown>;
    /** Reclaims the space of entries the server has acknowledged. See {@link retryPendingImages}. */
    cleanUploadedImages?(): Promise<unknown>;
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
    endpoint?: string;
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
 * @param file     - File to keep.
 * @param endpoint - Endpoint to retry later.
 * @returns the displayable data-URL.
 */
export async function storeImageLocally(file: File, endpoint: string): Promise<string> {
    const dataUrl = await _toDataUrl(file);
    const db = _imagesDb();
    if (db?.storeImageLocally) {
        try {
            await db.storeImageLocally({
                id: `image_${crypto.randomUUID()}`,
                blob: file,
                filename: file.name,
                type: file.type,
                size: file.size,
                timestamp: Date.now(),
                endpoint,
                uploaded: 0,
            });
        } catch (e) {
            // The database is a COMFORT here: the data-URL is already written
            // into the entity, so the capture is not lost. Failing loudly would
            // lose the photo to preserve a retry queue.
            Log?.warn?.("[editor/image] Local image store failed, preview still available:", e);
        }
    }
    return dataUrl;
}

/**
 * The upload strategy: network first, local storage as backup.
 *
 * @param file     - File already validated and compressed by `field-renderer`.
 * @param endpoint - The field's POST endpoint.
 * @returns the server URL, or a local data-URL when the network did not answer.
 */
export async function uploadImage(file: File, endpoint: string): Promise<string> {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
        Log?.debug?.("[editor/image] Offline — storing locally");
        return storeImageLocally(file, endpoint);
    }
    try {
        return await _postToServer(file, endpoint);
    } catch (e) {
        Log?.warn?.("[editor/image] Upload failed, storing locally for retry:", e);
        return storeImageLocally(file, endpoint);
    }
}

/** A retry's tally. */
export interface RetryReport {
    attempted: number;
    uploaded: number;
    failed: number;
}

let _retrying = false;

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
        const report: RetryReport = { attempted: 0, uploaded: 0, failed: 0 };
        for (const img of pending) {
            if (!img?.endpoint || !img.blob) continue;
            report.attempted += 1;
            try {
                const file = new File([img.blob], img.filename ?? "image.jpg", {
                    type: img.blob.type || "image/jpeg",
                });
                await _postToServer(file, img.endpoint);
                await db.updateImageUploadStatus(img.id, "uploaded");
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

let _onlineListener: (() => void) | null = null;

/**
 * Wires the upload strategy and **arms the retry on network return**.
 *
 * Idempotent: a second call does not stack a listener.
 */
export function initImageUpload(): void {
    setImageUploadStrategy(uploadImage);
    if (typeof window === "undefined" || _onlineListener) return;
    _onlineListener = () => {
        void retryPendingImages();
    };
    window.addEventListener("online", _onlineListener);
    // Opportunistic retry at startup: a previous session may have left images.
    if (typeof navigator === "undefined" || navigator.onLine) void retryPendingImages();
}

/** Removes the listener and returns the strategy to the library's default `fetch`. */
export function destroyImageUpload(): void {
    if (_onlineListener && typeof window !== "undefined") {
        window.removeEventListener("online", _onlineListener);
    }
    _onlineListener = null;
    _retrying = false;
    setImageUploadStrategy(null);
}
