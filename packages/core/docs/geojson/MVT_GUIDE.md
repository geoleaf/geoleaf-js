---
title: "Guide: MVT / PBF Vector Tiles"
---

# Guide: MVT / PBF Vector Tiles

Applies to: @geoleaf/core v3.x

---

## Overview

**Vector tiles** (MVT — Mapbox Vector Tiles, PBF format — Protocol Buffers) load complex
geographic layers without transferring or parsing a full GeoJSON file.

Tiles are pre-cut into squares (`{z}/{x}/{y}.pbf`) and loaded on demand according to the zoom
level and the visible extent. Only the tiles needed for the current view are downloaded — the map
stays fluid even for very dense datasets.

**When to use MVT rather than GeoJSON?**

| Criterion                        | Plain GeoJSON            | MVT / PBF                             |
| -------------------------------- | ------------------------ | ------------------------------------- |
| Feature volume                   | < 5,000 features         | >= 5,000 features (lines/polygons)    |
| Interactivity (popups, tooltips) | Full                     | Full (`interactive: true`)            |
| POI clustering                   | Supported (supercluster) | Not supported                         |
| Dynamic styles (styleRules)      | Full                     | Full (MapLibre Style Spec)            |
| GL style expressions             | Not supported            | Supported (`match`, `interpolate`, …) |
| Build prerequisite               | None                     | Tiles must be pre-generated           |

---

## Prerequisites

### MapLibre GL JS (native vector source)

Vector tiles are handled natively by MapLibre GL JS through `map.addSource()` +
`map.addLayer()`. No extra dependency is required.

MapLibre GL JS is the only required peer dependency:

```bash
npm install maplibre-gl
```

### Pre-generated tiles

MVT mode **requires** the PBF tiles to have been generated before deployment.
See the "Tile generation" section below.

---

## Configuring a layer in MVT mode

Add a `data.vectorTiles` block to the layer configuration file
(`layers/{layerId}/{layerId}_config.json`):

```json
{
    "id": "reseau_ferroviaire",
    "label": "Réseau ferroviaire",
    "geometry": "line",
    "data": {
        "directory": "data",
        "file": "reseau_ferroviaire.geojson",
        "vectorTiles": {
            "enabled": true,
            "tilesDirectory": "tiles",
            "layerName": "reseau_ferroviaire",
            "minZoom": 0,
            "maxNativeZoom": 14,
            "maxZoom": 18,
            "interactive": false
        }
    }
}
```

### `data.vectorTiles` parameters

| #   | Parameter        | Type      | Default   | Required | Description                                                                                                                                         |
| --- | ---------------- | --------- | --------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `enabled`        | `boolean` | `false`   | Yes      | Enables MVT mode for this layer. When `false` or absent, GeoLeaf loads the plain GeoJSON file.                                                      |
| 2   | `tilesDirectory` | `string`  | `"tiles"` |          | Sub-folder, relative to the layer directory, holding the generated PBF tiles.                                                                       |
| 3   | `layerName`      | `string`  | `{id}`    |          | Name of the layer inside the PBF file. One file may contain several layers — this parameter selects which one to extract. Defaults to the layer id. |
| 4   | `minZoom`        | `number`  | `0`       |          | Lowest zoom level at which tiles exist. Below it, the layer is not displayed.                                                                       |
| 5   | `maxNativeZoom`  | `number`  | `14`      |          | Highest zoom level for which native tiles exist. Beyond it, the last level is stretched (over-zoom).                                                |
| 6   | `maxZoom`        | `number`  | `18`      |          | Highest zoom level at which the layer is displayed at all, over-zoom included. Beyond it, the layer disappears.                                     |
| 7   | `interactive`    | `boolean` | `true`    |          | Enables interactions (click → popup, hover → tooltip) on tile features. Turning it off improves performance for purely visual layers.               |

### Custom URL

By default, GeoLeaf builds the tile URL from the profile path:

```
{profilesBasePath}/{profileId}/{layerDirectory}/{tilesDirectory}/{z}/{x}/{y}.pbf
```

To point at an external tile server, add a `url` field:

```json
"vectorTiles": {
  "enabled": true,
  "layerName": "my_layer",
  "url": "https://tiles.example.com/my_layer/{z}/{x}/{y}.pbf"
}
```

