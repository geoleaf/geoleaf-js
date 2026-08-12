---
title: "GeoLeaf UI Components — Detailed documentation"
---

# GeoLeaf UI Components — Detailed documentation

**Modules**: `GeoLeaf._UIComponents`, `GeoLeaf.UI.Notifications`, and the UI components

**Version**: 3.0.0

**Source files (monorepo)**: `packages/core/src/modules/built-in/ui/`

---

## Overview

The GeoLeaf **UI component** system provides **reusable building blocks** for the map interface. These components standardise:

- DOM element creation with automatic cleanup
- Accordion and panel patterns
- Toast notifications
- Legend symbols (circles, lines, polygons)
- MapLibre controls (scale, coordinates)
- Event handling and UI state

---

## UI component architecture

```
built-in/ui/
├── ui-api.ts                        // Main orchestrator
├── theme.ts                         // Theme management (light/dark)
├── components.ts                    // Reusable DOM components (accordion…)
├── dom-utils.ts                     // resolveField, getActiveProfileConfig
├── event-delegation.ts              // Event delegation
├── pill-search.ts                   // "Pill" search field
├── desktop/                         // Desktop panel
│   ├── desktop-panel.ts
│   ├── desktop-panel-registry.ts
│   ├── desktop-panel-theme.ts
│   └── desktop-tabs-seam.ts
└── mobile/                          // Mobile toolbar
    ├── mobile-toolbar.ts
    ├── mobile-toolbar-pill.ts
    ├── mobile-toolbar-proximity.ts
    ├── mobile-toolbar-sheet.ts
    └── mobile-toolbar-state.ts
```

> **Moved out of `built-in/ui/` in v3.0.0.** The filter panel (`filter-panel*`,
> `filter-state-manager`) belongs to the `filter` capability; notifications to
> `toast-renderer`; the map controls (fullscreen, geolocation, theme, scale, coordinates) to
> their respective capabilities; feature-card rendering (`content-builder`) to `feature-info`.
> These modules no longer live here.

---

## Module 1: `GeoLeaf._UIComponents` (reusable components)

### Role

Provides **reusable components** for Legend and LayerManager: accordions, legend symbols, style elements.

### Main API

#### `createAccordion(container, config)`

Creates an accordion with a clickable header and a collapsible body.

**Parameters**:

- `container` (HTMLElement): parent container
- `config` (Object):
    - `layerId`: layer ID
    - `label`: accordion title
    - `collapsed`: initial state (collapsed or not)
    - `visible`: layer visible (greyed out when false)
    - `onToggle`: callback fired on toggle

**Returns**: `{ accordionEl, headerEl, bodyEl, toggleEl }`

**Example**:

```javascript
const legendContainer = document.querySelector(".gl-legend__body");

const { accordionEl, bodyEl } = GeoLeaf._UIComponents.createAccordion(legendContainer, {
    layerId: "parcs",
    label: "Parks and Gardens",
    collapsed: false,
    visible: true,
    onToggle: (layerId, isExpanded) => {
        console.log(`Accordion ${layerId} is now ${isExpanded ? "open" : "closed"}`);
    },
});

bodyEl.appendChild(document.createTextNode("Legend content"));
```

#### `renderCircleSymbol(container, config)`

Renders a circular symbol (for POIs/markers) with an optional SVG icon.

**Parameters**:

- `container`: symbol container
- `config`:
    - `radius`: radius in pixels (default: 8)
    - `fillColor`: fill colour
    - `color`: border colour
    - `weight`: border thickness
    - `fillOpacity`: opacity
    - `icon`: SVG sprite icon ID (e.g. `'#tree'`)
    - `iconColor`: icon colour

**Example**:

```javascript
const symbolContainer = document.createElement("div");

// Simple circle
GeoLeaf._UIComponents.renderCircleSymbol(symbolContainer, {
    radius: 10,
    fillColor: "#228B22",
    color: "#006400",
    weight: 2,
    fillOpacity: 0.8,
});

// Circle with icon
GeoLeaf._UIComponents.renderCircleSymbol(symbolContainer, {
    radius: 12,
    fillColor: "#FF5733",
    icon: "#restaurant",
    iconColor: "#FFFFFF",
});
```

#### `renderLineSymbol(container, config)`

Renders a line symbol (for roads/LineString).

```javascript
GeoLeaf._UIComponents.renderLineSymbol(symbolContainer, {
    color: "#3388ff",
    weight: 3,
    opacity: 1,
    dashArray: "5, 10",
});
```

#### `renderPolygonSymbol(container, config)`

Renders a polygon symbol (for areas/Polygon).

