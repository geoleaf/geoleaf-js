# @geoleaf-plugins/offline-ui

**GeoLeaf Offline UI Plugin** — the offline interface: layer picker, cache button, synchronisation
panel. The engine (IndexedDB, cache, download, sync) lives in `@geoleaf/core`, and the
`GeoLeaf.Storage` facade belongs to it. MIT licensed.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![npm](https://img.shields.io/badge/npm-%40geoleaf--plugins%2Foffline--ui-cb3837.svg)](https://www.npmjs.com/package/@geoleaf-plugins/offline-ui)

---

## Features

- **Cache button** — a control in the core's toolbar that opens the offline window
- **Layer picker** — choose which layers of the profile to take offline, then start and follow
  the download (`GeoLeaf.Storage.CacheManager.cacheProfile`). A basemap whose origin is not
  declared for offline preparation is greyed and says why (core ≥ 3.15.0), and the closing notice
  names what a download left out
- **Synchronisation panel** — the state of the write queue the core holds, and a button to send
  it now
- **Captures set aside** — one row per motive, with a retry where the core says a retry can work
  and a confirmed discard
- **"Can I leave?"** — the core's pre-departure check (`GeoLeaf.Storage.preflight()`, core ≥ 3.10.0)
  shown next to the download: storage persistence, each layer's offline state, what the
  preparation left out, the write session (core ≥ 3.11.0), and the core's verdict
- **« Export the log »** — the application's recent journal (`GeoLeaf.Log.exportDiagnostic()`),
  downloaded as a JSON file
- **« A new version is ready »** — a banner, outside the window, when an update of the
  application waits (core ≥ 3.15.0): **Reload** applies it (`GeoLeaf.PWA.applyUpdate()`),
  **Later** leaves it waiting

What this plugin does **not** contain: the storage itself, the cache, the pull of a layer's
entities, the write queue and its replay, the connectivity detection. They are the core's offline
capability; this plugin only draws them.

---

## Installation

```bash
npm install @geoleaf/core @geoleaf-plugins/offline-ui
```

> **Important** — Requires `@geoleaf/core` v3.x, declared in **`peerDependencies`**: install the
> core yourself, the plugin never brings a second copy of it. Load the plugin **after** the core
> and **before** `GeoLeaf.boot()`.

---

## Usage

### ESM (bundler / Vite / webpack)

```typescript
import "@geoleaf/core";
import "@geoleaf-plugins/offline-ui";

// The plugin registers its interface on import; `GeoLeaf.Storage` is the core's facade
GeoLeaf.boot({
    config: { data: { activeProfile: "tourism", profilesBasePath: "./profiles/" } },
});

// Check offline status — the facade's members are optional: it is inert until the engine loads
const isOffline = GeoLeaf.Storage?.isOffline?.() ?? false;

// Storage statistics
const stats = await GeoLeaf.Storage?.getStats?.();
console.log(stats?.storage.used, stats?.features.count, stats?.outbox.count);
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
    GeoLeaf.boot({
        config: { data: { activeProfile: "tourism", profilesBasePath: "./profiles/" } },
    });
    console.log("Offline ready:", GeoLeaf.Storage.isOffline());
</script>
```

---

## API

`GeoLeaf.Storage` is a facade of **`@geoleaf/core`** — this plugin drives it and mounts no
namespace of its own. The members below are the ones its interface uses; the core's API
reference documents the facade.

### `GeoLeaf.Storage.init()`

Initialises the core's storage modules (the database, the cache manager). The core's offline
capability calls it while the application boots.

### `GeoLeaf.Storage.isOffline()` → `boolean`

Returns `true` when the application is currently offline.

### `GeoLeaf.Storage.getStats()` → `Promise<StorageStats>`

Returns the complete storage statistics:

```typescript
{
  storage: { used: number; quota: number; percentage: number };
  layers: { count: number; byProfile: Record<string, number> };
  features: { count: number }; // entities held locally
  outbox: { count: number }; // writes still owed to the server
  conflicts: { count: number }; // versions a settled conflict set aside, and kept
  cache: { profiles: string[] };
  online: boolean;
}
```

### `GeoLeaf.Storage.CacheManager.cacheProfile(profileId, options?)` → `Promise<CacheResult>`

Starts downloading a complete profile for offline access. It runs a **quota pre-check** first, so a
download known to be too large is not attempted. Progress is available through the
`geoleaf:cache:progress` event.

It has **two phases**. The first caches the profile's resources — configuration files, icons, static
GeoJSON, tiles. The second pulls the **entities** of every selected layer declaring `offline.source`
into the `features` store, and reports through `geoleaf:offline:pull-progress`; those layers are
listed back in `result.pulledLayers`, absent when the profile declares no pull source. A source that
cannot be reached is reported there, never raised: it does not undo the resources already cached.

### `GeoLeaf.Storage.clearAll()` → `Promise<void>`

Removes the whole cache and empties the `preferences` and `metadata` tables.

> **Note** — It clears neither `features` nor `outbox`: field data captured offline is never
> destroyed by this call. To remove one specific profile, use
> `GeoLeaf.Storage.CacheManager.clearProfile(profileId)`.

---

## DOM events

| Event                           | Detail                                                  | Fired when                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `geoleaf:online`                | `{ timestamp }`                                         | Connectivity returns                                                                                                                                     |
| `geoleaf:offline`               | `{ timestamp }`                                         | Connectivity is lost                                                                                                                                     |
| `geoleaf:cache:progress`        | `{ current, total, percentage, … }`                     | Caching progresses                                                                                                                                       |
| `geoleaf:offline:pull-progress` | `{ layerId, current, total, totalIsKnown, percentage }` | One page of a layer's entities landed. `totalIsKnown` is `false` when the source served no `numberMatched`: `total` is then a running count, not a whole |
| `geoleaf:cache:completed`       | `{ profileId, cached, … }`                              | A download finishes                                                                                                                                      |
| `geoleaf:cache:cleared`         | `{ profileId, deleted }`                                | A profile's cache is removed                                                                                                                             |
| `geoleaf:poi:synced`            | the push tally itself — `{ synced, failed, … }`         | The sync queue has been sent                                                                                                                             |
| `geoleaf:storage:initialized`   | —                                                       | Storage is initialised                                                                                                                                   |
| `geoleaf:storage:cleared`       | —                                                       | All storage has been removed                                                                                                                             |

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

| Guide                                                                                                                    | Contents                                 |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| [Installation](https://github.com/geoleaf/geoleaf-js/blob/main/packages/plugins/offline-ui/docs/INSTALLATION.md)         | Prerequisites and setup                  |
| [Configuration](https://github.com/geoleaf/geoleaf-js/blob/main/packages/plugins/offline-ui/docs/CONFIGURATION.md)       | JSON profile options                     |
| [API Reference](https://github.com/geoleaf/geoleaf-js/blob/main/packages/plugins/offline-ui/docs/API_REFERENCE.md)       | Full API with TypeScript signatures      |
| [Examples](https://github.com/geoleaf/geoleaf-js/blob/main/packages/plugins/offline-ui/docs/EXAMPLES.md)                 | Ready-to-use recipes                     |
| [Offline Detector](https://github.com/geoleaf/geoleaf-js/blob/main/packages/plugins/offline-ui/docs/offline-detector.md) | Network monitoring and advanced settings |

---

## Licence

MIT — see `LICENSE` in the package and [geoleaf.dev](https://geoleaf.dev).
