/*!
 * @geoleaf-plugins/editor — Offline sync handler for the core `Sync` seam
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * The handler the editor registers on `GeoLeaf.Sync` so `offline-ui` can drive its replay
 * button. Task 5.1-b.
 *
 * 🛑 **CE N'EST PAS UN PORTAGE DES 689 LIGNES D'`addpoi`, et la mesure a retourné la ligne.**
 * Le pré-vol du 05/08 a relevé que `offline-ui` ne consomme du seam que **deux méthodes** —
 * `getSyncSummary()` et `processSyncQueue()` — et que dans `addpoi` les deux sont, depuis les
 * tâches 4.4b / 4.9 / 4.11, des **délégations pures au core** : la première lit
 * `Storage.DB.listPendingEdits`, la seconde appelle `Storage.pushOutbox`. Ni l'une ni l'autre
 * ne porte quoi que ce soit de spécifique aux POI. Le reste du fichier d'`addpoi`
 * (`queueOperation`, `syncDirect`, `_runOperation`, `autoSync`, `isSyncing`) a **zéro
 * consommateur hors de son paquet** et meurt avec lui — il ne se transfère pas.
 *
 * ⚠️ **DEUX COMPORTEMENTS D'`addpoi` NE SONT DÉLIBÉRÉMENT PAS REPRODUITS ICI.**
 *
 *   1. **La notification.** `addpoi.processSyncQueue` émet un toast de succès/échec, et
 *      `offline-ui/sync-manager.ts` en émet un AUSSI après l'appel : sur le chemin du bouton,
 *      l'utilisateur en reçoit **deux**. `offline-ui` est propriétaire du message du bouton
 *      qu'il pilote ; ce handler se tait. Le chemin « retour du réseau », lui, appartient à
 *      `editor-sync-replay.ts`, qui a son propre signal.
 *   2. **L'événement `geoleaf:poi:sync-completed`.** Mesuré : son unique écouteur de
 *      production est `addpoi/src/entry.ts:131`, son propre badge. Il meurt avec le plugin.
 *      L'éditeur a le sien, `geoleaf:editor:feature-sync-flushed`, émis par le drain.
 *
 * ⚠️ **Reproduire un défaut n'est pas « préserver la surface ».** La surface que les
 * consommateurs lisent est la valeur de retour, et elle est identique.
 */
import { Log } from "@geoleaf/host-runtime";
import { storageDb } from "./storage-seam.js";
import { drainOutbox } from "./editor-sync-replay.js";

/** L'identifiant sous lequel `offline-ui` lit le handler (`sync-seam.ts`). */
export const SYNC_HANDLER_ID = "poi";

/** Décompte des saisies dues au serveur, dans la forme que le contrat du core gèle. */
export interface SyncSummary {
    total: number;
    add: number;
    update: number;
    delete: number;
}

/** Décompte d'un rejeu, dans la forme qu'`offline-ui` lit déjà. */
export interface SyncResults {
    success: boolean;
    total: number;
    synced: number;
    failed: number;
    skipped: number;
}

/** La façade `GeoLeaf.Sync`, lue à l'appel — le core la monte au boot. */
interface SyncSeam {
    registerHandler?(id: string, handler: unknown): void;
    getHandler?(id: string): unknown;
}

function _syncSeam(): SyncSeam | null {
    return (Reflect.get(globalThis, "GeoLeaf") as { Sync?: SyncSeam } | undefined)?.Sync ?? null;
}

/**
 * Le handler enregistré sur `GeoLeaf.Sync`.
 *
 * @example
 * ```ts
 * const summary = await EditorSyncHandler.getSyncSummary();
 * if (summary.total > 0) await EditorSyncHandler.processSyncQueue();
 * ```
 */
