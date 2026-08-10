/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Storage - IndexedDB Module
 *
 * Local persistent storage management with IndexedDB.
 * Enables layer caching, user preferences, and offline synchronization queue.
 *
 * @version 3.0.0
 */
"use strict";

import { Log } from "../../../utils/log/index.js";
import { isUnsafeKey } from "../../../utils/general/object-path-guard.js";
import { StorageHelperModule as StorageHelper } from "./storage-helper.js";
import { DBModulesRegistry } from "./db-modules-registry.js";
import type { PreservingPutTally } from "./features.js";
import type { LocalEditInput, LocalEditTally } from "./local-edit.js";
import type { FeatureRecord } from "../../../contracts/sync.contract.js";

type StorageDBInstance = IDBDatabase | { _isStub: boolean };

/** Module API returned by DB init() — methods vary by module */
interface DBModuleAPI {
    [key: string]: ((...args: unknown[]) => unknown) | undefined;
}

/**
 * Le rapport de stockage tel que `DB.Preferences` le rend — trois magasins comptés.
 *
 * `featuresCount` et `outboxCount` existent depuis B-121 (tâche 4.8) : sans eux, un
 * rapatriement de 27 entités laissait `getStats()` rapporter 0.
 */
interface StorageStatsReport {
    used: number;
    quota: number;
    percentage: number;
    layersCount: number;
    featuresCount: number;
    outboxCount: number;
}

/**
 * IndexedDB management module
 *
 * Object Stores :
 * - layers : GeoJSON layer cache (id, profileId, data, timestamp, size)
 * - preferences : User preferences (key, value)
 * - metadata : Cache metadata (key, value, timestamp)
 * - features : one record per entity, keyed `[layerId, localId]` (v4, task 3.4)
 * - outbox : write queue, `seq` autoIncrement (v4, task 3.4)
 * - local_images : images held for deferred upload
 *
 * ⚠️ Cette liste citait `sync_queue` et omettait `features`, `outbox` et `local_images` —
 * elle décrivait le schéma v2. `sync_queue` est retiré à la tâche 4.11 (B-124), `sync_backups`
 * l'est avec la chaîne de sauvegarde.
 */
