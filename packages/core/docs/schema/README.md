---
title: "GeoLeaf — JSON Schema Documentation"
---

# GeoLeaf — JSON Schema Documentation

**Source of truth**: `profiles/schemas/`

---

## Overview

The schema files themselves are stored in `profiles/schemas/`, not in this directory. This page is the documentation entry point for every GeoLeaf JSON Schema (draft-07).

The schemas validate the JSON configuration files of the active profile. They enable autocompletion and inline validation in VSCode through the `$schema` property.

---

## Available schemas

| Schema                       | Validated JSON file         | Description                                                                 |
| ---------------------------- | --------------------------- | --------------------------------------------------------------------------- |
| `geoleaf-config.schema.json` | `geoleaf.config.json`       | Root configuration (debug, branding, data, pwa, security, logging, modules) |
| `profile.schema.json`        | `profile.json`              | Profile manifest (id, label, version, map, Files, modules)                  |
| `basemaps.schema.json`       | `basemaps.json`             | Raster and vector tile sources                                              |
| `ui.schema.json`             | `ui.json`                   | UI controls, permalink, scale bar, filters                                  |
| `features.schema.json`       | `config/core/features.json` | Core features (clustering, geocoding, performance, POI, mapOptions)         |
| `layers.schema.json`         | `layers.json`               | Layer references of the profile                                             |
| `layer-config.schema.json`   | `layers/*/[id]_config.json` | Per-layer configuration (data, styles, popup, sidepanelConfig, clustering)  |
| `style.schema.json`          | `layers/*/styles/*.json`    | Rendering styles (flat format, styleRules, expressionPaint)                 |
| `themes.schema.json`         | `themes.json`               | Layer visibility presets                                                    |
| `mapping.schema.json`        | `mapping.json`              | Normalization of external POI data                                          |

> **Two schemas were listed here after their files were deleted, and this table said nothing
> about it.** `geoleaf-profile.schema.json` (orphan block vocabulary) and `taxonomy.schema.json`
> (the taxonomy moved to a plugin module) no longer exist on disk. They are removed from the
> table rather than annotated: this page tells an integrator what to point `$schema` at, and a
> row for a file that cannot be fetched is worse than no row.
>
> **Every schema listed above is applied by the validator** — that has been true of nine of them
> for a long time, and of `geoleaf-config.schema.json` only since 2026-08-19. Until then this
> page listed it without reservation while the contract spec recorded, in writing, that it was
> never loaded: the document an integrator reads and the document that tells the truth disagreed,
> and only the second one said so.

---

## Usage

### Inline validation (VSCode)

Add `$schema` at the top of the JSON file:

```json
{
    "$schema": "../../schemas/style.schema.json",
    "id": "mon-style",
    "style": {
        "fillColor": "#4681cb",
        "fillOpacity": 0.6,
        "color": "#2a5599",
        "weight": 1
    }
}
```

### Command-line validation (ajv-cli)

```bash
npm install -g ajv-cli

# Validate every style of the tourism profile
ajv validate -s profiles/schemas/style.schema.json \
  -d "profiles/tourism/layers/**/styles/*.json" \
  --all-errors

# Validate the layer configurations
ajv validate -s profiles/schemas/layer-config.schema.json \
  -d "profiles/tourism/layers/**/*_config.json" \
  --all-errors
```

---

## Style format (flat)

GeoLeaf styles use the **flat format** — every property sits at the root of the `style` object. The nested format `{ fill: { color }, stroke: { color } }` is no longer supported since v2.0.0.

### Available properties

