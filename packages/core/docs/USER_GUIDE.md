---
title: "GeoLeaf JS — User Guide"
---

# GeoLeaf JS — User Guide

**Applies to:** `@geoleaf/core` v3.x

**Audience:** developers integrating GeoLeaf into their own applications

This guide covers every GeoLeaf JS feature, from basic use to advanced configuration.

---

## Table of Contents

1. [Introduction & Overview](#1-introduction--overview)
2. [Installation](#2-installation)
3. [Quick Start](#3-quick-start)
4. [Understanding Profiles](#4-understanding-profiles)
5. [Configuration Basics](#5-configuration-basics)
6. [Working with Maps](#6-working-with-maps)
7. [UI Components](#7-ui-components)
    - [7.6 Address Search (Geocoding)](#76-address-search-geocoding)
    - [7.7 Responsive & Mobile Interface](#77-responsive--mobile-interface)
8. [Advanced Topics](#8-advanced-topics)
9. [Troubleshooting](#9-troubleshooting)
10. [Next Steps](#10-next-steps)

---

## 1. Introduction & Overview

### What is GeoLeaf?

GeoLeaf JS is a TypeScript interactive mapping library built on **MapLibre GL JS v6** (WebGL rendering, native vector tiles). It provides a high-level API for POIs (points of interest), GeoJSON layers, themes, filters and plugin integrations — entirely configurable through JSON profiles, with no application-side development.

### Key Features

- **Multi-Profile System** — preconfigured profiles for tourism and custom use cases
- **Layer data** — read and write features through `GeoLeaf.Layers`, whatever the geometry
- **Theme System** — light/dark themes with customisable layer-visibility presets
- **GeoJSON Support** — display of polygons, lines and complex geographic data
- **WebGL Rendering** — GPU rendering through MapLibre GL JS v6
- **Offline** — engine built into the core (`modules.offline`, IndexedDB), loaded on demand
- **Label System** — dynamic labels with zoom-based visibility
- **Advanced Filters** — multi-criteria filtering with taxonomies and categories
- **Point symbol** — per-category icons, tints and badges through the `taxonomy` capability
- **Security** — XSS protection through the secure DOM helpers

> The **data table** is provided by the MIT plugin `@geoleaf-plugins/table`.

### When to Use GeoLeaf

**Suitable use cases:**

- Tourism mapping applications (attractions, hotels, restaurants)
- Real-estate applications
- Venue and event management
- Geographic portals driven by JSON configuration

**Not recommended for:**

- Real-time GPS tracking with sub-second updates
- Flight simulators or advanced 3D navigation
- Applications requiring 10,000+ simultaneous markers

### Browser Support

| Browser        | Minimum version |
| -------------- | --------------- |
| Chrome/Edge    | 90+             |
| Firefox        | 88+             |
| Safari         | 14+             |
| Mobile Safari  | iOS 14+         |
| Chrome Android | 90+             |

**JavaScript required:** ES2022+ (async/await, Promises, ESM modules)

> MapLibre GL JS v6 requires WebGL 2.0 support (available in every modern browser).

---

## 2. Installation

### Option A: NPM (recommended for production)

```bash
npm install @geoleaf/core maplibre-gl
```

```typescript
import { Core } from "@geoleaf/core";
import "maplibre-gl/dist/maplibre-gl.css";
import "@geoleaf/core/style.css";

Core.init({
    mapId: "map",
    center: [48.8566, 2.3522], // [lat, lng] — GeoLeaf; MapLibre expects [lng, lat], the conversion is internal
    zoom: 12,
});
```

> **Peer dependency:** `maplibre-gl ^6.0.0` must be installed separately.

### Option B: CDN (quick start)

GeoLeaf is distributed exclusively as **ESM**. Use `<script type="module">`:

```html
<!-- MapLibre GL JS (peer dependency — must be loaded BEFORE GeoLeaf) -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.css" />
<script type="module">
    import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.mjs";
    globalThis.maplibregl = maplibregl;
</script>

<!-- GeoLeaf styles -->
<link
    rel="stylesheet"
    href="https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf-main.min.css"
/>
```

::: warning

The two shim lines are not decorative. MapLibre has been ESM-only since v6 and no longer exposes
a global; `geoleaf.esm.js` declares it `external` and reaches it only through
`globalThis.maplibregl`. Without the shim, `new maplibregl.Map()` throws and the map never boots.
Because the block is **inline**, it requires `'unsafe-inline'` (or a nonce/hash) in `script-src` —
in production, prefer the self-hosted Option C, whose shim is a file.

:::

Before `</body>`:

```html
<!-- geoleaf:docs:fragment — continues the `<head>` block above, which carries the MapLibre shim -->
<script type="module">
    import { Core } from "https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf.esm.js";
    Core.init({ mapId: "map", center: [48.8566, 2.3522], zoom: 12 });
</script>
```

Or through jsDelivr:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.css" />
<script type="module">
    import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.mjs";
    globalThis.maplibregl = maplibregl;
</script>
<link
    rel="stylesheet"
    href="https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf-main.min.css"
/>

<script type="module">
    import { Core } from "https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf.esm.js";
    Core.init({ mapId: "map", center: [48.8566, 2.3522], zoom: 12 });
</script>
```

### Option C: Self-hosted

Download from the [releases](https://github.com/geoleaf/geoleaf-js/releases) and host the files on your own server:

```html
<!-- Self-hosted MapLibre: the shim is a FILE, so no CSP exception has to be granted -->
<link rel="stylesheet" href="/assets/maplibre-gl/maplibre-gl.css" />
<script type="module" src="/assets/maplibre-gl/global.mjs"></script>

<link rel="stylesheet" href="/assets/geoleaf/geoleaf-main.min.css" />
<script type="module">
    import { Core } from "/assets/geoleaf/geoleaf.esm.js";
    Core.init({ mapId: "map", center: [48.8566, 2.3522], zoom: 12 });
</script>
```

The contents of `global.mjs` are two lines — the same shim as above, moved out of the document so
that it no longer requires `'unsafe-inline'`:

```javascript
import * as maplibregl from "./maplibre-gl.mjs";
globalThis.maplibregl = maplibregl;
```

### Verifying the installation

Open the browser console:

```javascript
console.log(GeoLeaf.version);
// Should output: "3.0.0"
```

---

## 3. Quick Start

### Minimal example

```html
<!DOCTYPE html>
<html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />

        <link
            rel="stylesheet"
            href="https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.css"
        />
        <script type="module">
            import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.mjs";
            globalThis.maplibregl = maplibregl;
        </script>
        <link
            rel="stylesheet"
            href="https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf-main.min.css"
        />

        <style>
            #map {
                width: 100%;
                height: 600px;
            }
        </style>
    </head>

    <body>
        <div id="map"></div>

        <script type="module">
            import { Core } from "https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf.esm.js";

            GeoLeaf.Core.init({ mapId: "map", center: [46.2, 2.2], zoom: 6 });

            // A POI is a feature of an ordinary point layer.
            // `GeoLeaf.POI` no longer exists as of v3 — see CHANGELOG [3.0.0].
            document.addEventListener("geoleaf:app:ready", () => {
                GeoLeaf.Layers.addFeature("ma-couche", {
                    type: "Feature",
                    geometry: { type: "Point", coordinates: [2.3522, 48.8566] },
                    properties: {
                        id: "paris",
                        title: "Paris",
                        description: "Capital of France",
                    },
                });
            });
        </script>
    </body>
</html>
```

> **Coordinate order — both orders coexist, deliberately:**
> `Core.init({ center })` and a profile's `map.center` expect **`[lat, lng]`**; the
> `coordinates` of a GeoJSON feature stay **`[lng, lat]`** (the GeoJSON standard, which MapLibre
> follows). The conversion lives exclusively in the adapter — see `ARCHITECTURE_GUIDE.md`.

### Step-by-step tutorial

See [GETTING_STARTED.md](GETTING_STARTED.md) for a detailed 5-minute tutorial.

---

## 4. Understanding Profiles

### What Are Profiles?

Profiles are predefined configurations that define:

- **UI layout** (layer manager, filter panel, cache controls)
- **Basemaps** (available background maps — MapLibre GL JS styles)
- **POI configuration** (categories, icons, search)
- **File paths** (where to load the JSON data from)
- **Taxonomy** (category hierarchy and icons)
- **Default settings** (initial zoom, centre and theme)

### Built-in profiles

#### 4.1 Tourism profile

**Purpose:** tourist attractions, hotels, restaurants, events

**Features:**

- 35+ preconfigured layers (climate, conservation zones, cities, routes)
- Rich taxonomy with 50+ categories (museums, monuments, hotels, restaurants)
- Icon sprites optimised for tourism
- Search by attraction name, city or category

**Configuration:** `profiles/tourism/geoleaf.config.json`

#### 4.2 Custom profiles

Profiles can be created for any business domain. See [PROFILES_GUIDE.md](PROFILES_GUIDE.md).

### Switching Profiles

#### At initialisation

```javascript
const map = GeoLeaf.init({
    map: { target: "map", center: [48.8, 2.3], zoom: 10 },
    data: {
        activeProfile: "tourism",
        profilesBasePath: "/profiles/",
    },
});
```

#### Loading a profile from a URL

```javascript
await GeoLeaf.loadConfig("/profiles/tourism/geoleaf.config.json");
```

**Note:** loading a new profile reloads the whole configuration and clears the current POIs.

---

## 5. Configuration Basics

### 5.1 Main configuration file

The entry point is `geoleaf.config.json`:

```json
{
    "debug": {
        "enabled": false,
        "modules": ["config", "poi", "storage"]
    },
    "data": {
        "activeProfile": "tourism",
        "profilesBasePath": "/profiles/"
    }
}
```

**Key fields:**

- `debug.enabled` — enables verbose console logging
- `debug.modules` — modules to debug (or `["*"]` for all of them)
- `data.activeProfile` — profile to load
- `data.profilesBasePath` — base path to the profile directories

### 5.2 Profile configuration file

Every profile has its own `profile.json`:

```json
{
    "name": "Tourism",
    "version": "1.0",
    "ui": {
        "layerManager": { "enabled": true, "position": "topright" },
        "filterPanel": { "enabled": true, "position": "topleft" },
        "searchBar": { "enabled": true, "position": "topleft" },
        "cacheControls": { "enabled": true, "position": "bottomleft" }
    },
    "basemaps": [
        {
            "id": "osm",
            "name": "Street Map",
            "style": "https://tiles.openfreemap.org/styles/liberty",
            "default": true
        }
    ],
    "Files": {
        "taxonomy": "taxonomy.json",
        "themes": "themes.json",
        "layers": "layers/",
        "poi": "data/poi.json"
    },
    "defaultSettings": {
        "map": {
            "center": [2.3522, 48.8566],
            "zoom": 12,
            "minZoom": 5,
            "maxZoom": 18
        },
        "theme": "light"
    }
}
```

> **Note (v2.0.0):** basemaps now use the `style` field (a URL to a MapLibre GL JS style)
> rather than an XYZ tile URL template.

### 5.3 Taxonomy configuration

Defines the categories, subcategories and icons in `taxonomy.json`:

```json
{
    "icons": {
        "sprite": "assets/icons/tourism-sprite.png",
        "iconSize": [32, 32],
        "iconAnchor": [16, 32]
    },
    "categories": [
        {
            "id": "accommodation",
            "name": "Hébergement",
            "icon": "bed",
            "subcategories": [
                { "id": "hotel", "name": "Hôtel", "icon": "hotel" },
                { "id": "hostel", "name": "Auberge", "icon": "hostel" },
                { "id": "camping", "name": "Camping", "icon": "camping" }
            ]
        },
        {
            "id": "food",
            "name": "Restauration",
            "icon": "restaurant",
            "subcategories": [
                { "id": "restaurant", "name": "Restaurant", "icon": "restaurant" },
                { "id": "cafe", "name": "Café", "icon": "cafe" },
                { "id": "bar", "name": "Bar", "icon": "bar" }
            ]
        }
    ]
}
```

### 5.4 Theme configuration

Defines the layer-visibility presets in `themes.json`:

```json
{
    "config": {
        "defaultTheme": "default",
        "allowCustomThemes": true
    },
    "themes": [
        {
            "id": "default",
            "name": "Vue par Défaut",
            "type": "primary",
            "layers": {
                "climate": true,
                "cities": true,
                "poi": true,
                "conservation-zones": false
            }
        },
        {
            "id": "heritage",
            "name": "Sites Patrimoniaux",
            "type": "secondary",
            "layers": {
                "monuments": true,
                "conservation-zones": true,
                "museums": true,
                "cities": false
            }
        }
    ]
}
```

### 5.5 Layer style configuration

A layer can carry several styles in `layers/<layer-name>/styles/<style-id>.json`:

```json
{
    "id": "default",
    "description": "Default style for climate layer",
    "label": {
        "enabled": true,
        "visibleByDefault": false
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
        "weight": 2
    },
    "legend": {
        "enabled": true,
        "items": [
            { "label": "Temperate", "color": "#3388ff" },
            { "label": "Mediterranean", "color": "#ff8833" }
        ]
    }
}
```

**Key fields:**

- `label.enabled` — whether labels are supported for this layer
- `label.visibleByDefault` — initial label visibility state
- `scaleConfig` — layer visibility range, in **scale denominators** (the `X` of `1:X`, the value the scale control displays) — **not** zoom levels. `minScale` is the **larger** of the two numbers: it bounds the widest view, and a denominator grows as the map zooms out. A value `<= 24` is rejected (it would be a zoom level entered by mistake)
- `labelScale` — the same for labels (same unit), usually a narrower range
- `style` — styling options for the layer
- `legend` — legend configuration

---

## 6. Working with Maps

### 6.1 POI Management

#### Adding POIs

> **BREAKING (v3.0.0) — `GeoLeaf.POI` no longer exists.** A POI is a **point feature of an
> ordinary GeoJSON layer**: read and write its data through **`GeoLeaf.Layers`**, and its
> symbol is driven by the `taxonomy` capability. Coordinates follow the GeoJSON / MapLibre GL JS
> convention: `[longitude, latitude]`.
> Full reference: [API_REFERENCE.md](API_REFERENCE.md#layers--feature-data).

```javascript
// Add a feature. `layerId` is the id declared in config/core/layers.json.
GeoLeaf.Layers.addFeature("monuments", {
    type: "Feature",
    geometry: { type: "Point", coordinates: [2.2945, 48.8584] }, // [lng, lat]
    properties: {
        id: "eiffel-tower",
        title: "Eiffel Tower",
        description: "Iconic iron tower",
        categoryId: "monument", // resolved by the taxonomy capability
        address: "Champ de Mars, Paris",
        website: "https://www.toureiffel.paris",
    },
});

// Adding several at once: setData replaces the base dataset in a single call
// (preferable to N calls to addFeature — one source re-render only).
GeoLeaf.Layers.setData("monuments", features);
```

#### Reloading

```javascript
// Replaces every feature of the layer
GeoLeaf.Layers.setData("monuments", newFeatures);
```

#### Reading

```javascript
// One feature by its stable id
const feature = GeoLeaf.Layers.getFeatureById("monuments", "eiffel-tower");

// Every feature of the layer
const all = GeoLeaf.Layers.getFeatures("monuments");

// How many, and which layers exist
const n = GeoLeaf.Layers.getFeatureCount("monuments");
const ids = GeoLeaf.Layers.listLayerIds();
```

> **BREAKING (v3.0.0)** — `GeoLeaf.Filters.filterPoiList` is removed (no internal
> consumer). Use the `GeoLeaf.Filter` (singular) capability's active panel state
> instead: `GeoLeaf.Filter.getActiveFilter()` / `GeoLeaf.Filter.applyFilter(state)`.

### 6.2 Basemaps

#### Changing basemap

```javascript
// Programmatically change basemap
GeoLeaf.Baselayers.setBaseLayer("satellite");

// Get current basemap key
const currentKey = GeoLeaf.Baselayers.getActiveKey();
console.log(currentKey); // "satellite"

// Get current basemap object
const currentLayer = GeoLeaf.Baselayers.getActiveLayer();
```

#### Custom basemaps

Add them to `profile.json`:

```json
{
    "basemaps": [
        {
            "id": "my-vector-map",
            "name": "Ma Carte Vectorielle",
            "style": "https://tiles.myserver.com/style.json",
            "default": false
        }
    ]
}
```

#### 3D basemaps with terrain

Enable 3D relief by adding a `terrain` object to the basemap definition (`basemaps.json`):

```json
{
    "basemaps": {
        "satellite-3d": {
            "id": "satellite-3d",
            "label": "Satellite 3D",
            "type": "tile",
            "url": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            "attribution": "Tiles &copy; Esri",
            "defaultBasemap": false,
            "terrain": {
                "enabled": true,
                "demUrl": "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
                "demEncoding": "terrarium",
                "demMaxZoom": 15,
                "exaggeration": 1.5,
                "default3D": true,
                "pitch": 60,
                "bearing": 0
            }
        }
    }
}
```

> **`default3D: true`** — terrain is enabled automatically as soon as this basemap is selected. There is no UI toggle: switching to a basemap without terrain turns 3D relief off automatically.

> **`map.maxPitch`** — the MapLibre default is 60°. GeoLeaf raises the ceiling to 80° by default. Configurable through `profile.json > map.maxPitch`.

#### 3D layers — extruded polygons (fill-extrusion)

> Available since **v2.2.0**

Layers of type `fill-extrusion` render GeoJSON polygons as 3D volumes (buildings, density, statistical data). Rendering is handled by the MapLibre GL JS WebGL engine.

**Typical use cases:**

- Building models with real or relative height
- Visualisation of area statistics (density, income, votes and so on)
- Regulatory or risk zones with a 3D visual indicator

**`{layer}_config.json` configuration:**

```json
{
    "id": "batiments",
    "label": "Bâtiments 3D",
    "geometry": "fill-extrusion",
    "interactiveShape": true,
    "data": { "dataUrl": "https://..." }
}
```

**Associated style file:**

```json
{
    "id": "defaut",
    "label": "Vue 3D bâtiments",
    "style": {
        "fillExtrusionColor": "#a8dadc",
        "fillExtrusionOpacity": 0.7,
        "fillExtrusionHeight": "hauteur",
        "fillExtrusionBase": 0
    }
}
```

> `fillExtrusionHeight` accepts either a **fixed numeric value** (metres) or a **feature field name** — GeoLeaf then generates the MapLibre expression `["get", "hauteur"]` automatically.

> **GPU performance** — fill-extrusion rendering is WebGL-accelerated. Performance stays optimal up to roughly 10,000 extruded polygons at zoom levels ≥ 14.

### 6.3 GeoJSON Layers

GeoJSON layers are configured through the profile (`geojsonLayers` in `geoleaf.config.json`).
Layer visibility is handled by the LayerManager panel (UI).

```javascript
// Initialize the layer manager control on the map (kernel — nothing to load first)
GeoLeaf.LayerManager.init({ map });

// Refresh the layer manager display
GeoLeaf.LayerManager.refresh();
```

### 6.4 Themes

#### UI theme (light/dark)

For the interface theme (light/dark), use `Core.setTheme`:

```javascript
GeoLeaf.Core.setTheme("dark");
const current = GeoLeaf.Core.getTheme(); // "dark"
```

### 6.5 Labels

Labels are an **in-core capability** (`modules.labels`), configured through the layer style files
(the `label` field). They ship in the bundle — nothing to load. Label visibility is handled
automatically by the LayerManager panel (a per-layer toggle button), and the capability can be
switched off in the profile (`modules.labels.enabled: false`).

Label configuration happens in the layer's style file (see section 5.5).

---

## 7. UI Components

### 7.1 Layer Manager

**Purpose:** control layer visibility (POI categories, GeoJSON layers)

**Configuration in profile.json:**

```json
{
    "ui": {
        "layerManager": {
            "enabled": true,
            "position": "topright",
            "collapsed": false
        }
    }
}
```

**Programmatic control:**

```javascript
GeoLeaf.LayerManager.init({ map });
GeoLeaf.LayerManager.refresh();
```

### 7.2 Filter Panel

**Purpose:** filter POIs by multiple criteria

**Configuration:**

```json
{
    "ui": {
        "filterPanel": {
            "enabled": true,
            "position": "topleft",
            "collapsed": true
        }
    }
}
```

**Programmatic filtering:**

```javascript
// Drive the map's own filter panel
GeoLeaf.Filter.applyFilter({ searchText: "easy" });
const active = GeoLeaf.Filter.getActiveFilter();
```

> **BREAKING (v3.1.0)** — the whole `GeoLeaf.Filters` namespace (plural) is removed, along
> with its last method `filterRouteList`, which had no caller. To filter an array of your
> own data, use `Array.prototype.filter`; to drive the map, use the `GeoLeaf.Filter`
> capability (singular) as shown above.
>
> Earlier, in v3.0.0: `GeoLeaf.Filters.filterPoiList` was removed for the same reason.

### 7.3 Search Bar

**Purpose:** search POIs by name, category or address

**Configuration:**

```json
{
    "ui": {
        "searchBar": {
            "enabled": true,
            "position": "topleft",
            "placeholder": "Rechercher...",
            "minChars": 2
        }
    }
}
```

> **BREAKING (v3.0.0) — `GeoLeaf.Search` no longer exists.** The full-text engine (`flexsearch`)
> was dormant: no profile enabled it and its index was never built. It has been removed, together
> with its npm dependency. The interface's actual text search — the search field of the Filter
> panel — is provided by the in-core **`filter`** capability (`kind: "text"`), and it is now
> insensitive to accents and to word order. Nothing to change for the UI; an integrator calling
> `GeoLeaf.Search.query()` from a script must implement their own search or index server-side.

**Programmatic use:**

```javascript
// Read the filter panel state (including the text field), serialisable
const state = GeoLeaf.Filter.getActiveFilter();

// Apply a filter state without going through the DOM
GeoLeaf.Filter.applyFilter(state);

// Is a filter active?
if (GeoLeaf.Filter.hasActiveFilters()) {
    GeoLeaf.Filter.reset();
}
```

### 7.4 Cache Controls

**Purpose:** offline cache management (IndexedDB storage) through the Storage plugin.

> **Note:** the offline cache features require the `@geoleaf-plugins/offline-ui` plugin (MIT, npmjs.org) — they are not part of the core bundle.

The cache API comes from the Storage plugin. See the plugin documentation for integration details.

```javascript
// Verify the storage plugin is available
if (GeoLeaf.plugins.isLoaded("storage")) {
    // Storage plugin API is available via GeoLeaf.Storage
    console.log("Storage plugin ready");
}
```

### 7.5 Notifications

```javascript
GeoLeaf.Notifications.success("POI added successfully");
GeoLeaf.Notifications.error("Failed to load the data");
GeoLeaf.Notifications.warning("Unstable connection");
GeoLeaf.Notifications.info("Loading...");
GeoLeaf.Notifications.success("Saved", { duration: 2000 });

GeoLeaf.Notifications.notify("Custom message", "info", 5000);

// Clear all visible notifications
GeoLeaf.Notifications.clearAll();

// Get current notification system status
const status = GeoLeaf.Notifications.getStatus();
```

### 7.6 Address Search (Geocoding)

::: warning

Address search (geocoding) has moved out of `@geoleaf/core`: it is now provided by the MIT plugin
**`@geoleaf-plugins/geocoding`** (public on npmjs.org). The configuration moves from the root key
**`geocodingConfig`** to **`modules.geocoding.*`** (declared in `config/plugins/geocoding.json`
through `Files.modules.geocoding`) — a breaking migration, with no shim. The `GeoLeaf.Geocoding`
API, the `geoleaf:geocoding:result` event and the search control all come from the plugin. See the
plugin README (`packages/plugins/geocoding/README.md`).

:::

---

### 7.7 Responsive & Mobile Interface

GeoLeaf ships a fully responsive interface that adapts to every screen size — from smartphone to large desktop — with no extra configuration.

#### Breakpoints

| Range          | Devices               | Behaviour                                                  |
| -------------- | --------------------- | ---------------------------------------------------------- |
| ≤ 768 px       | Smartphone, 6" tablet | **Mobile mode** — pill toolbar (left side), sheet overlays |
| 769 – 1 024 px | 10" PC / small laptop | Desktop layout, **360 px** side panel                      |
| ≥ 1 025 px     | 13"+ PC               | Desktop layout, **420 px** side panel                      |

The threshold values are exposed as CSS variables in `geoleaf-theme.css` (`:root`):

```css
--gl-bp-sm: 480px; /* smartphone    */
--gl-bp-md: 640px; /* phablet       */
--gl-bp-lg: 768px; /* tablet 6" / mobile threshold */
--gl-bp-xl: 1024px; /* PC 10"        */
```

#### Mobile pill toolbar (≤ 768 px)

On narrow viewports, the standard desktop controls are replaced by a **pill-shaped icon bar** anchored to the left side of the map.

| Icon        | Action                                                             |
| ----------- | ------------------------------------------------------------------ |
| Fullscreen  | Toggle fullscreen mode                                             |
| Legend      | Show or hide the legend                                            |
| Zoom + / −  | Map zoom                                                           |
| My location | Toggle geolocation                                                 |
| Search      | Open the search sheet                                              |
| Proximity   | Enable proximity search mode                                       |
| Filters     | Open the filter sheet. **Reset** indicator when filters are active |
| Themes      | Open the theme selection sheet                                     |
| Layers      | Open the layer manager sheet                                       |
| Table       | Open the data table sheet                                          |

#### Sheet overlay

Every panel uses a **bottom sheet** overlay (`role="dialog"`, `aria-modal="true"`, `aria-labelledby`). Supported:

- Tap on the dark backdrop to close
- **Escape** key to close
- Full focus trap: Tab/Shift-Tab stay inside the sheet
- Focus returned to the triggering button on close

#### Viewport meta tag

Make sure the HTML page includes:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
```

Do not use `user-scalable=no` — it blocks pinch-zoom and harms accessibility.

---

## 8. Advanced Topics

### 8.1 Custom Profiles

Create a profile by copying the structure of an existing one:

```
profiles/
  my-custom-profile/
    geoleaf.config.json    # Optional, falls back to the root config
    profile.json           # Required
    taxonomy.json          # Required
    themes.json            # Required
    layers/                # Optional, for GeoJSON layers
    data/                  # POI data files
```

### 8.2 OGC API Features

GeoLeaf natively supports loading layers from an **OGC API Features** endpoint (the REST/JSON successor to classic WFS).

**Minimal configuration:**

```json
{
    "id": "roads",
    "label": "Routes",
    "geometry": "polyline",
    "data": {
        "ogcApi": {
            "url": "https://api.example.com/collections/roads/items",
            "maxFeatures": 5000
        }
    }
}
```

**With viewport auto-refresh:**

```json
{
    "data": {
        "ogcApi": {
            "url": "https://data.geopf.fr/ogcapi/collections/BDTOPO_V3:batiment/items",
            "maxFeatures": 2000,
            "limit": 500,
            "autoRefresh": true,
            "autoRefreshDebounce": 400
        }
    }
}
```

With `autoRefresh: true`, GeoLeaf reloads the data at the end of every map pan or zoom, passing the current viewport bbox. Only the visible data is displayed, without preloading the whole dataset.

**With authentication:**

```json
{
    "data": {
        "ogcApi": {
            "url": "https://secure.api.com/collections/parcels/items",
            "headers": { "Authorization": "Bearer YOUR_TOKEN" },
            "maxFeatures": 10000
        }
    }
}
```

**Through `GeoLeaf.Utils.wktToGeoJSON()`:**

If an OGC API Features endpoint returns geometries in WKT format (some non-conforming implementations do), GeoLeaf converts them automatically. The function is also available publicly:

```javascript
const geom = GeoLeaf.Utils.wktToGeoJSON("POINT(2.3522 48.8566)");
// → { type: "Point", coordinates: [2.3522, 48.8566] }

const polygon = GeoLeaf.Utils.wktToGeoJSON("POLYGON((0 0, 4 0, 4 4, 0 4, 0 0))");
// → { type: "Polygon", coordinates: [[[0,0],[4,0],[4,4],[0,4],[0,0]]] }
```

### 8.3 Offline Mode

> Requires the `@geoleaf-plugins/offline-ui` plugin.

The offline cache is provided by the Storage plugin (`@geoleaf-plugins/offline-ui`).
See the plugin documentation for integration details.

```javascript
// Verify the storage plugin is loaded
const isLoaded = GeoLeaf.plugins.isLoaded("storage");
console.log("Storage plugin loaded:", isLoaded);
```

### 8.3 Custom Themes (CSS)

Override the default styles by loading a custom CSS file after geoleaf-main.min.css:

```html
<link
    rel="stylesheet"
    href="https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf-main.min.css"
/>
<link rel="stylesheet" href="/my-custom-theme.css" />
```

```css
/* Change primary color */
.geoleaf-button-primary {
    background-color: #e74c3c;
    border-color: #c0392b;
}

/* Change layer manager background */
.geoleaf-layer-manager {
    background-color: #2c3e50;
    color: #ecf0f1;
}
```

### 8.4 Events API

GeoLeaf uses the `GeoLeaf.Events` event bus (`CustomEvent` dispatched on `document`).

```javascript
// POI events
GeoLeaf.Events.on("geoleaf:poi:click", (e) => {
    console.log("POI clicked:", e.detail.poiId);
});

// Layer events
GeoLeaf.Events.on("geoleaf:layer:toggle", (e) => {
    console.log("Layer:", e.detail.layerId, "visible:", e.detail.visible);
});

// Theme events
GeoLeaf.Events.on("geoleaf:theme:applied", (e) => {
    console.log("Theme applied:", e.detail.themeName);
});

// Filter events
GeoLeaf.Events.on("geoleaf:filter:apply", (e) => {
    console.log("Active filters:", e.detail.activeCount);
});

// One-time listener
GeoLeaf.Events.once("geoleaf:app:ready", () => {
    console.log("App is ready!");
});

// Remove listener
const handler = (e) => console.log(e.detail);
GeoLeaf.Events.on("geoleaf:poi:click", handler);
GeoLeaf.Events.off("geoleaf:poi:click", handler);
```

See [EVENTS_API.md](EVENTS_API.md) for the full list of events.

### 8.5 Data Import/Export

The table can export the current selection:

::: info

The data table has been moved out of the core into the MIT plugin `@geoleaf-plugins/table`. It
loads through its own script (after `@geoleaf/core`); `GeoLeaf.Table` becomes available once the
plugin is loaded, **without** `_loadModule("table")`.

:::

```javascript
// Export the current table selection (CSV/GeoJSON)
GeoLeaf.Table.exportSelection();
```

To import points, write to the **layer** that carries them — since v3.0.0 a POI is a feature of an
ordinary GeoJSON point layer:

```javascript
// Import points from a JSON file into an existing point layer
const fileInput = document.querySelector("#file-input");
fileInput.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    const text = await file.text();
    const features = JSON.parse(text); // FeatureCollection or array of Feature
    GeoLeaf.Layers.setData("mes-points", features);
});
```

### 8.6 Importing geographic files (plugin)

To import **GPX, KML/KMZ, CSV or TopoJSON** files straight into the map, use the `@geoleaf-plugins/file-import` plugin (MIT):

```javascript
import "@geoleaf/core";
import "@geoleaf-plugins/file-import";

// Convert a file to GeoJSON
const geojson = await GeoLeaf.FileImport.convert(file); // format detected automatically

// Import and display it directly as a layer
await GeoLeaf.FileImport.importAsLayer(file, { layerId: "user-import" });
```

For **FlatGeobuf** data (streaming with spatial filtering):

```javascript
import "@geoleaf-plugins/flatgeobuf";

// Bounding-box loading (HTTP Range — only the area is downloaded)
const geojson = await GeoLeaf.FlatGeobuf.loadBbox("https://example.com/data.fgb", {
    minX: 2.2,
    minY: 48.8,
    maxX: 2.5,
    maxY: 49.0,
});
```

See [PLUGIN_CONFIGURATION_GUIDE.md](PLUGIN_CONFIGURATION_GUIDE.md) → the "Plugin File Import" and "Plugin FlatGeobuf" sections for the full option list.

---

## 9. Troubleshooting

### Common problems

#### 9.1 The map does not appear

**Symptoms:** blank space where the map should be

**Solutions:**

1. Check that the `#map` div has an explicit height in CSS:

    ```css
    #map {
        height: 600px;
    }
    ```

2. Make sure both the MapLibre GL JS **and** the GeoLeaf stylesheets are loaded
3. Check the browser console for errors (F12)
4. Make sure the container id matches `mapId` in the configuration
5. Check that WebGL is supported: `console.log(!!window.WebGLRenderingContext)`

#### 9.2 POIs not displayed

**Symptoms:** the map is visible but there are no markers

**Solutions:**

1. Check that the coordinates use the `[longitude, latitude]` order (MapLibre GL JS convention)
2. Check that the POI category matches a taxonomy category
3. Make sure the layer is enabled in the layer manager
4. Check that the current scale falls inside the layer's `scaleConfig` range — and that its bounds really are **scale denominators** (`1:X`), not zoom levels: this is the most frequent confusion, and it makes the layer invisible at every zoom

#### 9.3 Profile not loaded

**Symptoms:** a "Failed to load profile" error in the console

**Solutions:**

1. Check `profilesBasePath` in geoleaf.config.json
2. Make sure `profile.json` exists in the profile directory
3. Check that the paths inside `profile.json` are correct
4. Make sure the JSON files are valid (JSONLint.com)
5. Check for 404 errors in the DevTools Network tab

#### 9.4 Labels not displayed

**Solutions:**

1. Check `label.enabled: true` in the layer style file
2. Check that the zoom falls inside the `labelScale` range
3. Enable the label button in the layer manager
4. Make sure `label.visibleByDefault` is present in the style file

#### 9.5 Cache not working

**Solutions:**

1. Check that the `@geoleaf-plugins/offline-ui` plugin is loaded
2. Check that the browser supports IndexedDB
3. Check that the browser storage quota is not exceeded
4. Make sure HTTPS is used
5. Private/Incognito mode can disable the cache in some browsers

### Debug mode

```javascript
const map = GeoLeaf.init({
    map: { target: "map", center: [48.8, 2.3], zoom: 10 },
    debug: {
        enabled: true,
        modules: ["*"], // Or specific: ['poi', 'config', 'storage']
    },
});
```

---

## 10. Next Steps

### Documentation

- **[Configuration Guide](CONFIGURATION_GUIDE.md)** — full detail of the JSON configuration files
- **[Profiles Guide](PROFILES_GUIDE.md)** — building custom business profiles
- **[Events API](EVENTS_API.md)** — complete GeoLeaf event reference
- **[Cookbook](COOKBOOK.md)** — 10 practical recipes
- **[usage-cdn.md](usage-cdn.md)** — CDN and NPM loading

### Examples

- **Demo application** — run `npm run build` then `npm run build:deploy` to reach the demo
- **Tourism example** — see `profiles/tourism/` for the tourism profile showcase

### Community

- **[GitHub Repository](https://github.com/geoleaf/geoleaf-js)** — source code, issues, discussions
- **Contact:** Mattieu Pottier — contact@geoleaf.dev

---

<p align="center">
<strong>Need help?</strong><br>
See the <a href="COOKBOOK.md">Cookbook</a> · Report <a href="https://github.com/geoleaf/geoleaf-js/issues">Issues</a> · Read the <a href="CONTRIBUTING.md">Contributing Guide</a>
</p>
