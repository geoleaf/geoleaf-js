/*!
 * @geoleaf/field-renderer — adaptive image compression
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Canvas-based image compression with an adaptive quality ladder.
 *
 * Absorbed from `@geoleaf-plugins/addpoi` (`image-upload.ts`), under the
 * rule: what is **pure** moves up into the lib, what carries **state**
 * (offline storage, retry queue, CSRF token) stays in the plugin. Nothing
 * here touches the network, storage or global configuration — hence its place
 * in a published package.
 *
 * 🛑 **THIS MODULE CHANGES WHAT `maxSizeMb` MEANS, and that is the point to
 * read before using it.** Until now `_validateFile` REJECTED any file above
 * `maxSizeMb`. On a field device, a phone photo routinely weighs 4 to 12 MB:
 * the default 5 MB bound thus refused the most ordinary capture there is,
 * with no recourse. `maxSizeMb` is now the size **aimed for after
 * compression**, and the rejection happens on a ceiling **before**
 * compression ({@link PRECOMPRESSION_FACTOR}).
 *
 * ⚠️ **The change takes nothing away**: any file accepted before still is. It
 * widens — which is why it is treated as additive on a published surface.
 */
import { _validateFile } from "./field-media.js";

/**
 * Longest edge kept when an image is resized, in pixels.
 *
 * ⚠️ Compression does not only play on JPEG QUALITY: beyond this bound the
 * image is also **resized**, ratio preserved. That is where most of the gain
 * comes from on a modern phone photo, and the plan did not mention it — it
 * only spoke of the 0.8 / 0.7 / 0.6 step.
 */
export const MAX_DIMENSION = 1920;

/** JPEG quality applied when the overshoot is moderate. */
export const BASE_QUALITY = 0.8;

/**
 * Multiplier of the ceiling **before** compression.
 *
 * A file beyond `maxSizeMb × PRECOMPRESSION_FACTOR` is refused without being
 * compressed: past that, the canvas would work a long time for a result that
 * would fail anyway, and the user would wait for nothing. Value taken from
 * `addpoi`, where it was hardcoded.
 */
export const PRECOMPRESSION_FACTOR = 5;

/** Outcome of a compression attempt. */
export interface CompressionOutcome {
    /** The file to upload — the original when no compression was needed. */
    file: File;
    /** `true` when the canvas really produced a new file. */
    compressed: boolean;
    /** i18n error key, or `null`. Same convention as `_validateFile`. */
    error: string | null;
}

/**
 * Picks the JPEG quality from the overshoot's magnitude.
 *
 * Step taken from `addpoi`: the more the image overshoots, the harder we
 * compress. A single quality would treat a 10% overshoot and a 4× factor the same.
 *
 * @param size        - File size, in bytes.
 * @param maxBytes    - Target size, in bytes.
 * @param baseQuality - Quality applied to a moderate overshoot.
 * @returns the quality, within `]0, 1]`.
 *
 * @example
 * ```ts
 * pickCompressionQuality(3_000_000, 1_000_000, 0.8); // 0.6 — plus de 3×
 * ```
 */
export function pickCompressionQuality(
    size: number,
    maxBytes: number,
    baseQuality = BASE_QUALITY
): number {
    if (size > maxBytes * 3) return 0.6;
    if (size > maxBytes * 2) return 0.7;
    return baseQuality;
}

/**
 * Compresses an image through a canvas, resizing it when needed.
 *
 * PURE in the sense that matters here: no network I/O, no storage, no global
 * configuration — only the file received and the options passed.
 *
 * ⚠️ It **rejects**, it does not throw — the nuance is not cosmetic: a
 * `@throws` on a promise-returning function invites the caller into a
 * synchronous `try` that will catch nothing. The rejection reason is an
 * `Error` whose message is an **i18n key** (`form.error.image*`), for the
 * caller to translate — `addpoi` hardcoded French messages there, in a
 * published package.
 *
 * @param file    - Original image.
 * @param quality - JPEG quality, within `]0, 1]`.
 * @returns the compressed `image/jpeg` file; the promise **rejects** with an
 *   i18n key when the canvas is unavailable, reading fails, the image does
 *   not decode, or `toBlob` returns nothing.
 *
 * @example
 * ```ts
 * const smaller = await compressImage(file, 0.7);
 * ```
 */
