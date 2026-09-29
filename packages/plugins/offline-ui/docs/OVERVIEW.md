# @geoleaf-plugins/offline-ui — Overview

**Package:** `@geoleaf-plugins/offline-ui`  
**Version:** 2.0.0  
**License:** MIT  
**Registry:** `registry.npmjs.org` (public)

---

## Purpose

The Storage plugin adds offline-first capabilities to GeoLeaf applications:

- **IndexedDB persistence** — POI data, layer metadata, sync queue, images, backups
- **Tile & resource cache** — Download map profiles for offline access via the Cache API
- **Sync queue** — Track CRUD operations performed offline; flush when online
- **Image management** — Store images locally when offline, upload when connectivity is restored
- **Offline detection** — Automatic online/offline status monitoring

It is designed for field workers, mobile applications, and scenarios where network connectivity is intermittent.

---

## Architecture

```
@geoleaf-plugins/offline-ui
├── Storage (facade)           ← Primary public API: init, getStats, isOffline…
├── DB (IndexedDB)
│   ├── Layers                 ← Layer metadata per profile
│   ├── Sync                   ← CRUD sync queue
│   ├── Images                 ← Local image blobs
│   ├── Preferences            ← User preferences
│   └── Backups                ← Snapshot backups
├── CacheManager               ← Profile tile/resource cache
│   ├── Resource enumerator    ← Discovers tiles, GeoJSON, images
│   ├── Downloader             ← Progressive download manager
│   ├── Retry handler          ← Exponential backoff retry
│   └── Progress tracker       ← Download progress callbacks
├── OfflineDetector            ← Network status monitor
└── UI
    └── CacheButton            ← MapLibre control for offline cache management
```

### Plugin registration

The plugin registers itself automatically with `@geoleaf/core` at load time:

```javascript
GeoLeaf.plugins.register("offline-ui", {
    version: "__GEOLEAF_VERSION__", // replaced with pkg.version at build (INV-REG)
    optional: ["addpoi"],
    label: "Storage (IndexedDB + Cache + Sync)",
    healthCheck: () =>
        !!(GeoLeaf.Storage.db && GeoLeaf.Storage.cacheManager && GeoLeaf.Storage.OfflineDetector),
});
```

After registration, the plugin is accessible as `GeoLeaf.Storage` in the global namespace.

### Health check

On load, the plugin verifies that its three core sub-systems are available:

- `GeoLeaf.Storage.db` — IndexedDB adapter
- `GeoLeaf.Storage.cacheManager` — Cache management layer
- `GeoLeaf.Storage.OfflineDetector` — Connectivity monitor

---

## Prerequisites

- `@geoleaf/core` ^2.0.0
- Browser with IndexedDB support (all modern browsers)
- Browser with Cache API support for tile caching (Chrome, Firefox, Safari ≥ 11.1)
- MIT — [geoleaf.dev](https://geoleaf.dev)

---

## Integration with @geoleaf/core

The plugin depends on the following contracts exposed by `@geoleaf/core`:

| Core export             | Purpose                                          |
| ----------------------- | ------------------------------------------------ |
| `storage-contract.ts`   | Shared interface between core and storage plugin |
| `GeoLeaf.plugins`       | Plugin registration registry                     |
| `log/index.ts`          | Centralised logging                              |
| `utils/error-logger.ts` | Error reporting                                  |
| `utils/formatters.ts`   | File size formatting utilities                   |

The plugin does **not** modify core modules. All communication is through the contract interface and the `GeoLeaf` global namespace.

---

## Key concepts

### Profile-based caching

Resources are organised by _profile_ (a GeoLeaf configuration profile). Each profile can be independently cached, cleared, or checked for cache status.

### Write queue (`outbox`)

The queue of edits made offline belongs to the core's offline engine, not to this plugin: what a
layer declares for it, how `GeoLeaf.Storage.applyEdit()` records an edit and the queue drains, and
what becomes of the entries set aside are the core's
[offline write cycle](../../../core/docs/OFFLINE_WRITE_CYCLE.md). This plugin shows the queue's state in its cache window.

### Image lifecycle

1. User selects image → validated (type, size)
2. If offline → stored as base64 in IndexedDB with `pending` status
3. When online → uploaded to configured endpoint, status → `synced`
4. Compression applied before storage (configurable quality, default 0.8)

---

## See also

- [INSTALLATION.md](INSTALLATION.md) — Authentication and npm setup
- [API_REFERENCE.md](API_REFERENCE.md) — Full public API
- [EXAMPLES.md](EXAMPLES.md) — Practical usage recipes
