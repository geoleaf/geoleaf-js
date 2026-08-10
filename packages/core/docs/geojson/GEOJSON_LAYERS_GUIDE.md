---
title: "Guide : Systeme de Couches GeoJSON Multi-Sources"
---

# Guide : Systeme de Couches GeoJSON Multi-Sources

Product Version: GeoLeaf Platform V3
**Date de creation** : Decembre 2025
**Derniere verification** : 22 mars 2026 — Migration MapLibre GL JS v2.0.0

---

## Vue d'ensemble

Le module `GeoLeaf.GeoJSON` a été étendu pour supporter **plusieurs couches GeoJSON indépendantes**, avec :

- ✅ Affichage/masquage par couche
- ✅ Intégration automatique dans la légende
- ✅ Popups unifiés compatibles avec le système POI existant
- ✅ Clustering intelligent pour les points
- ✅ Configuration par profil métier (tourism, etc.)

---

## Configuration dans `profile.json`

### Structure de Base

Ajoutez une section `geojsonLayers` dans votre fichier `data/profiles/[profile]/profile.json` :

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

### Propriétés des Couches

| Propriété         | Type      | Obligatoire          | Description                                         |
| ----------------- | --------- | -------------------- | --------------------------------------------------- |
| `id`              | `string`  | ✅                   | Identifiant unique de la couche                     |
| `label`           | `string`  | ✅                   | Libellé affiché dans la légende                     |
| `url`             | `string`  | ✅                   | Chemin vers le fichier GeoJSON                      |
| `visible`         | `boolean` | ❌ (défaut: `true`)  | Visibilité initiale                                 |
| `fitBoundsOnLoad` | `boolean` | ❌ (défaut: `false`) | Adapter la vue sur la couche au chargement          |
| `maxZoomOnFit`    | `number`  | ❌ (défaut: 16)      | Zoom maximum lors du fitBounds                      |
| `clustering`      | `boolean` | ❌ (défaut: auto)    | Activer le clustering (POI uniquement)              |
| `style`           | `object`  |                      | Style MapLibre paint pour polygones/lignes          |
| `pointStyle`      | `object`  |                      | Style MapLibre paint pour points (circle layer)     |
| `popupTemplate`   | `string`  | ❌                   | Template de popup (non implémenté encore)           |
| `detailProfileId` | `string`  | ❌                   | Profil du panneau de détail (non implémenté encore) |

---

## Configuration du clustering — par capacité, plus globalement

⚠️ **`poiConfig` et `applyToAllSources` n'existent plus.** Ils réglaient le clustering pour
« tous les POI » à la fois, à l'époque où une POI était un sous-système à part. Depuis la
dissolution POI (v3.0.0), une POI **est** une couche point GeoJSON, et le clustering se configure
comme toute autre capacité : un défaut au profil, un réglage par couche.

**Défaut du profil** — `config/plugins/cluster.json`, référencé par `Files.modules.cluster` :

```jsonc
{
    "clustering": true,
    "clusterStrategy": "unified",
    "clusterRadius": 80,
    "disableClusteringAtZoom": 12,
}
```

**Par couche** — dans le `*_config.json` de la couche, la clé `clustering` l'emporte sur le
défaut :

```jsonc
{
    "id": "commerces",
    "clustering": false, // cette couche ne cluster pas, quel que soit le défaut
}
```

> Le rayon de recherche par proximité se configure à part, dans `profile.search`
> (`radiusMin`, `radiusMax`, `radiusStep`, `radiusDefault`).

---

## Utilisation depuis l’application

> ⚠️ `GeoLeaf.GeoJSON` n’est **pas** un namespace public.  
> Les couches déclarées dans `geojsonLayers` sont chargées **automatiquement** à l’init.  
> La visibilité se gère via `GeoLeaf.Legend`.

### Chargement automatique

