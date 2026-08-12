---
title: "GeoLeaf — Plugin configuration in a profile"
---

# GeoLeaf — Plugin configuration in a profile

**Applies to:** `@geoleaf/core` v3.x

---

## Overview

Some configuration keys in `profile.json` and `ui.json` only take effect once the matching plugin is loaded. Without the plugin, the key is **read without error and silently ignored**. This design makes it possible to declare configurations up front and load plugins optionally, depending on the environment.

| Profile key                      | Required plugin                   | Effect once the plugin is loaded              |
| -------------------------------- | --------------------------------- | --------------------------------------------- |
| `ui.showCacheButton`             | `@geoleaf-plugins/offline-ui`     | Shows the offline cache management button     |
| `modules.editor.showAddPoi`      | `@geoleaf-plugins/editor`         | Shows the add-POI button                      |
| `storage`                        | `@geoleaf-plugins/offline-ui`     | Configures the offline cache (tiles, profile) |
| `layer.attributes.fields[].edit` | `@geoleaf-plugins/editor`         | Makes the field editable, per layer           |
| _(no key)_                       | `@geoleaf-plugins/connector`      | fetch interceptor — enabled on import         |
| _(no key)_                       | `@geoleaf-plugins/file-import`    | Enables the `GeoLeaf.FileImport.*` API        |
| _(no key)_                       | `@geoleaf-plugins/flatgeobuf`     | Enables the `GeoLeaf.FlatGeobuf.*` API        |
| _(no key)_                       | `@geoleaf-plugins/cog`            | Enables the `GeoLeaf.COG.*` API               |
| _(no key)_                       | `@geoleaf-plugins/websocket`      | Real-time POI stream over WebSocket (planned) |
| _(no key)_                       | `@geoleaf-plugins/realtime-layer` | Auto-refreshing layers (planned)              |

---

## Plugin Storage — `@geoleaf-plugins/offline-ui`

### Enable the cache button

In `ui.json` → the `ui` section:

```json
{
    "ui": {
        "showCacheButton": true
    }
}
```

Without this flag set to `true`, the button does not appear, even when the plugin is loaded.

### The `storage` block in `profile.json`

Configures the behaviour of the offline cache:

```json
{
    "storage": {
        "enableOfflineDetector": true,
        "cache": {
            "enableProfileCache": true,
            "enableTileCache": true
        }
    }
}
```

| Key                        | Type    | Default | Description                                                 |
| -------------------------- | ------- | ------- | ----------------------------------------------------------- |
| `enableOfflineDetector`    | boolean | `false` | Watches network connectivity and shows an offline indicator |
| `cache.enableProfileCache` | boolean | `true`  | Caches the profile files (config JSON, taxonomy, and so on) |
| `cache.enableTileCache`    | boolean | `true`  | Caches the map tiles (raster + vector)                      |

### Per-layer cache (in `basemaps.json`)

Cache configuration can be refined for each basemap:

```json
{
    "basemaps": {
        "osm": {
            "label": "OpenStreetMap",
            "type": "tile",
            "url": "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "offline": true,
            "cacheMinZoom": 8,
            "cacheMaxZoom": 16,
            "offlineBounds": {
                "north": 48.9,
                "south": 48.8,
                "east": 2.4,
                "west": 2.3
            }
        }
    }
}
```

| Key             | Description                                                   |
| --------------- | ------------------------------------------------------------- |
| `offline`       | Allows offline caching for this basemap                       |
| `cacheMinZoom`  | Lowest zoom level to pre-fetch                                |
| `cacheMaxZoom`  | Highest zoom level to pre-fetch                               |
| `offlineBounds` | Geographic extent to cache (`north`, `south`, `east`, `west`) |

---

## Plugin Editor — `@geoleaf-plugins/editor`

### Enable the add button

In `config/plugins/editor.json` → the `modules.editor` block:

```json
{
    "editor": {
        "showAddPoi": true
    }
}
```

::: warning
This key used to live under `ui.showAddPoi`. It has been removed from the `ui` schema
(`additionalProperties: false`), so writing it there now makes `npm run validate:profiles` fail.
Its default has changed as well: `false` (opt-in) became `true` (opt-out).
:::

### ~~The `poiAddConfig` block in `profile.json`~~ — REMOVED

