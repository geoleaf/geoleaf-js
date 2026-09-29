---
title: "GeoLeaf — JSON Schema Documentation"
---

# GeoLeaf — JSON Schema Documentation

**Shipped with the package** since v3.13.0: the schemas at `@geoleaf/core/schemas/<name>.schema.json`,
their TypeScript types at `@geoleaf/core/schemas`. **Source of truth** in the repository:
[`profiles/schemas/`](https://github.com/geoleaf/geoleaf-js/tree/main/profiles/schemas) — the package
carries the same bytes.

---

## Overview

A GeoLeaf profile is a **directory**, and no schema describes it whole: each of its files validates
alone, against the schema its place designates — the table below. The schemas are JSON Schema
draft-07; each `$id` is `geoleaf/<name>`, and none references another.

In an installed package they sit in `node_modules/@geoleaf/core/dist/schemas/`.

---

## Available schemas

| Schema                       | Root type (`@geoleaf/core/schemas`) | File it judges, relative to a profile directory | Content                                                                    |
| ---------------------------- | ----------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------- |
| `profile.schema.json`        | `GeoLeafProfile`                    | `profile.json`                                  | Profile manifest (id, label, version, map, Files, modules)                 |
| `geoleaf-config.schema.json` | `GeoLeafRootConfig`                 | `../geoleaf.config.json`, beside the profiles   | Root configuration (debug, data, logging, modules)                         |
| `basemaps.schema.json`       | `GeoLeafBasemaps`                   | `config/core/basemaps.json`                     | Raster and vector tile sources                                             |
| `features.schema.json`       | `GeoLeafCoreFeatures`               | `config/core/features.json`                     | Map options (`mapOptions`)                                                 |
| `layers.schema.json`         | `GeoLeafLayersIndex`                | `config/core/layers.json`                       | The profile's layer references and layer templates                         |
| `ui.schema.json`             | `GeoLeafUIConfig`                   | `config/core/ui.json`                           | UI controls, layer manager                                                 |
| `themes.schema.json`         | `GeoLeafThemes`                     | `config/core/themes.json`                       | Layer visibility presets                                                   |
| `mapping.schema.json`        | `GeoLeafDataMapping`                | `config/core/mapping.json`                      | Normalization of external POI data                                         |
| `layer-config.schema.json`   | `GeoLeafLayerConfig`                | `layers/<id>/<id>_config.json`                  | Per-layer configuration (data, styles, popup, sidepanelConfig, clustering) |
| `style.schema.json`          | `GeoLeafLayerStyle`                 | `layers/<id>/styles/*.json`                     | Rendering styles (flat format, styleRules, expressionPaint)                |

`config/plugins/*.json` has no schema: a module's configuration belongs to its capability or plugin,
and the schemas keep every `modules.<id>` block open.

Every schema above judges real files — the repository's validator applies them to its own
profiles, and the package's own test applies the **shipped** copies to the same profiles.

---

## Usage

### Validate a profile

The recipe the package's test runs against what the tarball carries:

```ts
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Ajv } from "ajv";

const require = createRequire(import.meta.url);
const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
const schemaOf = (name: string) =>
    JSON.parse(readFileSync(require.resolve(`@geoleaf/core/schemas/${name}.schema.json`), "utf8"));

const validateProfile = ajv.compile(schemaOf("profile"));
const profile = JSON.parse(readFileSync("profiles/my-profile/profile.json", "utf8"));
if (!validateProfile(profile)) console.error(validateProfile.errors);
```

Keep these options. Without `allowUnionTypes`, ajv logs four warnings — two schemas declare union
types. `strict: true` works too, as long as `allowUnionTypes` stays: every schema compiles under it,
and the repository refuses a schema that does not. Validate each file of the profile with the schema
the table above names.

`ajv` is your dependency, not GeoLeaf's: the package ships the schemas, never a validator.

### Type a profile built in code

```ts
import type { GeoLeafProfile } from "@geoleaf/core/schemas";

const profile: GeoLeafProfile = { id: "my-profile", label: "My profile", map: { zoom: 6 } };
```

The types are an **upper bound** of the schemas: every file a schema accepts type-checks, the reverse
is not promised — conditional rules, presence rules, patterns and bounds are not expressed, so the
verdict stays with the schemas. One exception: in `config/core/mapping.json`, a `_comment…` key types
only as a string. `./schemas` is `type`-only — a value import from it fails.

The schemas judge the **shape** of a profile, never its data: a field name the data does not carry —
a taxonomy's `subCategoryField`, a style rule's `when.field`, an attribute row's `field` — passes
every schema. The core says it when the layer loads, in one `Log.warn` per layer naming the key and
the field, and it reads each key the way its reader does: a style rule's `field` loses one leading
`properties.`, a label's `field` loses nothing.

### Validation in the editor

Map the shipped schemas to your profile files — for instance in the workspace settings of VS Code,
where a relative `url` is resolved from the workspace folder:

```json
{
    "json.schemas": [
        {
            "fileMatch": ["profiles/*/profile.json"],
            "url": "./node_modules/@geoleaf/core/dist/schemas/profile.schema.json"
        },
        {
            "fileMatch": ["profiles/*/layers/*/styles/*.json"],
            "url": "./node_modules/@geoleaf/core/dist/schemas/style.schema.json"
        }
    ]
}
```

Every schema also accepts a `$schema` key at the root of the file it judges, for editors that read
it: a path relative to the JSON file, ending in `@geoleaf/core/dist/schemas/<name>.schema.json`.

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
        "field": "nom",
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
        "offset": {
            "placement": "top",
            "distancePx": 8
        }
    }
}
```

`field` names a feature property as it is (`"nom"`), not a `properties.` path. The keys the object
accepts, and which of them are rendered, are listed in the
[labels documentation](../labels/GeoLeaf_Labels_README.md#label-configuration-in-style-files).

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
