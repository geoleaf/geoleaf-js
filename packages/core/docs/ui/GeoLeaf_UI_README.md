---
title: "GeoLeaf.UI — UI module documentation"
---

# GeoLeaf.UI — UI module documentation

**Version:** 3.0.0

**Module:** `packages/core/src/modules/built-in/ui/` (facade: `geoleaf.ui.ts`)

The **GeoLeaf.UI** module handles every user-interface aspect of GeoLeaf. It follows a **modular architecture**, with dedicated sub-modules for specific responsibilities.

---

## UI module architecture

The UI module is split into TypeScript sub-modules:

| Source file                    | Responsibilities                                                       |
| ------------------------------ | ---------------------------------------------------------------------- |
| **`geoleaf.ui.ts`** (facade)   | Exports `UI` from `built-in/ui/ui-api.ts`                              |
| **`ui-api.ts`** (orchestrator) | Delegates to the sub-modules and adapts `notify()`                     |
| **`ui/theme.ts`**              | Light/dark theme: system detection, persistence, CSS class application |
| **`ui/components.ts`**         | `_UIComponents` aggregate — recomposes `legend-symbols` + `widgets`    |
| **`ui/legend-symbols.ts`**     | Legend symbol rendering (circle, line, polygon, star, icon)            |
| **`ui/widgets.ts`**            | Reusable DOM components (accordion, toggles…)                          |
| **`ui/event-delegation.ts`**   | DOM event delegation                                                   |
| **`ui/pill-search.ts`**        | "Pill" search field                                                    |
| **`ui/ui-slot-builder.ts`**    | Visibility guard + SVG allowlist for slot buttons (desktop and mobile) |
| **`ui/toolbar-dispatch.ts`**   | Emission of `geoleaf:toolbar:action` (including lazy resolution)       |
| **`ui/roving-tabindex.ts`**    | Keyboard arithmetic for roving-tabindex widgets (WCAG 1.5.5)           |
| **`ui/desktop/`**              | Desktop panel and registry                                             |
| **`ui/mobile/`**               | Mobile toolbar                                                         |

> **Detailed documentation per component:**
>
> - [GeoLeaf_UI_Components_README.md](./GeoLeaf_UI_Components_README.md) - Internal UI components

---

## Responsibilities of the UI module

GeoLeaf.UI covers **5 functional domains**:

### 1. Visual theme management

- Applies the light/dark theme to `<body>` and `#geoleaf-map`
- Detects the system preference (`prefers-color-scheme`) through `initAutoTheme()`
- Persists the choice in `localStorage` (key `geoleaf_theme`)
- Interactive toggle through `data-gl-role="theme-toggle"`
- Keeps listening to `matchMedia` so OS changes are followed in auto mode

### 2. ~~POI panel construction~~ — moved

Feature-card rendering (side panel, popup, tooltip) with JSON layouts, dot-notation field
resolution and accordion sections **no longer belongs to `GeoLeaf.UI`**: it is handled by the
**`feature-info`** capability, built into the core and configured per layer
(`layers.<id>.capabilities.feature-info`). The `ui/content-builder/` module that carried this
domain has been removed, along with `GeoLeaf.POI` (the POI sub-system was dissolved in v3.0.0).
See [API_REFERENCE.md](../API_REFERENCE.md).

### 3. ~~Filter panels~~ — moved

The filter panel (construction from the profile, category/tag/search/proximity states, counters,
active tags) belongs to the **`filter`** capability and is driven through **`GeoLeaf.Filter`**
(singular). `GeoLeaf.UI` no longer builds any of it.

### 4. MapLibre controls

- Geolocation control (`initGeolocationControl`)
- Theme-toggle control embedded in the map (`initThemeToggleControl`)

> These two methods are still exposed on `GeoLeaf.UI`, but the implementation lives in the
> `geolocation` and `theme-toggle` capabilities. Fullscreen and POI creation are no longer
> `GeoLeaf.UI` controls: the former belongs to the `fullscreen` capability, the latter to the
> `@geoleaf-plugins/editor` plugin (`GeoLeaf.Editor`).

### 5. DOM utilities

- Toast notifications (`success`, `error`, `warning`, `info`) — rendered by the
  `toast-renderer` capability; `GeoLeaf.UI.notify()` remains the call surface
- Event delegation
- DOM helpers (`resolveField`, `getActiveProfileConfig`)