::: danger
**This block no longer exists, and copying it makes `npm run validate:profiles` FAIL.** It
configured the POI add form of the `addpoi` plugin, since merged into
`@geoleaf-plugins/editor`. `profile.schema.json` is `additionalProperties: false` and declares
only ten root keys (`$schema`, `id`, `label`, `displayLabel`, `icon`, `description`, `version`,
`Files`, `map`, `modules`): an unknown root key is **rejected**, not ignored.
:::

| Old                            | New                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `poiAddConfig.enabled`         | no key any more — the plugin is loaded **lazily** when the button is pressed |
| `poiAddConfig.defaultPosition` | `modules.editor.poiAddDefaultPosition` (in `config/plugins/editor.json`)     |

### Installation

```bash
npm install @geoleaf-plugins/connector
```

### Usage

```js
import "@geoleaf/core";
import "@geoleaf-plugins/connector"; // interceptor active immediately

// Configure authentication for a source
GeoLeaf.Connector.configure({
    baseUrl: "https://api.example.com",
    auth: {
        type: "bearer",
        token: () => localStorage.getItem("access_token"),
    },
});
```

### Configuration parameters

| Parameter         | Type      | Description                                                       |
| ----------------- | --------- | ----------------------------------------------------------------- |
| `baseUrl`         | string    | Base URL to intercept                                             |
| `auth.type`       | string    | `"bearer"` / `"apikey"` / `"cookie"`                              |
| `auth.token`      | string/fn | Static token, or a function returning the token dynamically       |
| `auth.headerName` | string    | Header name (default: `"Authorization"` for bearer, configurable) |

> The `auth.token` option accepts a static value or a synchronous/asynchronous function — useful for tokens that refresh automatically.

---

## Plugin File Import — `@geoleaf-plugins/file-import`

**Status:** available (~70 KB gzip)

Imports geographic files on the client side (GPX, KML/KMZ, CSV, TopoJSON) and converts them to GeoJSON. Imported data can be displayed directly as a map layer.

### Installation

```bash
npm install @geoleaf-plugins/file-import
```

### Main API

```js
import "@geoleaf/core";
import "@geoleaf-plugins/file-import";

// Convert a File object into GeoJSON
const geojson = await GeoLeaf.FileImport.convert(file, {
    type: "auto", // automatic detection — or "gpx", "kml", "csv", "topojson"
});

// Import and display as a map layer
const layer = await GeoLeaf.FileImport.importAsLayer(file, {
    layerId: "imported-data",
    style: { color: "#e74c3c", weight: 2 },
});
```

### Supported formats

| Format   | Extension            | Notes                               |
| -------- | -------------------- | ----------------------------------- |
| GPX      | `.gpx`               | Tracks, routes, waypoints → GeoJSON |
| KML/KMZ  | `.kml`, `.kmz`       | KMZ is decompressed automatically   |
| CSV      | `.csv`               | Configurable lat/lon columns        |
| TopoJSON | `.json`, `.topojson` | Automatic conversion → GeoJSON      |

### `importAsLayer` options

| Option    | Type   | Default   | Description                                              |
| --------- | ------ | --------- | -------------------------------------------------------- |
| `layerId` | string | generated | Identifier of the resulting layer                        |
| `style`   | object | default   | MapLibre GL JS style applied to the layer                |
| `type`    | string | `"auto"`  | Forces the format (`"gpx"`, `"kml"`, `"csv"`, and so on) |

---

## Plugin FlatGeobuf — `@geoleaf-plugins/flatgeobuf`

**Status:** available (~20 KB gzip)

Streaming load of FlatGeobuf files with spatial bounding-box filtering (HTTP Range + R-tree index). Suited to large datasets served without an intermediate server.

### Installation

```bash
npm install @geoleaf-plugins/flatgeobuf
```

### Declarative configuration in a layer config

Each FlatGeobuf layer is declared in a `<layer>_config.json` file with `"plugin": "flatgeobuf"`. The entry in `layers.json` is identical to any other layer.

**Schema of the `data` block:**

| Key           | Type                       | Default   | Description                                                                   |
| ------------- | -------------------------- | --------- | ----------------------------------------------------------------------------- |
| `url`         | string                     | —         | URL of the `.fgb` file (relative to the profile root, or absolute)            |
| `bbox`        | `[W, S, E, N]` (4 numbers) | absent    | Spatial filter: only features inside the bbox are transferred over HTTP Range |
| `limit`       | number                     | `100 000` | Maximum number of features to load (anti-DoS protection)                      |
| `autoRefresh` | boolean                    | `false`   | Reloads the features on every map move (`moveend`)                            |
| `debounceMs`  | number                     | `300`     | Auto-refresh debounce delay, in ms                                            |