| Property          | Type                                | Description                                                                 |
| ----------------- | ----------------------------------- | --------------------------------------------------------------------------- |
| `fillColor`       | `string` (hex)                      | Fill color (polygons)                                                       |
| `fillOpacity`     | `number` 0–1                        | Fill opacity                                                                |
| `color`           | `string` (hex/CSS)                  | Stroke / line color                                                         |
| `weight`          | `number` ≥ 0                        | Stroke width in pixels                                                      |
| `opacity`         | `number` 0–1                        | Stroke opacity                                                              |
| `dashArray`       | `string`                            | Dashes, e.g. `"5 10"`                                                       |
| `lineCap`         | `"butt"` \| `"round"` \| `"square"` | Line cap                                                                    |
| `lineJoin`        | `"bevel"` \| `"miter"` \| `"round"` | Line join                                                                   |
| `radius`          | `number` ≥ 0                        | Circle radius (point layers)                                                |
| `shape`           | `string`                            | Point shape: `"circle"`, `"square"`, etc.                                   |
| `hatch`           | `object`                            | Canvas hatching (enabled, type, spacingPx, renderMode)                      |
| `casing`          | `object`                            | Double outline (enabled, color, opacity, widthPx)                           |
| `expressionPaint` | `object`                            | MapLibre GL properties passed through as-is (zoom, match expressions, etc.) |

### Complete example

```json
{
    "id": "par_categorie",
    "label": "Par catégorie",
    "scaleConfig": { "minScale": 500000, "maxScale": 10000 },
    "style": {
        "fillColor": "#4681cb",
        "fillOpacity": 0.6,
        "color": "#2a5599",
        "weight": 1.5,
        "opacity": 1
    },
    "styleRules": [
        {
            "when": { "field": "properties.categorie", "operator": "==", "value": "A" },
            "style": { "fillColor": "#e74c3c" },
            "legend": { "label": "Catégorie A" }
        }
    ]
}
```

---

## Conditional style rules (styleRules)

`styleRules` provide data-driven styling. The first rule whose condition is true is applied.

### Available operators (16)

| Operator             | Description                       |
| -------------------- | --------------------------------- |
| `==` / `===` / `eq`  | Equal to                          |
| `!=` / `!==` / `neq` | Not equal to                      |
| `>`                  | Greater than                      |
| `>=`                 | Greater than or equal to          |
| `<`                  | Less than                         |
| `<=`                 | Less than or equal to             |
| `contains`           | Contains the substring            |
| `startsWith`         | Starts with                       |
| `endsWith`           | Ends with                         |
| `in`                 | Value present in an array         |
| `notIn`              | Value absent from the array       |
| `between`            | Value within a `[min, max]` range |

### Compound condition (AND)

```json
{
    "when": {
        "all": [
            { "field": "properties.type", "operator": "==", "value": "parc" },
            { "field": "properties.surface", "operator": ">=", "value": 100 }
        ]
    },
    "style": { "fillColor": "#2ecc71" }
}
```

---

## Labels (label object)

The `label` property in a style file can be either a string (display name) or an object configuring map labels.

```json
{
    "label": {
        "enabled": true,
        "visibleByDefault": false,
        "field": "properties.nom",
        "font": {
            "family": "Arial",
            "sizePt": 11,
            "weight": 50,
            "bold": false,
            "italic": false
        },
        "color": "#333333",
        "opacity": 1,
        "buffer": {
            "enabled": true,
            "color": "#ffffff",
            "opacity": 0.8,
            "sizePx": 2
        },
        "background": {
            "enabled": false,
            "color": "#ffffff",
            "opacity": 0.9,
            "paddingPx": 3
        },
        "offset": {
            "distancePx": 8,
            "angleDeg": 0
        }
    }
}
```

---

## expressionPaint (native MapLibre)

For complex cases (zoom interpolations, `match` expressions), use `expressionPaint` with MapLibre GL properties directly:

```json
{
    "style": {
        "expressionPaint": {
            "fill-color": ["interpolate", ["linear"], ["zoom"], 5, "#aaa", 10, "#4681cb"],
            "fill-opacity": ["case", ["get", "actif"], 0.8, 0.3]
        }
    }
}
```

The keys are MapLibre GL paint property names (`fill-color`, `line-width`, `circle-radius`, etc.).

---

## Links

- [Schema sources](https://github.com/geoleaf/geoleaf-js/tree/main/profiles/schemas) — single source of truth
- [PROFILES_GUIDE.md](../PROFILES_GUIDE.md) — profile structure
- [CONFIGURATION_GUIDE.md](../CONFIGURATION_GUIDE.md) — complete configuration guide
