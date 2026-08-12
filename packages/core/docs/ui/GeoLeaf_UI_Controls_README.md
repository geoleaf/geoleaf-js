---
title: "GeoLeaf.UI.Controls — Documentation"
---

# GeoLeaf.UI.Controls — Documentation

**Version**: 3.0.0
**Source file**: `packages/core/src/modules/built-in/ui/controls.ts`

---

## Overview

The Controls module handles the custom MapLibre GL JS controls added to the map.
Each control is defined in its own module and initialised during the GeoLeaf boot sequence.

---

## Available controls

### Fullscreen Control

Enables and disables the map fullscreen mode.

**Configuration**:

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

**Browser API used**: `element.requestFullscreen()` / `document.exitFullscreen()`

**Source**: `packages/core/src/modules/built-in/ui/control-fullscreen.ts`

---

### Geolocation Control

Locates the user and centres the map on their position.

**Configuration**:

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

**Source**: `packages/core/src/modules/built-in/ui/control-geolocation.ts`

---

### Theme Toggle Control

Switches between the light and dark themes.

**Configuration**:

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

**Source**: `packages/core/src/modules/built-in/ui/control-theme-toggle.ts`

---

### POI Add Control

Displays the POI creation button (requires the `@geoleaf-plugins/editor` plugin, and is configured through `modules.editor.showAddPoi`).

**Source**: `packages/core/src/modules/built-in/ui/control-poi-add.ts`

---

## Integration

The controls are added automatically during `GeoLeaf.Core.init()` when enabled in the configuration.

```ts
import { UI } from "@geoleaf/core";
// or: GeoLeaf.UI (CDN/global)
```

---

## References

- **Source code**: `packages/core/src/modules/built-in/ui/controls.ts`
- **Public facade**: `packages/core/src/modules/geoleaf.ui.ts`
