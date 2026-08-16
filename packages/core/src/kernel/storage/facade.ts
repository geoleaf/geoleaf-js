/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description In-core public facade for the offline storage engine (S14 Phase B).
 * Exposes {@link Storage} which orchestrates IndexedDB (`DB`), the CacheAPI
 * cache manager (`CacheManager`) and the offline detector (`OfflineDetector`).
 *
 * @remarks
 * The facade is **decoupled from the engine**: it holds no engine code, only
 * references injected via {@link Storage.wireModules}. It self-mounts on
 * `globalThis.GeoLeaf.Storage` at import time (pulled into the boot graph by
 * `globals.storage`, which re-exports this via the thin `geoleaf.storage` facade)
 * so it is present at boot (getters return `null` until wired).
 *
 * The engine is wired by the `offline` capability's dynamic
 * `offline-engine-entry.ts` — the composition root and the **sole** caller of
 * {@link Storage.wireModules} — loaded on demand via
 * `CapabilityRegistry.ensureLoaded("offline")`, off the boot path.
 *
 * `Storage.init(options)` initialises every available sub-module and emits
 * `geoleaf:storage:initialized`. Service Worker registration lives in the `pwa`
 * capability (unified `sw-core.js`) — not here.
 *
 * @see {@link Storage}
 * @version 3.0.0
 */

import { Log } from "../../utils/log/index.js";
import { StorageContract } from "../shared/storage-contract.js";
import { mayEditLayer } from "../shared/edition-permissions.js";
import type { LayerSyncReport } from "../../contracts/sync.contract.js";

interface GeoLeafStorageGlobal {
    GeoLeaf?: {
        _OfflineDetector?: unknown;
        Storage?: unknown;
    };
}

interface StorageInitOptions {
    indexedDB?: { name?: string; version?: number };
    cache?: Record<string, unknown>;
    offline?: Record<string, unknown>;
    enableOfflineDetector?: boolean;
}

/**
 * Optimistic-edit module, injected by the offline capability (tâche 4.4).
 *
 * Structural, like {@link PullLike}: la façade vit dans le graphe de boot, l'édition dans le
 * chunk différé.
 */
interface EditLike {
    pushOutbox: () => Promise<StoragePushReport>;
    /** Sorties de quarantaine — tâche 8.4 (B-123). Voir `write/quarantine-api.ts`. */
    requeueQuarantined: (id: string) => Promise<StorageQuarantineOutcome>;
    discardQuarantined: (id: string, confirmedLocalId: string) => Promise<StorageQuarantineOutcome>;
    applyEdit: (input: {
        layerId: string;
        kind: "create" | "update" | "delete";
        localId?: string;
        feature?: unknown;
        baseVersion?: { kind: "etag" | "timestamp"; value: string } | null;
    }) => Promise<StorageEditReport>;
}

/**
 * Compte rendu d'une sortie de quarantaine — miroir de `write/quarantine-api.ts`.
 *
 * `refused` dit POURQUOI la sortie n'a pas eu lieu, plutôt que de rendre un `false` muet :
 * « la cause n'est pas levable » et « la cause est encore là » appellent deux gestes
 * différents de l'opérateur.
 */
interface StorageQuarantineOutcome {
    readonly ok: boolean;
    readonly refused?: string;
}

/** Report returned by {@link Storage.pushOutbox} — mirrors `capabilities/offline/write/push-engine.ts`. */
interface StoragePushReport {
    readonly attempted: number;
    readonly pushed: number;
    readonly failed: number;
    readonly alreadyPresent: number;
    readonly conflicts: number;
    readonly refused: string | null;
}

/** Report returned by {@link Storage.applyEdit} — mirrors `capabilities/offline/write/local-edit-api.ts`. */
interface StorageEditReport {
    readonly layerId: string;
    readonly localId: string;
    readonly kind: "create" | "update" | "delete";
    readonly entryId: string | null;
    readonly queued: boolean;
    readonly coalescedInto: string | null;
    readonly annulled: boolean;
    readonly refused: string | null;
}

