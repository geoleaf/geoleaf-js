---
title: "Guide: Multi-Source GeoJSON Layer System"
---

# Guide: Multi-Source GeoJSON Layer System

Applies to: @geoleaf/core v3.x

---

## Overview

The `GeoLeaf.GeoJSON` module supports **several independent GeoJSON layers**, with:

- Per-layer show/hide
- Automatic integration into the legend
- Unified popups compatible with the existing POI system
- Smart clustering for points
- Configuration per business profile (tourism, etc.)

---

## Configuration in `profile.json`

### Basic structure

Add a `geojsonLayers` section to `data/profiles/[profile]/profile.json`:

```json
{
    "id": "tourism",
    "label": "Profil tourisme",

    "geojsonLayers": [
        {
            "id": "tourism-routes",
            "label": "Itinéraires touristiques",
            "url": "../data/profiles/tourism/geojson/itineraries.geojson",
            "visible": true,
            "fitBoundsOnLoad": false,
            "maxZoomOnFit": 12,
            "clustering": false,
            "style": {
                "color": "#FF9800",
                "weight": 3,
                "opacity": 0.9
            },
            "popupTemplate": "default",
            "detailProfileId": "route_default"
        },
        {
            "id": "tourism-zones",
            "label": "Zones touristiques",
            "url": "../data/profiles/tourism/geojson/zone-test.geojson",
            "visible": true,
            "clustering": false,
            "style": {
                "color": "#0066cc",
                "weight": 2,
                "fillColor": "#66ccff",
                "fillOpacity": 0.35
            },
            "popupTemplate": "default"
        },
        {
            "id": "tourism-poi-nature",
            "label": "POI Nature",
            "url": "../data/profiles/tourism/geojson/poi-naturels.geojson",
            "visible": true,
            "clustering": true,
            "pointStyle": {
                "radius": 8,
                "color": "#ffffff",
                "weight": 2,
                "fillColor": "#10b981",
                "fillOpacity": 0.9
            }
        }
    ]
}
```

### Layer properties

| Property          | Type      | Required             | Description                                    |
| ----------------- | --------- | -------------------- | ---------------------------------------------- |
| `id`              | `string`  | Yes                  | Unique layer identifier                        |
| `label`           | `string`  | Yes                  | Label shown in the legend                      |
| `url`             | `string`  | Yes                  | Path to the GeoJSON file                       |
| `visible`         | `boolean` | No (default `true`)  | Initial visibility                             |
| `fitBoundsOnLoad` | `boolean` | No (default `false`) | Fit the view to the layer on load              |
| `maxZoomOnFit`    | `number`  | No (default 16)      | Maximum zoom applied by fitBounds              |
| `clustering`      | `boolean` | No (default auto)    | Enable clustering (points only)                |
| `style`           | `object`  |                      | MapLibre paint style for polygons/lines        |
| `pointStyle`      | `object`  |                      | MapLibre paint style for points (circle layer) |
| `popupTemplate`   | `string`  | No                   | Popup template (not implemented yet)           |
| `detailProfileId` | `string`  | No                   | Detail panel profile (not implemented yet)     |

---

## Clustering configuration — per capability, no longer global

::: warning

`poiConfig` and `applyToAllSources` no longer exist. They set clustering for "all POIs" at once, back when a POI was a separate subsystem. A POI is now a GeoJSON point layer, and clustering is configured like any other capability: a default in the profile, an override per layer.

:::

**Profile default** — `config/plugins/cluster.json`, referenced by `Files.modules.cluster`:

```jsonc
{
    "clustering": true,
    "clusterStrategy": "unified",
    "clusterRadius": 80,
    "disableClusteringAtZoom": 12,
}
```

**Per layer** — in the layer's `*_config.json`, the `clustering` key takes precedence over the
default:

```jsonc
{
    "id": "commerces",
    "clustering": false, // this layer never clusters, whatever the default is
}
```

> The proximity search radius is configured separately, under `profile.search`
> (`radiusMin`, `radiusMax`, `radiusStep`, `radiusDefault`).

---

## Use from the application

::: warning

`GeoLeaf.GeoJSON` is **not** a public namespace.
Layers declared in `geojsonLayers` are loaded **automatically** at init.
Visibility is handled through `GeoLeaf.Legend`.

