---
title: "GeoLeaf.LayerManager — Module documentation"
---

# GeoLeaf.LayerManager — Module documentation

Applies to: @geoleaf/core v3.x
**Source file (monorepo)**: `packages/core/src/modules/built-in/layer-manager/layer-manager-api.ts`
**Public facade**: `packages/core/src/modules/geoleaf.layer-manager.ts`

---

## Functional role

The **GeoLeaf.LayerManager** module provides an **interactive MapLibre GL JS UI control** displayed in a corner of the map.
It shows and manages configurable sections: basemaps, GeoJSON layers, themes, offline cache, and so on.

**This module is distinct from `GeoLeaf.Legend`** (see the "Legend vs LayerManager" section at the bottom of the page).

---

## Module architecture

```
packages/core/src/modules/geoleaf.layer-manager.ts  (public facade)
        │
        └─→ layer-manager/layer-manager-api.ts       (main logic)
                │
                ├─→ layer-manager/control.ts          (MapLibre GL JS control)
                ├─→ layer-manager/renderer.ts         (section/item rendering)
                ├─→ layer-manager/basemap-selector.ts (basemap selection)
                ├─→ layer-manager/theme-selector.ts   (theme selection)
                ├─→ layer-manager/layer-manager-helpers.ts (utilities)
                └─→ layer-manager/shared.ts           (shared state)
```

---

## Public API

### `GeoLeaf.LayerManager.init(options?)`

Initialises the layer manager and adds it to the map.

**Parameters**:

- `options` (Object, optional):
    - `map`: MapLibre Map instance (when absent, resolved through `GeoLeaf.Core.getMap()`)
    - `position`: `"bottomright"` (default), `"bottomleft"`, `"topleft"`, `"topright"`
    - `title`: panel title (default: `"Gestionnaire de layers"`)
    - `collapsible`: `true` (default)
    - `collapsed`: `false` (default)
    - `sections`: array of initial sections

**Returns**: `IControl | null`

```javascript
// Initialisation from config (recommended)
GeoLeaf.LayerManager.init();

// With custom options
GeoLeaf.LayerManager.init({
    position: "bottomleft",
    collapsible: true,
    collapsed: false,
    title: "Couches",
});
```

> The configuration is also read from `layerManagerConfig` in `geoleaf.config.json`:
>
> ```json
> {
>     "layerManagerConfig": {
>         "position": "bottomright",
>         "collapsible": true,
>         "collapsed": false
>     }
> }
> ```

---

### `GeoLeaf.LayerManager.refresh(immediate?)`

Refreshes the manager display.
Useful after a theme change or a change in layer visibility.

**Parameters**:

- `immediate` (boolean, optional): `false` (default, debounced) or `true` (immediate)

```javascript
// Debounced refresh (batched by default)
GeoLeaf.LayerManager.refresh();

// Immediate refresh
GeoLeaf.LayerManager.refresh(true);
```

---

## API summary

| Method                | Role                               |
| --------------------- | ---------------------------------- |
| `init(options?)`      | Initialises the control on the map |
| `refresh(immediate?)` | Refreshes the panel display        |

---

## Configuration through the JSON profile

The manager reads its configuration from `geoleaf.config.json` at start-up:

```json
{
    "layerManagerConfig": {
        "position": "bottomright",
        "title": "Couches",
        "collapsible": true,
        "collapsed": false,
        "sections": [
            { "id": "basemap", "label": "Fonds de carte", "collapsedByDefault": false },
            { "id": "geojson", "label": "Couches vectorielles", "collapsedByDefault": true },
            { "id": "cache", "label": "Cache offline", "collapsedByDefault": true }
        ]
    }
}
```

---

## CSS — BEM classes

```css
.gl-layer-manager                      /* Main container */
.gl-layer-manager__wrapper             /* Inner wrapper */
.gl-layer-manager__header              /* Header (title + toggle) */
.gl-layer-manager__title               /* Panel title */
.gl-layer-manager__toggle              /* Collapse/expand button */
.gl-layer-manager__body                /* Panel body */
.gl-layer-manager__section             /* Individual section */
.gl-layer-manager__section-title       /* Section title */
.gl-layer-manager__section--collapsed  /* Collapsed section */
.gl-layer-manager__item                /* Item inside a section */
.gl-layer-manager--collapsed           /* Collapsed panel */
```

---

## Legend vs LayerManager

GeoLeaf exposes **two distinct modules** in this area:

| Aspect      | `GeoLeaf.Legend`                              | `GeoLeaf.LayerManager`                                       |
| ----------- | --------------------------------------------- | ------------------------------------------------------------ |
| **Facade**  | `packages/core/src/modules/geoleaf.legend.ts` | `packages/core/src/modules/geoleaf.layer-manager.ts`         |
| **Source**  | `src/capabilities/legend/legend-api.ts`       | `src/modules/built-in/layer-manager/layer-manager-api.ts`    |
| **Role**    | Automatic map legend (generated from styles)  | UI layer manager (interactive MapLibre GL JS IControl panel) |
| **Handles** | GeoJSON layers and their legend rendering     | Configurable sections (basemaps, layers, themes)             |
| **Loading** | Automatic, from the layer styles              | Manual, through JSON sections (profile)                      |
| **Alias?**  | No — independent module                       | No — independent module                                      |

The two modules are **independent and not aliased**.

---

## Related modules

- **[GeoLeaf.Core](../core/GeoLeaf_core_README.md)**: provides the map instance
- **[GeoLeaf.Legend](../legend/GeoLeaf_Legend_README.md)**: automatic map legend
- **[GeoLeaf.Baselayers](../baselayers/GeoLeaf_Baselayers_README.md)**: basemaps
