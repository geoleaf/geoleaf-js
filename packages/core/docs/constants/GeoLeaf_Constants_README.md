---
title: "GeoLeaf.CONSTANTS – Documentation des constantes globales"
---

# GeoLeaf.CONSTANTS – Documentation des constantes globales

Product Version: GeoLeaf Platform V3

**Version** : 3.0.0

**Fichier source** : `packages/core/src/modules/utils/constants/index.ts`

**Dernière mise à jour** : mars 2026

---

## Vue d'ensemble

Le module **GeoLeaf.CONSTANTS** centralise toutes les valeurs numériques et constantes utilisées dans le projet. Il fournit un **point unique de vérité** pour les paramètres par défaut, évitant ainsi la duplication de valeurs arbitraires dans le code.

L'objet est exporté comme `Object.freeze({...})` — il est **en lecture seule** au runtime.

### Avantages

- **Centralisation** — toutes les constantes au même endroit
- **Maintenabilité** — modification facile des valeurs par défaut
- **Documentation** — référence claire des valeurs utilisées
- **Cohérence** — garantit l'uniformité entre modules
- **Immutabilité** — `Object.freeze` empêche toute modification accidentelle

---

## Constantes disponibles

### Carte (Map)

#### `DEFAULT_ZOOM`

**Valeur** : `3`

**Type** : `number`

**Description** : Niveau de zoom initial par défaut. Valeur neutre — le `fitBounds` positionne la vue après chargement des couches.

**Usage** :

```ts
import { CONSTANTS } from "@geoleaf/core";

GeoLeaf.Core.init({
    zoom: CONSTANTS.DEFAULT_ZOOM,
});
```

---

#### `DEFAULT_CENTER`

**Valeur** : `[0, 0]`

**Type** : `[number, number]` (lat, lng)

**Description** : Coordonnées centre par défaut. Valeur neutre — le profil ou la config JSON doit fournir un centre métier.

**Usage** :

```ts
GeoLeaf.Core.init({
    center: CONSTANTS.DEFAULT_CENTER,
});
```

---

#### `MAX_ZOOM_ON_FIT`

**Valeur** : `15`

**Type** : `number`

**Description** : Zoom maximum appliqué lors d'un `fitBounds` automatique (POI, GeoJSON).

**Usage** :

```ts
map.fitBounds(bounds, {
    maxZoom: CONSTANTS.MAX_ZOOM_ON_FIT,
});
```

---

### POI (Points d'intérêt)

#### `POI_MARKER_SIZE`

**Valeur** : `12`

**Type** : `number`

**Description** : Taille par défaut des marqueurs POI en pixels.

---

#### `POI_MAX_ZOOM`

**Valeur** : `18`

**Type** : `number`

**Description** : Niveau de zoom maximum pour les POI.

---

#### `POI_SWIPE_THRESHOLD`

**Valeur** : `50`

**Type** : `number`

**Description** : Distance minimale (en pixels) pour détecter un swipe dans le panneau POI.

---

#### `POI_LIGHTBOX_TRANSITION_MS`

**Valeur** : `300`

**Type** : `number`

**Description** : Durée de la transition d'ouverture/fermeture du lightbox (en millisecondes).

---

#### `POI_SIDEPANEL_DEFAULT_WIDTH`

**Valeur** : `420`

**Type** : `number`

**Description** : Largeur par défaut du panneau latéral POI (en pixels).

---

### Route (Itinéraires)

#### `ROUTE_MAX_ZOOM_ON_FIT`

**Valeur** : `14`

**Type** : `number`

**Description** : Zoom maximum lors du `fitBounds` d'un itinéraire.

---

#### `ROUTE_WAYPOINT_RADIUS`

**Valeur** : `5`

**Type** : `number`

**Description** : Rayon des marqueurs de waypoints (points de passage) en pixels.

---

### GeoJSON (Couches)

#### `GEOJSON_MAX_ZOOM_ON_FIT`

**Valeur** : `15`

**Type** : `number`

**Description** : Zoom maximum lors du `fitBounds` d'une couche GeoJSON.

---

#### `GEOJSON_POINT_RADIUS`

**Valeur** : `6`

**Type** : `number`

**Description** : Rayon par défaut des points GeoJSON (en pixels, via la couche `circle` MapLibre GL).

---

### UI (Interface)

#### `FULLSCREEN_TRANSITION_MS`

**Valeur** : `10`

**Type** : `number`

**Description** : Délai de transition pour le mode plein écran (en millisecondes). Laisse le temps au navigateur de recalculer les dimensions avant l'invalidation de la vue.

---

## Tableau récapitulatif