:::

### Automatic loading

GeoJSON layers defined in `geojsonLayers` are loaded automatically when
`GeoLeaf.loadConfig()` is called — no extra call is required:

```javascript
GeoLeaf.loadConfig({ url: "./geoleaf.config.json", profileId: "tourism" }).then(() => {
    // geojsonLayers layers are already loaded and visible
    console.log("Map ready with the profile GeoJSON layers.");
});
```

### Visibility management

```javascript
// Hide a layer
GeoLeaf.Legend.setLayerVisibility("tourism-routes", false);

// Show a layer
GeoLeaf.Legend.setLayerVisibility("tourism-routes", true);

// List all active layers
const allLayers = GeoLeaf.Legend.getAllLayers();
console.log(allLayers);
```

---

## Legend integration

The system integrates **automatically** with the `GeoLeaf.Legend` module:

1. **Section created automatically**: "GeoJSON layers"
2. **Clickable items**: one checkbox/switch per layer
3. **Two-way synchronisation**: legend ↔ map

### Events

```javascript
// Listen for visibility changes
map.on("geoleaf:geojson:visibility-changed", (e) => {
    console.log(`Layer ${e.layerId}: ${e.visible ? "visible" : "hidden"}`);
});

// Listen for layer loading
map.on("geoleaf:geojson:layers-loaded", (e) => {
    console.log(`${e.count} layer(s) loaded`, e.layers);
});
```

---

## Popups and detail panel

### Automatic popups

Each feature shows a popup with:

- **Title**: `properties.name`, `properties.label` or `properties.title`
- **Description**: `properties.description` or `properties.desc`
- **"View details" button**: rendered by the `feature-info` capability, configured on the layer
  (`layers.<id>.capabilities.feature-info`)

### Recommended GeoJSON format

```json
{
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {
                "id": "poi-001",
                "name": "Parc National",
                "description": "Magnifique parc naturel avec vue panoramique.",
                "category": "nature",
                "subcategory": "parc"
            },
            "geometry": {
                "type": "Point",
                "coordinates": [-60.68, -32.95]
            }
        }
    ]
}
```

### Side detail panel

Clicking a feature opens the existing POI detail panel **automatically**, with the adapted data.

---

## POI clustering

### Automatic activation

Clustering is enabled when:

1. The layer contains `Point` geometries
2. `clustering: true` in `config/plugins/cluster.json` (profile default)
3. `clustering !== false` in the layer's `*_config.json` (no explicit opt-out)

### Per-layer override

```jsonc
{
    "id": "poi-sans-cluster",
    "label": "POI sans clustering",
    "url": "poi.geojson",
    "clustering": false, // ← disables clustering for this layer only
}
```

---

## Supported geometry types

| Geometry type     | MapLibre rendering     | Style config | Clustering |
| ----------------- | ---------------------- | ------------ | ---------- |
| `Point`           | Circle layer or Symbol | `pointStyle` | Yes        |
| `LineString`      | Line layer             | `style`      | No         |
| `Polygon`         | Fill + Line layer      | `style`      | No         |
| `MultiPoint`      | Circle layer or Symbol | `pointStyle` | Yes        |
| `MultiLineString` | Line layer             | `style`      | No         |
| `MultiPolygon`    | Fill + Line layer      | `style`      | No         |

---

## Limits and performance

### Layer limit

- **Warning** above 10 layers in `geojsonLayers[]`
- **Recommendation**: 3-5 layers maximum for optimal performance

### Feature limit

- No technical limit, but watch performance above 5000 features per layer
- Use clustering for dense POI layers

### MapLibre optimisations

- Each layer uses an independent GeoJSON source (`map.addSource()`)
- Clustering through the supercluster implementation built into MapLibre (`cluster: true` on the source)
- Efficient add/remove through `map.addLayer()` / `map.removeLayer()`
- WebGL rendering for optimal performance on dense layers

---

## Complete examples

### Example 1: three layers (POI, routes, zones)

