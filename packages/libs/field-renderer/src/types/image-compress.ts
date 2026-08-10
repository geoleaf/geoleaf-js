/*!
 * @geoleaf/field-renderer — adaptive image compression
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Canvas-based image compression with an adaptive quality ladder.
 *
 * Absorbed from `@geoleaf-plugins/addpoi` (`image-upload.ts`) at task 5.1-d, under decision
 * **D5** : ce qui est **pur** monte dans la lib, ce qui porte de l'**état** (stockage hors
 * ligne, file de reprise, jeton CSRF) reste dans le plugin. Rien ici ne touche au réseau, au
 * stockage ni à une configuration globale — d'où sa place dans un paquet publié.
 *
 * 🛑 **CE MODULE CHANGE CE QUE `maxSizeMb` VEUT DIRE, et c'est le point à lire avant de s'en
 * servir.** Jusqu'ici `_validateFile` REJETAIT tout fichier au-dessus de `maxSizeMb`. Sur un
 * appareil de terrain, une photo de téléphone pèse couramment 4 à 12 Mo : la borne par défaut
 * de 5 Mo refusait donc la saisie la plus ordinaire qui soit, sans recours. Désormais
 * `maxSizeMb` est la taille **visée après compression**, et le rejet se fait sur un plafond
 * **avant** compression ({@link PRECOMPRESSION_FACTOR}).
 *
 * ⚠️ **Le changement n'ôte rien** : tout fichier accepté avant l'est encore. Il élargit —
 * c'est pourquoi il est traité comme additif sur une surface publiée.
 */
import { _validateFile } from "./field-media.js";

/**
 * Longest edge kept when an image is resized, in pixels.
 *
 * ⚠️ La compression ne joue pas que sur la QUALITÉ JPEG : au-delà de cette borne l'image est
 * aussi **redimensionnée**, à ratio conservé. C'est ce qui fait l'essentiel du gain sur une
 * photo de téléphone moderne, et la roadmap ne le mentionnait pas — elle ne parlait que du
 * palier 0,8 / 0,7 / 0,6.
 */
export const MAX_DIMENSION = 1920;

/** Qualité JPEG appliquée quand le dépassement est modéré. */
export const BASE_QUALITY = 0.8;

/**
 * Multiplicateur du plafond **avant** compression.
 *
 * Un fichier au-delà de `maxSizeMb × PRECOMPRESSION_FACTOR` est refusé sans être compressé :
 * au-delà, le canvas travaillerait longtemps pour un résultat qui échouerait quand même, et
 * l'utilisateur attendrait pour rien. Valeur reprise d'`addpoi`, où elle était en dur.
 */
export const PRECOMPRESSION_FACTOR = 5;

/** Issue d'une tentative de compression. */
export interface CompressionOutcome {
    /** Le fichier à téléverser — l'original quand aucune compression n'était nécessaire. */
    file: File;
    /** `true` quand le canvas a réellement produit un nouveau fichier. */
    compressed: boolean;
    /** Clé i18n d'erreur, ou `null`. Même convention que `_validateFile`. */
    error: string | null;
}

