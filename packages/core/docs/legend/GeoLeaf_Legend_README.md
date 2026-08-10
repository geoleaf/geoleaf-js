---
title: "GeoLeaf.Legend — Documentation du module Legend"
---

# GeoLeaf.Legend — Documentation du module Legend

**Version** : 2.2.0
**Fichier source (monorepo)** : `packages/core/src/capabilities/legend/legend-api.ts`
**Facade publique** : `packages/core/src/modules/geoleaf.legend.ts`
**Dernière mise à jour** : juillet 2026

---

## Rôle fonctionnel

Le module **GeoLeaf.Legend** gère l'affichage de la **légende cartographique** dans GeoLeaf.
La légende est générée **automatiquement** depuis les fichiers de style des couches déclarées dans le profil JSON.
Elle se positionne sur la carte (par défaut en bas à gauche) et affiche l'ensemble des couches visibles avec leurs entrées de style.

**Ce module est distinct de `GeoLeaf.LayerManager`** (voir section « Distinction » ci-dessous).

### Architecture interne (v2.2.0 — capacité in-core)

Depuis S10/F2, la légende est une **capacité in-core** relocalisée sous `capabilities/legend/`
(auparavant `modules/optional/legend/`). Elle est déclarée auprès du `CapabilityRegistry`
et gatée par la config `modules.legend.enabled` (opt-out), comme les capacités `filter`,
`labels` ou `theme-selector`.

```
capabilities/legend/
├── legend-api.ts        // Module principal — état, initialisation, API publique
├── legend-control.ts    // Contrôle MapLibre (rendu DOM de la légende)
├── legend-renderer.ts   // Rendu des items (symboles, accordéons)
├── legend-generator.ts  // Génération des données légende depuis un style JSON
├── legend-capability.ts // Déclaration de capacité (gate modules.legend.enabled + configSchema)
├── config.ts            // Lecture de modules.legend.* et fusion sur les défauts
└── lifecycle.ts         // LegendLifecycle — montage du contrôle (opt-out sur la config fusionnée)
```

---

## API publique

### `GeoLeaf.Legend.init(mapInstance, options?)`

Initialise la légende et l'attache à la carte MapLibre.

**Paramètres** :

- `mapInstance` (maplibre.Map) : Instance MapLibre GL **requis**
- `options` (Object, optionnel) :
    - `position` : `"bottomleft"` (défaut), `"bottomright"`, `"topleft"`, `"topright"`
    - `collapsible` : `true` (défaut)
    - `collapsed` : `false` (défaut)
    - `title` : `"Legend"` (défaut)

**Retourne** : `boolean` (succès)

```javascript
import * as maplibregl from "maplibre-gl";
const map = new maplibregl.Map({ container: "map", style: "..." });
GeoLeaf.Legend.init(map);

// Avec options
GeoLeaf.Legend.init(map, {
    position: "bottomright",
    collapsed: false,
    title: "Légende des couches",
});
```