```javascript
GeoLeaf._UIComponents.renderPolygonSymbol(symbolContainer, {
    fillColor: "#3388ff",
    fillOpacity: 0.4,
    color: "#0066cc",
    weight: 2,
});
```

#### `attachEventHandler(element, eventType, handler)`

Attaches an event listener with automatic cleanup.

```javascript
const cleanup = GeoLeaf._UIComponents.attachEventHandler(button, "click", () =>
    console.log("Clicked!")
);

// Later: remove the listener
cleanup();
```

---

## Module 2: `GeoLeaf.UI.Notifications` (notifications.ts)

### Role

**Toast notification** system with animations and auto-dismiss.

### Main API

#### `init(config)`

Initialises the notification system.

**Config**:

- `container`: container selector (default: `'#gl-notifications'`)
- `maxVisible`: maximum number of visible toasts (default: 3)
- `durations`: durations per type (ms)
- `position`: position (`'bottom-center'`, `'top-right'`, etc.)
- `animations`: enable animations (default: true)

```javascript
GeoLeaf.UI.Notifications.init({
    container: "#gl-notifications",
    maxVisible: 5,
    position: "top-right",
    durations: {
        success: 2000,
        error: 7000,
    },
});
```

#### `success(message, duration?)`

```javascript
GeoLeaf.UI.Notifications.success("Data loaded successfully");
GeoLeaf.UI.Notifications.success("Save complete", 5000);
```

#### `error(message, duration?)`

```javascript
GeoLeaf.UI.Notifications.error("Unable to load the data");
GeoLeaf.UI.Notifications.error("Network error", 10000);
```

#### `warning(message, duration?)`

```javascript
GeoLeaf.UI.Notifications.warning("Unstable connection");
```

#### `info(message, duration?)`

```javascript
GeoLeaf.UI.Notifications.info("Loading...");
```

#### `clear()`

```javascript
GeoLeaf.UI.Notifications.clear();
```

### Generated HTML structure

```html
<div id="gl-notifications" class="gl-notifications gl-notifications--bottom-center">
    <div class="gl-toast gl-toast--success" role="alert" aria-live="polite">
        <div class="gl-toast__icon">✓</div>
        <div class="gl-toast__content">
            <div class="gl-toast__message">Data loaded successfully</div>
        </div>
        <button class="gl-toast__close" aria-label="Close">×</button>
    </div>
</div>
```

---

## Module 3: MapLibre controls

### Role

Every map control is now an **in-core capability**, enabled by configuration and installed by
its own `install.ts` (`capabilities/<id>/`). The `ui/controls.ts` aggregator file no longer
exists.

### API through `GeoLeaf.UI`

```javascript
// Geolocation — implemented by the `geolocation` capability
GeoLeaf.UI.initGeolocationControl(map, {
    position: "topleft",
    enableHighAccuracy: true,
});

// Theme toggle — implemented by the `theme-toggle` capability
GeoLeaf.UI.initThemeToggleControl(map, { position: "topright" });
```

> **Removed from `GeoLeaf.UI` in v3.0.0** _(breaking)_: `initFullscreenControl()` (`fullscreen`
> capability, enabled through `modules.fullscreen`) and `initPoiAddControl()`
> (`@geoleaf-plugins/editor` plugin, driven through `GeoLeaf.Editor`). The scale, coordinates,
> branding and legend controls follow the same model: configuration, not calls.

### Configuration in profile.json

```json
{
    "ui": {
        "controls": {
            "fullscreen": true,
            "geolocation": true,
            "themeToggle": true
        },
        "showCoordinates": true,
        "showScale": true,
        "scaleType": "numeric"
    }
}
```

---

## Module 4: Filtering system (filter-panel/)

### Architecture

The filtering system is split into dedicated modules:

```
filter-panel/
├── filter-panel-accordion.ts  // Filter panel accordions
├── lazy-loader.ts             // Lazy loading of the filter components
├── proximity-manual-mode.ts   // Manual entry of the proximity position
├── proximity-state.ts         // Geolocation state for the proximity filter
├── shared.ts                  // Shared utilities
└── svg-helpers.ts             // Inline SVG icon generation
```

### Generated UI components

**1. Text search**

```html
<div class="gl-filter-control gl-filter-control--search">
    <label for="search-input">Search</label>
    <input type="text" id="search-input" placeholder="Search..." />
</div>
```

**2. Category selector**

```html
<div class="gl-filter-control gl-filter-control--select">
    <label for="category-select">Category</label>
    <select id="category-select">
        <option value="">— All —</option>
        <option value="restaurant">Restaurants</option>
        <option value="hotel">Hotels</option>
    </select>
</div>
```