/**
 * Choisit la qualité JPEG selon l'ampleur du dépassement.
 *
 * Palier repris d'`addpoi` : plus l'image dépasse, plus on comprime. Une qualité unique
 * traiterait de la même façon un dépassement de 10 % et un facteur 4.
 *
 * @param size        - Taille du fichier, en octets.
 * @param maxBytes    - Taille visée, en octets.
 * @param baseQuality - Qualité appliquée au dépassement modéré.
 * @returns la qualité, dans `]0, 1]`.
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
 * Comprime une image via un canvas, en la redimensionnant si nécessaire.
 *
 * PURE au sens qui compte ici : aucune I/O réseau, aucun stockage, aucune configuration
 * globale — seulement le fichier reçu et les options passées.
 *
 * ⚠️ Elle **rejette**, elle ne jette pas — la nuance n'est pas cosmétique : un `@throws` sur
 * une fonction qui rend une promesse invite l'appelant à un `try` synchrone qui n'attrapera
 * rien. Le motif de rejet est une `Error` dont le message est une **clé i18n**
 * (`form.error.image*`), pour que l'appelant la traduise — `addpoi` y codait des messages
 * français en dur, dans un paquet publié.
 *
 * @param file    - Image d'origine.
 * @param quality - Qualité JPEG, dans `]0, 1]`.
 * @returns le fichier compressé en `image/jpeg` ; la promesse **rejette** avec une clé i18n
 *   quand le canvas est indisponible, la lecture échoue, l'image ne se décode pas, ou
 *   `toBlob` ne rend rien.
 *
 * @example
 * ```ts
 * const smaller = await compressImage(file, 0.7);
 * ```
 */
export function compressImage(file: File, quality = BASE_QUALITY): Promise<File> {
    // 🛑 GARDE SYNCHRONE, POSÉE AVANT TOUTE E/S — et elle corrige un défaut réel hérité
    // d'`addpoi`. Là-bas, l'absence de contexte 2D n'était détectée qu'à l'INTÉRIEUR de
    // `img.onload` : sur un navigateur sans canvas, `onload` ne se déclenche jamais, donc la
    // promesse ne se règle NI en succès NI en échec. Le téléversement restait pendu, sans
    // message et sans recours — la classe de perte silencieuse que ce dépôt traque.
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
                        // Le nom d'origine est conservé — c'est ce que l'utilisateur
                        // reconnaît côté serveur, et le type réel est porté par le MIME.
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
 * Le canvas 2D est-il utilisable dans cet environnement ?
 *
 * @returns `false` dès qu'`getContext("2d")` rend `null` ou jette.
 */
function _canvasAvailable(): boolean {
    try {
        return !!document.createElement("canvas").getContext("2d");
    } catch {
        return false;
    }
}

/**
 * Ramène des dimensions sous une borne, à ratio conservé.
 *
 * Exporté sous préfixe `_` (même convention que `_validateFile`) parce que c'est la partie
 * du gain que la roadmap ne nommait pas : sur une photo de téléphone, le **redimensionnement**
 * pèse plus que la qualité JPEG, et il mérite d'être éprouvé pour lui-même.
 *
 * @param w   - Largeur d'origine.
 * @param h   - Hauteur d'origine.
 * @param max - Borne du plus grand côté.
 * @returns les dimensions à appliquer — inchangées si déjà sous la borne.
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
 * Valide puis, si nécessaire, comprime une image pour la faire tenir sous `maxSizeMb`.
 *
 * C'est le point d'entrée que les composants `image` et `gallery` appellent : il remplace
 * l'appel direct à `_validateFile` et rend soit un fichier prêt à téléverser, soit une clé
 * d'erreur.
 *
 * ⚠️ **Une image qui dépasse encore APRÈS compression est refusée**, et c'est délibéré :
 * la rendre quand même ferait échouer le téléversement plus loin, avec un message moins
 * clair et après avoir attendu le réseau.
 *
 * @param file      - Fichier choisi par l'utilisateur.
 * @param maxSizeMb - Taille visée après compression, en Mo.
 * @returns l'issue, avec la clé i18n d'erreur le cas échéant.
 *
 * @example
 * ```ts
 * const out = await compressToFit(file, 5);
 * if (out.error) showError(out.error);
 * else await upload(out.file);
 * ```
 */
export async function compressToFit(file: File, maxSizeMb: number): Promise<CompressionOutcome> {
    // Le type MIME est refusé sans détour : compresser un PDF n'a pas de sens.
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
        // Le message EST la clé i18n (voir `compressImage`).
        const key = e instanceof Error ? e.message : "form.error.imageCompress";
        return { file, compressed: false, error: key };
    }
}
