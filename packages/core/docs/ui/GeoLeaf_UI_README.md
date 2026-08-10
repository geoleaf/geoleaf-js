---
title: "GeoLeaf.UI — Documentation du module UI"
---

# GeoLeaf.UI — Documentation du module UI

Product Version: GeoLeaf Platform V3

**Version :** 3.0.0

**Module :** `packages/core/src/modules/built-in/ui/` (façade : `geoleaf.ui.ts`)

**Dernière mise à jour :** juillet 2026

Le module **GeoLeaf.UI** gère tous les aspects d'interface utilisateur de GeoLeaf. Il adopte une **architecture modulaire** avec des sous-modules spécialisés pour des responsabilités spécifiques.

---

## Architecture du module UI

Le module UI est organisé en sous-modules TypeScript :

| Fichier source                  | Responsabilités                                                            |
| ------------------------------- | -------------------------------------------------------------------------- |
| **`geoleaf.ui.ts`** (façade)    | Export de `UI` depuis `built-in/ui/ui-api.ts`                              |
| **`ui-api.ts`** (orchestrateur) | Délégation vers les sous-modules et adaptateur `notify()`                  |
| **`ui/theme.ts`**               | Thème light/dark : détection système, persistance, application classes CSS |
| **`ui/components.ts`**          | Agrégat `_UIComponents` — recompose `legend-symbols` + `widgets`           |
| **`ui/legend-symbols.ts`**      | Rendu des symboles de légende (cercle, ligne, polygone, étoile, icône)     |
| **`ui/widgets.ts`**             | Composants DOM réutilisables (accordéon, toggles…)                         |
| **`ui/event-delegation.ts`**    | Délégation d'événements DOM                                                |
| **`ui/pill-search.ts`**         | Champ de recherche « pill »                                                |
| **`ui/ui-slot-builder.ts`**     | Garde de visibilité + allowlist SVG des boutons de slot (desktop + mobile) |
| **`ui/toolbar-dispatch.ts`**    | Émission de `geoleaf:toolbar:action` (résolution lazy incluse)             |
| **`ui/roving-tabindex.ts`**     | Arithmétique clavier des widgets à roving tabindex (WCAG 1.5.5)            |
| **`ui/desktop/`**               | Panneau et registre desktop                                                |
| **`ui/mobile/`**                | Barre d'outils mobile                                                      |

> **Documentation détaillée par composant :**
>
> - [GeoLeaf_UI_Components_README.md](./GeoLeaf_UI_Components_README.md) - Composants UI internes

---

## Responsabilités du module UI

GeoLeaf.UI gère **5 domaines fonctionnels** :

### 1. Gestion des thèmes visuels

- Application thème light/dark sur `<body>` et `#geoleaf-map`
- Détection préférence système (`prefers-color-scheme`) via `initAutoTheme()`
- Persistance dans `localStorage` (clé `geoleaf_theme`)
- Toggle interactif via `data-gl-role="theme-toggle"`
- Écoute continue de `matchMedia` pour le suivi des changements OS en mode auto

### 2. ~~Construction de panneaux POI~~ — déplacée

Le rendu de fiche (side panel, popup, tooltip) avec layouts JSON, résolution de champs
en dot notation et sections accordéon **n'appartient plus à `GeoLeaf.UI`** : il est
assuré par la capacité **`feature-info`**, intégrée au core et configurée par couche
(`layers.<id>.capabilities.feature-info`). Le module `ui/content-builder/` qui portait
ce domaine a été supprimé, ainsi que `GeoLeaf.POI` (dissolution du sous-système POI,
v3.0.0). Voir [API_REFERENCE.md](../API_REFERENCE.md).

### 3. ~~Panneaux de filtres~~ — déplacée

Le panneau de filtres (construction depuis le profil, états catégories/tags/recherche/
proximité, compteurs, tags actifs) appartient à la capacité **`filter`** et se pilote par
**`GeoLeaf.Filter`** (singulier). `GeoLeaf.UI` n'en construit plus aucun.

### 4. Contrôles MapLibre

- Contrôle de géolocalisation (`initGeolocationControl`)
- Contrôle de toggle thème intégré à la carte (`initThemeToggleControl`)

> Ces deux méthodes restent exposées sur `GeoLeaf.UI`, mais l'implémentation vit dans les
> capacités `geolocation` et `theme-toggle`. Le plein écran et l'ajout de POI ne sont plus
> des contrôles de `GeoLeaf.UI` : le premier appartient à la capacité `fullscreen`, le
> second au plugin `@geoleaf-plugins/editor` (`GeoLeaf.Editor`).

### 5. Utilitaires DOM

- Notifications toast (`success`, `error`, `warning`, `info`) — rendues par la capacité
  `toast-renderer` ; `GeoLeaf.UI.notify()` reste la surface d'appel
- Délégation d'événements
- Helpers DOM (`resolveField`, `getActiveProfileConfig`)

