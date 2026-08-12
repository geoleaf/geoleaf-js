---
title: "Cache Button"
---

# Cache Button

**Provided by:** `@geoleaf-plugins/offline-ui`
**Requires:** `@geoleaf-plugins/offline-ui` loaded and registered

---

## Description

The Cache Button is a MapLibre GL JS control injected by the `@geoleaf-plugins/offline-ui` plugin when the option `showCacheButton` is enabled. It provides an offline cache management UI accessible from the map interface.

> This component is part of the Storage plugin and is **not** included in `@geoleaf/core`. The core only detects its presence and delegates initialisation to the plugin.

---

## Configuration

Enable or disable the button in your GeoLeaf profile:

```jsonc
{
    "ui": {
        "showCacheButton": true, // default: true when Storage plugin is loaded
    },
}
```

---

## Public API

When the Storage plugin is loaded, the following methods are available:

```js
// Initialised automatically at boot (if showCacheButton: true)
GeoLeaf.UI.CacheButton.init(map, cfg);

// Open the cache management modal programmatically
GeoLeaf.UI.CacheButton.openModal();

// Close the modal
GeoLeaf.UI.CacheButton.closeModal();
```

---

## Accessibility

- Keyboard shortcut: `Escape` closes the modal
- ARIA attributes on the control button
- Colour contrast compliant

---

## Full Documentation

The complete API and implementation details are documented in the Storage plugin's own package.

See also: [FAQ](../FAQ.md)
