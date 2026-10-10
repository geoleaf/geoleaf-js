---
title: "GeoLeaf — Tutorial: build a project from start to finish"
---

# GeoLeaf — Tutorial: build a project from start to finish

**Applies to:** `@geoleaf/core` v3.x
**Estimated time:** 30–45 minutes
**Outcome:** A local business locator with search, filters and clustering

---

## What you will build

An interactive map showing local businesses with:

- A GeoJSON layer of businesses (restaurants, shops), coloured by category
- Marker clustering
- A tooltip on hover, a popup on click, and a side panel behind the popup
- Text search plus a category filter
- Light/dark theme, following the system
- Permalink (state carried in the URL)

Everything here runs on `@geoleaf/core` alone. Every JSON block below is a whole file: copy
them as they are and the project boots.

---

## Project structure

```
my-project/
├── index.html
├── geoleaf.config.json          ← global config (active profile)
└── profiles/
    └── commerces/
        ├── profile.json                    ← map; its `Files` key points to the rest
        ├── config/
        │   ├── core/
        │   │   ├── layers.json             ← layer list
        │   │   ├── basemaps.json           ← basemaps
        │   │   └── ui.json                 ← theme, language, layer manager
        │   └── plugins/
        │       ├── taxonomy.json           ← categories and their colours
        │       ├── cluster.json            ← clustering
        │       └── filter.json             ← the filter panel
        └── layers/
            └── commerces/
                ├── commerces_config.json   ← detailed layer config
                ├── styles/
                │   └── defaut.json         ← how a business is drawn
                └── data/
                    └── commerces.geojson   ← your data
```

---

## Step 1 — Installation

```bash
npm install @geoleaf/core maplibre-gl
```

Or from a CDN:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.css" />
<link
    rel="stylesheet"
    href="https://cdn.jsdelivr.net/npm/@geoleaf/core@3/dist/geoleaf-main.min.css"
/>
<script type="module">
    import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.mjs";
    globalThis.maplibregl = maplibregl;
</script>
<script
    type="module"
    src="https://cdn.jsdelivr.net/npm/@geoleaf/core@3/dist/geoleaf.esm.js"
></script>
```

::: info

MapLibre is **ESM-only since v6**: it no longer exposes a global, hence the two-line shim above.
In production, prefer self-hosting — see [`GETTING_STARTED.md`](GETTING_STARTED.md). Served
from a CDN, the worker that parses GeoJSON cannot start — a browser refuses a worker script
from another origin — so parsing runs on the main thread and a console warning says so.

:::

---

## Step 2 — index.html

```html
<!DOCTYPE html>
<html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Local businesses</title>
        <link
            rel="stylesheet"
            href="https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.css"
        />
        <link
            rel="stylesheet"
            href="https://cdn.jsdelivr.net/npm/@geoleaf/core@3/dist/geoleaf-main.min.css"
        />
        <style>
            body {
                margin: 0;
            }
            #geoleaf-map {
                height: 100vh;
                width: 100%;
            }
        </style>
    </head>
    <body>
        <div id="geoleaf-map"></div>

        <script type="module">
            import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.mjs";
            globalThis.maplibregl = maplibregl;
        </script>
        <script
            type="module"
            src="https://cdn.jsdelivr.net/npm/@geoleaf/core@3/dist/geoleaf.esm.js"
        ></script>
        <script type="module">
            // Full boot with a profile: the configuration file of step 3 names it
            GeoLeaf.boot({ configUrl: "./geoleaf.config.json" });
        </script>
    </body>
