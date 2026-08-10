/*!
 * @geoleaf-plugins/editor — Offline-capable image upload
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * La moitié « à état » de la chaîne image, absorbée d'`addpoi` (tâche 5.1-d, décision **D5**).
 *
 * La moitié **pure** — compression adaptative et redimensionnement — vit dans
 * `@geoleaf/field-renderer` (`types/image-compress.ts`), qui l'applique avant d'appeler le
 * transport. Ce module est ce transport : il tente le réseau, et **retombe sur le stockage
 * local** quand le réseau manque. Il tire IndexedDB et le jeton CSRF du core, ce qu'une
 * bibliothèque de rendu de champs n'a pas à savoir faire.
 *
 * 🛑 **IL SE BRANCHE PAR STRATÉGIE, PAS PAR SURCHARGE DE COMPOSANT.** `addpoi` enregistrait un
 * `"addpoi-image"` de **229 lignes pour changer 4 appels**, dont ~225 re-implémentaient un
 * composant que `field-renderer` porte déjà. `setImageUploadStrategy` remplace tout ça.
 */
import { Log } from "@geoleaf/host-runtime";
import { setImageUploadStrategy } from "@geoleaf/field-renderer";

/** Le magasin d'images du core, lu à l'appel — le plugin ne dépend pas d'`offline-ui`. */
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
        | { Security?: { CSRFToken?: { getToken?(): string | null } } }
        | undefined;
    return g?.Security?.CSRFToken?.getToken?.() ?? null;
}

/** Une image en attente, telle que `getPendingImages` la rend. */
interface PendingImage {
    id: string;
    blob: Blob;
    filename?: string;
    endpoint?: string;
}

/**
 * Téléverse vers le serveur, jeton CSRF compris.
 *
 * ⚠️ `fetch` et non `XMLHttpRequest` — `addpoi` utilisait XHR pour sa **barre de progression**,
 * que le composant de `field-renderer` n'affiche pas. Porter XHR aurait porté 60 lignes pour un
 * indicateur que rien ne lit.
 *
 * @param file     - Fichier à envoyer.
 * @param endpoint - Point d'entrée POST.
 * @returns l'URL rendue par le serveur.
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
 * @param file - Fichier à lire.
 * @returns la data-URL, ou une chaîne vide si la lecture ne rend pas de texte.
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
 * Met l'image de côté localement et rend une URL **immédiatement affichable**.
 *
 * Écrit deux choses, et les deux comptent : une data-URL rendue à l'appelant, pour que l'aperçu
 * peigne sans relire la base ; et l'enregistrement en base, pour que la reprise puisse la
 * téléverser plus tard.
 *
 * ⚠️ **`uploaded: 0`, JAMAIS `false`** — un booléen n'est pas une clé IndexedDB valide, et le
 * magasin porte un index `uploaded` : un enregistrement écrit avec `false` reste **hors** de cet
 * index, donc invisible à `getPendingImages()`, donc jamais téléversé et jamais nettoyé. C'est
 * le défaut que la tâche 3.6 avait corrigé chez `addpoi` ; il ne se réintroduit pas ici.
 *
 * ⚠️ **`crypto.randomUUID()`, jamais `Math.random()`** : cet identifiant est la clé primaire
 * d'une photo de terrain, et une collision écrase une capture.
 *
 * @param file     - Fichier à conserver.
 * @param endpoint - Point d'entrée à retenter plus tard.
 * @returns la data-URL affichable.
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
            // La base est un CONFORT ici : la data-URL est déjà écrite dans l'entité, donc la
            // saisie n'est pas perdue. Échouer bruyamment ferait perdre la photo pour préserver
            // une file de reprise.
            Log?.warn?.("[editor/image] Local image store failed, preview still available:", e);
        }
    }
    return dataUrl;
}

/**
 * La stratégie de téléversement : réseau d'abord, stockage local en secours.
 *
 * @param file     - Fichier déjà validé et compressé par `field-renderer`.
 * @param endpoint - Point d'entrée POST du champ.
 * @returns l'URL du serveur, ou une data-URL locale quand le réseau n'a pas répondu.
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

/** Décompte d'une reprise. */
export interface RetryReport {
    attempted: number;
    uploaded: number;
    failed: number;
}

let _retrying = false;

