---
title: "Scale control configuration (scaleConfig)"
---

# Scale control configuration (scaleConfig)

## Description

The `ScaleControl` module displays the map scale in several forms: the graphic scale bar of MapLibre GL JS ScaleControl, a numeric scale (for example 1:250 000), and the zoom level. It can be placed in any corner of the map and offers an interactive scale editing option.

## Code location

- **Module**: `packages/core/src/modules/built-in/ui/scale-control.ts`
- **Initialisation**: `GeoLeaf.UI.ScaleControl.init(map, options)`
- **Loading**: `packages/core/src/bundle-esm-entry.ts` (imported in Rollup order)

## Configuration structure

```json
{
    "scaleConfig": {
        "scaleGraphic": true,
        "scaleNumeric": true,
        "scaleNumericEditable": false,
        "scaleNivel": true,
        "position": "bottomleft"
    }
}
```

## Available parameters

### scaleGraphic (boolean)

Enables or disables the MapLibre GL JS graphic scale (horizontal bar with graduations).

**Default value:** `true`

**Behaviour:**

- `true`: displays the native MapLibre GL JS graphic scale (ScaleControl)
- `false`: hides the graphic scale

**Example:**

```json
{
    "scaleConfig": {
        "scaleGraphic": true,
        "position": "bottomleft"
    }
}
```

### scaleNumeric (boolean)

Enables or disables the numeric scale, displayed in the "1:250 000" format.

**Default value:** `false`

**Behaviour:**

- `true`: displays the numeric scale in a dedicated block
- `false`: hides the numeric scale

**Format:** the scale is computed automatically from the zoom level and the latitude of the map centre.

**Example:**

```json
{
    "scaleConfig": {
        "scaleNumeric": true,
        "position": "bottomleft"
    }
}
```

**Rendering:** `1:250 000` (spaces as thousands separators)

### scaleNumericEditable (boolean)

Turns the numeric scale into an editable input field. A target scale can be typed in, and the map adjusts to the matching zoom level.

**Default value:** `false`

**Prerequisite:** `scaleNumeric` must be `true`

**Behaviour:**

- `true`: the scale becomes an editable input field
- `false`: the scale is read-only

**Usage:**

1. Click the field
2. Type a scale in the "1:xxx xxx" format (for example "1:100 000")
3. Confirm with Enter or by clicking elsewhere
4. The map zooms to reach that scale

**Example:**

```json
{
    "scaleConfig": {
        "scaleNumeric": true,
        "scaleNumericEditable": true,
        "position": "bottomleft"
    }
}
```

**Accepted formats:**

- `1:250000`
- `1:250 000`
- `1: 250000`

### scaleNivel (boolean)

Enables or disables the display of the MapLibre GL JS zoom level (for example "Zoom: 12").

**Default value:** `false`

**Behaviour:**

- `true`: displays the current zoom level
- `false`: hides the zoom level

**Example:**

```json
{
    "scaleConfig": {
        "scaleNivel": true,
        "position": "bottomleft"
    }
}
```

**Rendering:** `Zoom: 12`

### position (string)

Sets the position of the scale control on the map.

**Default value:** `"bottomleft"`

**Possible values:**

- `"topleft"`: top-left corner
- `"topright"`: top-right corner
- `"bottomleft"`: bottom-left corner (recommended, same position as branding/coordinates)
- `"bottomright"`: bottom-right corner

**Example:**

```json
{
    "scaleConfig": {
        "scaleGraphic": true,
        "scaleNumeric": true,
        "scaleNivel": true,
        "position": "bottomright"
    }
}
```

## Usage examples

### Minimal configuration (graphic scale only)

```json
{
    "scaleConfig": {
        "scaleGraphic": true
    }
}
```

### Full non-editable configuration

```json
{
    "scaleConfig": {
        "scaleGraphic": true,
        "scaleNumeric": true,
        "scaleNumericEditable": false,
        "scaleNivel": true,
        "position": "bottomleft"
    }
}
```

### Configuration with an editable scale

```json
{
    "scaleConfig": {
        "scaleGraphic": false,
        "scaleNumeric": true,
        "scaleNumericEditable": true,
        "scaleNivel": true,
        "position": "bottomright"
    }
}
```

### Disable entirely

Remove `scaleConfig` from profile.json, or set every parameter to `false`:

```json
{
    "scaleConfig": {
        "scaleGraphic": false,
        "scaleNumeric": false,
        "scaleNivel": false
    }
}
```

## Technical computations

### Scale computation

The scale is computed with the following formula:

```javascript
metersPerPixel = ((156543.03392 * cos((lat * π) / 180)) / 2) ^ zoom;
scale = (metersPerPixel * 96) / 0.0254;
```

**Factors:**

- `156543.03392`: size of the world in metres at zoom level 0
- Latitude of the map centre (cos, for the Web Mercator projection)
- Screen resolution: 96 DPI
- Metres → inches conversion: 0.0254 m/inch

### Zoom computation from a scale

To compute the zoom level required to reach a given scale:

```javascript
metersPerPixel = (targetScale * 0.0254) / 96;
zoom = log2((156543.03392 * cos((lat * π) / 180)) / metersPerPixel);
```

The zoom is rounded to the nearest integer and clamped between 0 and 22.

## CSS styling

The module uses the GeoLeaf CSS variables:

```css
.gl-scale-control {
    background: var(--gl-color-bg-surface);
    color: var(--gl-color-text-main);
    box-shadow: var(--gl-shadow-small);
}

.gl-scale-zoom {
    color: var(--gl-color-text-muted);
}
```

**Customisation:** these styles can be overridden in custom CSS.

## JavaScript API

### Automatic initialisation

```javascript
// Initialises automatically from the active profile configuration
GeoLeaf.UI.ScaleControl.init(map);
```

### Manual initialisation

```javascript
// Initialisation with a custom configuration
GeoLeaf.UI.ScaleControl.init(map, {
    scaleGraphic: true,
    scaleNumeric: true,
    scaleNumericEditable: false,
    scaleNivel: true,
    position: "bottomleft",
});
```

### Destruction

```javascript
// Clean up the control
GeoLeaf.UI.ScaleControl.destroy();
```

## Events

The control automatically listens to the following MapLibre GL JS events:

- `zoomend`: update on zoom change
- `moveend`: update when the map is panned

These events trigger a refresh of the displayed scale and zoom level.

## Technical notes

### Scale accuracy

The computed scale is approximate, because:

- it depends on the latitude (the Web Mercator projection distorts at high latitudes)
- screen resolution may vary (96 DPI is a standard value)
- values are rounded for readability

### Performance

The module is optimised:

- updates only on `zoomend` and `moveend` (not continuously while panning)
- lightweight mathematical computations
- no impact on rendering performance

### Compatibility

- **MapLibre GL JS:** uses the native MapLibre ScaleControl for the graphic scale
- **Browsers:** compatible with all modern browsers (ES2022+)
- **Mobile:** works on mobile, with a touch-friendly editable input

## Related files

- `packages/core/src/modules/built-in/ui/scale-control.ts` — main module
- `packages/core/src/bundle-esm-entry.ts` — module loading
- `packages/core/demo/` — initialisation in the demo
- `profiles/*/profile.json` — configuration

## History

- **2.0.0**: complete refactor onto MapLibre GL JS
- **1.0.0**: creation of the ScaleControl module
    - graphic scale
    - computed numeric scale
    - editable scale with an input field
    - zoom level display
    - configurable positioning