> **Ce que GeoLeaf.UI NE gère PAS** :
>
> - Fonds de carte (voir `GeoLeaf.Baselayers`)
> - Données de couches, points compris (voir `GeoLeaf.Layers`)
> - Logique de filtrage (voir `GeoLeaf.Filter`)
> - Rendu des fiches au clic (capacité `feature-info`, configurée par couche)
> - GeoJSON (module interne, configuré via `geojsonLayers` dans `profile.json`)
> - Légende (voir `GeoLeaf.Legend`)

---

## API Publique

### API Thème

| Fonction                      | Description                                         | Retour   |
| ----------------------------- | --------------------------------------------------- | -------- |
| `getCurrentTheme()`           | Retourne le thème actif (`"light"` ou `"dark"`)     | `string` |
| `applyTheme(theme, persist?)` | Applique un thème (`"light"`, `"dark"`)             | `void`   |
| `toggleTheme()`               | Bascule entre light/dark                            | `void`   |
| `initThemeToggle(options)`    | Initialise le bouton toggle thème                   | `void`   |
| `initAutoTheme(themeConfig)`  | Initialise le thème auto selon `ui.theme` du profil | `void`   |

**Exemple :**

```js
// Appliquer thème sombre
GeoLeaf.UI.applyTheme("dark");

// Récupérer thème actuel
const theme = GeoLeaf.UI.getCurrentTheme(); // "dark"

// Toggle
GeoLeaf.UI.toggleTheme(); // passe à "light"

// Initialiser depuis la config profil (appelé automatiquement au boot)
GeoLeaf.UI.initAutoTheme("auto"); // détecte prefers-color-scheme
```

### API Contrôles

| Fonction                               | Description                       | Paramètres                             |
| -------------------------------------- | --------------------------------- | -------------------------------------- |
| `initGeolocationControl(map, options)` | Initialise la géolocalisation     | `map`: maplibre.Map, `options`: Object |
| `initThemeToggleControl(map, options)` | Contrôle thème intégré à la carte | `map`: maplibre.Map, `options`: Object |

**Exemple :**

```js
import * as maplibregl from "maplibre-gl";
const map = new maplibregl.Map({ container: "map", style: "..." });

GeoLeaf.UI.initGeolocationControl(map, {});
```

> **Retirés en v3.0.0** _(breaking)_ : `initFullscreenControl()` et `initPoiAddControl()`
> n'existent plus sur `GeoLeaf.UI`. Le plein écran est une capacité in-core activée par
> configuration (`modules.fullscreen`) ; l'ajout de POI appartient au plugin
> `@geoleaf-plugins/editor` et se pilote via `GeoLeaf.Editor`.

### API Notifications

| Fonction                           | Description                            |
| ---------------------------------- | -------------------------------------- |
| `Notifications.init(config)`       | Initialise le système de notifications |
| `Notifications.success(msg, dur?)` | Toast succès (vert)                    |
| `Notifications.error(msg, dur?)`   | Toast erreur (rouge)                   |
| `Notifications.warning(msg, dur?)` | Toast avertissement (orange)           |
| `Notifications.info(msg, dur?)`    | Toast information (bleu)               |
| `Notifications.clearAll()`         | Supprime tous les toasts actifs        |

**Exemple :**

```js
GeoLeaf.UI.Notifications.success("Données chargées !");
GeoLeaf.UI.Notifications.error("Erreur réseau", 8000);
```

### API Panneaux Filtres — retirée de `GeoLeaf.UI` en v3.0.0

> **`GeoLeaf.UI.buildFilterPanelFromActiveProfile()` n'existe plus** _(breaking)_. Son
> constructeur (`ui/filter-panel/**`) a été retiré avec l'extraction de la capacité
> `filter` : le panneau se construit désormais tout seul depuis le profil actif, et se
> pilote via **`GeoLeaf.Filter`**.

**Exemple :**

```js
// Le panneau est monté par la capacité `filter` (activée par configuration).
// Réagir à un changement de filtre :
GeoLeaf.Events.on("geoleaf:filters:applied", () => {
    console.log(GeoLeaf.Filter.getActiveFilter());
});

// Appliquer / réinitialiser par programme :
GeoLeaf.Filter.applyFilter(filterState);
GeoLeaf.Filter.reset();
```

---

## Initialisation

### Via `GeoLeaf.UI.init()`

Fonction wrapper pour initialiser les composants UI principaux :

```js
GeoLeaf.UI.init({
    buttonSelector: '[data-gl-role="theme-toggle"]', // Sélecteur bouton thème
    autoInitOnDomReady: true, // Init auto sur DOMContentLoaded
    map: mapInstance, // Instance MapLibre
    mapContainer: document.getElementById("map"), // Conteneur pour fullscreen
});
```

En pratique, `init()` est appelé automatiquement au boot. Il n'est pas nécessaire de l'appeler manuellement.

---

## Intégration Configuration JSON

Le module UI lit la configuration depuis `GeoLeaf.Config` (profil actif) :