/**
 * Bounded-pull module, injected by the offline capability (tâche 4.1).
 *
 * Structural rather than imported: the façade lives in the boot graph, the pull lives in the
 * deferred offline chunk. A type-only import would be free at runtime, but naming the chunk
 * here is what makes the next reader believe the façade owns it — it does not.
 */
interface PullLike {
    pullLayer: (
        layerId: string,
        options?: {
            bbox?: [number, number, number, number];
            signal?: AbortSignal;
        }
    ) => Promise<StorageLayerPullReport>;
}

/**
 * Le module de rapport, injecté par le chunk différé (tâche 4.8).
 *
 * ⚠️ **`LayerSyncReport` est IMPORTÉ du contrat, pas re-décrit ici**, contrairement à
 * {@link StorageLayerPullReport} au-dessus. L'import est `type`-only donc effacé au build : il
 * ne coûte rien au graphe de boot, et il évite d'ouvrir un second exemplaire d'une forme que le
 * contrat déclare déjà. C'est la leçon du compteur C4, soldé par 4.9 — deux déclarations d'un
 * même contrat ne divergent pas bruyamment, elles s'accordent et se trompent ensemble.
 */
interface ReportLike {
    buildSyncReport: (now?: number) => Promise<readonly LayerSyncReport[]>;
}

/** Report returned by {@link Storage.pullLayer} — mirrors `capabilities/offline/pull/layer-pull.ts`. */
interface StorageLayerPullReport {
    readonly layerId: string;
    readonly fetched: number;
    readonly written: number;
    readonly preserved: number;
    readonly skipped: number;
    readonly capped: boolean;
    readonly aborted: boolean;
    readonly refused: string | null;
}

/**
 * Plafond de l'attente du moteur dans {@link Storage.pullLayer}.
 *
 * Même valeur et même motif que `OFFLINE_ENGINE_WAIT_MS` de
 * `kernel/geojson/loader/single-layer.ts` : le chunk se câble en ~85 ms au boot mesuré, et
 * `whenReady()` ne résout jamais sans `modules.offline`.
 */
const PULL_ENGINE_WAIT_MS = 3000;

interface DBLike {
    _db?: IDBDatabase | null;
    _dbName?: string;
    _dbVersion?: number;
    init: () => Promise<unknown>;
    close?: () => void;
    getStorageStats?: () => Promise<{
        used: number;
        quota: number;
        percentage: number;
        layersCount?: number;
        featuresCount?: number;
        outboxCount?: number;
    }>;
    getLayersByProfile?: (profileId: string) => Promise<unknown[]>;
}

interface CacheManagerLike {
    init: (config: Record<string, unknown>) => void;
    listCachedProfiles: () => Promise<string[]>;
    clearProfile: (profileId: string) => Promise<number>;
    estimateProfileSize: (
        profileId: string
    ) => Promise<{ totalSize: number; totalSizeFormatted?: string }>;
    getStorageQuota: () => Promise<{ available?: number }>;
    cacheProfile: (profileId: string) => Promise<unknown>;
    isProfileCached: (profileId: string) => Promise<boolean>;
}

interface OfflineDetectorLike {
    init: (opts: Record<string, unknown>) => void;
    isOnline: () => boolean;
    destroy?: () => void;
}

const _g: GeoLeafStorageGlobal =
    typeof globalThis !== "undefined"
        ? (globalThis as unknown as GeoLeafStorageGlobal)
        : typeof window !== "undefined"
          ? (window as unknown as GeoLeafStorageGlobal)
          : {};
_g.GeoLeaf = _g.GeoLeaf || {};