Les couches GeoJSON définies dans `geojsonLayers` sont chargées automatiquement
lors de l’appel à `GeoLeaf.loadConfig()` — aucun appel supplémentaire n’est nécessaire :

```javascript
GeoLeaf.loadConfig({ url: "./geoleaf.config.json", profileId: "tourism" }).then(() => {
    // Les couches geojsonLayers sont déjà chargées et visibles
    console.log("Carte prête avec les couches GeoJSON du profil.");
});
```

### Gestion de la visibilité

```javascript
// Masquer une couche
GeoLeaf.Legend.setLayerVisibility("tourism-routes", false);

// Afficher une couche
GeoLeaf.Legend.setLayerVisibility("tourism-routes", true);

// Lister toutes les couches actives
const allLayers = GeoLeaf.Legend.getAllLayers();
console.log(allLayers);
```

---

## Intégration avec la Légende

Le système s'intègre **automatiquement** avec le module `GeoLeaf.Legend` :

1. **Section créée automatiquement** : "Couches GeoJSON"
2. **Items cliquables** : Checkbox/switch par couche
3. **Synchronisation bidirectionnelle** : Légende ↔ Carte

### Événements

```javascript
// Écouter les changements de visibilité
map.on("geoleaf:geojson:visibility-changed", (e) => {
    console.log(`Couche ${e.layerId} : ${e.visible ? "visible" : "masquée"}`);
});

// Écouter le chargement des couches
map.on("geoleaf:geojson:layers-loaded", (e) => {
    console.log(`${e.count} couche(s) chargée(s)`, e.layers);
});
```

---

## Popups et Panneau de Détail

### Popups Automatiques

Chaque feature affiche un popup avec :

- **Titre** : `properties.name`, `properties.label` ou `properties.title`
- **Description** : `properties.description` ou `properties.desc`
- **Bouton "Voir détails"** : rendu par la capacité `feature-info`, configurée sur la couche
  (`layers.<id>.capabilities.feature-info`)

### Format GeoJSON Recommandé

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

### Panneau de Détail Latéral

Lors du clic sur une feature, le panneau de détail POI existant s'ouvre **automatiquement** avec les données adaptées.

---

## Clustering POI

### Activation Automatique

Le clustering s'active si :

1. La couche contient des géométries de type `Point`
2. `clustering: true` dans `config/plugins/cluster.json` (défaut du profil)
3. `clustering !== false` dans le `*_config.json` de la couche (pas de désactivation explicite)

### Override par Couche

```jsonc
{
    "id": "poi-sans-cluster",
    "label": "POI sans clustering",
    "url": "poi.geojson",
    "clustering": false, // ← Désactive le clustering pour cette couche uniquement
}
```

---

## Types de Géométries Supportés

| Type Geometry     | Rendu MapLibre         | Style Config | Clustering |
| ----------------- | ---------------------- | ------------ | ---------- |
| `Point`           | Circle layer ou Symbol | `pointStyle` | Oui        |
| `LineString`      | Line layer             | `style`      | Non        |
| `Polygon`         | Fill + Line layer      | `style`      | Non        |
| `MultiPoint`      | Circle layer ou Symbol | `pointStyle` | Oui        |
| `MultiLineString` | Line layer             | `style`      | Non        |
| `MultiPolygon`    | Fill + Line layer      | `style`      | Non        |

---

## Limites et Performances

### Limite de Couches

- **Avertissement** si > 10 couches dans `geojsonLayers[]`
- **Recommandation** : 3-5 couches max pour performances optimales

### Limite de Features

- Aucune limite technique, mais surveiller les performances si > 5000 features/couche
- Utiliser le clustering pour les couches POI denses

### Optimisations MapLibre

- Chaque couche utilise une source GeoJSON independante (`map.addSource()`)
- Clustering via supercluster integre dans MapLibre (propriete `cluster: true` sur la source)
- Ajout/suppression efficace via `map.addLayer()` / `map.removeLayer()`
- Rendu WebGL pour des performances optimales sur les couches denses