const StorageDB = {
    /**
     * Database name
     * @private
     */
    _dbName: "geoleaf-db",

    /**
     * Initialized sub-modules
     * @private
     */
    _modules: {} as Record<string, DBModuleAPI>,

    /**
     * Lazy initialize a specific module
     * @private
     */
    _ensureModule(moduleName: string): DBModuleAPI | null {
        if (this._modules[moduleName]) {
            return this._modules[moduleName];
        }

        const moduleConfig = DBModulesRegistry[moduleName as keyof typeof DBModulesRegistry];
        if (
            moduleConfig &&
            typeof moduleConfig.init === "function" &&
            this._db &&
            !("_isStub" in this._db)
        ) {
            const api = moduleConfig.init(this._db) as unknown as DBModuleAPI;
            this._modules[moduleName] = api;
            Log.debug(`[StorageDB] ${moduleName} module lazily initialized`);
            return api;
        }

        return null;
    },

    /**
     * Database version.
     *
     * ⚠️ Le Service Worker ne la lit PAS et ne doit pas la lire : il ouvre `geoleaf-db` SANS
     * version depuis la tâche 3.1 (décision T2′). C'est ce qui rend la désynchronisation
     * inexprimable — il n'y a plus qu'un seul endroit où ce nombre existe, celui-ci.
     *
     * v4 (3.4) : ajoute `features` et `outbox`. Aucune migration de données — décision A16.
     * @private
     */
    _dbVersion: 4,

    /**
     * Database instance
     * @private
     */
    _db: null as StorageDBInstance | null,

    /**
     * Initialises the IndexedDB connection
     *
     * @returns {Promise<IDBDatabase>}
     * @example
     * await GeoLeaf.Storage.DB.init();
     */
    init() {
        if (this._db) {
            Log.debug("[StorageDB] Already initialized");
            return Promise.resolve(this._db);
        }

        // Use StorageHelper.openDatabase with timeout and unified error handling
        return StorageHelper.openDatabase(
            this._dbName,
            this._dbVersion,
            (event: IDBVersionChangeEvent) => this._upgradeDatabase(event),
            15000 // 15 second timeout for IndexedDB
        )
            .then((db) => {
                this._db = db;
                this._initializeModules();

                // YIELD ON `versionchange` — without this, WE are the blocker.
                //
                // Fires when another context (a second tab, or the same app after a deploy)
                // asks to upgrade the schema. A connection that does not close makes that
                // upgrade hang until it times out, and the other side then falls back to
                // `_isStub` — no storage, silently, on a device that may hold unsynced field
                // captures. Holding a connection open is the ONLY thing that can block a
                // migration, so every holder must let go on request.
                //
                // ⚠️ This becomes load-bearing the moment the schema moves (task 3.4). Until
                // then it costs nothing and is invisible — which is exactly why it has to be
                // posted BEFORE the migration, not with it.
                db.onversionchange = () => {
                    Log.warn(
                        "[StorageDB] Another connection requested a version change — closing ours"
                    );
                    this.close();
                };

                // ⚠️ `geoleaf:storage:ready` A ÉTÉ RETIRÉ ICI (B-72, 03/08/2026). Il partait à
                // CHAQUE ouverture de base — donc à chaque démarrage — **sans aucune charge
                // utile**, et n'avait aucun écouteur nulle part. La règle du dépôt est qu'un
                // émetteur sans écouteur se supprime **ou** se consomme ; lui consacrer un
                // écouteur aurait fermé le compteur C2 à la lettre sans rien apporter, et une
                // notification par boot est du bruit qui apprend à ne plus les lire.
                //
                // ⚠️ Et il ne disait pas ce qui compte : sur iOS l'état à observer n'est pas
                // « la base s'ouvre » mais « la base a été PURGÉE » après 7 jours d'inactivité.
                // Le jour où ce besoin arrivera, ce sera un signal neuf avec sa charge utile,
                // pas celui-ci rebranché.

                return db;
            })
            .catch((error: unknown) => {
                // Fallback: if IndexedDB fails, continue without persistence.
                Log.warn(
                    "[StorageDB] IndexedDB initialization failed, continuing without storage:",
                    (error as Error).message
                );
                // Remember the failure (B.47b). The stub used to be returned WITHOUT being
                // stored, so the `if (this._db)` short-circuit above never fired and every
                // later façade call paid another full open attempt — up to the 15 s timeout
                // each time. On a database that is durably unopenable (quota exceeded,
                // private browsing, IDB disabled) that is not an edge case, it is the
                // steady state.
                //
                // `_db` is typed `IDBDatabase | { _isStub: boolean }` and the three guards
                // that read it (`_ensureModule`, `_initializeModules`, `close`) already test
                // `"_isStub" in this._db` — the stub was always meant to live here.
                // `close()` clears it, which is the recovery path for a database that
                // becomes available again.
                this._db = { _isStub: true };
                return this._db;
            });
    },

    /**
     * Initialize database modules using DBModulesRegistry
     * @private
     */
    _initializeModules() {
        for (const [name, module] of Object.entries(DBModulesRegistry)) {
            if (
                module &&
                typeof module.init === "function" &&
                this._db &&
                !("_isStub" in this._db)
            ) {
                this._modules[name] = module.init(this._db) as unknown as DBModuleAPI;
                Log.debug(`[StorageDB] ${name} module initialized`);
            }
        }
    },

    /**
     * Upgrade database schema
     * @private
     */
    _upgradeDatabase(event: IDBVersionChangeEvent) {
        const db = (event.target as IDBOpenDBRequest).result;
        Log.info(
            `[StorageDB] Upgrading database from version ${event.oldVersion} to ${event.newVersion}`
        );

        // Store 'layers' : GeoJSON layer cache
        if (!db.objectStoreNames.contains("layers")) {
            const layersStore = db.createObjectStore("layers", { keyPath: "id" });
            layersStore.createIndex("profileId", "profileId", { unique: false });
            layersStore.createIndex("timestamp", "timestamp", { unique: false });
            Log.info("[StorageDB] Created 'layers' object store");
        }

        // Store 'preferences': User preferences
        if (!db.objectStoreNames.contains("preferences")) {
            db.createObjectStore("preferences", { keyPath: "key" });
            Log.info("[StorageDB] Created 'preferences' object store");
        }

        // 🛑 Le magasin 'sync_queue' N'EST PLUS CRÉÉ (tâche 4.11). C'est ce que la décision
        // A16 annonçait depuis le 02/08 — « il ne survit pas en v4 » — et que la ligne 4.9
        // n'a jamais porté, ce qu'a établi B-124. L'`outbox` le remplace intégralement.
        //
        // ⚠️ Une base existante garde son magasin : A16 exclut toute migration, donc on ne le
        // supprime pas au vol. Il devient orphelin, jamais ouvert, et part avec la base.

        // Store 'metadata': General metadata
        if (!db.objectStoreNames.contains("metadata")) {
            db.createObjectStore("metadata", { keyPath: "key" });
            Log.info("[StorageDB] Created 'metadata' object store");
        }

        // 🛑 Le magasin 'sync_backups' N'EST PLUS CRÉÉ (tâche 4.11). Toute la chaîne de
        // sauvegarde est retirée : elle n'avait plus d'écrivain depuis 4.4b, et son motif —
        // survivre à une purge d'origine — était faux, puisqu'elle vivait dans CETTE base.
        //
        // ⚠️ Une base existante garde son magasin : la décision A16 exclut toute migration
        // (aucun appareil de terrain ne porte de données), donc on ne le supprime pas au
        // vol. Il devient un magasin orphelin, jamais ouvert, et disparaîtra avec la base.

        // Store 'local_images': Images stored locally for deferred upload (v2)
        if (!db.objectStoreNames.contains("local_images")) {
            const imagesStore = db.createObjectStore("local_images", { keyPath: "id" });
            imagesStore.createIndex("uploaded", "uploaded", { unique: false });
            imagesStore.createIndex("timestamp", "timestamp", { unique: false });
            Log.info("[StorageDB] Created 'local_images' object store");
        }

        // ── v4 (tâche 3.4) — le socle par ENTITÉ, et la file qui remplacera `sync_queue` ──
        //
        // Deux stores neufs, créés VIDES. Aucune migration de données : décision **A16** —
        // l'application n'a pas d'utilisateurs, donc aucun appareil ne porte de v3 à convertir.
        // Cette décision se périme au premier déploiement terrain ; elle est à relire à ce
        // moment-là, pas avant.
        //
        // 🛑 `sync_queue` SURVIT à la v4, et PAS au titre du legacy. Son remplacement par
        // `outbox` est le Sprint 4 (4.4/4.5).
        //
        // ⚠️ **CETTE LIGNE A ANNONCÉ « son retrait la tâche 4.9 » JUSQU'AU 04/08/2026, ET LE
        // RETRAIT N'A PAS EU LIEU.** 4.9 a bien soldé ses trois gisements — les deux
        // vocabulaires, `POI_KINDS`, le doublon C4 des seams — mais la ligne de roadmap ne
        // portait pas le retrait du magasin, et personne n'a confronté les deux énoncés.
        //
        // Ce qui a changé, mesuré à la clôture de S4c : `addpoi` et `editor` **n'y écrivent
        // plus** (4.4b/4.9), `poi-restore` **lit l'outbox** (4.7), et l'export de secours a été
        // repointé (4.10). **Le seul écrivain de production restant est
        // `addpoi/sync-handler-backup.ts`**, pour la RESTAURATION DE SAUVEGARDE — une
        // fonctionnalité vivante, dont le déplacement vers l'`outbox` n'est chiffré nulle part.
        //
        // Le supprimer ici casserait donc encore l'application. Le retrait est suivi par
        // **B-124**, avec ce qu'il exige réellement.

        // Store 'features' : une ENTITÉ par enregistrement (contrat `FeatureRecord`).
        //
        // ⚠️ Il n'est PAS « protégé de l'éviction », il lui est INATTEIGNABLE : `db/eviction.ts`
        // ne connaît qu'un seul nom de store (`layers`). C'est la forme la plus dure possible
        // de la règle du contrat — « ce qui porte du travail non synchronisé n'est jamais
        // évincé » — parce qu'elle ne dépend d'aucun champ correctement écrit.
        if (!db.objectStoreNames.contains("features")) {
            // Clé composée : elle donne gratuitement le parcours par couche, via
            // `IDBKeyRange.bound([layerId], [layerId, []])` — un tableau trie après toute
            // chaîne. Un index `layerId` en plus serait une seconde vérité pour rien.
            const features = db.createObjectStore("features", {
                keyPath: ["layerId", "localId"],
            });
            // ⚠️ `null` n'est pas une clé IndexedDB valide : une entité créée hors ligne
            // (`serverId: null`) N'ENTRE PAS dans cet index. Ce n'est pas un défaut tant que
            // l'index ne sert qu'à retrouver une entité par son identifiant serveur (4.5) —
            // mais compter les entités par lui SOUS-COMPTERAIT. Même mécanisme que B.6, où
            // des booléens restaient hors index.
            features.createIndex("serverId", "serverId", { unique: false });
            features.createIndex("syncState", "syncState", { unique: false });
            features.createIndex("updatedAt", "updatedAt", { unique: false });
            Log.info("[StorageDB] Created 'features' object store (v4)");
        }

        // Store 'outbox' : la file d'écritures, contrat `OutboxEntry`.
        //
        // 🛑 LE CORRECTIF DE B-03 EST DANS LA CLÉ, et c'est pour cela qu'il est ici et pas
        // plus tard : le poser après coup coûterait une v5.
        //
        // `sync_queue` frappe `sync_<ms>_<random>` en clé primaire. À milliseconde égale c'est
        // donc le HASARD qui ordonne, et le tri par horodatage — stable depuis ES2019 — ne
        // fait que TRANSPORTER cet ordre au lieu de le corriger. Trois écritures dans la même
        // milliseconde se relisent en ordre inverse (reproduit : `e2e/fixtures/offline/
        // db-v3-dump.json`).
        //
        // `autoIncrement` met le générateur DANS la base : sa monotonie est celle de l'ordre
        // de validation des transactions — la seule horloge que deux onglets partagent. Un
        // compteur JS ne l'a pas, un horodatage ne l'a pas à la milliseconde, un suffixe
        // aléatoire ne l'a jamais eu. Conséquence : il n'y a plus de tri à corriger, il y a un
        // tri à SUPPRIMER.
        if (!db.objectStoreNames.contains("outbox")) {
            const outbox = db.createObjectStore("outbox", {
                keyPath: "seq",
                autoIncrement: true,
            });
            // `id` reste l'adresse du contrat (`OutboxEntry.id`) mais ne porte plus l'ordre.
            // UNIQUE délibérément : sur un `keyPath: "id"`, deux entrées de même id
            // s'écrasaient en silence — une saisie disparaissait. Ici la collision LÈVE.
            outbox.createIndex("id", "id", { unique: true });
            outbox.createIndex("state", "state", { unique: false });
            // Composé : sert la coalescence (3.10) et la jointure vers `features`.
            outbox.createIndex("localId", ["layerId", "localId"], { unique: false });
            Log.info("[StorageDB] Created 'outbox' object store (v4)");
        }

        // v3 — rewrite `local_images.uploaded` from boolean to 0/1.
        //
        // Booleans are not valid IndexedDB keys, so every record written by v2 stayed OUT
        // of the `uploaded` index and `getPendingImages()` rejected with DataError: queued
        // images were unreachable, never uploaded, and never cleaned (backlog B.6).
        // Rewriting the value is what puts the records into the index — the index itself
        // is unchanged and needs no rebuild.
        //
        // Guarded on oldVersion so a fresh database (created just above, already 0/1) does
        // not pay for a pointless cursor pass.
        if (event.oldVersion > 0 && event.oldVersion < 3) {
            const tx = (event.target as IDBOpenDBRequest).transaction;
            if (tx && db.objectStoreNames.contains("local_images")) {
                let migrated = 0;
                const cursorRequest = tx.objectStore("local_images").openCursor();
                cursorRequest.onsuccess = () => {
                    const cursor = cursorRequest.result;
                    if (!cursor) {
                        if (migrated > 0) {
                            Log.info(
                                `[StorageDB] v3 migration: ${migrated} local image(s) re-flagged 0/1 and indexed`
                            );
                        }
                        return;
                    }
                    const record = cursor.value as { uploaded?: unknown };
                    if (typeof record.uploaded !== "number") {
                        record.uploaded = record.uploaded ? 1 : 0;
                        cursor.update(record);
                        migrated++;
                    }
                    cursor.continue();
                };
                // Never fail the upgrade over the migration: a rejected versionchange
                // leaves the whole database unopenable, which is far worse than images
                // that stay invisible until the next write.
                cursorRequest.onerror = () => {
                    Log.warn(
                        `[StorageDB] v3 migration could not read local_images: ${cursorRequest.error}`
                    );
                };
            }
        }
    },

    // ========================================
    // LAYER METHODS (Delegated to DB.Layers)
    // ========================================

    async cacheLayer(
        id: string,
        data: unknown,
        profileId: string,
        metadata: Record<string, unknown> = {}
    ): Promise<unknown> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Layers");
        if (module) {
            return module?.cacheLayer?.(id, data, profileId, metadata);
        }
        return undefined;
    },

    async getLayer(id: string): Promise<unknown> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Layers");
        if (module) {
            return module?.getLayer?.(id);
        }
        return undefined;
    },

    /**
     * Reads a layer's offline entities back as a GeoJSON FeatureCollection.
     *
     * 🛑 PREMIER LECTEUR DU STORE `features` (tâche 4.3). Le store existe depuis 3.4 et
     * n'avait **ni producteur ni consommateur** : `DBFeatures` n'était référencé que par
     * `db-modules-registry.ts`. Son écrivain est arrivé en 4.1 — voir
     * {@link IndexedDB.putLayerFeatures} juste en dessous.
     *
     * ⚠️ Rend une **FeatureCollection** et non les enregistrements bruts, parce que
     * l'appelant est le chargeur de couche du kernel : il attend la même forme que celle
     * qu'un `fetch` lui aurait rendue, et la faire diverger obligerait le seam à distinguer
     * deux formes — la distinction même que cette lecture existe pour supprimer.
     *
     * ⚠️ Rend `null` — et non une collection VIDE — quand rien n'est stocké. Une collection
     * vide est indiscernable d'une couche réellement vide, et l'appelant doit pouvoir
     * retomber sur le réseau plutôt que d'afficher zéro entité en croyant avoir lu.
     *
     * @param layerId - Identifiant de la couche.
     * @returns La collection, ou `null` si la couche n'a aucune entité stockée.
     */
    async getLayerFeatureCollection(
        layerId: string
    ): Promise<{ type: "FeatureCollection"; features: unknown[] } | null> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Features");
        if (!module?.listByLayer) return null;
        const records = (await module.listByLayer(layerId)) as Array<{
            feature?: unknown;
            localId?: string;
        }> | null;
        if (!Array.isArray(records) || records.length === 0) return null;

        // 🛑 UNE SUPPRESSION LOCALE DOIT DISPARAÎTRE DE LA CARTE (tâche 4.4).
        //
        // L'enregistrement d'une entité supprimée hors ligne SURVIT délibérément : il est le
        // seul endroit où vit son `serverId`, et le push a besoin de savoir QUOI supprimer —
        // l'entrée d'outbox ne porte que le `localId`. Il ne doit donc pas être détruit, mais
        // il ne doit pas non plus être RENDU : l'utilisateur qui supprime hors réseau verrait
        // son entité rester à l'écran, et « l'édition s'applique localement » serait faux de
        // moitié. Le seul endroit qui connaît la différence est la file, d'où cette jointure.
        const edits = this._ensureModule("LocalEdit");
        const deleted = edits?.pendingDeletions
            ? ((await edits.pendingDeletions(layerId)) as Set<string>)
            : new Set<string>();

        const visible = records.filter(
            (r) => r.feature !== undefined && !deleted.has(String(r.localId))
        );
        // Toutes les entités de la couche sont supprimées localement : c'est une couche
        // VIDE, pas une couche non stockée. Rendre `null` ici relancerait le réseau et
        // ferait réapparaître ce que l'utilisateur vient de supprimer.
        return { type: "FeatureCollection", features: visible.map((r) => r.feature) };
    },

    /**
     * Applique une édition locale — l'entité ET sa mise en file, dans UNE transaction (4.4).
     *
     * Miroir d'écriture de {@link IndexedDB.getLayerFeatureCollection} : la façade délègue,
     * elle n'arbitre pas. La coalescence et l'annulation vivent dans `db/local-edit.ts`, seul
     * endroit où les deux stores tiennent dans une même transaction.
     *
     * ⚠️ **Ne vérifie AUCUN droit d'édition.** L'invariant S6 — le rapatriement ne confère
     * jamais l'éditabilité — se tient une couche plus haut, là où la déclaration de la couche
     * est lisible. Le mettre ici en ferait une règle de stockage, donc contournable par tout
     * appelant qui parlerait à la base directement.
     *
     * @param input - L'édition à appliquer.
     * @returns Ce qui a été fait (fusion, annulation, entrée neuve), ou `null` sans module.
     */
    async applyLocalEdit(input: LocalEditInput): Promise<LocalEditTally | null> {
        if (!this._db) await this.init();
        const module = this._ensureModule("LocalEdit");
        if (!module?.applyLocalEdit) return null;
        return (await module.applyLocalEdit(input)) as LocalEditTally;
    },

    /**
     * Writes a pulled batch into the `features` store — the store's FIRST writer (tâche 4.1).
     *
     * Miroir de {@link IndexedDB.getLayerFeatureCollection} : la façade délègue, elle n'arbitre
     * pas. La règle « ne jamais écraser une saisie non synchronisée » vit dans
     * `db/features.ts`, seul endroit où lecture et écriture tiennent dans **une** transaction.
     *
     * ⚠️ Chaque enregistrement doit porter un `feature` défini. `getLayerFeatureCollection`
     * décide son `null` sur `records.length === 0`, **avant** de filtrer les `feature`
     * indéfinis : un lot écrit sans géométrie lui ferait rendre une collection **vide et non
     * nulle**, et le chargeur afficherait zéro entité en croyant avoir lu.
     *
     * @param records - Enregistrements complets, `feature` compris.
     * @returns Le décompte réel `{ written, preserved }`, ou `null` si le module est absent.
     */
    async putLayerFeatures(records: readonly FeatureRecord[]): Promise<PreservingPutTally | null> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Features");
        if (!module?.putManyPreservingLocal) return null;
        return (await module.putManyPreservingLocal(records)) as PreservingPutTally;
    },

    /**
     * Counts what the sync report needs, per layer, in one pass (tâche 4.8).
     *
     * 🛑 **UNE méthode plutôt que quatre.** La composition du rapport a besoin de trois
     * décomptes par couche ; les exposer un à un (`countByLayer`, `listByState`…) élargirait la
     * façade de quatre membres pour un seul consommateur, et déplacerait la connaissance des
     * magasins hors de la couche qui les possède. La façade délègue, elle n'arbitre pas — mais
     * ce qu'elle délègue est le décompte, pas les magasins.
     *
     * ⚠️ **`pendingCount` agrège `pending` + `inFlight` + `failed`.** C'est « ce qui est encore
     * dû au serveur », et `failed` en fait partie : la tâche 3.10 l'a explicitement remis dans
     * l'ensemble rejouable, précisément parce qu'une entrée en échec est une saisie de terrain
     * qui n'a pas d'autre copie. `quarantined` est compté à part — le contrat le décrit comme
     * « gardé, visible, mais non rejouable en l'état », donc ce n'est pas la même dette.
     *
     * @param layerIds - Couches à compter. Une couche sans entité rend des zéros, jamais rien.
     * @returns Les décomptes par identifiant de couche, ou `null` si les modules sont absents.
     * @example
     * const counts = await GeoLeaf.Storage.DB.getSyncCounts(["sites_rosario"]);
     * console.info(counts?.["sites_rosario"]?.featureCount);
     */
    async getSyncCounts(
        layerIds: readonly string[]
    ): Promise<Record<
        string,
        { featureCount: number; pendingCount: number; quarantinedCount: number }
    > | null> {
        if (!this._db) await this.init();
        const features = this._ensureModule("Features");
        const outbox = this._ensureModule("Outbox");
        // Capturés en locales : le rétrécissement de type sur `features?.countByLayer` se perd
        // à la première frontière de fermeture (la boucle plus bas), et `strict` le dit.
        const countByLayer = features?.countByLayer;
        const listByState = outbox?.listByState;
        if (!countByLayer || !listByState) return null;

        const out: Record<
            string,
            { featureCount: number; pendingCount: number; quarantinedCount: number }
        > = {};
        for (const layerId of layerIds) {
            // Les identifiants viennent du profil, c'est-à-dire d'un `JSON.parse` : une couche
            // nommée `__proto__` y est une propriété PROPRE, et `out[k] = …` la routerait sur
            // le setter de prototype. Une couche ainsi nommée n'est simplement pas rapportée.
            if (isUnsafeKey(layerId)) continue;
            // Le seau est tenu en LOCAL puis relu par cette référence : `out[layerId]!` ferait
            // taire `noUncheckedIndexedAccess` d'une assertion, c'est-à-dire ferait sortir la
            // sonde verte PARCE QUE l'assertion est là (règle NNA-04, sans baseline).
            const bucket = { featureCount: 0, pendingCount: 0, quarantinedCount: 0 };
            out[layerId] = bucket;
            bucket.featureCount = (await countByLayer.call(features, layerId)) as number;
        }

        const tally = async (states: readonly string[], field: "pending" | "quarantined") => {
            for (const state of states) {
                const entries = ((await listByState.call(outbox, state)) ?? []) as ReadonlyArray<{
                    layerId?: string;
                }>;
                for (const entry of entries) {
                    const bucket = entry.layerId ? out[entry.layerId] : undefined;
                    if (!bucket) continue;
                    if (field === "pending") bucket.pendingCount += 1;
                    else bucket.quarantinedCount += 1;
                }
            }
        };
        await tally(["pending", "inFlight", "failed"], "pending");
        await tally(["quarantined"], "quarantined");

        return out;
    },

    /**
     * Lists the edits still owed to the server, each joined to the entity it edits (4.10).
     *
     * C'est ce que le panneau « POI locaux » exporte : le TRAVAIL, pas le cache. Une entrée
     * d'outbox ne porte pas la charge utile — elle référence `[layerId, localId]` —, donc la
     * jointure vers `features` se fait ici, où les deux magasins sont ouverts.
     *
     * ⚠️ Une entrée dont l'entité a disparu du magasin est rendue avec `feature: null` plutôt
     * qu'écartée. Une saisie qu'on ne sait plus décrire reste une saisie due au serveur ; la
     * taire dans un export dont c'est précisément le rôle de tout sortir serait la perdre.
     *
     * @returns Une entrée par édition en attente, la plus ancienne d'abord ; `[]` sans module.
     * @example
     * const pending = await GeoLeaf.Storage.DB.listPendingEdits();
     * console.info(`${pending.length} saisie(s) jamais poussée(s)`);
     */
    async listPendingEdits(): Promise<
        Array<{
            entryId: string;
            kind: string;
            layerId: string;
            localId: string;
            state: string;
            createdAt: number;
            feature: unknown;
        }>
    > {
        if (!this._db) await this.init();
        const features = this._ensureModule("Features");
        const outbox = this._ensureModule("Outbox");
        const listByState = outbox?.listByState;
        const get = features?.get;
        if (!listByState || !get) return [];

        const out = [];
        for (const state of ["pending", "inFlight", "failed", "quarantined"]) {
            const entries = ((await listByState.call(outbox, state)) ?? []) as ReadonlyArray<{
                id?: string;
                kind?: string;
                layerId?: string;
                localId?: string;
                createdAt?: number;
            }>;
            for (const entry of entries) {
                if (!entry.layerId || !entry.localId) continue;
                const record = (await get.call(features, entry.layerId, entry.localId)) as {
                    feature?: unknown;
                } | null;
                out.push({
                    entryId: String(entry.id ?? ""),
                    kind: String(entry.kind ?? ""),
                    layerId: entry.layerId,
                    localId: entry.localId,
                    state,
                    createdAt: Number(entry.createdAt ?? 0),
                    feature: record?.feature ?? null,
                });
            }
        }
        return out.sort((a, b) => a.createdAt - b.createdAt);
    },

    /**
     * Removes the entities that are pure CACHE — synchronised, and re-pullable (4.10).
     *
     * 🛑 **CE QUI FAIT QUE LE NOM DU BOUTON DEVIENT VRAI.** Depuis 4.1, le magasin `features`
     * EST le cache : ses enregistrements `synced` se re-rapatrient par `pullLayer()`. L'outbox,
     * elle, porte du travail de terrain qui n'existe nulle part ailleurs. Une purge qui
     * annonce « vider le cache » ne doit donc toucher que le premier — vocabulaire de cache,
     * données re-téléchargeables, et rien d'autre.
     *
     * ⚠️ **La garde sur l'outbox est là bien que l'invariant de 4.4 la rende théoriquement
     * inutile** : `applyEdit` écrit l'entité en `pending` en même temps que l'entrée, donc un
     * enregistrement `synced` ne devrait avoir aucune entrée en attente. « Ne devrait pas » ne
     * garde rien — et l'enjeu ici est une destruction irréversible de saisie.
     *
     * @returns `{ removed, preserved }` — `preserved` compte les entités épargnées parce
     *   qu'une entrée d'outbox les réclame encore. Les deux sont affichables.
     * @example
     * const { removed, preserved } = await GeoLeaf.Storage.DB.purgeCachedFeatures();
     * console.info(`${removed} supprimée(s), ${preserved} conservée(s)`);
     */
    async purgeCachedFeatures(): Promise<{ removed: number; preserved: number }> {
        if (!this._db) await this.init();
        const features = this._ensureModule("Features");
        const outbox = this._ensureModule("Outbox");
        const listByState = features?.listByState;
        const removeOne = features?.remove;
        if (!listByState || !removeOne) return { removed: 0, preserved: 0 };

        // Les entités encore réclamées par une entrée d'outbox, en `layerId\u0000localId`.
        // ⚠️ `Set` et non un objet : la clé est composée à partir de données, et un objet
        // exposerait `__proto__` (cf. `check-dynamic-key-writes`).
        const owed = new Set<string>();
        if (outbox?.listByState) {
            for (const state of ["pending", "inFlight", "failed", "quarantined"]) {
                const entries = ((await outbox.listByState(state)) ?? []) as ReadonlyArray<{
                    layerId?: string;
                    localId?: string;
                }>;
                for (const e of entries) {
                    if (e.layerId && e.localId) owed.add(`${e.layerId}\u0000${e.localId}`);
                }
            }
        }

        const synced = ((await listByState.call(features, "synced")) ?? []) as ReadonlyArray<{
            layerId: string;
            localId: string;
        }>;
        let removed = 0;
        let preserved = 0;
        for (const record of synced) {
            if (owed.has(`${record.layerId}\u0000${record.localId}`)) {
                preserved += 1;
                continue;
            }
            await removeOne.call(features, record.layerId, record.localId);
            removed += 1;
        }
        return { removed, preserved };
    },

    async removeLayer(id: string): Promise<unknown> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Layers");
        if (module) {
            return module?.removeLayer?.(id);
        }
        return undefined;
    },

    async getLayersByProfile(profileId: string): Promise<unknown> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Layers");
        if (module) {
            return module?.getLayersByProfile?.(profileId);
        }
        return undefined;
    },

    async clearProfile(profileId: string): Promise<unknown> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Layers");
        if (module) {
            return module?.clearProfile?.(profileId);
        }
        return undefined;
    },

    // ========================================
    // 🛑 LES SEPT RELAIS `sync_queue` SONT RETIRÉS (tâche 4.11)
    // ========================================
    //
    // `addToSyncQueue`, `getAllFromSyncQueue`, `getPendingSyncQueue`, `updateSyncQueueStatus`,
    // `getSyncQueueEntry`, `getSyncQueueSummary` et `removeSyncQueueEntry` déléguaient au
    // module `DB.Sync` (`db/sync.ts`), supprimé avec le magasin `sync_queue`.
    //
    // La décision A16 dit depuis le 02/08 que le magasin « ne survit pas en v4 ». Le
    // commentaire du schéma attribuait son retrait à la tâche **4.9** ; la ligne 4.9 ne l'a
    // jamais porté — deux documents, deux vérités, aucun lecteur commun. C'est B-124 qui a
    // établi l'écart, et 4.11 qui l'exécute.
    //
    // Ce que le Sprint 4 avait déjà déplacé : `addpoi` (4.4b) et `editor` (4.9) écrivent par
    // `Storage.applyEdit` → outbox, `poi-restore` lit l'outbox (4.7), `offline-ui` lit
    // `features` + outbox (4.10). Le seul usage restant était la restauration de sauvegarde,
    // retirée avec sa chaîne juste au-dessus.
    //
    // ⚠️ **Ce qui part avec, et qu'il faut savoir** : `MAX_REPLAY_ATTEMPTS = 3` était appliqué
    // ICI, à l'écriture, et c'était le seul plafond de rejeu du dépôt. L'outbox porte bien un
    // champ `attempts`, mais `write/push-engine.ts` ne l'incrémente ni ne le plafonne — le
    // budget était donc DÉJÀ absent du chemin v4, et ce retrait le révèle au lieu de le
    // causer. Suivi en **B-125**.

    // ========================================
    // PREFERENCES & STATS (Delegated to DB.Preferences)
    // ========================================

    /**
     * Relaie le rapport de stockage de `DB.Preferences`.
     *
     * ⚠️ **Ce relais déclarait MOINS que ce que le module rend, et il le déclarait faux.** Sa
     * forme était `{ used, quota, percentage, layersCount, syncQueueCount }` : elle nommait un
     * compteur du magasin v3 — retiré à la tâche 4.11 — et **omettait `featuresCount` et
     * `outboxCount`**, que `preferences.ts` renseigne depuis B-121. Un appelant du chemin
     * dégradé recevait donc un objet dont deux champs manquaient sans que le type le dise.
     *
     * @returns Le quota, l'usage, et les décomptes des trois magasins qui portent de la donnée.
     */
    async getStorageStats(): Promise<StorageStatsReport> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Preferences");
        const empty: StorageStatsReport = {
            used: 0,
            quota: 0,
            percentage: 0,
            layersCount: 0,
            featuresCount: 0,
            outboxCount: 0,
        };
        if (module) {
            return (module?.getStorageStats?.() as StorageStatsReport | undefined) ?? empty;
        }
        return empty;
    },

    async setPreference(key: string, value: unknown): Promise<unknown> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Preferences");
        if (!module) {
            throw new Error(
                "[StorageDB] Preferences module not available. Ensure storage/db/preferences.js is loaded."
            );
        }
        return module?.setPreference?.(key, value);
    },

    async getPreference(key: string, defaultValue: unknown = null): Promise<unknown> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Preferences");
        if (!module) {
            throw new Error(
                "[StorageDB] Preferences module not available. Ensure storage/db/preferences.js is loaded."
            );
        }
        return module?.getPreference?.(key, defaultValue);
    },

    // ========================================
    // 🛑 LES QUATRE RELAIS DE SAUVEGARDE SONT RETIRÉS (tâche 4.11)
    // ========================================
    //
    // `createBackup`, `getBackups`, `getBackup` et `cleanOldBackups` déléguaient au module
    // `DB.Backups`, lui-même supprimé avec le magasin `sync_backups`. Le retrait ne repose
    // pas sur « c'est du code mort » mais sur trois mesures :
    //
    //   1. **Aucun écrivain.** Le seul appelant de `createBackup` était
    //      `addpoi/sync-handler-backup.ts`, atteignable depuis `_createBackup()`, qui n'avait
    //      lui-même AUCUN appelant de production depuis que 4.4b a réécrit `processSyncQueue`
    //      pour déléguer à `pushOutbox`. Le magasin ne recevait plus rien, et le panneau
    //      d'`offline-ui` affichait « aucune sauvegarde » par construction.
    //   2. **Le motif était faux sur le mécanisme.** La chaîne était justifiée (B-116) comme
    //      « le dernier rempart après une purge d'origine » — le cas iOS, WebKit purgeant
    //      après 7 jours. Or `sync_backups` était un magasin de CETTE base : la purge qu'il
    //      devait couvrir le détruisait avec le reste.
    //   3. **Le rôle est couvert deux fois ailleurs.** L'outbox interdit contractuellement de
    //      détruire une entrée, et l'export JSON d'`offline-ui` sort du navigateur — lui
    //      survit réellement à une purge d'origine.
    //
    // ⚠️ La note du dessous disait que `cleanOldBackups` « reste appelée à l'init() du
    // gestionnaire de synchronisation », et c'était vrai. Purger un magasin que personne
    // n'alimente ne conserve rien : elle part avec ce qu'elle purgeait.

    // ========================================
    // IMAGE STORAGE METHODS (Delegated to DB.Images)
    // ========================================

    async storeImageLocally(imageData: unknown): Promise<unknown> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Images");
        if (module) {
            return module?.storeImageLocally?.(imageData);
        }
        return undefined;
    },

    // ⚠️ `getLocalImage()` retiré de la façade (3.13) : son unique consommateur était
    // `addpoi/image-upload.ts` → `getLocalImageUrl()`, redondant avec la data-URL base64 que
    // le même module écrit dans la donnée du POI. Les deux partent ensemble.
    //
    // ⚠️ `getPendingImages` et `updateImageUploadStatus` RESTENT, et ce n'est plus une réserve :
    // ils sont CÂBLÉS depuis le Sprint 5 par `editor/persistence/image-store.ts`
    // (`retryPendingImages`), lui-même armé par `initImageUpload()`. Cette ligne a dit
    // « ils servent `retryPendingUploads()`, requalifiée vers 4.5 » jusqu'au 08/08/2026 :
    // 4.5 ne l'a jamais câblée, le Sprint 4 s'est clos sans elle, et c'est le Sprint 5 qui a
    // rendu la chaîne vivante — sous un autre nom, dans un autre paquet.
    async getPendingImages(): Promise<unknown> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Images");
        if (module) {
            return module?.getPendingImages?.();
        }
        return undefined;
    },

    async updateImageUploadStatus(id: string, status: string): Promise<unknown> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Images");
        if (module) {
            return module?.updateImageUploadStatus?.(id, status);
        }
        return undefined;
    },

    async deleteLocalImage(id: string): Promise<unknown> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Images");
        if (module) {
            return module?.deleteLocalImage?.(id);
        }
        return undefined;
    },

    // 🛑 RELAIS POSÉ LE 08/08/2026 (B-190) — la purge existait et n'était JOIGNABLE PAR PERSONNE.
    // `cleanUploadedImages` vivait dans le module `Images` sans relais ici, donc absente de
    // `GeoLeaf.Storage.DB` et du namespace : 0 appelant possible, pendant que `storeImageLocally`
    // écrivait des photos de terrain. Le store avait un écrivain et aucune purge — exactement le
    // dégât que l'en-tête de `db/images.ts` disait vouloir éviter, réalisé par l'autre bout.
    async cleanUploadedImages(): Promise<unknown> {
        if (!this._db) await this.init();
        const module = this._ensureModule("Images");
        if (module) {
            return module?.cleanUploadedImages?.();
        }
        return undefined;
    },

    /**
     * Closes the database connection
     */
    close() {
        if (this._db && !("_isStub" in this._db)) {
            this._db.close();
        }
        this._db = null;
        this._modules = {};
        Log.info("[StorageDB] Database connection closed");
    },
};

// CAPACITÉS S1 — the `if (Log)` guard was dead (Log is a Proxy, always truthy) and it
// wrapped a module-load introspection dump: key counts, the first ten keys, sample
// `typeof` probes. Its arguments were built on EVERY load whatever the log level, since
// `Log.debug` only tests the level once called. Removed; what remains is the one line
// its five sibling `db/` modules also emit.
Log.debug("[StorageDB] Module loaded");

/**
 * Public name of the {@link StorageDB} façade: opens the offline database, wires the
 * `db/` modules through {@link DBModulesRegistry}, and forwards the layer/sync/image/
 * backup/preference operations to whichever module owns each object store.
 *
 * This is the handle `offline-engine-entry.ts` passes to `GeoLeaf.Storage.wireModules()`.
 */
const IndexedDB = StorageDB;

export { IndexedDB };
