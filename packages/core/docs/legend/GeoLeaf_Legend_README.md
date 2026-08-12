---
title: "GeoLeaf.Legend — Legend module documentation"
---

# GeoLeaf.Legend — Legend module documentation

**Source file (monorepo)**: `packages/core/src/capabilities/legend/legend-api.ts`
**Public facade**: `packages/core/src/modules/geoleaf.legend.ts`

---

## Functional role

The **GeoLeaf.Legend** module handles the display of the **map legend** in GeoLeaf.
The legend is generated **automatically** from the style files of the layers declared in the JSON profile.
It sits on the map (bottom left by default) and lists every visible layer with its style entries.

**This module is distinct from `GeoLeaf.LayerManager`** (see the Legend vs LayerManager section below).

### Internal architecture (in-core capability)

The legend is an **in-core capability** located under `capabilities/legend/`
(previously `modules/optional/legend/`). It is registered with the `CapabilityRegistry`
and gated by the `modules.legend.enabled` config key (opt-out), like the `filter`,
`labels` and `theme-selector` capabilities.

```
capabilities/legend/
├── legend-api.ts        // Main module — state, initialisation, public API
├── legend-control.ts    // MapLibre control (DOM rendering of the legend)
├── legend-renderer.ts   // Item rendering (symbols, accordions)
├── legend-generator.ts  // Generation of legend data from a JSON style
├── legend-capability.ts // Capability declaration (modules.legend.enabled gate + configSchema)
├── config.ts            // Reads modules.legend.* and merges it over the defaults
└── lifecycle.ts         // LegendLifecycle — mounts the control (opt-out on the merged config)
```

---

## Public API

### `GeoLeaf.Legend.init(mapInstance, options?)`

Initialises the legend and attaches it to the MapLibre map.

**Parameters**:

- `mapInstance` (maplibre.Map): MapLibre GL instance, **required**
- `options` (Object, optional):
    - `position`: `"bottomleft"` (default), `"bottomright"`, `"topleft"`, `"topright"`
    - `collapsible`: `true` (default)
    - `collapsed`: `false` (default)
    - `title`: `"Legend"` (default)

**Returns**: `boolean` (success)

```javascript
import * as maplibregl from "maplibre-gl";
const map = new maplibregl.Map({ container: "map", style: "..." });
GeoLeaf.Legend.init(map);

// With options
GeoLeaf.Legend.init(map, {
    position: "bottomright",
    collapsed: false,
    title: "Layer legend",
});
```

> The same parameters are also read from the **`modules.legend`** block (file
> `config/plugins/legend.json`, referenced by `Files.modules.legend` in `profile.json`):
>
> ```json
> {
>     "modules": {
>         "legend": {
>             "enabled": true,
>             "position": "bottomleft",
>             "collapsedByDefault": false,
>             "title": "Layer legend"
>         }
>     }
> }
> ```
>
> **Keys actually applied**: `title`, `position` and `collapsedByDefault` are read from this
> block and applied to the control, including for a profile that carried them under the former
> `legendConfig` block — such a profile gets its legend rendered with the configured title,
> position and collapsed state.

---

### `GeoLeaf.Legend.loadLayerLegend(layerId, styleId, layerConfig)`

Loads the legend of a GeoJSON layer from its style file.
Called automatically while GeoJSON layers are loading.

**Parameters**:

- `layerId` (string): Layer identifier
- `styleId` (string): Identifier of the active style
- `layerConfig` (Object): Layer configuration (taken from the JSON profile)

```javascript
// Normally called internally by the GeoJSON module.
// For advanced manual use:
GeoLeaf.Legend.loadLayerLegend("parcs", "default", layerConfig);
```

---

### `GeoLeaf.Legend.setLayerVisibility(layerId, visible)`

Controls the visibility of a layer inside the legend.

**Parameters**:

- `layerId` (string): Layer identifier
- `visible` (boolean): `true` = visible, `false` = hidden

```javascript
// Hide the "parcs" layer in the legend
GeoLeaf.Legend.setLayerVisibility("parcs", false);

// Show the "zones" layer in the legend
GeoLeaf.Legend.setLayerVisibility("zones", true);
```

---

### `GeoLeaf.Legend.getAllLayers()`

Returns every layer registered in the legend.

**Returns**: `Map<string, LayerInfo>` (JavaScript Map)

```javascript
const layers = GeoLeaf.Legend.getAllLayers();
layers.forEach((info, layerId) => {
    console.log(layerId, info.visible, info.label);
});
```

---

### `GeoLeaf.Legend.hideLegend()`

Hides the legend without removing it.

```javascript
GeoLeaf.Legend.hideLegend();
```

---

### `GeoLeaf.Legend.removeLegend()`

Removes the legend from the map entirely and clears all layer data.

```javascript
GeoLeaf.Legend.removeLegend();
```

---

