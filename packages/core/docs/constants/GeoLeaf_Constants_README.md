---
title: "GeoLeaf.CONSTANTS – Global constants documentation"
---

# GeoLeaf.CONSTANTS – Global constants documentation

**Applies to**: @geoleaf/core v3.x

**Source file**: `packages/core/src/modules/utils/constants/index.ts`

---

## Overview

The **GeoLeaf.CONSTANTS** module centralises every numeric value and constant used in the project. It provides a **single source of truth** for default parameters, which keeps arbitrary values from being duplicated throughout the code.

The object is exported as `Object.freeze({...})` — it is **read-only** at runtime.

### Benefits

- **Centralisation** — every constant in one place
- **Maintainability** — default values are easy to change
- **Documentation** — a clear reference of the values in use
- **Consistency** — guarantees uniform behaviour across modules
- **Immutability** — `Object.freeze` prevents accidental modification

---

## Available constants

### Map

#### `DEFAULT_ZOOM`

**Value**: `3`

**Type**: `number`

**Description**: Default initial zoom level. A neutral value — `fitBounds` positions the view once the layers are loaded.

**Usage**:

```ts
import { CONSTANTS } from "@geoleaf/core";

GeoLeaf.Core.init({
    zoom: CONSTANTS.DEFAULT_ZOOM,
});
```

---

#### `DEFAULT_CENTER`

**Value**: `[0, 0]`

**Type**: `[number, number]` (lat, lng)

**Description**: Default centre coordinates. A neutral value — the profile or the JSON config must supply a meaningful centre.

**Usage**:

```ts
GeoLeaf.Core.init({
    center: CONSTANTS.DEFAULT_CENTER,
});
```

---

#### `MAX_ZOOM_ON_FIT`

**Value**: `15`

**Type**: `number`

**Description**: Maximum zoom applied by an automatic `fitBounds` (POI, GeoJSON).

**Usage**:

```ts
map.fitBounds(bounds, {
    maxZoom: CONSTANTS.MAX_ZOOM_ON_FIT,
});
```

---

### POI (points of interest)

#### `POI_MARKER_SIZE`

**Value**: `12`

**Type**: `number`

**Description**: Default POI marker size, in pixels.

---

#### `POI_MAX_ZOOM`

**Value**: `18`

**Type**: `number`

**Description**: Maximum zoom level for POIs.

---

#### `POI_SWIPE_THRESHOLD`

**Value**: `50`

**Type**: `number`

**Description**: Minimum distance (in pixels) needed to detect a swipe in the POI panel.

---

#### `POI_LIGHTBOX_TRANSITION_MS`

**Value**: `300`

**Type**: `number`

**Description**: Duration of the lightbox open/close transition (in milliseconds).

---

#### `POI_SIDEPANEL_DEFAULT_WIDTH`

**Value**: `420`

**Type**: `number`

**Description**: Default width of the POI side panel (in pixels).

---

### Route

#### `ROUTE_MAX_ZOOM_ON_FIT`

**Value**: `14`

**Type**: `number`

**Description**: Maximum zoom applied by the `fitBounds` of a route.

---

#### `ROUTE_WAYPOINT_RADIUS`

**Value**: `5`

**Type**: `number`

**Description**: Radius of waypoint markers, in pixels.

---

### GeoJSON (layers)

#### `GEOJSON_MAX_ZOOM_ON_FIT`

**Value**: `15`

**Type**: `number`

**Description**: Maximum zoom applied by the `fitBounds` of a GeoJSON layer.

---

#### `GEOJSON_POINT_RADIUS`

**Value**: `6`

**Type**: `number`

**Description**: Default radius of GeoJSON points (in pixels, through the MapLibre GL `circle` layer).

---

### UI

#### `FULLSCREEN_TRANSITION_MS`

**Value**: `10`

**Type**: `number`

**Description**: Transition delay for full-screen mode (in milliseconds). It gives the browser time to recompute dimensions before the view is invalidated.

---

## Summary table

