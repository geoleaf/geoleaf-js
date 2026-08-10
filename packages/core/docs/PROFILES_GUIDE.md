---
title: "GeoLeaf Profiles Guide"
---

﻿# GeoLeaf Profiles Guide

**Product Version:** GeoLeaf Platform V3
**Version:** 3.0.0
**Last Updated:** mars 2026
**Audience:** Developers creating custom business profiles

> Version courante : **GeoLeaf v3.0.0** — structure de profil modulaire (10 fichiers).

---

## Table of Contents

1. [What are Profiles?](#what-are-profiles)
2. [Profile Structure](#profile-structure)
3. [Built-in Profiles](#built-in-profiles)
4. [Creating Custom Profiles](#creating-custom-profiles)
5. [Profile Best Practices](#profile-best-practices)
6. [Profile Migration](#profile-migration)
7. [Troubleshooting](#troubleshooting)

---

## What are Profiles?

### Definition

A **GeoLeaf Profile** is a self-contained configuration package that defines the complete behavior and appearance of a GeoLeaf map application for a specific business domain or use case.

Think of profiles as **themes on steroids** — they control not just visual styling, but also:

- Available POI categories and icons
- Map layers and data sources
- UI components and controls
- Search and filter capabilities
- Basemap options
- Default settings

### Use Cases

| Profile Type    | Best For                | Example Applications                               |
| --------------- | ----------------------- | -------------------------------------------------- |
| **Tourism**     | Public-facing discovery | Tourist attractions, hiking trails, accommodations |
| **Real Estate** | Property management     | Properties, buildings, land parcels                |
| **Emergency**   | Crisis response         | Shelters, hospitals, emergency routes              |
| **Retail**      | Store management        | Store locations, inventory, service areas          |

### When to Create Custom vs Use Built-in

**Use Built-in Profile** if:

- ✅ Your use case closely matches Tourism
- ✅ You only need minor customization (colors, labels)
- ✅ You want to start quickly

**Create Custom Profile** if:

- ✅ You have unique business domain requirements
- ✅ You need custom POI categories (e.g., medical facilities, schools)
- ✅ You require specific data sources or layers
- ✅ You need specialized UI components
- ✅ You want complete control over behavior

---

## Profile Structure

### Directory Layout

```
profiles/
├── geoleaf.config.json          # Config racine (sélection du profil)
└── {profile-name}/              # Répertoire du profil (layout v2 — 2026-06)
    ├── profile.json             # ✅ REQUIS — identité + map + manifeste Files
    ├── config/
    │   ├── core/
    │   │   ├── basemaps.json    # ✅ REQUIS — sources de tuiles
    │   │   ├── ui.json          # ✅ REQUIS — contrôles UI
    │   │   ├── layers.json      # ✅ REQUIS — liste des couches
    │   │   ├── taxonomy.json    # ✅ REQUIS — catégories & icônes POI
    │   │   ├── themes.json      # ✅ REQUIS — préréglages de visibilité
    │   │   └── features.json    # ⚪ Optionnel — clustering, géocodage, performance, POI
    │   └── plugins/
    │       └── {module-id}.json # ⚪ Optionnel — config par plugin (storage, addpoi…)
    └── layers/                  # ⚪ Optionnel — configs & données GeoJSON
        └── {layer-id}/
            ├── {layer-id}_config.json   # Config de la couche
            └── styles/
                ├── defaut.json          # Style par défaut
                └── *.json               # Styles alternatifs
```

> Tous les chemins sont déclarés dans le manifeste `Files` de `profile.json` — seul
> `profile.json` a un nom et un emplacement imposés. En déploiement, un
> `profile-bundle.json` pré-généré fusionne toutes les sections en un seul fetch.

### Required Files

#### 1. profile.json

**Purpose:** Main configuration file defining UI, basemaps, and behavior.

**Key Sections:**

```json
{
    "id": "my-profile",
    "label": "My Custom Profile",
    "description": "Brief description",
    "version": "1.0.0",
    "map": {
        "bounds": [
            [-56, -74],
            [-21, -53]
        ],
        "center": [-15, -62],
        "zoom": 6,
        "positionFixed": true
    },
    "Files": {
        "themesFile": "config/core/themes.json",
        "layersFile": "config/core/layers.json",
        "basemapsFile": "config/core/basemaps.json",
        "uiFile": "config/core/ui.json"
    },
    "performance": {
        "maxConcurrentLayers": 8,
        "layerLoadDelay": 200,
        "fitBoundsOnThemeChange": false
    }
}
```

**See:** [Configuration Guide - profile.json](CONFIGURATION_GUIDE.md#3-profilejson---profile-configuration)

---

#### 2. basemaps.json

**Purpose:** Defines tile sources (raster and vector). Extracted from `profile.json` since v2.0.0.

**Key Structure:**

```json
{
    "basemaps": {
        "street": {
            "id": "street",
            "label": "Street Map",
            "type": "tile",
            "url": "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "attribution": "&copy; OpenStreetMap contributors",
            "subdomains": "abc",
            "minZoom": 3,
            "maxZoom": 19,
            "defaultBasemap": true,
            "offline": true
        },
        "satellite": {
            "id": "satellite",
            "label": "Satellite",
            "type": "maplibre",
            "style": "https://cdn.example.com/styles/satellite.json",
            "fallbackUrl": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            "defaultBasemap": false
        },
        "satellite-3d": {
            "id": "satellite-3d",
            "label": "Satellite 3D",
            "type": "tile",
            "url": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            "attribution": "Tiles &copy; Esri",
            "defaultBasemap": false,
            "terrain": {
                "enabled": true,
                "demUrl": "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
                "demEncoding": "terrarium",
                "demMaxZoom": 15,
                "exaggeration": 1.5,
                "default3D": true,
                "pitch": 60,
                "bearing": 0
            }
        }
    }
}
```

> **Terrain 3D** — `default3D: true` active automatiquement le relief 3D dès que ce basemap est sélectionné. Pas de toggle UI : le passage vers un basemap sans terrain désactive le relief. La clé `map.maxPitch` dans `profile.json` contrôle l'inclinaison maximale autorisée (défaut GeoLeaf : 80°). Voir la [référence complète des champs `terrain.*`](PROFILE_JSON_REFERENCE.md#basemapsidterrain-object-optionnel).

**See:** [Configuration Guide - basemaps.json](CONFIGURATION_GUIDE.md#basemapsjson)

---

#### 3. ui.json

**Purpose:** UI controls visibility and configuration. Extracted from `profile.json` since v2.0.0.

**Key Structure:**

```json
{
    "showLayerManager": true,
    "showFilterPanel": true,
    "showLegend": true,
    "showCacheButton": false,
    "showAddPoi": false,
    "enableGeolocation": true,
    "language": "fr",
    "permalink": {
        "enabled": false,
        "mode": "hash"
    }
}
```

**See:** [Configuration Guide - ui.json](CONFIGURATION_GUIDE.md#uijson)

---

#### 4. layers.json

**Purpose:** Lists all layers available in the profile.

**Key Structure:**

```json
[
    {
        "id": "villes_principales",
        "label": "Villes principales",
        "configFile": "layers/villes_principales/villes_principales_config.json",
        "visible": true,
        "layerManagerId": "group-geo"
    }
]
```

---

#### 5. taxonomy.json

**Purpose:** Defines POI categories, subcategories, and icon configuration.

**Key Sections:**

```json
{
    "icons": {
        "spriteUrl": "path/to/sprite.svg",
        "symbolPrefix": "my-prefix-",
        "defaultIcon": "default-icon"
    },

    "categories": {
        "category-1": {
            "label": "Category 1",
            "icon": "icon-name",
            "subcategories": {
                "subcat-1": {
                    "label": "Subcategory 1",
                    "icon": "icon-name"
                }
            }
        }
    }
}
```

**See:** [Configuration Guide - taxonomy.json](CONFIGURATION_GUIDE.md#4-taxonomyjson---categories-and-icons)

---

#### 6. themes.json

**Purpose:** Defines layer visibility presets (themes).

**Key Sections:**

```json
{
    "config": {
        "defautTheme": "default",
        "primaryThemes": { "enabled": false },
        "secondaryThemes": { "enabled": true, "placeholder": "Choisir un thème" }
    },
    "themes": [
        {
            "id": "default",
            "label": "Vue complète",
            "type": "primary",
            "icon": "🗺️",
            "layers": [
                { "id": "villes_principales", "visible": true },
                { "id": "routes_principales", "visible": false }
            ]
        }
    ]
}
```

**See:** [Configuration Guide - themes.json](CONFIGURATION_GUIDE.md#5-themesjson---layer-visibility-presets)

---

### Optional Files

#### mapping.json

**Purpose:** Normalizes external data to GeoLeaf's internal format.

**Use When:**

- Loading data from external APIs
- Converting CSV/Excel to GeoJSON
- Transforming property names
- Applying data transformations (scale, regex, concat)

**Example:**

```json
{
    "poi": {
        "mapping": {
            "id": "feature_id",
            "title": "name",
            "latlng": {
                "lat": "latitude",
                "lng": "longitude"
            },
            "category": "poi_category",
            "properties": {
                "description": "desc",
                "phone": "contact.phone"
            }
        }
    },

    "transforms": [
        {
            "field": "poi_category",
            "type": "map",
            "mappings": {
                "hotel": "hebergements",
                "restaurant": "food"
            }
        }
    ]
}
```

**See:** [Configuration Guide - mapping.json](CONFIGURATION_GUIDE.md#7-mappingjson---data-normalization)

---

#### layers/ Directory

**Purpose:** GeoJSON layer configurations and data.

**Structure for each layer:**

```
layers/{layer-id}/
├── {layer-id}_config.json  # Layer configuration. REQUIRED for a layer declared in
│                           #   layers[]; FORBIDDEN for a layerTemplates instance
├── data/
│   └── {file}.geojson      # Data, addressed by data.directory + data.file
└── styles/
    ├── defaut.json         # Default style, addressed by styles.default
    └── *.json              # Additional styles, listed in styles.available[]
```

The config file name and the directory name must match the layer `id` — the file is resolved
from the `configFile` path declared in `layers.json`, and the layer's own directory is derived
from it. See `PRF-LAYERS` in `docs/specs/contrats/PROFILE_CONTRACT_SPEC.md`.

**See:** [Configuration Guide - layers.json](CONFIGURATION_GUIDE.md#6-layersjson---layer-definitions)

---

#### layerTemplates (layers.json)

**Purpose:** Declare a family of layers that share their configuration, so that each member
states only what is proper to it. A templated layer has **no configuration file at all** — its
config is assembled in memory at load time.

**Where it lives:** in the layers file named by `Files.layersFile` (conventionally
`config/core/layers.json`), as a sibling of `layers[]` — **not** in `profile.json`.

**Shape:** an **array** of templates. Each template carries a shared `template` object and the
list of `instances` built from it. There is no reference-by-name: a layer does not point at a
template, it _is_ an instance of one.

**Example in layers.json:**

```json
{
    "layers": [
        {
            "id": "sites_rosario",
            "configFile": "layers/sites_rosario/sites_rosario_config.json",
            "layerManagerId": "data-tourism"
        }
    ],
    "layerTemplates": [
        {
            "templateId": "pluviometrie",
            "layerManagerId": "data-climate",
            "template": {
                "zIndex": 93,
                "geometry": "polygon",
                "data": { "directory": "data" },
                "styles": {
                    "directory": "styles",
                    "default": "defaut.json",
                    "available": [{ "id": "defaut", "label": "défaut", "file": "defaut.json" }]
                },
                "table": { "enabled": false },
                "clustering": { "enabled": false }
            },
            "instances": [
                {
                    "id": "pluviometrie_janvier",
                    "label": "Pluviométrie — Janvier",
                    "dataFile": "pluviometrie_janvier.geojson"
                },
                {
                    "id": "pluviometrie_fevrier",
                    "label": "Pluviométrie — Février",
                    "dataFile": "pluviometrie_fevrier.geojson",
                    "zIndex": 92
                }
            ]
        }
    ]
}
```

`id`, `label` and `dataFile` are required on every instance. **Any other key on an instance is
an override** applied over the shared `template` — `pluviometrie_fevrier` above raises its own
`zIndex` while inheriting everything else.

**How the config is assembled** (`expandLayerTemplates`, `kernel/config/profile-loader-helpers.ts`):

```
{ ...template, ...overrides, id, label, data: { directory, file: dataFile } }
```

Three properties of that assembly are load-bearing, and each one constrains what a template can
express:

- **Overrides are shallow.** Overriding an object **replaces it wholesale** — an instance that
  restates `table` loses the template's `table.enabled`. There is no deep merge here (unlike
  module blocks, which do merge deeply).
- **`data` is rebuilt, not merged.** Only `template.data.directory` survives; the file name comes
  from the instance's `dataFile`. **Every other key under `data` is dropped** — so a layer that
  needs `data.vectorTiles`, `data.realtime`, `data.mapping` or a `data.url` source **cannot be a
  template instance** and must stay a direct entry in `layers[]`.
- **`layerManagerId` is per-template**, never per-instance: one template serves exactly one
  layer-manager section.

⚠️ **A templated layer skips the HTTP fetch entirely**, so a `{layer-id}_config.json` sitting next
to it would never be read. Leaving one there is a build failure, enforced by
`scripts/check-template-layer-configs.cjs` (**TPL-CFG**) — a dead file that looks like a live one
gets edited, and the edit silently does nothing.

N.B. `templateId` is required by the schema and used only as a human label; the loader never reads
it (tracked as ANO-051).

---

## Built-in Profiles

GeoLeaf includes three production-ready profiles that showcase different use cases.

### Tourism Profile

**Use Case:** Tourist attractions, activities, accommodations, nature sites

**Structure:**

```
profiles/tourism/
├── profile.json         (identité + map + Files)
├── config/core/
│   ├── taxonomy.json    (categories: activites, culture, nature, hebergements)
│   ├── themes.json      (4+ themes)
│   ├── layers.json      (35+ layer configs)
│   ├── basemaps.json
│   ├── ui.json
│   └── features.json    (clustering, performance, POI — géocodage → plugin)
└── layers/              (35+ directories)
    ├── activites-aquatiques/
    │   ├── data.geojson
    │   └── styles/
    │       ├── default.json
    │       └── detailed.json
    ├── culture-musees/
    ├── hebergements-hotels/
    └── ...
```

**Key Features:**

- **35+ layers** organized by category
- **46 migrated styles** (introduced with `label.visibleByDefault`)
- **Icon sprite** with 50+ tourism symbols
- **Sample data** for major French cities
- **4 category groups:** Activités, Culture, Nature, Hébergements
- **Multiple themes:** Default, Heritage, Nature Focus

**Configuration Highlights:**

```json
{
    "ui": {
        "showLayerManager": true,
        "showFilterPanel": true,
        "showLegend": true,
        "showCacheButton": true
    },

    "basemaps": {
        "street": { "defaultBasemap": true, "offline": true },
        "satellite": { "offline": false },
        "topo": { "offline": false }
    },

    "performance": {
        "maxConcurrentLayers": 10,
        "layerLoadDelay": 200
    }
}
```

**Best For:**

- Tourism boards
- Travel apps
- Hiking/outdoor applications
- Cultural heritage sites

---

---

## Creating Custom Profiles

Follow these steps to create a new profile from scratch.

### Step 1: Create Profile Directory

```bash
mkdir -p profiles/my-profile
cd profiles/my-profile
```

### Step 2: Create profile.json

Start with a minimal template:

```json
{
    "id": "my-profile",
    "label": "My Custom Profile",
    "description": "Brief description",
    "version": "1.0.0",
    "map": {
        "bounds": [
            [-56, -74],
            [-21, -53]
        ],
        "center": [-15, -62],
        "zoom": 6,
        "positionFixed": true
    },
    "Files": {
        "themesFile": "config/core/themes.json",
        "layersFile": "config/core/layers.json",
        "basemapsFile": "config/core/basemaps.json",
        "uiFile": "config/core/ui.json"
    },
    "performance": {
        "maxConcurrentLayers": 8,
        "layerLoadDelay": 200,
        "fitBoundsOnThemeChange": false
    }
}
```

**Customization checklist:**

- ✅ Set unique `id` (lowercase, no spaces)
- ✅ Configure `ui` components needed
- ✅ Define at least one basemap
- ✅ Set default map `center` and `zoom`

---

### Step 3: Create taxonomy.json

Define your POI categories:

```json
{
    "icons": {
        "spriteUrl": "assets/icons/sprite.svg",
        "symbolPrefix": "my-prefix-",
        "defaultIcon": "default-icon"
    },

    "defaults": {
        "icon": "default-icon"
    },

    "categories": {
        "category-1": {
            "label": "Category 1",
            "icon": "icon-1",
            "subcategories": {
                "subcat-1": {
                    "label": "Subcategory 1",
                    "icon": "icon-1a"
                },
                "subcat-2": {
                    "label": "Subcategory 2",
                    "icon": "icon-1b"
                }
            }
        },
        "category-2": {
            "label": "Category 2",
            "icon": "icon-2",
            "subcategories": {}
        }
    }
}
```

**Tips:**

- Keep category IDs lowercase with hyphens
- Limit depth to 2 levels (category → subcategory)
- Use semantic icon names
- Plan for 5-15 top-level categories max

---

### Step 4: Create themes.json

Define layer visibility presets:

```json
{
    "config": {
        "defaultTheme": "default",
        "allowCustomThemes": true,
        "persistSelection": true
    },

    "themes": [
        {
            "id": "default",
            "label": "Default View",
            "icon": "view-all",
            "layers": {
                "layer-1": true,
                "layer-2": true,
                "layer-3": true
            }
        },
        {
            "id": "minimal",
            "label": "Minimal View",
            "icon": "view-minimal",
            "layers": {
                "layer-1": true,
                "layer-2": false,
                "layer-3": false
            }
        }
    ]
}
```

**Tips:**

- Start with 2-4 themes
- Include an "All Layers" theme
- Name themes by purpose, not technical details
- Keep theme switching fast (avoid >20 layers per theme)

---

### Step 5: Add Layers (Optional)

If you have GeoJSON layers:

**A. Create layers directory:**

```bash
mkdir -p layers/my-layer/styles
```

**B. Add layer data:**

`layers/my-layer/data.geojson`

```json
{
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {
                "name": "Location 1",
                "category": "category-1"
            },
            "geometry": {
                "type": "Point",
                "coordinates": [2.5, 46.8]
            }
        }
    ]
}
```

**C. Add default style:**

`layers/my-layer/styles/default.json`

```json
{
    "$schema": "../../../../schema/style.schema.json",
    "id": "default",
    "name": "Default Style",

    "label": {
        "enabled": true,
        "visibleByDefault": false,
        "field": "name"
    },

    "style": {
        "fillColor": "#3b82f6",
        "fillOpacity": 0.6,
        "color": "#1e40af",
        "weight": 2,
        "opacity": 1.0
    },

    "legend": {
        "enabled": true,
        "title": "My Layer",
        "items": [
            {
                "label": "Feature",
                "color": "#3b82f6"
            }
        ]
    }
}
```

**D. Register layer in layers.json:**

`layers.json`

```json
{
    "layers": [
        {
            "id": "my-layer",
            "name": "My Layer",
            "type": "point",
            "dataSource": "layers/my-layer/data.geojson",
            "defaultStyle": "default",
            "availableStyles": ["default"],
            "minZoom": 8,
            "maxZoom": 19
        }
    ]
}
```

---

### Step 6: Prepare Sample Data (Optional)

If you have POI data, create `poi.json`:

```json
{
    "version": "1.0",
    "count": 2,
    "source": "Sample data",

    "pois": [
        {
            "id": "poi-001",
            "latlng": [46.8, 2.5],
            "title": "Sample POI 1",
            "category": "category-1",
            "subcategory": "subcat-1",
            "properties": {
                "description": "Description here",
                "address": "123 Main St"
            }
        },
        {
            "id": "poi-002",
            "latlng": [46.9, 2.6],
            "title": "Sample POI 2",
            "category": "category-2",
            "properties": {}
        }
    ]
}
```

---

### Step 7: Update Root Config

Add your profile to `profiles/geoleaf.config.json`:

```json
{
    "data": {
        "activeProfile": "my-profile",
        "profilesBasePath": "/profiles/"
    },

    "profiles": [
        {
            "id": "tourism",
            "label": "Tourism",
            "description": "Tourist attractions and activities"
        },
        {
            "id": "my-profile",
            "label": "My Custom Profile",
            "description": "Brief description"
        }
    ]
}
```

---

### Step 8: Test Your Profile

**A. Start dev server:**

```bash
npm start
```

**B. Load your profile:**

```
http://localhost:8080/demo/?profile=my-profile
```

**C. Enable debug mode:**

```javascript
// Activer dans geoleaf.config.json
// { "debug": true }

// Ou en console
GeoLeaf.Config.set("debug", true);
```

**D. Check console for errors:**

Look for:

- ❌ Profile loading errors
- ❌ Missing files (taxonomy, themes)
- ❌ Invalid JSON syntax
- ❌ Icon sprite not found

---

### Step 9: Validate Configuration

**A. Validate JSON with schemas:**

```bash
# Install AJV CLI
npm install -g ajv-cli

# Valider les fichiers du profil
ajv validate -s profiles/schemas/geoleaf-profile.schema.json -d profiles/my-profile/profile.json
ajv validate -s profiles/schemas/basemaps.schema.json -d profiles/my-profile/basemaps.json
ajv validate -s profiles/schemas/ui.schema.json -d profiles/my-profile/ui.json
ajv validate -s profiles/schemas/taxonomy.schema.json -d profiles/my-profile/taxonomy.json
ajv validate -s profiles/schemas/themes.schema.json -d profiles/my-profile/themes.json
ajv validate -s profiles/schemas/layer-config.schema.json -d "profiles/my-profile/layers/**/*_config.json"
ajv validate -s profiles/schemas/style.schema.json -d "profiles/my-profile/layers/**/styles/*.json"
```

**B. Test in VS Code:**

Add `$schema` reference to each file:

```jsonc
{
    "$schema": "../../schemas/taxonomy.schema.json",
}
```

---

## Profile Best Practices

### Naming Conventions

**Profile IDs:**

- ✅ Use lowercase with hyphens: `my-profile`
- ❌ Avoid spaces or special chars: `My Profile!`
- ✅ Be descriptive: `retail-store-locator`
- ❌ Don't be generic: `profile1`

**Category IDs:**

- ✅ Use semantic names: `restaurants`, `hotels`
- ❌ Avoid abbreviations: `rest`, `htl`
- ✅ Pluralize categories: `museums`, not `museum`
- ❌ Don't use generic names: `type1`, `category-a`

**Layer IDs:**

- ✅ Use descriptive names: `heritage-sites`, `bike-routes`
- ❌ Avoid technical names: `layer1`, `geojson-data`
- ✅ Include type if helpful: `zones-nature`, `routes-bike`

---

### Icon Sprite Optimization

**SVG Sprite Structure:**

```xml
<svg xmlns="http://www.w3.org/2000/svg">
  <symbol id="my-prefix-icon-1" viewBox="0 0 24 24">
    <path d="..." />
  </symbol>
  <symbol id="my-prefix-icon-2" viewBox="0 0 24 24">
    <path d="..." />
  </symbol>
</svg>
```

**Best Practices:**

1. **Consistent prefix:** All symbol IDs start with same prefix

    ```json
    "symbolPrefix": "my-prefix-"
    ```

2. **Standardize viewBox:** Use 24x24 for consistency

    ```xml
    viewBox="0 0 24 24"
    ```

3. **Optimize file size:**
    - Remove unnecessary groups
    - Simplify paths
    - Use SVGO: `svgo sprite.svg -o sprite.optimized.svg`

4. **Limit icon count:** 50-100 icons max per sprite
    - Split into multiple sprites if needed
    - Load sprites on-demand

5. **Use semantic names:** `hotel`, not `icon-01`

---

### Taxonomy Hierarchy

**Recommended Depth:**

```
Category (Level 1)
└── Subcategory (Level 2)
    └── ❌ DON'T GO DEEPER
```

**Why?**

- UI becomes cluttered with >2 levels
- Filter panel complexity increases
- User confusion increases

**Good Example:**

```json
{
    "categories": {
        "food": {
            "label": "Food & Drink",
            "subcategories": {
                "restaurant": { "label": "Restaurants" },
                "cafe": { "label": "Cafés" },
                "bar": { "label": "Bars" }
            }
        }
    }
}
```

**Bad Example (too deep):**

```jsonc
{
    "categories": {
        "food": {
            "subcategories": {
                "restaurant": {
                    "subcategories": {
                        "italian": {
                            "subcategories": {
                                "pizza": {}, // ❌ Too deep!
                            },
                        },
                    },
                },
            },
        },
    },
}
```

---

### Theme Count Recommendations

| Profile Size          | Recommended Themes | Why                              |
| --------------------- | ------------------ | -------------------------------- |
| Small (5-10 layers)   | 2-3 themes         | Keep it simple                   |
| Medium (10-20 layers) | 3-5 themes         | Balance flexibility & simplicity |
| Large (20+ layers)    | 4-6 themes         | Help users navigate complexity   |

**Theme Strategy:**

1. **Always include "All Layers"** - Users want to see everything
2. **Create purpose-based themes** - "Heritage Sites", not "Theme A"
3. **Group related layers** - Don't scatter similar layers across themes
4. **Test switching performance** - Keep <1 second to switch

---

### Performance Considerations

#### For Large Profiles (100+ layers)

**Problem:** Slow loading, memory issues, UI lag

**Solutions:**

1. **Lazy load layers:**

    ```json
    {
        "performance": {
            "maxConcurrentLayers": 5,
            "layerLoadDelay": 300
        }
    }
    ```

2. **Use layer visibility themes strategically:**
    - Don't enable all layers by default
    - Create focused themes with 5-10 layers max

3. **Enable clustering for dense POI layers:**

    ```json
    {
        "defaultSettings": {
            "clustering": {
                "enabled": true,
                "maxClusterRadius": 80
            }
        }
    }
    ```

4. **Optimize GeoJSON:**
    - Simplify geometries (reduce precision)
    - Remove unnecessary properties
    - Use `.geojson` instead of inline JSON

5. **Split large layers:**
    - Instead of one "Restaurants" layer with 10,000 POIs
    - Create regional layers: "Restaurants Paris", "Restaurants Lyon"

---

#### For POI-heavy Profiles

**If you have 1000+ POIs:**

1. **Enable clustering** (essential)
2. **Set appropriate zoom levels:**

    ```json
    {
        "minZoom": 10, // Don't render at country-level zoom
        "maxZoom": 19
    }
    ```

3. **Use vector tiles** (advanced) if available
4. **Implement search/filter** to narrow results

---

## Profile Migration

### legacy to 1.0.0

**Key Changes:**

1. **Modular structure** - Split monolithic config
2. **New file structure** - Separate taxonomy, themes, layers
3. **Layer manager** - New UI component
4. **Profile object** - New top-level structure

**Migration Steps:**

**Before (legacy):**

```jsonc
{
    "pois": [
        /* all POIs inline */
    ],
    "categories": {
        /* inline taxonomy */
    },
    "basemaps": {
        /* ... */
    },
}
```

**After (1.0.0):**

```
profiles/my-profile/
├── profile.json       # basemaps, UI config
├── taxonomy.json      # categories (extracted)
├── themes.json        # NEW
└── poi.json           # POIs (extracted)
```

**After (layout v2 — 2026-06):**

```
profiles/my-profile/
├── profile.json               # identité + map + manifeste Files UNIQUEMENT
└── config/
    ├── core/                  # taxonomy / themes / layers / basemaps / ui / features
    └── plugins/{module}.json  # un fichier par plugin (bloc modules.<id>)
```

Migration v1 → v2 : déplacer les fichiers de section dans `config/core/`, extraire les
features core (`clusteringConfig`, `performance`, `poiConfig` — géocodage → plugin) de
`profile.json` vers `config/core/features.json`, extraire chaque bloc plugin
(`storage`, `poiAddConfig`, `editorConfig`…) vers `config/plugins/{module-id}.json`,
puis mettre à jour les chemins du manifeste `Files` (+ `featuresFile`, `modules`).

**See:** Developer Guide for complete migration guidance

---

### 1.0.x to 1.1.0

**Key Changes:**

1. **Label configuration moved** - `visibleByDefault` now in style files
2. **Breaking change** - Layer config `label.visibleByDefault` deprecated

**Migration Steps:**

**Before (1.0.x) - Layer config:**

```jsonc
{
    "layers": [
        {
            "id": "my-layer",
            "label": {
                "enabled": true,
                "visibleByDefault": true, // ❌ DEPRECATED
                "field": "name",
            },
        },
    ],
}
```

**After (1.1.0) - Style file:**

```jsonc
{
    "id": "default",
    "label": {
        "enabled": true,
        "visibleByDefault": true, // ✅ NOW HERE
        "field": "name",
    },
    "style": {
        /* ... */
    },
}
```

**Automated Migration:**

```bash
# Run migration script
node scripts/migrate-label-config.cjs

# Or manually use label migrator
node scripts/add-missing-label-config.cjs
```

**See:** [Labels Documentation](labels/GeoLeaf_Labels_README.md) for complete details

---

### Structure modulaire (v2.0.0)

**Changements principaux :**

1. **`basemaps` extrait** — Déplacé de `profile.json` vers `basemaps.json`
2. **`ui` extrait** — Déplacé de `profile.json` vers `ui.json`
3. **`layers` extrait** — Déplacé de `profile.json` vers `layers.json`
4. **Section `Files`** — `profile.json` contient maintenant une section `Files` pointant vers les fichiers séparés

**Avant (structure monolithique héritée) :**

```json
{
    "id": "mon-profil",
    "ui": { "showLayerManager": true, "showFilterPanel": true },
    "basemaps": { "street": {} },
    "layers": [{ "id": "couche1" }]
}
```

**Après (structure modulaire — v2.0.0) :**

`profile.json`

```json
{
    "id": "mon-profil",
    "Files": {
        "themesFile": "config/core/themes.json",
        "layersFile": "config/core/layers.json",
        "basemapsFile": "config/core/basemaps.json",
        "uiFile": "config/core/ui.json"
    }
}
```

`basemaps.json` → `{ "basemaps": { "street": { } } }`

`ui.json` → `{ "showLayerManager": true, ... }`

`layers.json` → `[ { "id": "couche1", ... } ]`

> **Rétrocompat** — Les sections `ui` et `basemaps` directement dans `profile.json` restent supportées (chargement inline).

---

## Troubleshooting

### Profile Not Loading

**Symptom:** Blank map, console error "Profile not found"

**Causes & Solutions:**

1. **Incorrect profile ID in config**

    ```javascript
    // Check console
    console.log(GeoLeaf.Config.getActiveProfile());

    // Should match profile directory name
    ```

2. **Wrong profilesBasePath**

    ```json
    {
        "data": {
            "profilesBasePath": "/profiles/" // Check this path
        }
    }
    ```

3. **profile.json syntax error**
    - Use JSON validator: https://jsonlint.com/
    - Check for trailing commas (invalid in JSON)
    - Check for missing quotes

4. **CORS issues (if using file:// protocol)**
    - Use a local web server: `npm start`
    - Or run Chrome with: `--allow-file-access-from-files`

---

### Icons Not Showing

**Symptom:** Generic markers instead of custom icons

**Causes & Solutions:**

1. **Sprite URL incorrect**

    ```json
    {
        "icons": {
            "spriteUrl": "../path/to/sprite.svg" // Check path relative to profile.json
        }
    }
    ```

2. **Symbol ID mismatch**

    ```json
    // taxonomy.json
    "icon": "hotel"  // Must match symbol ID in sprite

    // sprite.svg
    <symbol id="my-prefix-hotel">  // Prefix + icon name
    ```

3. **Sprite not loading (check Network tab)**
    - 404: Incorrect spriteUrl path
    - CORS: Sprite on different domain
    - 200 but still not showing: Check symbol IDs

4. **Missing defaultIcon**
    ```json
    {
        "icons": {
            "defaultIcon": "generic" // Fallback if icon not found
        }
    }
    ```

---

### Layers Empty

**Symptom:** Layer loads but shows 0 features

**Causes & Solutions:**

1. **Invalid GeoJSON**
    - Validate at: https://geojsonlint.com/
    - Check coordinates format: `[lng, lat]` NOT `[lat, lng]`

2. **Data outside map bounds**

    ```javascript
    // Check feature bounds
    const layer = GeoLeaf.GeoJSON.getLayerById("my-layer");
    console.log(layer.getBounds());
    ```

3. **Incorrect dataSource path**

    ```json
    {
        "dataSource": "layers/my-layer/data.geojson" // Relative to profile root
    }
    ```

4. **Zoom level out of range**

    ```json
    {
        "minZoom": 8, // Layer only visible at zoom 8-19
        "maxZoom": 19
    }
    ```

    - Zoom to correct level or adjust min/maxZoom

5. **Layer hidden by theme**
    - Check current theme settings
    - Verify layer ID in themes.json

---

### Themes Not Working

**Symptom:** Theme selector shows themes but switching doesn't change layers

**Causes & Solutions:**

1. **Layer IDs don't match**

    ```json
    // themes.json
    "layers": {
      "my-layer": true  // Must match layer ID exactly
    }

    // layers.json
    {
      "id": "my-layer"  // Must match
    }
    ```

2. **Theme persistence conflict**

    ```json
    {
        "config": {
            "persistSelection": false // Try disabling persistence
        }
    }
    ```

3. **Cache issue**
    ```javascript
    // Clear theme cache
    localStorage.removeItem("geoleaf-theme-selection");
    location.reload();
    ```

---

### Labels Not Showing

**Symptom:** Labels configured but not appearing

**Causes & Solutions:**

1. **label.enabled = false in style**

    ```json
    {
        "label": {
            "enabled": true, // ✅ Must be true
            "visibleByDefault": true,
            "field": "name"
        }
    }
    ```

2. **Label field missing in data**

    ```javascript
    // Check if field exists
    const layer = GeoLeaf.GeoJSON.getLayerById("my-layer");
    layer.eachLayer((feature) => {
        console.log(feature.properties.name); // Should exist
    });
    ```

3. **Zoom level below labelScale.minZoom**

    ```json
    {
        "labelScale": {
            "minZoom": 14, // Labels only show at zoom 14+
            "maxZoom": 19
        }
    }
    ```

4. **visibleByDefault = false**
    - Click label button in Layer Manager to enable

5. **1.0.x config still in use**
    - Migrate to 1.1.0: see [Labels Documentation](labels/GeoLeaf_Labels_README.md)

---

### Performance Issues

**Symptom:** Map slow, browser hangs, high memory usage

**Causes & Solutions:**

1. **Too many layers enabled**

    ```json
    {
        "performance": {
            "maxConcurrentLayers": 5 // Limit concurrent layers
        }
    }
    ```

2. **Large GeoJSON files**
    - Simplify geometries
    - Split into regional layers
    - Use clustering for POIs

3. **No clustering for dense POI layers**

    ```json
    {
        "defaultSettings": {
            "clustering": {
                "enabled": true,
                "maxClusterRadius": 80
            }
        }
    }
    ```

4. **Too many label updates**
    - Check console for "[LabelButtonManager] Bouton créé" spam
    - Labels module should debounce updates (300ms)

5. **Memory leak from layers**
    ```javascript
    // Clear layers before switching profiles
    GeoLeaf.GeoJSON.clearAll();
    ```

---

## Related Documentation

- **[Configuration Guide](CONFIGURATION_GUIDE.md)** - Complete JSON reference
- **[Getting Started](GETTING_STARTED.md)** - Quick 5-minute tutorial
- **[User Guide](USER_GUIDE.md)** - Using GeoLeaf features
- **[Tourism Profile](https://github.com/geoleaf/geoleaf-js/tree/main/profiles/tourism)** - Working profile example
- **[Schema Documentation](schema/README.md)** - JSON Schema validation
- **[Labels Documentation](labels/GeoLeaf_Labels_README.md)** - Labels system and migration

---

## Support

For help with profile creation:

1. **Check Tourism profile:** `profiles/tourism/` directory has complete working profile
2. **Review built-in profiles:** Tourism in `profiles/` directory
3. **Validate your JSON:** Use JSON Schema validation
4. **Enable debug mode:** See detailed logs in console
5. **Open an issue:** [GitHub Issues](https://github.com/yourusername/geoleaf-js/issues)

---

**Last Updated:** January 23, 2026  
**GeoLeaf Version:** 1.2.0