**Example — layer with bbox and auto-refresh (zones_desserte):**

```json
{
    "id": "zones_desserte",
    "label": "Zones de desserte SNCF",
    "plugin": "flatgeobuf",
    "zIndex": 30,
    "geometry": "polygon",
    "data": {
        "url": "data/zones_desserte_sncf.fgb",
        "bbox": [2.225, 41.362, 8.227, 51.089],
        "limit": 1000,
        "autoRefresh": true,
        "debounceMs": 500
    },
    "styles": {
        "directory": "styles",
        "default": "defaut.json",
        "available": [{ "id": "defaut", "label": "défaut", "file": "defaut.json" }]
    },
    "tooltip": { "mode": "hover", "fields": [{ "field": "properties.nom", "label": "Zone" }] },
    "table": { "enabled": false },
    "clustering": { "enabled": false }
}
```

**Example — local file layer without bbox (eco_regions_fgb):**

```json
{
    "id": "eco_regions_fgb",
    "label": "Éco-régions (FlatGeobuf)",
    "plugin": "flatgeobuf",
    "zIndex": 51,
    "geometry": "polygon",
    "data": {
        "url": "layers/eco_regions_fgb/data/eco_regions.fgb",
        "limit": 50000,
        "autoRefresh": false
    }
}
```

### Loading from initialisation code

```js
import "@geoleaf/core";
import "@geoleaf-plugins/flatgeobuf";

// Read the config from the profile, then load the layer:
const layerId = await GeoLeaf.FlatGeobuf.loadLayerFromConfig(layerConfig);
// If layerConfig.data.bbox is set → loadBboxAsLayer (HTTP Range)
// Otherwise → loadAsLayer (whole file)
```

### Low-level API

```js
// Full load → GeoJSON FeatureCollection
const result = await GeoLeaf.FlatGeobuf.load("https://example.com/data.fgb");

// Load by bbox (HTTP Range — only the features inside the bbox are downloaded)
const result = await GeoLeaf.FlatGeobuf.loadBbox("https://example.com/data.fgb", {
    minX: 2.2,
    minY: 48.8,
    maxX: 2.5,
    maxY: 49.0,
});

// Add straight to the map as a layer
const layerId = await GeoLeaf.FlatGeobuf.loadAsLayer("https://example.com/data.fgb", {
    layerId: "ma-couche",
    layerName: "My data",
    visible: true,
});
```

::: warning
**Server prerequisite:** the server hosting the `.fgb` files must support HTTP Range requests
(`Content-Range` header) for bbox filtering to work. Nginx, Apache, Amazon S3 and GitHub Pages
support it by default.
:::

---

## Plugin COG — `@geoleaf-plugins/cog`

**Status:** available (~156 KB gzip)

Reads and displays Cloud Optimized GeoTIFF (COG) directly in MapLibre GL JS. Supports multi-band images, LUT colour maps and custom raster source injection.

### Installation

```bash
# public npm registry
npm install @geoleaf-plugins/cog
```

### Main API

```js
import "@geoleaf/core";
import "@geoleaf-plugins/cog";

// Add a COG layer to the map
await GeoLeaf.COG.addLayer("https://example.com/ortho.tif", {
    layerId: "ortho",
    bands: [1, 2, 3],
    colorMap: "viridis",
    opacity: 0.85,
});

// Remove the layer
GeoLeaf.COG.removeLayer("ortho");
```

### `addLayer` options

| Option     | Type     | Default   | Description                                     |
| ---------- | -------- | --------- | ----------------------------------------------- |
| `layerId`  | string   | generated | Identifier of the MapLibre layer                |
| `bands`    | number[] | `[1,2,3]` | Raster bands to display (RGB)                   |
| `colorMap` | string   | `null`    | LUT: `"viridis"`, `"gray"`, `"rdbu"`, and so on |
| `opacity`  | number   | `1`       | Layer opacity (0–1)                             |
| `nodata`   | number   | `null`    | nodata value to mask out                        |

---

## Plugin WebSocket — `@geoleaf-plugins/websocket`