| Constant                      | Value   | Category | Description                       |
| ----------------------------- | ------- | -------- | --------------------------------- |
| `DEFAULT_ZOOM`                | `3`     | Map      | Neutral initial zoom              |
| `DEFAULT_CENTER`              | `[0,0]` | Map      | Neutral centre (meridian/equator) |
| `MAX_ZOOM_ON_FIT`             | `15`    | Map      | Max zoom on fitBounds             |
| `POI_MARKER_SIZE`             | `12`    | POI      | Marker size (px)                  |
| `POI_MAX_ZOOM`                | `18`    | POI      | Maximum POI zoom                  |
| `POI_SWIPE_THRESHOLD`         | `50`    | POI      | Swipe detection threshold (px)    |
| `POI_LIGHTBOX_TRANSITION_MS`  | `300`   | POI      | Lightbox transition duration (ms) |
| `POI_SIDEPANEL_DEFAULT_WIDTH` | `420`   | POI      | Side panel width (px)             |
| `ROUTE_MAX_ZOOM_ON_FIT`       | `14`    | Route    | Max route zoom                    |
| `ROUTE_WAYPOINT_RADIUS`       | `5`     | Route    | Waypoint radius (px)              |
| `GEOJSON_MAX_ZOOM_ON_FIT`     | `15`    | GeoJSON  | Max zoom on GeoJSON fitBounds     |
| `GEOJSON_POINT_RADIUS`        | `6`     | GeoJSON  | GeoJSON point circle radius (px)  |
| `FULLSCREEN_TRANSITION_MS`    | `10`    | UI       | Full-screen delay (ms)            |

---

## Usage examples

### Example 1: initialisation with constants

```ts
import { CONSTANTS } from "@geoleaf/core";

// Prefer the constants over hard-coded values
GeoLeaf.Core.init({
    center: CONSTANTS.DEFAULT_CENTER,
    zoom: CONSTANTS.DEFAULT_ZOOM,
});
```

### Example 2: consistent fitBounds

```ts
// POI / GeoJSON — max zoom 15
map.fitBounds(poiBounds, {
    maxZoom: CONSTANTS.MAX_ZOOM_ON_FIT,
});

// Route — max zoom 14 (wider view)
map.fitBounds(routeBounds, {
    maxZoom: CONSTANTS.ROUTE_MAX_ZOOM_ON_FIT,
});
```

### Example 3: animation driven by constants

```ts
// POI lightbox transition
const lightbox = document.querySelector(".poi-lightbox") as HTMLElement;
lightbox.style.transition = `
    opacity ${CONSTANTS.POI_LIGHTBOX_TRANSITION_MS}ms ease-in-out,
    transform ${CONSTANTS.POI_LIGHTBOX_TRANSITION_MS}ms ease-in-out
`;

// Delay after going full screen (MapLibre recomputes its dimensions)
toggleFullscreen().then(() => {
    setTimeout(() => {
        map.resize();
    }, CONSTANTS.FULLSCREEN_TRANSITION_MS);
});
```

---

## Immutability rule

The constants are **read-only** (`Object.freeze`) and must **not** be modified:

```ts
// Do not do this — silently ignored in sloppy mode, TypeError in strict mode
CONSTANTS.DEFAULT_ZOOM = 10;

// Instead: pass the custom value directly
GeoLeaf.Core.init({
    zoom: 10,
});
```

To configure different values, use the JSON configuration file:

```json
{
    "map": {
        "zoom": 10,
        "center": [48.8566, 2.3522]
    }
}
```

---

## Adding new constants

When a new module needs constants:

1. Add the value to `packages/core/src/modules/utils/constants/index.ts`
2. Follow the `UPPER_SNAKE_CASE` convention
3. Group by functional domain (Map, POI, Route, GeoJSON, UI)
4. Document it here
5. Pick a sensible default — profiles can always override it

---

## Modules using these constants

**Map**:

- `geoleaf.core.ts` — map initialisation
- `globals.baselayers.ts` — zoom handling on the basemap

**POI**:

- `built-in/poi/markers.ts` — creation of the MapLibre markers
- `built-in/poi/sidepanel.ts` — side panel dimensions
- `built-in/poi/renderers/lightbox-manager.ts` — lightbox transitions

**Route**:

- `geoleaf.route.ts` — route fitBounds
- `built-in/route/` — waypoints

**GeoJSON**:

- `built-in/geojson/loader/` — fitBounds and point styling
- `adapters/maplibre/maplibre-primitives.ts` — `circle-radius` paint

**UI**:

- `modules/ui/controls.ts` — full-screen delay
