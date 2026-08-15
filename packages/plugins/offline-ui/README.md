# @geoleaf-plugins/offline-ui

**GeoLeaf Offline UI Plugin** — the offline interface: layer picker, cache button, synchronisation
panel. The engine (IndexedDB, cache, download, sync) lives in `@geoleaf/core`, and the
`GeoLeaf.Storage` facade belongs to it. MIT licensed.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![npm](https://img.shields.io/badge/npm-%40geoleaf--plugins%2Foffline--ui-cb3837.svg)](https://www.npmjs.com/package/@geoleaf-plugins/offline-ui)

---

## Features

- **IndexedDB persistence** — POI data, layer metadata, sync queue, images, backups
- **Profile caching** — downloads a profile's tiles and resources for fully offline access
- **Sync queue** — records CRUD operations while offline and replays them when the network returns
- **Offline image handling** — local image storage, with deferred upload once connectivity is back
- **Offline detector** — automatic connectivity monitoring with a built-in visual indicator
- **Cache button** — a native MapLibre UI control to start and follow the offline download

---

## Installation

```bash
npm install @geoleaf/core @geoleaf-plugins/offline-ui
```

> **Important** — Requires `@geoleaf/core` v3.x. The core is declared in **`dependencies`**, not in
> `peerDependencies` — as it is for the other plugins. This means npm may install a **second copy**
> of the core rather than reusing yours; deduplicate if your bundler reports two instances.

---

## Usage

### ESM (bundler / Vite / webpack)

```typescript
import "@geoleaf/core";
import "@geoleaf-plugins/offline-ui";

// The plugin wires itself to GeoLeaf.Storage automatically
await GeoLeaf.init({
    map: { target: "map" },
    data: { activeProfile: "tourism", profilesBasePath: "./profiles/" },
});

// Check offline status
const isOffline = GeoLeaf.Storage.isOffline();

// Cache statistics
const stats = await GeoLeaf.Storage.getStats();
console.log(stats.tileCacheSize, stats.poiCount);
```

### ESM (CDN / script tag)

Load it **after** `@geoleaf/core`:

```html
<!-- MapLibre first — the core reads it from `globalThis`, and v6 no longer sets it -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.css" />
<script type="module">
    import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.mjs";
    globalThis.maplibregl = maplibregl;
</script>

<!-- Then the core -->
<script type="module" src="geoleaf.esm.js"></script>

<!-- Then the offline-ui plugin -->
<script
    type="module"
    src="node_modules/@geoleaf-plugins/offline-ui/dist/geoleaf-offline-ui.plugin.js"
></script>
<script type="module">
    await GeoLeaf.init({
        map: { target: "map" },
        data: { activeProfile: "tourism", profilesBasePath: "./profiles/" },
    });
    console.log("Offline ready:", GeoLeaf.Storage.isOffline());
</script>
```

---

## API

### `GeoLeaf.Storage.init()`

Initialises the plugin (called automatically on load).

### `GeoLeaf.Storage.isOffline()` → `boolean`

Returns `true` when the application is currently offline.

### `GeoLeaf.Storage.getStats()` → `Promise<StorageStats>`

Returns the complete storage statistics:

```typescript
{
  storage: { used: number; quota: number; percentage: number };
  layers: { count: number; byProfile: Record<string, number> };
  sync: { pending: number; failed: number };
  cache: { profiles: string[] };
  online: boolean;
}
```

### `GeoLeaf.Storage.CacheManager.cacheProfile(profileId, options?)` → `Promise<CacheResult>`

Starts downloading a complete profile for offline access. It runs a **quota pre-check** first, so a
download known to be too large is not attempted. Progress is available through the
`geoleaf:cache:progress` event.

### `GeoLeaf.Storage.clearAll()` → `Promise<void>`

Removes the whole cache and empties the `preferences` and `metadata` tables.

> **Note** — It clears neither `features` nor `outbox`: field data captured offline is never
> destroyed by this call. To remove one specific profile, use
> `GeoLeaf.Storage.CacheManager.clearProfile(profileId)`.

---

## DOM events

| Event                         | Detail                                         | Fired when                   |
| ----------------------------- | ---------------------------------------------- | ---------------------------- |
| `geoleaf:online`              | `{ timestamp }`                                | Connectivity returns         |
| `geoleaf:offline`             | `{ timestamp }`                                | Connectivity is lost         |
| `geoleaf:cache:progress`      | `{ profileId, downloaded, total, percentage }` | Caching progresses           |
| `geoleaf:cache:completed`     | `{ profileId }`                                | A download finishes          |
| `geoleaf:cache:cleared`       | `{ profileId }`                                | A profile's cache is removed |
| `geoleaf:poi:synced`          | `{ results }`                                  | The sync queue has been sent |
| `geoleaf:storage:initialized` | —                                              | Storage is initialised       |
| `geoleaf:storage:cleared`     | —                                              | All storage has been removed |

```javascript
document.addEventListener("geoleaf:online", () => {
    console.log("Connection restored — synchronising");
});
```

---

## Security

- Sensitive data is never persisted in localStorage — IndexedDB only.
- The tile cache is protected by the Service Worker scope and unreachable from other origins.
- The plugin follows the XSS sanitisation policy of `@geoleaf/core` (`DOMSecurity`).

---

## Architecture

This package ships the offline **interface** only. The engine — IndexedDB, cache, download,
synchronisation — lives in `@geoleaf/core` (`capabilities/offline/`), and `GeoLeaf.Storage` is a
facade of the **core**, not of this plugin.

```
src/
├── entry.ts       ← Entry point — registers the UI, the i18n and the toolbar
├── cache/         ← Download plus the picker for layers to cache
├── sync/          ← Cache control area (DOM, events, state) and synchronisation
├── ui/            ← Cache button, mounted into a core toolbar slot
├── core/          ← Seams to the core offline engine (availability, sync)
├── shared/        ← Plugin-side view of the `StorageContract`
├── lang/          ← i18n dictionaries, 6 locales
└── css/           ← Modal, control and sync panel stylesheets
```

---

## Documentation

| Guide                                                                                                                    | Contents                                    |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| [Installation](https://github.com/geoleaf/geoleaf-js/blob/main/packages/plugins/offline-ui/docs/INSTALLATION.md)         | Prerequisites, GitHub registry, npm scripts |
| [Configuration](https://github.com/geoleaf/geoleaf-js/blob/main/packages/plugins/offline-ui/docs/CONFIGURATION.md)       | JSON profile options, `storage.*` keys      |
| [API Reference](https://github.com/geoleaf/geoleaf-js/blob/main/packages/plugins/offline-ui/docs/API_REFERENCE.md)       | Full API with TypeScript signatures         |
| [Examples](https://github.com/geoleaf/geoleaf-js/blob/main/packages/plugins/offline-ui/docs/EXAMPLES.md)                 | Ready-to-use recipes                        |
| [Offline Detector](https://github.com/geoleaf/geoleaf-js/blob/main/packages/plugins/offline-ui/docs/offline-detector.md) | Network monitoring and advanced settings    |

---

## Licence

MIT — see `LICENSE` in the package and [geoleaf.dev](https://geoleaf.dev).
