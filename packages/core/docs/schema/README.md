---
title: "GeoLeaf — Documentation des schémas JSON"
---

# GeoLeaf — Documentation des schémas JSON

**Version** : 2.2.0
**Mise à jour** : juin 2026
**Source de vérité** : `profiles/schemas/`

---

## Vue d'ensemble

Ce répertoire ne contient plus les schémas (déplacés dans `profiles/schemas/`). Il sert de point d'entrée documentaire pour tous les schémas JSON Schema draft-07 de GeoLeaf.

Les schémas valident les fichiers de configuration JSON du profil actif. Ils permettent l'autocomplétion et la validation en ligne dans VSCode via la propriété `$schema`.

---

## Schémas disponibles

| Schéma                        | Fichier JSON validé             | Description                                                                                                                                                                   |
| ----------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `geoleaf-config.schema.json`  | `geoleaf.config.json`           | Configuration racine (debug, branding, data, pwa, security, logging, modules)                                                                                                 |
| `profile.schema.json`         | `profile.json`                  | Manifest du profil (id, label, version, map, Files, modules)                                                                                                                  |
| `geoleaf-profile.schema.json` | _(hors-contrat — non appliqué)_ | **Orphelin** : vocabulaire de blocs UI pour `panels.detail.layout[]` (0 profil, 0 réf code). Statut hors-contrat acté par `PROFILE_CONTRACT_SPEC.md` §7 / registre `ANO-002`. |
| `basemaps.schema.json`        | `basemaps.json`                 | Sources de tuiles raster et vectorielles                                                                                                                                      |
| `ui.schema.json`              | `ui.json`                       | Contrôles UI, permalink, échelle, filtres                                                                                                                                     |
| `features.schema.json`        | `config/core/features.json`     | Fonctionnalités core (clustering, géocodage, performance, POI, mapOptions)                                                                                                    |
| `layers.schema.json`          | `layers.json`                   | Références des couches du profil                                                                                                                                              |
| `layer-config.schema.json`    | `layers/*/[id]_config.json`     | Configuration par couche (data, styles, popup, sidepanelConfig, clustering)                                                                                                   |
| `style.schema.json`           | `layers/*/styles/*.json`        | Styles de rendu (format flat, styleRules, expressionPaint)                                                                                                                    |
| `taxonomy.schema.json`        | `taxonomy.json`                 | Taxonomie POI (catégories, icônes, couleurs)                                                                                                                                  |
| `themes.schema.json`          | `themes.json`                   | Préréglages de visibilité des couches                                                                                                                                         |
| `mapping.schema.json`         | `mapping.json`                  | Normalisation des données POI externes                                                                                                                                        |

---

## Utilisation

### Validation en ligne (VSCode)

Ajouter `$schema` au début du fichier JSON :

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

### Validation en ligne de commande (ajv-cli)

```bash
npm install -g ajv-cli

# Valider tous les styles du profil tourism
ajv validate -s profiles/schemas/style.schema.json \
  -d "profiles/tourism/layers/**/styles/*.json" \
  --all-errors

# Valider les configs de couches
ajv validate -s profiles/schemas/layer-config.schema.json \
  -d "profiles/tourism/layers/**/*_config.json" \
  --all-errors
```

---

## Format des styles (flat)

Les styles GeoLeaf utilisent le **format flat** — toutes les propriétés sont au niveau racine de l'objet `style`. Le format nested `{ fill: { color }, stroke: { color } }` n'est plus supporté depuis v2.0.0.

### Propriétés disponibles

| Propriété         | Type                                | Description                                                                |
| ----------------- | ----------------------------------- | -------------------------------------------------------------------------- |
| `fillColor`       | `string` (hex)                      | Couleur de remplissage (polygones)                                         |
| `fillOpacity`     | `number` 0–1                        | Opacité du remplissage                                                     |
| `color`           | `string` (hex/CSS)                  | Couleur du contour / ligne                                                 |
| `weight`          | `number` ≥ 0                        | Épaisseur du contour en pixels                                             |
| `opacity`         | `number` 0–1                        | Opacité du contour                                                         |
| `dashArray`       | `string`                            | Tirets, ex. `"5 10"`                                                       |
| `lineCap`         | `"butt"` \| `"round"` \| `"square"` | Terminaison de ligne                                                       |
| `lineJoin`        | `"bevel"` \| `"miter"` \| `"round"` | Jointure de ligne                                                          |
| `radius`          | `number` ≥ 0                        | Rayon du cercle (couches point)                                            |
| `shape`           | `string`                            | Forme du point : `"circle"`, `"square"`, etc.                              |
| `hatch`           | `object`                            | Hachures canvas (enabled, type, spacingPx, renderMode)                     |
| `casing`          | `object`                            | Double contour (enabled, color, opacity, widthPx)                          |
| `expressionPaint` | `object`                            | Propriétés MapLibre GL passées directement (expressions zoom, match, etc.) |

### Exemple complet

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

## Règles de style conditionnelles (styleRules)

Les `styleRules` permettent un style data-driven. La première règle dont la condition est vraie est appliquée.

### Opérateurs disponibles (16)

| Opérateur            | Description                            |
| -------------------- | -------------------------------------- |
| `==` / `===` / `eq`  | Égalité                                |
| `!=` / `!==` / `neq` | Différence                             |
| `>`                  | Supérieur                              |
| `>=`                 | Supérieur ou égal                      |
| `<`                  | Inférieur                              |
| `<=`                 | Inférieur ou égal                      |
| `contains`           | Contient la sous-chaîne                |
| `startsWith`         | Commence par                           |
| `endsWith`           | Finit par                              |
| `in`                 | Valeur dans un tableau                 |
| `notIn`              | Valeur absente du tableau              |
| `between`            | Valeur dans un intervalle `[min, max]` |

### Condition composée (AND)

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

## Étiquettes (label objet)

La propriété `label` dans un fichier de style peut être une chaîne (nom d'affichage) ou un objet de configuration des étiquettes cartographiques.

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

## expressionPaint (MapLibre natif)

Pour les cas complexes (interpolations de zoom, expressions `match`), utilisez `expressionPaint` avec les propriétés MapLibre GL directement :

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

Les clés sont des noms de propriétés MapLibre GL paint (`fill-color`, `line-width`, `circle-radius`, etc.).

---

## Liens

- [Schémas sources](https://github.com/geoleaf/geoleaf-js/tree/main/profiles/schemas) — source unique de vérité
- [PROFILES_GUIDE.md](../PROFILES_GUIDE.md) — structure des profils
- [CONFIGURATION_GUIDE.md](../CONFIGURATION_GUIDE.md) — guide de configuration complet
