---
title: "GeoLeaf.UI.Controls — Documentation"
---

# GeoLeaf.UI.Controls — Documentation

**Version** : 3.0.0
**Fichier source** : `packages/core/src/modules/built-in/ui/controls.ts`
**Dernière mise à jour** : mars 2026

---

## Vue d'ensemble

Le module Controls gère les contrôles personnalisés MapLibre GL JS ajoutés à la carte.
Chaque contrôle est défini dans son propre module et initialisé lors du boot GeoLeaf.

---

## Contrôles disponibles

### Fullscreen Control

Active/désactive le mode plein écran de la carte.

**Configuration** :

```json
{
    "ui": {
        "fullscreen": {
            "enabled": true,
            "position": "topleft"
        }
    }
}
```

**API navigateur utilisée** : `element.requestFullscreen()` / `document.exitFullscreen()`

**Source** : `packages/core/src/modules/built-in/ui/control-fullscreen.ts`

---

### Geolocation Control

Géolocalise l'utilisateur et centre la carte sur sa position.

**Configuration** :

```json
{
    "ui": {
        "geolocation": {
            "enabled": true,
            "position": "topleft"
        }
    }
}
```

**Source** : `packages/core/src/modules/built-in/ui/control-geolocation.ts`

---

### Theme Toggle Control

Bascule entre le thème clair et sombre.

**Configuration** :

```json
{
    "ui": {
        "themeToggle": {
            "enabled": true,
            "position": "topleft"
        }
    }
}
```

**Source** : `packages/core/src/modules/built-in/ui/control-theme-toggle.ts`

---

### POI Add Control

Affiche le bouton d'ajout de POI (nécessite le plugin `@geoleaf-plugins/editor`, et se règle par `modules.editor.showAddPoi`).

**Source** : `packages/core/src/modules/built-in/ui/control-poi-add.ts`

---

## Intégration

Les contrôles sont automatiquement ajoutés lors de `GeoLeaf.Core.init()` si activés dans la configuration.

```ts
import { UI } from "@geoleaf/core";
// ou : GeoLeaf.UI (CDN/global)
```

---

## Références

- **Code source** : `packages/core/src/modules/built-in/ui/controls.ts`
- **Façade publique** : `packages/core/src/modules/geoleaf.ui.ts`

---

**Dernière mise à jour** : mars 2026
**Version GeoLeaf** : 3.0.0
