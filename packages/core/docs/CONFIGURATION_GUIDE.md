---
title: "GeoLeaf Configuration Guide"
---

# GeoLeaf Configuration Guide

**Product Version:** GeoLeaf Platform V3
**Version:** 3.0.0
**Last Updated:** avril 2026
**Level:** Intermediate to Advanced

> Version courante : **GeoLeaf v3.0.0**. Structure de profil modulaire avec fichiers séparés `basemaps.json` et `ui.json`.

This comprehensive guide documents all JSON configuration files used by GeoLeaf JS to customize behavior, appearance, and data sources for different business profiles (Tourism, Custom…).

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
geoleaf.config.json              (Racine — optionnel, sélection du profil)
  └── profiles/
      └── {profile-name}/        (layout v2 — 2026-06)
          ├── profile.json       (REQUIS — identité + map + manifeste Files)
          ├── config/
          │   ├── core/
          │   │   ├── basemaps.json   (REQUIS — sources de tuiles)
          │   │   ├── ui.json         (REQUIS — contrôles UI)
          │   │   ├── layers.json     (REQUIS — liste des couches)
          │   │   ├── taxonomy.json   (REQUIS — catégories & icônes POI)
          │   │   ├── themes.json     (REQUIS — préréglages de visibilité)
          │   │   └── features.json   (Optionnel — clustering, géocodage, performance, POI)
          │   └── plugins/
          │       └── {module-id}.json (Optionnel — config par plugin, bloc modules.<id>)
          └── layers/            (Optionnel — configs & données GeoJSON)
              └── {layer-id}/
                  ├── {layer-id}_config.json
                  └── styles/
                      ├── defaut.json
                      └── *.json
```

> Les chemins des fichiers de configuration sont déclarés dans le manifeste `Files` de
> `profile.json` — seuls le nom et l'emplacement de `profile.json` sont imposés.

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
        "text": "Mon Application",
        "position": "bottom-left"
    },
    "security": {
        "httpsOnly": false
    }
}
```

### Field Reference

#### `debug` (boolean, optional)

Active le logging verbeux dans la console. Valeur par défaut : `false`.

```json
{ "debug": true }
```

Pour contrôler le niveau de log, utilisez la section `logging` :

```json
{
    "logging": {
        "level": "debug"
    }
}
```

Niveaux disponibles : `"debug"`, `"info"`, `"warn"`, `"error"`, `"production"`.

#### `branding` (object, optional)

Overlay de branding affiché sur la carte.

| Champ      | Type    | Description                                  |
| ---------- | ------- | -------------------------------------------- |
| `enabled`  | boolean | Activer l'overlay. Défaut `false`.           |
| `text`     | string  | Texte affiché.                               |
| `position` | string  | Position sur la carte (ex. `"bottom-left"`). |

#### `security` (object, optional)

| Champ       | Type    | Description                                                     |
| ----------- | ------- | --------------------------------------------------------------- |
| `httpsOnly` | boolean | Rejette les URLs `http:` (sauf images `data:`). Défaut `false`. |

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

| Champ                    | Type    | Défaut  | Description                                     |
| ------------------------ | ------- | ------- | ----------------------------------------------- |
| `maxConcurrentLayers`    | number  | `10`    | Nombre maximum de couches chargées en parallèle |
| `layerLoadDelay`         | number  | `200`   | Délai en ms entre chaque chargement de couche   |
| `fitBoundsOnThemeChange` | boolean | `false` | Recadrer la carte lors du changement de thème   |

---

## 3. profile.json - Profile Configuration

**Location:** `profiles/{profile-name}/profile.json`  
**Required:** Yes (each profile must have this file)  
**Purpose:** Define UI, basemaps, file paths, and default settings

### Complete Structure

```json
{
    "id": "my-profile",
    "label": "Mon Profil",
    "description": "Description du profil",
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
| `id`          | string          | ✅       | Unique basemap identifier                                |
| `name`        | string          | ✅       | Display name in UI                                       |
| `url`         | string          | ✅       | Tile URL template with `{z}`, `{x}`, `{y}` placeholders  |
| `attribution` | string          | ✅       | Copyright/attribution HTML                               |
| `maxZoom`     | number          | ❌       | Maximum zoom level (1-20)                                |
| `minZoom`     | number          | ❌       | Minimum zoom level (1-20)                                |
| `default`     | boolean         | ❌       | Whether this is the default basemap                      |
| `tileSize`    | number          | ❌       | Tile size in pixels (default: 256)                       |
| `subdomains`  | `array<string>` | ❌       | Subdomains for load balancing (default: `["a","b","c"]`) |

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

| Champ          | Type   | Requis | Description                                    |
| -------------- | ------ | ------ | ---------------------------------------------- |
| `themesFile`   | string | ✅     | Chemin vers `themes.json`                      |
| `layersFile`   | string | ❌     | Chemin vers `layers.json` (index des couches)  |
| `basemapsFile` | string | ❌     | Chemin vers `basemaps.json` (fonds de carte)   |
| `uiFile`       | string | ❌     | Chemin vers `ui.json` (composants UI)          |
| `mappingFile`  | string | ❌     | Chemin vers `mapping.json` (normalisation POI) |

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
        "language": "fr"
    }
}
```