> **Status: planned for Q3 2026** — MIT plugin for real-time POI tracking.

This plugin will provide real-time POI updates over WebSocket — live positions, geographic alerts, IoT streams. Configuration documentation will land with the release.

---

## Plugin Realtime Layer — `@geoleaf-plugins/realtime-layer`

> **Status: available** — MIT plugin for auto-refreshing layers.

This plugin enables auto-refreshing layers over HTTP polling, WebSocket or Server-Sent Events. The configuration lives in the `data.realtime` block of each `<layer>_config.json`.

### Supported keys (`data.realtime` block)

| Key              | Type                                | Required                        | Description                                                                                                                                                                        |
| ---------------- | ----------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`        | `boolean`                           | yes                             | Starts the RT layer at boot. When `false`, the block stays descriptive.                                                                                                            |
| `source`         | `"polling" \| "websocket" \| "sse"` | yes                             | Transport type.                                                                                                                                                                    |
| `decoder`        | `"json" \| "gtfs-rt" \| <custom>`   | yes                             | Decoder applied to the received payload. Custom decoders via `registerDecoder()`.                                                                                                  |
| `url`            | `string`                            | when `source` = polling/sse     | URL of the remote endpoint.                                                                                                                                                        |
| `intervalMs`     | `number`                            | no (default 30 000)             | Polling period. Polling only.                                                                                                                                                      |
| `fallbackUrl`    | `string`                            | no                              | Fallback URL served when `url` returns a non-2xx status or fails (network). Polling only. The snapshot is emitted once per outage; the primary is used again on its first success. |
| `channel`        | `string`                            | when `source` = websocket       | Channel consumed through `GeoLeaf.Ws.subscribe()`.                                                                                                                                 |
| `updateMode`     | `"upsert" \| "replace" \| "merge"`  | no (default `"upsert"`)         | Strategy used to apply updates.                                                                                                                                                    |
| `idField`        | `string`                            | required for `upsert` / `merge` | Property used as the stable feature identifier.                                                                                                                                    |
| `staleTimeoutMs` | `number`                            | no                              | Delay after which a feature that has not been refreshed becomes stale.                                                                                                             |
| `staleAction`    | `"remove" \| "dim" \| <custom>`     | no (default `"remove"`)         | Action applied to stale features. Custom actions via `registerStaleAction()`.                                                                                                      |
| `mapping`        | `object`                            | no                              | Hints for the GTFS-RT decoder (`idField`, `delayField`, `targetLayerId`).                                                                                                          |

### Example — GeoJSON polling with a CDN fallback (USGS)

```json
{
    "id": "epicentres_seismes",
    "data": {
        "dataUrl": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson",
        "realtime": {
            "enabled": true,
            "source": "polling",
            "url": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson",
            "intervalMs": 60000,
            "decoder": "json",
            "updateMode": "upsert",
            "idField": "id",
            "fallbackUrl": "data/epicentres_seismes_snapshot.geojson"
        }
    }
}
```

### Example — SNCF GTFS-RT with a protobuf fallback

```json
{
    "id": "gares_voyageurs",
    "data": {
        "dataUrl": "https://ressources.data.sncf.com/.../geojson",
        "realtime": {
            "enabled": true,
            "source": "polling",
            "url": "https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-trip-updates",
            "intervalMs": 120000,
            "decoder": "gtfs-rt",
            "updateMode": "merge",
            "idField": "code_uic",
            "mapping": {
                "idField": "stop_id",
                "delayField": "delay",
                "targetLayerId": "gares_voyageurs"
            },
            "staleTimeoutMs": 300000,
            "staleAction": "dim",
            "fallbackUrl": "data/gares_voyageurs_gtfsrt_snapshot.pb"
        }
    }
}
```

### Public API

```ts
GeoLeaf.RealtimeLayer.start(layerId: string): void;
GeoLeaf.RealtimeLayer.stop(layerId: string): void;
GeoLeaf.RealtimeLayer.stopAll(): void;
GeoLeaf.RealtimeLayer.getStatus(layerId: string): { active, source, lastUpdateAt, staleCount };
GeoLeaf.RealtimeLayer.registerDecoder(name: string, decoder: IDecoder): void;
GeoLeaf.RealtimeLayer.registerStaleAction(name: string, handler: StaleActionHandler): void;
```

Layers with `data.realtime.enabled: true` start automatically on the `geoleaf:app:ready` event.

---

## Example: a profile with both plugins enabled

### `profile.json`

```json
{
    "id": "mon-profil",
    "label": "Mon Profil",
    "version": "1.0.0",

    "map": {
        "center": [48.8566, 2.3522],
        "zoom": 12
    },

    "Files": {
        "layersFile": "config/core/layers.json",
        "basemapsFile": "config/core/basemaps.json",
        "uiFile": "config/core/ui.json",
        "modules": {
            "cluster": "config/plugins/cluster.json"
        }
    },

    "storage": {
        "enableOfflineDetector": true,
        "cache": {
            "enableProfileCache": true,
            "enableTileCache": true
        }
    }
}
```

### `ui.json`

```json
{
    "ui": {
        "theme": "auto",
        "language": "en",
        "showLayerManager": true,
        "showFilterPanel": true,
        "showLegend": true,
        "enableGeolocation": true,
        "showCacheButton": true,
        "permalink": {
            "enabled": true,
            "mode": "hash"
        }
    },
    "search": {
        "title": "Filtrer",
        "searchPlaceholder": "Rechercher...",
        "filters": [
            {
                "id": "searchText",
                "type": "search",
                "label": "Recherche textuelle",
                "placeholder": "Nom...",
                "searchFields": ["properties.name"]
            }
        ]
    }
}
```

### Loading the plugins (ESM)

```js
import "@geoleaf/core";
import "@geoleaf-plugins/connector"; // optional — when an authenticated API is required
import "@geoleaf-plugins/offline-ui"; // unlocks showCacheButton + storage.*
import "@geoleaf-plugins/editor"; // unlocks modules.editor.* (POI editing and capture)

