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

- A GeoJSON layer of businesses (restaurants, shops)
- Marker clustering
- Text search plus a category filter
- Light/dark theme
- Permalink (state carried in the URL)

---

## Project structure

```
my-project/
├── index.html
├── geoleaf.config.json          ← global config (active profile, PWA)
└── profiles/
    └── commerces/
        ├── profile.json                    ← map, modules; its `Files` key points to the rest
        ├── config/
        │   ├── core/
        │   │   ├── layers.json             ← layer list
        │   │   ├── basemaps.json           ← basemaps
        │   │   └── ui.json                 ← UI controls, filters, theme
        │   └── plugins/
        │       ├── taxonomy.json           ← categories and icons
        │       └── cluster.json            ← clustering
        └── layers/
            └── commerces/
                ├── commerces_config.json   ← detailed layer config
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
    href="https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf-main.min.css"
/>
<script type="module">
    import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.mjs";
    globalThis.maplibregl = maplibregl;
</script>
<script
    type="module"
    src="https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf.esm.js"
></script>
```

::: info

MapLibre is **ESM-only since v6**: it no longer exposes a global, hence the two-line shim above.
In production, prefer self-hosting — see [`GETTING_STARTED.md`](GETTING_STARTED.md).

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
            href="https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf-main.min.css"
        />
        <style>
            body {
                margin: 0;
            }
            #map {
                height: 100vh;
                width: 100%;
            }
        </style>
    </head>
    <body>
        <div id="map"></div>

        <script type="module">
            import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.mjs";
            globalThis.maplibregl = maplibregl;
        </script>
        <script
            type="module"
            src="https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf.esm.js"
        ></script>
        <script type="module">
            // Full init with a profile
            GeoLeaf.init({
                map: { target: "map" },
                data: {
                    activeProfile: "commerces",
                    profilesBasePath: "./profiles/",
                },
            });
            GeoLeaf.boot();
        </script>
    </body>
</html>
```

> **Note:** `GeoLeaf.init()` is the high-level API for a full initialisation with a profile. For a simple map without a profile, use `Core.init({ mapId: "map", center: [48.8566, 2.3522], zoom: 12 })`.

---

## Step 3 — geoleaf.config.json

Global config at the project root. Sets the active profile and the global options.

```json
{
    "data": {
        "activeProfile": "commerces",
        "profilesBasePath": "./profiles"
    },
    "pwa": {
        "name": "Local Businesses",
        "short_name": "Businesses",
        "theme_color": "#2563eb",
        "background_color": "#ffffff",
        "installPrompt": { "enabled": false }
    }
}
```

---

## Step 4 — profile.json

Main profile config: geographic extent, clustering, modules.

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
            "cluster": "config/plugins/cluster.json"
        }
    }
}
```

---

## Step 5 — config/plugins/taxonomy.json

Defines the POI categories, their icons and subcategories.

```json
{
    "icons": {
        "defaultIcon": "commerce-generic"
    },
    "defaults": {
        "icon": "commerce-generic"
    },
    "categories": {
        "restaurant": {
            "label": "Restaurants",
            "icon": "food-restaurant",
            "subcategories": {
                "traditionnel": { "label": "Traditional", "icon": "food-restaurant" },
                "rapide": { "label": "Fast food", "icon": "food-fast" },
                "cafe": { "label": "Café / Bar", "icon": "food-cafe" }
            }
        },
        "boutique": {
            "label": "Shops",
            "icon": "commerce-shop",
            "subcategories": {
                "alimentation": { "label": "Groceries", "icon": "commerce-grocery" },
                "vetements": { "label": "Clothing", "icon": "commerce-clothing" },
                "librairie": { "label": "Bookshop", "icon": "commerce-book" }
            }
        }
    }
}
```

> **Icons:** GeoLeaf uses an SVG sprite. Replace the `icon` values with the identifiers of your own sprite, or use the icons of the tourism profile supplied in `profiles/tourism/icons/`.

---

## Step 6 — config/core/layers.json

List of the profile's GeoJSON layers.

```json
{
    "layers": [
        {
            "id": "commerces",
            "configFile": "layers/commerces/commerces_config.json",
            "layerManagerId": "commerces-locaux",
            "visible": true
        }
    ]
}
```

---

## Step 7 — layers/commerces/commerces_config.json

Detailed layer configuration: data, styles, popup, table.

