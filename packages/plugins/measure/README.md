# @geoleaf-plugins/measure

GeoLeaf plugin for measuring distances, surfaces (rectangle / circle / polygon), recording a GPS track and adding georeferenced annotations on an interactive map, with GeoJSON export.

- **MIT License** — public registry (npmjs.org)
- Requires `@geoleaf/core` loaded before this plugin
- ESM only — no CommonJS/UMD
- Integrates with `@geoleaf-plugins/print` for annotation export

---

## Installation

```bash
npm install @geoleaf-plugins/measure
```

Load in your HTML after `@geoleaf/core`:

```html
<script
    type="module"
    src="node_modules/@geoleaf-plugins/measure/dist/geoleaf-measure.plugin.js"
></script>
```

> In a standard GeoLeaf deployment the plugin is registered **lazily** and its bundle is
> fetched on first use of the measure toolbar button — no manual `<script>` tag is required.

---

## Quick start

Once the plugin is loaded it mounts the `GeoLeaf.Measure` namespace and registers a toolbar
button (shown when `ui.showMeasure` / `showButton` is enabled). Clicking the button opens a
floating sub-menu containing:

1. **Distance tool** — click two or more points; double-click (or `Space`) to finish. Segment lengths and total distance are shown.
2. **Rectangle tool** — drag from one corner to the opposite one; the area and side lengths are shown.
3. **Circle tool** — drag from the center outward to set the radius; area, radius and circumference are shown.
4. **Polygon tool** — click successive vertices; close by snapping onto the first vertex, double-clicking, or pressing `C`. Area, side lengths and perimeter are shown.
5. **GPS track** — records the device position in real time and can be closed as a polygon.
6. **Tooltip annotation** — click to place a resizable, editable tooltip box anchored to a map coordinate; drag to reposition.
7. **Unit cyclers** — toggle distance units (m / km) and area units (m² / ha / km²).
8. **Clear all** — removes every measure and annotation.
9. **GeoJSON export** — downloads all active features as GeoJSON.

All features are mirrored to `localStorage` and restored on the next page load.

---

## Public API (`GeoLeaf.Measure`)

### `startMeasure(type)`

Arms the given tool programmatically (initialises the engine on first call).

```typescript
type MeasureType = "distance" | "rect" | "circle" | "polygon" | "gps" | "annotation-tooltip";

function startMeasure(type: MeasureType): void;
```

---

### `stopMeasure()`

Deactivates the currently active tool and returns to idle state.

```typescript
function stopMeasure(): void;
```

---

### `clearAll()`

Removes all measure features, annotation overlays, drawing layers and the `localStorage` entry.

```typescript
function clearAll(): void;
```

---

### `getCollection()`

Returns a deep copy of the current GeoJSON `FeatureCollection` (measures + annotations).

```typescript
function getCollection(): GeoJSON.FeatureCollection;
```

---

### `exportGeoJSON(opts?)`

Builds an RFC 7946 GeoJSON `Blob` (enriched properties) and, by default, triggers a file
download. Pass `{ download: false }` to obtain the `Blob` without downloading. The download
uses the priority pattern `navigator.share` (iOS) → `<a download>` (desktop/Android) →
`window.open` fallback.

```typescript
function exportGeoJSON(opts?: {
    download?: boolean; // default true
    fileName?: string; // overrides cfg.exportFileName
}): Promise<Blob>;
```

---

### `setUnits(u)` / `getUnits()`

Changes the active distance and/or area units (re-renders visible labels), or reads the
current selection.

```typescript
interface Units {
    distance: "m" | "km" | "auto";
    area: "m2" | "ha" | "km2" | "auto";
}

function setUnits(u: Partial<Units>): void;
function getUnits(): Units;
```

---

### `getPrintableAnnotations()`

Returns annotation descriptors consumed by `@geoleaf-plugins/print` when composing the print
output. Only annotations within the current map viewport are included.

```typescript
interface PrintableAnnotation {
    kind: "label" | "tooltip";
    lngLat: [number, number];
    text: string;
    widthPx?: number;
    heightPx?: number;
    anchor: "bottom" | "center";
}

function getPrintableAnnotations(): PrintableAnnotation[];
```

---

### `registerMeasureType(type, def)`

Registers a custom measure tool.

```typescript
interface MeasureTypeDef {
    cursor?: string;
    onActivate?: (map: unknown) => void;
    onDeactivate?: () => void;
}

function registerMeasureType(type: string, def: MeasureTypeDef): void;
```

---

## Configuration (`modules.measure`)

Add a `modules.measure` object to your GeoLeaf profile configuration. All fields are optional —
the defaults below are applied otherwise.

```json
{
    "modules": {
        "measure": {
            "enabled": true,
            "showButton": true,
            "defaultDistanceUnit": "km",
            "defaultAreaUnit": "ha",
            "enabledTools": ["distance", "rect", "circle", "polygon", "gps", "annotation-tooltip"],
            "snapPx": 12,
            "circleSteps": 64,
            "maxFeatures": 500
        }
    }
}
```