```json
{
    "ui": {
        "theme": "auto",
        "showCoordinates": true,
        "showScale": true,
        "scaleType": "numeric",
        "permalink": {
            "enabled": true,
            "mode": "hash"
        }
    },
    "layouts": {
        "poiSidePanel": [
            { "type": "title", "field": "label" },
            { "type": "rating", "field": "attributes.rating" }
        ]
    },
    "filters": [
        {
            "id": "categories",
            "type": "select",
            "label": "Catégorie",
            "field": "categoryId"
        }
    ]
}
```

---

## Intégration avec autres modules

### UI ↔ Theme (sous-module)

```js
// geoleaf.ui.ts délègue à ui/theme.ts
GeoLeaf.UI.applyTheme("dark");
// → ui/theme.ts applique les classes CSS sur <body> et #geoleaf-map
// → dispatch event "geoleaf:ui-theme-changed"
```

### UI ↔ Filters

> **BREAKING (v3.0.0)** — `GeoLeaf.Filters.filterPoiList` (référencé dans les
> extraits de cette section) est **retiré** : 0 consommateur interne (roadmap
> nettoyage, Sprint 3). Le panneau de filtre actif est la capacité `GeoLeaf.Filter`
> (singulier) — `getActiveFilter()` / `applyFilter(state)`. Voir
> [API_REFERENCE.md](../API_REFERENCE.md#filter--the-filter-panel-singular).
>
> **BREAKING (v3.1.0)** — le namespace `GeoLeaf.Filters` (pluriel) est supprimé
> en entier. Il ne restait que `filterRouteList`, sans aucun appelant.

```js
// UI construit l'interface, GeoLeaf.Filter (capacité) exécute la logique
const state = GeoLeaf.Filter.getActiveFilter();
GeoLeaf.Filter.applyFilter(state);
```

### UI ↔ fiches de features

Le rendu d'une fiche n'est plus piloté depuis `GeoLeaf.UI`. Un clic sur une feature émet
`geoleaf:feature:click`, que la capacité `feature-info` rend selon la configuration de la
couche :

```js
// Se configure par couche — aucun appel impératif :
// layers.<id>.capabilities.feature-info = { … }
GeoLeaf.Events.on("geoleaf:feature:click", (e) => {
    console.log(e.detail.layerId, e.detail.properties);
});
```

### UI ↔ Config

```js
// UI lit profil actif pour layouts et filtres
const profile = GeoLeaf.Config.getActiveProfile();
const layout = profile.layouts?.poiSidePanel || [];
```

---

## Bonnes Pratiques

### A FAIRE

```js
// 1. Utiliser applyTheme pour changements programmatiques
GeoLeaf.UI.applyTheme("dark");

// 2. Piloter le panneau de filtres via la capacité Filter
//    (le panneau est construit depuis le profil par la capacité elle-même)
GeoLeaf.Filter.applyFilter(filterState);
GeoLeaf.Filter.reset();

// 3. Personnaliser la fiche d'une couche par CONFIGURATION, pas par appel
//    layers.<id>.capabilities.feature-info — rendu par la capacité feature-info
```

### A EVITER

```js
// 1. Manipuler directement les classes CSS thème
document.body.classList.add("gl-theme-dark"); // utiliser applyTheme()

// 2. Construire le HTML d'une fiche manuellement
container.innerHTML = `<h2>${f.label}</h2>`; // configurer capabilities.feature-info

// 3. Accéder directement aux sous-modules
import { _UITheme } from "ui/theme.ts"; // utiliser GeoLeaf.UI.applyTheme()
```

---

## Résumé API Complète

| Catégorie         | Fonctions principales                                                                        | Documentation                        |
| ----------------- | -------------------------------------------------------------------------------------------- | ------------------------------------ |
| **Thème**         | `getCurrentTheme()`, `applyTheme()`, `toggleTheme()`, `initThemeToggle()`, `initAutoTheme()` | Ce README                            |
| **Contrôles**     | `initGeolocationControl()`, `initThemeToggleControl()`                                       | Ce README                            |
| **Notifications** | `notify()`, `Notifications.success()`, `.error()`, `.warning()`, `.info()`, `.clearAll()`    | Ce README                            |
| **Mobile**        | `initMobileToolbar()`                                                                        | Ce README                            |
| **Init**          | `init()`                                                                                     | Ce README                            |
| ~~**Filtres**~~   | déplacé — voir `GeoLeaf.Filter` (capacité `filter`)                                          | [API_REFERENCE](../API_REFERENCE.md) |
| ~~**Content**~~   | déplacé — voir la capacité `feature-info`                                                    | [API_REFERENCE](../API_REFERENCE.md) |

---

## Voir Aussi

- [API_REFERENCE.md](../API_REFERENCE.md#layers--feature-data) - Données des couches (remplace le module POI, dissous en v3)
- [API_REFERENCE.md](../API_REFERENCE.md#filter--the-filter-panel-singular) - Capacité Filter
- [GeoLeaf_Config_README.md](../config/GeoLeaf_Config_README.md) - Configuration
- [GeoLeaf_Core_README.md](../core/GeoLeaf_core_README.md) - Module Core
