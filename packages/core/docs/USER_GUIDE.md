---
title: "GeoLeaf JS — User Guide"
---

# GeoLeaf JS — User Guide

**Version produit :** GeoLeaf Platform V3

**S'applique à :** `@geoleaf/core` v3.x
**Dernière mise à jour :** mars 2026

**Public cible :** Développeurs intégrant GeoLeaf dans leurs applications

> Convention de versioning : **Platform V3** est le label produit ; le SemVer technique des packages/releases est en **3.0.x**. Voir [VERSIONING_POLICY.md](VERSIONING_POLICY.md).

Ce guide couvre toutes les fonctionnalités de GeoLeaf JS, de l'utilisation basique aux configurations avancées.

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

GeoLeaf JS est une bibliothèque TypeScript de cartographie interactive construite sur **MapLibre GL JS v6** (rendu WebGL, tuiles vectorielles natives). Elle offre une API haut-niveau pour gérer les POIs (Points d'Intérêt), les couches GeoJSON, les thèmes, les filtres et les intégrations de plugins — entièrement configurable via des profils JSON sans développement spécifique côté applicatif.

### Key Features

- **Multi-Profile System** — Profils préconfigurés pour le Tourisme et cas d'usage personnalisés
- **Données de couche** — Lecture / écriture des features via `GeoLeaf.Layers`, quelle que soit la géométrie
- **Theme System** — Thèmes clair/sombre avec présets de visibilité de couches personnalisables
- **GeoJSON Support** — Affichage de polygones, lignes et données géographiques complexes
- **WebGL Rendering** — Rendu GPU via MapLibre GL JS v6 pour les performances
- **Hors-ligne** — Moteur intégré au core (`modules.offline`, IndexedDB), chargé à la demande
- **Label System** — Labels dynamiques avec visibilité basée sur le zoom
- **Advanced Filters** — Filtrage multi-critères avec taxonomies et catégories
- **Symbole du point** — Icônes, teintes et pastilles par catégorie via la capacité `taxonomy`
- **Security** — Protection XSS via les helpers DOM sécurisés

> Le **tableau de données** est désormais fourni par le plugin MIT `@geoleaf-plugins/table`.

### When to Use GeoLeaf

**Cas d'usage appropriés :**

- Applications de cartographie touristique (attractions, hôtels, restaurants)
- Applications immobilières
- Gestion de lieux événementiels
- Portails géographiques avec configuration JSON

**Non recommandé pour :**

- Tracking GPS temps-réel avec mises à jour sub-seconde
- Simulateurs de vol ou navigation 3D avancée
- Applications nécessitant 10 000+ marqueurs simultanés

### Browser Support

| Navigateur     | Version minimum |
| -------------- | --------------- |
| Chrome/Edge    | 90+             |
| Firefox        | 88+             |
| Safari         | 14+             |
| Mobile Safari  | iOS 14+         |
| Chrome Android | 90+             |

**JavaScript requis :** ES2022+ (async/await, Promises, ESM modules)

> MapLibre GL JS v6 nécessite le support WebGL 2.0 (disponible dans tous les navigateurs modernes).

---

## 2. Installation

### Option A : NPM (recommandé pour la production)

```bash
npm install @geoleaf/core maplibre-gl
```

```typescript
import { Core } from "@geoleaf/core";
import "maplibre-gl/dist/maplibre-gl.css";
import "@geoleaf/core/style.css";

Core.init({
    mapId: "map",
    center: [48.8566, 2.3522], // [lat, lng] — GeoLeaf ; MapLibre attend [lng, lat], la conversion est interne
    zoom: 12,
});
```

> **Peer dependency :** `maplibre-gl ^6.0.0` doit être installé séparément.

### Option B : CDN (démarrage rapide)

GeoLeaf v2 distribue exclusivement en **ESM**. Utiliser `<script type="module">` :

```html
<!-- MapLibre GL JS (peer dependency — doit être chargé AVANT GeoLeaf) -->
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

> ⚠️ **Les deux lignes de shim ne sont pas décoratives.** MapLibre est ESM-only depuis sa v6 et
> n'expose plus de global ; `geoleaf.esm.js` le déclare `external` et ne l'atteint que par
> `globalThis.maplibregl`. Sans ce shim, `new maplibregl.Map()` lève et la carte ne boote pas.
> Le bloc étant **en ligne**, il exige `'unsafe-inline'` (ou un nonce/hash) dans `script-src` —
> en production, préférer l'auto-hébergement de l'Option C, dont le shim est un fichier.

Avant `</body>` :

```html
<!-- geoleaf:docs:fragment — suite du bloc de `<head>` ci-dessus, qui porte le shim MapLibre -->
<script type="module">
    import { Core } from "https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf.esm.js";
    Core.init({ mapId: "map", center: [48.8566, 2.3522], zoom: 12 });
</script>
```

Ou via jsDelivr :

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

### Option C : Auto-hébergé

Télécharger depuis les [releases](https://github.com/geoleaf/geoleaf-js/releases) et héberger sur votre serveur :

```html
<!-- MapLibre auto-hébergé : le shim est un FICHIER, donc aucune exception CSP à concéder -->
<link rel="stylesheet" href="/assets/maplibre-gl/maplibre-gl.css" />
<script type="module" src="/assets/maplibre-gl/global.mjs"></script>

<link rel="stylesheet" href="/assets/geoleaf/geoleaf-main.min.css" />
<script type="module">
    import { Core } from "/assets/geoleaf/geoleaf.esm.js";
    Core.init({ mapId: "map", center: [48.8566, 2.3522], zoom: 12 });
</script>
```

Le contenu de `global.mjs` tient en deux lignes — c'est le même shim que ci-dessus, sorti du
document pour qu'il n'exige plus `'unsafe-inline'` :

```javascript
import * as maplibregl from "./maplibre-gl.mjs";
globalThis.maplibregl = maplibregl;
```

### Vérifier l'installation

Ouvrir la console du navigateur :

```javascript
console.log(GeoLeaf.version);
// Should output: "3.0.0"
```

---

## 3. Quick Start

### Exemple minimal

```html
<!DOCTYPE html>
<html lang="fr">
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

            // Une POI est une feature d'une couche de points générique.
            // `GeoLeaf.POI` n'existe plus depuis la v3 — voir CHANGELOG [3.0.0].
            document.addEventListener("geoleaf:app:ready", () => {
                GeoLeaf.Layers.addFeature("ma-couche", {
                    type: "Feature",
                    geometry: { type: "Point", coordinates: [2.3522, 48.8566] },
                    properties: {
                        id: "paris",
                        title: "Paris",
                        description: "Capitale de la France",
                    },
                });
            });
        </script>
    </body>
</html>
```

> **Attention aux coordonnées — les deux ordres coexistent, et c'est voulu :**
> `Core.init({ center })` et `map.center` d'un profil attendent **`[lat, lng]`** ; les
> `coordinates` d'une feature GeoJSON restent **`[lng, lat]`** (standard GeoJSON, que MapLibre
> suit). La conversion vit exclusivement dans l'adaptateur — voir `ARCHITECTURE_GUIDE.md`.

### Tutoriel pas à pas

See [GETTING_STARTED.md](GETTING_STARTED.md) for a detailed 5-minute tutorial.

---

## 4. Understanding Profiles

### What Are Profiles?

Les profils sont des configurations prédéfinies qui définissent :

- **UI layout** (layer manager, filter panel, cache controls)
- **Basemaps** (fonds de carte disponibles — styles MapLibre GL JS)
- **POI configuration** (catégories, icônes, recherche)
- **File paths** (où charger les données JSON)
- **Taxonomy** (hiérarchie de catégories et icônes)
- **Default settings** (zoom, centre, thème initiaux)

### Profils intégrés

#### 4.1 Profil Tourism

**Objectif :** Attractions touristiques, hôtels, restaurants, événements

**Fonctionnalités :**

- 35+ couches préconfigurées (climat, zones de conservation, villes, itinéraires)
- Taxonomie riche avec 50+ catégories (musées, monuments, hôtels, restaurants)
- Sprites d'icônes optimisés pour le tourisme
- Recherche par nom d'attraction, ville ou catégorie

**Configuration :** `profiles/tourism/geoleaf.config.json`

#### 4.2 Profils Personnalisés

Vous pouvez créer des profils pour tout domaine métier. Voir [PROFILES_GUIDE.md](PROFILES_GUIDE.md).

### Switching Profiles

#### À l'initialisation

```javascript
const map = GeoLeaf.init({
    map: { target: "map", center: [48.8, 2.3], zoom: 10 },
    data: {
        activeProfile: "tourism",
        profilesBasePath: "/profiles/",
    },
});
```

#### Charger un profil via URL

```javascript
await GeoLeaf.loadConfig("/profiles/tourism/geoleaf.config.json");
```

**Note :** Le chargement d'un nouveau profil recharge toute la configuration et efface les POIs courants.

---

## 5. Configuration Basics

### 5.1 Fichier de Configuration Principal

Le point d'entrée est `geoleaf.config.json` :

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

**Champs clés :**

- `debug.enabled` — Active le logging console détaillé
- `debug.modules` — Modules à déboguer (ou `["*"]` pour tous)
- `data.activeProfile` — Profil à charger
- `data.profilesBasePath` — Chemin de base vers les répertoires de profils

### 5.2 Fichier de Configuration de Profil

Chaque profil possède un `profile.json` :

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

> **Note v2.0.0 :** Les basemaps utilisent désormais le champ `style` (URL vers un
> style MapLibre GL JS) plutôt qu'un template d'URL de tuiles XYZ.

### 5.3 Configuration de Taxonomie

Définit les catégories, sous-catégories et icônes dans `taxonomy.json` :

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

### 5.4 Configuration des Thèmes

Définit les présets de visibilité de couches dans `themes.json` :

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

### 5.5 Configuration des Styles de Couches

Chaque couche peut avoir plusieurs styles dans `layers/<layer-name>/styles/<style-id>.json` :

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

**Champs clés :**

- `label.enabled` — Si les labels sont supportés pour cette couche
- `label.visibleByDefault` — État initial de visibilité des labels
- `scaleConfig` — Plage de visibilité de la couche, en **dénominateurs d'échelle** (le `X` de `1:X`, ce qu'affiche le contrôle d'échelle) — **pas** en niveaux de zoom. `minScale` est le **plus grand** des deux nombres : il borne la vue la plus large, et un dénominateur augmente quand on dézoome. Une valeur `<= 24` est rejetée (ce serait un niveau de zoom saisi par erreur)
- `labelScale` — Idem pour les labels (même unité), généralement plus étroite
- `style` — Options de style pour la couche
- `legend` — Configuration de la légende

---

## 6. Working with Maps

### 6.1 POI Management

#### Ajout de POIs

> **BREAKING (v3.0.0) — `GeoLeaf.POI` n'existe plus.** Une POI est une **feature de point
> d'une couche GeoJSON ordinaire** : on lit et on écrit ses données via **`GeoLeaf.Layers`**,
> et son symbole est piloté par la capacité `taxonomy`. Les coordonnées suivent la convention
> GeoJSON / MapLibre GL JS : `[longitude, latitude]`.
> Référence complète : [API_REFERENCE.md](API_REFERENCE.md#layers--feature-data).

```javascript
// Ajouter une feature. `layerId` est l'id déclaré dans config/core/layers.json.
GeoLeaf.Layers.addFeature("monuments", {
    type: "Feature",
    geometry: { type: "Point", coordinates: [2.2945, 48.8584] }, // [lng, lat]
    properties: {
        id: "eiffel-tower",
        title: "Eiffel Tower",
        description: "Iconic iron tower",
        categoryId: "monument", // résolu par la capacité taxonomy
        address: "Champ de Mars, Paris",
        website: "https://www.toureiffel.paris",
    },
});

// En ajouter plusieurs : setData remplace le jeu de base en une fois
// (préférable à N appels à addFeature — un seul re-rendu de la source).
GeoLeaf.Layers.setData("monuments", features);
```

#### Rechargement

```javascript
// Remplace toutes les features de la couche
GeoLeaf.Layers.setData("monuments", newFeatures);
```

#### Lecture

```javascript
// Une feature par son id stable
const feature = GeoLeaf.Layers.getFeatureById("monuments", "eiffel-tower");

// Toutes les features de la couche
const all = GeoLeaf.Layers.getFeatures("monuments");

// Combien, et quelles couches existent
const n = GeoLeaf.Layers.getFeatureCount("monuments");
const ids = GeoLeaf.Layers.listLayerIds();
```

> **BREAKING (v3.0.0)** — `GeoLeaf.Filters.filterPoiList` is removed (0 internal
> consumer — roadmap nettoyage Sprint 3). Use the `GeoLeaf.Filter` (singular)
> capability's active panel state instead: `GeoLeaf.Filter.getActiveFilter()` /
> `GeoLeaf.Filter.applyFilter(state)`.

### 6.2 Basemaps

#### Changer de Basemap

```javascript
// Programmatically change basemap
GeoLeaf.Baselayers.setBaseLayer("satellite");

// Get current basemap key
const currentKey = GeoLeaf.Baselayers.getActiveKey();
console.log(currentKey); // "satellite"

// Get current basemap object
const currentLayer = GeoLeaf.Baselayers.getActiveLayer();
```

#### Basemaps Personnalisés

Ajouter dans `profile.json` :

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

#### Basemaps 3D avec terrain

Activer le relief 3D en ajoutant un objet `terrain` dans la définition du basemap (`basemaps.json`) :

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

> **`default3D: true`** — Le terrain est activé automatiquement dès que ce basemap est sélectionné. Il n'y a pas de toggle UI : le passage vers un basemap sans terrain désactive automatiquement le relief 3D.

> **`map.maxPitch`** — La valeur par défaut MapLibre est 60°. GeoLeaf monte le plafond à 80° par défaut. Configurable via `profile.json > map.maxPitch`.

#### Couches 3D — Polygones extrudés (fill-extrusion)

> Disponible depuis **v2.2.0**

Les couches de type `fill-extrusion` permettent de représenter des polygones GeoJSON sous forme de volumes 3D (bâtiments, densité, données statistiques). Le rendu est assuré par le moteur WebGL de MapLibre GL JS.

**Cas d'usage typiques :**

- Modèles de bâtiments avec hauteur réelle ou relative
- Visualisation de données statistiques surfaciques (densité, revenus, votes…)
- Zones réglementaires ou de risque avec indicateur visuel 3D

**Configuration `{layer}_config.json` :**

```json
{
    "id": "batiments",
    "label": "Bâtiments 3D",
    "geometry": "fill-extrusion",
    "interactiveShape": true,
    "data": { "dataUrl": "https://..." }
}
```

**Fichier de style associé :**

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

> `fillExtrusionHeight` accepte une **valeur numérique fixe** (mètres) ou le **nom d'un champ feature** — GeoLeaf génère alors l'expression MapLibre `["get", "hauteur"]` automatiquement.

> **Performances GPU** — Le rendu fill-extrusion est accéléré par WebGL. Les performances restent optimales jusqu'à ~10 000 polygones extrudés simultanément aux niveaux de zoom ≥ 14.

### 6.3 GeoJSON Layers

Les couches GeoJSON sont configurées via le profil (`geojsonLayers` dans `geoleaf.config.json`).
La visibilité des couches est gérée via le panneau LayerManager (UI).

```javascript
// Initialize the layer manager control on the map (kernel — nothing to load first)
GeoLeaf.LayerManager.init({ map });

// Refresh the layer manager display
GeoLeaf.LayerManager.refresh();
```

### 6.4 Themes

#### Thème UI (clair/sombre)

Pour le thème d'interface (clair/sombre), utiliser `Core.setTheme` :

```javascript
GeoLeaf.Core.setTheme("dark");
const current = GeoLeaf.Core.getTheme(); // "dark"
```

### 6.5 Labels

Les labels sont une **capacité in-core** (`modules.labels`), configurée via les fichiers de style
de couche (champ `label`). Elle est dans le bundle — rien à charger. La visibilité des labels est
gérée automatiquement via le panneau LayerManager (bouton toggle par couche), et la capacité se
désactive dans le profil (`modules.labels.enabled: false`).

La configuration des labels se fait dans le fichier de style de la couche (voir section 5.5).

---

## 7. UI Components

### 7.1 Layer Manager

**Objectif :** Contrôle de la visibilité des couches (catégories POI, couches GeoJSON)

**Configuration dans profile.json :**

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

**Contrôle programmatique :**

```javascript
GeoLeaf.LayerManager.init({ map });
GeoLeaf.LayerManager.refresh();
```

### 7.2 Filter Panel

**Objectif :** Filtrage des POIs par critères multiples

**Configuration :**

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

**Filtrage programmatique :**

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

**Objectif :** Recherche de POIs par nom, catégorie ou adresse

**Configuration :**

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

> **BREAKING (v3.0.0) — `GeoLeaf.Search` n'existe plus.** Le moteur full-text (`flexsearch`)
> était **dormant** : aucun profil ne l'activait et son index ne se construisait jamais. Il a
> été retiré, avec sa dépendance npm. La recherche textuelle **réelle** de l'interface — le
> champ « Rechercher… » du panneau Filtrer — est assurée par la capacité in-core **`filter`**
> (`kind: "text"`), et elle est désormais **insensible aux accents et à l'ordre des mots**.
> Aucune action pour l'UI ; un intégrateur qui appelait `GeoLeaf.Search.query()` par script
> doit implémenter sa propre recherche ou indexer côté serveur.

**Utilisation programmatique :**

```javascript
// Lire l'état du panneau de filtre (dont le champ texte), sérialisable
const state = GeoLeaf.Filter.getActiveFilter();

// Appliquer un état de filtre sans passer par le DOM
GeoLeaf.Filter.applyFilter(state);

// Un filtre est-il actif ?
if (GeoLeaf.Filter.hasActiveFilters()) {
    GeoLeaf.Filter.reset();
}
```

### 7.4 Cache Controls

**Objectif :** Gestion du cache hors-ligne (stockage IndexedDB) via le plugin Storage.

> **Note :** les fonctionnalités de cache hors-ligne nécessitent le plugin `@geoleaf-plugins/offline-ui` (MIT, npmjs.org) — elles ne sont pas dans le bundle core.

L'API de cache est fournie par le plugin Storage. Consultez la documentation du plugin pour l'intégration.

```javascript
// Verify the storage plugin is available
if (GeoLeaf.plugins.isLoaded("storage")) {
    // Storage plugin API is available via GeoLeaf.Storage
    console.log("Storage plugin ready");
}
```

### 7.5 Notifications

```javascript
GeoLeaf.Notifications.success("POI ajouté avec succès !");
GeoLeaf.Notifications.error("Échec du chargement des données");
GeoLeaf.Notifications.warning("Connexion instable");
GeoLeaf.Notifications.info("Chargement en cours...");
GeoLeaf.Notifications.success("Sauvegardé", { duration: 2000 });

GeoLeaf.Notifications.notify("Message personnalisé", "info", 5000);

// Clear all visible notifications
GeoLeaf.Notifications.clearAll();

// Get current notification system status
const status = GeoLeaf.Notifications.getStatus();
```

### 7.6 Address Search (Geocoding)

> ⚠️ **Extrait vers un plugin.** La recherche d'adresse (géocodage) n'est plus dans `@geoleaf/core` — elle est désormais fournie par le plugin MIT **`@geoleaf-plugins/geocoding`** (npmjs.org public). La configuration migre de la clé racine **`geocodingConfig`** vers **`modules.geocoding.*`** (déclarée dans `config/plugins/geocoding.json` via `Files.modules.geocoding`) — migration **cassante, sans shim**. L'API `GeoLeaf.Geocoding`, l'événement `geoleaf:geocoding:result` et le contrôle de recherche sont fournis par le plugin. Voir le README du plugin (`packages/plugins/geocoding/README.md`).

---

### 7.7 Responsive & Mobile Interface

GeoLeaf embarque une interface entièrement responsive qui s'adapte à toutes les tailles d'écran — du smartphone au grand desktop — sans configuration supplémentaire.

#### Breakpoints

| Plage          | Appareils               | Comportement                                                 |
| -------------- | ----------------------- | ------------------------------------------------------------ |
| ≤ 768 px       | Smartphone, tablette 6" | **Mode mobile** — pill toolbar (côté gauche), sheets overlay |
| 769 – 1 024 px | PC 10" / petit laptop   | Layout desktop, panneau latéral **360 px**                   |
| ≥ 1 025 px     | PC 13"+                 | Layout desktop, panneau latéral **420 px**                   |

Les valeurs de seuil sont exposées comme variables CSS dans `geoleaf-theme.css` (`:root`) :

```css
--gl-bp-sm: 480px; /* smartphone    */
--gl-bp-md: 640px; /* phablet       */
--gl-bp-lg: 768px; /* tablet 6" / mobile threshold */
--gl-bp-xl: 1024px; /* PC 10"        */
```

#### Mobile pill toolbar (≤ 768 px)

Sur les viewports étroits, les contrôles desktop standard sont remplacés par une **barre d'icônes en forme de pilule** ancrée au côté gauche de la carte.

| Icône       | Action                                                               |
| ----------- | -------------------------------------------------------------------- |
| Fullscreen  | Basculer le mode plein écran                                         |
| Legend      | Afficher/masquer la légende                                          |
| Zoom + / −  | Zoom carte                                                           |
| My location | Basculer la géolocalisation                                          |
| Search      | Ouvrir la feuille de recherche                                       |
| Proximity   | Activer le mode recherche de proximité                               |
| Filters     | Ouvrir la feuille de filtres. Indicateur **Reset** si filtres actifs |
| Themes      | Ouvrir la feuille de sélection de thèmes                             |
| Layers      | Ouvrir la feuille du gestionnaire de couches                         |
| Table       | Ouvrir la feuille du tableau de données                              |

#### Sheet overlay

Chaque panneau utilise un **bottom sheet** overlay (`role="dialog"`, `aria-modal="true"`, `aria-labelledby`). Support :

- Tap sur le fond sombre pour fermer
- Touche **Escape** pour fermer
- Focus trap complet : Tab/Shift-Tab restent dans la feuille
- Focus retourné au bouton déclencheur à la fermeture

#### Viewport meta tag

Assurez-vous que votre page HTML inclut :

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
```

Ne pas utiliser `user-scalable=no` — cela bloque le pinch-zoom et nuit à l'accessibilité.

---

## 8. Advanced Topics

### 8.1 Custom Profiles

Créer votre propre profil en copiant la structure d'un profil existant :

```
profiles/
  my-custom-profile/
    geoleaf.config.json    # Optionnel, utilise la config racine si absent
    profile.json           # Requis
    taxonomy.json          # Requis
    themes.json            # Requis
    layers/                # Optionnel, pour les couches GeoJSON
    data/                  # Vos fichiers de données POI
```

### 8.2 OGC API Features

GeoLeaf supporte nativement le chargement de couches depuis un endpoint **OGC API Features** (successeur REST/JSON du WFS classique).

**Configuration minimale :**

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

**Avec auto-refresh viewport :**

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

Lorsque `autoRefresh: true`, GeoLeaf re-charge les données à chaque fin de déplacement/zoom de la carte en passant le bbox courant du viewport. Cela permet d'afficher uniquement les données visibles sans pré-charger l'intégralité du dataset.

**Avec authentification :**

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

**Via `GeoLeaf.Utils.wktToGeoJSON()` :**

Si un endpoint OGC API Features retourne des géométries au format WKT (certaines implémentations non-conformes), GeoLeaf les convertit automatiquement. La fonction est aussi disponible publiquement :

```javascript
const geom = GeoLeaf.Utils.wktToGeoJSON("POINT(2.3522 48.8566)");
// → { type: "Point", coordinates: [2.3522, 48.8566] }

const polygon = GeoLeaf.Utils.wktToGeoJSON("POLYGON((0 0, 4 0, 4 4, 0 4, 0 0))");
// → { type: "Polygon", coordinates: [[[0,0],[4,0],[4,4],[0,4],[0,0]]] }
```

### 8.3 Offline Mode

> Nécessite le plugin `@geoleaf-plugins/offline-ui`.

Le cache offline est fourni par le plugin Storage (`@geoleaf-plugins/offline-ui`).
Consultez la documentation du plugin pour les détails d'intégration.

```javascript
// Verify the storage plugin is loaded
const isLoaded = GeoLeaf.plugins.isLoaded("storage");
console.log("Storage plugin loaded:", isLoaded);
```

### 8.3 Custom Themes (CSS)

Surcharger les styles par défaut en chargeant un fichier CSS personnalisé après geoleaf-main.min.css :

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

GeoLeaf utilise le bus d'événements `GeoLeaf.Events` (via `CustomEvent` sur `document`).

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

Voir [EVENTS_API.md](EVENTS_API.md) pour la liste complète des événements.

### 8.5 Data Import/Export

La table offre une fonctionnalité d'export de la sélection :

> ℹ️ Le tableau de données a été extrait du core vers le plugin MIT `@geoleaf-plugins/table`. Il se charge via son propre script (après `@geoleaf/core`) ; `GeoLeaf.Table` est disponible une fois le plugin chargé, **sans** `_loadModule("table")`.

```javascript
// Export the current table selection (CSV/GeoJSON)
GeoLeaf.Table.exportSelection();
```

Pour l'import de points, écrire sur la **couche** qui les porte — une POI est une couche point
GeoJSON générique depuis la v3.0.0 :

```javascript
// Import points from a JSON file into an existing point layer
const fileInput = document.querySelector("#file-input");
fileInput.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    const text = await file.text();
    const features = JSON.parse(text); // FeatureCollection ou tableau de Feature
    GeoLeaf.Layers.setData("mes-points", features);
});
```

### 8.6 Import de fichiers géographiques (plugin)

Pour importer des fichiers **GPX, KML/KMZ, CSV ou TopoJSON** directement dans la carte, utiliser le plugin `@geoleaf-plugins/file-import` (MIT) :

```javascript
import "@geoleaf/core";
import "@geoleaf-plugins/file-import";

// Convertir un fichier en GeoJSON
const geojson = await GeoLeaf.FileImport.convert(file); // détection auto du format

// Importer et afficher directement comme couche
await GeoLeaf.FileImport.importAsLayer(file, { layerId: "user-import" });
```

Pour les données **FlatGeobuf** (streaming avec filtrage spatial) :

```javascript
import "@geoleaf-plugins/flatgeobuf";

// Chargement par bounding-box (HTTP Range — seule la zone est téléchargée)
const geojson = await GeoLeaf.FlatGeobuf.loadBbox("https://example.com/data.fgb", {
    minX: 2.2,
    minY: 48.8,
    maxX: 2.5,
    maxY: 49.0,
});
```

Voir [PLUGIN_CONFIGURATION_GUIDE.md](PLUGIN_CONFIGURATION_GUIDE.md) → sections "Plugin File Import" et "Plugin FlatGeobuf" pour les options complètes.

---

## 9. Troubleshooting

### Problèmes Courants

#### 9.1 La Carte N'Apparaît Pas

**Symptômes :** Espace blanc là où la carte devrait être

**Solutions :**

1. Vérifier que le div `#map` a une hauteur explicite en CSS :

    ```css
    #map {
        height: 600px;
    }
    ```

2. S'assurer que les CSS MapLibre GL JS **et** GeoLeaf sont chargés
3. Vérifier les erreurs dans la console navigateur (F12)
4. S'assurer que l'ID du container correspond à `mapId` dans la config
5. Vérifier que WebGL est supporté : `console.log(!!window.WebGLRenderingContext)`

#### 9.2 POIs Non Affichés

**Symptômes :** Carte visible mais pas de marqueurs

**Solutions :**

1. Vérifier que les coordonnées sont au format `[longitude, latitude]` (convention MapLibre GL JS)
2. Vérifier que la catégorie POI correspond aux catégories de la taxonomie
3. S'assurer que la couche est activée dans le gestionnaire de couches
4. Vérifier que l'échelle courante est dans la plage `scaleConfig` de la couche — et que ses bornes sont bien des **dénominateurs d'échelle** (`1:X`), pas des niveaux de zoom : c'est la confusion la plus fréquente, et elle rend la couche invisible à tous les zooms

#### 9.3 Profil Non Chargé

**Symptômes :** Erreur "Failed to load profile" dans la console

**Solutions :**

1. Vérifier `profilesBasePath` dans geoleaf.config.json
2. S'assurer que `profile.json` existe dans le répertoire du profil
3. Vérifier que les chemins dans `profile.json` sont corrects
4. S'assurer que les fichiers JSON sont valides (JSONLint.com)
5. Vérifier les erreurs 404 dans l'onglet Réseau des DevTools

#### 9.4 Labels Non Affichés

**Solutions :**

1. Vérifier `label.enabled: true` dans le fichier de style de couche
2. Vérifier que le zoom est dans la plage `labelScale`
3. Activer le bouton label dans le gestionnaire de couches
4. S'assurer que `label.visibleByDefault` est présent dans le fichier de style

#### 9.5 Cache Non Fonctionnel

**Solutions :**

1. Vérifier que le plugin `@geoleaf-plugins/offline-ui` est chargé
2. Vérifier que le navigateur supporte IndexedDB
3. Vérifier que le quota de stockage navigateur n'est pas dépassé
4. S'assurer que HTTPS est utilisé
5. Le mode Privé/Incognito peut désactiver le cache dans certains navigateurs

### Mode Debug

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

- **[Configuration Guide](CONFIGURATION_GUIDE.md)** — Détail complet des fichiers JSON de configuration
- **[Profiles Guide](PROFILES_GUIDE.md)** — Créer des profils métier personnalisés
- **[Events API](EVENTS_API.md)** — Référence complète des événements GeoLeaf
- **[Cookbook](COOKBOOK.md)** — 10 recettes pratiques
- **[usage-cdn.md](usage-cdn.md)** — Chargement CDN et NPM

### Exemples

- **Demo Application** — Exécuter `npm run build` puis `npm run build:deploy` pour accéder à la démo
- **Tourism Example** — Voir `profiles/tourism/` pour le showcase du profil tourisme

### Community

- **[GitHub Repository](https://github.com/geoleaf/geoleaf-js)** — Code source, issues, discussions
- **Contact** : Mattieu Pottier — contact@geoleaf.dev

---

<p align="center">
<strong>Besoin d'aide ?</strong><br>
Consulter <a href="COOKBOOK.md">Cookbook</a> · Signaler des <a href="https://github.com/geoleaf/geoleaf-js/issues">Issues</a> · Lire le <a href="CONTRIBUTING.md">Contributing Guide</a>
</p>