export const EditorSyncHandler = {
    /**
     * Compte les saisies jamais poussées, ventilées par vocabulaire d'opération.
     *
     * ⚠️ La source est `Storage.DB.listPendingEdits` — **exactement celle qu'`addpoi` lit**.
     * Compter autrement (par exemple `outbox.list()` filtré, ce que fait la modale d'attente
     * de l'éditeur) donnerait un total voisin mais pas identique : le core y écarte les
     * entrées sans `layerId` ou `localId`. Le bouton d'`offline-ui` s'active sur
     * `total > 0` ; un écart y serait un changement de comportement invisible.
     *
     * @returns le décompte, ou des zéros quand le moteur de stockage est absent.
     */
    async getSyncSummary(): Promise<SyncSummary> {
        const db = storageDb();
        const listPendingEdits = db?.listPendingEdits;
        if (!listPendingEdits) return { total: 0, add: 0, update: 0, delete: 0 };

        // Appel de MÉTHODE : le récepteur reste lié (B-128).
        const entries = await listPendingEdits.call(db);
        const summary: SyncSummary = { total: entries.length, add: 0, update: 0, delete: 0 };
        for (const entry of entries) {
            // Vocabulaire gelé par le contrat (`SyncOperationKind`) et écrit par `applyEdit`.
            // Une valeur inconnue compte dans `total` sans être ventilée : mieux vaut un total
            // juste et une ventilation incomplète que l'inverse.
            if (entry.kind === "create") summary.add += 1;
            else if (entry.kind === "update") summary.update += 1;
            else if (entry.kind === "delete") summary.delete += 1;
        }
        return summary;
    },

    /**
     * Rejoue la file vers le serveur, pour le bouton d'`offline-ui`.
     *
     * Délègue au drain partagé (`editor-sync-replay.drainOutbox`) pour ne pas ouvrir un
     * second chemin de drain à côté de celui du retour réseau — les deux partagent un verrou.
     *
     * @returns le décompte du rejeu.
     * @throws quand le réseau est absent ou qu'un drain est déjà en cours — `offline-ui`
     *   attend une exception pour afficher son message, un retour muet lui ferait annoncer
     *   « 0 synchronisée » sur un rejeu qui n'a jamais eu lieu.
     */
    async processSyncQueue(): Promise<SyncResults> {
        const report = await drainOutbox();
        if (!report) {
            // `null` couvre trois cas indiscernables ici, et TOUS sont des non-événements :
            // hors réseau, drain déjà en cours, moteur absent. Les rendre comme un succès à
            // zéro ferait dire « à jour » à l'UI alors que rien n'a été tenté.
            Log?.warn?.("[editor/sync-handler] Drain not run (offline, busy, or no storage)");
            throw new Error("Synchronisation indisponible");
        }
        return {
            success: report.failed === 0,
            total: report.attempted,
            synced: report.pushed,
            failed: report.failed,
            // Le drain du core ne saute rien : il tente, réussit, échoue ou met en
            // quarantaine. Le champ est conservé parce qu'`offline-ui` le lit.
            skipped: 0,
        };
    },
};

/**
 * Enregistre le handler `"poi"` du seam `Sync`, **inconditionnellement**.
 *
 * 🛑 **CETTE FONCTION CÉDAIT LA PLACE, ET ELLE NE LE FAIT PLUS — c'est 5.1-f qui l'impose.**
 * `SyncHandlerContract.registerHandler` fait `_handlers.set(id, handler)` : il enregistre
 * **ou remplace, en silence**. Tant qu'`addpoi` vivait, s'enregistrer sans condition aurait
 * fait décider l'**ordre de chargement des balises `<script>`**. La parade était de céder
 * (`getHandler` non vide ⟹ on s'abstient), puis de reprendre explicitement depuis le pont.
 *
 * 🛑 **Le pont est parti avec `addpoi`, et il portait l'UNIQUE appelant de la reprise.**
 * Garder la cession aurait donc laissé un `return false` qu'aucun repreneur ne rattrape :
 * `GeoLeaf.Sync.getHandler("poi")` resterait vide dès qu'un tiers occuperait la place, et
 * le bouton de rejeu d'`offline-ui` mourrait **sans un mot**. Il n'y a plus de second
 * implémenteur dans le dépôt ; la cession n'a plus de bénéficiaire, seulement un risque.
 *
 * ✅ Ce que la mesure de 5.1-b avait établi tient toujours : `deploy-full` n'avait **aucun**
 * handler `"poi"` avant cet enregistrement — il ferme un trou vivant.
 *
 * @returns `true` — l'enregistrement n'a plus de cas d'échec autre que l'absence du seam.
 */
export function registerSyncHandler(): boolean {
    const seam = _syncSeam();
    if (!seam?.registerHandler) {
        Log?.debug?.("[editor/sync-handler] GeoLeaf.Sync absent — registration skipped");
        return false;
    }
    seam.registerHandler(SYNC_HANDLER_ID, EditorSyncHandler);
    Log?.debug?.(`[editor/sync-handler] registered "${SYNC_HANDLER_ID}"`);
    return true;
}
