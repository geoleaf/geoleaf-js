---
title: "GeoLeaf Configuration Guide"
---

# GeoLeaf Configuration Guide

**Applies to:** @geoleaf/core v3.x

**Level:** Intermediate to advanced

This guide documents the JSON configuration files GeoLeaf JS reads to customise behaviour, appearance and data sources for a business profile (tourism, custom, and so on). Profiles use a modular layout, in which `basemaps.json` and `ui.json` are separate files.

---

## Table of Contents

1. [Overview](#1-overview)
2. [geoleaf.config.json - Main Configuration](#2-geoleafconfigjson---main-configuration)
3. [profile.json - Profile Configuration](#3-profilejson---profile-configuration)
4. [taxonomy.json - Categories and Icons](#4-taxonomyjson---categories-and-icons)
5. [themes.json - Layer Visibility Presets](#5-themesjson---layer-visibility-presets)
6. [layers.json - Layer Definitions](#6-layersjson---layer-definitions)
7. [mapping.json - Data Normalization](#7-mappingjson---data-normalization)
8. [Style Files - Layer Styling](#8-style-files---layer-styling)
9. [POI Configuration](#9-poi-configuration)
10. [Route Configuration](#10-route-configuration)
11. [POI Add Feature — `modules.editor.showAddPoi`](#11-poi-add-feature--moduleseditorshowaddpoi)
12. [geocodingConfig — Address Search](#12-geocodingconfig--address-search)

---

## 1. Overview

### Configuration File Hierarchy

```
geoleaf.config.json              (Root — optional, selects the profile)
  └── profiles/
      └── {profile-name}/        (v2 layout)
          ├── profile.json       (REQUIRED — identity + map + Files manifest)
          ├── config/
          │   ├── core/
          │   │   ├── basemaps.json   (REQUIRED — tile sources)
          │   │   ├── ui.json         (REQUIRED — UI controls)
          │   │   ├── layers.json     (REQUIRED — layer list)
          │   │   ├── taxonomy.json   (REQUIRED — POI categories & icons)
          │   │   ├── themes.json     (REQUIRED — visibility presets)
          │   │   └── features.json   (Optional — clustering, geocoding, performance, POI)
          │   └── plugins/
          │       └── {module-id}.json (Optional — per-plugin config, modules.<id> block)
          └── layers/            (Optional — GeoJSON configs & data)
              └── {layer-id}/
                  ├── {layer-id}_config.json
                  └── styles/
                      ├── defaut.json
                      └── *.json
```

> Configuration file paths are declared in the `Files` manifest of `profile.json` — only the name and
> location of `profile.json` itself are imposed.

### Load Order

1. **geoleaf.config.json** is loaded first (or defaults are used)
2. **profile.json** is loaded based on `activeProfile`
3. **Deploy**: if `profile.json` declares `bundleFile`, the pre-built **profile-bundle.json** is fetched in a single request (skipped when `debug: true`). Otherwise the files declared in `Files` (sections, features, plugin configs) are loaded in parallel
4. **Layer configs** and **styles** are loaded on-demand when layers are activated
5. **POI/route data** loaded as configured in the profile

### Configuration Principles

- **JSON Schema validation** - All files validated against schemas (see [schema/README.md](schema/README.md))
- **Graceful fallbacks** - Missing optional files use sensible defaults
- **Profile isolation** - Each profile is self-contained
- **Hot-reloading** - Most configs can be updated without page reload
- **Type safety** - TypeScript definitions ship with the package, generated from the source
  (`dist/types/bundle-esm-entry.d.ts`, resolved by `package.json#types`). See
  [API_REFERENCE.md](API_REFERENCE.md#typescript-types) for what the public type surface does and does
  not cover

---

## 2. geoleaf.config.json - Main Configuration

**Location:** Project root or custom path  
**Required:** No (uses defaults if missing)  
**Purpose:** Define which profile to load and debug settings

### Complete Structure

```json
{
    "debug": false,
    "data": {
        "activeProfile": "tourism",
        "profilesBasePath": "/profiles/"
    },
    "logging": {
        "level": "info"
    },
    "branding": {
        "enabled": false,
        "text": "My Application",
        "position": "bottom-left"
    },
    "security": {
        "httpsOnly": false
    }
}
```

### Field Reference

#### `debug` (boolean, optional)

Enables verbose console logging. Defaults to `false`.

```json
{ "debug": true }
```

Use the `logging` section to control the log level:

```json
{
    "logging": {
        "level": "debug"
    }
}
```

Available levels: `"debug"`, `"info"`, `"warn"`, `"error"`, `"production"`.

#### `branding` (object, optional)

Branding overlay displayed on the map.

| Field      | Type    | Description                                 |
| ---------- | ------- | ------------------------------------------- |
| `enabled`  | boolean | Enable the overlay. Defaults to `false`.    |
| `text`     | string  | Text to display.                            |
| `position` | string  | Position on the map (e.g. `"bottom-left"`). |

#### `security` (object, optional)

| Field       | Type    | Description                                                        |
| ----------- | ------- | ------------------------------------------------------------------ |
| `httpsOnly` | boolean | Rejects `http:` URLs (except `data:` images). Defaults to `false`. |

#### `data` (object, required)

Data loading configuration.

| Field              | Type   | Default        | Description                                                             |
| ------------------ | ------ | -------------- | ----------------------------------------------------------------------- |
| `activeProfile`    | string | `"default"`    | Profile name to load. Must match a directory in `profilesBasePath`      |
| `profilesBasePath` | string | `"/profiles/"` | Base path to profiles directory (relative to HTML page or absolute URL) |

**Example:**

```json
{
    "data": {
        "activeProfile": "tourism",
        "profilesBasePath": "https://cdn.example.com/geoleaf-profiles/"
    }
}
```

#### `performance` (object, optional)

Performance optimization settings.

| Field                    | Type    | Default | Description                                 |
| ------------------------ | ------- | ------- | ------------------------------------------- |
| `maxConcurrentLayers`    | number  | `10`    | Maximum number of layers loaded in parallel |
| `layerLoadDelay`         | number  | `200`   | Delay in ms between two layer loads         |
| `fitBoundsOnThemeChange` | boolean | `false` | Re-frame the map when the theme changes     |

---

## 3. profile.json - Profile Configuration

**Location:** `profiles/{profile-name}/profile.json`  
**Required:** Yes (each profile must have this file)  
**Purpose:** Define UI, basemaps, file paths, and default settings

### Complete Structure

```json
{
    "id": "my-profile",
    "label": "My Profile",
    "description": "Profile description",
    "version": "1.3.0",
    "map": {
        "bounds": [
            [-56, -74],
            [-21, -53]
        ],
        "center": [-15, -62],
        "zoom": 6,
        "maxZoom": 18,
        "maxPitch": 80,
        "positionFixed": true
    },
    "Files": {
        "themesFile": "config/core/themes.json",
        "layersFile": "config/core/layers.json",
        "basemapsFile": "config/core/basemaps.json",
        "uiFile": "config/core/ui.json"
    },
    "performance": {
        "maxConcurrentLayers": 10,
        "layerLoadDelay": 200,
        "fitBoundsOnThemeChange": false
    },
    "clusteringConfig": {
        "enabled": true,
        "strategy": "by-layer",
        "maxClusterRadius": 80,
        "disableClusteringAtZoom": 12
    },
    "poiConfig": {
        "enabled": false
    }
}
```

### Field Reference

#### `ui` (object, optional)

UI component configuration. Each component has the same structure:

| Field       | Type    | Default | Description                                                                                 |
| ----------- | ------- | ------- | ------------------------------------------------------------------------------------------- |
| `enabled`   | boolean | `false` | Whether component is visible                                                                |
| `position`  | string  | varies  | MapLibre GL JS control position: `"topleft"`, `"topright"`, `"bottomleft"`, `"bottomright"` |
| `collapsed` | boolean | `false` | Initial collapsed state (if applicable)                                                     |
| `title`     | string  | varies  | Component title/label                                                                       |

**Available components:**

- `layerManager` - Layer visibility controls
- `filterPanel` - POI filtering UI
- `searchBar` - Search input with autocomplete
- `cacheControls` - Offline cache management buttons
- `themeSelector` - Theme dropdown selector

#### `basemaps` (array, required)

Background map definitions.

| Field         | Type            | Required | Description                                              |
| ------------- | --------------- | -------- | -------------------------------------------------------- |
| `id`          | string          | Yes      | Unique basemap identifier                                |
| `name`        | string          | Yes      | Display name in UI                                       |
| `url`         | string          | Yes      | Tile URL template with `{z}`, `{x}`, `{y}` placeholders  |
| `attribution` | string          | Yes      | Copyright/attribution HTML                               |
| `maxZoom`     | number          | No       | Maximum zoom level (1-20)                                |
| `minZoom`     | number          | No       | Minimum zoom level (1-20)                                |
| `default`     | boolean         | No       | Whether this is the default basemap                      |
| `tileSize`    | number          | No       | Tile size in pixels (default: 256)                       |
| `subdomains`  | `array<string>` | No       | Subdomains for load balancing (default: `["a","b","c"]`) |

**Common tile providers:**

```json
{
    "basemaps": [
        {
            "id": "osm",
            "name": "OpenStreetMap",
            "url": "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "attribution": "&copy; OpenStreetMap",
            "default": true
        },
        {
            "id": "topo",
            "name": "OpenTopoMap",
            "url": "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
            "attribution": "&copy; OpenTopoMap",
            "maxZoom": 17
        },
        {
            "id": "cartodb-light",
            "name": "CartoDB Light",
            "url": "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
            "attribution": "&copy; CartoDB"
        }
    ]
}
```

#### `Files` (object, required)

Paths to configuration and data files (relative to profile directory).

| Field          | Type   | Required | Description                                |
| -------------- | ------ | -------- | ------------------------------------------ |
| `themesFile`   | string | Yes      | Path to `themes.json`                      |
| `layersFile`   | string | No       | Path to `layers.json` (layer index)        |
| `basemapsFile` | string | No       | Path to `basemaps.json` (basemaps)         |
| `uiFile`       | string | No       | Path to `ui.json` (UI components)          |
| `mappingFile`  | string | No       | Path to `mapping.json` (POI normalisation) |

#### `Directory` (object, optional)

Path templates for layer-specific files. Use `{layerId}` placeholder.

| Field    | Type   | Description                        |
| -------- | ------ | ---------------------------------- |
| `styles` | string | Path template to styles directory  |
| `data`   | string | Path template to GeoJSON data file |

**Example:**

```json
{
    "Directory": {
        "styles": "layers/{layerId}/styles/",
        "data": "layers/{layerId}/data.geojson"
    }
}
```

Resolved for layer `"cities"`:

- Styles: `profiles/tourism/layers/cities/styles/`
- Data: `profiles/tourism/layers/cities/data.geojson`

#### `poiAddConfig` (object, optional)

Configuration for POI creation form.

| Field                   | Type            | Default              | Description                          |
| ----------------------- | --------------- | -------------------- | ------------------------------------ |
| `enabled`               | boolean         | `true`               | Allow users to add POIs              |
| `categories`            | `array<string>` | `[]`                 | Available categories in form         |
| `defaultCategory`       | string          | first in array       | Pre-selected category                |
| `requiredFields`        | `array<string>` | `["title","latlng"]` | Required form fields                 |
| `optionalFields`        | `array<string>` | `[]`                 | Optional form fields                 |
| `allowCustomCategories` | boolean         | `false`              | Allow users to create new categories |
| `validation`            | object          | `{}`                 | Field validation rules               |

**Validation rules:**

```json
{
    "validation": {
        "title": {
            "minLength": 3,
            "maxLength": 100,
            "pattern": "^[a-zA-Z0-9\\s-]+$"
        },
        "phone": {
            "pattern": "^\\+?[0-9\\s-]+$"
        },
        "website": {
            "pattern": "^https?://.*$"
        }
    }
}
```

#### `search` (object, optional)

Search configuration.

| Field            | Type            | Default     | Description                                      |
| ---------------- | --------------- | ----------- | ------------------------------------------------ |
| `enabled`        | boolean         | `true`      | Enable search functionality                      |
| `sources`        | `array<string>` | `["poi"]`   | Data sources to search: `"poi"`, `"layers"`      |
| `fields`         | `array<string>` | `["title"]` | Fields to search in                              |
| `fuzzyMatch`     | boolean         | `false`     | Enable fuzzy string matching                     |
| `fuzzyThreshold` | number          | `0.6`       | Fuzzy match threshold (0-1, lower = more strict) |

#### `defaultSettings` (object, optional)

Initial map state.

```json
{
    "defaultSettings": {
        "map": {
            "center": [48.8566, 2.3522],
            "zoom": 12,
            "minZoom": 5,
            "maxZoom": 18
        },
        "theme": "light",
        "basemap": "osm",
        "language": "en"
    }
}
```

---

## basemaps.json

**Location:** `profiles/{profile-name}/basemaps.json`
**Required:** Yes (since v2.0.0)
**Referenced by:** `profile.json → Files.basemapsFile`

Declares the available tile sources. Each entry is keyed by its ID.

```json
{
    "basemaps": {
        "street": {
            "id": "street",
            "label": "OpenStreetMap",
            "type": "tile",
            "url": "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "subdomains": "abc",
            "attribution": "&copy; OpenStreetMap contributors",
            "minZoom": 3,
            "maxZoom": 19,
            "tileSize": 256,
            "defaultBasemap": true,
            "offline": true
        },
        "maplibre_vector": {
            "id": "maplibre_vector",
            "label": "Vector map",
            "type": "maplibre",
            "style": "https://cdn.example.com/styles/vector.json",
            "fallbackUrl": "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "defaultBasemap": false
        }
    }
}
```

| Field            | Type                                                                          | Description                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | string                                                                        | Identifier (mirrors the key)                                                                                                                          |
| `label`          | string                                                                        | Label shown in the basemap selector                                                                                                                   |
| `type`           | `"tile"` \| `"maplibre"` \| `"image"` \| `"hillshade"` \| `"wmts"` \| `"wms"` | `"tile"` = raster, `"maplibre"` = GL vector, `"image"` = georeferenced image, `"hillshade"` = terrain shading, `"wmts"` = OGC WMTS, `"wms"` = OGC WMS |
| `url`            | string                                                                        | Raster URL template with `{s}`, `{z}`, `{x}`, `{y}`                                                                                                   |
| `style`          | string                                                                        | MapLibre GL style URL (type `"maplibre"` only)                                                                                                        |
| `fallbackUrl`    | string                                                                        | Fallback raster URL used when MapLibre GL is unavailable                                                                                              |
| `tiles`          | string[]                                                                      | Array of explicit URLs (replaces `{s}` expansion)                                                                                                     |
| `subdomains`     | string \| string[]                                                            | Rotating subdomains                                                                                                                                   |
| `attribution`    | string                                                                        | Attribution HTML                                                                                                                                      |
| `tileSize`       | number                                                                        | Tile size in pixels. Defaults to `256`.                                                                                                               |
| `defaultBasemap` | boolean                                                                       | Basemap active at startup                                                                                                                             |
| `offline`        | boolean                                                                       | Offline cache support                                                                                                                                 |
| `terrain`        | object                                                                        | 3D terrain configuration (see [PROFILE_JSON_REFERENCE.md — terrain.\*](PROFILE_JSON_REFERENCE.md#basemapsidterrain-object-optional))                  |
| `imageSource`    | object                                                                        | Georeferenced image config — `type: "image"` only (see below)                                                                                         |
| `hillshade`      | object                                                                        | Terrain shading config — `type: "hillshade"` only (see below)                                                                                         |
| `wmts`           | object                                                                        | OGC WMTS config — `type: "wmts"` only (see below)                                                                                                     |
| `wms`            | object                                                                        | OGC WMS config — `type: "wms"` only (see below)                                                                                                       |

### Additional basemap types

#### type: "image" — Georeferenced image

```json
{
    "basemaps": {
        "plan_cadastral": {
            "id": "plan_cadastral",
            "label": "Cadastral plan",
            "type": "image",
            "attribution": "© Cadastral service",
            "imageSource": {
                "url": "https://cdn.example.com/cadastre/zone-nord.png",
                "coordinates": [
                    [2.3, 48.9],
                    [2.5, 48.9],
                    [2.5, 48.8],
                    [2.3, 48.8]
                ],
                "opacity": 0.85
            }
        }
    }
}
```

| Field under `imageSource` | Type       | Description                                                                     |
| ------------------------- | ---------- | ------------------------------------------------------------------------------- |
| `url`                     | string     | HTTP/HTTPS/data URL of the image (required)                                     |
| `coordinates`             | number[][] | The 4 corners `[lng, lat]` in NW, NE, SE, SW order. Defaults to the whole world |
| `opacity`                 | number     | Opacity in [0, 1]. Defaults to `1`                                              |

#### type: "hillshade" — Terrain shading

```json
{
    "basemaps": {
        "relief": {
            "id": "relief",
            "label": "Terrain shading",
            "type": "hillshade",
            "attribution": "© Terrain tiles",
            "hillshade": {
                "demUrl": "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
                "demEncoding": "terrarium",
                "shadowColor": "#000000",
                "highlightColor": "#ffffff",
                "exaggeration": 0.5,
                "illuminationDirection": 335,
                "illuminationAnchor": "viewport"
            }
        }
    }
}
```

| Field under `hillshade` | Type   | Description                                                                          |
| ----------------------- | ------ | ------------------------------------------------------------------------------------ |
| `demUrl`                | string | raster-dem DEM URL template (required)                                               |
| `demEncoding`           | string | Elevation encoding: `"terrarium"`, `"mapbox"`, `"custom"`. Defaults to `"terrarium"` |
| `demMaxZoom`            | number | Maximum zoom of the DEM source. Defaults to `15`                                     |
| `shadowColor`           | string | Shadow colour. Defaults to `"#000000"`                                               |
| `highlightColor`        | string | Lit-area colour. Defaults to `"#ffffff"`                                             |
| `accentColor`           | string | Accent colour (edges). Defaults to `"#000000"`                                       |
| `exaggeration`          | number | Shadow amplitude in [0, 1]. Defaults to `0.5`                                        |
| `illuminationDirection` | number | Light direction in degrees. Defaults to `335`                                        |
| `illuminationAnchor`    | string | Light anchor: `"viewport"` or `"map"`. Defaults to `"viewport"`                      |

#### type: "wmts" — OGC WMTS

```json
{
    "basemaps": {
        "geoportail_ortho": {
            "id": "geoportail_ortho",
            "label": "Géoportail Ortho",
            "type": "wmts",
            "attribution": "© IGN",
            "wmts": {
                "getCapabilitiesUrl": "https://wxs.ign.fr/essentiels/geoportail/wmts?SERVICE=WMTS&REQUEST=GetCapabilities",
                "layer": "ORTHOIMAGERY.ORTHOPHOTOS",
                "tileMatrixSet": "PM",
                "format": "image/jpeg"
            }
        }
    }
}
```

| Field under `wmts`   | Type   | Description                                                                |
| -------------------- | ------ | -------------------------------------------------------------------------- |
| `getCapabilitiesUrl` | string | OGC WMTS GetCapabilities URL (required)                                    |
| `layer`              | string | WMTS layer identifier. When absent, the first layer of the service is used |
| `tileMatrixSet`      | string | TileMatrixSet to use. Defaults to `"GoogleMapsCompatible"`                 |
| `format`             | string | Image format. Defaults to `"image/png"`                                    |

#### type: "wms" — OGC WMS

```json
{
    "basemaps": {
        "wms_ortho": {
            "id": "wms_ortho",
            "label": "WMS Orthophoto",
            "type": "wms",
            "attribution": "© IGN",
            "wms": {
                "url": "https://wxs.ign.fr/essentiels/geoportail/r/wms",
                "layers": "ORTHOIMAGERY.ORTHOPHOTOS",
                "version": "1.3.0",
                "crs": "EPSG:3857",
                "format": "image/jpeg",
                "tileSize": 256
            }
        }
    }
}
```

| Field under `wms` | Type    | Description                                            |
| ----------------- | ------- | ------------------------------------------------------ |
| `url`             | string  | Base URL of the WMS server (required)                  |
| `layers`          | string  | Comma-separated layer name(s) (required)               |
| `version`         | string  | WMS version. Defaults to `"1.3.0"`                     |
| `crs`             | string  | Coordinate reference system. Defaults to `"EPSG:3857"` |
| `format`          | string  | Image format. Defaults to `"image/png"`                |
| `tileSize`        | number  | Tile size in pixels. Defaults to `256`                 |
| `transparent`     | boolean | PNG transparency. Defaults to `false`                  |
| `styles`          | string  | Optional WMS style                                     |

---

## ui.json

**Location:** `profiles/{profile-name}/ui.json`
**Required:** Yes (since v2.0.0)
**Referenced by:** `profile.json → Files.uiFile`

Configures the visibility and behaviour of the UI components. Before v2.0.0 these settings lived in the `ui` section of `profile.json`; that inline form is still accepted for backward compatibility.

::: warning Migration to v3 (breaking)

The former `ui.showThemeSelector` flag has moved to **`modules.theme-selector.enabled`** (file `config/plugins/theme-selector.json`, declared in `profile.json` → `Files.modules`), following the same pattern as `modules.table` / `modules.filter`. It is an **opt-out**: the theme bar stays active unless `modules.theme-selector.enabled` is set to `false`.

:::

```json
{
    "ui": {
        "theme": "light",
        "language": "en",
        "showBaseLayerControls": false,
        "showLayerManager": true,
        "showFilterPanel": true,
        "showLegend": false,
        "showGeolocation": true,
        "showCoordinates": true,
        "showScale": true,
        "showCacheButton": false,
        "permalink": {
            "enabled": false,
            "mode": "hash",
            "fields": ["lat", "lng", "zoom", "layers"]
        }
    }
}
```

| Field                   | Type                                 | Default  | Description                                                                                                                                                                                                                                                                                   |
| ----------------------- | ------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `theme`                 | `"light"` \| `"dark"` \| `"auto"`    | `"auto"` | UI theme                                                                                                                                                                                                                                                                                      |
| `language`              | string                               | `"fr"`   | Language code                                                                                                                                                                                                                                                                                 |
| `showBaseLayerControls` | boolean                              | `true`   | Basemap selector button                                                                                                                                                                                                                                                                       |
| `showLayerManager`      | boolean                              | `true`   | Layer management panel                                                                                                                                                                                                                                                                        |
| `showFilterPanel`       | boolean                              | `true`   | Filter/search panel                                                                                                                                                                                                                                                                           |
| `showLegend`            | boolean                              | `true`   | Legend panel                                                                                                                                                                                                                                                                                  |
| `showGeolocation`       | boolean                              | `true`   | GPS geolocation button                                                                                                                                                                                                                                                                        |
| `showCoordinates`       | boolean                              | `true`   | Coordinate readout                                                                                                                                                                                                                                                                            |
| `showScale`             | boolean                              | `true`   | Scale bar readout                                                                                                                                                                                                                                                                             |
| `showCacheButton`       | boolean                              | `false`  | Offline cache button (requires @geoleaf-plugins/offline-ui)                                                                                                                                                                                                                                   |
| `permalink.enabled`     | boolean                              | `false`  | Synchronise state into the URL                                                                                                                                                                                                                                                                |
| `permalink.mode`        | `"hash"` \| `"query"` \| `"compact"` | `"hash"` | URL encoding strategy                                                                                                                                                                                                                                                                         |
| `permalink.fields`      | string[]                             | all      | **Optional** facets to serialise into the URL — `layers`, `shownLayers`, `filter`, `categories`, `tags`, `rating`, `theme` (e.g. `["layers","theme"]`). The view (`lat`/`lng`/`zoom`) is **always** serialised and cannot be listed. The list applies to both encodings, verbose and compact. |

> **Note: offline cache** — `showCacheButton: true` assumes the `@geoleaf-plugins/offline-ui` plugin (MIT, IndexedDB) is installed. The core `@geoleaf/core` only ships a connectivity detector (`offline-detector`). Without the plugin the button does not appear, even when the option is enabled.

### searchConfig (object, optional)

Configures the filter/search panel (displayed when `ui.showFilterPanel: true`). Living in `ui.json` since v2.0.0, this key replaces `search` from the former inline `profile.json`.

```json
{
    "searchConfig": {
        "title": "Filter",
        "radiusMin": 1,
        "radiusMax": 200,
        "radiusStep": 1,
        "radiusDefault": 10,
        "searchPlaceholder": "Search for a POI\u2026",
        "filters": [
            {
                "id": "searchText",
                "type": "search",
                "label": "Text search",
                "placeholder": "Search...",
                "searchFields": ["title", "properties.name", "description"]
            },
            {
                "id": "proximity",
                "type": "proximity",
                "label": "Proximity search",
                "buttonLabel": "Enable",
                "instructionText": "Click the map to set the centre point"
            },
            {
                "id": "categories",
                "type": "tree",
                "label": "Categories"
            },
            {
                "id": "tags",
                "type": "multiselect-tags",
                "label": "Tags",
                "field": "attributes.tags"
            }
        ],
        "actions": {
            "applyLabel": "Apply",
            "resetLabel": "Reset"
        }
    }
}
```

| Field                | Type   | Description                               |
| -------------------- | ------ | ----------------------------------------- |
| `title`              | string | Title of the filter panel                 |
| `radiusMin`          | number | Minimum radius for proximity search (km)  |
| `radiusMax`          | number | Maximum radius (km)                       |
| `radiusStep`         | number | Radius slider step (km)                   |
| `radiusDefault`      | number | Default radius (km)                       |
| `searchPlaceholder`  | string | Placeholder of the free-text search field |
| `filters`            | array  | List of filters (see the types below)     |
| `actions.applyLabel` | string | Label of the "apply" button               |
| `actions.resetLabel` | string | Label of the "reset" button               |

**Available filter types (`filters[].type`):**

| Type                 | Description                                |
| -------------------- | ------------------------------------------ |
| `"search"`           | Free-text search field                     |
| `"proximity"`        | Geographic filter by radius around a point |
| `"tree"`             | Hierarchical selection tree (categories)   |
| `"multiselect-tags"` | Multiple selection by tag                  |
| `"select"`           | Drop-down list (single value)              |
| `"range"`            | Numeric range slider                       |

### tableConfig (object, optional)

::: info

The data table is provided by the MIT plugin `@geoleaf-plugins/table`, not by the core. See the plugin README for installation, configuration (`modules.table.*`) and migration.

:::

### scaleConfig (object, optional)

Configures the scale readout (active when `ui.showScale: true`).

```json
{
    "scaleConfig": {
        "scaleGraphic": true,
        "scaleNumeric": true,
        "scaleNumericEditable": true,
        "scaleNivel": true,
        "position": "bottomleft"
    }
}
```

| Field                  | Type    | Default        | Description                                                  |
| ---------------------- | ------- | -------------- | ------------------------------------------------------------ |
| `scaleGraphic`         | boolean | `true`         | Show the graphic scale bar                                   |
| `scaleNumeric`         | boolean | `true`         | Show the numeric scale value                                 |
| `scaleNumericEditable` | boolean | `true`         | Allow a scale value to be typed in                           |
| `scaleNivel`           | boolean | `true`         | Show the numeric zoom level                                  |
| `position`             | string  | `"bottomleft"` | Position: `bottomleft`, `bottomright`, `topleft`, `topright` |

---

## 4. taxonomy.json - Categories and Icons

**Location:** `profiles/{profile-name}/taxonomy.json`  
**Required:** Yes  
**Purpose:** Define hierarchical categories, subcategories, and icon mappings

### Complete Structure

```json
{
    "icons": {
        "spriteUrl": "icons/sprite_tourism.svg",
        "symbolPrefix": "tourism-poi-cat-",
        "defaultIcon": "activity-generic"
    },
    "defaults": {
        "icon": "activity-generic"
    },
    "categories": {
        "activites": {
            "label": "Activities",
            "icon": "activity-generic",
            "subcategories": {
                "randonnee": {
                    "label": "Hiking",
                    "icon": "activity-mountain"
                },
                "velo": {
                    "label": "Cycling",
                    "icon": "activity-vehicle"
                }
            }
        },
        "hebergement": {
            "label": "Accommodation",
            "icon": "lodging-hotel",
            "subcategories": {
                "hotel": {
                    "label": "Hotel",
                    "icon": "lodging-hotel"
                },
                "camping": {
                    "label": "Camping",
                    "icon": "lodging-camping"
                }
            }
        },
        "culture": {
            "label": "Culture",
            "icon": "culture-building",
            "subcategories": {
                "musee": {
                    "label": "Museum",
                    "icon": "culture-building"
                },
                "monument": {
                    "label": "Monument",
                    "icon": "culture-building"
                }
            }
        }
    }
}
```

### Field Reference

#### `icons` (object, required)

SVG sprite configuration for POI icons (MapLibre GL JS format).

| Field          | Type   | Required | Description                                                          |
| -------------- | ------ | -------- | -------------------------------------------------------------------- |
| `spriteUrl`    | string | Yes      | Path to the SVG sprite file (relative to the profile)                |
| `symbolPrefix` | string | Yes      | Prefix of the symbol names in the sprite (e.g. `"tourism-poi-cat-"`) |
| `defaultIcon`  | string | Yes      | Identifier of the symbol used as fallback                            |

#### `defaults` (object, optional)

| Field  | Type   | Required | Description                            |
| ------ | ------ | -------- | -------------------------------------- |
| `icon` | string | No       | Default icon for POIs with no category |

#### `categories` (object, required)

Top-level category definitions, as a key→value object.
The keys are the category identifiers.

| Field           | Type   | Required | Description                            |
| --------------- | ------ | -------- | -------------------------------------- |
| `label`         | string | Yes      | Display name of the category           |
| `icon`          | string | Yes      | Identifier of the symbol in the sprite |
| `subcategories` | object | No       | Subcategories (key→value object)       |

#### `subcategories` (object, optional)

Subcategories of a parent category, as a key→value object.
The keys are the subcategory identifiers.

| Field   | Type   | Required | Description                                    |
| ------- | ------ | -------- | ---------------------------------------------- |
| `label` | string | Yes      | Display name of the subcategory                |
| `icon`  | string | Yes      | Symbol identifier (may differ from the parent) |

---

## 5. themes.json - Layer Visibility Presets

**Location:** `profiles/{profile-name}/themes.json`  
**Required:** Yes  
**Purpose:** Define named presets that control which layers are visible

### Complete Structure

```json
{
    "config": {
        "defautTheme": "defaut",
        "primaryThemes": {
            "enabled": true,
            "position": "top-map"
        },
        "secondaryThemes": {
            "enabled": true,
            "showNavigationButtons": true,
            "position": "top-layermanager"
        }
    },

    "themes": [
        {
            "id": "defaut",
            "label": "Default view",
            "description": "Standard view with the main layers",
            "type": "primary",
            "icon": "🗺️",
            "layers": [
                { "id": "cities", "visible": true, "style": "defaut" },
                { "id": "climate", "visible": true, "style": "defaut" },
                { "id": "poi", "visible": true, "style": "defaut" }
            ]
        },
        {
            "id": "nature",
            "label": "Nature",
            "description": "Natural and protected areas",
            "type": "primary",
            "icon": "🌿",
            "layers": [
                { "id": "cities", "visible": false, "style": "defaut" },
                { "id": "climate", "visible": false, "style": "defaut" },
                { "id": "poi", "visible": true, "style": "defaut" },
                { "id": "conservation-zones", "visible": true, "style": "defaut" }
            ]
        }
    ]
}
```

### Field Reference

#### `config` (object, optional)

Theme system configuration.

| Field                                   | Type    | Default              | Description                               |
| --------------------------------------- | ------- | -------------------- | ----------------------------------------- |
| `defautTheme`                           | string  | first theme ID       | Identifier of the theme active at startup |
| `primaryThemes.enabled`                 | boolean | `true`               | Show the primary theme selector           |
| `primaryThemes.position`                | string  | `"top-map"`          | Position of the control in the UI         |
| `secondaryThemes.enabled`               | boolean | `false`              | Enable secondary themes                   |
| `secondaryThemes.showNavigationButtons` | boolean | `false`              | Show the navigation buttons               |
| `secondaryThemes.position`              | string  | `"top-layermanager"` | Position of the secondary control         |

#### `themes` (array, required)

Theme definitions.

| Field         | Type   | Required | Description                                                                   |
| ------------- | ------ | -------- | ----------------------------------------------------------------------------- |
| `id`          | string | Yes      | Unique theme identifier                                                       |
| `label`       | string | Yes      | Display name of the theme                                                     |
| `description` | string | No       | Description shown in the UI                                                   |
| `type`        | string | Yes      | `"primary"` (visible in the selector) or `"secondary"` (programmatic)         |
| `icon`        | string | No       | Icon (emoji or identifier) for the theme button                               |
| `layers`      | array  | Yes      | Array of `{id, visible, style}` entries defining the visibility of each layer |

**Entry format inside `layers`:**

| Field     | Type    | Required | Description                                         |
| --------- | ------- | -------- | --------------------------------------------------- |
| `id`      | string  | Yes      | Layer identifier (must match the id in layers.json) |
| `visible` | boolean | Yes      | Initial visibility of the layer for this theme      |
| `style`   | string  | No       | Style variant to apply (default: `"defaut"`)        |

**Theme types:**

- **primary** — Shown in the theme selector, reachable by the user
- **secondary** — Hidden from the UI, triggered programmatically or used as a preset

### Layer References

The `layers` object keys **must match** layer IDs defined in:

- Layer directories: `layers/{layerId}/`
- Layer config files: `layers/{layerId}/config.json`
- GeoJSON layer IDs added via `/* GeoLeaf.GeoJSON is internal - configure via geojsonLayers in geoleaf.config.json */`

**Example matching:**

```
profiles/tourism/
  layers/
    climate/          ← ID: "climate"
    cities/           ← ID: "cities"
    monuments/        ← ID: "monuments"
  themes.json         ← References "climate", "cities", "monuments"
```

### Dynamic Theme Creation

```javascript
// Create custom theme programmatically
await GeoLeaf.Theme.create({
    id: "my-custom",
    name: "My Custom Theme",
    type: "secondary",
    layers: {
        poi: true,
        cities: true,
        climate: false,
    },
});

// Activate it
await GeoLeaf.Theme.setActive("my-custom");
```

---

## 6. layers.json - Layer Definitions

**Location:** `profiles/{profile-name}/layers.json` OR `profiles/{profile-name}/layers/{layerId}/config.json`  
**Required:** No (layers can be defined inline or in separate files)  
**Purpose:** Define GeoJSON layer properties, data sources, and default styles

### Complete Structure

**`layers.json` (index file):**

```json
{
    "layers": [
        {
            "id": "cities",
            "configFile": "layers/cities/cities_config.json",
            "layerManagerId": "data-administration"
        },
        {
            "id": "climate",
            "configFile": "layers/climate/climate_config.json",
            "layerManagerId": "data-environment"
        }
    ]
}
```

**Per-layer config (`layers/{layerId}/{layerId}_config.json`):**

```json
{
    "id": "cities",
    "label": "Major cities",
    "zIndex": 40,
    "geometry": "point",
    "data": {
        "directory": "data",
        "file": "cities.geojson"
    },
    "styles": {
        "directory": "styles",
        "default": "defaut.json",
        "available": [{ "id": "defaut", "label": "Default", "file": "defaut.json" }]
    },
    "table": { "enabled": false },
    "clustering": { "enabled": false }
}
```

### Field Reference

#### `layers.json` — Index file

| Field            | Type   | Required | Description                                  |
| ---------------- | ------ | -------- | -------------------------------------------- |
| `id`             | string | Yes      | Unique layer identifier                      |
| `configFile`     | string | Yes      | Relative path to the layer's own config file |
| `layerManagerId` | string | No       | Identifier of the group in the layer manager |

#### Per-layer config `{layerId}_config.json`

| Field              | Type   | Required | Description                                                                   |
| ------------------ | ------ | -------- | ----------------------------------------------------------------------------- |
| `id`               | string | Yes      | Unique identifier (must match the directory name)                             |
| `label`            | string | Yes      | Display name of the layer                                                     |
| `zIndex`           | number | No       | Render order (higher = drawn on top)                                          |
| `geometry`         | string | Yes      | Geometry type: `"point"`, `"polyline"`, `"polygon"`, `"fill-extrusion"`       |
| `data.directory`   | string | No       | Data subdirectory (default: `"data"`)                                         |
| `data.file`        | string | Yes      | GeoJSON file (relative to the layer directory)                                |
| `data.ogcApi`      | object | No       | OGC API Features source (see below). Replaces `data.file` / `data.directory`. |
| `styles.directory` | string | No       | Styles subdirectory (default: `"styles"`)                                     |

### `data.ogcApi` — OGC API Features source

When `data.ogcApi` is set, the layer is loaded from an OGC API Features REST endpoint instead of a static file.

```json
{
    "id": "batiments",
    "label": "IGN buildings",
    "geometry": "polygon",
    "data": {
        "ogcApi": {
            "url": "https://data.geopf.fr/ogcapi/collections/BDTOPO_V3:batiment/items",
            "bbox": [2.2, 48.8, 2.4, 48.9],
            "maxFeatures": 5000,
            "limit": 1000,
            "autoRefresh": true,
            "autoRefreshDebounce": 400
        }
    }
}
```

#### `data.ogcApi` parameters

| Parameter             | Type     | Default | Description                                                                                                           |
| --------------------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| `url`                 | string   | —       | Required. Endpoint URL (base URL, or full `/items` path)                                                              |
| `collectionId`        | string   | —       | Optional. OGC collection identifier — appended to `url` when `url` does not end with `/items`                         |
| `bbox`                | number[] | —       | Optional. Bounding-box filter `[minLon, minLat, maxLon, maxLat]`. Overridden by the viewport when `autoRefresh` is on |
| `maxFeatures`         | number   | 10000   | Optional. Overall feature limit (memory guard against oversized responses)                                            |
| `limit`               | number   | 1000    | Optional. Features per page (`limit` query parameter)                                                                 |
| `autoRefresh`         | boolean  | false   | Optional. Re-fetches features on every `moveend` event, using the current viewport bounding box                       |
| `autoRefreshDebounce` | number   | 300     | Optional. Debounce applied to `moveend` events, in ms                                                                 |
| `headers`             | object   | —       | Optional. Additional HTTP headers (e.g. `{ "Authorization": "Bearer …" }`)                                            |
| `styles.default`      | string   | Yes     | Name of the default style file                                                                                        |
| `styles.available`    | array    | No      | Available style variants `{id, label, file}`                                                                          |
| `table.enabled`       | boolean  | No      | Enable the data table panel                                                                                           |
| `clustering.enabled`  | boolean  | No      | Enable clustering (`point` layers)                                                                                    |

### Multi-Layer Configuration File

To define all layers in one file (`layers.json`):

```json
{
    "layers": [
        {
            "id": "climate",
            "name": "Climate Zones",
            "type": "polygon",
            "dataSource": "layers/climate/data.geojson",
            "defaultStyle": "default"
        },
        {
            "id": "cities",
            "name": "Cities",
            "type": "point",
            "dataSource": "layers/cities/data.geojson",
            "defaultStyle": "default"
        }
    ]
}
```

---

## 7. mapping.json - Data Normalization

**Location:** `profiles/{profile-name}/mapping.json`  
**Required:** No  
**Purpose:** Map external field names onto GeoLeaf's internal structure

### Complete Structure

```json
{
    "source": "source description or endpoint (informative)",
    "mapping": {
        "id": "external_id",
        "title": "name",
        "lat": "latitude",
        "lng": "longitude",
        "categoryId": "poi_type"
    }
}
```

### Field Reference

| Field     | Type   | Required | Description                                              |
| --------- | ------ | -------- | -------------------------------------------------------- |
| `source`  | string | No       | Description or URL of the data source (informative only) |
| `mapping` | object | Yes      | Correspondence table: `{geoLeafField: "externalField"}`  |

**Mappable fields in `mapping`:**

| GeoLeaf key  | Description                                |
| ------------ | ------------------------------------------ |
| `id`         | Unique POI identifier                      |
| `title`      | POI name                                   |
| `lat`        | Latitude                                   |
| `lng`        | Longitude                                  |
| `categoryId` | Category identifier (matches the taxonomy) |

> For the full normaliser format and the advanced transformation options, see [data-normalizer.md](config/data-normalizer.md).

---

## 8. Style Files - Layer Styling

**Location:** `profiles/{profile-name}/layers/{layerId}/styles/{styleId}.json`  
**Required:** At least one style (usually `default.json`) per layer  
**Purpose:** Define visual appearance, labels, and legend for layer

### Complete Structure

```json
{
    "id": "default",
    "name": "Default Style",
    "name_fr": "Style par défaut",
    "description": "Standard visualization for climate zones",

    "label": {
        "enabled": true,
        "visibleByDefault": false,
        "field": "name",
        "format": "{name}",
        "minZoom": 10,
        "maxZoom": 18
    },

    "scaleConfig": {
        "minScale": 9222148,
        "maxScale": 2252
    },

    "labelScale": {
        "minScale": 576384,
        "maxScale": 2252
    },

    "style": {
        "fillColor": "#3388ff",
        "fillOpacity": 0.2,
        "color": "#3388ff",
        "weight": 2,
        "opacity": 1,
        "dashArray": null
    },

    "styleRules": [
        {
            "condition": { "property": "climate_type", "equals": "Temperate" },
            "style": {
                "fillColor": "#66cc66",
                "color": "#44aa44"
            }
        },
        {
            "condition": { "property": "climate_type", "equals": "Mediterranean" },
            "style": {
                "fillColor": "#ff8833",
                "color": "#dd6611"
            }
        }
    ],

    "legend": {
        "enabled": true,
        "title": "Climate Types",
        "items": [
            {
                "label": "Temperate",
                "label_fr": "Tempéré",
                "color": "#66cc66",
                "icon": null
            },
            {
                "label": "Mediterranean",
                "label_fr": "Méditerranéen",
                "color": "#ff8833",
                "icon": null
            },
            {
                "label": "Continental",
                "label_fr": "Continental",
                "color": "#3388ff",
                "icon": null
            }
        ]
    }
}
```

### Field Reference

#### `label` (object, required)

Label configuration for this style.

| Field              | Type    | Required | Description                                                                                                                |
| ------------------ | ------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `enabled`          | boolean | Yes      | Whether labels are supported for this style                                                                                |
| `visibleByDefault` | boolean | Yes      | Initial label visibility when layer activated (since v2.0.0 — see [Labels documentation](labels/GeoLeaf_Labels_README.md)) |
| `field`            | string  | No       | GeoJSON property field to use for label text                                                                               |
| `format`           | string  | No       | Label template with `{fieldName}` placeholders                                                                             |
| `minZoom`          | number  | No       | Minimum zoom for label visibility (overrides `labelScale.minZoom`)                                                         |
| `maxZoom`          | number  | No       | Maximum zoom for label visibility                                                                                          |

**Note:** `visibleByDefault` belongs in the style file, not in the layer config. See the [Labels documentation](labels/GeoLeaf_Labels_README.md).

**Label format examples:**

```jsonc
{
  "format": "{name}"                           // Simple field
}
{
  "format": "{name} ({population})"            // Multiple fields
}
{
  "format": "{name} - {climate_type}"          // With separator
}
```

#### `scaleConfig` (object, optional)

Scale range the layer is visible in.

::: warning Scale denominators, not zoom levels

The unit is a **scale denominator** — the X in `1:X` — not a MapLibre zoom level. It is the same
number the `scale` control displays. Writing a zoom level here (`6`, `18`) hides the layer at
**every** zoom: `1:6` would need a zoom of roughly 27, which MapLibre never reaches. Since v3.0.0
the validator **rejects** any bound `<= 24`, and rejects the retired `zoomConfig` / `layerScale`
blocks outright.

Counter-intuitive but consistent: `minScale` is the **larger** number. "Min" refers to the widest
view (the lowest zoom) — and a denominator _grows_ as you zoom out.

Conversion (latitude-dependent): `1:X = 591 658 734 × cos(latitude) / 2^zoom`. At ~4°N:
zoom 5 ≈ 1:18 444 296 · zoom 6 ≈ 1:9 222 148 · zoom 10 ≈ 1:576 384 · zoom 18 ≈ 1:2 252.

:::

| Field      | Type          | Default | Description                                                                       |
| ---------- | ------------- | ------- | --------------------------------------------------------------------------------- |
| `minScale` | number / null | null    | Widest view allowed (the **larger** denominator). Hidden when zoomed out past it. |
| `maxScale` | number / null | null    | Closest view allowed (the smaller denominator). Hidden when zoomed in past it.    |

_Renamed from `zoomConfig` in v3.0.0, itself a rename of `layerScale`: the earlier names claimed zoom
levels while the engine read denominators. The name now states the unit. `null` or `0` disables a
bound._

#### `labelScale` (object, optional)

Scale range the layer's **labels** are visible in — same unit and same guard as `scaleConfig`, but
scoped to the labels rather than the layer. Typically narrower, to avoid clutter.

| Field      | Type          | Default | Description                             |
| ---------- | ------------- | ------- | --------------------------------------- |
| `minScale` | number / null | null    | Widest view at which labels still show  |
| `maxScale` | number / null | null    | Closest view at which labels still show |

**Best practice:** keep the labels inside a narrower window than the layer — a **smaller**
`minScale` means they only appear once you are closer in:

```jsonc
{
    "scaleConfig": { "minScale": 9222148, "maxScale": 2252 }, // layer from ~1:9.2M to ~1:2.2k
    "labelScale": { "minScale": 576384, "maxScale": 2252 }, // labels only from ~1:576k
}
```

#### `style` (object, required)

MapLibre GL JS paint/layout options for styling features.

**For polygons/multipolygons:**

| Field         | Type   | Description                                        |
| ------------- | ------ | -------------------------------------------------- |
| `fillColor`   | string | Fill color (hex, rgb, or named color)              |
| `fillOpacity` | number | Fill opacity (0-1)                                 |
| `color`       | string | Border color                                       |
| `weight`      | number | Border width in pixels                             |
| `opacity`     | number | Border opacity (0-1)                               |
| `dashArray`   | string | Dash pattern (e.g., `"5, 10"`) or `null` for solid |

**For lines:**

| Field       | Type   | Description                                      |
| ----------- | ------ | ------------------------------------------------ |
| `color`     | string | Line color                                       |
| `weight`    | number | Line width in pixels                             |
| `opacity`   | number | Line opacity (0-1)                               |
| `dashArray` | string | Dash pattern or `null`                           |
| `lineCap`   | string | Line cap style: `"butt"`, `"round"`, `"square"`  |
| `lineJoin`  | string | Line join style: `"miter"`, `"round"`, `"bevel"` |

**For fill-extrusion polygons (3D volumes):**

> Available since **v2.2.0**. Requires `geometry: "fill-extrusion"` in `{layer}_config.json`.

| Field                  | Type           | Required | Description                                                               |
| ---------------------- | -------------- | -------- | ------------------------------------------------------------------------- |
| `fillExtrusionColor`   | string         | Yes      | Colour of the extruded volumes (hex or CSS)                               |
| `fillExtrusionOpacity` | number         | No       | Opacity (0–1). Default: `1.0`                                             |
| `fillExtrusionHeight`  | number\|string | Yes      | Height in metres: fixed value, or a feature field name (e.g. `"hauteur"`) |
| `fillExtrusionBase`    | number\|string | No       | Base height in metres (floating volumes). Default: `0`                    |

> `fillExtrusionHeight` and `fillExtrusionBase` accept a feature field name (string) — GeoLeaf generates the MapLibre expression `["get", "hauteur"]` automatically. Validation is handled by `style-validator-extrusion.ts`.

**For points (markers):**

Markers use taxonomy icon configuration, not style settings.

#### `styleRules` (array, optional)

Conditional styling based on feature properties.

**Rule structure:**

```jsonc
{
    "condition": {
        "property": "field_name",
        "operator": "equals", // equals, contains, gt, gte, lt, lte, in
        "value": "comparison_value",
    },
    "style": {
        // Override style properties
    },
}
```

**Operators:**

- `equals` - Exact match
- `contains` - String contains substring
- `gt` / `gte` - Greater than / greater than or equal
- `lt` / `lte` - Less than / less than or equal
- `in` - Value in array

**Examples:**

```json
{
    "styleRules": [
        {
            "condition": { "property": "population", "operator": "gt", "value": 1000000 },
            "style": { "fillColor": "#ff0000", "weight": 3 }
        },
        {
            "condition": { "property": "type", "operator": "in", "value": ["city", "town"] },
            "style": { "fillColor": "#ffff00" }
        }
    ]
}
```

#### `legend` (object, optional)

Legend configuration for this style.

| Field      | Type    | Required | Description               |
| ---------- | ------- | -------- | ------------------------- |
| `enabled`  | boolean | Yes      | Whether to display legend |
| `title`    | string  | No       | Legend title              |
| `title_fr` | string  | No       | Localized title           |
| `items`    | array   | Yes      | Legend item definitions   |

**Legend item:**

```jsonc
{
    "label": "Item Label",
    "label_fr": "Libellé",
    "color": "#ff0000",
    "icon": null, // Or icon identifier
    "description": "Optional description",
}
```

---

## 9. POI Configuration

**Location:** `profiles/{profile-name}/data/poi.json`  
**Required:** No (POIs can be added programmatically)  
**Purpose:** Initial POI data loaded on map initialization

### Structure

```json
{
    "version": "1.0",
    "lastUpdated": "2026-01-20",
    "count": 3,

    "pois": [
        {
            "id": "eiffel-tower",
            "latlng": [48.8584, 2.2945],
            "title": "Eiffel Tower",
            "description": "Iconic iron lattice tower",
            "category": "monument",
            "subcategory": "landmark",
            "properties": {
                "address": "Champ de Mars, 5 Avenue Anatole France, 75007 Paris",
                "phone": "+33 892 70 12 39",
                "website": "https://www.toureiffel.paris",
                "openingHours": "9:00-23:45",
                "ticketPrice": "26.80 EUR",
                "accessibility": "partial",
                "rating": 4.6
            }
        },
        {
            "id": "louvre",
            "latlng": [48.8606, 2.3376],
            "title": "Louvre Museum",
            "description": "World's largest art museum",
            "category": "museum",
            "subcategory": "art",
            "properties": {
                "address": "Rue de Rivoli, 75001 Paris",
                "phone": "+33 1 40 20 50 50",
                "website": "https://www.louvre.fr",
                "openingHours": "9:00-18:00",
                "closedDays": ["Tuesday"],
                "ticketPrice": "17 EUR",
                "accessibility": "full"
            }
        },
        {
            "id": "notre-dame",
            "latlng": [48.853, 2.3499],
            "title": "Notre-Dame Cathedral",
            "description": "Medieval Catholic cathedral (under restoration)",
            "category": "monument",
            "subcategory": "religious",
            "properties": {
                "address": "6 Parvis Notre-Dame, 75004 Paris",
                "website": "https://www.notredamedeparis.fr",
                "status": "restoration",
                "reopening": "2024-12-08"
            }
        }
    ]
}
```

### Field Reference

**Root fields:**

| Field         | Type   | Description             |
| ------------- | ------ | ----------------------- |
| `version`     | string | Data version            |
| `lastUpdated` | string | ISO date of last update |
| `count`       | number | Total POI count         |
| `pois`        | array  | Array of POI objects    |

**POI object (required fields):**

| Field      | Type             | Description                         |
| ---------- | ---------------- | ----------------------------------- |
| `id`       | string           | Unique POI identifier               |
| `latlng`   | [number, number] | Coordinates `[latitude, longitude]` |
| `title`    | string           | POI name/title                      |
| `category` | string           | Category ID (must match taxonomy)   |

**POI object (optional fields):**

| Field         | Type   | Description                              |
| ------------- | ------ | ---------------------------------------- |
| `description` | string | POI description                          |
| `subcategory` | string | Subcategory ID (must match taxonomy)     |
| `properties`  | object | Custom properties (address, phone, etc.) |

---

## 10. Route Configuration

**Location:** `profiles/{profile-name}/data/routes.json`  
**Required:** No  
**Purpose:** Define routes (paths, itineraries) with waypoints

### Structure

```json
{
    "version": "1.0",
    "routes": [
        {
            "id": "paris-tour",
            "name": "Paris Highlights Tour",
            "name_fr": "Tour des points forts de Paris",
            "description": "2-hour walking tour of major attractions",
            "type": "walking",
            "distance": 5200,
            "duration": 7200,
            "difficulty": "easy",

            "waypoints": [
                {
                    "id": "eiffel-tower",
                    "order": 1,
                    "latlng": [48.8584, 2.2945],
                    "title": "Eiffel Tower",
                    "stopDuration": 1800
                },
                {
                    "id": "trocadero",
                    "order": 2,
                    "latlng": [48.862, 2.2876],
                    "title": "Trocadéro",
                    "stopDuration": 600
                },
                {
                    "id": "arc-triomphe",
                    "order": 3,
                    "latlng": [48.8738, 2.295],
                    "title": "Arc de Triomphe",
                    "stopDuration": 900
                }
            ],

            "path": [
                [48.8584, 2.2945],
                [48.86, 2.29],
                [48.862, 2.2876],
                [48.865, 2.29],
                [48.8738, 2.295]
            ],

            "style": {
                "color": "#e74c3c",
                "weight": 4,
                "opacity": 0.7,
                "dashArray": null
            },

            "properties": {
                "accessibility": "wheelchair-friendly",
                "highlights": ["Eiffel Tower", "Arc de Triomphe"],
                "bestTime": "morning"
            }
        }
    ]
}
```

### Field Reference

**Route object:**

| Field        | Type   | Required | Description                                                    |
| ------------ | ------ | -------- | -------------------------------------------------------------- |
| `id`         | string | Yes      | Unique route identifier                                        |
| `name`       | string | Yes      | Route name                                                     |
| `type`       | string | Yes      | Route type: `"walking"`, `"cycling"`, `"driving"`, `"transit"` |
| `distance`   | number | No       | Total distance in meters                                       |
| `duration`   | number | No       | Estimated duration in seconds                                  |
| `difficulty` | string | No       | Difficulty: `"easy"`, `"moderate"`, `"hard"`                   |
| `waypoints`  | array  | Yes      | Array of waypoint objects                                      |
| `path`       | array  | Yes      | Array of `[lat, lng]` coordinates defining the route path      |
| `style`      | object | No       | MapLibre GL JS paint options for line/polyline styling         |
| `properties` | object | No       | Custom properties                                              |

**Waypoint object:**

| Field          | Type             | Required | Description                                |
| -------------- | ---------------- | -------- | ------------------------------------------ |
| `id`           | string           | Yes      | Waypoint identifier (can reference POI ID) |
| `order`        | number           | Yes      | Stop order (1, 2, 3, ...)                  |
| `latlng`       | [number, number] | Yes      | Coordinates                                |
| `title`        | string           | Yes      | Waypoint name                              |
| `stopDuration` | number           | No       | Recommended stop duration in seconds       |

---

## 11. POI Add Feature — `modules.editor.showAddPoi`

::: danger Keys removed in v3

`ui.showAddPoi` and `poiAddConfig.enabled` no longer exist. Both were removed when the `addpoi`
plugin merged into `editor`. A profile that still sets either key fails validation — `ui.schema.json`
declares `additionalProperties: false`.

:::

The add-POI button is governed by a single parameter, on the plugin side:

| Parameter                   | Location                     | Role                                     |
| --------------------------- | ---------------------------- | ---------------------------------------- |
| `modules.editor.showAddPoi` | `config/plugins/editor.json` | Shows or hides the button in the toolbar |

::: warning The default is inverted

`ui.showAddPoi` used to default to `false` (opt-in); `modules.editor.showAddPoi` defaults to `true`
(opt-out), like the plugin's other lazy slots.

:::

There is no second level: the editor plugin loads lazily when the button is used, so it does not have
to be enabled separately.

```json
{
    "editor": {
        "showAddPoi": true
    }
}
```

**To hide the button:**

```json
{
    "editor": {
        "showAddPoi": false
    }
}
```

## 12. geocodingConfig — Address Search

::: warning Moved to a plugin

Address search (geocoding) is no longer part of `@geoleaf/core`: it is provided by the MIT plugin
**`@geoleaf-plugins/geocoding`**. The configuration moves from the root key **`geocodingConfig`** to
**`modules.geocoding.*`** (declared in `config/plugins/geocoding.json` through
`Files.modules.geocoding`) — a **breaking** migration, with no shim. The `GeoLeaf.Geocoding` API, the
`geoleaf:geocoding:result` event and the search control all come from the plugin. See the plugin
README (`packages/plugins/geocoding/README.md`).

:::

---

## Configuration Best Practices

### 1. File Organization

```
profiles/
  tourism/
    profile.json              ← Main config (single source of truth)
    taxonomy.json             ← Categories
    themes.json               ← Themes
    mapping.json              ← Data mapping (optional)
    layers/
      climate/
        config.json           ← Layer config
        data.geojson          ← GeoJSON data
        styles/
          default.json        ← Default style
          detailed.json       ← Alternative style
      cities/
        ... (same structure)
    data/
      poi.json                ← Initial POIs
      routes.json             ← Routes
```

### 2. Validation

- **Always validate JSON** before deploying (use JSONLint, VS Code, or `npm run validate`)
- **Use JSON Schema** validation for strict type checking
- **Test with debug mode** enabled: `{ "debug": { "enabled": true } }`

### 3. Performance

- **Minimize file sizes** - Use minified GeoJSON, compress with gzip
- **Lazy load layers** - Don't load all layers on init, load on-demand
- **Use CDN** for static files when possible
- **Enable clustering** for 100+ POIs

### 4. Maintainability

- **Use descriptive IDs** - `"hotel-eiffel"` not `"h1"`
- **Add descriptions** - Future maintainers will thank you
- **Version your configs** - Include `version` field in all files
- **Document custom properties** - Add comments in separate README

### 5. Internationalization

- **Use `name_{lang}` pattern** for translations
- **Support fallback** - If `name_fr` missing, use `name`
- **Separate UI strings** from config when possible

---

## Migration Notes

### Historical label structure (v2.0.0)

::: danger Breaking change

Label `visibleByDefault` moved from the layer config to the style files.

:::

**Former structure (label in the layer config):**

```jsonc
// layers/cities/config.json
{
    "id": "cities",
    "labels": {
        "enabled": true,
        "visibleByDefault": false,
    },
}
```

**Current structure (label in the style file):**

```jsonc
// layers/cities/styles/default.json
{
  "id": "default",
  "label": {
    "enabled": true,
    "visibleByDefault": false  ← Moved here
  }
}
```

See [Labels documentation](labels/GeoLeaf_Labels_README.md) for full migration instructions.

---

## User identifier for POI editing

`GeoLeaf.Editor` attributes creations and edits to the `modifiedBy` field, resolved in this order of
priority:

1. **Config field** `user.id` in the active JSON profile
2. **sessionStorage** key `gl-user-id` (set by the host application)
3. **Anonymous fallback** `anonymous-<timestamp>` (stable for the session)

Integration example:

```html
<script>
    sessionStorage.setItem("gl-user-id", currentUser.email);
</script>
<script type="module" src="dist/geoleaf.esm.js"></script>
```

Or through the JSON profile:

```json
{
    "user": {
        "id": "admin@example.com"
    }
}
```

---

## Next Steps

- **[Profiles Guide](PROFILES_GUIDE.md)** - Create custom profiles
- **[User Guide](USER_GUIDE.md)** - Learn how to use configured features
- **[API Reference](API_REFERENCE.md)** - Programmatic configuration APIs
- **[Schema Documentation](schema/README.md)** - JSON Schema definitions

---

<p align="center">
  <strong>Questions?</strong> Check <a href="FAQ.md">FAQ</a> or open an <a href="https://github.com/yourusername/geoleaf-js/issues">issue</a>
</p>
