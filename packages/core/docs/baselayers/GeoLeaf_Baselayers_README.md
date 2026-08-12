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
- `GeoLeaf.Baselayers.destroy()` — removes the UI and releases the resources

---

## 3. `GeoLeaf.Baselayers.init(options)`

Initialises the module and activates a basemap.

```js
GeoLeaf.Baselayers.init({
    map: map, // MapLibre GL instance
    defaultKey: "street-vector",
});
```

### 3.1 Parameters

| Parameter    | Type     | Required | Description                         |
| ------------ | -------- | -------- | ----------------------------------- |
| `map`        | `Map`    | Yes      | Existing MapLibre GL instance       |
| `defaultKey` | `string` | No       | Identifier of the initial baselayer |

### 3.2 Behaviour

- Checks that `map` is a valid instance.
- Loads the basemap registry from `basemaps.json`.
- Determines the initial baselayer:
    - the one given through `defaultKey`, or
    - the basemap marked `defaultBasemap: true`.
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
            "label": "Street",
            "url": "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
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

| Property         | Type    | Required | Description                                        |
| ---------------- | ------- | -------- | -------------------------------------------------- |
| `id`             | string  | Yes      | Unique identifier                                  |
| `label`          | string  | Yes      | Name shown in the UI                               |
| `type`           | string  | No       | `"raster"` (default) or `"maplibre"` (vector)      |
| `url`            | string  | No       | Raster tile URL template `{z}/{x}/{y}`             |
| `style`          | string  | No       | MapLibre GL JSON style URL (maplibre type)         |
| `fallbackUrl`    | string  | No       | Raster fallback URL for the maplibre type          |
| `tiles`          | array   | No       | List of alternative tile URLs                      |
| `attribution`    | string  | No       | Attribution text                                   |
| `minZoom`        | number  | No       | Minimum zoom                                       |
| `maxZoom`        | number  | No       | Maximum zoom                                       |
| `defaultBasemap` | boolean | No       | Default basemap                                    |
| `offline`        | boolean | No       | Cache for offline use                              |
| `offlineBounds`  | object  | No       | Geographic area to cache (`north/south/east/west`) |
| `cacheMinZoom`   | number  | No       | Minimum zoom of the offline cache                  |
| `cacheMaxZoom`   | number  | No       | Maximum zoom of the offline cache                  |

> **maplibre type**: when `type: "maplibre"`, the `style` property points to a MapLibre GL JSON style file. The `url` property (or `fallbackUrl`) is used as a raster fallback when the MapLibre style cannot be loaded.

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
- Unmounts the active basemap, when there is one.
- Creates a new MapLibre instance from the definition.
- Attaches the new layer to the map.
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
- [PROFILES_GUIDE.md](../PROFILES_GUIDE.md) — profile structure
- [CONFIGURATION_GUIDE.md](../CONFIGURATION_GUIDE.md) — basemaps.json file