| Constante                     | Valeur  | Catégorie | Description                       |
| ----------------------------- | ------- | --------- | --------------------------------- |
| `DEFAULT_ZOOM`                | `3`     | Map       | Zoom initial neutre               |
| `DEFAULT_CENTER`              | `[0,0]` | Map       | Centre neutre (méridien/équateur) |
| `MAX_ZOOM_ON_FIT`             | `15`    | Map       | Zoom max sur fitBounds            |
| `POI_MARKER_SIZE`             | `12`    | POI       | Taille marqueur (px)              |
| `POI_MAX_ZOOM`                | `18`    | POI       | Zoom maximum POI                  |
| `POI_SWIPE_THRESHOLD`         | `50`    | POI       | Seuil détection swipe (px)        |
| `POI_LIGHTBOX_TRANSITION_MS`  | `300`   | POI       | Durée transition lightbox (ms)    |
| `POI_SIDEPANEL_DEFAULT_WIDTH` | `420`   | POI       | Largeur panneau latéral (px)      |
| `ROUTE_MAX_ZOOM_ON_FIT`       | `14`    | Route     | Zoom max itinéraire               |
| `ROUTE_WAYPOINT_RADIUS`       | `5`     | Route     | Rayon waypoint (px)               |
| `GEOJSON_MAX_ZOOM_ON_FIT`     | `15`    | GeoJSON   | Zoom max fitBounds GeoJSON        |
| `GEOJSON_POINT_RADIUS`        | `6`     | GeoJSON   | Rayon cercle point GeoJSON (px)   |
| `FULLSCREEN_TRANSITION_MS`    | `10`    | UI        | Délai fullscreen (ms)             |

---

## Exemples d'utilisation

### Exemple 1 : Initialisation avec constantes

```ts
import { CONSTANTS } from "@geoleaf/core";

// Utiliser les constantes plutôt que des valeurs en dur
GeoLeaf.Core.init({
    center: CONSTANTS.DEFAULT_CENTER,
    zoom: CONSTANTS.DEFAULT_ZOOM,
});
```

### Exemple 2 : FitBounds cohérent

```ts
// POI / GeoJSON — zoom max 15
map.fitBounds(poiBounds, {
    maxZoom: CONSTANTS.MAX_ZOOM_ON_FIT,
});

// Route — zoom max 14 (vue moins rapprochée)
map.fitBounds(routeBounds, {
    maxZoom: CONSTANTS.ROUTE_MAX_ZOOM_ON_FIT,
});
```

### Exemple 3 : Animation avec constantes

```ts
// Transition lightbox POI
const lightbox = document.querySelector(".poi-lightbox") as HTMLElement;
lightbox.style.transition = `
    opacity ${CONSTANTS.POI_LIGHTBOX_TRANSITION_MS}ms ease-in-out,
    transform ${CONSTANTS.POI_LIGHTBOX_TRANSITION_MS}ms ease-in-out
`;

// Délai après fullscreen (recalcul des dimensions MapLibre)
toggleFullscreen().then(() => {
    setTimeout(() => {
        map.resize();
    }, CONSTANTS.FULLSCREEN_TRANSITION_MS);
});
```

---

## Règle d'immutabilité

Les constantes sont **en lecture seule** (`Object.freeze`) et ne doivent **pas** être modifiées :

```ts
// Ne pas faire — silencieusement ignoré en mode strict, erreur en mode non-strict
CONSTANTS.DEFAULT_ZOOM = 10;

// À la place : passer la valeur personnalisée directement
GeoLeaf.Core.init({
    zoom: 10,
});
```

Pour configurer des valeurs différentes, utilisez le fichier de configuration JSON :

```json
{
    "map": {
        "zoom": 10,
        "center": [48.8566, 2.3522]
    }
}
```

---

## Ajout de nouvelles constantes

Si un nouveau module requiert des constantes :

1. Ajouter la valeur dans `packages/core/src/modules/utils/constants/index.ts`
2. Respecter la convention `UPPER_SNAKE_CASE`
3. Grouper par domaine fonctionnel (Map, POI, Route, GeoJSON, UI)
4. Documenter ici
5. Choisir une valeur par défaut raisonnable — les profils peuvent toujours la surcharger

---

## Modules utilisant ces constantes

**Map** :

- `geoleaf.core.ts` — initialisation de la carte
- `globals.baselayers.ts` — gestion du zoom sur basemap

**POI** :

- `built-in/poi/markers.ts` — création des marqueurs MapLibre
- `built-in/poi/sidepanel.ts` — dimensions du panneau latéral
- `built-in/poi/renderers/lightbox-manager.ts` — transitions lightbox

**Route** :

- `geoleaf.route.ts` — fitBounds de l'itinéraire
- `built-in/route/` — waypoints

**GeoJSON** :

- `built-in/geojson/loader/` — fitBounds et style des points
- `adapters/maplibre/maplibre-primitives.ts` — paint `circle-radius`

**UI** :

- `modules/ui/controls.ts` — délai fullscreen

---

**Dernière mise à jour** : mars 2026

**Version GeoLeaf** : 3.0.0
