/*!
 * @geoleaf-plugins/editor — Storage façade seam
 * © 2026 Mattieu Pottier — MIT License
 *
 * Single reader of `globalThis.GeoLeaf.Storage` for the persistence layer.
 *
 * ⚠️ The late binding is deliberate, not an accident to be tidied away. The
 * editor must build and run without `@geoleaf-plugins/offline-ui` installed: a
 * static import would make an optional plugin a hard dependency and pull it into
 * the bundle. So the façade is resolved at CALL time and every consumer copes
 * with `null`. PLUGINS S4 merged the two identical readers that had grown in
 * `storage-queue-adapter` and `editor-sync-replay`; it did NOT dissolve the seam.
 * https://geoleaf.dev
 */

/**
 * Accès aux sous-modules de la base — l'`outbox` est lue par la modale d'attente (4.9).
 *
 * 🛑 **`StorageQueueDb` A ÉTÉ RETIRÉE ICI, et sa mort datait de 4.9.** Elle déclarait les
 * quatre méthodes `sync_queue` de la file v3 — `addToSyncQueue`, `getPendingSyncQueue`,
 * `updateSyncQueueStatus`, `removeSyncQueueEntry` — plus un commentaire expliquant pourquoi la
 * file portait DEUX slots de charge utile (`poiData` pour `addpoi`, `payload` pour l'éditeur).
 * Ce partage a disparu quand l'éditeur est passé par `applyEdit` : les quatre déclarations
 * n'ont plus eu **aucun appelant**, et le seul consommateur de `storageDb()` ne lit que
 * `_ensureModule`.
 *
 * ⚠️ **Deux « appelants » subsistaient en apparence — c'était de la PROSE, pas du code**
 * (l'en-tête de `storage-queue-adapter.ts` et un commentaire d'`editor-sync-replay.ts`). Un
 * grep qui ne distingue pas les deux compte une surface morte comme vivante ; c'est ce qui a
 * fait survivre ces quatre lignes à la clôture de S4c.
 */
export interface OutboxAccess {
    _ensureModule?: (name: string) => { list?: () => Promise<OutboxRow[]> } | null;
    /**
     * Les saisies jamais poussées, tous états non-`synced` confondus (`pending`, `inFlight`,
     * `failed`, `quarantined`).
     *
     * ⚠️ **C'est la source qu'`addpoi` utilise pour `getSyncSummary`, et le handler de
     * l'éditeur (5.1-b) doit lire LA MÊME.** Elle n'est pas interchangeable avec
     * `_ensureModule("Outbox").list()` filtré : le core y **écarte** toute entrée sans
     * `layerId` ou `localId`, et il joint le magasin `features`. Compter d'un autre côté
     * ferait diverger le bouton de synchronisation d'`offline-ui` d'un total à l'autre sans
     * qu'aucune gate ne le voie.
     */
    listPendingEdits?: () => Promise<PendingEdit[]>;
}

/** Une saisie en attente, telle que `listPendingEdits` la rend. */
export interface PendingEdit {
    entryId: string;
    kind: string;
    layerId: string;
    localId: string;
    state: string;
    createdAt: number;
    feature: unknown;
}

/** Une entrée d'`outbox`, réduite à ce que la modale d'attente en lit. */
export interface OutboxRow {
    id: string;
    kind: string;
    layerId: string;
    localId: string;
    state?: string;
    createdAt?: number;
}

/** Le cycle d'écriture du core (4.4/4.5), unique écrivain de la file depuis 4.9. */
export interface StorageWriteFacade {
    /**
     * La couche accorde-t-elle cette opération ? — tâche 8.7 (**B-138**).
     *
     * 🛑 **SYNCHRONE, et disponible SANS le moteur hors-ligne.** La permission se lit dans le
     * profil, pas dans IndexedDB, et `GeoLeaf.Storage` s'auto-monte au boot
     * (`globals.storage.ts`) : le prédicat répond donc même en `persistence.mode: "online"`,
     * là où ce plugin tourne sans `offline-ui`. C'était la condition pour que la garde couvre
     * le chemin CONNECTÉ, le seul où le trou existait.
     *
     * ⚠️ Optionnel dans cette interface parce que **tout** l'est ici : ce plugin redéclare la
     * surface du global qu'il attend (INV-NS lui interdit d'importer les sources du core).
     * L'absence de ce membre n'est donc pas une permission — voir `permission-gate.ts`, qui
     * REFUSE quand il ne peut pas interroger.
     */
    mayEdit?(layerId: string, kind: "create" | "update" | "delete"): boolean;
    applyEdit?(input: {
        layerId: string;
        kind: "create" | "update" | "delete";
        localId?: string;
        feature?: unknown;
    }): Promise<{ entryId: string | null; refused: string | null }>;
    pushOutbox?(): Promise<{
        attempted: number;
        pushed: number;
        failed: number;
        conflicts: number;
        refused: string | null;
    }>;
}

const _g = globalThis as unknown as {
    GeoLeaf?: {
        Storage?: {
            DB?: OutboxAccess;
        } & StorageWriteFacade;
        Config?: { getActiveProfile?: () => { id?: string } | null };
    };
};

/** Resolves the Storage DB façade at call time, or null when unavailable. */
export function storageDb(): OutboxAccess | null {
    return _g?.GeoLeaf?.Storage?.DB ?? null;
}

/**
 * Resolves the Storage write façade at call time, or null when unavailable.
 *
 * ⚠️ Distinct de {@link storageDb} : celui-ci rend la BASE, celle-là le cycle d'écriture.
 * L'éditeur écrivait la file par la base ; depuis 4.9 il passe par le cycle, seul endroit qui
 * tienne l'atomicité entité + entrée, la coalescence et l'invariant S6.
 */
export function storageFacade(): StorageWriteFacade | null {
    return _g?.GeoLeaf?.Storage ?? null;
}
