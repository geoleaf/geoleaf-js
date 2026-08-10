/*!
 * @geoleaf/field-renderer — shared image upload & lightbox
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * `gallery` (multi) and `image` (single) carried byte-identical copies of the
 * accepted-MIME table, the lightbox overlay and the upload call. They live here
 * once.
 * https://geoleaf.dev
 */
import { applyCssText } from "../dom.js";
import { safeUrl } from "../sanitize.js";
import { _el } from "../helpers.js";

/** MIME types accepted by both image fields. */
export const ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** Value of the `accept` attribute on the file inputs. */
export const ACCEPTED_ACCEPT = ACCEPTED_MIME.join(",");

/**
 * Object URLs minted by this module.
 *
 * `safeUrl()` whitelists http/https/data:<image> only — `blob:` is NOT in it.
 * Running a freshly created object URL through it would return "" and wipe the
 * preview of the file the user just picked, on every profile without an
 * `uploadEndpoint`. These URLs are ours and same-origin by construction, so
 * they are allowed explicitly rather than by loosening the whitelist.
 */
const _ownObjectUrls = new Set<string>();

/** Creates a local preview URL and records it as trusted. */
export function _createObjectUrl(file: File): string {
    const url = URL.createObjectURL(file);
    _ownObjectUrls.add(url);
    return url;
}

/**
 * Protocol-checked value for an `img.src`.
 * Returns "" for anything outside the whitelist, except our own object URLs.
 *
 * @param url - Raw URL, typically read from a GeoJSON property (user data).
 */
export function _safeImageSrc(url: string): string {
    if (_ownObjectUrls.has(url)) return url;
    return safeUrl(url);
}

/**
 * Opens a full-screen overlay showing the image, dismissed on click.
 * The source is protocol-checked here so every call site is covered.
 */
export function _openLightbox(src: string): void {
    const safeSrc = _safeImageSrc(src);
    if (!safeSrc) return;
    const overlay = _el("div", "gl-lightbox");
    applyCssText(
        overlay,
        "position:fixed;inset:0;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;z-index:9999;cursor:zoom-out"
    );
    const img = _el("img");
    img.src = safeSrc;
    applyCssText(img, "max-width:90vw;max-height:90vh;object-fit:contain;border-radius:4px");
    overlay.appendChild(img);
    overlay.addEventListener("click", () => overlay.remove());
    document.body.appendChild(overlay);
}

/**
 * Comment une image est réellement téléversée.
 *
 * @param file     - Fichier, déjà validé et compressé par l'appelant.
 * @param endpoint - Point d'entrée POST configuré sur le champ.
 * @returns l'URL sous laquelle l'image est désormais lisible.
 */
export type ImageUploadStrategy = (file: File, endpoint: string) => Promise<string>;

let _strategy: ImageUploadStrategy | null = null;

/**
 * Remplace la façon dont les composants `image` et `gallery` téléversent (tâche 5.1-d).
 *
 * 🛑 **CE POINT D'INJECTION REMPLACE UNE DUPLICATION DE 229 LIGNES.** `addpoi` obtenait le même
 * résultat en enregistrant un composant de substitution (`"addpoi-image"`) et en remappant le
 * type `image` dessus : **229 lignes pour changer 4 appels**, dont ~225 re-implémentaient
 * l'aperçu, la visionneuse, la zone de dépôt et le bouton de retrait que le composant de base
 * (239 lignes) porte déjà. Un hôte qui a besoin d'un autre transport n'a pas besoin d'un autre
 * composant.
 *
 * ⚠️ **Un seul stratège à la fois, et c'est délibéré.** Deux hôtes qui en poseraient un chacun
 * se donneraient un résultat dépendant de l'ordre de chargement — la classe de défaut que la
 * tâche 5.1-b vient de traiter sur le seam `Sync`. Le dernier appel gagne, et il gagne
 * **explicitement** : c'est à l'hôte de savoir s'il est seul.
 *
 * @param fn - La stratégie, ou `null` pour revenir au `fetch` multipart par défaut.
 *
 * @example
 * ```ts
 * setImageUploadStrategy(async (file, endpoint) => {
 *     try { return await postToServer(file, endpoint); }
 *     catch { return await storeOffline(file); }
 * });
 * ```
 */
export function setImageUploadStrategy(fn: ImageUploadStrategy | null): void {
    _strategy = fn;
}

/**
 * POSTs the file as multipart/form-data and returns the stored URL.
 *
 * Délègue à la stratégie posée par l'hôte quand il y en a une ; sinon, `fetch` multipart.
 *
 * @param file     - File to upload.
 * @param endpoint - POST endpoint; response must be JSON `{ url: string }`.
 * @returns l'URL stockée ; la promesse **rejette** quand le transport échoue.
 */
export async function _uploadFile(file: File, endpoint: string): Promise<string> {
    if (_strategy) return _strategy(file, endpoint);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(endpoint, { method: "POST", body: form });
    if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`);
    const data = (await res.json()) as { url: string };
    return data.url;
}

/**
 * Checks MIME type then size.
 *
 * @returns An i18n error key, or null when the file is acceptable.
 */
export function _validateFile(file: File, maxSizeMb: number): string | null {
    if (!ACCEPTED_MIME.includes(file.type)) return "form.error.imageType";
    if (file.size > maxSizeMb * 1024 * 1024) return "form.error.imageSize";
    return null;
}