GeoLeaf.init({
    map: { target: "map" },
    data: {
        activeProfile: "mon-profil",
        profilesBasePath: "./profiles/",
    },
});
GeoLeaf.boot();
```

::: warning
**Import order:** plugins must be imported **after** `@geoleaf/core`. See
[PLUGIN_DEVELOPMENT_GUIDE.md](PLUGIN_DEVELOPMENT_GUIDE.md) → section "Load order".
:::

---

## Table — `modules.table` (plugin `@geoleaf-plugins/table`)

::: info
The data table has been moved out of the core into the MIT plugin `@geoleaf-plugins/table`. See
the plugin README for installation, configuration (`modules.table.*`) and migration.
:::

The table is now the MIT plugin `@geoleaf-plugins/table`. Its configuration lives under `modules.table.*` (file `config/plugins/table.json` + `Files.modules.table`), no longer under the root key `tableConfig`. The keys below describe the table behaviour, in particular the available export formats. The `GeoLeaf.Table.*` API stays valid once the plugin is loaded.

### `modules.table` keys

| Key                  | Type                                          | Default      | Description                                                                                    |
| -------------------- | --------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------- |
| `enabled`            | `boolean`                                     | `true`       | Enables or disables the table module entirely.                                                 |
| `defaultVisible`     | `boolean`                                     | `false`      | Opens the table panel when the profile loads.                                                  |
| `pageSize`           | `number`                                      | `50`         | Number of rows per page (virtual pagination).                                                  |
| `maxRowsPerLayer`    | `number`                                      | `5000`       | Limit of features loaded into the table per layer. Does not affect `Table.exportLayer()`.      |
| `enableExportButton` | `boolean`                                     | `true`       | Shows the export buttons (selection + layer) in the toolbar.                                   |
| `exportFormats`      | `('geojson'\|'csv'\|'kml'\|'gpx'\|'excel')[]` | every format | Restricts the formats offered in the export dropdowns. When absent, every format is available. |
| `csvSeparator`       | `',' \| ';'`                                  | `','`        | Separator used for CSV export. Useful for Excel compatibility in locales that use `;`.         |
| `csvIncludeGeometry` | `boolean`                                     | `false`      | Includes a `__geometry` column (WKT/GeoJSON) in the CSV export.                                |
| `resizable`          | `boolean`                                     | `true`       | Allows vertical resizing of the table panel.                                                   |
| `defaultHeight`      | `string`                                      | `'320px'`    | Initial height of the panel.                                                                   |
| `minHeight`          | `string`                                      | `'180px'`    | Minimum height when resizing.                                                                  |
| `maxHeight`          | `string`                                      | `'80vh'`     | Maximum height when resizing.                                                                  |

### Example — restrict the formats and force the `;` separator

```json
{
    "modules": {
        "table": {
            "exportFormats": ["geojson", "csv", "excel"],
            "csvSeparator": ";",
            "csvIncludeGeometry": false,
            "maxRowsPerLayer": 10000
        }
    }
}
```

### Available export formats

| Format        | Key       | Extra weight       | Notes                                                                                    |
| ------------- | --------- | ------------------ | ---------------------------------------------------------------------------------------- |
| GeoJSON       | `geojson` | 0 (already loaded) | Default format.                                                                          |
| CSV           | `csv`     | ~0 KB              | UTF-8 BOM, configurable separator, optional `__geometry` column.                         |
| KML           | `kml`     | ~0 KB              | Native XML, no external dependency. Properties in CDATA. Works with Google Earth / QGIS. |
| GPX           | `gpx`     | ~0 KB              | Native XML. `<wpt>` for Points, `<trk>` for LineStrings, `<rte>` for Polygons.           |
| Excel (.xlsx) | `excel`   | ~150 KB gzip       | Loaded lazily (SheetJS) on the first click only — no impact on the initial bundle.       |

### Extended public API

```ts
// Export the current selection
GeoLeaf.Table.exportSelection(); // GeoJSON (default)
GeoLeaf.Table.exportSelection("csv"); // CSV
GeoLeaf.Table.exportSelection("csv", { csvSeparator: ";" }); // CSV with a custom separator

