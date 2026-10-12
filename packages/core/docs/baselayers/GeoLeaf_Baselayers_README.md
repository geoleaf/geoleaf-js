---
title: "GeoLeaf.Baselayers — Baselayers module documentation"
---

# GeoLeaf.Baselayers — Baselayers module documentation

Applies to: @geoleaf/core v3.x
**File (monorepo)**: `src/modules/built-in/basemaps/`

---

The **GeoLeaf.Baselayers** module handles every **basemap** in GeoLeaf.
It provides:

- an **internal registry** of the available basemaps;
- initialisation of the default basemap;
- dynamic basemap switching;
- creation and management of the matching MapLibre GL layer;
- the links with the UI (`data-gl-baselayer="street|topo|satellite"` attributes).

GeoLeaf.Baselayers handles **neither POIs**, **nor the UI theme**, **nor the legend**.
It deals exclusively with the tile logic of the map.

---

## 1. Functional role of GeoLeaf.Baselayers

1. **Define the available basemaps** from `basemaps.json`
2. **Create and attach** the MapLibre GL tile layer matching the active basemap.
3. **Allow dynamic switching** of the active basemap:
    - from code
    - from the UI (HTML elements carrying `data-gl-baselayer="..."`)
4. Normalise the internal options:
    - attribution,
    - maxZoom,
    - error handling,
    - explicit logs.

---

## 2. Public API of GeoLeaf.Baselayers

The module exposes:

- `GeoLeaf.Baselayers.init(options)`
- `GeoLeaf.Baselayers.registerBaseLayer(key, definition)` — adds one basemap to the registry
- `GeoLeaf.Baselayers.registerBaseLayers(layers)` — adds several basemaps at once
- `GeoLeaf.Baselayers.setBaseLayer(key)` — activates a basemap by key
- `GeoLeaf.Baselayers.setActive(key)` — alias of `setBaseLayer()`
- `GeoLeaf.Baselayers.getActiveKey()` — returns the key of the active basemap
- `GeoLeaf.Baselayers.getActiveId()` — alias of `getActiveKey()`
- `GeoLeaf.Baselayers.getActiveLayer()` — returns the configuration object of the active basemap
- `GeoLeaf.Baselayers.getBaseLayers()` — returns the whole registry
- `GeoLeaf.Baselayers.refreshBasemap()` — puts the active raster basemap back when its source was lost from the style without a basemap switch; its hillshade overlay and its terrain are checked along with it. No effect on a vector basemap or when the source is still there; a WMTS basemap comes back asynchronously. The camera is not moved, and `geoleaf:basemap:change` is not emitted
- `GeoLeaf.Baselayers.destroy()` — removes the UI and releases the resources

---

## 3. `GeoLeaf.Baselayers.init(options)`

Initialises the module and activates a basemap.

```js
GeoLeaf.Baselayers.init({
    map: map, // MapLibre GL instance
    activeKey: "street-vector",
});
```

### 3.1 Parameters

| Parameter   | Type     | Required | Description                         |
| ----------- | -------- | -------- | ----------------------------------- |
| `map`       | `Map`    | Yes      | Existing MapLibre GL instance       |
| `activeKey` | `string` | No       | Identifier of the initial baselayer |

### 3.2 Behaviour

- Checks that `map` is a valid instance.
- Loads the basemap registry from `basemaps.json`.
- Determines the initial baselayer:
    - the one given through `activeKey`, or
    - the first registered basemap. At boot, GeoLeaf passes as `activeKey` the basemap the
      profile marks `defaultBasemap: true`.
- Mounts the tile layer on the map.

---

## 4. Basemap configuration (`basemaps.json`)

Basemaps are defined in `profiles/{id}/basemaps.json`:

```json
{
    "basemaps": {
        "street-vector": {
            "id": "street-vector",
            "label": "Carte vectorielle",
            "type": "maplibre",
            "style": "https://tiles.openfreemap.org/styles/liberty",
            "url": "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "attribution": "© OpenFreeMap © OpenMapTiles © OpenStreetMap",
            "minZoom": 5,
            "maxZoom": 19,
            "defaultBasemap": true,
            "offline": false
        },
        "street": {
            "id": "street",
            "label": "Street (self-hosted)",
            "url": "https://tiles.example.com/street/{z}/{x}/{y}.png",
            "attribution": "&copy; OpenStreetMap contributors",
            "minZoom": 4,
            "maxZoom": 19,
            "offline": true,
            "offlineBounds": {
                "north": -22,
                "south": -56,
                "east": -53.5,
                "west": -73.5
            },
            "cacheMinZoom": 4,
            "cacheMaxZoom": 12
        }
    }
}
```

### 4.1 Basemap properties

| Property         | Type    | Required | Description                                         |
| ---------------- | ------- | -------- | --------------------------------------------------- |
| `id`             | string  | Yes      | Unique identifier                                   |
| `label`          | string  | Yes      | Name shown in the UI                                |
| `type`           | string  | No       | `"raster"` (default) or `"maplibre"` (vector)       |
| `url`            | string  | No       | Raster tile URL template `{z}/{x}/{y}`              |
| `style`          | string  | No       | MapLibre GL JSON style URL (maplibre type)          |
| `fallbackUrl`    | string  | No       | Raster fallback URL for the maplibre type           |
| `tiles`          | array   | No       | List of alternative tile URLs                       |
| `attribution`    | string  | No       | Attribution text                                    |
| `minZoom`        | number  | No       | Minimum zoom                                        |
| `maxZoom`        | number  | No       | Maximum zoom                                        |
| `defaultBasemap` | boolean | No       | Default basemap                                     |
| `offline`        | boolean | No       | Downloadable by the offline preparation (see below) |
| `offlineBounds`  | object  | No       | Geographic area to cache (`north/south/east/west`)  |
| `cacheMinZoom`   | number  | No       | Minimum zoom of the offline cache                   |
| `cacheMaxZoom`   | number  | No       | Maximum zoom of the offline cache                   |

> **maplibre type**: when `type: "maplibre"`, the `style` property points to a MapLibre GL JSON style file. The `url` property (or `fallbackUrl`) is used as a raster fallback when the MapLibre style cannot be loaded.

### 4.2 Relief: terrain and shading

Two optional blocks give a basemap its relief, and they answer two different questions:

| Block       | What it does                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `terrain`   | Drapes the map over an elevation source. Put on when the basemap is selected (`default3D`), or when the map is tilted (`activation: "pitch"`) |
| `hillshade` | Draws the shadows of that relief. The basemap itself on `type: "hillshade"`; an overlay of any other basemap when `hillshade.overlay` is true |

