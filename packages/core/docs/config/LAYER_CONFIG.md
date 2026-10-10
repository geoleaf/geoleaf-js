---
title: "Layer Configuration Schema"
---

# Layer Configuration Schema

## Overview

This document defines the structure and requirements for layer configuration files in GeoLeaf. Each layer in a profile requires a `*_config.json` file that defines how the layer should be loaded, displayed, and styled.

## File Naming Convention

Configuration files follow the pattern: `<layer-id>_config.json`

Example: `villes_principales_config.json` for a layer with ID `villes_principales`

## Directory Structure

```
profiles/
└── <profile-name>/
    └── layers/
        └── <layer-id>/
            ├── <layer-id>_config.json        (Layer configuration)
            ├── data/
            │   └── <layer-id>.geojson        (Geographic data)
            └── styles/
                ├── defaut.json               (Default style)
                ├── <style-name>.json         (Additional styles)
                └── ...
```

## Configuration Properties

### Required Properties

| Property           | Type   | Description                                                           | Example                                                                                         |
| ------------------ | ------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `id`               | string | Unique identifier for the layer, must be lowercase with underscores   | `"villes_principales"`                                                                          |
| `label`            | string | Display name shown in layer manager and UI (should be human-readable) | `"Villes principales"`                                                                          |
| `geometry`         | string | Type of geometry features in this layer                               | `"point"` \| `"polygon"` \| `"polyline"` \| `"multipolygon"` \| `"multiline"` \| `"multipoint"` |
| `data.file`        | string | Name of the GeoJSON file containing features                          | `"villes_principales.geojson"`                                                                  |
| `styles.default`   | string | Filename of the default style                                         | `"defaut.json"`                                                                                 |
| `styles.available` | array  | Array of available style objects (see below)                          | See table below                                                                                 |

### Optional Properties

| Property           | Type    | Default    | Description                                        | Example    |
| ------------------ | ------- | ---------- | -------------------------------------------------- | ---------- |
| `zIndex`           | integer | N/A        | Stacking order (0-99), higher values appear on top | `94`       |
| `data.directory`   | string  | `"data"`   | Subdirectory containing GeoJSON files              | `"data"`   |
| `styles.directory` | string  | `"styles"` | Subdirectory containing style files                | `"styles"` |

### Complete Optional Properties

| Property           | Type    | Default     | Description                                                           |
| ------------------ | ------- | ----------- | --------------------------------------------------------------------- |
| `type`             | string  | `"geojson"` | Layer type — always `"geojson"` for GeoJSON layers                    |
| `interactiveShape` | boolean | `false`     | Enable click/hover interaction on the geometric shape                 |
| `showIconsOnMap`   | boolean | `true`      | Show POI icons on the map (point layers)                              |
| `attributes`       | object  | —           | What the tooltip, the popup and the side panel show (`fields[]`)      |
| `table`            | object  | —           | Data table (`enabled`, `columns[]`, `defaultSort`)                    |
| `clustering`       | object  | —           | Clustering (`enabled`, `maxClusterRadius`, `disableClusteringAtZoom`) |
| `legends`          | object  | —           | Legend file references (`directory`, `default`)                       |

> See [schema/README.md](../schema/README.md) and `profiles/schemas/layer-config.schema.json` for the full JSON Schema definition.

### Style Item Properties

Each item in `styles.available` must have:

| Property | Type   | Description                      | Example         |
| -------- | ------ | -------------------------------- | --------------- |
| `id`     | string | Unique identifier for this style | `"defaut"`      |
| `label`  | string | Display name in style selector   | `"Default"`     |
| `file`   | string | Filename of the style JSON       | `"defaut.json"` |

## Complete Schema (JSON Schema)

See [schema/README.md](../schema/README.md) for the formal JSON Schema documentation.

## Example Configuration

<!-- geoleaf:docs:schema layer-config -->

```json
{
    "id": "villes_principales",
    "label": "Villes principales",
    "zIndex": 94,
    "geometry": "point",
    "data": {
        "directory": "data",
        "file": "villes_principales.geojson"
    },
    "styles": {
        "directory": "styles",
        "default": "defaut.json",
        "available": [
            {
                "id": "defaut",
                "label": "défaut",
                "file": "defaut.json"
            },
            {
                "id": "population",
                "label": "population",
                "file": "population.json"
            }
        ]
    }
}
```

### Complete Example (with optional properties)

`attributes` is the one list that says which property is shown where: each field names the
surfaces it appears on — `tooltip` (hover), `popup` (click), `sidepanel` (opened from the popup).

<!-- geoleaf:docs:schema layer-config -->

```json
{
    "id": "villes_principales",
    "label": "Villes principales",
    "type": "geojson",
    "geometry": "point",
    "zIndex": 94,
    "interactiveShape": true,
    "showIconsOnMap": false,
    "data": {
        "directory": "data",
        "file": "villes_principales.geojson"
    },
    "styles": {
        "directory": "styles",
        "default": "defaut.json",
        "available": [{ "id": "defaut", "label": "Défaut", "file": "defaut.json" }]
    },
    "attributes": {
        "titleField": "properties.name",
        "fields": [
            {
                "field": "properties.name",
                "label": "Nom",
                "primitive": "string",
                "widget": "text",
                "display": {
                    "surfaces": ["tooltip", "popup", "sidepanel"],
                    "presentation": { "emphasis": "title" }
                }
            }
        ]
    },
    "table": {
        "enabled": true,
        "columns": [{ "field": "properties.name", "label": "Nom", "sortable": true }],
        "defaultSort": { "field": "properties.name", "order": "asc" }
    },
    "clustering": { "enabled": true, "maxClusterRadius": 80, "disableClusteringAtZoom": 12 }
}
```

## Usage in Code

The layer configuration is loaded and used throughout GeoLeaf:

### Loading

- Loaded from: `profiles/<profile-id>/layers/<layer-id>/<layer-id>_config.json`
- Parsed as JSON and validated against the schema

### Display

- `label` is shown in the layer manager/control panel
- `zIndex` determines the stacking order in the map

### Data

- `data.file` path is resolved to load the GeoJSON features
- `data.directory` provides the base path (default: `data/`)

### Styling

- `styles.default` is applied when the layer first loads
- `styles.available` populates the style selector UI
- Users can switch between available styles; each has its own JSON definition file

## Validation

All layer configuration files should be validated against the schemas documented in [schema/README.md](../schema/README.md) to ensure consistency.

## Common Mistakes

**Incorrect**: missing `label` at top level

```jsonc
{
  "id": "my_layer",
  // Missing "label" here
  "zIndex": 50,
  ...
}
```

**Correct**: include a readable label

```jsonc
{
  "id": "my_layer",
  "label": "My Layer Display Name",
  "zIndex": 50,
  ...
}
```

---

**Incorrect**: style IDs not matching between file name and content

```jsonc
"available": [
  {
    "id": "my_style",
    "label": "My Style",
    "file": "different_name.json"  // Inconsistent naming
  }
]
```

**Correct**: consistent naming

```jsonc
"available": [
  {
    "id": "my_style",
    "label": "My Style",
    "file": "my_style.json"  // Matches the ID
  }
]
```
