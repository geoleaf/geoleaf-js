# @geoleaf-plugins/offline-ui — API Reference

**Package:** `@geoleaf-plugins/offline-ui`  
**Version:** 2.0.0  
**Namespace:** `GeoLeaf.Storage`

---

## Table of contents

- [Storage (main facade)](#storage-main-facade)
- [DB — IndexedDB adapter](#db--indexeddb-adapter)
    - [DB.Layers](#dblayers)
    - [DB — la file d'écriture et les entités](#db--la-file-décriture-outbox-et-les-entités-features)
    - [DB.Images](#dbimages)
    - [DB.Backups (retirée)](#dbbackups--retirée)
- [CacheManager](#cachemanager)
- [OfflineDetector](#offlinedetector)
- [CacheButton (UI control)](#cachebutton-ui-control)
- [Types & interfaces](#types--interfaces)

---

## Storage (main facade)

The primary entry point. Available globally as `GeoLeaf.Storage`.

### `Storage.init(options?)`

Initialises all storage sub-systems.

```typescript
async init(options?: StorageInitOptions): Promise<boolean>
```

| Parameter | Type                 | Description                       |
| --------- | -------------------- | --------------------------------- |
| `options` | `StorageInitOptions` | Initialisation options (optional) |

**Returns:** `Promise<boolean>` — `true` on success, `false` if any sub-system failed to initialise.

```typescript
interface StorageInitOptions {
    indexedDB?: {
        name?: string; // Database name
        version?: number; // Schema version
    };
    cache?: Record<string, unknown>; // CacheManager config passthrough
    offline?: Record<string, unknown>; // OfflineDetector config passthrough
    enableOfflineDetector?: boolean; // Default: false
    enableServiceWorker?: boolean; // Default: false
}
```

---

### `Storage.isAvailable()`

```typescript
isAvailable(): boolean
```

Returns `true` if all required browser APIs (IndexedDB, Cache API) are available.

---

### `Storage.isOffline()`

```typescript
isOffline(): boolean
```

Returns `true` if the application is currently operating in offline mode.

---

### `Storage.getStats()`

Returns comprehensive statistics about current storage usage.

```typescript
async getStats(): Promise<{
  storage: { used: number; quota: number; percentage: number };
  layers: { count: number; byProfile: Record<string, number> };
  sync: { pending: number; failed: number };
  cache: { profiles: string[] };
  online: boolean;
}>
```

---

### `Storage.DB`

```typescript
get DB(): DBLike | undefined
```

Getter providing access to the IndexedDB adapter. Returns `undefined` if not yet initialised.

---

### `Storage.CacheManager`

```typescript
get CacheManager(): CacheManagerLike | undefined
```

Getter providing access to the cache manager. Returns `undefined` if not yet initialised.

---

### `Storage.OfflineDetector`

```typescript
get OfflineDetector(): OfflineDetectorLike | undefined
```

Getter providing access to the offline detector. Returns `undefined` if not yet initialised.

---

## DB — IndexedDB adapter

Accessed via `GeoLeaf.Storage.DB`.

### Base methods

```typescript
interface DBLike {
    init(): Promise<unknown>;
    close?(): void;

    getStorageStats(): Promise<{
        used: number;
        quota: number;
        percentage: number;
        layersCount?: number;
        syncQueueCount?: number;
    }>;

    getLayersByProfile(profileId: string): Promise<unknown[]>;
}
```

---

### DB.Layers

Layer metadata storage.

```typescript
interface LayersDBInstance {
    // Store or update layer metadata
    saveLayer(layerId: string, metadata: LayerMetadata): Promise<void>;

    // Retrieve all layers for a profile
    getLayersByProfile(profileId: string): Promise<LayerMetadata[]>;

    // Delete a layer record
    deleteLayer(layerId: string): Promise<void>;
}

interface LayerMetadata {
    id: string;
    profileId: string;
    name?: string;
    cachedAt?: number;
    tileCount?: number;
    sizeBytes?: number;
}
```

---

### DB — la file d'écriture (`outbox`) et les entités (`features`)

🛑 **Cette section décrivait `DB.Sync` et le magasin `sync_queue`, retirés à la tâche 4.11**
(B-124). Elle a survécu à une première passe de nettoyage qui ne retirait que les signatures :
son `SyncQueueEntry` était **la dernière déclaration du doublon C4** dans tout le dépôt.

Le cycle v4 n'expose plus de file de POI, mais deux magasins génériques :

```typescript
// Les éditions encore dues au serveur — les QUATRE états, pas le seul `pending` :
// `failed` n'est pas terminal, et `quarantined` reste visible.
listPendingEdits(): Promise<PendingEdit[]>

// Décomptes par couche, y compris la quarantaine.
getSyncCounts(layerIds: readonly string[]): Promise<Record<string, {
    featureCount: number;
    pendingCount: number;
    quarantinedCount: number;
}> | null>
```

L'écriture passe par la façade, jamais par le magasin : `GeoLeaf.Storage.applyEdit()` écrit
l'entité et son entrée d'outbox dans **une** transaction, et `GeoLeaf.Storage.pushOutbox()`
draine. Une entrée qui échoue `MAX_REPLAY_ATTEMPTS` fois passe en **quarantaine** — écartée du
rejeu, jamais détruite (B-125).

### DB.Images

Local image storage for offline mode.

```typescript
interface ImagesDBInstance {
    storeImage(imageData: LocalImageRecord): Promise<string>;
    getImage(id: string): Promise<LocalImageRecord | null>;
    getImagesByPoi(poiId: string): Promise<LocalImageRecord[]>;
    deleteImage(id: string): Promise<void>;
    updateImageStatus(id: string, status: ImageUploadStatus): Promise<void>;
    getImageStats(): Promise<ImageStats>;
}

interface LocalImageData {
    poiId: string;
    layerId: string;
    fileName: string;
    mimeType: string;
    size: number;
    base64Data?: string;
    url?: string;
}

interface LocalImageRecord extends LocalImageData {
    id: string;
    timestamp: number;
    status: "pending" | "synced" | "failed";
}

interface ImageUploadStatus {
    status: "pending" | "synced" | "failed";
    error?: string | null;
}

interface ImageStats {
    totalCount: number;
    pendingCount: number;
    syncedCount: number;
    failedCount: number;
    totalSize: number;
}
```

---

### DB.Backups — RETIRÉE

🛑 **La chaîne de sauvegarde est supprimée à la tâche 4.11** (B-116, fermée **par retrait**).
Trois mesures l'ont décidé, et aucune n'était « c'est du code mort » :

1. **Elle n'avait plus de producteur** — aucun appelant de production depuis que 4.4b a
   redirigé le rejeu vers `pushOutbox`. Le magasin ne recevait plus rien, et le panneau
   affichait « aucune sauvegarde » par construction.
2. **Son motif était faux sur le mécanisme** — elle se justifiait comme rempart contre une
   purge d'origine, alors qu'elle vivait DANS la base que cette purge détruit.
3. **Son rôle est couvert deux fois** — l'outbox interdit contractuellement de détruire une
   entrée, et l'export JSON (onglet Export/Synchro) sort du navigateur, donc lui survit.

---

## CacheManager

Accessed via `GeoLeaf.Storage.CacheManager`. Manages offline caching of entire GeoLeaf profiles (tiles, GeoJSON, images).

```typescript
interface CacheManagerLike {
    init(config: Record<string, unknown>): void;

    // List all currently cached profile IDs
    listCachedProfiles(): Promise<string[]>;

    // Remove all cached resources for a profile
    clearProfile(profileId: string): Promise<number>;

    // Estimate total cache size for a profile (before downloading)
    estimateProfileSize(profileId: string): Promise<{
        totalSize: number;
        totalSizeFormatted?: string;
    }>;

    // Get browser storage quota info
    getStorageQuota(): Promise<{ available?: number }>;

    // Cache all resources for a profile
    cacheProfile(profileId: string): Promise<unknown>;

    // Check if a profile is already cached
    isProfileCached(profileId: string): Promise<boolean>;
}
```

---

## OfflineDetector

Accessed via `GeoLeaf.Storage.OfflineDetector`. Monitors network connectivity.

```typescript
interface OfflineDetectorLike {
    init(opts: Record<string, unknown>): void;

    // Returns true if currently online
    isOnline(): boolean;

    // Tear down event listeners
    destroy?(): void;
}
```

---

## CacheButton (UI control)

A MapLibre map control that provides a UI for managing offline cache. Added automatically when the plugin is loaded.

The button allows users to:

- View which profiles are cached
- Download a profile for offline use
- Monitor download progress
- Clear cached profiles
- View storage usage statistics

The control integrates with `CacheManager` internally and does not require manual initialisation.

---

## Types & interfaces

### StorageInitOptions

```typescript
interface StorageInitOptions {
    indexedDB?: { name?: string; version?: number };
    cache?: Record<string, unknown>;
    offline?: Record<string, unknown>;
    enableOfflineDetector?: boolean;
    enableServiceWorker?: boolean;
}
```

### CacheControlOptions

```typescript
interface CacheControlOptions {
    position?: string; // MapLibre control position
    title?: string; // Button tooltip
    className?: string; // Custom CSS class
}
```

### CacheProgressDetail

```typescript
interface CacheProgressDetail {
    profileId: string;
    downloaded: number; // Resources downloaded so far
    total: number; // Total resources to download
    percentage: number; // 0–100
    currentResource?: string;
}
```

### Bounds (geographic)

```typescript
interface Bounds {
    north: number;
    south: number;
    east: number;
    west: number;
}
```

### TileCoord

```typescript
interface TileCoord {
    x: number;
    y: number;
    z: number;
}
```

---

## See also

- [OVERVIEW.md](OVERVIEW.md) — Plugin architecture and key concepts
- [INSTALLATION.md](INSTALLATION.md) — Authentication and npm setup
- [EXAMPLES.md](EXAMPLES.md) — Practical usage recipes