/**
 * Rend au magasin l'espace des images que le serveur vient d'acquitter.
 *
 * Extraite de {@link retryPendingImages} pour la seule raison que l'y inliner poussait sa
 * complexité de 20 à 25 — la limite du dépôt est 20, et la contourner par un commentaire de
 * désactivation aurait été le geste que ce dépôt interdit sur les règles ESLint : un
 * abaissement sans motif écrit à côté est indiscernable d'un oubli six mois plus tard.
 *
 * 🛑 **Deux invariants, chacun éprouvé par son propre cas de test** (B-190) : la purge n'est
 * tentée que si **au moins une** image a été acquittée — sinon chaque reprise à vide ouvrirait une
 * transaction `readwrite` pour ne rien supprimer —, et **son échec ne remonte pas**. Les octets
 * restent, ils repartiront au prochain acquittement ; perdre la reprise pour un défaut de ménage
 * serait le mauvais arbitrage sur un appareil de terrain.
 *
 * @param db - Le magasin d'images du core, tel que {@link _imagesDb} le rend.
 * @param report - Le décompte de la reprise qui vient de s'achever.
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
 * Re-téléverse les images restées en attente.
 *
 * 🛑 **CETTE FONCTION EXISTE PARCE QU'`addpoi` EN AVAIT UNE SANS AUCUN APPELANT.** Là-bas,
 * `retryPendingUploads` était documentée comme « morte mais pas jetable » et requalifiée vers la
 * tâche 4.5 — que 4.5 n'a jamais câblée. Résultat mesuré au pré-vol du 05/08 : `storeImageLocally`
 * écrivait des photos de terrain que **plus rien au monde ne téléversait**. La porter telle quelle
 * aurait transporté l'orphelin ; elle reçoit donc son appelant dans {@link initImageUpload}, et
 * c'est une fonctionnalité **neuve**, assumée comme telle.
 *
 * ⚠️ Ce renvoi a nommé `initImageRetry` jusqu'au 08/08/2026 — **un symbole qui n'a jamais
 * existé**, dans la phrase même qui affirmait que l'orphelin avait reçu son appelant. Le
 * mécanisme, lui, était juste. Aucune gate ne pouvait le voir : `check-tsdoc-conformity.cjs`
 * ne résout pas les `{@link}` (B-153 ③).
 *
 * ⚠️ Une image sans `endpoint` est **laissée en attente**, pas détruite : on ne sait pas où
 * l'envoyer, et le contrat d'outbox comme celui-ci interdisent de perdre une saisie faute de
 * destination.
 *
 * 🛑 **LA PURGE EST APPELÉE ICI, ET SEULEMENT SI QUELQUE CHOSE A ÉTÉ ACQUITTÉ.** `local_images`
 * avait un écrivain vivant (`storeImageLocally`) et **aucune purge joignable** :
 * `cleanUploadedImages` n'avait ni appelant, ni relais de façade, ni exposition au namespace —
 * un C1 qui a traversé la clôture des Sprints 4, 5 et 8 (B-190). Sur un appareil de terrain le
 * quota décide de tout. La condition `uploaded > 0` n'est pas cosmétique : sans elle, chaque
 * reprise à vide ouvrirait une transaction `readwrite` pour ne rien supprimer.
 *
 * @returns le décompte, ou `null` quand la reprise n'a pas eu lieu (hors réseau, déjà en cours,
 *   ou magasin absent).
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
                // L'entrée RESTE en attente — un échec ne détruit rien.
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
 * Branche la stratégie de téléversement et **arme la reprise au retour du réseau**.
 *
 * Idempotent : un second appel ne empile pas d'écouteur.
 */
export function initImageUpload(): void {
    setImageUploadStrategy(uploadImage);
    if (typeof window === "undefined" || _onlineListener) return;
    _onlineListener = () => {
        void retryPendingImages();
    };
    window.addEventListener("online", _onlineListener);
    // Reprise opportuniste au démarrage : une session précédente a pu laisser des images.
    if (typeof navigator === "undefined" || navigator.onLine) void retryPendingImages();
}

/** Retire l'écouteur et rend la stratégie au `fetch` par défaut de la bibliothèque. */
export function destroyImageUpload(): void {
    if (_onlineListener && typeof window !== "undefined") {
        window.removeEventListener("online", _onlineListener);
    }
    _onlineListener = null;
    _retrying = false;
    setImageUploadStrategy(null);
}