### `GeoLeaf.Legend.isLegendVisible()`

Reports whether the legend is currently visible (control mounted, and at least one layer).

**Returns**: `boolean`

```javascript
if (GeoLeaf.Legend.isLegendVisible()) {
    console.log("The legend is visible");
}
```

---

### `GeoLeaf.Legend.showLoadingOverlay()` / `GeoLeaf.Legend.hideLoadingOverlay()`

Shows or hides the loading overlay (spinner) on the legend. Used internally while styles are loaded asynchronously.

```javascript
GeoLeaf.Legend.showLoadingOverlay();
// ... loading
GeoLeaf.Legend.hideLoadingOverlay();
```

---

## API summary

| Method                                           | Role                                            |
| ------------------------------------------------ | ----------------------------------------------- |
| `init(mapInstance, options?)`                    | Initialises the legend on the map               |
| `loadLayerLegend(layerId, styleId, layerConfig)` | Loads the legend of a GeoJSON layer             |
| `setLayerVisibility(layerId, visible)`           | Shows/hides a layer inside the legend           |
| `getAllLayers()`                                 | Returns every registered layer                  |
| `hideLegend()`                                   | Hides the legend                                |
| `removeLegend()`                                 | Removes the legend and clears its data          |
| `isLegendVisible()`                              | Reports whether the legend is currently visible |
| `showLoadingOverlay()`                           | Shows the loading spinner                       |
| `hideLoadingOverlay()`                           | Hides the loading spinner                       |

---

## DOM events

### `geoleaf:legend:ready`

Emitted **once only**, when the legend control is first mounted on the map.
It lets an application or a plugin react as soon as the legend is in place.

**Payload** (`event.detail`):

- `position` (string): effective position of the control (`"bottomleft"`, `"bottomright"`, `"topleft"`, `"topright"`)
- `layerCount` (number): number of layers registered in the legend at mount time

```javascript
document.addEventListener("geoleaf:legend:ready", (event) => {
    console.log("Légende prête :", event.detail.position, event.detail.layerCount);
});
```

---

## Integration with the JSON profile

The legend is generated automatically from the layers declared in the profile.
Its configuration lives in the **`modules.legend`** block (file `config/plugins/legend.json`,
referenced by `Files.modules.legend`):

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

> **Migration**: the legend used to be enabled by `ui.showLegend` and configured through the
> `legendConfig` block. It is now an **in-core capability** unified under `modules.legend`.
> `modules.legend.enabled` (default `true`, **opt-out**) replaces `ui.showLegend`;
> `title` / `position` / `collapsedByDefault` replace the same-named keys of `legendConfig`,
> and are read and applied.

Initialisation sequence:

1. `GeoLeaf.Config.load()` reads the JSON profile (including `modules.legend`).
2. `GeoLeaf.Core.init()` creates the MapLibre map.
3. `GeoLeaf.Legend.init(map)` initialises itself from `modules.legend` (or the defaults) and emits `geoleaf:legend:ready`.
4. The GeoJSON module loads the layers and calls `GeoLeaf.Legend.loadLayerLegend()` automatically.
5. The legend loads the associated style file and generates the visual entries.
6. The legend is displayed, with one accordion per visible layer.

---

## Introspection

The `legend` capability is registered with the `CapabilityRegistry`: its configuration schema
(keys `enabled` / `title` / `position` / `collapsedByDefault`, with their types, defaults and
enumerations) can be introspected through the public facade:

```javascript
GeoLeaf.Introspection.getCapabilitySchema("legend");
```

The public facade `GeoLeaf.Legend` and its methods are **unchanged** by this migration.

---

## Legend vs LayerManager

GeoLeaf exposes **two distinct modules** for layer management:

| Aspect      | `GeoLeaf.Legend`                              | `GeoLeaf.LayerManager`                                |
| ----------- | --------------------------------------------- | ----------------------------------------------------- |
| **Facade**  | `packages/core/src/modules/geoleaf.legend.ts` | `packages/core/src/modules/geoleaf.layer-manager.ts`  |
| **Source**  | `src/capabilities/legend/legend-api.ts`       | `src/modules/built-in/layer-manager/index.ts`         |
| **Role**    | Automatic map legend (generated from styles)  | UI layer manager (interactive MapLibre Control panel) |
| **Scope**   | GeoJSON layers and their legend rendering     | Configurable sections (basemaps, layers, themes)      |
| **Loading** | Automatic, from the layer styles              | Manual, through JSON sections or `addSection()`       |
| **Alias?**  | No — independent module                       | No — independent module                               |

These two modules are **independent and not aliased**.

---

## Related modules

- **[GeoLeaf.Core](../core/GeoLeaf_core_README.md)**: Supplies the map instance
- **[GeoLeaf.LayerManager](../layer-manager/GeoLeaf_LayerManager_README.md)**: UI layer management panel