```json
{
    "id": "commerces",
    "label": "Businesses",
    "geometry": "point",
    "interactiveShape": true,
    "showIconsOnMap": true,

    "data": {
        "directory": "data",
        "file": "commerces.geojson"
    },

    "styles": {
        "directory": "styles",
        "default": "defaut.json",
        "available": [{ "id": "defaut", "label": "Default", "file": "defaut.json" }]
    },

    "tooltip": {
        "mode": "hover",
        "fields": [{ "type": "text", "field": "properties.name" }]
    },

    "popup": {
        "enabled": true,
        "fields": [
            { "type": "text", "field": "properties.name", "variant": "title" },
            { "type": "badge", "label": "Type", "field": "properties.categoryId" },
            { "type": "text", "label": "Address", "field": "properties.address" }
        ]
    },

    "sidepanelConfig": {
        "enabled": true,
        "detailLayout": [
            {
                "type": "badge",
                "label": "Category",
                "field": "properties.categoryId",
                "accordion": false
            },
            {
                "type": "text",
                "label": "Name",
                "field": "properties.name",
                "style": "title",
                "accordion": false
            },
            {
                "type": "text",
                "label": "Address",
                "field": "properties.address",
                "accordion": false
            },
            {
                "type": "text",
                "label": "Opening hours",
                "field": "properties.opening_hours",
                "accordion": true,
                "defaultOpen": true
            },
            {
                "type": "link",
                "label": "Website",
                "field": "properties.website",
                "accordion": false
            }
        ]
    },

    "table": {
        "enabled": true,
        "columns": [
            { "field": "properties.name", "label": "Name", "sortable": true, "width": "40%" },
            {
                "field": "properties.categoryId",
                "label": "Category",
                "sortable": true,
                "width": "30%"
            },
            { "field": "properties.address", "label": "Address", "sortable": false, "width": "30%" }
        ],
        "searchFields": ["properties.name"],
        "defaultSort": { "field": "properties.name", "order": "asc" }
    },

    "clustering": {
        "enabled": true,
        "maxClusterRadius": 60,
        "disableClusteringAtZoom": 16
    }
}
```

---

## Step 8 — layers/commerces/data/commerces.geojson

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

## Step 9 — config/core/ui.json

Visible UI controls, search filters, theme, permalink.

```json
{
    "ui": {
        "theme": "auto",
        "language": "en",
        "showLayerManager": true,
        "showFilterPanel": true,
        "showLegend": true,
        "enableGeolocation": true,
        "showCoordinates": false,
        "showCacheButton": false,
        "permalink": {
            "enabled": true,
            "mode": "hash"
        }
    },
    "search": {
        "title": "Filter businesses",
        "searchPlaceholder": "Search for a business...",
        "filters": [
            {
                "id": "searchText",
                "type": "search",
                "label": "Text search",
                "placeholder": "Name, address...",
                "searchFields": ["properties.name", "properties.address"]
            },
            {
                "id": "categories",
                "type": "tree",
                "label": "Categories"
            },
            {
                "id": "proximity",
                "type": "proximity",
                "label": "Proximity",
                "instructionText": "Click the map to set a radius"
            }
        ]
    }
}
```

::: info

The `ui.showTable` flag has moved to `modules.table.showButton` (MIT plugin
`@geoleaf-plugins/table`). See the plugin README for the configuration (`modules.table.*`) and
for the migration.

:::

---

## Step 10 — config/core/basemaps.json

Available basemaps.

```json
{
    "basemaps": {
        "osm": {
            "label": "OpenStreetMap",
            "type": "tile",
            "url": "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "attribution": "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors",
            "subdomains": "abc",
            "maxZoom": 19,
            "defaultBasemap": true
        },
        "satellite": {
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
        │       └── cluster.json
        └── layers/
            └── commerces/
                ├── commerces_config.json
                └── data/
                    └── commerces.geojson
```

Start a local server:

```bash
npx serve . -p 3000
# → http://localhost:3000
```

The map shows the businesses clustered, with a filter panel (search + categories + proximity), a data table, and a live permalink in the URL.

---

## Going further

| Goal                                         | Document                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| Add complex GeoJSON layers (polygons, lines) | [GEOJSON_LAYERS_GUIDE.md](geojson/GEOJSON_LAYERS_GUIDE.md)             |
| Configure the filters in detail              | [API_REFERENCE.md](API_REFERENCE.md#filter--the-filter-panel-singular) |
| Complete reference of the profile keys       | [PROFILES_GUIDE.md](PROFILES_GUIDE.md)                                 |
| Exhaustive JSON reference                    | [PROFILE_JSON_REFERENCE.md](PROFILE_JSON_REFERENCE.md)                 |
| Vector tiles (MVT)                           | [MVT_GUIDE.md](geojson/MVT_GUIDE.md)                                   |
| Enable the offline cache (Storage plugin)    | [PLUGIN_CONFIGURATION_GUIDE.md](PLUGIN_CONFIGURATION_GUIDE.md)         |
| Backend API authentication                   | `docs/CONNECTOR_GUIDE.md` in `@geoleaf-plugins/connector`              |
| Develop a custom plugin                      | [PLUGIN_DEVELOPMENT_GUIDE.md](PLUGIN_DEVELOPMENT_GUIDE.md)             |
