/*!
 * @geoleaf-plugins/offline-ui
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Adaptateur typé sur la façade `GeoLeaf.Storage` du core.
 *
 * `@geoleaf/core` type volontairement sa façade Storage de façon lâche (`DB: any`,
 * `CacheManager`/`Cache`: `unknown`) pour que le kernel ne se couple jamais au plugin
 * optionnel. Le **plugin est la source de vérité** de la forme concrète de sa propre façade :
 * il l'expose ici à travers le `StorageContractShape` déclaré plus bas.
 *
 * All plugin consumers import `StorageContract` from THIS file so member access / calls are
 * type-safe and the `no-unsafe-*` gate stays green.
 *
 * ## ⚠️ API publique S4.4 — il ne RÉ-EXPORTE plus, il ADAPTE
 *
 * Ce fichier faisait `import { StorageContract as _Core } from "@core/shared/storage-contract.js"`
 * puis un cast. Le commentaire affirmait « runtime object is unchanged (same core singleton) ».
 * **C'était faux dans le paquet publié.**
 *
 * `StorageContract` est un singleton dont l'état (`_storageRef`) est un `let` de portée
 * module, initialisé par le CORE (`kernel/storage/facade.ts`). Un plugin chargé en
 * `<script type="module">` a son PROPRE graphe de modules : il ne peut pas partager ce `let`.
 * L'import embarquait donc une SECONDE instance, jamais initialisée — `isAvailable()` rendait
 * `false` pour toujours et `whenReady()` ne résolvait jamais. Toute l'UI hors-ligne qui passe
 * par `ensureEngineReady()` était morte à l'exécution dans le bundle livré.
 *
 * L'adaptateur lit `globalThis.GeoLeaf.Storage` — la façade du core, seule instance par
 * construction. Les 8 fichiers consommateurs ne changent pas d'une ligne : ils importent
 * toujours `StorageContract` d'ici, avec la même forme.
 */

import { getGeoLeaf } from "@geoleaf/host-runtime";

/** Le namespace du core, ou `undefined` avant le boot. */
function _gl(): Record<string, unknown> | undefined {
    // Accesseur canonique de `@geoleaf/host-runtime` plutôt qu'un `globalThis as { GeoLeaf?: … }`
    // local : c'est exactement ce que ce paquet existe pour remplacer, et la forme locale n'est
    // plus convertible sous `exactOptionalPropertyTypes` (le namespace est déclaré PRÉSENT
    // portant `undefined`, ce qu'un `GeoLeaf?:` n'accepte pas).
    return getGeoLeaf() as Record<string, unknown> | undefined;
}

/** La façade `GeoLeaf.Storage`, ou `undefined` si le core n'est pas là. */
function _storage(): Record<string, unknown> | undefined {
    return _gl()?.["Storage"] as Record<string, unknown> | undefined;
}

/** Une édition encore due au serveur, telle que `listPendingEdits()` la rend (tâche 4.10). */
export interface PendingEdit {
    entryId: string;
    kind: string;
    layerId: string;
    localId: string;
    state: string;
    createdAt: number;
    /** L'entité éditée, ou `null` quand le magasin ne la porte plus. */
    feature: unknown;
}

/**
 * IndexedDB layer surface (`Storage.DB`) reached through the contract.
 *
 * 🛑 **Les quatre membres `sync_queue` et `getBackups` sont RETIRÉS (tâche 4.11).** La
 * version précédente de cette phrase disait qu'ils « RESTENT », parce que
 * le module de sauvegarde d'`addpoi` restaurait encore ses sauvegardes par cette file —
 * c'était vrai le 04/08 au matin. Il est supprimé avec toute la chaîne, et
 * **aucun des cinq membres n'était appelé depuis ce paquet** : ils déclaraient une surface
 * que personne n'empruntait, ce qui est précisément la « fiction du global » que la cause
 * racine n° 1 de cette roadmap décrit.
 */
export interface StorageContractDB {
    /** Tâche 4.10 — les saisies encore dues au serveur, jointes à leur entité. */
    listPendingEdits(): Promise<PendingEdit[]>;
    /** Tâche 4.10 — supprime les entités `synced` (du cache), jamais l'outbox. */
    purgeCachedFeatures(): Promise<{ removed: number; preserved: number }>;
}