```jsonc
"geojsonLayers": [
  {
    "id": "poi-restaurants",
    "label": "Restaurants",
    "url": "../data/profiles/tourism/geojson/restaurants.geojson",
    "visible": true,
    "clustering": true,
    "pointStyle": {
      "radius": 8,
      "fillColor": "#f97316",
      "color": "#fff",
      "weight": 2,
      "fillOpacity": 0.9
    }
  },
  {
    "id": "routes-velo",
    "label": "Pistes cyclables",
    "url": "../data/profiles/tourism/geojson/routes-velo.geojson",
    "visible": false,
    "clustering": false,
    "style": {
      "color": "#10b981",
      "weight": 4,
      "opacity": 0.8
    }
  },
  {
    "id": "zones-protection",
    "label": "Zones protégées",
    "url": "../data/profiles/tourism/geojson/zones-protection.geojson",
    "visible": true,
    "style": {
      "color": "#3b82f6",
      "weight": 2,
      "fillColor": "#93c5fd",
      "fillOpacity": 0.3
    }
  }
]
```

### Example 2: programmatic visibility control

```javascript
// Layers are loaded automatically through loadConfig()
// Handle visibility through GeoLeaf.Legend:

// Hide every layer except one
const allLayers = GeoLeaf.Legend.getAllLayers();
allLayers.forEach((info, layerId) => {
    if (layerId !== "poi-restaurants") {
        GeoLeaf.Legend.setLayerVisibility(layerId, false);
    }
});

// Count visible layers
const visibleCount = [...allLayers.entries()].filter(([, info]) => info.visible).length;
console.log("Visible layers:", visibleCount);
```

---

## Declaring layers in the profile

GeoJSON layers are declared in `profile.json` and nowhere else.
There is no public `GeoLeaf.GeoJSON` API — loading is driven entirely by configuration.

```json
{
    "geojsonLayers": [
        {
            "id": "zones",
            "label": "Zones",
            "url": "zones.geojson",
            "visible": true
        }
    ]
}
```

See [Configuration in `profile.json`](#configuration-in-profilejson) for the full reference.

---

## Troubleshooting

### Problem: layers do not appear

**Check**:

1. The GeoJSON file URLs are correct (relative to the profile)
2. `visible: true` in the config
3. The browser console for loading errors (404, invalid JSON)
4. `GeoLeaf.loadConfig()` is called before the map is used

### Problem: clustering does not work

**Check**:

1. `clustering: true` in `config/plugins/cluster.json`
2. `Files.modules.cluster` points to that file from `profile.json`
3. Geometries are of type `Point` (not `Polygon` or `LineString`)
4. No `clustering: false` in the layer's `*_config.json`

> Clustering is built in natively through supercluster (MapLibre source clustering).
> No external dependency is required.

### Problem: the legend does not appear

**Check**:

1. The `GeoLeaf.LayerManager` module is initialised
2. `modules.legend.enabled` is not disabled (opt-out: the legend is active unless `modules.legend.enabled: false` is set in `config/plugins/legend.json`)
3. At least one layer loaded successfully

---

## MVT / PBF vector tiles

For high-volume layers (more than 5,000 lines or polygons), GeoLeaf supports
**vector tiles** (MVT/PBF) through the native vector sources of MapLibre GL JS.
Tiles are pre-generated locally and loaded on demand according to zoom level and
visible extent.

> See the dedicated guide: [MVT_GUIDE.md](MVT_GUIDE.md)

---

## References

- **Internal module**: `packages/core/src/modules/geojson/`
- **Legend facade**: `packages/core/src/geoleaf.legend.ts`
- **Tourism profile**: `profiles/tourism/profile.json`
- **MVT guide**: [geojson/MVT_GUIDE.md](MVT_GUIDE.md)

---

## Changelog

### v2.0.0

- Rendering engine migration: Leaflet → MapLibre GL JS v5 (WebGL)
- GeoJSON sources through the native `map.addSource()` / `map.addLayer()` of MapLibre
- Native GPU clustering through `cluster: true` on sources
- Data-driven styles through MapLibre expressions (`match`, `interpolate`, `case`)
- `[lng, lat]` coordinates (GeoJSON standard) — the `[lat, lng]` inversion is gone

### v1.1.0–v1.2.0

- Multi-layer architecture through `geojsonLayers[]` in `profile.json`
- Automatic integration with `GeoLeaf.Legend` (visibility, sections)
- Unified popups compatible with the POI system
- Clustering configured per capability: profile default, per-layer override
- Configuration per business profile