> **What GeoLeaf.UI does NOT handle**:
>
> - Basemaps (see `GeoLeaf.Baselayers`)
> - Layer data, points included (see `GeoLeaf.Layers`)
> - Filtering logic (see `GeoLeaf.Filter`)
> - Feature-card rendering on click (`feature-info` capability, configured per layer)
> - GeoJSON (internal module, configured through `geojsonLayers` in `profile.json`)
> - Legend (see `GeoLeaf.Legend`)

---

## Public API

### Theme API

| Function                      | Description                                            | Returns  |
| ----------------------------- | ------------------------------------------------------ | -------- |
| `getCurrentTheme()`           | Returns the active theme (`"light"` or `"dark"`)       | `string` |
| `applyTheme(theme, persist?)` | Applies a theme (`"light"`, `"dark"`)                  | `void`   |
| `toggleTheme()`               | Switches between light and dark                        | `void`   |
| `initThemeToggle(options)`    | Initialises the theme toggle button                    | `void`   |
| `initAutoTheme(themeConfig)`  | Initialises the auto theme from the profile `ui.theme` | `void`   |

**Example:**

```js
// Apply the dark theme
GeoLeaf.UI.applyTheme("dark");

// Read the current theme
const theme = GeoLeaf.UI.getCurrentTheme(); // "dark"

// Toggle
GeoLeaf.UI.toggleTheme(); // switches to "light"

// Initialise from the profile configuration (called automatically at boot)
GeoLeaf.UI.initAutoTheme("auto"); // detects prefers-color-scheme
```

### Controls API

| Function                               | Description                       | Parameters                             |
| -------------------------------------- | --------------------------------- | -------------------------------------- |
| `initGeolocationControl(map, options)` | Initialises geolocation           | `map`: maplibre.Map, `options`: Object |
| `initThemeToggleControl(map, options)` | Theme control embedded in the map | `map`: maplibre.Map, `options`: Object |

**Example:**

```js
import * as maplibregl from "maplibre-gl";
const map = new maplibregl.Map({ container: "map", style: "..." });

GeoLeaf.UI.initGeolocationControl(map, {});
```

> **Removed in v3.0.0** _(breaking)_: `initFullscreenControl()` and `initPoiAddControl()` no
> longer exist on `GeoLeaf.UI`. Fullscreen is an in-core capability enabled by configuration
> (`modules.fullscreen`); POI creation belongs to the `@geoleaf-plugins/editor` plugin and is
> driven through `GeoLeaf.Editor`.

### Notifications API

| Function                           | Description                         |
| ---------------------------------- | ----------------------------------- |
| `Notifications.init(config)`       | Initialises the notification system |
| `Notifications.success(msg, dur?)` | Success toast (green)               |
| `Notifications.error(msg, dur?)`   | Error toast (red)                   |
| `Notifications.warning(msg, dur?)` | Warning toast (orange)              |
| `Notifications.info(msg, dur?)`    | Information toast (blue)            |
| `Notifications.clearAll()`         | Removes every active toast          |

**Example:**

```js
GeoLeaf.UI.Notifications.success("Data loaded");
GeoLeaf.UI.Notifications.error("Network error", 8000);
```

### Filter panel API — removed from `GeoLeaf.UI` in v3.0.0

> **`GeoLeaf.UI.buildFilterPanelFromActiveProfile()` no longer exists** _(breaking)_. Its builder
> (`ui/filter-panel/**`) was removed when the `filter` capability was extracted: the panel now
> builds itself from the active profile, and is driven through **`GeoLeaf.Filter`**.

**Example:**

```js
// The panel is mounted by the `filter` capability (enabled by configuration).
// React to a filter change:
GeoLeaf.Events.on("geoleaf:filters:applied", () => {
    console.log(GeoLeaf.Filter.getActiveFilter());
});

// Apply / reset programmatically:
GeoLeaf.Filter.applyFilter(filterState);
GeoLeaf.Filter.reset();
```

---

## Initialisation

### Through `GeoLeaf.UI.init()`

Wrapper function that initialises the main UI components:

```js
GeoLeaf.UI.init({
    buttonSelector: '[data-gl-role="theme-toggle"]', // Theme button selector
    autoInitOnDomReady: true, // Auto init on DOMContentLoaded
    map: mapInstance, // MapLibre instance
    mapContainer: document.getElementById("map"), // Container used for fullscreen
});
```

In practice, `init()` is called automatically at boot. Calling it manually is not required.

---

## JSON configuration integration

The UI module reads its configuration from `GeoLeaf.Config` (active profile):

