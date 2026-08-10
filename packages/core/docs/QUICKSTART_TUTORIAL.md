---
title: "GeoLeaf — Tutoriel : Créer un projet de A à Z"
---

# GeoLeaf — Tutoriel : Créer un projet de A à Z

**S'applique à :** `@geoleaf/core` v3.x
**Durée estimée :** 30–45 minutes
**Résultat :** Un localisateur de commerces locaux avec recherche, filtres et clustering

---

## Ce que vous allez construire

Une carte interactive affichant des commerces locaux avec :

- Couche GeoJSON de commerces (restaurants, boutiques)
- Clustering des marqueurs
- Recherche textuelle + filtre par catégorie
- Thème clair/sombre
- Permalink (état dans l'URL)

---

## Structure du projet

```
mon-projet/
├── index.html
├── geoleaf.config.json          ← config globale (profil actif, PWA)
└── profiles/
    └── commerces/
        ├── profile.json                    ← carte, modules ; sa clé `Files` pointe le reste
        ├── config/
        │   ├── core/
        │   │   ├── layers.json             ← liste des couches
        │   │   ├── basemaps.json           ← fonds de carte
        │   │   └── ui.json                 ← contrôles UI, filtres, thème
        │   └── plugins/
        │       ├── taxonomy.json           ← catégories et icônes
        │       └── cluster.json            ← clustering
        └── layers/
            └── commerces/
                ├── commerces_config.json   ← config détaillée de la couche
                └── data/
                    └── commerces.geojson   ← vos données
```

---

## Étape 1 — Installation

```bash
npm install @geoleaf/core maplibre-gl
```

Ou en CDN :

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

> ℹ️ MapLibre est **ESM-only depuis sa v6** : il n'expose plus de global, d'où le shim de deux
> lignes ci-dessus. En production, préférez l'auto-hébergement — voir
> [`GETTING_STARTED.md`](GETTING_STARTED.md).

---

## Étape 2 — index.html

```html
<!DOCTYPE html>
<html lang="fr">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Commerces locaux</title>
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
            // Init complète avec profil
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

> **Note :** `GeoLeaf.init()` est l'API de haut niveau pour une initialisation complète avec profil. Pour une carte simple sans profil, utilisez `Core.init({ mapId: "map", center: [48.8566, 2.3522], zoom: 12 })`.

---

## Étape 3 — geoleaf.config.json

Config globale à la racine du projet. Définit le profil actif et les options globales.

```json
{
    "data": {
        "activeProfile": "commerces",
        "profilesBasePath": "./profiles"
    },
    "pwa": {
        "name": "Commerces Locaux",
        "short_name": "Commerces",
        "theme_color": "#2563eb",
        "background_color": "#ffffff",
        "installPrompt": { "enabled": false }
    }
}
```

---

## Étape 4 — profile.json

Config principale du profil : emprise géographique, clustering, modules.

```json
{
    "id": "commerces",
    "label": "Commerces locaux",
    "description": "Localisateur de commerces de proximité",
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

## Étape 5 — config/plugins/taxonomy.json

Définit les catégories de POI, leurs icônes et sous-catégories.

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
                "traditionnel": { "label": "Traditionnel", "icon": "food-restaurant" },
                "rapide": { "label": "Restauration rapide", "icon": "food-fast" },
                "cafe": { "label": "Café / Bar", "icon": "food-cafe" }
            }
        },
        "boutique": {
            "label": "Boutiques",
            "icon": "commerce-shop",
            "subcategories": {
                "alimentation": { "label": "Alimentation", "icon": "commerce-grocery" },
                "vetements": { "label": "Vêtements", "icon": "commerce-clothing" },
                "librairie": { "label": "Librairie", "icon": "commerce-book" }
            }
        }
    }
}
```

> **Icônes :** GeoLeaf utilise un sprite SVG. Remplacez les valeurs `icon` par les identifiants de votre propre sprite, ou utilisez les icônes du profil tourism fourni dans `profiles/tourism/icons/`.

---

## Étape 6 — config/core/layers.json

Liste des couches GeoJSON du profil.

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

## Étape 7 — layers/commerces/commerces_config.json

Configuration détaillée de la couche : données, styles, popup, table.

```json
{
    "id": "commerces",
    "label": "Commerces",
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
        "available": [{ "id": "defaut", "label": "Défaut", "file": "defaut.json" }]
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
            { "type": "text", "label": "Adresse", "field": "properties.address" }
        ]
    },

    "sidepanelConfig": {
        "enabled": true,
        "detailLayout": [
            {
                "type": "badge",
                "label": "Catégorie",
                "field": "properties.categoryId",
                "accordion": false
            },
            {
                "type": "text",
                "label": "Nom",
                "field": "properties.name",
                "style": "title",
                "accordion": false
            },
            {
                "type": "text",
                "label": "Adresse",
                "field": "properties.address",
                "accordion": false
            },
            {
                "type": "text",
                "label": "Horaires",
                "field": "properties.opening_hours",
                "accordion": true,
                "defaultOpen": true
            },
            {
                "type": "link",
                "label": "Site web",
                "field": "properties.website",
                "accordion": false
            }
        ]
    },

    "table": {
        "enabled": true,
        "columns": [
            { "field": "properties.name", "label": "Nom", "sortable": true, "width": "40%" },
            {
                "field": "properties.categoryId",
                "label": "Catégorie",
                "sortable": true,
                "width": "30%"
            },
            { "field": "properties.address", "label": "Adresse", "sortable": false, "width": "30%" }
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

## Étape 8 — layers/commerces/data/commerces.geojson

Exemple de données GeoJSON :

```json
{
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "id": "001",
            "geometry": { "type": "Point", "coordinates": [2.3522, 48.8566] },
            "properties": {
                "name": "Le Petit Bistrot",
                "categoryId": "restaurant",
                "subcategoryId": "traditionnel",
                "address": "10 rue de Rivoli, Paris",
                "opening_hours": "Lun-Ven 12h-14h30 / 19h-22h",
                "website": "https://example.com"
            }
        },
        {
            "type": "Feature",
            "id": "002",
            "geometry": { "type": "Point", "coordinates": [2.3545, 48.858] },
            "properties": {
                "name": "Boulangerie Dupont",
                "categoryId": "boutique",
                "subcategoryId": "alimentation",
                "address": "5 rue du Temple, Paris",
                "opening_hours": "Tous les jours 7h-20h"
            }
        }
    ]
}
```

---

## Étape 9 — config/core/ui.json

Contrôles UI visibles, filtres de recherche, thème, permalink.

```json
{
    "ui": {
        "theme": "auto",
        "language": "fr",
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
        "title": "Filtrer les commerces",
        "searchPlaceholder": "Rechercher un commerce...",
        "filters": [
            {
                "id": "searchText",
                "type": "search",
                "label": "Recherche textuelle",
                "placeholder": "Nom, adresse...",
                "searchFields": ["properties.name", "properties.address"]
            },
            {
                "id": "categories",
                "type": "tree",
                "label": "Catégories"
            },
            {
                "id": "proximity",
                "type": "proximity",
                "label": "Proximité",
                "instructionText": "Cliquez sur la carte pour définir un rayon"
            }
        ]
    }
}
```

> ℹ️ Le drapeau `ui.showTable` a migré vers `modules.table.showButton` (plugin MIT `@geoleaf-plugins/table`). Voir le README du plugin pour la configuration (`modules.table.*`) et la migration.

---

## Étape 10 — config/core/basemaps.json

Fonds de carte disponibles.

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

## Résultat final

Votre projet doit ressembler à :

```
mon-projet/
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

Lancez un serveur local :

```bash
npx serve . -p 3000
# → http://localhost:3000
```

Vous verrez une carte avec vos commerces clusterisés, un panneau de filtres (recherche + catégories + proximité), un tableau de données, et un permalien actif dans l'URL.

---

## Aller plus loin

| Objectif                                                  | Document                                                               |
| --------------------------------------------------------- | ---------------------------------------------------------------------- |
| Ajouter des couches GeoJSON complexes (polygones, lignes) | [GEOJSON_LAYERS_GUIDE.md](geojson/GEOJSON_LAYERS_GUIDE.md)             |
| Configurer les filtres en détail                          | [API_REFERENCE.md](API_REFERENCE.md#filter--the-filter-panel-singular) |
| Référence complète des clés de profil                     | [PROFILES_GUIDE.md](PROFILES_GUIDE.md)                                 |
| Référence JSON exhaustive                                 | [PROFILE_JSON_REFERENCE.md](PROFILE_JSON_REFERENCE.md)                 |
| Tuiles vectorielles (MVT)                                 | [MVT_GUIDE.md](geojson/MVT_GUIDE.md)                                   |
| Activer le cache offline (plugin Storage)                 | [PLUGIN_CONFIGURATION_GUIDE.md](PLUGIN_CONFIGURATION_GUIDE.md)         |
| Authentification API backend                              | `docs/CONNECTOR_GUIDE.md` de `@geoleaf-plugins/connector`              |
| Développer un plugin custom                               | [PLUGIN_DEVELOPMENT_GUIDE.md](PLUGIN_DEVELOPMENT_GUIDE.md)             |