/** CacheAPI manager surface (`Storage.CacheManager`). */
export interface StorageContractCacheManager {
    cacheProfile(profileId: string, opts?: unknown): Promise<unknown>;
    clearCache(profileId: string): Promise<number>;
    getCacheStatus(profileId: string): Promise<unknown>;
    getStorageQuota(): Promise<{ usage: number; quota: number; percentage: number }>;
    cancelDownload(): void;
}

/** Layer-selection persistence surface (`Storage.Cache.Storage`). */
export interface StorageContractCacheStorage {
    loadLayerSelection(profileId: string): Promise<Record<string, unknown> | null>;
    saveLayerSelection(profileId: string, selection: unknown): Promise<void>;
}

/** Cache-icon / selection refresher surface (`Storage.Cache.LayerSelector`). */
export interface StorageContractLayerSelector {
    refreshCacheIcons(): Promise<void>;
    saveSelection?(): Promise<void>;
    updateWarning?(): Promise<void>;
}

/** Cache namespace (`Storage.Cache`). */
export interface StorageContractCache {
    Storage: StorageContractCacheStorage;
    LayerSelector: StorageContractLayerSelector;
}

/**
 * Rich, plugin-owned view of the Storage contract singleton. `DB` / `CacheManager`
 * / `Cache` are typed non-nullable: consumers guard availability at runtime via
 * `isAvailable()` / `isPluginLoaded()` before dereferencing.
 */
export interface StorageContractShape {
    init(storage: unknown): void;
    isAvailable(): boolean;
    isPluginLoaded(): boolean;
    /**
     * Resolves once the in-core offline engine is loaded and initialised (IndexedDB
     * open). UI actions await this so they defer until the engine is ready; it stays
     * pending while `modules.offline` is disabled (the engine never loads).
     */
    whenReady(): Promise<void>;
    /**
     * Décomptes agrégés de la façade.
     *
     * ⚠️ `features` et `outbox` ne sont renseignés que depuis B-121 (tâche 4.8) : la façade
     * ne comptait que les magasins v3, donc après un rapatriement de 27 entités elle
     * rapportait 0 — et ce panneau affichait ce zéro.
     *
     * 🛑 Le bloc `sync: { pending, failed }` est retiré (4.11) : sa seule source était le
     * compteur du magasin v3, donc il valait 0 en toutes circonstances depuis 4.4b. Le
     * déclarer ici serait exactement la fiction que ce fichier existe pour supprimer.
     */
    getStats(): Promise<{
        features?: { count: number };
        outbox?: { count: number };
        layers?: { count: number };
    }>;
    readonly DB: StorageContractDB;
    readonly CacheManager: StorageContractCacheManager;
    readonly Cache: StorageContractCache;
}

/**
 * La façade Storage du core, vue à travers les types du plugin.
 *
 * ⚠️ Les accès sont des ACCESSEURS, pas des valeurs capturées : `GeoLeaf.Storage` n'existe pas
 * encore à l'évaluation de ce module (le plugin est chargé avant `boot()`), et ses membres
 * `DB` / `CacheManager` / `Cache` sont eux-mêmes des getters côté core, qui changent quand le
 * moteur s'initialise. Figer l'un d'eux à l'import donnerait `undefined` pour toujours.
 */
export const StorageContract = {
    get DB() {
        return _storage()?.["DB"];
    },
    get CacheManager() {
        return _storage()?.["CacheManager"];
    },
    get Cache() {
        return _storage()?.["Cache"];
    },
    isAvailable(): boolean {
        return (_storage()?.["isAvailable"] as (() => boolean) | undefined)?.() === true;
    },
    isPluginLoaded(): boolean {
        return (_storage()?.["isPluginLoaded"] as (() => boolean) | undefined)?.() === true;
    },
    getStats(): Promise<Record<string, unknown>> {
        const fn = _storage()?.["getStats"] as (() => Promise<Record<string, unknown>>) | undefined;
        // Un panneau qui ne peut pas compter affiche zéro plutôt que de refuser de s'ouvrir ;
        // la façade elle-même ne jette jamais, on tient la même promesse ici.
        return fn ? fn.call(_storage()) : Promise.resolve({});
    },
    whenReady(): Promise<void> {
        const fn = _storage()?.["whenReady"] as (() => Promise<void>) | undefined;
        // Sans le core, on ne résout jamais — même sémantique que le contrat, qui ne résout
        // pas tant que le moteur ne s'est pas annoncé prêt. Résoudre ici ferait croire l'UI
        // prête sur un moteur absent.
        return fn ? fn() : new Promise<void>(() => {});
    },
} as unknown as StorageContractShape;