```json
{
    "ui": {
        "theme": "auto",
        "showCoordinates": true,
        "showScale": true,
        "scaleType": "numeric",
        "permalink": {
            "enabled": true,
            "mode": "hash"
        }
    },
    "layouts": {
        "poiSidePanel": [
            { "type": "title", "field": "label" },
            { "type": "rating", "field": "attributes.rating" }
        ]
    },
    "filters": [
        {
            "id": "categories",
            "type": "select",
            "label": "Catégorie",
            "field": "categoryId"
        }
    ]
}
```

---

## Integration with other modules

### UI ↔ Theme (sub-module)

```js
// geoleaf.ui.ts delegates to ui/theme.ts
GeoLeaf.UI.applyTheme("dark");
// → ui/theme.ts applies the CSS classes on <body> and #geoleaf-map
// → dispatches the "geoleaf:ui-theme-changed" event
```

### UI ↔ Filters

> **BREAKING (v3.0.0)** — `GeoLeaf.Filters.filterPoiList` is **removed**: it had no internal
> consumer. The active filter panel is the `GeoLeaf.Filter` capability (singular) —
> `getActiveFilter()` / `applyFilter(state)`. See
> [API_REFERENCE.md](../API_REFERENCE.md#filter--the-filter-panel-singular).
>
> **BREAKING (v3.1.0)** — the `GeoLeaf.Filters` namespace (plural) is removed entirely. All that
> remained was `filterRouteList`, with no caller.

```js
// UI builds the interface, GeoLeaf.Filter (capability) runs the logic
const state = GeoLeaf.Filter.getActiveFilter();
GeoLeaf.Filter.applyFilter(state);
```

### UI ↔ feature cards

Feature-card rendering is no longer driven from `GeoLeaf.UI`. Clicking a feature emits
`geoleaf:feature:click`, which the `feature-info` capability renders according to the layer
configuration:

```js
// Configured per layer — no imperative call:
// layers.<id>.capabilities.feature-info = { … }
GeoLeaf.Events.on("geoleaf:feature:click", (e) => {
    console.log(e.detail.layerId, e.detail.properties);
});
```

### UI ↔ Config

```js
// UI reads the active profile for layouts and filters
const profile = GeoLeaf.Config.getActiveProfile();
const layout = profile.layouts?.poiSidePanel || [];
```

---

## Good practices

### Do

```js
// 1. Use applyTheme for programmatic changes
GeoLeaf.UI.applyTheme("dark");

// 2. Drive the filter panel through the Filter capability
//    (the panel is built from the profile by the capability itself)
GeoLeaf.Filter.applyFilter(filterState);
GeoLeaf.Filter.reset();

// 3. Customise a layer's feature card by CONFIGURATION, not by call
//    layers.<id>.capabilities.feature-info — rendered by the feature-info capability
```

### Avoid

```js
// 1. Manipulating the theme CSS classes directly
document.body.classList.add("gl-theme-dark"); // use applyTheme()

// 2. Building the HTML of a feature card by hand
container.innerHTML = `<h2>${f.label}</h2>`; // configure capabilities.feature-info

// 3. Reaching into the sub-modules directly
import { _UITheme } from "ui/theme.ts"; // use GeoLeaf.UI.applyTheme()
```

---

## Full API summary

| Category          | Main functions                                                                               | Documentation                        |
| ----------------- | -------------------------------------------------------------------------------------------- | ------------------------------------ |
| **Theme**         | `getCurrentTheme()`, `applyTheme()`, `toggleTheme()`, `initThemeToggle()`, `initAutoTheme()` | This README                          |
| **Controls**      | `initGeolocationControl()`, `initThemeToggleControl()`                                       | This README                          |
| **Notifications** | `notify()`, `Notifications.success()`, `.error()`, `.warning()`, `.info()`, `.clearAll()`    | This README                          |
| **Mobile**        | `initMobileToolbar()`                                                                        | This README                          |
| **Init**          | `init()`                                                                                     | This README                          |
| ~~**Filters**~~   | moved — see `GeoLeaf.Filter` (`filter` capability)                                           | [API_REFERENCE](../API_REFERENCE.md) |
| ~~**Content**~~   | moved — see the `feature-info` capability                                                    | [API_REFERENCE](../API_REFERENCE.md) |

---

## See also

- [API_REFERENCE.md](../API_REFERENCE.md#layers--feature-data) - Layer data (replaces the POI module, dissolved in v3)
- [API_REFERENCE.md](../API_REFERENCE.md#filter--the-filter-panel-singular) - Filter capability
- [GeoLeaf_Config_README.md](../config/GeoLeaf_Config_README.md) - Configuration
- [GeoLeaf_Core_README.md](../core/GeoLeaf_core_README.md) - Core module
