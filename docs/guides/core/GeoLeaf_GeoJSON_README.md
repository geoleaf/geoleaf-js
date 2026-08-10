# GeoLeaf — Module GeoJSON (module interne)

Product Version: GeoLeaf Platform V3
**Version**: 3.0.0 — relu contre le code le 27/07/2026
**Fichiers (monorepo)** : `packages/core/src/kernel/geojson/`
**Dernière mise à jour**: mars 2026

---

> **GeoJSON est un module INTERNE.**
> Il n'existe pas de namespace public `GeoLeaf.GeoJSON` dans l'API.
> Les couches GeoJSON sont configurées dans `profile.json` via la clé `geojsonLayers`
> et gérées depuis l'API publique par `GeoLeaf.Legend`.

---

## 1. Rôle fonctionnel

Le module GeoJSON (`kernel/geojson/`) gère en interne :

- le chargement des couches vectorielles déclarées dans `profile.json` ;
- le rendu MapLibre GL (polygones, lignes, points, clusters) via sources et layers natifs ;
- la synchronisation avec le `LayerManager` pour la légende ;
- les popups unifiés compatibles avec le système POI ;
- le clustering natif MapLibre via `clusterMaxZoom` et `clusterRadius` sur les sources GeoJSON ;
- la gestion des tuiles vectorielles MVT via `map.addSource({ type: 'vector' })` + `map.addLayer()` ;
- le traitement différé en Web Worker (`geojson-worker.ts`) pour les grands jeux de données.

Ce module est initialisé automatiquement lors du chargement du profil. **Aucun appel explicite n'est requis depuis le code applicatif.**

### Architecture interne (v2.0.0)

```
built-in/geojson/
├── core.ts                    // Agrégateur principal, délègue aux sous-modules
├── shared.ts                  // État partagé, constantes, STYLE_OPERATORS
├── style-resolver.ts          // Évaluation styleRules, buildLayerOptions
├── layer-manager/             // Gestion couches (store, style, visibility, integration)
├── loader/                    // Chargement (config-helpers, data, profile, single-layer, clustering-setup)
├── popup-tooltip.ts           // Popups et tooltips unifiés
├── clustering.ts              // Stratégies de clustering MapLibre natif
├── vector-tiles.ts            // MVT via MapLibre native sources
├── geojson-worker.ts          // Web Worker pour traitement async
├── worker-manager.ts          // Gestion du cycle de vie du worker
├── visibility-manager.ts      // État de visibilité par couche
└── geojson-utils.ts           // Utilitaires (validateFeature, calculateBounds, etc.)
```

---

## 2. Configuration dans `profile.json`

Les couches GeoJSON sont déclarées dans la section `geojsonLayers` du fichier de profil :

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
            "clustering": false,
            "style": {
                "color": "#FF9800",
                "weight": 3,
                "opacity": 0.9
            }
        },
        {
            "id": "tourism-poi-nature",
            "label": "POI Nature",
            "url": "../data/profiles/tourism/geojson/poi-naturels.geojson",
            "visible": true,
            "clustering": true,
            "pointStyle": {
                "radius": 8,
                "fillColor": "#10b981",
                "fillOpacity": 0.9
            }
        }
    ]
}
```

### Propriétés de chaque couche

| Propriété                 | Type      | Obligatoire          | Description                                              |
| ------------------------- | --------- | -------------------- | -------------------------------------------------------- |
| `id`                      | `string`  | ✅                   | Identifiant unique de la couche                          |
| `label`                   | `string`  | ✅                   | Libellé affiché dans la légende                          |
| `url`                     | `string`  | ✅ (ou `tileUrl`)    | Chemin vers le fichier GeoJSON                           |
| `tileUrl`                 | `string`  | ✅ (ou `url`)        | URL MVT pour couches vectorielles tuilées                |
| `visible`                 | `boolean` | ❌ (défaut: `true`)  | Visibilité initiale                                      |
| `fitBoundsOnLoad`         | `boolean` | ❌ (défaut: `false`) | Adapter la vue au chargement                             |
| `maxZoomOnFit`            | `number`  | ❌ (défaut: 16)      | Zoom maximum lors du fitBounds                           |
| `clustering`              | `boolean` | ❌ (défaut: auto)    | Activer le clustering MapLibre natif (points uniquement) |
| `clusterRadius`           | `number`  | ❌ (défaut: 80)      | Rayon du cluster en pixels (MapLibre `clusterRadius`)    |
| `disableClusteringAtZoom` | `number`  | ❌ (défaut: 18)      | Zoom auquel le clustering est désactivé                  |
| `style`                   | `object`  | ❌                   | Style MapLibre pour polygones/lignes (`color`, `weight`) |
| `pointStyle`              | `object`  | ❌                   | Style MapLibre pour points (`radius`, `fillColor`)       |
| `popupTemplate`           | `string`  | ❌                   | Template de popup                                        |
| `detailProfileId`         | `string`  | ❌                   | Profil du panneau de détail                              |

---

## 3. API publique de gestion des couches

La visibilité des couches GeoJSON est contrôlée via `GeoLeaf.Legend` :

```js
// Masquer une couche
GeoLeaf.Legend.setLayerVisibility("tourism-routes", false);