---

## basemaps.json

**Localisation :** `profiles/{profile-name}/basemaps.json`
**Requis :** Oui (depuis v2.0.0)
**Référencé par :** `profile.json → Files.basemapsFile`

Définit les sources de tuiles disponibles. Chaque entrée est indexée par son ID.

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
            "label": "Carte vectorielle",
            "type": "maplibre",
            "style": "https://cdn.example.com/styles/vector.json",
            "fallbackUrl": "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "defaultBasemap": false
        }
    }
}
```

| Champ            | Type                                                                          | Description                                                                                                                                             |
| ---------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | string                                                                        | Identifiant (miroir de la clé)                                                                                                                          |
| `label`          | string                                                                        | Libellé dans le sélecteur                                                                                                                               |
| `type`           | `"tile"` \| `"maplibre"` \| `"image"` \| `"hillshade"` \| `"wmts"` \| `"wms"` | `"tile"` = raster, `"maplibre"` = vectoriel GL, `"image"` = image géoréférencée, `"hillshade"` = ombrage relief, `"wmts"` = OGC WMTS, `"wms"` = OGC WMS |
| `url`            | string                                                                        | Template URL raster avec `{s}`, `{z}`, `{x}`, `{y}`                                                                                                     |
| `style`          | string                                                                        | URL du style MapLibre GL (type `"maplibre"` uniquement)                                                                                                 |
| `fallbackUrl`    | string                                                                        | URL raster de secours si MapLibre GL indisponible                                                                                                       |
| `tiles`          | string[]                                                                      | Tableau d'URLs explicites (remplace expansion `{s}`)                                                                                                    |
| `subdomains`     | string \| string[]                                                            | Sous-domaines de rotation                                                                                                                               |
| `attribution`    | string                                                                        | Attribution HTML                                                                                                                                        |
| `tileSize`       | number                                                                        | Taille des tuiles en pixels. Défaut `256`.                                                                                                              |
| `defaultBasemap` | boolean                                                                       | Basemap active au démarrage                                                                                                                             |
| `offline`        | boolean                                                                       | Support du cache offline                                                                                                                                |
| `terrain`        | object                                                                        | Configuration terrain 3D (voir [PROFILE_JSON_REFERENCE.md — terrain.\*](PROFILE_JSON_REFERENCE.md#basemapsidterrain-object-optionnel))                  |
| `imageSource`    | object                                                                        | Config image géoréférencée — `type: "image"` uniquement (voir ci-dessous)                                                                               |
| `hillshade`      | object                                                                        | Config ombrage relief — `type: "hillshade"` uniquement (voir ci-dessous)                                                                                |
| `wmts`           | object                                                                        | Config OGC WMTS — `type: "wmts"` uniquement (voir ci-dessous)                                                                                           |
| `wms`            | object                                                                        | Config OGC WMS — `type: "wms"` uniquement (voir ci-dessous)                                                                                             |

### Nouveaux types de basemaps (Sprint 2)

#### type: "image" — image géoréférencée

```json
{
    "basemaps": {
        "plan_cadastral": {
            "id": "plan_cadastral",
            "label": "Plan cadastral",
            "type": "image",
            "attribution": "© Service cadastral",
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

| Champ sous `imageSource` | Type       | Description                                                             |
| ------------------------ | ---------- | ----------------------------------------------------------------------- |
| `url`                    | string     | URL HTTP/HTTPS/data de l'image (obligatoire)                            |
| `coordinates`            | number[][] | 4 coins `[lng, lat]` dans l'ordre NW, NE, SE, SW. Défaut : monde entier |
| `opacity`                | number     | Opacité [0, 1]. Défaut `1`                                              |

#### type: "hillshade" — ombrage du relief

```json
{
    "basemaps": {
        "relief": {
            "id": "relief",
            "label": "Ombrage terrain",
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

| Champ sous `hillshade`  | Type   | Description                                                                     |
| ----------------------- | ------ | ------------------------------------------------------------------------------- |
| `demUrl`                | string | URL template MNT raster-dem (obligatoire)                                       |
| `demEncoding`           | string | Encodage altitude : `"terrarium"`, `"mapbox"`, `"custom"`. Défaut `"terrarium"` |
| `demMaxZoom`            | number | Zoom max de la source DEM. Défaut `15`                                          |
| `shadowColor`           | string | Couleur des ombres. Défaut `"#000000"`                                          |
| `highlightColor`        | string | Couleur des zones éclairées. Défaut `"#ffffff"`                                 |
| `accentColor`           | string | Couleur d'accent (bordures). Défaut `"#000000"`                                 |
| `exaggeration`          | number | Amplitude ombre [0, 1]. Défaut `0.5`                                            |
| `illuminationDirection` | number | Direction de la lumière en degrés. Défaut `335`                                 |
| `illuminationAnchor`    | string | Ancrage lumière : `"viewport"` ou `"map"`. Défaut `"viewport"`                  |

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

| Champ sous `wmts`    | Type   | Description                                                          |
| -------------------- | ------ | -------------------------------------------------------------------- |
| `getCapabilitiesUrl` | string | URL GetCapabilities OGC WMTS (obligatoire)                           |
| `layer`              | string | Identifiant de la couche WMTS. Si absent, première couche du service |
| `tileMatrixSet`      | string | TileMatrixSet à utiliser. Défaut `"GoogleMapsCompatible"`            |
| `format`             | string | Format image. Défaut `"image/png"`                                   |

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

| Champ sous `wms` | Type    | Description                                           |
| ---------------- | ------- | ----------------------------------------------------- |
| `url`            | string  | URL de base du serveur WMS (obligatoire)              |
| `layers`         | string  | Nom(s) de couche(s) séparés par virgule (obligatoire) |
| `version`        | string  | Version WMS. Défaut `"1.3.0"`                         |
| `crs`            | string  | Système de coordonnées. Défaut `"EPSG:3857"`          |
| `format`         | string  | Format image. Défaut `"image/png"`                    |
| `tileSize`       | number  | Taille tuile en pixels. Défaut `256`                  |
| `transparent`    | boolean | Transparence PNG. Défaut `false`                      |
| `styles`         | string  | Style WMS optionnel                                   |

---

## ui.json

**Localisation :** `profiles/{profile-name}/ui.json`
**Requis :** Oui (depuis v2.0.0)
**Référencé par :** `profile.json → Files.uiFile`

Configure la visibilité et le comportement des composants UI. Ces paramètres étaient dans la section `ui` de `profile.json` avant v2.0.0 (toujours supporté en rétrocompat inline).

> ℹ️ **Migration v3 (breaking).** L'ancien drapeau `ui.showThemeSelector` a été **déplacé** vers **`modules.theme-selector.enabled`** (fichier `config/plugins/theme-selector.json`, déclaré dans `profile.json` → `Files.modules`), sur le modèle de `modules.table` / `modules.filter`. **Opt-out** : la barre de thèmes reste active sauf `modules.theme-selector.enabled: false`.

```json
{
    "ui": {
        "theme": "light",
        "language": "fr",
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

| Champ                   | Type                                 | Défaut   | Description                                                                                                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `theme`                 | `"light"` \| `"dark"` \| `"auto"`    | `"auto"` | Thème UI                                                                                                                                                                                                                                                                                               |
| `language`              | string                               | `"fr"`   | Code langue                                                                                                                                                                                                                                                                                            |
| `showBaseLayerControls` | boolean                              | `true`   | Bouton sélecteur de fond de carte                                                                                                                                                                                                                                                                      |
| `showLayerManager`      | boolean                              | `true`   | Panneau de gestion des couches                                                                                                                                                                                                                                                                         |
| `showFilterPanel`       | boolean                              | `true`   | Panneau de filtres/recherche                                                                                                                                                                                                                                                                           |
| `showLegend`            | boolean                              | `true`   | Panneau légende                                                                                                                                                                                                                                                                                        |
| `showGeolocation`       | boolean                              | `true`   | Bouton géolocalisation GPS                                                                                                                                                                                                                                                                             |
| `showCoordinates`       | boolean                              | `true`   | Affichage des coordonnées                                                                                                                                                                                                                                                                              |
| `showScale`             | boolean                              | `true`   | Affichage de la barre d'échelle                                                                                                                                                                                                                                                                        |
| `showCacheButton`       | boolean                              | `false`  | Bouton cache offline (@geoleaf-plugins/offline-ui requis)                                                                                                                                                                                                                                              |
| `permalink.enabled`     | boolean                              | `false`  | Synchronisation état dans l'URL                                                                                                                                                                                                                                                                        |
| `permalink.mode`        | `"hash"` \| `"query"` \| `"compact"` | `"hash"` | Stratégie d'encodage URL                                                                                                                                                                                                                                                                               |
| `permalink.fields`      | string[]                             | toutes   | Facettes **optionnelles** à sérialiser dans l'URL — `layers`, `shownLayers`, `filter`, `categories`, `tags`, `rating`, `theme` (ex : `["layers","theme"]`). La vue (`lat`/`lng`/`zoom`) est **toujours** sérialisée et n'est pas listable. La liste s'applique aux deux encodages, verbeux et compact. |

> **Note : cache offline** — `showCacheButton: true` pré-suppose l’installation du plugin `@geoleaf-plugins/offline-ui` (MIT, npmjs.org) (IndexedDB). Le core `@geoleaf/core` ne fournit qu’un détecteur de connectivité (`offline-detector`). Sans le plugin, le bouton ne s’affiche pas même si l’option est activée.

### searchConfig (objet, optionnel)

Configure le panneau de filtres/recherche (affiché si `ui.showFilterPanel: true`). Dans `ui.json` depuis v2.0.0, cette clé remplace `search` de l'ancien `profile.json` inline.

```json
{
    "searchConfig": {
        "title": "Filtrer",
        "radiusMin": 1,
        "radiusMax": 200,
        "radiusStep": 1,
        "radiusDefault": 10,
        "searchPlaceholder": "Rechercher un POI\u2026",
        "filters": [
            {
                "id": "searchText",
                "type": "search",
                "label": "Recherche textuelle",
                "placeholder": "Rechercher...",
                "searchFields": ["title", "properties.name", "description"]
            },
            {
                "id": "proximity",
                "type": "proximity",
                "label": "Recherche par proximit\u00e9",
                "buttonLabel": "Activer",
                "instructionText": "Cliquez sur la carte pour d\u00e9finir le point central"
            },
            {
                "id": "categories",
                "type": "tree",
                "label": "Cat\u00e9gories"
            },
            {
                "id": "tags",
                "type": "multiselect-tags",
                "label": "Tags",
                "field": "attributes.tags"
            }
        ],
        "actions": {
            "applyLabel": "Appliquer",
            "resetLabel": "R\u00e9initialiser"
        }
    }
}
```

| Champ                | Type   | Description                                      |
| -------------------- | ------ | ------------------------------------------------ |
| `title`              | string | Titre du panneau de filtres                      |
| `radiusMin`          | number | Rayon minimum de la recherche par proximité (km) |
| `radiusMax`          | number | Rayon maximum (km)                               |
| `radiusStep`         | number | Pas du curseur de rayon (km)                     |
| `radiusDefault`      | number | Rayon par défaut (km)                            |
| `searchPlaceholder`  | string | Placeholder du champ de recherche textuelle      |
| `filters`            | array  | Liste des filtres (voir types ci-dessous)        |
| `actions.applyLabel` | string | Libellé du bouton "Appliquer"                    |
| `actions.resetLabel` | string | Libellé du bouton "Réinitialiser"                |

**Types de filtre disponibles (`filters[].type`) :**

| Type                 | Description                                     |
| -------------------- | ----------------------------------------------- |
| `"search"`           | Champ de recherche textuelle libre              |
| `"proximity"`        | Filtre géographique par rayon autour d'un point |
| `"tree"`             | Arbre de sélection hiérarchique (catégories)    |
| `"multiselect-tags"` | Sélection multiple par tags                     |
| `"select"`           | Liste déroulante (valeur unique)                |
| `"range"`            | Curseur de plage numérique                      |

### tableConfig (objet, optionnel)

> ℹ️ Le tableau de données a été extrait du core vers le plugin MIT `@geoleaf-plugins/table`. Voir le README du plugin pour l'installation, la configuration (`modules.table.*`) et la migration.

### scaleConfig (objet, optionnel)

Configure l'affichage de l'échelle (activé si `ui.showScale: true`).

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

| Champ                  | Type    | Défaut         | Description                                                   |
| ---------------------- | ------- | -------------- | ------------------------------------------------------------- |
| `scaleGraphic`         | boolean | `true`         | Affiche la barre d'échelle graphique                          |
| `scaleNumeric`         | boolean | `true`         | Affiche la valeur numérique de l'échelle                      |
| `scaleNumericEditable` | boolean | `true`         | Permet la saisie manuelle d'une valeur d'échelle              |
| `scaleNivel`           | boolean | `true`         | Affiche le niveau de zoom numérique                           |
| `position`             | string  | `"bottomleft"` | Position : `bottomleft`, `bottomright`, `topleft`, `topright` |

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
            "label": "Activités",
            "icon": "activity-generic",
            "subcategories": {
                "randonnee": {
                    "label": "Randonnée",
                    "icon": "activity-mountain"
                },
                "velo": {
                    "label": "Vélo",
                    "icon": "activity-vehicle"
                }
            }
        },
        "hebergement": {
            "label": "Hébergements",
            "icon": "lodging-hotel",
            "subcategories": {
                "hotel": {
                    "label": "Hôtel",
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
                    "label": "Musée",
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

Configuration du sprite SVG pour les icônes POI (format MapLibre GL JS).

| Field          | Type   | Required | Description                                                            |
| -------------- | ------ | -------- | ---------------------------------------------------------------------- |
| `spriteUrl`    | string | ✅       | Chemin vers le fichier sprite SVG (relatif au profil)                  |
| `symbolPrefix` | string | ✅       | Préfixe des noms de symboles dans le sprite (ex: `"tourism-poi-cat-"`) |
| `defaultIcon`  | string | ✅       | Identifiant du symbole utilisé en fallback                             |

#### `defaults` (object, optional)

| Field  | Type   | Required | Description                                  |
| ------ | ------ | -------- | -------------------------------------------- |
| `icon` | string | ❌       | Icône par défaut pour les POI sans catégorie |

#### `categories` (object, required)

Définitions des catégories de premier niveau, sous forme d'objet clé→valeur.
Les clés sont les identifiants de catégorie.

| Field           | Type   | Required | Description                           |
| --------------- | ------ | -------- | ------------------------------------- |
| `label`         | string | ✅       | Nom d'affichage de la catégorie       |
| `icon`          | string | ✅       | Identifiant du symbole dans le sprite |
| `subcategories` | object | ❌       | Sous-catégories (objet clé→valeur)    |

#### `subcategories` (object, optional)

Sous-catégories d'une catégorie parente, sous forme d'objet clé→valeur.
Les clés sont les identifiants de sous-catégorie.

| Field   | Type   | Required | Description                                      |
| ------- | ------ | -------- | ------------------------------------------------ |
| `label` | string | ✅       | Nom d'affichage de la sous-catégorie             |
| `icon`  | string | ✅       | Identifiant du symbole (peut différer du parent) |

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
            "label": "Vue par défaut",
            "description": "Vue standard avec les couches principales",
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
            "description": "Zones naturelles et protégées",
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
| `defautTheme`                           | string  | first theme ID       | Identifiant du thème actif au démarrage   |
| `primaryThemes.enabled`                 | boolean | `true`               | Afficher le sélecteur de thèmes primaires |
| `primaryThemes.position`                | string  | `"top-map"`          | Position du contrôle dans l'UI            |
| `secondaryThemes.enabled`               | boolean | `false`              | Activer les thèmes secondaires            |
| `secondaryThemes.showNavigationButtons` | boolean | `false`              | Afficher les boutons de navigation        |
| `secondaryThemes.position`              | string  | `"top-layermanager"` | Position du contrôle secondaire           |

#### `themes` (array, required)

Theme definitions.

| Field         | Type   | Required | Description                                                                         |
| ------------- | ------ | -------- | ----------------------------------------------------------------------------------- |
| `id`          | string | ✅       | Identifiant unique du thème                                                         |
| `label`       | string | ✅       | Nom d'affichage du thème                                                            |
| `description` | string | ❌       | Description affichée dans l'UI                                                      |
| `type`        | string | ✅       | `"primary"` (visible dans le sélecteur) ou `"secondary"` (programmatique)           |
| `icon`        | string | ❌       | Icône (emoji ou identifiant) pour le bouton thème                                   |
| `layers`      | array  | ✅       | Tableau d'entrées `{id, visible, style}` définissant la visibilité de chaque couche |

**Format d'entrée dans `layers` :**

| Field     | Type    | Required | Description                                                          |
| --------- | ------- | -------- | -------------------------------------------------------------------- |
| `id`      | string  | ✅       | Identifiant de la couche (doit correspondre à l'id dans layers.json) |
| `visible` | boolean | ✅       | Visibilité initiale de la couche pour ce thème                       |
| `style`   | string  | ❌       | Variante de style à appliquer (défaut : `"defaut"`)                  |

**Theme types:**

- **primary** — Affiché dans le sélecteur de thèmes, accessible par l'utilisateur
- **secondary** — Masqué dans l'UI, déclenché programmatiquement ou utilisé comme preset

### Layer References

The `layers` object keys **must match** layer IDs defined in:

- Layer directories: `layers/{layerId}/`
- Layer config files: `layers/{layerId}/config.json`
- GeoJSON layer IDs added via `/* GeoLeaf.GeoJSON est interne - configurer via geojsonLayers dans geoleaf.config.json */`

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

**`layers.json` (fichier d'index) :**

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

**Config individuelle (`layers/{layerId}/{layerId}_config.json`) :**

```json
{
    "id": "cities",
    "label": "Villes principales",
    "zIndex": 40,
    "geometry": "point",
    "data": {
        "directory": "data",
        "file": "cities.geojson"
    },
    "styles": {
        "directory": "styles",
        "default": "defaut.json",
        "available": [{ "id": "defaut", "label": "Défaut", "file": "defaut.json" }]
    },
    "table": { "enabled": false },
    "clustering": { "enabled": false }
}
```

### Field Reference

#### `layers.json` — Fichier d'index

| Field            | Type   | Required | Description                                             |
| ---------------- | ------ | -------- | ------------------------------------------------------- |
| `id`             | string | ✅       | Identifiant unique de la couche                         |
| `configFile`     | string | ✅       | Chemin relatif vers la config individuelle de la couche |
| `layerManagerId` | string | ❌       | Identifiant du groupe dans le gestionnaire de couches   |

#### Config individuelle `{layerId}_config.json`

| Field              | Type   | Required | Description                                                                         |
| ------------------ | ------ | -------- | ----------------------------------------------------------------------------------- |
| `id`               | string | ✅       | Identifiant unique (doit correspondre au nom de répertoire)                         |
| `label`            | string | ✅       | Nom d'affichage de la couche                                                        |
| `zIndex`           | number | ❌       | Ordre de rendu (plus élevé = dessiné au-dessus)                                     |
| `geometry`         | string | ✅       | Type géométrique : `"point"`, `"polyline"`, `"polygon"`, `"fill-extrusion"`         |
| `data.directory`   | string | ❌       | Sous-répertoire des données (défaut : `"data"`)                                     |
| `data.file`        | string | ✅       | Fichier GeoJSON (relatif au répertoire de la couche)                                |
| `data.ogcApi`      | object | ❌       | Source OGC API Features (voir ci-dessous). Remplace `data.file` / `data.directory`. |
| `styles.directory` | string | ❌       | Sous-répertoire des styles (défaut : `"styles"`)                                    |

### `data.ogcApi` — Source OGC API Features

Lorsque `data.ogcApi` est défini, la couche est chargée depuis un endpoint OGC API Features REST au lieu d'un fichier statique.

```json
{
    "id": "batiments",
    "label": "Bâtiments IGN",
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

#### Paramètres `data.ogcApi`

| Paramètre             | Type     | Défaut | Description                                                                                  |
| --------------------- | -------- | ------ | -------------------------------------------------------------------------------------------- |
| `url`                 | string   | —      | ✅ URL de l'endpoint (base ou chemin `/items` complet)                                       |
| `collectionId`        | string   | —      | ❌ Identifiant collection OGC — ajouté à `url` si `url` ne se termine pas par `/items`       |
| `bbox`                | number[] | —      | ❌ Filtre bbox `[minLon, minLat, maxLon, maxLat]`. Remplacé par le viewport si `autoRefresh` |
| `maxFeatures`         | number   | 10000  | ❌ Limite totale de features (garde-fou mémoire anti-DoS)                                    |
| `limit`               | number   | 1000   | ❌ Nombre de features par page (`limit` query param)                                         |
| `autoRefresh`         | boolean  | false  | ❌ Re-fetch les features sur chaque événement `moveend` avec le bbox du viewport courant     |
| `autoRefreshDebounce` | number   | 300    | ❌ Debounce des événements `moveend` en ms                                                   |
| `headers`             | object   | —      | ❌ En-têtes HTTP additionnels (ex. `{ "Authorization": "Bearer …" }`)                        |
| `styles.default`      | string   | ✅     | Nom du fichier de style par défaut                                                           |
| `styles.available`    | array    | ❌     | Variantes de style disponibles `{id, label, file}`                                           |
| `table.enabled`       | boolean  | ❌     | Activer le panneau table de données                                                          |
| `clustering.enabled`  | boolean  | ❌     | Activer le clustering (couches de type `point`)                                              |

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
**Purpose:** Mapper les noms de champs externes vers la structure interne de GeoLeaf

### Complete Structure

```json
{
    "source": "description ou endpoint source (informatif)",
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

| Field     | Type   | Required | Description                                                |
| --------- | ------ | -------- | ---------------------------------------------------------- |
| `source`  | string | ❌       | Description ou URL de la source de données (informatif)    |
| `mapping` | object | ✅       | Table de correspondance : `{champGeoLeaf: "champExterne"}` |

**Champs mappables dans `mapping` :**

| Clé GeoLeaf  | Description                                      |
| ------------ | ------------------------------------------------ |
| `id`         | Identifiant unique du POI                        |
| `title`      | Nom du POI                                       |
| `lat`        | Latitude                                         |
| `lng`        | Longitude                                        |
| `categoryId` | Identifiant de catégorie (correspond à taxonomy) |

> Pour le format complet du normaliseur et les options de transformation avancées, voir [data-normalizer.md](config/data-normalizer.md).

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

| Field              | Type    | Required | Description                                                                                                                  |
| ------------------ | ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `enabled`          | boolean | ✅       | Whether labels are supported for this style                                                                                  |
| `visibleByDefault` | boolean | ✅       | Initial label visibility when layer activated (depuis v2.0.0 — voir [Labels documentation](labels/GeoLeaf_Labels_README.md)) |
| `field`            | string  | ❌       | GeoJSON property field to use for label text                                                                                 |
| `format`           | string  | ❌       | Label template with `{fieldName}` placeholders                                                                               |
| `minZoom`          | number  | ❌       | Minimum zoom for label visibility (overrides `labelScale.minZoom`)                                                           |
| `maxZoom`          | number  | ❌       | Maximum zoom for label visibility                                                                                            |

**Note :** `visibleByDefault` doit se trouver dans le fichier de style, pas dans la config de couche. Voir la [documentation Labels](labels/GeoLeaf_Labels_README.md).

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

> **⚠️ The unit is a SCALE DENOMINATOR — the X in `1:X` — not a MapLibre zoom level.** It is the
> same number the `scale` control displays. Writing a zoom level here (`6`, `18`) hides the layer at
> **every** zoom: `1:6` would need a zoom of roughly 27, which MapLibre never reaches. Since v3.0.0
> the validator **rejects** any bound `<= 24`, and rejects the retired `zoomConfig`/`layerScale`
> blocks outright.
>
> **Counter-intuitive but consistent:** `minScale` is the **larger** number. "Min" refers to the
> widest view (the lowest zoom) — and a denominator _grows_ as you zoom out.
>
> Conversion (latitude-dependent): `1:X = 591 658 734 × cos(latitude) / 2^zoom`. At ~4°N:
> zoom 5 ≈ 1:18 444 296 · zoom 6 ≈ 1:9 222 148 · zoom 10 ≈ 1:576 384 · zoom 18 ≈ 1:2 252.

| Field      | Type          | Default | Description                                                                       |
| ---------- | ------------- | ------- | --------------------------------------------------------------------------------- |
| `minScale` | number / null | null    | Widest view allowed (the **larger** denominator). Hidden when zoomed out past it. |
| `maxScale` | number / null | null    | Closest view allowed (the smaller denominator). Hidden when zoomed in past it.    |

_Renamed from `zoomConfig` in v3.0.0, itself a cosmetic rename of `layerScale` in v3.0.0: the name
claimed zoom levels while the engine read denominators, which hid 18 layers for months. The name now
states the unit. `null` or `0` disables a bound._

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

**For fill-extrusion polygons (3D volumes) :**

> Disponible depuis **v2.2.0**. Requiert `geometry: "fill-extrusion"` dans `{layer}_config.json`.

| Field                  | Type           | Required | Description                                                               |
| ---------------------- | -------------- | -------- | ------------------------------------------------------------------------- |
| `fillExtrusionColor`   | string         | ✅       | Couleur des volumes extrudés (hex ou CSS)                                 |
| `fillExtrusionOpacity` | number         | ❌       | Opacité (0–1). Défaut : `1.0`                                             |
| `fillExtrusionHeight`  | number\|string | ✅       | Hauteur en mètres : valeur fixe ou nom de champ feature (ex. `"hauteur"`) |
| `fillExtrusionBase`    | number\|string | ❌       | Hauteur de base en mètres (volumes flottants). Défaut : `0`               |

> `fillExtrusionHeight` et `fillExtrusionBase` acceptent un nom de champ feature (string) — GeoLeaf génère l'expression MapLibre `["get", "hauteur"]` automatiquement. La validation est assurée par `style-validator-extrusion.ts`.

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
| `enabled`  | boolean | ✅       | Whether to display legend |
| `title`    | string  | ❌       | Legend title              |
| `title_fr` | string  | ❌       | Localized title           |
| `items`    | array   | ✅       | Legend item definitions   |

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
| `id`         | string | ✅       | Unique route identifier                                        |
| `name`       | string | ✅       | Route name                                                     |
| `type`       | string | ✅       | Route type: `"walking"`, `"cycling"`, `"driving"`, `"transit"` |
| `distance`   | number | ❌       | Total distance in meters                                       |
| `duration`   | number | ❌       | Estimated duration in seconds                                  |
| `difficulty` | string | ❌       | Difficulty: `"easy"`, `"moderate"`, `"hard"`                   |
| `waypoints`  | array  | ✅       | Array of waypoint objects                                      |
| `path`       | array  | ✅       | Array of `[lat, lng]` coordinates defining the route path      |
| `style`      | object | ❌       | MapLibre GL JS paint options for line/polyline styling         |
| `properties` | object | ❌       | Custom properties                                              |

**Waypoint object:**

| Field          | Type             | Required | Description                                |
| -------------- | ---------------- | -------- | ------------------------------------------ |
| `id`           | string           | ✅       | Waypoint identifier (can reference POI ID) |
| `order`        | number           | ✅       | Stop order (1, 2, 3, ...)                  |
| `latlng`       | [number, number] | ✅       | Coordinates                                |
| `title`        | string           | ✅       | Waypoint name                              |
| `stopDuration` | number           | ❌       | Recommended stop duration in seconds       |

---

## 11. POI Add Feature — `modules.editor.showAddPoi`

> ⚠️ **Réécrite au Sprint 5 (05/08/2026).** Cette section décrivait deux paramètres qui
> n'existent plus : `ui.showAddPoi` et `poiAddConfig.enabled`. Les deux ont été retirés avec la
> fusion du plugin `addpoi` dans `editor`. Les recopier ferait **échouer `npm run
validate:profiles`** — `ui.schema.json` est `additionalProperties: false`.

Le bouton d'ajout de POI est gouverné par **un seul paramètre**, côté plugin :

| Paramètre                   | Emplacement                  | Rôle                                      |
| --------------------------- | ---------------------------- | ----------------------------------------- |
| `modules.editor.showAddPoi` | `config/plugins/editor.json` | Affiche ou masque le bouton dans la barre |

⚠️ **Le défaut a changé de sens** : `ui.showAddPoi` valait `false` (opt-in) ; `modules.editor.showAddPoi`
vaut **`true`** (opt-out), comme les autres créneaux paresseux du plugin.

Il n'y a plus de second niveau : le plugin d'édition se charge **paresseusement** quand le bouton
est actionné, il n'a donc pas à être activé séparément.

```json
{
    "editor": {
        "showAddPoi": true
    }
}
```

**Pour masquer le bouton :**

```json
{
    "editor": {
        "showAddPoi": false
    }
}
```

## 12. geocodingConfig — Address Search

> ⚠️ **Extrait vers un plugin.** La recherche d'adresse (géocodage) n'est plus dans `@geoleaf/core` — elle est désormais fournie par le plugin MIT **`@geoleaf-plugins/geocoding`** (npmjs.org public). La configuration migre de la clé racine **`geocodingConfig`** vers **`modules.geocoding.*`** (déclarée dans `config/plugins/geocoding.json` via `Files.modules.geocoding`) — migration **cassante, sans shim**. L'API `GeoLeaf.Geocoding`, l'événement `geoleaf:geocoding:result` et le contrôle de recherche sont fournis par le plugin. Voir le README du plugin (`packages/plugins/geocoding/README.md`).

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

### Structure historique des labels (v2.0.0)

**⚠️ BREAKING CHANGE:** Label `visibleByDefault` moved from layer config to style files.

**Ancienne structure (label dans la config couche) :**

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

**Structure actuelle (label dans le fichier de style) :**

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

## Identifiant utilisateur pour l'édition POI

`GeoLeaf.Editor` attribue les créations/modifications au champ `modifiedBy`, résolu dans cet ordre de priorité :

1. **Champ de config** `user.id` dans le profil JSON actif
2. **sessionStorage** clé `gl-user-id` (positionné par votre application hôte)
3. **Fallback anonyme** `anonymous-<timestamp>` (cohérent sur la session)

Exemple d'intégration :

```html
<script>
    sessionStorage.setItem("gl-user-id", currentUser.email);
</script>
<script type="module" src="dist/geoleaf.esm.js"></script>
```

Ou via le profil JSON :

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