> Les paramètres sont aussi lus depuis le bloc **`modules.legend`** (fichier
> `config/plugins/legend.json`, référencé par `Files.modules.legend` dans `profile.json`) :
>
> ```json
> {
>     "modules": {
>         "legend": {
>             "enabled": true,
>             "position": "bottomleft",
>             "collapsedByDefault": false,
>             "title": "Légende des couches"
>         }
>     }
> }
> ```
>
> **Config réveillée (S10/F2)** : `title`, `position` et `collapsedByDefault` étaient
> auparavant ignorés (écrasés par des défauts internes du contrôle). Ils sont désormais
> réellement lus et appliqués — un profil qui portait ces clés (via l'ancien `legendConfig`)
> verra sa légende rendue avec le titre, la position et l'état replié configurés.

---

### `GeoLeaf.Legend.loadLayerLegend(layerId, styleId, layerConfig)`

Charge la légende d'une couche GeoJSON à partir de son fichier de style.
Appelée automatiquement lors du chargement des couches GeoJSON.

**Paramètres** :

- `layerId` (string) : Identifiant de la couche
- `styleId` (string) : Identifiant du style actif
- `layerConfig` (Object) : Configuration de la couche (issue du profil JSON)

```javascript
// Normalement appelée en interne par le module GeoJSON.
// Pour usage manuel avancé :
GeoLeaf.Legend.loadLayerLegend("parcs", "default", layerConfig);
```

---

### `GeoLeaf.Legend.setLayerVisibility(layerId, visible)`

Contrôle la visibilité d'une couche dans la légende.

**Paramètres** :

- `layerId` (string) : Identifiant de la couche
- `visible` (boolean) : `true` = visible, `false` = cachée

```javascript
// Cacher la couche "parcs" dans la légende
GeoLeaf.Legend.setLayerVisibility("parcs", false);

// Afficher la couche "zones" dans la légende
GeoLeaf.Legend.setLayerVisibility("zones", true);
```

---

### `GeoLeaf.Legend.getAllLayers()`

Retourne toutes les couches enregistrées dans la légende.

**Retourne** : `Map<string, LayerInfo>` (Map JavaScript)

```javascript
const layers = GeoLeaf.Legend.getAllLayers();
layers.forEach((info, layerId) => {
    console.log(layerId, info.visible, info.label);
});
```

---

### `GeoLeaf.Legend.hideLegend()`

Masque la légende sans la supprimer.

```javascript
GeoLeaf.Legend.hideLegend();
```

---

### `GeoLeaf.Legend.removeLegend()`

Supprime complètement la légende de la carte et efface toutes les données de couches.

```javascript
GeoLeaf.Legend.removeLegend();
```

---

### `GeoLeaf.Legend.isLegendVisible()`

Indique si la légende est actuellement visible (contrôle présent + au moins une couche).

**Retourne** : `boolean`

```javascript
if (GeoLeaf.Legend.isLegendVisible()) {
    console.log("La légende est affichée");
}
```

---

### `GeoLeaf.Legend.showLoadingOverlay()` / `GeoLeaf.Legend.hideLoadingOverlay()`

Affiche ou masque l'overlay de chargement (spinner) sur la légende. Utilisé en interne lors du chargement asynchrone des styles.

```javascript
GeoLeaf.Legend.showLoadingOverlay();
// ... chargement
GeoLeaf.Legend.hideLoadingOverlay();
```

---

## Résumé de l'API

| Méthode                                          | Rôle                                            |
| ------------------------------------------------ | ----------------------------------------------- |
| `init(mapInstance, options?)`                    | Initialise la légende sur la carte              |
| `loadLayerLegend(layerId, styleId, layerConfig)` | Charge la légende d'une couche GeoJSON          |
| `setLayerVisibility(layerId, visible)`           | Affiche/masque une couche dans la légende       |
| `getAllLayers()`                                 | Retourne toutes les couches enregistrées        |
| `hideLegend()`                                   | Masque la légende                               |
| `removeLegend()`                                 | Supprime la légende et efface les données       |
| `isLegendVisible()`                              | Retourne si la légende est actuellement visible |
| `showLoadingOverlay()`                           | Affiche le spinner de chargement                |
| `hideLoadingOverlay()`                           | Masque le spinner de chargement                 |

---

## Événements DOM

### `geoleaf:legend:ready`

Émis **une seule fois**, au premier montage du contrôle de légende sur la carte.
Permet à une application ou à un plugin de réagir dès que la légende est en place.

**Payload** (`event.detail`) :

- `position` (string) : position effective du contrôle (`"bottomleft"`, `"bottomright"`, `"topleft"`, `"topright"`)
- `layerCount` (number) : nombre de couches enregistrées dans la légende au moment du montage

```javascript
document.addEventListener("geoleaf:legend:ready", (event) => {
    console.log("Légende prête :", event.detail.position, event.detail.layerCount);
});
```

---

## Intégration avec le profil JSON

La légende est générée automatiquement à partir des couches déclarées dans le profil.
Sa configuration vit dans le bloc **`modules.legend`** (fichier `config/plugins/legend.json`,
référencé par `Files.modules.legend`) :

```json
{
    "modules": {
        "legend": {
            "enabled": true,
            "position": "bottomleft",
            "collapsedByDefault": false,
            "title": "Légende"
        }
    },
    "geojsonLayers": [
        {
            "id": "parcs",
            "configFile": "layers/parcs.config.json",
            "geometryType": "Polygon"
        }
    ]
}
```

> **Migration (S10/F2)** : la légende était auparavant activée par `ui.showLegend` et
> configurée par le bloc `legendConfig`. Elle est désormais une **capacité in-core** unifiée
> sous `modules.legend`. `modules.legend.enabled` (défaut `true`, **opt-out**) remplace
> `ui.showLegend` ; `title` / `position` / `collapsedByDefault` remplacent les clés homonymes
> de `legendConfig` — et sont désormais réellement appliquées (voir « Config réveillée »
> ci-dessus). La capacité est intégrée au core.

Séquence d'initialisation :

1. `GeoLeaf.Config.load()` lit le profil JSON (dont `modules.legend`).
2. `GeoLeaf.Core.init()` crée la carte MapLibre.
3. `GeoLeaf.Legend.init(map)` s'initialise depuis `modules.legend` (ou défauts) et émet `geoleaf:legend:ready`.
4. Le module GeoJSON charge les couches et appelle `GeoLeaf.Legend.loadLayerLegend()` automatiquement.
5. La légende charge le fichier de style associé et génère les entrées visuelles.
6. La légende s'affiche avec les accordéons de chaque couche visible.

---

## Introspection

La capacité `legend` est déclarée auprès du `CapabilityRegistry` : son schéma de configuration
(clés `enabled` / `title` / `position` / `collapsedByDefault`, avec types, défauts et énumérations)
est introspectable via la façade publique :

```javascript
GeoLeaf.Introspection.getCapabilitySchema("legend");
```

La façade publique `GeoLeaf.Legend` (ses méthodes) reste **inchangée** par la migration S10/F2.

---

## Distinction Legend vs LayerManager

GeoLeaf expose **deux modules distincts** pour la gestion des couches :

| Aspect         | `GeoLeaf.Legend`                                           | `GeoLeaf.LayerManager`                                           |
| -------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| **Facade**     | `packages/core/src/modules/geoleaf.legend.ts`              | `packages/core/src/modules/geoleaf.layer-manager.ts`             |
| **Source**     | `src/capabilities/legend/legend-api.ts`                    | `src/modules/built-in/layer-manager/index.ts`                    |
| **Rôle**       | Légende cartographique automatique (générée depuis styles) | Gestionnaire de couches UI (panneau interactif MapLibre Control) |
| **Gestion**    | Couches GeoJSON et leur rendu légendaire                   | Sections configurables (basemaps, couches, thèmes)               |
| **Chargement** | Automatique depuis styles des couches                      | Manuel via sections JSON ou `addSection()`                       |
| **Alias ?**    | Non — module indépendant                                   | Non — module indépendant                                         |

Ces deux modules sont **indépendants et non aliasés**.

---

## Modules liés

- **[GeoLeaf.Core](../core/GeoLeaf_core_README.md)** : Fournit l'instance de carte
- **[GeoLeaf.LayerManager](../layer-manager/GeoLeaf_LayerManager_README.md)** : Panneau de gestion des couches UI