| Field                 | Type                                    | Default                      | Description                                                                            |
| --------------------- | --------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------- |
| `enabled`             | boolean                                 | `true`                       | Enables / disables the plugin entirely (skips toolbar + listener wiring when `false`). |
| `showButton`          | boolean                                 | `true`                       | Shows the toolbar button. Aliased by the core-level `ui.showMeasure`.                  |
| `position`            | string                                  | `"left"`                     | Toolbar slot position.                                                                 |
| `menuPosition`        | string \| `{ top, left }`               | `"top-left"`                 | Initial position of the floating sub-menu.                                             |
| `defaultDistanceUnit` | `"m"` \| `"km"` \| `"auto"`             | `"m"`                        | Default distance unit.                                                                 |
| `defaultAreaUnit`     | `"m2"` \| `"ha"` \| `"km2"` \| `"auto"` | `"m2"`                       | Default area unit.                                                                     |
| `snapPx`              | number                                  | `12`                         | Snap tolerance (px) for polygon closure (min `1`).                                     |
| `circleSteps`         | number                                  | `64`                         | Segments approximating a circle (clamped to `8`–`256`).                                |
| `enabledTools`        | `MeasureType[]`                         | all tools                    | Tools shown in the sub-menu (unknown ids are filtered out).                            |
| `tooltipDefaultSize`  | `{ width, height }`                     | `{ width: 160, height: 80 }` | Default size of a new tooltip annotation box (px).                                     |
| `labelMaxChars`       | number                                  | `120`                        | Maximum characters in an annotation label.                                             |
| `persist`             | boolean                                 | `true`                       | Mirrors the FeatureCollection to `localStorage`.                                       |
| `storageKey`          | string                                  | `"geoleaf.measure.fc"`       | `localStorage` key used for persistence.                                               |
| `maxFeatures`         | number                                  | `500`                        | Maximum stored features (min `1`).                                                     |
| `gpsCloseThresholdM`  | number                                  | `15`                         | Proximity (m) to the start that prompts closing the GPS track as a polygon.            |
| `gpsMaxJumpMps`       | number                                  | `25`                         | Maximum speed (m/s) used to reject GPS outliers.                                       |
| `decimals`            | `{ distance, area }`                    | `{ distance: 0, area: 0 }`   | Decimal places for displayed values.                                                   |
| `exportFileName`      | string                                  | `"mesures.geojson"`          | Default filename for GeoJSON export.                                                   |

> **Note** — plugin settings live under `modules.measure` (Plugin Contract v1, INV-CONFIG). The
> legacy root key `measureConfig` is no longer read.

---

## Print integration

When both `@geoleaf-plugins/measure` and `@geoleaf-plugins/print` are loaded, the print modal
shows an **Annotations** checkbox. When ticked, annotations are composited onto the exported map
image at their geographic positions, using `getPrintableAnnotations()`. No extra configuration is
required.

---

## GPS track

The GPS tool records the device position using the GeoLeaf geolocation control.

- Requires browser geolocation permission and HTTPS.
- Outlier fixes are rejected using `gpsMaxJumpMps` (default 25 m/s).
- When the live position returns within `gpsCloseThresholdM` metres of the start, a prompt offers
  to close the track as a polygon (area is then computed).
- The track is exported as a `LineString` (or `Polygon` when closed) feature in GeoJSON export.

---

## Annotations

Tooltip annotations are DOM overlays anchored to geographic coordinates.

- **Create**: activate the annotation tool and click on the map; a resizable text box appears in edit mode.
- **Edit**: click the annotation box to re-enter edit mode; type, then click outside to commit.
- **Drag**: pointer-drag the annotation to move it; the anchor coordinate updates accordingly.
- **Delete**: hover the annotation box; click the × button that appears.
- **Persist**: annotations are included in `getCollection()` / `exportGeoJSON()` and are restored
  from `localStorage` on the next page load.

---

## Limitations

- **GPS on mobile**: requires HTTPS and granted geolocation permission. Accuracy depends on device hardware.
- **Annotation drag on touch**: pointer events are used; pinch-zoom on an annotation may conflict with map panning.
- **Print annotation positioning**: annotations are positioned using the print canvas pixel coordinates; very large or very small scales may shift anchor positions slightly.
- **No undo**: `clearAll()` is irreversible.

---

## Bundle budget

| Part          | Size (gzip)           |
| ------------- | --------------------- |
| Plugin bundle | ~32 KB (budget 60 KB) |

Turf.js geodesic helpers (`@turf/distance`, `@turf/area`, `@turf/circle`, `@turf/centroid`,
`@turf/helpers`) are bundled inline. `maplibre-gl` is a peer dependency provided by the host page.

---

## MIT License

Copyright © 2026 Mattieu Pottier. See [LICENSE](LICENSE) for details.
