---
title: "profile.json - Référence Complète"
---

# profile.json - Référence Complète

**Version:** 3.0.0

**Date de dernière mise à jour:\*\*** 1 avril 2026

**Statut:** ✅ Production Ready

---

## Table des Matières

1. [Vue d'ensemble](#vue-densemble)

2. [Structure complète](#structure-complète)

3. [Paramètres racine](#paramètres-racine)

4. [Section map](#section-map)

5. [Section Files](#section-files)

6. [Section ui](#section-ui)

7. [Section basemaps](#section-basemaps)

8. [Section performance](#section-performance)

9. [Section search](#section-search)

10. [Section layerManagerConfig](#section-layermanagerconfig)

11. [Section modules.legend](#section-moduleslegend)

12. [Section poiConfig](#section-poiconfig)

13. [Section brandingConfig](#section-brandingconfig)

14. [Section tableConfig](#section-tableconfig--extrait-du-core)

15. [Section scaleConfig](#section-scaleconfig)

16. [Section storage](#section-storage)

17. [Section poiAddConfig](#section-poiaddconfig)

18. [Section geocodingConfig](#section-geocodingconfig)

19. [Tableau récapitulatif](#tableau-récapitulatif)

---

## Vue d'ensemble

Le fichier `profile.json` est le **fichier de configuration principal** d'un profil GeoLeaf. Il définit :

- L'interface utilisateur (composants visibles)

- Les fonds de carte disponibles

- Les paramètres de performance

- La configuration des filtres et de la recherche

- Les réglages des composants (table, légende, gestionnaire de couches)

> **⚠️ Important:** Cette documentation est basée sur l'analyse du **code source réel** (src/modules/) et des **tests unitaires** (\_\_tests\_\_/).

### Emplacement

```

profiles/{profile-name}/profile.json

```

### Chargement

Le fichier est chargé par :

- **Fichier source:** `profile.ts`

- **Fonction principale:** `loadActiveProfileResources()`

- **Événement émis:** `geoleaf:profile:loaded`

---

## Structure complète

Voici la structure complète avec tous les paramètres disponibles :

```jsonc

{

  "id": "string",

  "label": "string",

  "description": "string",

  "version": "string",



  "map": {

    "bounds": [[number, number], [number, number]],

    "initialMaxZoom": number,

    "padding": [number, number],

    "positionFixed": boolean,

    "boundsMargin": number,

    "minZoom": number

  },



  "Files": {

    "themesFile": "string",

    "layersFile": "string",

    "basemapsFile": "string",

    "uiFile": "string",

    "featuresFile": "string",

    "modules": { "<moduleId>": "string" }

  },



  "ui": {

    "theme": "string",

    "language": "string",

    "showBaseLayerControls": boolean,

    "showLayerManager": boolean,

    "showFilterPanel": boolean,

    "showGeolocation": boolean,

    "showCoordinates": boolean,

    "showLegend": boolean,

    "showCacheButton": boolean,

    "showAddPoi": boolean,

    "showScale": boolean,

    "interactiveShapes": boolean

  },



  "basemaps": {

    "{basemap-id}": {

      "id": "string",

      "label": "string",

      "type": "string (\"raster\" | \"maplibre\")",

      "url": "string (tile URL template, also used as raster fallback for maplibre)",

      "style": "string (URL style JSON MapLibre)",

      "attribution": "string",

      "minZoom": number,

      "maxZoom": number,

      "defaultBasemap": boolean,

      "offline": boolean,

      "offlineBounds": {

        "north": number,

        "south": number,

        "east": number,

        "west": number

      },

      "cacheMinZoom": number,

      "cacheMaxZoom": number

    }

  },



  "performance": {

    "maxConcurrentLayers": number,

    "layerLoadDelay": number,

    "fitBoundsOnThemeChange": boolean

  },



  "search": {

    "title": "string",

    "radiusMin": number,

    "radiusMax": number,

    "radiusStep": number,

    "radiusDefault": number,

    "searchPlaceholder": "string",

    "filters": [

      {

        "id": "string",

        "type": "string",

        "label": "string",

        "placeholder": "string",

        "searchFields": ["string"],

        "buttonLabel": "string",

        "instructionText": "string",

        "field": "string"

      }

    ],

    "actions": {

      "applyLabel": "string",

      "resetLabel": "string"

    }

  },



  "layerManagerConfig": {

    "title": "string",

    "collapsedByDefault": boolean,

    "sections": [

      {

        "id": "string",

        "label": "string",

        "order": number,

        "collapsedByDefault": boolean

      }

    ]

  },



  // legendConfig migré — voir modules.legend (fichier config/plugins/legend.json)



  "poiConfig": {

    "clusterStrategy": "string"

  },



  "brandingConfig": {

    "enabled": boolean,

    "text": "string",

    "position": "string"

  },



  // tableConfig retiré — voir plugin @geoleaf-plugins/table (modules.table)



  "scaleConfig": {

    "scaleGraphic": boolean,

    "scaleNumeric": boolean,

    "scaleNumericEditable": boolean,

    "scaleNivel": boolean,

    "position": "string"

  },



  "storage": {

    "cache": {

      "enableProfileCache": boolean,

      "enableTileCache": boolean

    }

  },



  "poiAddConfig": {

    "enabled": boolean,

    "defaultPosition": "string"

  }

}

```

---

## Paramètres racine

### `id` (string, obligatoire)

**Description:** Identifiant unique du profil.

**Utilisation dans le code:**

- Utilisé pour charger le profil

- Référencé dans les événements

- Stocké dans `config.data.activeProfile`

**Fichiers source:**

- `profile.ts` ligne 141

**Valeurs possibles:** Chaîne alphanumérique sans espaces (ex: `"tourism"`, `"my-custom-profile"`)

**Valeur par défaut:** Aucune (obligatoire)

**État:** ✅ Actif et fonctionnel

---

### `label` (string, obligatoire)

**Description:** Nom d'affichage du profil pour l'interface utilisateur.

**Utilisation dans le code:**

- Affiché dans les logs

- Peut être utilisé dans l'interface de sélection de profil

**Fichiers source:**

- `profile.ts`

**Valeurs possibles:** Chaîne de caractères libre (ex: `"Profil tourisme"`, `"My Custom Profile"`)

**Valeur par défaut:** Aucune (obligatoire)

**État:** ✅ Actif et fonctionnel

---

### `description` (string, optionnel)

**Description:** Description détaillée du profil et de son usage.

**Utilisation dans le code:**

- Utilisé pour la documentation

- Peut être affiché dans une interface de sélection

**Fichiers source:**

- Stocké dans l'objet profile mais peu utilisé directement dans le code

**Valeurs possibles:** Texte libre

**Valeur par défaut:** Chaîne vide

**État:** ✅ Actif (principalement documentation)

---

### `version` (string, optionnel)

**Description:** Version du profil suivant le semantic versioning.

**Utilisation dans le code:**

- Utilisé pour la détection de version (legacy vs 1.0.0)

- Fonction `isModularProfile()` dans ProfileLoader

**Fichiers source:**

- `profile-loader.ts`

**Valeurs possibles:** Format "X.Y.Z" (ex: `"1.0.0"`, `"1.2.5"`)

**Valeur par défaut:** `"1.0.0"`

**État:** ✅ Actif et fonctionnel

---

## Section map

### `map` (object, obligatoire)

**Description:** Paramètres d'initialisation de la carte : emprise initiale, plafond de zoom au chargement, et restriction de navigation.

**Utilisation dans le code:**

- Chargé dans `src/app/modules/core-map.module.js` lors de l'initialisation de la carte

- `bounds` est utilisé pour le `fitBounds()` initial et comme emprise de `maxBounds` si `positionFixed` est activé

#### `map.bounds` (array, obligatoire)

Emprise géographique initiale au format `[[sud, ouest], [nord, est]]` en WGS84.

```jsonc

"bounds": [[-58.39, -73.58], [-21.78, -34.67]]

```

#### `map.initialMaxZoom` (integer, optionnel)

Zoom maximum utilisé par `fitBounds()` au démarrage. **Ne limite PAS** le zoom utilisateur — il empêche seulement le `fitBounds` initial de zoomer trop fort sur une petite emprise.

- **Valeur par défaut:** `12`

- **Valeurs possibles:** `1` à `20`

- **Rétrocompatibilité:** l'ancien nom `maxZoom` est toujours lu en fallback

> **⚠️ Note:** Ce paramètre ne remplace pas le `maxZoom` des basemaps (qui contrôle la disponibilité des tuiles) ni le zoom maximum MapLibre de la carte.

#### `map.padding` (array, optionnel)

Marge en pixels `[vertical, horizontal]` appliquée au `fitBounds()` initial. Évite que l'emprise colle aux bords du conteneur.

- **Valeur par défaut:** `[50, 50]`

#### `map.positionFixed` (boolean, optionnel)

Restreint le déplacement de la carte à l'emprise définie dans `bounds`. L'utilisateur ne peut pas naviguer trop loin de cette zone mais conserve une liberté de déplacement.

- **Valeur par défaut:** `false`

- **Avantage performance:** MapLibre ne chargera pas de tuiles hors emprise → réduction des requêtes réseau

- **Implémentation:** utilise `map.setMaxBounds()` avec une marge configurable via `boundsMargin` (défaut 30%)

- **Comportement:** effet élastique ("rubber-band") aux bords, pas un mur dur

#### `map.boundsMargin` (number, optionnel)

Marge supplémentaire autour des `bounds` lorsque `positionFixed` est `true`. Permet de contrôler la liberté de déplacement.

- **Valeur par défaut:** `0.3` (30% de marge)

- **Plage:** `0` (aucune marge, très restrictif) à `1` (100%, très libre)

- **Ignoré** si `positionFixed` est `false`

#### `map.minZoom` (integer, optionnel)

Zoom minimum lorsque `positionFixed` est `true`. Empêche l'utilisateur de dézoomer trop et voir le reste du monde.

- **Valeur par défaut:** `3` (si `positionFixed` est `true`)

- **Ignoré** si `positionFixed` est `false`

---

#### `map.maxPitch` (number, optionnel)

**Description:** Inclinaison maximale de la caméra en degrés. MapLibre GL JS plafonne à 60° par défaut — ce paramètre leve cette restriction pour permettre des vues 3D plus prononcées.

**Valeurs possibles:** `0`–`85` (au-delà de 80° des artefacts visuels peuvent apparaître avec un DEM à résolution 30m)

**Valeur par défaut:** `80`

**Utilisé avec:** `basemaps.{id}.terrain` — le pitch défini dans `terrain.pitch` doit être inférieur ou égal à `maxPitch`.

**Ajouté en:** v2.1.0

**État:** ✅ Actif et fonctionnel

---

#### Exemple complet

```jsonc

"map": {

  "bounds": [[-58.39, -73.58], [-21.78, -34.67]],

  "initialMaxZoom": 12,

  "padding": [50, 50],

  "positionFixed": true,

  "boundsMargin": 0.3,

  "minZoom": 3

}

```

---

## Section Files

### `Files` (object, obligatoire)

**Description:** Définit les chemins vers les fichiers de configuration associés au profil.

**Utilisation dans le code:**

- Chargés en parallèle lors de l'initialisation du profil modulaire

- `profile-loader.ts`

**État:** ✅ Actif et fonctionnel (profils 1.0.0+)

---

#### `Files.themesFile` (string, obligatoire)

**Description:** Chemin vers le fichier de thèmes (presets de visibilité des couches).

**Utilisation dans le code:**

```javascript
// profile-loader.js ligne 68

const themesUrl = `${baseUrl}/${profile.Files.themesFile}?t=${timestamp}`;
```

**Fichiers source:**

- `profile-loader.ts` ligne 68

**Valeurs possibles:** Chemin relatif (layout v2 : `"config/core/themes.json"`)

**Valeur par défaut:** aucune (chemin déclaré explicitement ; layout v2 : `"config/core/themes.json"`)

**État:** ✅ Actif et fonctionnel

---

#### `Files.layersFile` (string, optionnel)

**Description:** Chemin vers le fichier de définition des couches GeoJSON.

**Utilisation dans le code:**

```javascript
// profile-loader.js ligne 69

const layersUrl = `${baseUrl}/${profile.Files.layersFile}?t=${timestamp}`;
```

**Fichiers source:**

- `profile-loader.ts` ligne 69

**Valeurs possibles:** Chemin relatif (layout v2 : `"config/core/layers.json"`)

**Valeur par défaut:** aucune (chemin déclaré explicitement ; layout v2 : `"config/core/layers.json"`)

**État:** ✅ Actif et fonctionnel

---

#### `Files.featuresFile` (string, optionnel)

**Description:** Chemin vers le fichier des features core (`clusteringConfig`,
`performance`, `poiConfig`, `mapOptions` — géocodage → plugin). Son contenu est fusionné
à la racine du profil consolidé, comme `uiFile` et `basemapsFile`.

**Valeurs possibles:** Chemin relatif (layout v2 : `"config/core/features.json"`)

**État:** ✅ Actif et fonctionnel (layout v2, 2026-06)

---

#### `Files.modules` (object, optionnel)

**Description:** Dictionnaire `{ moduleId: cheminFichier }` — un fichier de
configuration par plugin (Plugin Contract v1). Chaque fichier contient le bloc
`modules.<id>` correspondant ; son contenu appartient au plugin (le core ne le valide
pas, INV-CONFIG). Les fichiers sont chargés en parallèle des sections core ; un bloc
`modules.<id>` déclaré inline dans `profile.json` prime sur le fichier (deepMerge,
tableaux remplacés).

**Exemple:**

```json
"modules": {
    "storage": "config/plugins/storage.json",
    "addpoi": "config/plugins/addpoi.json"
}
```

**État:** ✅ Actif et fonctionnel (layout v2, 2026-06)

---

## Section ui

> ⚠️ **Déprécié v2.0.0 :** La section `ui` inline dans `profile.json` est dépréciée. Depuis v2.0.0, la configuration UI doit être définie dans `ui.json` (référencé par `Files.uiFile`). La compatibilité inline est maintenue pour rétrocompatibilité, mais `ui.json` est recommandé pour tous les nouveaux projets.

### `ui` (object, optionnel)

**Description:** Configuration de l'interface utilisateur et des composants visibles.

**État:** ✅ Actif et fonctionnel

---

#### `ui.theme` (string, optionnel)

**Description:** Thème visuel de l'application.

**Utilisation dans le code:**

```javascript
// geoleaf.core.ts ligne 132

const uiConfig = global.GeoLeaf.Config.get("ui") || {};

const theme = uiConfig.theme || "light";
```

**Fichiers source:**

- `geoleaf.core.ts` ligne 132

- `theme.ts`

**Valeurs possibles:**

- `"light"` - Thème clair

- `"dark"` - Thème sombre

**Valeur par défaut:** `"light"`

**État:** ✅ Actif et fonctionnel

---

#### `ui.language` (string, optionnel)

**Description:** Langue de l'interface utilisateur.

**Utilisation dans le code:**

- Stocké dans la configuration

- Peut influencer les labels et textes

**Fichiers source:**

- Pas d'utilisation directe détectée dans le code actuel

**Valeurs possibles:** Codes ISO 639-1 (ex: `"fr"`, `"en"`, `"es"`)

**Valeur par défaut:** `"fr"`

**État:** ⚠️ Défini mais peu utilisé directement (préparation i18n)

---

#### `ui.showBaseLayerControls` (boolean, optionnel)

**Description:** Affiche les contrôles de sélection des fonds de carte.

**Utilisation dans le code:**

```javascript
// geoleaf.baselayers.ts ligne 217

const showControls = config && config.ui && config.ui.showBaseLayerControls !== false;
```

**Fichiers source:**

- `geoleaf.baselayers.ts` ligne 217

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `false`

**État:** ✅ Actif et fonctionnel

**Tests:**

- \_\_tests\_\_/baselayers/baselayers.test.js ligne 307

---

#### `ui.showLayerManager` (boolean, optionnel)

**Description:** Affiche le gestionnaire de couches.

**Utilisation dans le code:**

- Utilisé pour conditionner l'affichage du composant LayerManager

**Fichiers source:**

- `geoleaf.layer-manager.ts`

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `true`

**État:** ✅ Actif et fonctionnel

---

#### `ui.showFilterPanel` (boolean, optionnel)

**Description:** Affiche le panneau de filtrage des POI.

**Utilisation dans le code:**

```javascript
// filter-panel/renderer.test.js ligne 425

mockGeoLeaf.Config.get.mockReturnValue({ showFilterPanel: true });
```

**Fichiers source:**

- `renderer.ts`

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `true`

**État:** ✅ Actif et fonctionnel

**Tests:**

- \_\_tests\_\_/ui/filter-panel/renderer.test.js ligne 424

---

#### `ui.showGeolocation` (boolean, optionnel)

**Description:** Affiche le bouton de géolocalisation GPS.

> **Renommage v2.0.0 :** Anciennement `enableGeolocation`. Les deux noms sont acceptés pour la rétrocompatibilité, mais `showGeolocation` est recommandé.

**Utilisation dans le code:**

```javascript
// ui/controls.js (ligne 164 dans les tests)

const config = { ui: { showGeolocation: true } };
```

**Fichiers source:**

- `controls.ts`

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `true`

**État:** ✅ Actif et fonctionnel

**Tests:**

- `packages/core/__tests__/ui/coverage-modules-ui-controls.test.js`

- \_\_tests\_\_/integration/controls-simple.test.js ligne 214

---

#### `ui.showScale` (boolean, optionnel)

**Description:** Affiche la barre d'échelle. La configuration avancée (graphique, édition, position) est contrôlée par le bloc `scaleConfig` dans `ui.json`.

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `true`

**État:** ✅ Actif et fonctionnel

---

#### `ui.showCoordinates` (boolean, optionnel)

**Description:** Affiche l'indicateur de coordonnées.

**Utilisation dans le code:**

```javascript
// geoleaf.core.ts ligne 132

const showCoordinates = uiConfig ? uiConfig.showCoordinates !== false : true;
```

**Fichiers source:**

- `geoleaf.core.ts`

- `coordinates-display.ts`

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `true`

**État:** ✅ Actif et fonctionnel

**Tests:**

- `packages/core/__tests__/ui/` — voir les tests de contrôles UI

---

#### `ui.showThemeSelector` → **déplacé (breaking, v3)**

**Migration :** ce drapeau a quitté `ui.showThemeSelector` pour **`modules.theme-selector.enabled`** (fichier `config/plugins/theme-selector.json`, déclaré dans `profile.json` → `Files.modules`). **Opt-out** : la barre de thèmes est active sauf `modules.theme-selector.enabled: false`. Le sélecteur est une capacité in-core (`capabilities/theme-selector/`), gatée via `CapabilityRegistry`.

**Fichiers source:**

- `theme-selector.ts` ligne 124

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `true`

**État:** ✅ Actif et fonctionnel

---

#### `ui.showLegend` → **déplacé (breaking, v3)**

**Migration :** ce drapeau a quitté `ui.showLegend` pour **`modules.legend.enabled`** (fichier `config/plugins/legend.json`, déclaré dans `profile.json` → `Files.modules`). **Opt-out** : la légende est active sauf `modules.legend.enabled: false`. La légende est une capacité in-core (`capabilities/legend/`), gatée via `CapabilityRegistry` — voir [Section modules.legend](#section-moduleslegend).

**Fichiers source:**

- `capabilities/legend/legend-capability.ts`

- `capabilities/legend/config.ts`

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `true`

**État:** ✅ Actif et fonctionnel

---

#### `ui.showCacheButton` (boolean, optionnel)

**Description:** Affiche le bouton de gestion du cache hors ligne.

**Utilisation dans le code:**

```javascript
// ui/cache-button.test.js ligne 154

const showCacheButton = cfg?.ui?.showCacheButton !== false;
```

**Fichiers source:**

- `packages/plugins/offline-ui/src/ui/cache-button/button-control.ts` — le contrôle vit dans **`@geoleaf-plugins/offline-ui`**, pas dans le core. Le chemin `src/modules/ui/cache-button.js` mentionné jusqu'ici n'existe plus depuis l'extraction du sous-système de cache.

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `false`

**État:** ✅ Actif et fonctionnel

**Tests:**

- `packages/plugins/offline-ui/src/__tests__/cache-button.test.js` — `ButtonControl.init()` rend `null` quand `showCacheButton` vaut `false`, et la carte réelle sinon.

---

#### `ui.showAddPoi` (boolean, optionnel)

**Description:** Affiche le bouton d'ajout de POI.

**Utilisation dans le code:**

```javascript
// integration/controls-simple.test.js ligne 287

const config = { ui: { showAddPoi: true } };
```

**Fichiers source:**

- `controls.ts`

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `false`

**État:** ✅ Actif et fonctionnel

**Tests:**

- \_\_tests\_\_/integration/controls-simple.test.js ligne 287

---

#### `ui.interactiveShapes` (boolean, optionnel)

**Description:** Rend les formes géométriques (polygones, lignes) interactives (cliquables).

**Utilisation dans le code:**

```javascript
// ui/filter-panel/proximity.js ligne 212

const interactiveShapes = GeoLeaf.Config.get("ui.interactiveShapes", false);
```

**Fichiers source:**

- `proximity.ts` ligne 212

- `controls.ts` ligne 348

- `layer-config-manager.ts` ligne 115

- `geoleaf.route.ts` ligne 144

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `false`

**État:** ✅ Actif et fonctionnel

---

## Section basemaps

> ⚠️ **Migration v2.0.0 :** La définition des fonds de carte inline dans `profile.json` est maintenue, mais il est recommandé de les déplacer dans un fichier `basemaps.json` dédié (référencé par `Files.basemapsFile`) pour faciliter la réutilisation entre profils.

### `basemaps` (object, obligatoire)

**Description:** Définition des fonds de carte disponibles.

**Structure:** Objet avec clés = ID du fond de carte, valeurs = configuration du fond de carte.

**Utilisation dans le code:**

```javascript
// geoleaf.baselayers.ts ligne 218

basemaps: global.GeoLeaf.Config.get("basemaps") || {};
```

**Fichiers source:**

- `geoleaf.baselayers.ts`

- src/modules/storage/cache/resource-enumerator.js ligne 211

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.id` (string, obligatoire)

**Description:** Identifiant unique du fond de carte.

**Valeurs possibles:** Chaîne alphanumérique (ex: `"street"`, `"satellite"`, `"topo"`)

**Valeur par défaut:** Aucune (obligatoire)

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.label` (string, obligatoire)

**Description:** Nom d'affichage du fond de carte dans l'interface.

**Valeurs possibles:** Chaîne de caractères libre (ex: `"Street"`, `"Satellite"`, `"Topographique"`)

**Valeur par défaut:** Aucune (obligatoire)

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.url` (string, obligatoire)

**Description:** Template d'URL des tuiles du fond de carte.

**Format:** Utilise les placeholders `{s}`, `{z}`, `{x}`, `{y}`

**Exemple:**

```

https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png

```

**Valeurs possibles:** URL valide avec placeholders MapLibre (`{z}`, `{x}`, `{y}`)

**Valeur par défaut:** Aucune (obligatoire)

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.attribution` (string, obligatoire)

**Description:** Texte d'attribution/copyright du fond de carte (HTML autorisé).

**Exemple:**

```

&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors

```

**Valeurs possibles:** Chaîne HTML

**Valeur par défaut:** Aucune (obligatoire)

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.minZoom` (number, optionnel)

**Description:** Niveau de zoom minimum pour ce fond de carte.

**Utilisation dans le code:**

```javascript
// geoleaf.baselayers.ts ligne 103

if (typeof definition.minZoom === "number") {
    opts.minZoom = definition.minZoom;
}
```

**Fichiers source:**

- `geoleaf.baselayers.ts` ligne 100-107

**Valeurs possibles:** Nombre entier entre 0 et 20 (généralement 0-5 pour fonds de carte)

**Valeur par défaut:** 0

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.maxZoom` (number, optionnel)

**Description:** Niveau de zoom maximum pour ce fond de carte.

**Utilisation dans le code:**

```javascript
// geoleaf.baselayers.ts ligne 108

opts.maxZoom = typeof definition.maxZoom === "number" ? definition.maxZoom : 19;
```

**Fichiers source:**

- `geoleaf.baselayers.ts` ligne 108

**Valeurs possibles:** Nombre entier entre 1 et 20 (généralement 17-19 pour OSM)

**Valeur par défaut:** `19`

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.defaultBasemap` (boolean, optionnel)

**Description:** Indique si ce fond de carte est sélectionné par défaut au chargement.

**Utilisation dans le code:**

- Utilisé lors de l'initialisation de la carte pour sélectionner le fond par défaut

**Fichiers source:**

- `geoleaf.baselayers.ts`

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `false`

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.offline` (boolean, optionnel)

**Description:** Indique si ce fond de carte est disponible en mode hors ligne (cache).

**Utilisation dans le code:**

- Utilisé par le système de cache pour déterminer si les tuiles doivent être mises en cache

**Fichiers source:**

- src/modules/storage/cache/resource-enumerator.js

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `false`

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.offlineBounds` (object, optionnel)

**Description:** Limites géographiques pour le cache hors ligne de ce fond de carte.

**Structure:**

```jsonc

{

  "north": number,

  "south": number,

  "east": number,

  "west": number

}

```

**Prérequis:** `offline: true`

**Exemple:**

```json
{
    "north": -22.0,

    "south": -56.0,

    "east": -53.5,

    "west": -73.5
}
```

**Valeurs possibles:** Coordonnées WGS84 (latitude/longitude en degrés décimaux)

**Valeur par défaut:** Aucun

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.cacheMinZoom` (number, optionnel)

**Description:** Niveau de zoom minimum pour le cache hors ligne.

**Prérequis:** `offline: true`

**Valeurs possibles:** Nombre entier entre 0 et `cacheMaxZoom`

**Valeur par défaut:** `4`

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.cacheMaxZoom` (number, optionnel)

**Description:** Niveau de zoom maximum pour le cache hors ligne.

**Prérequis:** `offline: true`

**Valeurs possibles:** Nombre entier entre `cacheMinZoom` et 20

**Valeur par défaut:** `12`

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.type` (string, optionnel)

**Description:** Type de basemap. Permet de distinguer les basemaps raster classiques des basemaps vectorielles MapLibre GL.

**Valeurs possibles:**

- `"tile"` — Basemap raster classique via source MapLibre GL JS de type `"raster"` (défaut implicite)

- `"maplibre"` — Basemap vectorielle WebGL via style MapLibre GL JS (fichier JSON de style)

**Valeur par défaut:** `"tile"` (implicite quand absent)

**Comportement:** Si `type: "maplibre"` (ou si `style` est présent), le module Baselayers crée une source vectorielle MapLibre GL. Si le style n'est pas chargé, un fallback vers la source raster est utilisé.

**Ajouté en:** v2.0.0

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.style` (string, requis si type "maplibre")

**Description:** URL du style JSON MapLibre GL (ou objet style inline). Définit les sources de tuiles vectorielles et les layers de rendu.

**Prérequis:** `type: "maplibre"` (ou implicite si `style` est fourni)

**Exemple:**

```

https://tiles.openfreemap.org/styles/liberty

```

**Providers gratuits:**

- OpenFreeMap : `https://tiles.openfreemap.org/styles/liberty` (100% gratuit)

- OpenFreeMap Dark : `https://tiles.openfreemap.org/styles/dark`

- MapTiler (freemium) : `https://api.maptiler.com/maps/streets-v2/style.json?key=KEY`

**Valeur par défaut:** Aucune (requis pour les basemaps MapLibre)

**Ajouté en:** v2.0.0

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.fallbackUrl` (string, optionnel)

**Description:** URL de tuiles raster de secours (fallback si le style MapLibre n'est pas disponible).

**Prérequis:** `type: "maplibre"` (ignoré pour les basemaps raster)

**Exemple:**

```

https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png

```

**Comportement:** Si MapLibre GL JS n'est pas chargé (CDN manquant, erreur réseau), la basemap utilise cette URL raster en fallback. Si `fallbackUrl` n'est pas fourni, le fallback utilise la basemap `street` par défaut (OSM).

**Valeur par défaut:** URL de la basemap `street` par défaut

**Ajouté en:** v2.0.0

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.terrain` (object, optionnel)

**Description:** Configuration du terrain 3D pour ce basemap. Quand présent et `enabled: true`, GeoLeaf charge une source DEM (Digital Elevation Model) et active le rendu de relief MapLibre GL JS. Fonctionne sur les basemaps raster (`type: "tile"`) et vectoriels (`type: "maplibre"`).

**Prérequis:** `terrain.enabled: true` + `terrain.demUrl` valide

**Exemple:**

```json
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
```

**Ajouté en:** v2.1.0

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.terrain.enabled` (boolean, optionnel)

**Description:** Active le terrain 3D pour ce basemap.

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `false`

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.terrain.demUrl` (string, requis si terrain activé)

**Description:** URL du service de tuiles DEM (Digital Elevation Model). Utilise les placeholders `{z}`, `{x}`, `{y}`.

**Sources validées en production:**

- **AWS Terrarium** (gratuit, mondial, résolution ~30m) :
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`

**Valeur par défaut:** Aucune (requis si `terrain.enabled: true`)

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.terrain.demEncoding` (string, optionnel)

**Description:** Format d'encodage des valeurs d'élévation dans les tuiles DEM.

**Valeurs possibles:**

- `"terrarium"` — Format Mapzen Terrarium : `elevation = (R * 256 + G + B / 256) - 32768`
- `"mapbox"` — Format Mapbox Terrain-RGB

**Valeur par défaut:** `"terrarium"`

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.terrain.demMaxZoom` (number, optionnel)

**Description:** Niveau de zoom maximum des tuiles DEM disponibles. MapLibre utilisera le zoom le plus élevé disponible pour les niveaux supérieurs.

**Valeurs possibles:** Nombre entier entre `0` et `20`

**Valeur par défaut:** `15`

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.terrain.exaggeration` (number, optionnel)

**Description:** Facteur d'exagération verticale du relief. Une valeur de `1.0` représente l'élévation réelle ; des valeurs supérieures accentuent le relief visuellement.

**Valeurs possibles:** `1.0`–`3.0` (valeur recommandée : `1.5`)

**Valeur par défaut:** `1.5`

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.terrain.default3D` (boolean, optionnel)

**Description:** Active automatiquement le terrain 3D dès que ce basemap est sélectionné. Pas de toggle UI requis : le terrain s'active au switch vers ce basemap et se désactive au switch vers un basemap sans terrain.

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `false`

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.terrain.pitch` (number, optionnel)

**Description:** Inclinaison initiale de la caméra (en degrés) lors de l'activation du terrain 3D. Appliqué au switch vers ce basemap quand `default3D: true`.

**Valeurs possibles:** `0`–`85` (doit être ≤ `map.maxPitch`)

**Valeur par défaut:** `45`

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.terrain.bearing` (number, optionnel)

**Description:** Rotation initiale de la vue (en degrés, sens des aiguilles d'une montre depuis le nord) lors de l'activation du terrain 3D.

**Valeurs possibles:** `0`–`359`

**Valeur par défaut:** `0` (nord en haut)

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.imageSource` (object, optionnel)

**Description:** Configuration d'une image géoréférencée statique. Requis quand `type: "image"`.

**Exemple:**

```json
{
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
```

**État:** ✅ Actif et fonctionnel (depuis v2.1.0)

---

#### `basemaps.{id}.imageSource.url` (string, obligatoire si type="image")

**Description:** URL de l'image à afficher. Doit être HTTP, HTTPS ou data URI.

**Valeurs possibles:** URL valide (`http://`, `https://`, `data:`)

**Valeur par défaut:** Aucune

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.imageSource.coordinates` (array, optionnel)

**Description:** Positions des 4 coins de l'image en `[lng, lat]`, dans l'ordre : Nord-Ouest, Nord-Est, Sud-Est, Sud-Ouest.

**Valeurs possibles:** Tableau de 4 paires `[lng, lat]` (WGS84)

**Valeur par défaut:** Limites monde `[[-180, 85.051129], [180, 85.051129], [180, -85.051129], [-180, -85.051129]]`

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.imageSource.opacity` (number, optionnel)

**Description:** Opacité de l'image.

**Valeurs possibles:** `0.0` (transparent) à `1.0` (opaque)

**Valeur par défaut:** `1`

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.hillshade` (object, optionnel)

**Description:** Configuration de l'ombrage de relief (hillshade). Requis quand `type: "hillshade"`.

**Exemple:**

```json
{
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
```

> **Note :** Si une source DEM `terrain-dem` (terrain 3D) est déjà présente avec la même `demUrl`, GeoLeaf la réutilise automatiquement au lieu d'en créer une seconde.

**État:** ✅ Actif et fonctionnel (depuis v2.1.0)

---

#### `basemaps.{id}.hillshade.demUrl` (string, obligatoire si type="hillshade")

**Description:** URL template du Modèle Numérique de Terrain (MNT) raster-dem.

**Valeurs possibles:** URL template avec `{z}/{x}/{y}`

**Valeur par défaut:** Aucune

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.hillshade.demEncoding` (string, optionnel)

**Description:** Encodage de l'altitude dans l'image MNT.

**Valeurs possibles:** `"terrarium"` | `"mapbox"` | `"custom"`

**Valeur par défaut:** `"terrarium"`

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.hillshade.demMaxZoom` (number, optionnel)

**Description:** Niveau de zoom maximum de la source DEM.

**Valeurs possibles:** Entier entre 1 et 20

**Valeur par défaut:** `15`

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.hillshade.shadowColor` (string, optionnel)

**Description:** Couleur des zones d'ombre.

**Valeurs possibles:** Couleur CSS hexadécimale ou nom de couleur

**Valeur par défaut:** `"#000000"`

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.hillshade.highlightColor` (string, optionnel)

**Description:** Couleur des zones éclairées.

**Valeurs possibles:** Couleur CSS hexadécimale ou nom de couleur

**Valeur par défaut:** `"#ffffff"`

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.hillshade.accentColor` (string, optionnel)

**Description:** Couleur d'accentuation (bordures et contours).

**Valeurs possibles:** Couleur CSS hexadécimale ou nom de couleur

**Valeur par défaut:** `"#000000"`

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.hillshade.exaggeration` (number, optionnel)

**Description:** Intensité du relief ombré.

**Valeurs possibles:** `0.0` (plat) à `1.0` (maximum)

**Valeur par défaut:** `0.5`

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.hillshade.illuminationDirection` (number, optionnel)

**Description:** Direction de la source lumineuse en degrés.

**Valeurs possibles:** `0`–`359`

**Valeur par défaut:** `335`

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.hillshade.illuminationAnchor` (string, optionnel)

**Description:** Référentiel de la direction lumineuse.

**Valeurs possibles:** `"viewport"` (suit la rotation de la carte) | `"map"` (fixé sur le nord géographique)

**Valeur par défaut:** `"viewport"`

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.wmts` (object, optionnel)

**Description:** Configuration d'un service OGC WMTS avec résolution dynamique. Requis quand `type: "wmts"`.

**Exemple:**

```json
{
    "wmts": {
        "getCapabilitiesUrl": "https://wxs.ign.fr/essentiels/geoportail/wmts?SERVICE=WMTS&REQUEST=GetCapabilities",
        "layer": "ORTHOIMAGERY.ORTHOPHOTOS",
        "tileMatrixSet": "PM",
        "format": "image/jpeg"
    }
}
```

> **Note :** GeoLeaf récupère le document `GetCapabilities` au premier affichage du basemap, extrait l'URL template de tuiles et la met en cache pour les switches ultérieurs. Si la requête échoue, le basemap n'est pas affiché et un warning est émis en console.

**État:** ✅ Actif et fonctionnel (depuis v2.1.0)

---

#### `basemaps.{id}.wmts.getCapabilitiesUrl` (string, obligatoire si type="wmts")

**Description:** URL complète du document GetCapabilities OGC WMTS.

**Valeurs possibles:** URL valide (`http://`, `https://`)

**Valeur par défaut:** Aucune

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.wmts.layer` (string, optionnel)

**Description:** Identifiant de la couche WMTS à utiliser.

**Valeurs possibles:** Chaîne correspondant à l'`Identifier` d'une couche dans le GetCapabilities

**Valeur par défaut:** Première couche disponible dans le GetCapabilities

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.wmts.tileMatrixSet` (string, optionnel)

**Description:** TileMatrixSet à utiliser pour les tuiles.

**Valeurs possibles:** Identifiant valide dans le GetCapabilities (ex: `"PM"`, `"GoogleMapsCompatible"`, `"EPSG:3857"`)

**Valeur par défaut:** `"GoogleMapsCompatible"`

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.wmts.format` (string, optionnel)

**Description:** Format MIME des tuiles WMTS.

**Valeurs possibles:** `"image/png"` | `"image/jpeg"` | `"image/webp"`

**Valeur par défaut:** `"image/png"`

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.wms` (object, optionnel)

**Description:** Configuration d'un service OGC WMS (flux raster). Requis quand `type: "wms"`.

**Exemple:**

```json
{
    "wms": {
        "url": "https://wxs.ign.fr/essentiels/geoportail/r/wms",
        "layers": "ORTHOIMAGERY.ORTHOPHOTOS",
        "version": "1.3.0",
        "crs": "EPSG:3857",
        "format": "image/jpeg",
        "tileSize": 256
    }
}
```

**État:** ✅ Actif et fonctionnel (depuis v2.1.0)

---

#### `basemaps.{id}.wms.url` (string, obligatoire si type="wms")

**Description:** URL de base du serveur WMS (sans paramètres de requête).

**Valeurs possibles:** URL valide (`http://`, `https://`)

**Valeur par défaut:** Aucune

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.wms.layers` (string, obligatoire si type="wms")

**Description:** Nom(s) de couche(s) WMS, séparés par virgule.

**Exemple:** `"ORTHOIMAGERY.ORTHOPHOTOS"` ou `"couche1,couche2"`

**Valeur par défaut:** Aucune

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.wms.version` (string, optionnel)

**Description:** Version du protocole WMS.

**Valeurs possibles:** `"1.1.1"` | `"1.3.0"`

**Valeur par défaut:** `"1.3.0"`

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.wms.crs` (string, optionnel)

**Description:** Système de coordonnées des requêtes WMS.

**Valeurs possibles:** Identifiant EPSG (ex: `"EPSG:3857"`, `"EPSG:4326"`)

**Valeur par défaut:** `"EPSG:3857"`

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.wms.format` (string, optionnel)

**Description:** Format MIME des images WMS.

**Valeurs possibles:** `"image/png"` | `"image/jpeg"` | `"image/webp"`

**Valeur par défaut:** `"image/png"`

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.wms.tileSize` (number, optionnel)

**Description:** Taille des tuiles de requête WMS en pixels.

**Valeurs possibles:** `256` | `512`

**Valeur par défaut:** `256`

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.wms.transparent` (boolean, optionnel)

**Description:** Demande des images WMS avec fond transparent (PNG uniquement).

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `false`

**État:** ✅ Actif et fonctionnel

---

#### `basemaps.{id}.wms.styles` (string, optionnel)

**Description:** Style WMS à appliquer (paramètre `STYLES` de la requête WMS).

**Valeurs possibles:** Identifiant de style valide côté serveur, ou chaîne vide

**Valeur par défaut:** `""` (style par défaut serveur)

**État:** ✅ Actif et fonctionnel

---

## Section performance

### `performance` (object, optionnel)

**Description:** Paramètres d'optimisation de performance pour le chargement des couches.

**État:** ✅ Actif et fonctionnel

---

#### `performance.maxConcurrentLayers` (number, optionnel)

**Description:** Nombre maximum de couches pouvant être chargées en parallèle.

**Utilisation dans le code:**

```javascript
// themes/theme-applier.js ligne 102

const maxLayers = perfConfig.maxConcurrentLayers || 10;
```

**Fichiers source:**

- src/modules/themes/theme-applier.js ligne 102

**Valeurs possibles:** Nombre entier > 0 (généralement 5-15)

**Valeur par défaut:** `10`

**État:** ✅ Actif et fonctionnel

---

#### `performance.layerLoadDelay` (number, optionnel)

**Description:** Délai en millisecondes entre le chargement de chaque couche pour éviter la surcharge.

**Utilisation dans le code:**

```javascript
// themes/theme-applier.js ligne 103

const loadDelay = perfConfig.layerLoadDelay || 200;
```

**Fichiers source:**

- src/modules/themes/theme-applier.js ligne 103

**Valeurs possibles:** Nombre entier en millisecondes (généralement 100-500)

**Valeur par défaut:** `200`

**État:** ✅ Actif et fonctionnel

---

#### `performance.fitBoundsOnThemeChange` (boolean, optionnel)

**Description:** Ajuste automatiquement la vue de la carte aux limites des données lors du changement de thème.

**Utilisation dans le code:**

```javascript
// themes/theme-applier.js ligne 104

const enableFitBounds = perfConfig.fitBoundsOnThemeChange !== false;
```

**Fichiers source:**

- src/modules/themes/theme-applier.js ligne 104

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `false`

**État:** ✅ Actif et fonctionnel

---

## Section search

> **Note v2.0.0 :** Ces paramètres sont désormais dans `ui.json` sous la clé `searchConfig`. La clé `search` reste acceptée inline dans `profile.json` pour la rétrocompatibilité. Dans `ui.json`, utiliser `searchConfig` (voir [CONFIGURATION_GUIDE.md — searchConfig](CONFIGURATION_GUIDE.md)).

### `search` (object, optionnel)

**Description:** Configuration du panneau de recherche et de filtrage des POI.

**Note:** Supporte aussi l'ancien format `profile.panels.search` pour la rétrocompatibilité.

**Utilisation dans le code:**

```javascript
// ui/filter-panel/renderer.js ligne 52

const searchPanel = (profile.panels && profile.panels.search) || profile.search;
```

**Fichiers source:**

- `renderer.ts` ligne 51-52

- `filter-control-builder.ts` ligne 385

**État:** ✅ Actif et fonctionnel

---

#### `search.title` (string, optionnel)

**Description:** Titre du panneau de filtrage.

**Utilisation dans le code:**

```javascript
// ui/filter-panel/renderer.js ligne 93

textContent: searchPanel.title || "Filtres";
```

**Fichiers source:**

- `renderer.ts` ligne 93

**Valeurs possibles:** Chaîne de caractères libre

**Valeur par défaut:** `"Filtres"`

**État:** ✅ Actif et fonctionnel

---

#### `search.radiusMin` (number, optionnel)

**Description:** Rayon minimum (en km) pour la recherche par proximité.

**Utilisation dans le code:**

```javascript
// ui/filter-control-builder.js ligne 387

if (typeof searchConfig.radiusMin === "number" && searchConfig.radiusMin > 0) {
    minRadius = searchConfig.radiusMin;
}
```

**Fichiers source:**

- `filter-control-builder.ts` ligne 387

**Valeurs possibles:** Nombre > 0 (généralement 1-10)

**Valeur par défaut:** `1`

**État:** ✅ Actif et fonctionnel

---

#### `search.radiusMax` (number, optionnel)

**Description:** Rayon maximum (en km) pour la recherche par proximité.

**Utilisation dans le code:**

```javascript
// ui/filter-control-builder.js ligne 390

if (typeof searchConfig.radiusMax === "number" && searchConfig.radiusMax > 0) {
    maxRadius = searchConfig.radiusMax;
}
```

**Fichiers source:**

- `filter-control-builder.ts` ligne 390

**Valeurs possibles:** Nombre > `radiusMin` (généralement 50-100)

**Valeur par défaut:** `50`

**État:** ✅ Actif et fonctionnel

---

#### `search.radiusStep` (number, optionnel)

**Description:** Pas d'incrémentation pour le curseur de rayon de recherche.

**Utilisation dans le code:**

```javascript
// ui/filter-control-builder.js ligne 393

if (typeof searchConfig.radiusStep === "number" && searchConfig.radiusStep > 0) {
    stepRadius = searchConfig.radiusStep;
}
```

**Fichiers source:**

- `filter-control-builder.ts` ligne 393

**Valeurs possibles:** Nombre > 0 (généralement 1-5)

**Valeur par défaut:** `1`

**État:** ✅ Actif et fonctionnel

---

#### `search.radiusDefault` (number, optionnel)

**Description:** Rayon par défaut (en km) pour la recherche par proximité.

**Utilisation dans le code:**

```javascript
// ui/filter-control-builder.js ligne 396

if (typeof searchConfig.radiusDefault === "number" && searchConfig.radiusDefault > 0) {
    defaultRadius = searchConfig.radiusDefault;
}
```

**Fichiers source:**

- `filter-control-builder.ts` ligne 396

**Valeurs possibles:** Nombre entre `radiusMin` et `radiusMax` (généralement 10-20)

**Valeur par défaut:** `10`

**État:** ✅ Actif et fonctionnel

---

#### `search.searchPlaceholder` (string, optionnel)

**Description:** Texte de placeholder pour le champ de recherche textuelle.

**Valeurs possibles:** Chaîne de caractères libre

**Valeur par défaut:** `"Rechercher un POI..."`

**État:** ✅ Actif et fonctionnel

---

#### `search.filters` (array, optionnel)

**Description:** Liste des filtres disponibles dans le panneau de recherche.

**Structure de chaque filtre:**

```json
{
    "id": "string",

    "type": "string",

    "label": "string",

    "placeholder": "string",

    "searchFields": ["string"],

    "buttonLabel": "string",

    "instructionText": "string",

    "field": "string"
}
```

**Types de filtres disponibles:**

- `"search"` - Recherche textuelle

- `"proximity"` - Recherche par proximité géographique

- `"tree"` - Arbre de catégories

- `"multiselect-tags"` - Sélection multiple de tags

**Utilisation dans le code:**

```javascript
// ui/filter-panel/renderer.js ligne 55

const filters = searchPanel && Array.isArray(searchPanel.filters) ? searchPanel.filters : null;
```

**Fichiers source:**

- `renderer.ts` ligne 55

- `filter-control-builder.ts`

**État:** ✅ Actif et fonctionnel

---

#### `search.actions` (object, optionnel)

**Description:** Labels des boutons d'action du panneau de filtrage.

**Structure:**

```json
{
    "applyLabel": "string",

    "resetLabel": "string"
}
```

**Valeurs par défaut:**

- `applyLabel`: `"Appliquer"`

- `resetLabel`: `"Réinitialiser"`

**État:** ✅ Actif et fonctionnel

---

## Section layerManagerConfig

> **Note v2.0.0 :** Ces paramètres sont désormais dans `ui.json`. Ils restent acceptés inline dans `profile.json` pour la rétrocompatibilité.

### `layerManagerConfig` (object, optionnel)

**Description:** Configuration du gestionnaire de couches.

**Utilisation dans le code:**

```javascript
// geoleaf.layer-manager.ts ligne 149

const layerManagerConfig = GeoLeaf.Config.get("layerManagerConfig");
```

**Fichiers source:**

- `geoleaf.layer-manager.ts` ligne 149

**État:** ✅ Actif et fonctionnel

---

#### `layerManagerConfig.title` (string, optionnel)

**Description:** Titre du gestionnaire de couches.

**Valeurs possibles:** Chaîne de caractères libre

**Valeur par défaut:** `"Couches"`

**État:** ✅ Actif et fonctionnel

---

#### `layerManagerConfig.collapsedByDefault` (boolean, optionnel)

**Description:** État replié initial du gestionnaire de couches.

**Utilisation dans le code:**

```javascript
// geoleaf.layer-manager.ts ligne 152

collapsed: layerManagerConfig?.collapsedByDefault;
```

**Fichiers source:**

- `geoleaf.layer-manager.ts` ligne 152

- `control.ts` ligne 111

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `true`

**État:** ✅ Actif et fonctionnel

---

#### `layerManagerConfig.sections` (array, optionnel)

**Description:** Liste des sections du gestionnaire de couches.

**Structure de chaque section:**

```jsonc

{

  "id": "string",

  "label": "string",

  "order": number,

  "collapsedByDefault": boolean

}

```

**Utilisation dans le code:**

```javascript
// geoleaf.layer-manager.ts ligne 173

collapsedByDefault: s.collapsedByDefault;
```

**Fichiers source:**

- `geoleaf.layer-manager.ts` ligne 162-176

- `renderer.ts` ligne 61-62

**État:** ✅ Actif et fonctionnel

---

## Section modules.legend

> ⚠️ **Migration cassante (S10/F2, capacité `legend`).** La légende ne vit plus sous le flag `ui.showLegend` ni le bloc racine `legendConfig` mais sous **`modules.legend`** — fichier `config/plugins/legend.json` référencé par `Files.modules.legend`. La légende reste **intégrée au core** — ce n'est pas un plugin externe. Elle est déclarée auprès du `CapabilityRegistry` et introspectable via `GeoLeaf.Introspection.getCapabilitySchema("legend")`. La façade publique `GeoLeaf.Legend` est **inchangée**.

> ℹ️ **Config réveillée.** `title`, `position` et `collapsedByDefault` étaient auparavant morts (ignorés, écrasés par des défauts internes du contrôle). Sous `modules.legend`, ils sont désormais **réellement lus et appliqués** : un profil qui portait ces clés (ancien `legendConfig`) verra sa légende avec le titre, la position et l'état replié configurés.

> **Événement :** au premier montage du contrôle, la légende émet une fois `geoleaf:legend:ready` (payload `{ position, layerCount }`).

### `modules.legend` (object, optionnel)

**Description:** Configuration de la capacité de légende cartographique.

**Utilisation dans le code:**

```javascript
// capabilities/legend/config.ts

const raw = Config.get("modules.legend", {});
```

**Fichiers source:**

- `capabilities/legend/config.ts`

- `capabilities/legend/legend-capability.ts`

**État:** ✅ Actif et fonctionnel

---

#### `modules.legend.enabled` (boolean, optionnel)

**Description:** Active ou désactive la légende (gate de la capacité, **opt-out** — ex-`ui.showLegend`). Absente ⟹ active.

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `true`

**État:** ✅ Actif et fonctionnel

---

#### `modules.legend.title` (string, optionnel)

**Description:** Titre de la légende (ex-`legendConfig.title`).

**Valeurs possibles:** Chaîne de caractères libre

**Valeur par défaut:** `"Legend"`

**État:** ✅ Actif et fonctionnel

---

#### `modules.legend.collapsedByDefault` (boolean, optionnel)

**Description:** État replié initial de la légende (ex-`legendConfig.collapsedByDefault`).

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `false`

**État:** ✅ Actif et fonctionnel

---

#### `modules.legend.position` (string, optionnel)

**Description:** Position de la légende sur la carte (ex-`legendConfig.position`).

**Valeurs possibles:**

- `"topleft"`

- `"topright"`

- `"bottomleft"`

- `"bottomright"`

**Valeur par défaut:** `"bottomleft"`

**État:** ✅ Actif et fonctionnel

---

## Section poiConfig

### `poiConfig` (object, optionnel)

**Description:** Configuration des Points d'Intérêt (POI) et de leur clustering.

**Utilisation dans le code:**

```javascript
// geojson/clustering.js ligne 25

return Config.get("poiConfig") || {};
```

**Fichiers source:**

- `clustering.ts` ligne 25

**État:** ✅ Actif et fonctionnel

---

#### `poiConfig.enabled` (boolean, optionnel)

**Description:** Active ou désactive le système de POI.

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `false`

**État:** ✅ Actif et fonctionnel

---

#### `poiConfig.clustering` (boolean, optionnel)

**Description:** Active le regroupement visuel (clustering) des marqueurs POI.

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `true`

**État:** ✅ Actif et fonctionnel

---

#### `poiConfig.clusterRadius` (number, optionnel)

**Description:** Rayon en pixels en dessous duquel deux marqueurs sont regroupés dans un cluster.

**Valeur par défaut:** `80`

**État:** ✅ Actif et fonctionnel

---

#### `poiConfig.disableClusteringAtZoom` (number, optionnel)

**Description:** Niveau de zoom à partir duquel le clustering est désactivé (les marqueurs individuels s'affichent).

**Valeur par défaut:** `12`

**État:** ✅ Actif et fonctionnel

---

#### `poiConfig.clusterStrategy` (string, optionnel)

**Description:** Stratégie de clustering des POI.

**Utilisation dans le code:**

```javascript
// geojson/clustering.js ligne 123

const strategy = poiConfig.clusterStrategy || "unified";
```

**Fichiers source:**

- `clustering.ts` ligne 123, 131

- `loader.ts` ligne 495

**Valeurs possibles:**

- `"unified"` - Cluster unique partagé entre toutes les couches (défaut)

- `"by-source"` - Cluster indépendant par source de données

**Valeur par défaut:** `"unified"`

**État:** ✅ Actif et fonctionnel

**Tests:**

- [\_\_tests\_\_/geojson/geojson-layers.test.js](../__tests__/geojson/geojson-layers.test.js) ligne 373

---

## Section brandingConfig

> **Note v2.0.0 :** Ces paramètres sont désormais dans `ui.json`. Ils restent acceptés inline dans `profile.json` pour la rétrocompatibilité.

### `brandingConfig` (object, optionnel)

**Description:** Configuration du bandeau d'attribution/branding.

**Utilisation dans le code:**

```javascript
// ui/branding.js ligne 72

const brandingConfig = GeoLeaf.Config?.get("brandingConfig");
```

**Fichiers source:**

- `branding.ts` ligne 72

**État:** ✅ Actif et fonctionnel

---

#### `brandingConfig.enabled` (boolean, optionnel)

**Description:** Active/désactive le bandeau de branding.

**Utilisation dans le code:**

```javascript
// ui/branding.js ligne 74

if (brandingConfig === false || (brandingConfig && brandingConfig.enabled === false)) {
    return;
}
```

**Fichiers source:**

- `branding.ts` ligne 74

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `true`

**État:** ✅ Actif et fonctionnel

---

#### `brandingConfig.text` (string, optionnel)

**Description:** Texte du bandeau de branding (HTML autorisé).

**Utilisation dans le code:**

```javascript
// ui/branding.js ligne 82

this._options.text = brandingConfig.text;
```

**Fichiers source:**

- `branding.ts` ligne 81-82

**Valeurs possibles:** Chaîne HTML

**Valeur par défaut:** `"Propulsé par © GeoLeaf"`

**État:** ✅ Actif et fonctionnel

---

#### `brandingConfig.position` (string, optionnel)

**Description:** Position du bandeau de branding sur la carte.

**Utilisation dans le code:**

```javascript
// ui/branding.js ligne 85

this._options.position = brandingConfig.position;
```

**Fichiers source:**

- `branding.ts` ligne 84-85

**Valeurs possibles:**

- `"topleft"`

- `"topright"`

- `"bottomleft"`

- `"bottomright"`

**Valeur par défaut:** `"bottomleft"`

**État:** ✅ Actif et fonctionnel

---

## Section tableConfig — extrait du core

> ℹ️ Le tableau de données a été extrait du core vers le plugin MIT `@geoleaf-plugins/table`. Voir le README du plugin pour l'installation, la configuration (`modules.table.*`) et la migration.

---

## Section scaleConfig

> **Note v2.0.0 :** Ces paramètres sont désormais dans `ui.json`. Ils restent acceptés inline dans `profile.json` pour la rétrocompatibilité.

### `scaleConfig` (object, optionnel)

**Description:** Configuration du contrôle d'échelle de la carte.

**Utilisation dans le code:**

```javascript

// map/scale-control.js ligne 435

? GeoLeaf.Config.get('scaleConfig')

```

**Fichiers source:**

- `scale-control.ts` ligne 435

**Documentation:**

- [docs/config/SCALE_CONFIG.md](../docs/config/SCALE_CONFIG.md)

**État:** ✅ Actif et fonctionnel

---

#### `scaleConfig.scaleGraphic` (boolean, optionnel)

**Description:** Affiche l'échelle graphique (barre graduée).

**Utilisation dans le code:**

```javascript

// map/scale-control.js ligne 59

if (this._config.scaleGraphic !== false) {

```

**Fichiers source:**

- `scale-control.ts` ligne 59, 438

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `true`

**État:** ✅ Actif et fonctionnel

---

#### `scaleConfig.scaleNumeric` (boolean, optionnel)

**Description:** Affiche l'échelle numérique (ratio 1:xxxxx).

**Utilisation dans le code:**

```javascript

// map/scale-control.js ligne 65

if (this._config.scaleNumeric || this._config.scaleNivel) {

```

**Fichiers source:**

- `scale-control.ts` ligne 65, 160, 438

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `true`

**État:** ✅ Actif et fonctionnel

---

#### `scaleConfig.scaleNumericEditable` (boolean, optionnel)

**Description:** Permet l'édition manuelle de l'échelle numérique (zoom direct).

**Prérequis:** `scaleNumeric: true`

**Utilisation dans le code:**

```javascript

// map/scale-control.js ligne 161

if (this._config.scaleNumericEditable) {

```

**Fichiers source:**

- `scale-control.ts` ligne 161, 285

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `true`

**État:** ✅ Actif et fonctionnel

---

#### `scaleConfig.scaleNivel` (boolean, optionnel)

**Description:** Affiche l'indicateur de niveau de zoom.

**Utilisation dans le code:**

```javascript

// map/scale-control.js ligne 169

if (this._config.scaleNivel) {

```

**Fichiers source:**

- `scale-control.ts` ligne 65, 169, 438

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `true`

**État:** ✅ Actif et fonctionnel

---

#### `scaleConfig.position` (string, optionnel)

**Description:** Position du contrôle d'échelle sur la carte.

**Valeurs possibles:**

- `"topleft"`

- `"topright"`

- `"bottomleft"`

- `"bottomright"`

**Valeur par défaut:** `"bottomleft"`

**État:** ✅ Actif et fonctionnel

---

## Section storage

### `storage` (object, optionnel)

**Description:** Configuration du système de stockage et cache hors ligne.

**État:** ✅ Actif et fonctionnel

---

#### `storage.enableOfflineDetector` (boolean, optionnel)

**Description:** Active la détection de la connectivité réseau (mode hors ligne). Affiche une notification quand la connexion est perdue ou rétablie.

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `false`

**État:** ✅ Actif et fonctionnel

---

#### ~~`storage.enableServiceWorker`~~ — RETIRÉE le 03/08/2026

**Description :** cette clé n'existe plus. Elle était **déclarée ici, jamais posée par aucun
profil** (`grep -rl enableServiceWorker profiles/` → 0) et sa seule lecture était un
avertissement de démarrage qui ne s'est donc jamais déclenché. Son texte promettait en outre un
« Service Worker complémentaire » et un « background sync » que ce dépôt n'a jamais eus.

**Ce qui est vrai à la place :** le Service Worker (`sw-core.js`) est enregistré **au démarrage,
inconditionnellement**, par la capacité `pwa` — il n'y a rien à activer. La mise en cache
hors-ligne se règle par `modules.offline.enabled` et le bloc `modules.offline.cache`.

**État :** 🗑 supprimée du code, des schémas et des profils.

---

#### `storage.cache` (object, optionnel)

**Description:** Configuration du cache hors ligne.

---

##### `storage.cache.enableProfileCache` (boolean, optionnel)

**Description:** Active le cache des ressources du profil (fichiers JSON, GeoJSON).

**Utilisation dans le code:**

```javascript
// storage/cache/layer-selector.js ligne 97

const profileCacheEnabled = Config.get("storage.cache.enableProfileCache", false);
```

**Fichiers source:**

- src/modules/storage/cache/layer-selector.js ligne 97

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `true`

**État:** ✅ Actif et fonctionnel

---

##### `storage.cache.enableTileCache` (boolean, optionnel)

**Description:** Active le cache des tuiles des fonds de carte.

**Utilisation dans le code:**

```javascript
// storage/cache/layer-selector.js ligne 98

const tileCacheEnabled = Config.get("storage.cache.enableTileCache", false);
```

**Fichiers source:**

- src/modules/storage/cache/layer-selector.js ligne 98, 653

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `true`

**État:** ✅ Actif et fonctionnel

---

## Section poiAddConfig

> **Note v2.0.0 :** Ces paramètres sont désormais dans `ui.json`. Ils restent acceptés inline dans `profile.json` pour la rétrocompatibilité.

### `poiAddConfig` (object, optionnel)

**Description:** Configuration de la fonctionnalité d'ajout de POI par l'utilisateur.

**État:** ✅ Actif et fonctionnel

---

#### `poiAddConfig.enabled` (boolean, optionnel)

**Description:** Active/désactive la fonctionnalité d'ajout de POI.

**Valeurs possibles:** `true` | `false`

**Valeur par défaut:** `true`

**État:** ✅ Actif et fonctionnel

---

#### `poiAddConfig.defaultPosition` (string, optionnel)

**Description:** Méthode par défaut pour positionner un nouveau POI.

**Utilisation dans le code:**

```javascript
// ui/controls.js ligne 532

const defaultPosition = config?.poiAddConfig?.defaultPosition || "placement-mode";
```

**Fichiers source:**

- `controls.ts` ligne 532, 534

**Valeurs possibles:**

- `"geolocation"` - Utilise la position GPS de l'utilisateur

- `"placement-mode"` - Mode placement manuel sur la carte (clic)

- `"map-center"` - Centre actuel de la carte

**Valeur par défaut:** `"placement-mode"`

**État:** ✅ Actif et fonctionnel

**Tests:**

- Voir les tests unitaires dans `__tests__/poi/`

---

## Section geocodingConfig

> ⚠️ **Extrait vers un plugin.** La recherche d'adresse (géocodage) n'est plus dans `@geoleaf/core` — elle est désormais fournie par le plugin MIT **`@geoleaf-plugins/geocoding`** (npmjs.org public). La configuration migre de la clé racine **`geocodingConfig`** vers **`modules.geocoding.*`** (déclarée dans `config/plugins/geocoding.json` via `Files.modules.geocoding`) — migration **cassante, sans shim**. L'API `GeoLeaf.Geocoding`, l'événement `geoleaf:geocoding:result` et le contrôle de recherche sont fournis par le plugin. Voir le README du plugin (`packages/plugins/geocoding/README.md`).

---

Ces paramètres existent dans le code pour assurer la rétrocompatibilité mais ne devraient plus être utilisés dans les nouveaux profils.

### ⚠️ `panels` (object, déprécié)

**Raison de dépréciation:** Remplacé par la structure plate au premier niveau

**Ancien format:**

```jsonc
{
    "panels": {
        "search": {
            /* config */
        },

        "detail": {
            /* config */
        },

        "route": {
            /* config */
        },

        "poi": {
            /* config */
        },
    },
}
```

**Nouveau format:**

```jsonc
{
    "search": {
        /* config */
    },
}
```

**Support actuel:**

```javascript
// ui/filter-panel/renderer.js ligne 52

const searchPanel = (profile.panels && profile.panels.search) || profile.search;
```

**État:** ⚠️ Supporté pour rétrocompatibilité mais déprécié

**Migration:** Déplacer `profile.panels.search` vers `profile.search`

---

### ⚠️ `defaultSettings.routeConfig` (object, déprécié)

**Raison de dépréciation:** Configuration de routes déplacée vers un autre système

**Utilisation dans le code:**

```javascript

// geoleaf.route.ts ligne 371

if (activeProfile && activeProfile.defaultSettings && activeProfile.defaultSettings.routeConfig) {

```

**Fichiers source:**

- `geoleaf.route.ts` ligne 371-384

**État:** ⚠️ Supporté pour rétrocompatibilité

---

### ℹ️ Flags de mapping (rétrocompatibilité)

Ces paramètres ne sont PAS dans profile.json mais dans la configuration racine (geoleaf.config.tson ou dans `config.data`).

**Noms supportés (par ordre de priorité):**

1. `config.data.enableProfilePoiMapping` ✅ **Recommandé** (utiliser celui-ci)

2. `config.data.useProfilePoiMapping` ⚠️ Déprécié — utiliser `enableProfilePoiMapping`

3. `config.data.useMapping` ⚠️ Déprécié — utiliser `enableProfilePoiMapping`

**Utilisation dans le code:**

```javascript

// config/profile.js ligne 87-101

isProfilePoiMappingEnabled() {

    // Cherche plusieurs noms pour rétrocompatibilité (priorité décroissante)

    if (typeof dataCfg.enableProfilePoiMapping === "boolean") {

        return dataCfg.enableProfilePoiMapping;  // Préféré

    }

    if (typeof dataCfg.useProfilePoiMapping === "boolean") {

        return dataCfg.useProfilePoiMapping;     // Fallback

    }

    if (typeof dataCfg.useMapping === "boolean") {

        return dataCfg.useMapping;               // Fallback

    }

    return true;

}

```

**Fichiers source:**

- `profile.ts` ligne 87-101

**État:** ✅ Supportés pour rétrocompatibilité, mais utiliser `enableProfilePoiMapping`

---

## Paramètres manquants dans profile.json

CesArchitecture des fichiers de configuration

Cette section clarifie la structure et l'organisation des fichiers de configuration dans GeoLeaf pour éviter toute confusion entre les différents fichiers.

### 📁 Hiérarchie des fichiers de configuration

```
profiles/{profile-name}/                      (layout v2 — 2026-06)
├── profile.json                              ← Identité + map + manifeste Files (THIS FILE)
├── config/
│   ├── core/
│   │   ├── taxonomy.json                     ← Catégories, tags, métadonnées
│   │   ├── themes.json                       ← Présets de visibilité des couches
│   │   ├── layers.json                       ← Définition des couches GeoJSON
│   │   ├── basemaps.json                     ← Fonds de carte
│   │   ├── ui.json                           ← Contrôles UI, recherche, échelle
│   │   └── features.json                     ← Clustering, géocodage, performance, POI
│   └── plugins/
│       └── {module-id}.json                  ← Config par plugin (bloc modules.<id>)
└── [layers/, icons/, data/]

geoleaf.config.json                           ← Configuration globale de l'application (ROOT)
```

### 🔄 Responsabilités de chaque fichier

#### **profile.json** (Ce fichier)

- ✅ Configuration **UI**: Visibilité des composants, thèmes, langues

- ✅ Configuration **Performance**: Limites de chargement, délais

- ✅ Configuration **Basemaps**: Fonds de carte disponibles

- ✅ Configuration **Composants**: Tables, légende, gestionnaire de couches

- ✅ Configuration **Filtres/Recherche**: Paramètres de recherche et filtrage

- ✅ **Références** vers taxonomie/thèmes/couches (via `Files`)

- ⚠️ `defaultSettings.routeConfig` : Configuration de routage (déprécié)

#### **taxonomy.json**

- ✅ Catégories et hiérarchie

- ✅ **Métadonnées des icônes** (sprites, formats)

- ✅ Tags et classifications

- ✅ Propriétés de couches non spatiales

#### **themes.json**

- ✅ Presets de visibilité (groupes de couches)

- ✅ Thèmes cartographiques

- ✅ Configurations de styles alternatifs (par thème)

#### **layers.json**

- ✅ Définitions GeoJSON des couches

- ✅ **Métadonnées de chaque couche**: Styles, icônes, attributs

- ✅ Configuration spécifique par couche

- ✅ Chemins vers fichiers de données

### 🎨 Où vit chaque paramètre?

| Paramètre | Fichier | Utilisation |

| ----------------------------- | ----------------- | -------------------------------------------- |

| `icons` | **taxonomy.json** | Métadonnées des sprites/icônes |

| `stylesConfig` | **profile.json** | Configuration globale des styles alternatifs |

| `Directory` | **layers.json** | Templates de chemins (définis par couche) |

| `defaultSettings.routeConfig` | **profile.json** | Configuration de routage (déprécié) |

| `ui.*` | **profile.json** | Configuration UI |

| `basemaps` | **profile.json** | Fonds de carte |

| Tous les autres | **profile.json** | Voir section structure |

### ✅ Validation

- profile.json contient **uniquement** les paramètres documentés dans ce fichier

- Chaque paramètre a un usage clair et vérifié dans le code source

- Aucun paramètre "fantôme" ou inutilisé

- Architecture cohérente et maintenabl

## Tableau récapitulatif

| Section | Paramètre | Type | Défaut | État | Obligatoire |

| ------------------ | ------------------------ | ------- | ---------------- | ---- | ----------- |

| Racine | `id` | string | - | ✅ | Oui |

| Racine | `label` | string | - | ✅ | Oui |

| Racine | `description` | string | "" | ✅ | Non |

| Racine | `version` | string | "1.0.0" | ✅ | Non |

| Files | `themesFile` | string | "config/core/themes.json" | ✅ | Oui |

| Files | `featuresFile` | string | "config/core/features.json" | ✅ | Non |

| Files | `modules` | object | `{ "<moduleId>": "config/plugins/<moduleId>.json" }` | ✅ | Non |

| Files | `layersFile` | string | "layers.json" | ✅ | Non |

| ui | `theme` | string | "light" | ✅ | Non |

| ui | `language` | string | "fr" | ⚠️ | Non |

| ui | `showBaseLayerControls` | boolean | false | ✅ | Non |

| ui | `showLayerManager` | boolean | true | ✅ | Non |

| ui | `showFilterPanel` | boolean | true | ✅ | Non |

| ui | `showGeolocation` | boolean | true | ✅ | Non |
| ui | `showScale` | boolean | true | ✅ | Non |

| ui | `showCoordinates` | boolean | true | ✅ | Non |

| ui | `showLegend` | boolean | true | ✅ | Non |

| ui | `showCacheButton` | boolean | false | ✅ | Non |

| ui | `showAddPoi` | boolean | false | ✅ | Non |

| ui | `interactiveShapes` | boolean | false | ✅ | Non |

| basemaps | `{id}.id` | string | - | ✅ | Oui |

| basemaps | `{id}.label` | string | - | ✅ | Oui |

| basemaps | `{id}.url` | string | - | ✅ | Oui |

| basemaps | `{id}.attribution` | string | - | ✅ | Oui |

| basemaps | `{id}.minZoom` | number | 0 | ✅ | Non |

| basemaps | `{id}.maxZoom` | number | 19 | ✅ | Non |

| basemaps | `{id}.defaultBasemap` | boolean | false | ✅ | Non |

| basemaps | `{id}.offline` | boolean | false | ✅ | Non |

| basemaps | `{id}.offlineBounds` | object | - | ✅ | Non |

| basemaps | `{id}.cacheMinZoom` | number | 4 | ✅ | Non |

| basemaps | `{id}.cacheMaxZoom` | number | 12 | ✅ | Non |

| performance | `maxConcurrentLayers` | number | 10 | ✅ | Non |

| performance | `layerLoadDelay` | number | 200 | ✅ | Non |

| performance | `fitBoundsOnThemeChange` | boolean | false | ✅ | Non |

| search | `title` | string | "Filtres" | ✅ | Non |

| search | `radiusMin` | number | 1 | ✅ | Non |

| search | `radiusMax` | number | 50 | ✅ | Non |

| search | `radiusStep` | number | 1 | ✅ | Non |

| search | `radiusDefault` | number | 10 | ✅ | Non |

| search | `searchPlaceholder` | string | "Rechercher..." | ✅ | Non |

| search | `filters` | array | [] | ✅ | Non |

| search | `actions` | object | {...} | ✅ | Non |

| layerManagerConfig | `title` | string | "Couches" | ✅ | Non |

| layerManagerConfig | `collapsedByDefault` | boolean | true | ✅ | Non |

| layerManagerConfig | `sections` | array | [] | ✅ | Non |

| modules.legend | `enabled` | boolean | true | ✅ | Non |

| modules.legend | `title` | string | "Legend" | ✅ | Non |

| modules.legend | `collapsedByDefault` | boolean | false | ✅ | Non |

| modules.legend | `position` | string | "bottomleft" | ✅ | Non |

| poiConfig | `clusterStrategy` | string | "unified" | ✅ | Non |

| brandingConfig | `enabled` | boolean | true | ✅ | Non |

| brandingConfig | `text` | string | "..." | ✅ | Non |

| brandingConfig | `position` | string | "bottomleft" | ✅ | Non |

| scaleConfig | `scaleGraphic` | boolean | true | ✅ | Non |

| scaleConfig | `scaleNumeric` | boolean | true | ✅ | Non |

| scaleConfig | `scaleNumericEditable` | boolean | true | ✅ | Non |

| scaleConfig | `scaleNivel` | boolean | true | ✅ | Non |

| scaleConfig | `position` | string | "bottomleft" | ✅ | Non |

| storage.cache | `enableProfileCache` | boolean | true | ✅ | Non |

| storage.cache | `enableTileCache` | boolean | true | ✅ | Non |

| poiAddConfig | `enabled` | boolean | true | ✅ | Non |

| poiAddConfig | `defaultPosition` | string | "placement-mode" | ✅ | Non |

**Légende:**

- ✅ : Actif et fonctionnel

- ⚠️ : Défini mais peu utilisé

- ❌ : Non présent/manquant

- 🔶 : Déprécié

---

## Notes finales

### Points d'attention

1. **Nomenclature des sections** : La section `Files` utilise des noms avec suffixe "File" (`themesFile`, `layersFile`) ce qui est cohérent.

2. **Rétrocompatibilité** : Le code supporte l'ancienne structure `profile.panels.search` mais la nouvelle structure `profile.search` est recommandée.

3. **Paramètres data.\*** : Les paramètres comme `data.activeProfile`, `data.profilesBasePath`, `data.enableProfilePoiMapping` ne sont PAS dans profile.json mais dans geoleaf.config.tson ou passés via init().

4. **Position des contrôles** : Toutes les positions utilisent les valeurs standard MapLibre GL JS : `"top-left"`, `"top-right"`, `"bottom-left"`, `"bottom-right"`.

5. **Cache hors ligne** : Les paramètres `offline`, `offlineBounds`, `cacheMinZoom`, `cacheMaxZoom` dans basemaps sont pleinement fonctionnels.

### Recommandations

1. **Ajouter `defaultSettings`** pour centraliser les paramètres par défaut de la carte.

2. **Documenter `Directory`** si ce pattern est utilisé pour les couches.

3. **Considérer l'ajout de `stylesConfig`** pour supporter les styles alternatifs.

4. **Maintenir la rétrocompatibilité** avec `panels.*` pendant au moins une version majeure.

5. **Migration `useMapping` → `enableProfilePoiMapping`** dans les exemples et documentation.

---

**Fichier mis à jour le mars 2026**

**Basé sur l'analyse du code source GeoLeaf JS v2.0.0**