</html>
```

> **Note:** `GeoLeaf.boot()` is the high-level API for a full start with a profile. It creates the
> map in the element the configuration names (`map.target`, then `map.id`), `geoleaf-map` when it
> names none. For a simple map without a profile, use
> `Core.init({ mapId: "map", center: [48.8566, 2.3522], zoom: 12 })`.

---

## Step 3 — geoleaf.config.json

Global config at the project root. Names the active profile and where the profiles live.

<!-- geoleaf:docs:schema geoleaf-config -->

```json
{
    "data": {
        "activeProfile": "commerces",
        "profilesBasePath": "./profiles"
    }
}
```

---

## Step 4 — profile.json

Main profile config: the map, and the `Files` manifest that names every other file. A module
listed under `Files.modules` is configured by the file it points to.

<!-- geoleaf:docs:schema profile -->

```json
{
    "id": "commerces",
    "label": "Local businesses",
    "description": "Local business locator",
    "version": "1.0.0",

    "map": {
        "center": [48.8566, 2.3522],
        "zoom": 13,
        "maxZoom": 19,
        "minZoom": 10
    },

    "Files": {
        "layersFile": "config/core/layers.json",
        "basemapsFile": "config/core/basemaps.json",
        "uiFile": "config/core/ui.json",
        "modules": {
            "taxonomy": "config/plugins/taxonomy.json",
            "cluster": "config/plugins/cluster.json",
            "filter": "config/plugins/filter.json"
        }
    }
}
```

---

## Step 5 — config/plugins/taxonomy.json

Defines the categories, their subcategories and the colour of their marker. A taxonomy is
named (`commerce-types`), and `layers` says which layer uses it; `categoryField` and
`subCategoryField` name the feature properties that carry the two ids.

<!-- geoleaf:docs:module taxonomy -->

```json
{
    "layers": {
        "commerces": { "use": "commerce-types" }
    },
    "taxonomies": {
        "commerce-types": {
            "categoryField": "categoryId",
            "subCategoryField": "subcategoryId",
            "categories": {
                "restaurant": {
                    "label": "Restaurants",
                    "marker": { "fill": "#e65100", "stroke": "#ffffff", "strokeWidth": 2 },
                    "subcategories": {
                        "traditionnel": { "label": "Traditional" },
                        "rapide": { "label": "Fast food" },
                        "cafe": { "label": "Café / Bar" }
                    }
                },
                "boutique": {
                    "label": "Shops",
                    "marker": { "fill": "#2563eb", "stroke": "#ffffff", "strokeWidth": 2 },
                    "subcategories": {
                        "alimentation": { "label": "Groceries" },
                        "vetements": { "label": "Clothing" },
                        "librairie": { "label": "Bookshop" }
                    }
                }
            }
        }
    }
}
```

> **Icons:** a category can also carry an icon, drawn from an SVG sprite you supply. See
> [recipe 3 of the cookbook](COOKBOOK.md#recipe-3--styling-points-by-category).

---

## Step 6 — config/plugins/cluster.json

Clustering: markers closer than `clusterRadius` pixels merge into one, down to the zoom where
clustering stops.

<!-- geoleaf:docs:module cluster -->

```json
{
    "clustering": true,
    "clusterRadius": 60,
    "disableClusteringAtZoom": 16
}
```

---

## Step 7 — config/plugins/filter.json

The filter panel: a text search over two properties, and the category tree of step 5.

<!-- geoleaf:docs:module filter -->

```json
{
    "enabled": true,
    "title": "Filter businesses",
    "fields": [
        {
            "id": "searchText",
            "kind": "text",
            "label": "Text search",
            "placeholder": "Name, address...",
            "searchFields": ["properties.name", "properties.address"]
        },
        {
            "id": "categories",
            "kind": "taxonomy",
            "taxonomyRef": "commerce-types",
            "label": "Categories",
            "field": "categoryId",
            "subField": "subcategoryId",
            "layers": ["commerces"]
        }
    ]
}
```

---

## Step 8 — config/core/layers.json

List of the profile's layers. `layerManagerId` names the section of the layer manager the layer
is listed in — the section itself is declared in step 12.

<!-- geoleaf:docs:schema layers -->

```json
{
    "layers": [
        {
            "id": "commerces",
            "configFile": "layers/commerces/commerces_config.json",
            "layerManagerId": "commerces-locaux"
        }
    ]
}
```

---

## Step 9 — layers/commerces/commerces_config.json

Detailed layer configuration: data, style, and `attributes` — the one list that says which
property is shown where. Each field names the surfaces it appears on: `tooltip` (hover),
`popup` (click) and `sidepanel` (opened from the popup).

<!-- geoleaf:docs:schema layer-config -->

```json
{
    "id": "commerces",
    "label": "Businesses",
    "geometry": "point",
    "interactiveShape": true,

    "data": {
        "directory": "data",
        "file": "commerces.geojson"
    },

    "styles": {
        "directory": "styles",
        "default": "defaut.json",
        "available": [{ "id": "defaut", "label": "Default", "file": "defaut.json" }]
    },

    "attributes": {
        "titleField": "properties.name",
        "fields": [
            {
                "field": "properties.name",
                "label": "Name",
                "primitive": "string",
                "widget": "text",
                "display": {
                    "surfaces": ["tooltip", "popup", "sidepanel"],
                    "presentation": { "emphasis": "title" }
                }
            },
            {
                "field": "properties.categoryId",
                "label": "Type",
                "primitive": "string",
                "widget": "badge",
                "display": { "surfaces": ["popup", "sidepanel"] }
            },
            {
                "field": "properties.address",
                "label": "Address",
                "primitive": "string",
                "widget": "text",
                "display": { "surfaces": ["popup", "sidepanel"] }
            },
            {
                "field": "properties.opening_hours",
                "label": "Opening hours",
                "primitive": "string",
                "widget": "text",
                "display": { "surfaces": ["sidepanel"] }
            },
            {
                "field": "properties.website",
                "label": "Website",
                "primitive": "string",
                "widget": "link",
                "display": { "surfaces": ["sidepanel"] }
            }
        ]
    },

    "clustering": {
        "enabled": true,
        "maxClusterRadius": 60,
        "disableClusteringAtZoom": 16
    }
}
```

---

## Step 10 — layers/commerces/styles/defaut.json

How a business is drawn when its category sets no marker of its own. The layer config of
step 9 names this file; without it the layer has no style to load.

<!-- geoleaf:docs:schema style -->

```json
{
    "id": "defaut",
    "label": "Default",
    "style": {
        "shape": "circle",
        "radius": 7,
        "fillColor": "#64748b",
        "fillOpacity": 1,
        "color": "#ffffff",
        "opacity": 1,
        "weight": 2
    }
}
```

---

## Step 11 — layers/commerces/data/commerces.geojson

Sample GeoJSON data:

```json
{
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "id": "001",
            "geometry": { "type": "Point", "coordinates": [2.3522, 48.8566] },
            "properties": {
                "name": "The Little Bistro",
                "categoryId": "restaurant",
                "subcategoryId": "traditionnel",
                "address": "10 rue de Rivoli, Paris",
                "opening_hours": "Mon-Fri 12pm-2:30pm / 7pm-10pm",
                "website": "https://example.com"
            }
        },
        {
            "type": "Feature",
            "id": "002",
            "geometry": { "type": "Point", "coordinates": [2.3545, 48.858] },
            "properties": {
                "name": "Dupont Bakery",
                "categoryId": "boutique",
                "subcategoryId": "alimentation",
                "address": "5 rue du Temple, Paris",
                "opening_hours": "Open daily 7am-8pm"
            }
        }
    ]
}
```

---

## Step 12 — config/core/ui.json

Theme, language, and the layer manager with the section the layer of step 8 is listed in.

<!-- geoleaf:docs:schema ui -->

```json
{
    "ui": {
        "theme": "auto",
        "language": "en",
        "showLayerManager": true
    },
    "layerManagerConfig": {
        "title": "Layers",
        "sections": [{ "id": "commerces-locaux", "label": "Local businesses", "order": 1 }]
    }
}
```

`"theme": "auto"` follows the system's light or dark setting. The permalink needs no key: it is
on by default, and `modules.permalink` configures it.

---

## Step 13 — config/core/basemaps.json

Available basemaps.

<!-- geoleaf:docs:schema basemaps -->

```json
{
    "basemaps": {
        "osm": {
            "id": "osm",
            "label": "OpenStreetMap",
            "type": "tile",
            "url": "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "attribution": "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors",
            "subdomains": "abc",
            "maxZoom": 19,
            "defaultBasemap": true
        },
        "satellite": {
            "id": "satellite",
            "label": "Satellite",
            "type": "tile",
            "url": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            "attribution": "Tiles © Esri",
            "maxZoom": 19
        }
    }
}
```

---

## Final result

The project should now look like this:

```
my-project/
├── index.html
├── geoleaf.config.json
└── profiles/
    └── commerces/
        ├── profile.json
        ├── config/
        │   ├── core/
        │   │   ├── layers.json
        │   │   ├── basemaps.json
        │   │   └── ui.json
        │   └── plugins/
        │       ├── taxonomy.json
        │       ├── cluster.json
        │       └── filter.json
        └── layers/
            └── commerces/
                ├── commerces_config.json
                ├── styles/
                │   └── defaut.json
                └── data/
                    └── commerces.geojson