const Storage = {
    /** Implementation modules injected by `entry.ts` (composition root) at boot. */
    _modules: {} as {
        db?: DBLike;
        cacheManager?: CacheManagerLike;
        cache?: unknown;
        pull?: PullLike;
        report?: ReportLike;
        edit?: EditLike;
    },

    /**
     * Wire the assembled implementation modules into the facade. Called once by
     * `entry.ts` after every sub-module has been imported and assembled.
     */
    wireModules(modules: {
        db?: unknown;
        cacheManager?: unknown;
        cache?: unknown;
        pull?: unknown;
        report?: unknown;
        edit?: unknown;
    }): void {
        this._modules = modules as {
            db?: DBLike;
            cacheManager?: CacheManagerLike;
            cache?: unknown;
            pull?: PullLike;
            report?: ReportLike;
            edit?: EditLike;
        };
    },

    /**
     * IndexedDB layer accessor — read by `StorageContract.DB`.
     * @returns the IndexedDB module, or `undefined` if the plugin is not loaded.
     */
    get DB(): DBLike | undefined {
        return this._modules.db;
    },

    /**
     * CacheAPI cache manager accessor — read by `StorageContract.CacheManager`.
     * @returns the CacheManager module, or `undefined` if unavailable.
     */
    get CacheManager(): CacheManagerLike | undefined {
        return this._modules.cacheManager;
    },

    /**
     * Network state detector resolved lazily from `globalThis.GeoLeaf`.
     * @returns the OfflineDetector module, or `undefined` if disabled/unavailable.
     */
    get OfflineDetector(): OfflineDetectorLike | undefined {
        return _g.GeoLeaf?._OfflineDetector as OfflineDetectorLike | undefined;
    },

    /**
     * Cache namespace (`{ Storage, LayerSelector }`) — read by `StorageContract.Cache`
     * (download-handler, selection-cache, cache-control-zone).
     */
    get Cache(): unknown {
        return this._modules.cache;
    },

    /**
     * Plugin Contract v1 accessor for the IndexedDB layer.
     * @returns the IndexedDB module, or `undefined` if the plugin is not loaded.
     */
    get db(): DBLike | undefined {
        return this.DB;
    },

    /**
     * Plugin Contract v1 accessor for the CacheAPI cache manager.
     * @returns the CacheManager module, or `undefined` if unavailable.
     */
    get cacheManager(): CacheManagerLike | undefined {
        return this.CacheManager;
    },

    /**
     * Plugin Contract v1 accessor for the cache namespace (`{ Storage, LayerSelector }`).
     */
    get cache(): unknown {
        return this.Cache;
    },

    /**
     * Initialise every available storage sub-module (IndexedDB, CacheManager,
     * optionally the offline detector and the Storage plugin's Service Worker).
     * @param options - per-module options; `enableOfflineDetector` and
     * `enableServiceWorker` are opt-in (default `false`).
     * @returns `true` once all available modules are initialised.
     * @throws if a sub-module initialisation fails.
     * @remarks Emits `geoleaf:storage:initialized` on success.
     */
    async init(options: StorageInitOptions = {}): Promise<boolean> {
        Log.info("[Storage] Initializing storage modules...");

        const { indexedDB = {}, cache = {}, offline = {}, enableOfflineDetector = false } = options;

        try {
            if (this.DB) {
                if (indexedDB.name) this.DB._dbName = indexedDB.name;
                if (indexedDB.version) this.DB._dbVersion = indexedDB.version;

                await this.DB.init();
                Log.info("[Storage] IndexedDB initialized");
            } else {
                Log.warn("[Storage] IndexedDB module not available");
            }

            if (this.CacheManager) {
                this.CacheManager.init(cache);
                Log.info("[Storage] Cache Manager initialized");
            } else {
                Log.warn("[Storage] Cache Manager module not available");
            }

            if (enableOfflineDetector && this.OfflineDetector) {
                this.OfflineDetector.init(offline);
                Log.info("[Storage] Offline Detector enabled and initialized");
            } else if (!enableOfflineDetector) {
                Log.info("[Storage] Offline Detector disabled (enableOfflineDetector: false)");
            } else {
                Log.warn("[Storage] Offline Detector module not available");
            }

            // Service Worker registration is owned by the core PWA capability now
            // (unified sw-core.js, gated by `modules.pwa.enabled` — S14 Phase A). The
            // storage plugin no longer registers its own SW; the unified SW serves
            // tiles from the IndexedDB `layers` store that this engine fills.

            Log.info("[Storage] All storage modules initialized successfully");

            document.dispatchEvent(new CustomEvent("geoleaf:storage:initialized"));

            return true;
        } catch (error) {
            const errorMsg = `[Storage] Initialization failed: ${(error as Error).message}`;
            Log.error(errorMsg);
            throw new Error(errorMsg, { cause: error });
        }
    },

    /**
     * @returns `true` when the IndexedDB connection is open (plugin ready).
     */
    isAvailable(): boolean {
        return !!(this.DB && this.DB._db !== null && this.DB._db !== undefined);
    },

    /**
     * `true` dès que le moteur hors-ligne s'est enregistré — indépendamment de l'ouverture
     * d'IndexedDB, que teste {@link isAvailable}.
     *
     * ⚠️ API publique S4.4 — délégation ajoutée pour que `@geoleaf-plugins/offline-ui` cesse
     * d'importer `StorageContract`. Le contrat est un SINGLETON dont l'état est un `let` de
     * portée module : un plugin chargé en `<script type="module">` a son propre graphe et ne
     * peut pas le partager. La copie qu'il embarquait n'était jamais initialisée — ce membre
     * lui donne la vraie, par le namespace.
     */
    isPluginLoaded(): boolean {
        return StorageContract.isPluginLoaded();
    },

    /**
     * Résout quand le moteur hors-ligne est prêt à piloter.
     *
     * ⚠️ Ne résout JAMAIS tant que `modules.offline` est désactivé — le moteur ne se charge
     * pas, et les actions d'UI qui l'attendent défèrent indéfiniment. C'est le comportement du
     * contrat, repris tel quel. Même motif de délégation que {@link isPluginLoaded}.
     */
    whenReady(): Promise<void> {
        return StorageContract.whenReady();
    },

    /**
     * Pulls a declared layer's entities into the local `features` store (tâche 4.1).
     *
     * Bounded by the layer's `offline.maxFeatures` and, optionally, by a bounding box.
     * Downloading NEVER grants write access: the records land as `synced` and no queue entry
     * is created (invariant S6 of the sync contract).
     *
     * ⏱ **Attend le moteur, mais pas indéfiniment.** L'implémentation vit dans le chunk
     * offline, chargé en `import()` **après** le boot — l'appeler à la première frame la
     * trouverait absente. La course est bornée à {@link PULL_ENGINE_WAIT_MS} parce que
     * `StorageContract.whenReady()` **ne résout jamais** quand `modules.offline` est
     * désactivé : sans borne, l'appel pendrait pour toujours sur une variante sans moteur.
     *
     * ⚠️ Contrairement à la lecture de couche, il n'y a **aucun repli réseau** ici. Un
     * rapatriement sans moteur doit se DIRE — `refused: "engineUnavailable"` — et non rendre
     * un zéro que rien ne distingue d'une couche vide.
     *
     * @param layerId - Identifiant de la couche à rapatrier.
     * @param options - Emprise `bbox` et signal d'abandon.
     * @returns Le rapport de rapatriement ; `refused` est non nul quand rien n'a été écrit.
     * @example
     * const report = await GeoLeaf?.Storage?.pullLayer?.("sites_rosario");
     * console.info(report?.written, report?.preserved, report?.capped);
     */
    async pullLayer(
        layerId: string,
        options?: { bbox?: [number, number, number, number]; signal?: AbortSignal }
    ): Promise<StorageLayerPullReport> {
        if (!this._modules.pull) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const timedOut = new Promise<void>((resolve) => {
                timer = setTimeout(resolve, PULL_ENGINE_WAIT_MS);
            });
            await Promise.race([StorageContract.whenReady(), timedOut]);
            if (timer) clearTimeout(timer);
        }

        const pull = this._modules.pull;
        if (!pull) {
            Log.warn(
                `[GeoLeaf.Storage] pullLayer("${layerId}") — moteur hors-ligne non câblé après ${PULL_ENGINE_WAIT_MS} ms.`
            );
            return {
                layerId,
                fetched: 0,
                written: 0,
                preserved: 0,
                skipped: 0,
                capped: false,
                aborted: false,
                refused: "engineUnavailable",
            };
        }
        return pull.pullLayer(layerId, options);
    },

    /**
     * Applies an edit locally AND queues it for the server — the optimistic write (tâche 4.4).
     *
     * L'entité part dans le store `features` et l'opération dans l'`outbox`, **dans une seule
     * transaction** : une saisie de terrain n'a pas d'autre copie, et une écriture à moitié
     * faite serait indétectable après coup.
     *
     * ⚠️ **Rien de ce qui est écrit ici ne confère l'éditabilité** (invariant S6) — au
     * contraire, l'appel est REFUSÉ, avec son motif, quand la couche n'est pas modifiable en
     * ligne. Télécharger une couche n'a jamais rendu une couche modifiable.
     *
     * Attente bornée du moteur, même motif que {@link Storage.pullLayer} : le chunk offline
     * est différé, et `whenReady()` ne résout jamais sans `modules.offline`.
     *
     * @param input - La couche, le type d'opération, l'identité locale et l'entité.
     * @returns Le rapport : entrée créée, fusionnée, ou annulée ; `refused` porte le motif.
     * @example
     * const report = await GeoLeaf?.Storage?.applyEdit?.({
     *     layerId: "sites_rosario", kind: "update", localId: "loc:abc", feature
     * });
     * console.info(report?.queued, report?.coalescedInto);
     */
    async applyEdit(input: {
        layerId: string;
        kind: "create" | "update" | "delete";
        localId?: string;
        feature?: unknown;
        baseVersion?: { kind: "etag" | "timestamp"; value: string } | null;
    }): Promise<StorageEditReport> {
        if (!this._modules.edit) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const timedOut = new Promise<void>((resolve) => {
                timer = setTimeout(resolve, PULL_ENGINE_WAIT_MS);
            });
            await Promise.race([StorageContract.whenReady(), timedOut]);
            if (timer) clearTimeout(timer);
        }

        const edit = this._modules.edit;
        if (!edit) {
            Log.warn(
                `[GeoLeaf.Storage] applyEdit("${input.layerId}") — moteur hors-ligne non câblé après ${PULL_ENGINE_WAIT_MS} ms.`
            );
            return {
                layerId: input.layerId,
                localId: input.localId ?? "",
                kind: input.kind,
                entryId: null,
                queued: false,
                coalescedInto: null,
                annulled: false,
                refused: "engineUnavailable",
            };
        }
        return edit.applyEdit(input);
    },

    /**
     * La couche accorde-t-elle cette opération ? — à consulter AVANT d'écrire.
     *
     * 🛑 **C'est la réponse à B-138, et elle est SYNCHRONE ET SANS MOTEUR, délibérément.**
     * La permission se lit dans le profil actif, pas dans IndexedDB : la router par le sac
     * `edit` (comme {@link Storage.applyEdit}) l'aurait rendue indisponible quand le chunk
     * hors-ligne n'est pas chargé — c'est-à-dire **exactement** dans le cas qui portait le
     * trou, `@geoleaf-plugins/editor` déclarant `requires: []` et tournant en
     * `persistence.mode: "online"` sans ce moteur.
     *
     * ⚠️ **Ne remplace pas la garde d'`applyEdit`, elle la précède.** `applyEdit` continue de
     * refuser pour son propre compte : un appelant qui ne consulterait pas ce prédicat ne
     * contourne rien. Les deux appliquent `grantsEdition`, la même fonction.
     *
     * ⚠️ Une couche inconnue rend `false` — refuser l'inconnu, sans quoi une faute de frappe
     * dans un identifiant vaudrait autorisation.
     *
     * @param layerId - L'identifiant de couche du profil actif.
     * @param kind - L'opération soumise.
     * @returns `true` seulement si la couche accorde littéralement cette opération.
     * @example
     * if (GeoLeaf?.Storage?.mayEdit?.("reference-points", "delete")) {
     *     console.info("la couche accorde la suppression");
     * }
     */
    mayEdit(layerId: string, kind: "create" | "update" | "delete"): boolean {
        return mayEditLayer(layerId, kind);
    },

    /**
     * Drains the outbox: pushes every queued edit and reconciles server identities (4.5).
     *
     * ⚠️ **Tourne dans la PAGE, jamais dans le Service Worker** — point 5 du contrat. Le
     * patch `fetch` du connector vit dans la page ; un rejeu depuis le worker ne le voit pas
     * et partirait sans jeton. C'est le motif qui a fait supprimer le chemin Background Sync.
     *
     * Ne jette pas : une entrée qui échoue reste en file, `failed` n'étant pas terminal.
     *
     * @returns Le décompte du drain ; `refused` est non nul si le moteur n'est pas câblé.
     * @example
     * const report = await GeoLeaf?.Storage?.pushOutbox?.();
     * console.info(report?.pushed, report?.failed);
     */
    async pushOutbox(): Promise<StoragePushReport> {
        const edit = this._modules.edit;
        if (!edit) {
            Log.warn("[GeoLeaf.Storage] pushOutbox — moteur hors-ligne non câblé.");
            return {
                attempted: 0,
                pushed: 0,
                failed: 0,
                alreadyPresent: 0,
                conflicts: 0,
                refused: "engineUnavailable",
            };
        }
        return edit.pushOutbox();
    },

    /**
     * Remet en file une entrée mise en quarantaine, quand sa cause est LEVÉE.
     *
     * Réservée aux motifs dont la cause peut être constatée levée — `retryBudgetExhausted`,
     * `layerNoLongerWritable` et `notImplementedByServer`. Les deux autres nomment un fait du
     * serveur qu'aucun geste local ne défait : leur sortie est
     * {@link Storage.discardQuarantined}.
     *
     * @param id - Identifiant de contrat de l'entrée.
     * @returns `{ok}` et, en cas de refus, son motif.
     * @example
     * const out = await GeoLeaf?.Storage?.requeueQuarantined?.("create:sites:loc:abc:1");
     * if (!out?.ok) console.warn(out?.refused);
     */
    async requeueQuarantined(id: string): Promise<StorageQuarantineOutcome> {
        const edit = this._modules.edit;
        if (!edit) {
            Log.warn("[GeoLeaf.Storage] requeueQuarantined — moteur hors-ligne non câblé.");
            return { ok: false, refused: "engineUnavailable" };
        }
        return edit.requeueQuarantined(id);
    },

    /**
     * Détruit une entrée en quarantaine, sur confirmation EXPLICITE.
     *
     * 🛑 `confirmedLocalId` doit être le `localId` de l'entrée — une valeur que l'appelant ne
     * connaît qu'en l'ayant LISTÉE. C'est ce qui rend structurellement vrai le fait que la
     * saisie a été énumérée avant d'être jetée, ce qu'exige `ServerDeletionPolicy` depuis son
     * amendement de la tâche 8.4 : ce que le contrat interdit est la perte que l'opérateur
     * n'a pas VUE.
     *
     * @param id - Identifiant de contrat de l'entrée.
     * @param confirmedLocalId - Le `localId` de cette entrée, tel que l'appelant l'a lu.
     * @returns `{ok}` et, en cas de refus, son motif.
     * @example
     * const [e] = (await GeoLeaf?.Storage?.listPendingEdits?.()) ?? [];
     * if (e) await GeoLeaf?.Storage?.discardQuarantined?.(e.id, e.localId);
     */
    async discardQuarantined(
        id: string,
        confirmedLocalId: string
    ): Promise<StorageQuarantineOutcome> {
        const edit = this._modules.edit;
        if (!edit) {
            Log.warn("[GeoLeaf.Storage] discardQuarantined — moteur hors-ligne non câblé.");
            return { ok: false, refused: "engineUnavailable" };
        }
        return edit.discardQuarantined(id, confirmedLocalId);
    },

    /**
     * Rapporte, couche par couche, ce que le hors-ligne a réellement sous la main (tâche 4.8).
     *
     * 🛑 **Le cas qu'il existe pour rendre visible** : une couche déclarée hors-ligne mais
     * jamais rapatriée. Le contrat le décrit comme « le cas qui n'a aucun observable jusqu'à la
     * coupure » — tout marche, jusqu'au terrain. Il ressort ici en `declaredNeverPulled`.
     *
     * Ne jette jamais. Sans moteur câblé, rend un tableau **vide** plutôt qu'un rapport
     * rassurant : un rapport qui dirait « tout va bien » sans avoir rien lu serait pire que pas
     * de rapport, puisqu'il se croirait complet.
     *
     * @returns Un rapport par couche du profil actif ; vide quand le moteur n'est pas câblé.
     * @example
     * const report = await GeoLeaf?.Storage?.getSyncReport?.();
     * const jamais = report?.filter((r) => r.status === "declaredNeverPulled") ?? [];
     * if (jamais.length) console.warn("déclarées hors-ligne, jamais rapatriées :", jamais);
     */
    async getSyncReport(): Promise<readonly LayerSyncReport[]> {
        const report = this._modules.report;
        if (!report) {
            Log.warn("[GeoLeaf.Storage] getSyncReport — moteur hors-ligne non câblé.");
            return [];
        }
        return report.buildSyncReport();
    },

    /**
     * @returns `true` when offline — uses the OfflineDetector if present,
     * otherwise falls back to `navigator.onLine`.
     */
    isOffline(): boolean {
        return this.OfflineDetector ? !this.OfflineDetector.isOnline() : !navigator.onLine;
    },

    /**
     * Aggregate storage usage across IndexedDB and the cache manager.
     *
     * ⚠️ **`features` et `outbox` sont comptés depuis B-121 (tâche 4.8).** Cette méthode ne
     * lisait que `layersCount` et `syncQueueCount` — les deux magasins v3 —, donc après un
     * rapatriement de 27 entités elle rapportait toujours 0, et `offline-ui` affichait ce zéro.
     * Ce n'était pas observable tant que `features` n'avait aucun écrivain : le zéro était
     * VRAI. Il est devenu faux le jour où 4.1 a atterri.
     *
     * 🛑 **Le bloc `sync: { pending, failed }` est RETIRÉ (tâche 4.11).** Sa seule source
     * était `syncQueueCount`, c'est-à-dire le magasin v3 que plus personne n'écrivait depuis
     * 4.4b : il rapportait `0` en toutes circonstances, et `failed` n'était jamais assigné
     * du tout. Le décompte réel des écritures dues est `outbox.count` ci-dessus, et la
     * ventilation par état est {@link StorageDB.getSyncCounts}, qui rend `pendingCount` et
     * `quarantinedCount` par couche.
     *
     * @returns storage quota/usage, layer counts (total + per profile), entity/outbox counts,
     * cached profile ids and the online flag.
     * @remarks Never throws — errors are logged and partial stats returned.
     */
    async getStats(): Promise<{
        storage: { used: number; quota: number; percentage: number };
        layers: { count: number; byProfile: Record<string, number> };
        features: { count: number };
        outbox: { count: number };
        cache: { profiles: string[] };
        online: boolean;
    }> {
        const stats = {
            storage: { used: 0, quota: 0, percentage: 0 },
            layers: { count: 0, byProfile: {} as Record<string, number> },
            features: { count: 0 },
            outbox: { count: 0 },
            cache: { profiles: [] as string[] },
            online: true,
        };

        try {
            if (this.DB && this.DB.getStorageStats) {
                const dbStats = await this.DB.getStorageStats();
                stats.storage.used = dbStats.used;
                stats.storage.quota = dbStats.quota;
                stats.storage.percentage = dbStats.percentage;
                stats.layers.count = dbStats.layersCount ?? 0;
                stats.features.count = dbStats.featuresCount ?? 0;
                stats.outbox.count = dbStats.outboxCount ?? 0;
            }

            if (this.CacheManager) {
                const cachedProfiles = await this.CacheManager.listCachedProfiles();
                stats.cache.profiles = cachedProfiles;

                if (this.DB?.getLayersByProfile) {
                    for (const profileId of cachedProfiles) {
                        const layers = await this.DB.getLayersByProfile(profileId);
                        stats.layers.byProfile[profileId] = Array.isArray(layers)
                            ? layers.length
                            : 0;
                    }
                }
            }

            if (this.OfflineDetector?.isOnline) {
                stats.online = this.OfflineDetector.isOnline();
            }
        } catch (error) {
            Log.error(`[Storage] Failed to get stats: ${(error as Error).message}`);
        }

        return stats;
    },

    /**
     * Wipe every cached profile plus the `sync_queue`, `preferences` and
     * `metadata` IndexedDB stores.
     * @throws if the IndexedDB transaction fails.
     * @remarks Emits `geoleaf:storage:cleared` on success.
     */
    async clearAll(): Promise<void> {
        Log.warn("[Storage] Clearing all storage data...");

        try {
            if (this.CacheManager) {
                const profiles = await this.CacheManager.listCachedProfiles();
                for (const profileId of profiles) {
                    await this.CacheManager.clearProfile(profileId);
                }
            }

            const db = this.DB;
            if (db?._db && typeof (db._db as IDBDatabase).transaction === "function") {
                // ⚠️ `sync_queue` figurait ici jusqu'à la tâche 4.11 ; le magasin est retiré,
                // et le nommer dans la transaction la ferait JETER sur une base neuve.
                // `features` et `outbox` restent délibérément absents : la règle de cette
                // méthode est de ne jamais détruire une saisie de terrain.
                const transaction = (db._db as IDBDatabase).transaction(
                    ["preferences", "metadata"],
                    "readwrite"
                );

                transaction.objectStore("preferences").clear();
                transaction.objectStore("metadata").clear();

                await new Promise<void>((resolve, reject) => {
                    transaction.oncomplete = () => resolve();
                    transaction.onerror = () => reject(transaction.error);
                });
            }

            Log.info("[Storage] All storage data cleared");

            document.dispatchEvent(new CustomEvent("geoleaf:storage:cleared"));
        } catch (error) {
            Log.error(`[Storage] Failed to clear all: ${(error as Error).message}`);
            throw error;
        }
    },

    /**
     * Close the IndexedDB connection and tear down the offline detector.
     */
    close(): void {
        if (this.DB?.close) {
            this.DB.close();
        }

        if (this.OfflineDetector?.destroy) {
            this.OfflineDetector.destroy();
        }

        Log.info("[Storage] All connections closed");
    },

    /**
     * @param profileId - the profile to check.
     * @returns `true` if the profile is fully cached for offline use.
     */
    async isProfileAvailableOffline(profileId: string): Promise<boolean> {
        if (!this.isAvailable()) {
            return false;
        }

        return await this.CacheManager!.isProfileCached(profileId);
    },

    /**
     * @returns the ids of every profile currently available offline.
     */
    async getOfflineProfiles(): Promise<string[]> {
        if (!this.isAvailable()) {
            return [];
        }

        return await this.CacheManager!.listCachedProfiles();
    },
};

if (Log?.debug) {
    Log.debug("[Storage] Module loaded and ready");
}

// Mount the canonical public facade: GeoLeaf.Storage = { db, cache, cacheManager, init, … }.
// Single owner of this assignment; entry.ts injects the implementation modules via
// Storage.wireModules(). INV-FACADE: the facade is separate from the implementation modules.
_g.GeoLeaf.Storage = Storage;

StorageContract.init(Storage as unknown as Parameters<typeof StorageContract.init>[0]);

export { Storage };