// Export the whole active layer (ignores the maxRowsPerLayer limit)
GeoLeaf.Table.exportLayer(); // GeoJSON (default)
GeoLeaf.Table.exportLayer("kml");
GeoLeaf.Table.exportLayer("excel");
```

### Emitted events

| Event                   | Payload                                  | Trigger                   |
| ----------------------- | ---------------------------------------- | ------------------------- |
| `table:exportSelection` | `{ layerId, format, selectedIds, rows }` | `Table.exportSelection()` |
| `table:exportLayer`     | `{ layerId, format, count }`             | `Table.exportLayer()`     |

---

## Core rule: silent degradation

Only keys **actually declared in the schema** degrade silently. `poiAddConfig` and
`ui.showAddPoi` are no longer declared; fixed-shape objects are `additionalProperties: false`, so
writing them makes `npm run validate:profiles` **fail** instead of being ignored. Of the keys
listed above, `ui.showCacheButton` is the one still declared.

Plugins with no profile key (`connector`, `file-import`, `flatgeobuf`, `cog`) need no JSON
configuration at all — they activate on import. When the matching plugin is not loaded:

- No error is raised
- The key is read and ignored
- The button or the feature does not appear

This behaviour is intentional: it allows a single profile to serve several environments, with or without the optional plugins.

---

## Check plugin status at runtime

```js
// List of loaded plugins
GeoLeaf.plugins.getLoadedPlugins();
// → ["core", "connector", "storage", "addpoi", "file-import", "flatgeobuf", "cog"]

// Check one specific plugin
GeoLeaf.plugins.isLoaded("storage"); // → true / false
GeoLeaf.plugins.isLoaded("file-import"); // → true / false
GeoLeaf.plugins.isLoaded("flatgeobuf"); // → true / false
GeoLeaf.plugins.isLoaded("cog"); // → true / false
```

---

## See also

- [PLUGIN_DEVELOPMENT_GUIDE.md](PLUGIN_DEVELOPMENT_GUIDE.md) — build a custom plugin
- `CONNECTOR_GUIDE.md` — HTTP authentication with `@geoleaf-plugins/connector`. The guide ships
  **with the plugin package** (`docs/CONNECTOR_GUIDE.md` of `@geoleaf-plugins/connector`), not
  with the core: it documents the plugin
- [PROFILES_GUIDE.md](PROFILES_GUIDE.md) — full structure of a profile
- [PROFILE_JSON_REFERENCE.md](PROFILE_JSON_REFERENCE.md) — clustering configuration (`modules.cluster`); the `poiConfig` key was removed in v3
- [ui/PERMALINK.md](ui/PERMALINK.md) — permalink configuration
- [GETTING_STARTED.html](https://geoleaf.dev/docs/GETTING_STARTED.html) — quick-start guide