```

Start a local server:

```bash
npx serve . -p 3000
# → http://localhost:3000
```

The map opens on the two businesses merged into one cluster. Zoom in and each takes the colour
of its category. Hovering a business shows its name; a click opens the popup, and the link at
the bottom of the popup opens the side panel, with the opening hours and the website. The
filter panel offers the text search and the category tree, the layer manager lists the layer
under its section, and the URL follows the map position.

---

## Going further

| Goal                                         | Document                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| Add complex GeoJSON layers (polygons, lines) | [GEOJSON_LAYERS_GUIDE.md](geojson/GEOJSON_LAYERS_GUIDE.md)             |
| Configure the filters in detail              | [API_REFERENCE.md](API_REFERENCE.md#filter--the-filter-panel-singular) |
| Reading guide of the profile keys            | [PROFILE_JSON_REFERENCE.md](PROFILE_JSON_REFERENCE.md)                 |
| Vector tiles (MVT)                           | [MVT_GUIDE.md](geojson/MVT_GUIDE.md)                                   |
| Add a sortable data table                    | `@geoleaf-plugins/table` — its README covers `modules.table`           |
| Enable the offline cache (Storage plugin)    | [PLUGIN_CONFIGURATION_GUIDE.md](PLUGIN_CONFIGURATION_GUIDE.md)         |
| Backend API authentication                   | `docs/CONNECTOR_GUIDE.md` in `@geoleaf-plugins/connector`              |
| Contribute a plugin to the repository        | [PLUGIN_DEVELOPMENT_GUIDE.md](PLUGIN_DEVELOPMENT_GUIDE.md)             |