// Afficher une couche
GeoLeaf.Legend.setLayerVisibility("tourism-routes", true);

// Lister toutes les couches actives
const layers = GeoLeaf.Legend.getAllLayers();
```

Voir la [documentation `GeoLeaf.Legend`](../../../packages/core/docs/legend/GeoLeaf_Legend_README.md) pour l'API complète.

---

## 4. Intégration avec `geoleaf.config.json`

La configuration globale `poiConfig` peut être appliquée à toutes les sources GeoJSON via `applyToAllSources` :

```json
{
    "poiConfig": {
        "clustering": true,
        "clusterRadius": 80,
        "disableClusteringAtZoom": 18,
        "applyToAllSources": true
    }
}
```

> `applyToAllSources: true` → les paramètres de clustering s'appliquent à toutes les sources (JSON, GeoJSON, GPX).
> Override possible par couche avec `"clustering": false`.

---

## 5. Géométries supportées

| Type Geometry     | Rendu MapLibre         | Style Config | Clustering |
| ----------------- | ---------------------- | ------------ | ---------- |
| `Point`           | `circle` layer         | `pointStyle` | ✅ Oui     |
| `LineString`      | `line` layer           | `style`      | ❌ Non     |
| `Polygon`         | `fill` + `line` layers | `style`      | ❌ Non     |
| `MultiPoint`      | `circle` layer         | `pointStyle` | ✅ Oui     |
| `MultiLineString` | `line` layer           | `style`      | ❌ Non     |
| `MultiPolygon`    | `fill` + `line` layers | `style`      | ❌ Non     |

---

## 6. Tuiles vectorielles MVT

Le module `vector-tiles.ts` ajoute le support des couches MVT via l'API native MapLibre :

```json
{
    "id": "admin-boundaries",
    "label": "Limites administratives",
    "tileUrl": "https://tiles.example.com/admin/{z}/{x}/{y}.pbf",
    "geometryType": "Polygon",
    "styles": {
        "directory": "styles",
        "default": "default.json"
    }
}
```

Aucune dépendance tierce requise — MapLibre GL JS supporte nativement le format MVT.

---

## 7. Format GeoJSON recommandé

```json
{
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {
                "id": "poi-001",
                "name": "Parc National",
                "description": "Vue panoramique.",
                "category": "nature"
            },
            "geometry": {
                "type": "Point",
                "coordinates": [-60.68, -32.95]
            }
        }
    ]
}
```

Les popups sont générées automatiquement depuis `properties.name`, `properties.label` ou `properties.title`.

---

## 8. Événements

```js
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

## 9. Limites et performances

- Avertissement si > 10 couches dans `geojsonLayers[]`
- Recommandation : 3–5 couches max pour performances optimales
- Pas de limite technique de features, mais surveiller les performances si > 5 000 features/couche
- Utiliser le clustering MapLibre natif pour les couches POI denses
- Le Web Worker (`geojson-worker.ts`) traite les opérations lourdes (calcul de bounds, filtrage de features) hors du thread principal

---

## 10. Séquence d'initialisation

1. `GeoLeaf.loadConfig({ url, profileId })` charge la config et le profil.
2. La section `geojsonLayers` du profil est lue automatiquement.
3. Les couches sont ajoutées comme sources MapLibre (`map.addSource`) et layers (`map.addLayer`).
4. Les couches sont synchronisées avec la légende.
5. **Aucun appel `GeoLeaf.GeoJSON.*` n'est nécessaire depuis l'application.**

Voir GEOJSON*LAYERS_GUIDE.md — ⚠️ *`GEOJSON_LAYERS_GUIDE.md` n'existe pas ; voir `packages/core/docs/CONFIGURATION_GUIDE.md`\_ pour les exemples de configuration de profil avancés.