---

## Tile generation

The `scripts/generate-vector-tiles.cjs` script generates the PBF files from the profile
GeoJSON. It supports two backends:

| Backend            | Quality | Platform              | Prerequisite                                             |
| ------------------ | ------- | --------------------- | -------------------------------------------------------- |
| **tippecanoe**     | Best    | macOS, Linux, WSL     | Install [tippecanoe](https://github.com/felt/tippecanoe) |
| **Native Node.js** | Good    | Windows, macOS, Linux | `geojson-vt` + `vt-pbf` (npm)                            |

> The backend is **auto-detected** at launch. When tippecanoe is available (including through WSL
> on Windows) it takes priority. Otherwise the Node.js backend takes over.

### CLI options

```bash
node scripts/generate-vector-tiles.cjs [options]
```

| Option             | Default   | Description                                         |
| ------------------ | --------- | --------------------------------------------------- |
| `--profile <id>`   | `tourism` | Profile to process                                  |
| `--layer <id>`     | _(all)_   | Process a single VT-enabled layer                   |
| `--backend <name>` | `auto`    | Force `tippecanoe` or `node`                        |
| `--min-zoom <n>`   | `0`       | Lowest zoom level to generate                       |
| `--max-zoom <n>`   | `14`      | Highest zoom level to generate (native)             |
| `--dry-run`        |           | Print what would be generated without writing files |
| `--force`          |           | Overwrite existing tiles                            |

### Examples

```bash
# Generate every VT layer of the tourism profile (backend auto-detected)
node scripts/generate-vector-tiles.cjs --profile tourism

# Generate a single layer, force the native Node.js backend, dry run
node scripts/generate-vector-tiles.cjs --profile tourism --layer reseau_ferroviaire --backend node --dry-run

# Full regeneration with tippecanoe (overwrites existing tiles)
node scripts/generate-vector-tiles.cjs --profile tourism --backend tippecanoe --force --max-zoom 16
```

### Installing the Node.js dependencies (native backend)

```bash
npm install --save-dev geojson-vt vt-pbf
```

### Output structure

```
profiles/
└── tourism/
    └── layers/
        └── reseau_ferroviaire/
            ├── data/
            │   └── reseau_ferroviaire.geojson      ← source
            └── tiles/                              ← generated tiles
                ├── 0/
                │   └── 0/
                │       └── 0.pbf
                ├── 8/
                │   └── 142/
                │       └── 97.pbf
                └── 14/
                    └── ...
```

---

## Full flow

```
GeoJSON source
     |
     v
scripts/generate-vector-tiles.cjs
     |  |-- tippecanoe -> .mbtiles -> tile-join -> {z}/{x}/{y}.pbf
     |  +-- Node.js    -> geojson-vt + vt-pbf   -> {z}/{x}/{y}.pbf
     v
layers/{id}/tiles/{z}/{x}/{y}.pbf
     |
     v
{layerId}_config.json
  data.vectorTiles.enabled: true
  data.vectorTiles.tilesDirectory: "tiles"
  data.vectorTiles.layerName: "{id}"
     |
     v
GeoLeaf.loadConfig() at boot
  -> VectorTiles.shouldUseVectorTiles(def) -> true
  -> VectorTiles.loadVectorTileLayer()
  -> map.addSource(id, { type: 'vector', tiles: [url] })
  -> map.addLayer({ id, type, source, 'source-layer', paint })
     |
     v
MapLibre GL JS map — WebGL rendering, tile by tile, on demand
```

---

## Styles and interactions

### Layer style

GeoLeaf converts the GeoLeaf style (`styles/default.json`) into MapLibre style properties
(paint/layout) through `VectorTiles.convertStyleToMapLibre()`.

**Style properties supported in MVT mode (MapLibre Style Spec):**

| GeoLeaf property | MapLibre paint property | Layer type |
| ---------------- | ----------------------- | ---------- |
| `fillColor`      | `fill-color`            | `fill`     |
| `fillOpacity`    | `fill-opacity`          | `fill`     |
| `color`          | `line-color`            | `line`     |
| `weight`         | `line-width`            | `line`     |
| `opacity`        | `line-opacity`          | `line`     |

**`styleRules` are supported** — GeoLeaf converts them into MapLibre expressions
(`match`, `case`) for native GPU rendering. Example of a style with thematic rules:

```json
{
    "defaultStyle": { "color": "#3388ff", "weight": 2, "fillColor": "#3388ff", "fillOpacity": 0.4 },
    "styleRules": [
        {
            "condition": { "field": "type", "value": "TGV" },
            "style": { "color": "#e63946", "weight": 3 }
        },
        {
            "condition": { "field": "type", "value": "TER" },
            "style": { "color": "#457b9d", "weight": 2 }
        }
    ]
}
```

GeoLeaf produces the following MapLibre Style Spec equivalent:

```javascript
// Generated source + layers by VectorTiles.loadVectorTileLayer()
map.addSource("reseau_ferroviaire", {
    type: "vector",
    tiles: ["https://example.com/tiles/{z}/{x}/{y}.pbf"],
    minzoom: 0,
    maxzoom: 14,
});

map.addLayer({
    id: "reseau_ferroviaire-line",
    type: "line",
    source: "reseau_ferroviaire",
    "source-layer": "reseau_ferroviaire",
    paint: {
        "line-color": [
            "match",
            ["get", "type"],
            "TGV",
            "#e63946",
            "TER",
            "#457b9d",
            "#3388ff", // default
        ],
        "line-width": [
            "match",
            ["get", "type"],
            "TGV",
            3,
            "TER",
            2,
            2, // default
        ],
    },
});
```

### Interactions

Enabled by default (`interactive: true`) — GeoLeaf listens for `click` and
`mouseenter`/`mouseleave` on tile features through `map.on('click', layerId, ...)`:

- **Click** -> popup built by `PopupTooltip._buildPopupContent()` (same template as GeoJSON)
- **Hover** -> tooltip when `def.tooltip.enabled === true`, with a cursor change

For purely visual layers (basemaps, dense networks), turning interactions off improves
performance:

```json
"vectorTiles": {
  "enabled": true,
  "layerName": "roads",
  "interactive": false
}
```

---

## Limitations and points of attention

> These limitations are inherent to pre-generated vector tiles. They are listed here to guide the
> choice between MVT and plain GeoJSON.

### 1 — Performance beyond 50,000 features

For very dense layers (more than 50,000 features at the maxNativeZoom level), tippecanoe
automatically applies simplification and clipping (**`--drop-densest-as-needed`**).
The native Node.js backend (`geojson-vt`) applies no automatic clipping — tiles can become
heavy.

**Recommendation:** use tippecanoe with a suitable `--maximum-zoom` and check the tile sizes at
maximum zoom (`ls -la tiles/14/*/*`).

### 2 — GL style expressions supported

Style expressions (`interpolate`, `match`, `step`, `case`) are **fully supported**. GeoLeaf
converts `styleRules` into native MapLibre expressions automatically.

Styles coming from a GL editor (QGIS, Mapbox Studio) can be used directly in the MapLibre Style
Specification.

### 3 — Clustering not supported in MVT mode

Clustering (supercluster, built into MapLibre) belongs to the GeoJSON/POI pipeline. MVT layers do
not support clustering — they target dense **lines** and **polygons**, not POI point clouds.

For dense POI layers, use GeoJSON plus native MapLibre clustering, or MVT with
`interactive: false` for a purely visual display.

### 4 — Interactions

In `interactive: true` mode, MVT popups and tooltips are built from the properties of the queried
feature through `map.queryRenderedFeatures()`. The following capabilities are available:

- Popup built from the same template as GeoJSON
- Hover tooltip with a cursor change
- Side panel (`openSidePanel`) supported through `queryRenderedFeatures`

> The `geoleaf:geojson:visibility-changed` event carrying a feature count is not available in MVT
> mode (features are streamed tile by tile).

---

## See also

- [GEOJSON_LAYERS_GUIDE.md](GEOJSON_LAYERS_GUIDE.md) — plain GeoJSON layers guide
- GUIDE_CONFIGURATIONS_CORE.md — full reference of every parameter
- `generate-vector-tiles.cjs` — generation script
- `vector-tiles.ts` — implementation