export function compressImage(file: File, quality = BASE_QUALITY): Promise<File> {
    // 🛑 SYNCHRONOUS GUARD, SET BEFORE ANY I/O — and it fixes a real defect
    // inherited from `addpoi`. There, the missing 2D context was only
    // detected INSIDE `img.onload`: on a canvas-less browser, `onload` never
    // fires, so the promise settles NEITHER in success NOR failure. The
    // upload hung, with no message and no recourse — the class of silent loss
    // this repo hunts.
    if (!_canvasAvailable()) return Promise.reject(new Error("form.error.imageCanvas"));

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("form.error.imageRead"));
        reader.onload = (e: ProgressEvent<FileReader>) => {
            const dataUrl = e.target?.result;
            if (typeof dataUrl !== "string") {
                reject(new Error("form.error.imageRead"));
                return;
            }
            const img = new Image();
            img.onerror = () => reject(new Error("form.error.imageDecode"));
            img.onload = () => {
                const canvas = document.createElement("canvas");
                const ctx = canvas.getContext("2d");
                if (!ctx) {
                    reject(new Error("form.error.imageCanvas"));
                    return;
                }
                const { width, height } = _fitWithin(img.width, img.height, MAX_DIMENSION);
                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob(
                    (blob) => {
                        if (!blob) {
                            reject(new Error("form.error.imageCompress"));
                            return;
                        }
                        // The original name is kept — what the user
                        // recognises server-side, the real type being carried by the MIME.
                        resolve(new File([blob], file.name, { type: "image/jpeg" }));
                    },
                    "image/jpeg",
                    quality
                );
            };
            img.src = dataUrl;
        };
        reader.readAsDataURL(file);
    });
}

/**
 * Is the 2D canvas usable in this environment?
 *
 * @returns `false` as soon as `getContext("2d")` returns `null` or throws.
 */
function _canvasAvailable(): boolean {
    try {
        return !!document.createElement("canvas").getContext("2d");
    } catch {
        return false;
    }
}

/**
 * Brings dimensions under a bound, ratio preserved.
 *
 * Exported under the `_` prefix (same convention as `_validateFile`) because
 * it is the part of the gain the plan did not name: on a phone photo,
 * **resizing** weighs more than JPEG quality, and it deserves exercising on its own.
 *
 * @param w   - Largeur d'origine.
 * @param h   - Original height.
 * @param max - Bound of the longest side.
 * @returns the dimensions to apply — unchanged when already under the bound.
 *
 * @example
 * ```ts
 * _fitWithin(4000, 3000, 1920); // { width: 1920, height: 1440 }
 * ```
 */
export function _fitWithin(w: number, h: number, max: number): { width: number; height: number } {
    if (w <= max && h <= max) return { width: w, height: h };
    return w > h
        ? { width: max, height: Math.round((h / w) * max) }
        : { width: Math.round((w / h) * max), height: max };
}

/**
 * Validates then, when needed, compresses an image to fit under `maxSizeMb`.
 *
 * The entry point the `image` and `gallery` components call: it replaces the
 * direct `_validateFile` call and returns either a file ready to upload or an
 * error key.
 *
 * ⚠️ **An image still overshooting AFTER compression is refused**, and that is
 * deliberate: returning it anyway would fail the upload further on, with a
 * less clear message and after waiting for the network.
 *
 * @param file      - File the user picked.
 * @param maxSizeMb - Size aimed for after compression, in MB.
 * @returns the outcome, with the i18n error key when applicable.
 *
 * @example
 * ```ts
 * const out = await compressToFit(file, 5);
 * if (out.error) showError(out.error);
 * else await upload(out.file);
 * ```
 */
export async function compressToFit(file: File, maxSizeMb: number): Promise<CompressionOutcome> {
    // The MIME type is refused outright: compressing a PDF makes no sense.
    const typeError = _validateFile(file, maxSizeMb * PRECOMPRESSION_FACTOR);
    if (typeError) return { file, compressed: false, error: typeError };

    const maxBytes = maxSizeMb * 1024 * 1024;
    if (file.size <= maxBytes) return { file, compressed: false, error: null };

    try {
        const quality = pickCompressionQuality(file.size, maxBytes);
        const out = await compressImage(file, quality);
        if (out.size > maxBytes) {
            return { file, compressed: true, error: "form.error.imageSize" };
        }
        return { file: out, compressed: true, error: null };
    } catch (e) {
        // The message IS the i18n key (see `compressImage`).
        const key = e instanceof Error ? e.message : "form.error.imageCompress";
        return { file, compressed: false, error: key };
    }
}