**3. Multi-selection checkboxes**

```html
<div class="gl-filter-control gl-filter-control--checkboxes">
    <label>Tags</label>
    <div class="gl-filter-checkboxes">
        <label><input type="checkbox" value="parking" /> Parking</label>
        <label><input type="checkbox" value="wifi" /> WiFi</label>
    </div>
</div>
```

**4. Proximity filter**

```html
<div class="gl-filter-control gl-filter-control--proximity">
    <label>Proximity</label>
    <input type="range" min="0" max="5000" step="100" value="1000" />
    <span class="proximity-value">1.0 km</span>
</div>
```

**5. Active tags**

```html
<div class="gl-filter-active-tags">
    <span class="gl-filter-tag" data-filter-type="category" data-filter-value="restaurant">
        Restaurant
        <button class="gl-filter-tag__remove">×</button>
    </span>
    <button class="gl-filter-clear-all">Clear all</button>
</div>
```

### Filter state

```javascript
const filterState = {
    search: "restaurant",
    category: "food",
    subcategory: "",
    tags: ["parking", "wifi"],
    proximity: {
        enabled: true,
        radius: 1000, // metres
        center: [48.8566, 2.3522],
    },
};
```

---

## CSS theming

Every UI component uses **BEM CSS classes** to make customisation straightforward.

### CSS variables

```css
:root {
    /* Notifications */
    --gl-toast-success: #10b981;
    --gl-toast-error: #ef4444;
    --gl-toast-warning: #f59e0b;
    --gl-toast-info: #3b82f6;

    /* Accordions */
    --gl-accordion-header-bg: #f5f5f5;
    --gl-accordion-header-bg-hover: #e0e0e0;
    --gl-accordion-border: #ddd;

    /* Symbols */
    --gl-symbol-size: 16px;
    --gl-symbol-border: #666;

    /* Filters */
    --gl-filter-bg: white;
    --gl-filter-border: #ddd;
    --gl-filter-tag-bg: #3b82f6;
    --gl-filter-tag-color: white;
}

/* Dark theme */
[data-theme="dark"] {
    --gl-accordion-header-bg: #2c3e50;
    --gl-accordion-header-bg-hover: #34495e;
    --gl-accordion-border: #555;
    --gl-filter-bg: #2c3e50;
    --gl-filter-border: #555;
}
```

---

## Cross-module integration

### Example 1: Legend with accordions

```javascript
// In legend-renderer.ts
const { accordionEl, bodyEl } = GeoLeaf._UIComponents.createAccordion(container, {
    layerId: "parcs",
    label: "Parks and Gardens",
    collapsed: false,
    visible: true,
});

const items = [
    { label: "Urban park", color: "#228B22" },
    { label: "Public garden", color: "#90EE90" },
];

items.forEach((item) => {
    const itemEl = document.createElement("div");
    itemEl.className = "gl-legend__item";
    bodyEl.appendChild(itemEl);

    GeoLeaf._UIComponents.renderCircleSymbol(itemEl, {
        fillColor: item.color,
        radius: 8,
    });

    const labelEl = document.createElement("span");
    labelEl.className = "gl-legend__item-label";
    labelEl.textContent = item.label;
    itemEl.appendChild(labelEl);
});
```

### Example 2: Notification after loading

```javascript
// After loading a GeoJSON layer (internal module)
fetch(layerUrl)
    .then(() => {
        GeoLeaf.UI.Notifications.success('Layer "parcs" loaded successfully');
    })
    .catch((error) => {
        GeoLeaf.UI.Notifications.error(`Loading error: ${error.message}`);
    });
```

---

## Limitations

1. **Notifications**: at most 3 simultaneous toasts (configurable through `maxVisible`)
2. **Accordions**: multi-level nesting (accordions inside accordions) is not supported
3. **Symbols**: SVG icons require a defined SVG sprite
4. **Proximity filters**: computed client-side (can be slow beyond 10k POIs)

---

## Related modules

- **[GeoLeaf.Legend](../legend/GeoLeaf_Legend_README.md)**: uses accordions and symbols
- **[GeoLeaf.LayerManager](../layer-manager/GeoLeaf_LayerManager_README.md)**: uses UI components
- **[GeoLeaf.Filter](../API_REFERENCE.md#filter--the-filter-panel-singular)**: attribute filtering (the plural `GeoLeaf.Filters` was removed in v3.1)
- **[GeoLeaf.Layers](../API_REFERENCE.md#layers--feature-data)**: layer data (the POI module was dissolved in v3)