A vector basemap with `terrain` alone shows slopes as flat colours. Add the shading as an overlay:

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
                "default3D": true,
                "pitch": 60
            },
            "hillshade": {
                "overlay": true,
                "beforeLayer": "waterway_tunnel",
                "demUrl": "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
                "exaggeration": 0.45
            }
        }
    }
}
```

- **Position.** On an image basemap (tiles, WMS, WMTS) the overlay sits right above the basemap's layer, under the data layers. On a vector basemap it is inserted before the style layer `hillshade.beforeLayer` names; without it, or when the style has no such layer, before the style's first `symbol` layer — labels stay readable, water and roads are shaded.
- **Lifecycle.** The overlay follows the basemap: put back after every style change, removed when the active basemap declares none, left untouched when the next basemap asks for the same one.
- **Sources.** The overlay reads a raster-dem source of its own, never the terrain's: the same `demUrl` is requested twice, and the shading is one zoom level finer than a shared source would give.
- **Offline.** Elevation tiles are not part of the offline preparation: a basemap prepared for offline use is drawn without its relief when the network is gone.

A basemap can also open flat and get its relief only when the map is tilted:

```json
{
    "basemaps": {
        "satellite": {
            "id": "satellite",
            "label": "Satellite",
            "url": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            "attribution": "Tiles &copy; Esri",
            "terrain": {
                "enabled": true,
                "demUrl": "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
                "activation": "pitch"
            },
            "hillshade": {
                "overlay": true,
                "onlyWithTerrain": true,
                "demUrl": "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
                "exaggeration": 0.45
            }
        }
    }
}
```

- **Following the tilt.** With `terrain.activation: "pitch"` there is no terrain while the map is flat, and no elevation tile is requested. The terrain is put on once the camera comes to rest tilted to `activateFromPitch` (12° by default) or more, and removed once it comes to rest under `deactivateBelowPitch` (half of it by default). The decision is taken when a movement ends, never during it.
- **Camera.** In that mode the camera is never moved — neither when the terrain comes, nor when another basemap is selected. `pitch`, `bearing` and `default3D: true` describe the activation by selection; the schema refuses them next to `activation: "pitch"`.
- **Shading with the terrain.** `hillshade.onlyWithTerrain` shows the overlay only while a terrain is on the map. Hidden, it requests no tile: with both keys, a flat map is exactly what it would be without either block.

The full list of `hillshade` and `terrain` keys is in the [profile JSON reference](../PROFILE_JSON_REFERENCE.md).

> **Offline preparation**: `offline: true` makes the basemap downloadable over `offlineBounds` and the
> cache zooms. Tiles from an origin other than the application's own are only downloaded when that
> origin is declared `cacheable: true` and `prefetch: true` in `modules.offline.dataOrigins` — declare
> one only if you operate it or its terms allow downloading ahead of use (OpenStreetMap forbids offline
> use of `tile.openstreetmap.org`). The `street` example above points at a self-hosted server, and
> needs `{ "origin": "https://tiles.example.com", "roles": ["tiles"], "cacheable": true, "prefetch": true }`.

---

## 5. `GeoLeaf.Baselayers.registerBaseLayer(key, definition)`

Adds a custom basemap to the registry.

```js
GeoLeaf.Baselayers.registerBaseLayer("mytiles", {
    id: "mytiles",
    label: "Mes tuiles",
    url: "https://tiles.example.com/{z}/{x}/{y}.png",
    attribution: "© Example Tiles",
    maxZoom: 20,
});
```

### 5.1 Parameters

| Parameter    | Type   | Required | Description        |
| ------------ | ------ | -------- | ------------------ |
| `key`        | string | Yes      | Unique identifier  |
| `definition` | object | Yes      | Basemap definition |

### 5.2 Rules

- When the key already exists, it is overwritten.
- The definition must contain at least `url` or `style`.

---

## 6. `GeoLeaf.Baselayers.setBaseLayer(key)`

Switches the basemap dynamically.

```js
GeoLeaf.Baselayers.setBaseLayer("street");
```

### 6.1 Behaviour

- Checks that the key exists in the registry.
- Replaces the active basemap, when there is one: a raster basemap swaps its source and layer, a vector one swaps the map's style.
- Puts back, after the basemap, what follows it: its hillshade overlay and its terrain.
- Updates `_activeKey`.

### 6.2 Error handling

- When the key does not exist:
    - logs `[GeoLeaf.Baselayers] baselayer introuvable : {key}`
    - no change is applied.

---

## 7. UI integration (HTML)

Basemaps can be switched from the DOM using elements carrying:

```html
<button data-gl-baselayer="street">Street</button>
<button data-gl-baselayer="satellite">Satellite</button>
```

---

## 8. Links

- `profiles/schemas/basemaps.schema.json` — JSON schema of the basemaps
- [PROFILE_JSON_REFERENCE.md](../PROFILE_JSON_REFERENCE.md#basemaps-section) — the `basemaps` section of a profile