---

## Exemples Complets

### Exemple 1 : 3 Couches (POI, Routes, Zones)

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

### Exemple 2 : Contrôle programmatique de la visibilité

```javascript
// Les couches sont chargées automatiquement via loadConfig()
// Gérer la visibilité via GeoLeaf.Legend :

// Masquer toutes les couches sauf une
const allLayers = GeoLeaf.Legend.getAllLayers();
allLayers.forEach((info, layerId) => {
    if (layerId !== "poi-restaurants") {
        GeoLeaf.Legend.setLayerVisibility(layerId, false);
    }
});

// Compter les couches visibles
const visibleCount = [...allLayers.entries()].filter(([, info]) => info.visible).length;
console.log("Couches visibles :", visibleCount);
```

---

## Configuration des couches dans le profil

Les couches GeoJSON se déclarent uniquement dans `profile.json`.
Il n'y a pas d'API publique `GeoLeaf.GeoJSON` — le chargement est entièrement piloté par la configuration.

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

Voir la section [Configuration dans `profile.json`](#configuration-dans-profilejson) pour la référence complète.

---

## Troubleshooting

### Problème : Les couches ne s'affichent pas

**Vérifier** :

1. URL des fichiers GeoJSON correcte (relative au profil)
2. `visible: true` dans la config
3. Console navigateur pour erreurs de chargement (404, JSON invalide)
4. `GeoLeaf.loadConfig()` appelé avant d’utiliser la carte

### Probleme : Le clustering ne fonctionne pas

**Verifier** :

1. `clustering: true` dans `config/plugins/cluster.json`
2. Que `Files.modules.cluster` pointe bien ce fichier depuis `profile.json`
3. Geometries de type `Point` (pas `Polygon` ou `LineString`)
4. Pas de `clustering: false` dans le `*_config.json` de la couche

> Le clustering est integre nativement via supercluster (source clustering MapLibre).
> Aucune dependance externe n'est necessaire.

### Problème : La légende n'apparaît pas

**Vérifier** :

1. Module `GeoLeaf.LayerManager` initialisé
2. `modules.legend.enabled` non désactivé (opt-out : la légende est active sauf `modules.legend.enabled: false` dans `config/plugins/legend.json`)
3. Au moins une couche chargée avec succès

---

## Tuiles vectorielles MVT / PBF

Pour les couches a fort volume (> 5 000 lignes ou polygones), GeoLeaf supporte le mode
**tuiles vectorielles** (MVT/PBF) via les sources vectorielles natives de MapLibre GL JS.
Les tuiles sont pre-generees localement et chargees a la demande selon le zoom et
l'emprise visible.

> Voir le guide dédié : [MVT_GUIDE.md](MVT_GUIDE.md)

---

## Références

- **Module interne** : `packages/core/src/modules/geojson/`
- **Facade Legend** : `packages/core/src/geoleaf.legend.ts`
- **Profil tourisme** : `profiles/tourism/profile.json`
- **Guide MVT** : [geojson/MVT_GUIDE.md](MVT_GUIDE.md)

---

## Changelog

### v2.0.0

- Migration moteur de rendu : Leaflet → MapLibre GL JS v5 (WebGL)
- Sources GeoJSON via `map.addSource()` / `map.addLayer()` natifs MapLibre
- Clustering GPU natif via `cluster: true` sur les sources
- Styles data-driven via expressions MapLibre (`match`, `interpolate`, `case`)
- Coordonnées `[lng, lat]` (standard GeoJSON) — inversion `[lat, lng]` supprimée

### v1.1.0–v1.2.0

- Architecture multi-couches via `geojsonLayers[]` dans `profile.json`
- Intégration automatique avec `GeoLeaf.Legend` (visibilité, sections)
- Popups unifiés compatibles avec le système POI
- Clustering configuré par capacité : défaut au profil, override par couche
- Configuration par profil métier
