---
title: "profile.json - Reading Guide"
---

# profile.json — reading guide

The authoritative parameter reference is [`PROFILE_SCHEMA_REFERENCE.md`](https://github.com/geoleaf/geoleaf-js/blob/main/docs/reference/PROFILE_SCHEMA_REFERENCE.md), generated from the ten JSON schemas in `profiles/schemas/`; where the two pages disagree, that one is right.

---

## Table of Contents

1. [Overview](#overview)

2. [Full structure](#full-structure)

3. [Root parameters](#root-parameters)

4. [map section](#map-section)

5. [Files section](#files-section)

6. [ui section](#ui-section)

7. [basemaps section](#basemaps-section)

8. [performance section — one key](#performance-section--one-key)

9. [search section — **REMOVED** (dead key)](#search-section--removed-dead-key)

10. [layerManagerConfig section](#layermanagerconfig-section)

11. [modules.legend section](#moduleslegend-section)

12. [poiConfig section — **REMOVED** (dead key)](#poiconfig-section--removed-dead-key)

13. [brandingConfig section — **REMOVED** (dead key)](#brandingconfig-section--removed-dead-key)

14. [tableConfig section — moved out of the core](#tableconfig-section--moved-out-of-the-core)

15. [scaleConfig section — **REMOVED** (dead key)](#scaleconfig-section--removed-dead-key)

16. [storage section — **REMOVED** (dead key)](#storage-section--removed-dead-key)

17. [poiAddConfig section — **REMOVED** (dead key)](#poiaddconfig-section--removed-dead-key)

18. [geocodingConfig section — **REMOVED** (dead key)](#geocodingconfig-section--removed-dead-key)

19. [Parameters missing from profile.json](#parameters-missing-from-profilejson)

20. [Summary table — **REMOVED**](#summary-table--removed)

21. [Final notes](#final-notes)

---

## Overview

The `profile.json` file is the **main configuration file** of a GeoLeaf profile. It declares:

- The user interface (visible components)

- The available base maps

- The performance settings

- The filter and search configuration

- The component settings (table, legend, layer manager)

### Location

```

profiles/{profile-name}/profile.json

```

### Loading

The file is loaded by:

- **Source file:** `profile.ts`

- **Main function:** `loadActiveProfileResources()`

- **Emitted event:** `geoleaf:profile:loaded`

---

## Full structure

Here is the full structure, with every available parameter:

```jsonc

{

  "id": "string",

  "label": "string",

  "description": "string",

  "version": "string",



  "map": {

    "bounds": [[number, number], [number, number]],

    "initialMaxZoom": number,

    "padding": [number, number],

    "positionFixed": boolean,

    "boundsMargin": number,

    "minZoom": number

  },



  "Files": {

    "themesFile": "string",

    "layersFile": "string",

    "basemapsFile": "string",

    "uiFile": "string",

    "featuresFile": "string",

    "modules": { "<moduleId>": "string" }

  },



  "ui": {

    "theme": "string",

    "language": "string",

    "showBaseLayerControls": boolean,

    "showLayerManager": boolean,

    "showCacheButton": boolean,

    "showCredentialButton": boolean,

    "showEditor": boolean,

    // Legacy aliases of modules.<plugin>.showButton (print, measure, geocoding),
    // read only when the module key is absent — prefer the module key.
    "showPrint": boolean,

    "showMeasure": boolean,

    "showGeocoding": boolean,

    "interactiveShapes": boolean

  },

  // One block per module — the core treats its contents as OPAQUE (INV-CONFIG):
  // the inner keys belong to the module. This is the form that replaced the
  // root keys `ui.show*`, `poiConfig`, `scaleConfig` and their siblings.
  "modules": {

    "<id>": { "enabled": boolean }

  },



  "basemaps": {

    "{basemap-id}": {

      "id": "string",

      "label": "string",

      "type": "string (\"raster\" | \"maplibre\")",

      "url": "string (tile URL template, also used as raster fallback for maplibre)",

      "style": "string (URL style JSON MapLibre)",

      "attribution": "string",

      "minZoom": number,

      "maxZoom": number,

      "defaultBasemap": boolean,

      "offline": boolean,

      "offlineBounds": {

        "north": number,

        "south": number,

        "east": number,

        "west": number

      },

      "cacheMinZoom": number,

      "cacheMaxZoom": number

    }

  },



  "layerManagerConfig": {

    "title": "string",

    "collapsedByDefault": boolean,

    "sections": [

      {

        "id": "string",

        "label": "string",

        "order": number,

        "collapsedByDefault": boolean

      }

    ]

  },



  // legendConfig migrated — see modules.legend (file config/plugins/legend.json)



  // tableConfig removed — see plugin @geoleaf-plugins/table (modules.table)



}

```

::: warning
This block illustrates the structure; it is not a reference. It shows neither every parameter nor their types. The reference is [`PROFILE_SCHEMA_REFERENCE.md`](https://github.com/geoleaf/geoleaf-js/blob/main/docs/reference/PROFILE_SCHEMA_REFERENCE.md), derived from the schemas.
:::

---

::: info
**What "required" means here.**

- `profile.schema.json` declares `required` at the root only, and only for **`id`**.
- `kernel/config/profile-loader.ts:555` (`_validateProfile`) is non-blocking: it only logs. A missing `id` produces a warning, never an exception. The only `throw` statements in the loader concern an unavailable `ConfigLoader`, never a profile field.
- Every read is guarded: `cfg.map ?? {}`, `if (themesFile)`, `if (files)`.
- `map.bounds` is `bounds` **or** `center`, and the code itself labels it "recommended".

`profiles/_reference/profile.json` carries no `Files.themesFile`, and it ships, validates and serves correctly.
:::

## Root parameters

### `id` (string, **required by the schema**)

**Description:** Unique identifier of the profile.

**Code usage:**

- Used to load the profile

- Referenced in events

- Stored in `config.data.activeProfile`

**Source files:**

- `profile.ts` line 141

**Possible values:** Alphanumeric string without spaces (e.g. `"tourism"`, `"my-custom-profile"`)

**Default:** None (required)

**Status:** Active and functional

---

### `label` (string, recommended — not required)

**Description:** Display name of the profile, used by the interface.

**Code usage:**

- Printed in the logs

- May be used by a profile selection interface

**Source files:**

- `profile.ts`

**Possible values:** Free text (e.g. `"Tourism profile"`, `"My Custom Profile"`)

**Default:** None

**Status:** Active and functional

---

### `description` (string, optional)

**Description:** Detailed description of the profile and its purpose.

**Code usage:**

- Used for documentation

- May be shown in a selection interface

**Source files:**

- Stored on the profile object, but rarely read directly by the code

**Possible values:** Free text

**Default:** Empty string

**Status:** Active (mainly documentation)

---

### `version` (string, optional)

**Description:** Profile version, following semantic versioning.

**Code usage:**

- Used for version detection (legacy vs 1.0.0)

- `isModularProfile()` function in ProfileLoader

**Source files:**

- `profile-loader.ts`

**Possible values:** `"X.Y.Z"` format (e.g. `"1.0.0"`, `"1.2.5"`)

**Default:** `"1.0.0"`

**Status:** Active and functional

---

## map section

### `map` (object, recommended — not required)

**Description:** Map initialisation settings: the element that hosts the map, the initial extent, and navigation restriction.

**Code usage:**

- Read by `packages/core/src/app/boot-modules/core-map-lifecycle.ts` while the map is initialised

- `bounds` feeds the initial `fitBounds()`, and serves as the `maxBounds` extent when `positionFixed` is enabled

#### `map.target` (string, optional)

Id of the HTML element that hosts the map, without `#`: it is resolved with `document.getElementById`, not as a CSS selector. Read by `GeoLeaf.boot()`; `GeoLeaf.mount()` hosts the map in the element it is given and does not read this key.

- **Default:** `"geoleaf-map"`

- **Alias:** `map.id`, read only when `target` is absent

#### `map.bounds` (array, recommended — `bounds` **or** `center`)

Initial geographic extent, in the form `[[south, west], [north, east]]`, in WGS84.

```jsonc

"bounds": [[-58.39, -73.58], [-21.78, -34.67]]

```

::: info
A theme may declare where it frames the map (`view`, in `themes.json` — see [`Files.themesFile`](#filesthemesfile-string-optional)). When the theme the profile starts on declares one, the map starts on that view instead of this extent. `bounds` keeps bounding the navigation when `positionFixed` is enabled.
:::

#### `map.initialMaxZoom` (integer, optional)

Ceiling on the zoom of the **initial framing**. When the map starts on an extent — `map.bounds`, or the `view.bounds` of the theme the profile starts on — it never frames closer than this zoom: a small extent is shown from further away instead of filling the screen at street level.

- **Default:** none — only a declared key caps. A profile that does not declare it frames its extent as closely as the extent asks

- **It does not cap the user's zoom** — `map.maxZoom` does — **nor a later theme switch**: a theme that must open at a given zoom declares `view.center` and `view.zoom` rather than `view.bounds`

- **Without effect** when the map starts on a centre and a zoom

- It is also the zoom the map is created at, a moment before the framing replaces it; absent, `map.maxZoom` is read for that, then `12`

- **Since 3.15.0.** Earlier versions read the key for the creation zoom only: it capped nothing

::: info
This parameter replaces neither the `maxZoom` of the base maps (which governs tile availability) nor `map.maxZoom`, the maximum zoom of the map itself.
:::

#### `map.padding` (array, optional)

Padding in pixels, `[horizontal, vertical]` — the first number is the left and right margin, the second the top and bottom one. Applied when the map is framed on `bounds` at start-up, and again each time a theme frames the map on the extent of its `view`. Keeps the extent off the container edges.

An object `{ top, right, bottom, left }` is accepted too: each edge it names is applied, and an edge it does not name is `0` — `{ "left": 320 }` keeps room for a side panel and none elsewhere. Since 3.16.3 the start-up and a theme view read it the same way; before, an object naming neither `top` nor `bottom` started the map with no padding at all.

- **Default:** `[50, 50]`

#### `map.positionFixed` (boolean, optional)

Restricts panning to the extent declared in `bounds`. The user cannot navigate far outside that area, but retains freedom of movement inside it.

- **Default:** `false`

- **Performance benefit:** MapLibre does not request tiles outside the extent → fewer network requests

- **Implementation:** the map is created with the engine's `maxBounds` option, with a margin configurable through `boundsMargin` (default 30%)

- **Behaviour:** a rubber-band effect at the edges, not a hard wall

#### `map.boundsMargin` (number, optional)

Additional margin around `bounds` when `positionFixed` is `true`. Controls how far the user may pan.

- **Default:** `0.3` (30% margin)

- **Range:** `0` (no margin, very restrictive) to `1` (100%, very permissive)

- **Ignored** when `positionFixed` is `false`

#### `map.minZoom` (integer, optional)

Minimum zoom of the map. Prevents the user from zooming out far enough to see the rest of the world. Applied whether `positionFixed` is on or off.

- **Default:** `3` when `positionFixed` is `true`; none otherwise

---

#### `map.maxPitch` (number, optional)

**Description:** Maximum camera pitch, in degrees. MapLibre GL JS caps it at 60° by default; this parameter lifts that restriction to allow steeper 3D views.

**Possible values:** `0`–`85` (beyond 80°, visual artefacts can appear with a 30 m resolution DEM)

**Default:** `80`

**Used with:** `basemaps.{id}.terrain` — the pitch declared in `terrain.pitch` must be less than or equal to `maxPitch`.

**Added in:** v2.1.0

**Status:** Active and functional

---

#### Full example

```jsonc

"map": {

  "bounds": [[-58.39, -73.58], [-21.78, -34.67]],

  "initialMaxZoom": 12,

  "padding": [50, 50],

  "positionFixed": true,

  "boundsMargin": 0.3,

  "minZoom": 3

}

```

---

## Files section

### `Files` (object, recommended — not required)

**Description:** Declares the paths to the configuration files attached to the profile.

**Code usage:**

- Loaded in parallel while a modular profile is initialised

- `profile-loader.ts`

**Status:** Active and functional (profiles 1.0.0+)

---

#### `Files.themesFile` (string, optional)

**Description:** Path to the themes file (layer visibility presets).

**A theme may also frame the map.** A theme entry takes an optional `view`, written like the `map` block: an extent to fit (`bounds`, `[[south, west], [north, east]]`), or a point with its zoom (`center` as `[lat, lng]`, and `zoom`).

```json
{
    "id": "north-sector",
    "label": "North sector",
    "type": "primary",
    "layers": [{ "id": "cities", "visible": true }],
    "view": {
        "bounds": [
            [43.2, 1.2],
            [43.6, 1.6]
        ]
    }
}
```

- **At start-up** the map opens on the view of the theme the profile starts on, when that theme declares one; otherwise on `map.bounds` (or `map.center` with `map.zoom`). A shared address that carries a view wins.
- **On a switch**, activating a theme that declares a view moves the camera there, without animation and before its layers load. A theme without `view` leaves the camera where it is — to bring the map back to the whole profile, give that theme a `view` holding the profile's `bounds`.
- Primary and secondary themes read the key alike. `bounds` wins when both forms are declared; a `center` without `zoom` is refused by the schema.
- The navigation limit (`map.positionFixed`) and the padding (`map.padding`) stay the profile's. A theme view reaching outside the limit is pulled back inside it, and named in the console at start-up.
- Themes read from a legacy root-level `themes.json`, fetched once the map exists, frame on activation only.

**Code usage:**

```javascript
// profile-loader.js line 68

const themesUrl = `${baseUrl}/${profile.Files.themesFile}?t=${timestamp}`;
```

**Source files:**

- `profile-loader.ts` line 68

**Possible values:** Relative path (layout v2: `"config/core/themes.json"`)

**Default:** none (the path is declared explicitly; layout v2: `"config/core/themes.json"`)

**Status:** Active and functional

---

#### `Files.layersFile` (string, optional)

**Description:** Path to the GeoJSON layer definition file.

**Code usage:**

```javascript
// profile-loader.js line 69

const layersUrl = `${baseUrl}/${profile.Files.layersFile}?t=${timestamp}`;
```

**Source files:**

- `profile-loader.ts` line 69

**Possible values:** Relative path (layout v2: `"config/core/layers.json"`)

**Default:** none (the path is declared explicitly; layout v2: `"config/core/layers.json"`)

**Status:** Active and functional

---

#### `Files.featuresFile` (string, optional)

**Description:** Path to the core features file. It holds `mapOptions` and nothing else — its
schema is closed. Its contents are merged into the root of the consolidated profile, like
`uiFile` and `basemapsFile`.

`mapOptions` is a closed list, not a pass-through to the engine. One key today:

- `mapOptions.preserveDrawingBuffer` (boolean, default `false`) — asks the engine to keep its
  drawing buffer, which is what lets the map canvas be read back (an export, a capture). It has
  a rendering cost, which is why it is off by default. When the print plugin is registered
  before the map is created, the buffer is kept without declaring anything.

**Possible values:** Relative path (layout v2: `"config/core/features.json"`)

**Status:** Active and functional (layout v2)

---

#### `Files.modules` (object, optional)

**Description:** A `{ moduleId: filePath }` dictionary — one configuration file
per plugin (Plugin Contract v1). Each file holds the matching `modules.<id>` block; its
contents belong to the plugin, and the core does not validate them (INV-CONFIG). The files are
loaded in parallel with the core sections; a `modules.<id>` block declared inline in
`profile.json` takes precedence over the file (deepMerge, arrays replaced).

**Example:**

```json
"modules": {
    "storage": "config/plugins/storage.json",
    "addpoi": "config/plugins/addpoi.json"
}
```

**Status:** Active and functional (layout v2)

---

## ui section

::: warning
**Deprecated in v2.0.0.** The inline `ui` section of `profile.json` is deprecated. Since v2.0.0, the UI configuration belongs in `ui.json` (referenced by `Files.uiFile`). Inline declarations are still accepted for backwards compatibility, but `ui.json` is the recommended form for any new project.
:::

### `ui` (object, optional)

**Description:** Configuration of the user interface and of the visible components.

**Status:** Active and functional

---

#### `ui.theme` (string, optional)

**Description:** Visual theme of the application.

**Code usage:**

```javascript
// geoleaf.core.ts line 132

const uiConfig = global.GeoLeaf.Config.get("ui") || {};

const theme = uiConfig.theme || "light";
```

**Source files:**

- `geoleaf.core.ts` line 132

- `theme.ts`

**Possible values:**

- `"light"` - Light theme

- `"dark"` - Dark theme

**Default:** `"light"`

**Status:** Active and functional

---

#### `ui.language` (string, optional)

**Description:** Language of the user interface.

**Code usage:**

- Stored in the configuration

- May influence labels and texts

**Source files:**

- No direct read detected in the current code

**Possible values:** ISO 639-1 codes (e.g. `"fr"`, `"en"`, `"es"`)

**Default:** `"fr"`

**Status:** Declared but rarely read directly (i18n groundwork)

---

#### `ui.showBaseLayerControls` (boolean, optional)

**Description:** Shows the base map selection controls.

**Code usage:**

```javascript
// geoleaf.baselayers.ts line 217

const showControls = config && config.ui && config.ui.showBaseLayerControls !== false;
```

**Source files:**

- `geoleaf.baselayers.ts` line 217

**Possible values:** `true` | `false`

**Default:** `false`

**Status:** Active and functional

**Tests:**

- \_\_tests\_\_/baselayers/baselayers.test.js line 307

---

#### `ui.showLayerManager` (boolean, optional)

**Description:** Shows the layer manager.

**Code usage:**

- Read to decide whether the LayerManager component is displayed

**Source files:**

- `geoleaf.layer-manager.ts`

**Possible values:** `true` | `false`

**Default:** `true`

**Status:** Active and functional

---

#### `ui.showFilterPanel` — **REMOVED** (dead key)

::: warning
Replaced by **`modules.filter.enabled`**. `ui.schema.json` is
`additionalProperties: false` and does not declare `ui.showFilterPanel`: copying the key back
makes `npm run validate:profiles` fail.
:::

#### `ui.showGeolocation` — **REMOVED** (dead key)

::: warning
Replaced by **`modules.geolocation.enabled`**. `ui.schema.json` is
`additionalProperties: false` and does not declare `ui.showGeolocation`: copying the key back
makes `npm run validate:profiles` fail.
:::

#### `ui.showScale` — **REMOVED** (dead key)

::: warning
Replaced by **`modules.scale.enabled`**. `ui.schema.json` is
`additionalProperties: false` and does not declare `ui.showScale`: copying the key back
makes `npm run validate:profiles` fail.
:::

#### `ui.showCoordinates` — **REMOVED** (dead key)

::: warning
Replaced by **`modules.coordinates.enabled`**. `ui.schema.json` is
`additionalProperties: false` and does not declare `ui.showCoordinates`: copying the key back
makes `npm run validate:profiles` fail.
:::

#### `ui.showThemeSelector` — **REMOVED** (dead key)

::: warning
Replaced by **`modules.theme-selector.enabled`**. `ui.schema.json` is
`additionalProperties: false` and does not declare `ui.showThemeSelector`: copying the key back
makes `npm run validate:profiles` fail.
:::

#### `ui.showLegend` — **REMOVED** (dead key)

::: warning
Replaced by **`modules.legend.enabled`**. `ui.schema.json` is
`additionalProperties: false` and does not declare `ui.showLegend`: copying the key back
makes `npm run validate:profiles` fail.
:::

#### `ui.showCacheButton` (boolean, optional)

**Description:** Shows the offline cache management button.

**Code usage:**

```javascript
// ui/cache-button.test.js line 154

const showCacheButton = cfg?.ui?.showCacheButton !== false;
```

**Source files:**

- `packages/plugins/offline-ui/src/ui/cache-button/button-control.ts` — the control lives in **`@geoleaf-plugins/offline-ui`**, not in the core.

**Possible values:** `true` | `false`

**Default:** `false`

**Status:** Active and functional

**Tests:**

- `packages/plugins/offline-ui/src/__tests__/cache-button.test.js` — `ButtonControl.init()` returns `null` when `showCacheButton` is `false`, and the real control otherwise.

---

#### `ui.showAddPoi` — **REMOVED** (dead key)

::: warning
Replaced by **`modules.editor.enabled`**. `ui.schema.json` is
`additionalProperties: false` and does not declare `ui.showAddPoi`: copying the key back
makes `npm run validate:profiles` fail.
:::

#### `ui.interactiveShapes` (boolean, optional)

**Description:** Makes geometric shapes (polygons, lines) interactive, hence clickable.

**Code usage:**

```javascript
// ui/filter-panel/proximity.js line 212

const interactiveShapes = GeoLeaf.Config.get("ui.interactiveShapes", false);
```

**Source files:**

- `proximity.ts` line 212

- `controls.ts` line 348

- `layer-config-manager.ts` line 115

- `geoleaf.route.ts` line 144

**Possible values:** `true` | `false`

**Default:** `false`

**Status:** Active and functional

---

## basemaps section

::: warning
**Migration to v2.0.0.** Declaring base maps inline in `profile.json` is still supported, but moving them to a dedicated `basemaps.json` file (referenced by `Files.basemapsFile`) is recommended, so they can be reused across profiles.
:::

### `basemaps` (object, required)

**Description:** Declaration of the available base maps.

**Structure:** An object whose keys are base map IDs and whose values are base map configurations.

**Code usage:**

```javascript
// geoleaf.baselayers.ts line 218

basemaps: global.GeoLeaf.Config.get("basemaps") || {};
```

**Source files:**

- `geoleaf.baselayers.ts`

- src/modules/storage/cache/resource-enumerator.js line 211

**Status:** Active and functional

---

#### `basemaps.{id}.id` (string, required)

**Description:** Unique identifier of the base map.

**Possible values:** Alphanumeric string (e.g. `"street"`, `"satellite"`, `"topo"`)

**Default:** None (required)

**Status:** Active and functional

---

#### `basemaps.{id}.label` (string, required)

**Description:** Display name of the base map in the interface.

**Possible values:** Free text (e.g. `"Street"`, `"Satellite"`, `"Topographic"`)

**Default:** None (required)

**Status:** Active and functional

---

#### `basemaps.{id}.url` (string, required)

**Description:** Tile URL template of the base map.

**Format:** Uses the `{s}`, `{z}`, `{x}`, `{y}` placeholders

**Example:**

```

https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png

```

**Possible values:** A valid URL with MapLibre placeholders (`{z}`, `{x}`, `{y}`)

**Default:** None (required)

**Status:** Active and functional

---

#### `basemaps.{id}.attribution` (string, required)

**Description:** Attribution/copyright text of the base map (HTML allowed). Since 3.16.3 it is cleaned before reaching the map's attribution control: inline formatting (`a`, `span`, `strong`, `em`, `b`, `i`, `br`) and links with a safe URL are kept — a link opens in a new tab —, any other markup becomes text.

**Example:**

```

&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors

```

**Possible values:** HTML string

**Default:** None (required)

**Status:** Active and functional

---

#### `basemaps.{id}.minZoom` (number, optional)

**Description:** Minimum zoom level for this base map.

**Code usage:**

```javascript
// geoleaf.baselayers.ts line 103

if (typeof definition.minZoom === "number") {
    opts.minZoom = definition.minZoom;
}
```

**Source files:**

- `geoleaf.baselayers.ts` lines 100-107

**Possible values:** Integer between 0 and 20 (usually 0-5 for base maps)

**Default:** 0

**Status:** Active and functional

---

#### `basemaps.{id}.maxZoom` (number, optional)

**Description:** Maximum zoom level for this base map.

**Code usage:**

```javascript
// geoleaf.baselayers.ts line 108

opts.maxZoom = typeof definition.maxZoom === "number" ? definition.maxZoom : 19;
```

**Source files:**

- `geoleaf.baselayers.ts` line 108

**Possible values:** Integer between 1 and 20 (usually 17-19 for OSM)

**Default:** `19`

**Status:** Active and functional

---

#### `basemaps.{id}.defaultBasemap` (boolean, optional)

**Description:** Whether this base map is selected by default on load.

**Code usage:**

- Read while the map is initialised, to select the default base map

**Source files:**

- `geoleaf.baselayers.ts`

**Possible values:** `true` | `false`

**Default:** `false`

**Status:** Active and functional

---

#### `basemaps.{id}.offline` (boolean, optional)

**Description:** Whether this base map is available offline (cached).

**Code usage:**

- Read by the cache subsystem to decide whether the tiles must be cached

**Source files:**

- src/modules/storage/cache/resource-enumerator.js

**Possible values:** `true` | `false`

**Default:** `false`

**Status:** Active and functional

---

#### `basemaps.{id}.offlineBounds` (object, optional)

**Description:** Geographic bounds of the offline cache for this base map.

**Structure:**

```jsonc

{

  "north": number,

  "south": number,

  "east": number,

  "west": number

}

```

**Requires:** `offline: true`

**Example:**

```json
{
    "north": -22.0,

    "south": -56.0,

    "east": -53.5,

    "west": -73.5
}
```

**Possible values:** WGS84 coordinates (latitude/longitude in decimal degrees)

**Default:** None

**Status:** Active and functional

---

#### `basemaps.{id}.cacheMinZoom` (number, optional)

**Description:** Minimum zoom level of the offline cache.

**Requires:** `offline: true`

**Possible values:** Integer between 0 and `cacheMaxZoom`

**Default:** `4`

**Status:** Active and functional

---

#### `basemaps.{id}.cacheMaxZoom` (number, optional)

**Description:** Maximum zoom level of the offline cache.

**Requires:** `offline: true`

**Possible values:** Integer between `cacheMinZoom` and 20

**Default:** `12`

**Status:** Active and functional

---

#### `basemaps.{id}.type` (string, optional)

**Description:** Base map type. Distinguishes classic raster base maps from MapLibre GL vector base maps.

**Possible values:**

- `"tile"` — Classic raster base map, served through a MapLibre GL JS source of type `"raster"` (implicit default)

- `"maplibre"` — WebGL vector base map, served through a MapLibre GL JS style (style JSON file)

**Default:** `"tile"` (implicit when absent)

**Behaviour:** With `type: "maplibre"` (or as soon as `style` is present), the Baselayers module creates a MapLibre GL vector source. If the style fails to load, it falls back to the raster source.

**Added in:** v2.0.0

**Status:** Active and functional

---

#### `basemaps.{id}.style` (string, required when type is "maplibre")

**Description:** URL of the MapLibre GL style JSON (or an inline style object). It declares the vector tile sources and the render layers.

**Requires:** `type: "maplibre"` (implicit when `style` is provided)

**Example:**

```

https://tiles.openfreemap.org/styles/liberty

```

**Free providers:**

- OpenFreeMap: `https://tiles.openfreemap.org/styles/liberty` (entirely free)

- OpenFreeMap Dark: `https://tiles.openfreemap.org/styles/dark`

- MapTiler (freemium): `https://api.maptiler.com/maps/streets-v2/style.json?key=KEY`

**Default:** None (required for MapLibre base maps)

**Added in:** v2.0.0

**Status:** Active and functional

---

#### `basemaps.{id}.fallbackUrl` (string, optional)

**Description:** Raster tile URL used as a fallback when the MapLibre style is unavailable.

**Requires:** `type: "maplibre"` (ignored for raster base maps)

**Example:**

```

https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png

```

**Behaviour:** If MapLibre GL JS is not loaded (missing CDN, network error), the base map falls back to this raster URL. Without `fallbackUrl`, the fallback is the default `street` base map (OSM).

**Default:** the URL of the default `street` base map

**Added in:** v2.0.0

**Status:** Active and functional

---

#### `basemaps.{id}.terrain` (object, optional)

**Description:** 3D terrain configuration for this base map. When present with `enabled: true`, GeoLeaf loads a DEM (Digital Elevation Model) source and switches on MapLibre GL JS relief rendering. Read whatever the type of the base map — tiles, vector style, WMS, WMTS or image.

**Requires:** `terrain.enabled: true` and a valid `terrain.demUrl`

What puts the terrain ON is chosen by `activation`, and the two ways do not combine:

- **the selection of the base map** (the default) — when `default3D` is true, the terrain is put on as the base map is selected, the camera is posted to `pitch` and `bearing`, and it is eased back flat when the base map is left;
- **the tilt of the camera** (`activation: "pitch"`) — the terrain is absent while the map is flat, put on once the camera comes to rest tilted, and removed once it comes to rest flat again. The camera is never moved.

**Example — a base map that opens in 3D:**

```json
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
```

**Example — a base map that opens flat, and gets its relief when tilted:**

```json
"terrain": {
  "enabled": true,
  "demUrl": "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  "demEncoding": "terrarium",
  "exaggeration": 1.5,
  "activation": "pitch"
}
```

**Added in:** v2.1.0

**Status:** Active and functional

---

#### `basemaps.{id}.terrain.enabled` (boolean, required in a `terrain` block)

**Description:** Enables 3D terrain for this base map. The schema refuses a `terrain` block that does not declare it; a base map with no `terrain` block has no terrain.

**Possible values:** `true` | `false`

**Default:** None (required)

**Status:** Active and functional

---

#### `basemaps.{id}.terrain.demUrl` (string, required when terrain is enabled)

**Description:** URL of the DEM (Digital Elevation Model) tile service. Uses the `{z}`, `{x}`, `{y}` placeholders.

**Sources validated in production:**

- **AWS Terrarium** (free, worldwide, ~30 m resolution):
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`

**Default:** None (required when `terrain.enabled: true`)

**Status:** Active and functional

---

#### `basemaps.{id}.terrain.demEncoding` (string, optional)

**Description:** Encoding of the elevation values inside the DEM tiles.

**Possible values:**

- `"terrarium"` — Mapzen Terrarium format: `elevation = (R * 256 + G + B / 256) - 32768`
- `"mapbox"` — Mapbox Terrain-RGB format

**Default:** `"terrarium"`

**Status:** Active and functional

---

#### `basemaps.{id}.terrain.demMaxZoom` (number, optional)

**Description:** Highest zoom level available in the DEM tiles. Above it, MapLibre reuses the highest available level.

**Possible values:** Any number — the schema sets no bound. Give the highest zoom level the DEM service actually serves.

**Default:** `15`

**Status:** Active and functional

---

#### `basemaps.{id}.terrain.exaggeration` (number, optional)

**Description:** Vertical exaggeration factor of the relief. `1.0` renders true elevation; higher values accentuate the relief visually.

**Possible values:** `0.1`–`10` (recommended range: `1.0`–`3.0`)

**Default:** `1.5`

**Status:** Active and functional

---

#### `basemaps.{id}.terrain.activation` (string, optional)

**Description:** What puts the terrain on.

- `"basemap"` — the selection of the base map does, when `default3D` is true. The camera is posted to `pitch` and `bearing`, and eased back flat when the base map is left.
- `"pitch"` — the terrain follows the tilt of the camera. While the map is flat there is no terrain, and **no elevation tile is requested**: the elevation source is only declared the first time the terrain is put on. The terrain is put on once the camera comes to rest tilted to `activateFromPitch` or more, and removed once it comes to rest under `deactivateBelowPitch`; between the two it stays as it was.

With `"pitch"`, the decision is taken when a movement **ends** — a gesture released, an animation finished —, never during it: the relief comes a moment after the tilt. Whatever tilts the camera counts, a guidance that follows a route included. The camera itself is never moved, neither when the terrain comes nor when the base map is left.

The keys that describe the other way are **refused by the schema**, not ignored: `pitch`, `bearing` and `default3D: true` with `"pitch"`; the two thresholds without it. At runtime they are named in the log when the base map is registered, and not read.

**Possible values:** `"basemap"` | `"pitch"`

**Default:** `"basemap"`

**Status:** Active and functional (since v3.15.0)

---

#### `basemaps.{id}.terrain.activateFromPitch` (number, optional)

**Description:** With `activation: "pitch"` only. Tilt, in degrees, from which the terrain is put on when the camera comes to rest. Keep it at or under `map.maxPitch`: above it the terrain can never show, and a warning says so. A value that cannot be honoured is reported at start-up and replaced by the default.

**Possible values:** Above `0`, at most `85`

**Default:** `12`

**Status:** Active and functional (since v3.15.0)

---

#### `basemaps.{id}.terrain.deactivateBelowPitch` (number, optional)

**Description:** With `activation: "pitch"` only. Tilt, in degrees, under which the terrain is removed when the camera comes to rest. It must be lower than `activateFromPitch`: with one threshold for both, a camera that stops around it would put the terrain on and off at every movement. The schema cannot express that rule — a value that breaks it is reported at start-up and replaced by the default.

**Possible values:** `0`–`85`, lower than `activateFromPitch`

**Default:** Half of `activateFromPitch` — `6` with the default threshold

**Status:** Active and functional (since v3.15.0)

---

#### `basemaps.{id}.terrain.default3D` (boolean, optional)

**Description:** Turns 3D terrain on as soon as this base map is selected. No UI toggle is required: terrain is enabled when switching to this base map, and disabled when switching to a base map without terrain. Without it — and without `activation: "pitch"`, the only other thing that puts a terrain on — an enabled terrain is never drawn. Not read with `activation: "pitch"`, where `true` is refused by the schema.

**Possible values:** `true` | `false`

**Default:** `false`

**Status:** Active and functional

---

#### `basemaps.{id}.terrain.pitch` (number, optional)

**Description:** Camera pitch (in degrees) posted when the terrain is put on by the selection of the base map, that is when `default3D: true`. Refused by the schema with `activation: "pitch"`, which never moves the camera.

**Possible values:** `0`–`85` (must be ≤ `map.maxPitch`)

**Default:** `45`

**Status:** Active and functional

---

#### `basemaps.{id}.terrain.bearing` (number, optional)

**Description:** View rotation (in degrees, clockwise from north) posted when the terrain is put on by the selection of the base map. Refused by the schema with `activation: "pitch"`, which never moves the camera.

**Possible values:** `-180`–`180`

**Default:** `0` (north up)

**Status:** Active and functional

---

#### `basemaps.{id}.imageSource` (object, optional)

**Description:** Configuration of a static georeferenced image. Required when `type: "image"`.

**Example:**

```json
{
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
```

**Status:** Active and functional (since v2.1.0)

---

#### `basemaps.{id}.imageSource.url` (string, required when type="image")

**Description:** URL of the image to display. Must be HTTP, HTTPS or a data URI.

**Possible values:** A valid URL (`http://`, `https://`, `data:`)

**Default:** None

**Status:** Active and functional

---

#### `basemaps.{id}.imageSource.coordinates` (array, optional)

**Description:** Positions of the four image corners as `[lng, lat]`, in this order: north-west, north-east, south-east, south-west.

**Possible values:** An array of four `[lng, lat]` pairs (WGS84)

**Default:** world bounds `[[-180, 85.051129], [180, 85.051129], [180, -85.051129], [-180, -85.051129]]`

**Status:** Active and functional

---

#### `basemaps.{id}.imageSource.opacity` (number, optional)

**Description:** Opacity of the image.

**Possible values:** `0.0` (transparent) to `1.0` (opaque)

**Default:** `1`

**Status:** Active and functional

---

#### `basemaps.{id}.hillshade` (object, optional)

**Description:** Relief shading (hillshade), drawn from a raster-dem elevation source. The block is read in two ways:

- on a basemap of `type: "hillshade"` the shading **is** the basemap, and the block is required;
- on a basemap of any other type it is read only when `overlay` is `true`, and is then drawn **over** that basemap, which stays what it is. Without `overlay`, the block is ignored there.

**Example — the shading as the basemap:**

```json
{
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
```

> **Note:** on `type: "hillshade"`, if a `terrain-dem` DEM source (3D terrain) is already present with the same `demUrl`, GeoLeaf reuses it instead of creating a second one. An overlay never does — see `overlay`.

**Example — the shading as an overlay of a vector basemap that also has 3D terrain:**

```json
{
    "basemaps": {
        "plan-relief": {
            "id": "plan-relief",
            "label": "Plan with relief",
            "type": "maplibre",
            "style": "https://tiles.openfreemap.org/styles/liberty",
            "attribution": "© OpenFreeMap © OpenMapTiles © OpenStreetMap",
            "terrain": {
                "enabled": true,
                "demUrl": "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
                "demEncoding": "terrarium",
                "default3D": true,
                "pitch": 60
            },
            "hillshade": {
                "overlay": true,
                "beforeLayer": "waterway_tunnel",
                "demUrl": "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
                "demEncoding": "terrarium",
                "exaggeration": 0.45,
                "shadowColor": "#4a3f35",
                "highlightColor": "#ffffff",
                "accentColor": "#6b5d4f"
            }
        }
    }
}
```

**Status:** Active and functional (since v2.1.0; as an overlay since v3.15.0)

---

#### `basemaps.{id}.hillshade.overlay` (boolean, optional)

**Description:** Draws the shading as an overlay of this basemap instead of leaving the block unread. An image basemap (tiles, WMS, WMTS, georeferenced image) gets it right above its own layer, under every data layer; a vector basemap gets it inside its style — see `beforeLayer`. Ignored on `type: "hillshade"`, whose shading is the basemap itself.

The overlay follows the basemap: it is put back after every style change, and removed when the active basemap declares none. It reads a raster-dem source of its own, apart from the one of `terrain`: with both on one basemap the same `demUrl` is requested twice, for a shading one zoom level finer than a shared source would give.

**Possible values:** `true` | `false`

**Default:** `false`

**Status:** Active and functional (since v3.15.0)

---

#### `basemaps.{id}.hillshade.onlyWithTerrain` (boolean, optional)

**Description:** Overlay only. The shading is shown only while a 3D terrain is on the map, and hidden the rest of the time. Hidden, it requests no elevation tile.

It is what makes a base map with a relief that follows the tilt (`terrain.activation: "pitch"`) leave a flat map exactly as it is: no terrain, no shading, no elevation tile — and both once the map is tilted. With a terrain put on by the selection of its base map, the overlay shows as long as that base map is active.

On a base map without an enabled `terrain` the overlay never shows, and a warning says so at start-up. Without this key the overlay is always drawn, flat map included. Ignored without `overlay`.

**Possible values:** `true` | `false`

**Default:** `false`

**Status:** Active and functional (since v3.15.0)

---

#### `basemaps.{id}.hillshade.beforeLayer` (string, optional)

**Description:** Vector basemap only. Id of the layer of the basemap's style the overlay is inserted before. Name the first layer that must stay above the shading — typically the first water or road layer — so that the shading covers the land fills and stays under water, roads and labels. In OpenFreeMap's "liberty" style that layer is `waterway_tunnel`.

Absent, or naming a layer the style does not have (a warning is then logged), the overlay goes before the first `symbol` layer of the style. That keeps the labels readable, but shades whatever the style draws under them, water and roads included. Not read on an image basemap.

**Possible values:** The id of a layer of the basemap's style

**Default:** None — the overlay goes before the first `symbol` layer of the style

**Status:** Active and functional (since v3.15.0)

---

#### `basemaps.{id}.hillshade.demUrl` (string, required when type="hillshade" or when `overlay` is true)

**Description:** URL template of the raster-dem Digital Elevation Model.

**Possible values:** URL template containing `{z}/{x}/{y}`

**Default:** None

**Status:** Active and functional

---

#### `basemaps.{id}.hillshade.demEncoding` (string, optional)

**Description:** Encoding of the elevation inside the DEM image.

**Possible values:** `"terrarium"` | `"mapbox"`

**Default:** `"terrarium"`

**Status:** Active and functional

---

#### `basemaps.{id}.hillshade.demMaxZoom` (number, optional)

**Description:** Maximum zoom level of the DEM source.

**Possible values:** Any number — the schema sets no bound

**Default:** `15`

**Status:** Active and functional

---

#### `basemaps.{id}.hillshade.shadowColor` (string, optional)

**Description:** Colour of the shaded areas.

**Possible values:** CSS hexadecimal colour or colour name

**Default:** `"#000000"`

**Status:** Active and functional

---

#### `basemaps.{id}.hillshade.highlightColor` (string, optional)

**Description:** Colour of the lit areas.

**Possible values:** CSS hexadecimal colour or colour name

**Default:** `"#ffffff"`

**Status:** Active and functional

---

#### `basemaps.{id}.hillshade.accentColor` (string, optional)

**Description:** Accent colour (edges and outlines).

**Possible values:** CSS hexadecimal colour or colour name

**Default:** `"#000000"`

**Status:** Active and functional

---

#### `basemaps.{id}.hillshade.exaggeration` (number, optional)

**Description:** Intensity of the shaded relief.

**Possible values:** `0.0` (flat) to `1.0` (maximum)

**Default:** `0.5`

**Status:** Active and functional

---

#### `basemaps.{id}.hillshade.illuminationDirection` (number, optional)

**Description:** Direction of the light source, in degrees.

**Possible values:** `0`–`359`

**Default:** `335`

**Status:** Active and functional

---

#### `basemaps.{id}.hillshade.illuminationAnchor` (string, optional)

**Description:** Frame of reference for the light direction.

**Possible values:** `"viewport"` (follows the map rotation) | `"map"` (locked to geographic north)

**Default:** `"viewport"`

**Status:** Active and functional

---

#### `basemaps.{id}.wmts` (object, optional)

**Description:** Configuration of an OGC WMTS service with dynamic resolution. Required when `type: "wmts"`.

**Example:**

```json
{
    "wmts": {
        "getCapabilitiesUrl": "https://wxs.ign.fr/essentiels/geoportail/wmts?SERVICE=WMTS&REQUEST=GetCapabilities",
        "layer": "ORTHOIMAGERY.ORTHOPHOTOS",
        "tileMatrixSet": "PM",
        "format": "image/jpeg"
    }
}
```

> **Note:** GeoLeaf fetches the `GetCapabilities` document the first time the base map is displayed, extracts the tile URL template and caches it for later switches. If the request fails, the base map is not displayed and a warning is logged to the console.

**Status:** Active and functional (since v2.1.0)

---

#### `basemaps.{id}.wmts.getCapabilitiesUrl` (string, required when type="wmts")

**Description:** Full URL of the OGC WMTS GetCapabilities document.

**Possible values:** A valid URL (`http://`, `https://`)

**Default:** None

**Status:** Active and functional

---

#### `basemaps.{id}.wmts.layer` (string, optional)

**Description:** Identifier of the WMTS layer to use.

**Possible values:** A string matching the `Identifier` of a layer in the GetCapabilities document

**Default:** The first layer available in the GetCapabilities document

**Status:** Active and functional

---

#### `basemaps.{id}.wmts.tileMatrixSet` (string, optional)

**Description:** TileMatrixSet used for the tiles.

**Possible values:** An identifier declared in the GetCapabilities document (e.g. `"PM"`, `"GoogleMapsCompatible"`, `"EPSG:3857"`)

**Default:** `"GoogleMapsCompatible"`

**Status:** Active and functional

---

#### `basemaps.{id}.wmts.format` (string, optional)

**Description:** MIME type of the WMTS tiles.

**Possible values:** `"image/png"` | `"image/jpeg"` | `"image/webp"`

**Default:** `"image/png"`

**Status:** Active and functional

---

#### `basemaps.{id}.wms` (object, optional)

**Description:** Configuration of an OGC WMS service (raster stream). Required when `type: "wms"`.

**Example:**

```json
{
    "wms": {
        "url": "https://wxs.ign.fr/essentiels/geoportail/r/wms",
        "layers": "ORTHOIMAGERY.ORTHOPHOTOS",
        "version": "1.3.0",
        "crs": "EPSG:3857",
        "format": "image/jpeg",
        "tileSize": 256
    }
}
```

**Status:** Active and functional (since v2.1.0)

---

#### `basemaps.{id}.wms.url` (string, required when type="wms")

**Description:** Base URL of the WMS server (without query parameters).

**Possible values:** A valid URL (`http://`, `https://`)

**Default:** None

**Status:** Active and functional

---

#### `basemaps.{id}.wms.layers` (string, required when type="wms")

**Description:** WMS layer name(s), comma-separated.

**Example:** `"ORTHOIMAGERY.ORTHOPHOTOS"` or `"layer1,layer2"`

**Default:** None

**Status:** Active and functional

---

#### `basemaps.{id}.wms.version` (string, optional)

**Description:** Version of the WMS protocol.

**Possible values:** `"1.1.1"` | `"1.3.0"`

**Default:** `"1.3.0"`

**Status:** Active and functional

---

#### `basemaps.{id}.wms.crs` (string, optional)

**Description:** Coordinate reference system used for the WMS requests.

**Possible values:** EPSG identifier (e.g. `"EPSG:3857"`, `"EPSG:4326"`)

**Default:** `"EPSG:3857"`

**Status:** Active and functional

---

#### `basemaps.{id}.wms.format` (string, optional)

**Description:** MIME type of the WMS images.

**Possible values:** `"image/png"` | `"image/jpeg"` | `"image/webp"`

**Default:** `"image/png"`

**Status:** Active and functional

---

#### `basemaps.{id}.wms.tileSize` (number, optional)

**Description:** Size, in pixels, of the tiles requested from the WMS.

**Possible values:** `256` | `512`

**Default:** `256`

**Status:** Active and functional

---

#### `basemaps.{id}.wms.transparent` (boolean, optional)

**Description:** Requests WMS images with a transparent background (PNG only).

**Possible values:** `true` | `false`

**Default:** `false`

**Status:** Active and functional

---

#### `basemaps.{id}.wms.styles` (string, optional)

**Description:** WMS style to apply (the `STYLES` parameter of the WMS request).

**Possible values:** A style identifier known to the server, or an empty string

**Default:** `""` (the server's default style)

**Status:** Active and functional

---

## performance section — one key

```json
{
    "performance": {
        "themeBatchSize": 6
    }
}
```

`performance.themeBatchSize` is how many layers of a theme are revealed at a time when a theme
is applied — an integer of at least 1, `6` when absent. A lower value spreads the layers out;
a higher one brings them in together. It is declared in `profile.json`.

::: warning
**Three other keys were documented here, and none of them does anything.**

`layerLoadDelay`, `maxConcurrentLayers` and `fitBoundsOnThemeChange` have no reader in
`packages/*/src`; the setting they described disappeared together with the loader it drove.
The block is closed, so a profile that still declares one of them fails `validate:profiles`.

Up-to-date reference, derived from the schemas: [`PROFILE_SCHEMA_REFERENCE.md`](https://github.com/geoleaf/geoleaf-js/blob/main/docs/reference/PROFILE_SCHEMA_REFERENCE.md).
:::

---

## search section — **REMOVED** (dead key)

::: warning
**`search` no longer exists. The live form is the `filter` capability (`modules.filter`).**

The full-text engine (`flexsearch`) was removed from the core — dormant, with no consumer — along with its dependency. The nine keys declared here (`title`, `filters`, `actions`, `radiusMin/Max/Default/Step`, `searchPlaceholder`) are no longer read anywhere. Text search in the interface is provided by the text field of the Filter panel, which ignores accents and word order.

Up-to-date reference, derived from the schemas: [`PROFILE_SCHEMA_REFERENCE.md`](https://github.com/geoleaf/geoleaf-js/blob/main/docs/reference/PROFILE_SCHEMA_REFERENCE.md).
:::

---

## layerManagerConfig section

> **Note for v2.0.0:** these parameters now belong in `ui.json`. They are still accepted inline in `profile.json` for backwards compatibility.

### `layerManagerConfig` (object, optional)

**Description:** Configuration of the layer manager.

**Code usage:**

```javascript
// geoleaf.layer-manager.ts line 149

const layerManagerConfig = GeoLeaf.Config.get("layerManagerConfig");
```

**Source files:**

- `geoleaf.layer-manager.ts` line 149

**Status:** Active and functional

---

#### `layerManagerConfig.title` (string, optional)

**Description:** Title of the layer manager. It also names the layers sheet on mobile and the
layers tab of the desktop side panel (≥ 1440 px). A title set here is in one language and fixes
all three.

**Possible values:** Free text

**Default:** translated labels that follow `ui.language` — `ui.layer_manager.title` on the panel
header (« Gestionnaire de couches » in French), `sheet.title.layers` on the sheet and the tab
(« Couches »).

**Status:** Active and functional

---

#### `layerManagerConfig.collapsedByDefault` (boolean, optional)

**Description:** Initial collapsed state of the layer manager.

**Code usage:**

```javascript
// geoleaf.layer-manager.ts line 152

collapsed: layerManagerConfig?.collapsedByDefault;
```

**Source files:**

- `geoleaf.layer-manager.ts` line 152

- `control.ts` line 111

**Possible values:** `true` | `false`

**Default:** `true`

**Status:** Active and functional

---

#### `layerManagerConfig.sections` (array, optional)

**Description:** List of the sections of the layer manager.

**Structure of each section:**

```jsonc

{

  "id": "string",

  "label": "string",

  "order": number,

  "collapsedByDefault": boolean

}

```

**Code usage:**

```javascript
// geoleaf.layer-manager.ts line 173

collapsedByDefault: s.collapsedByDefault;
```

**Source files:**

- `geoleaf.layer-manager.ts` lines 162-176

- `renderer.ts` lines 61-62

**Status:** Active and functional

---

## modules.legend section

::: warning
**Breaking migration (`legend` capability).** The legend no longer lives under the `ui.showLegend` flag nor under the root `legendConfig` block, but under **`modules.legend`** — file `config/plugins/legend.json`, referenced by `Files.modules.legend`. The legend remains **built into the core**; it is not an external plugin. It is registered with the `CapabilityRegistry` and can be introspected through `GeoLeaf.Introspection.getCapabilitySchema("legend")`. The public `GeoLeaf.Legend` facade is **unchanged**.
:::

::: info
**Configuration now honoured.** `title`, `position` and `collapsedByDefault` used to be dead: they were ignored, overwritten by the control's internal defaults. Under `modules.legend` they are read and applied, so a profile carrying these keys (former `legendConfig`) gets the configured title, position and collapsed state.
:::

> **Event:** on the first mount of the control, the legend emits `geoleaf:legend:ready` once (payload `{ position, layerCount }`).

### `modules.legend` (object, optional)

**Description:** Configuration of the map legend capability.

**Code usage:**

```javascript
// capabilities/legend/config.ts

const raw = Config.get("modules.legend", {});
```

**Source files:**

- `capabilities/legend/config.ts`

- `capabilities/legend/legend-capability.ts`

**Status:** Active and functional

---

#### `modules.legend.enabled` (boolean, optional)

**Description:** Enables or disables the legend (capability gate, **opt-out** — former `ui.showLegend`). Absent means enabled.

**Possible values:** `true` | `false`

**Default:** `true`

**Status:** Active and functional

---

#### `modules.legend.title` (string, optional)

**Description:** Title of the legend (former `legendConfig.title`). It also names the legend
sheet on mobile and the legend tab of the desktop side panel (≥ 1440 px). A title set here is in
one language and fixes all three.

**Possible values:** Free text

**Default:** translated labels that follow `ui.language` — `ui.legend.title` on the panel header,
`sheet.title.legend` on the sheet and the tab (« Légende » in French for both).

**Status:** Active and functional

---

#### `modules.legend.collapsedByDefault` (boolean, optional)

**Description:** Initial collapsed state of the legend (former `legendConfig.collapsedByDefault`).

**Possible values:** `true` | `false`

**Default:** `false`

**Status:** Active and functional

---

#### `modules.legend.position` (string, optional)

**Description:** Position of the legend on the map (former `legendConfig.position`).

**Possible values:**

- `"topleft"`

- `"topright"`

- `"bottomleft"`

- `"bottomright"`

**Default:** `"bottomleft"`

**Status:** Active and functional

---

## poiConfig section — **REMOVED** (dead key)

::: warning
**`poiConfig` no longer exists. The live form is `modules.cluster`.**

The only two occurrences of `poiConfig` left in the sources are past-tense comments in `capabilities/cluster/types.ts` (_"was `poiConfig.clusterStrategy`"_). The clustering keys (`clustering`, `clusterRadius`, `disableClusteringAtZoom`, `clusterStrategy`) live under `modules.cluster`. `applyToAllSources` has **no equivalent at all**: zero occurrences.

Up-to-date reference, derived from the schemas: [`PROFILE_SCHEMA_REFERENCE.md`](https://github.com/geoleaf/geoleaf-js/blob/main/docs/reference/PROFILE_SCHEMA_REFERENCE.md).
:::

---

## brandingConfig section — **REMOVED** (dead key)

::: warning
**`brandingConfig` no longer exists. The live form is `modules.branding`.**

No reader in `packages/*/src`, no schema. The real gate is `modules.branding.enabled` (`capabilities/branding/`).

Up-to-date reference, derived from the schemas: [`PROFILE_SCHEMA_REFERENCE.md`](https://github.com/geoleaf/geoleaf-js/blob/main/docs/reference/PROFILE_SCHEMA_REFERENCE.md).
:::

---

## tableConfig section — moved out of the core

::: info
The data table was moved out of the core into the MIT plugin `@geoleaf-plugins/table`. See the plugin README for installation, configuration (`modules.table.*`) and migration.
:::

---

## scaleConfig section — **REMOVED** (dead key)

::: warning
**`scaleConfig` (at ROOT level) no longer exists. The live form is `modules.scale`.**

Do not confuse the two `scaleConfig` objects: a LAYER-level one (`{minScale, maxScale}`, `kernel/geojson/core-types.ts`) is very much alive and is not this one. The five keys declared here (`position`, `scaleGraphic`, `scaleNumeric`, `scaleNumericEditable`, `scaleNivel`) are exactly the keys of the `configSchema` of the scale capability (`scale-capability.ts:42-57`), whose gate is `modules.scale.enabled`.

Up-to-date reference, derived from the schemas: [`PROFILE_SCHEMA_REFERENCE.md`](https://github.com/geoleaf/geoleaf-js/blob/main/docs/reference/PROFILE_SCHEMA_REFERENCE.md).
:::

---

## storage section — **REMOVED** (dead key)

::: warning
**`storage` (at ROOT level) no longer exists. The live form is `modules.offline`.**

The capability was renamed `storage` → `offline`. Its gate is `modules.offline.enabled` (`offline-capability.ts:41`, opt-in). `enableOfflineDetector` still exists, but as an INTERNAL lifecycle option fed by `cfg.offlineDetectorEnabled` (`capabilities/offline/lifecycle.ts:128`), not as a root profile key.

Up-to-date reference, derived from the schemas: [`PROFILE_SCHEMA_REFERENCE.md`](https://github.com/geoleaf/geoleaf-js/blob/main/docs/reference/PROFILE_SCHEMA_REFERENCE.md).
:::

---

## poiAddConfig section — **REMOVED** (dead key)

::: warning
**`poiAddConfig` no longer exists. The live form is `modules.editor` (`@geoleaf-plugins/editor`).**

No reader, no schema. The `addpoi` plugin was merged into `editor`; `config.ts:48` of the plugin records that `defaultPosition` was _"absorbed from `modules.addpoi.defaultPosition`, which the CORE used to read"_. The live block is `modules.editor`, which **is** declared in the schema.

Up-to-date reference, derived from the schemas: [`PROFILE_SCHEMA_REFERENCE.md`](https://github.com/geoleaf/geoleaf-js/blob/main/docs/reference/PROFILE_SCHEMA_REFERENCE.md).
:::

---

## geocodingConfig section — **REMOVED** (dead key)

::: warning
**`geocodingConfig` no longer exists. The live form is `modules.geocoding` (`@geoleaf-plugins/geocoding`).**

No reader, no schema. The plugin reads `coreConfigGet("modules.geocoding", {})` (`geocoding/src/config.ts:21`), as required by INV-CONFIG of Plugin Contract v1.

Up-to-date reference, derived from the schemas: [`PROFILE_SCHEMA_REFERENCE.md`](https://github.com/geoleaf/geoleaf-js/blob/main/docs/reference/PROFILE_SCHEMA_REFERENCE.md).
:::

---

## Parameters missing from profile.json

This section describes how the GeoLeaf configuration files are organised, so that they are not confused with one another.

### Configuration file hierarchy

```
profiles/{profile-name}/                      (layout v2)
├── profile.json                              ← Identity + map + Files manifest (THIS FILE)
├── config/
│   ├── core/
│   │   ├── taxonomy.json                     ← Categories, tags, metadata
│   │   ├── themes.json                       ← Layer visibility presets
│   │   ├── layers.json                       ← GeoJSON layer definitions
│   │   ├── basemaps.json                     ← Base maps
│   │   ├── ui.json                           ← UI controls, search, scale
│   │   └── features.json                     ← Clustering, geocoding, performance, POI
│   └── plugins/
│       └── {module-id}.json                  ← Per-plugin config (modules.<id> block)
└── [layers/, icons/, data/]

geoleaf.config.json                           ← Global application configuration (ROOT)
```

### Responsibilities of each file

#### **profile.json** (this file)

- **UI** configuration: component visibility, themes, languages

- **Performance** configuration: loading limits, delays

- **Base map** configuration: available base maps

- **Component** configuration: tables, legend, layer manager

- **Filter/search** configuration: search and filtering parameters

- **References** to taxonomy/themes/layers (through `Files`)

- `defaultSettings.routeConfig`: routing configuration (deprecated)

#### **taxonomy.json**

- Categories and hierarchy

- **Icon metadata** (sprites, formats)

- Tags and classifications

- Non-spatial layer properties

#### **themes.json**

- Visibility presets (layer groups)

- Map themes

- Alternative style configurations (per theme)

- The view each theme frames the map on (`view`)

#### **layers.json**

- GeoJSON layer definitions

- **Metadata of each layer**: styles, icons, attributes

- Per-layer configuration

- Paths to the data files

### Where each parameter lives

| Parameter | File | Usage |

| ----------------------------- | ----------------- | -------------------------------------------- |

| `icons` | **taxonomy.json** | Sprite/icon metadata |

| `stylesConfig` | **profile.json** | Global configuration of alternative styles |

| `Directory` | **layers.json** | Path templates (declared per layer) |

| `defaultSettings.routeConfig` | **profile.json** | Routing configuration (deprecated) |

| `ui.*` | **profile.json** | UI configuration |

| `basemaps` | **profile.json** | Base maps |

| All the others | **profile.json** | See the structure section |

### Validation

- profile.json holds **only** the parameters documented in this file

- Every parameter has a clear purpose, verified against the source code

- No phantom or unused parameter

- A consistent, maintainable architecture

## Summary table — **REMOVED**

::: info
A hand-written table of every parameter duplicates the schemas.

The equivalent generated table is [`PROFILE_SCHEMA_REFERENCE.md`](https://github.com/geoleaf/geoleaf-js/blob/main/docs/reference/PROFILE_SCHEMA_REFERENCE.md).
:::

---

## Final notes

### Points of attention

1. **Section naming**: the `Files` section uses names suffixed with "File" (`themesFile`, `layersFile`), which is consistent.

2. **Backwards compatibility**: the code still supports the older `profile.panels.search` structure, but the newer `profile.search` structure is recommended.

3. **`data.*` parameters**: parameters such as `data.activeProfile`, `data.profilesBasePath` and `data.enableProfilePoiMapping` do NOT belong in profile.json, but in `geoleaf.config.json`, or are passed through `init()`.

4. **Control positions**: every position uses the standard MapLibre GL JS values: `"top-left"`, `"top-right"`, `"bottom-left"`, `"bottom-right"`.

5. **Offline cache**: the `offline`, `offlineBounds`, `cacheMinZoom` and `cacheMaxZoom` parameters of a base map are fully functional.

### Recommendations

1. **Add `defaultSettings`** to centralise the default map parameters.

2. **Document `Directory`** if that pattern is used for layers.

3. **Consider adding `stylesConfig`** to support alternative styles.

4. **Keep backwards compatibility** with `panels.*` for at least one major version.

5. **Migrate `useMapping` → `enableProfilePoiMapping`** in the examples and the documentation.
