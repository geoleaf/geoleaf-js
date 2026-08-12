---
title: "GeoLeaf.Core — Core module documentation"
---

# GeoLeaf.Core — Core module documentation

**Applies to**: @geoleaf/core v3.x (MapLibre GL JS ^6.0.0)
**Source (monorepo)**: `packages/core/src/modules/built-in/map/`

---

The **GeoLeaf.Core** module is the kernel of the **GeoLeaf** library.

It handles:

- initialisation of the **MapLibre GL JS** map;
- keeping a single map instance behind an `IMapAdapter` (engine abstraction);
- managing and synchronising the **UI theme** (light / dark) with the other modules.

The other modules (Baselayers, UI, POI, GeoJSON, Route, Legend, Config, and so on) **all** rely on the map created by `GeoLeaf.Core`.

> Architecture note: GeoLeaf.Core never exposes `maplibregl.Map` directly. It returns an `IMapAdapter` (implemented by `MaplibreAdapter`) that abstracts every map operation. This keeps the library independent of the rendering engine.

---

## 1. Functional role of the Core

GeoLeaf.Core has three main responsibilities:

1. Create and initialise a MapLibre GL JS map in a DOM container through `MaplibreAdapter`.
2. Expose the map instance to the other modules through `GeoLeaf.Core.getMap()` (returns an `IMapAdapter`).
3. Centralise the **current UI theme** (`"light"` / `"dark"`) and offer a simple API to read and change it.

> Important: GeoLeaf.Core does **not** handle:
>
> - base layers (basemaps);
> - POIs / GeoJSON / routes;
> - advanced UI controls.
>
> Those responsibilities belong to the other GeoLeaf modules.

---

## 2. Public API of GeoLeaf.Core

The `Core` object exports the following methods:

| Method                 | Role                                          |
| ---------------------- | --------------------------------------------- |
| `Core.init(options)`   | Initialises the MapLibre GL JS map            |
| `Core.getMap()`        | Returns the active `IMapAdapter` instance     |
| `Core.getAdapter()`    | Alias of `getMap()` (internal use by modules) |
| `Core.setTheme(theme)` | Changes the UI theme after initialisation     |
| `Core.getTheme()`      | Returns the current UI theme                  |

---

### 2.1 `GeoLeaf.Core.init(options)`

Main initialisation function.
It resolves the DOM container, creates a `MaplibreAdapter`, applies the UI theme and initialises the legend.

```js
const adapter = GeoLeaf.Core.init(options);
```

**Parameters:**

- `options.mapId` — **required** — `id` of the DOM element hosting the map.
- `options.center` — initial centre, as a `[lat, lng]` array.
- `options.zoom` — initial zoom level.
- `options.theme` — UI theme (`"light"` by default).
- `options.mapOptions` — additional engine options (see §3.5).

**Returns:**

- The `IMapAdapter` instance when initialisation succeeds.
- `null` on error (container not found, engine exception, and so on).

> In automatic boot mode (`GeoLeaf.boot()`), `Core.init()` is called internally by `app/init.ts` through `GeoLeaf.init()`. Calling it manually is not required.

#### Direct example (standalone mode)

```js
// Direct usage — bypasses the boot system
const adapter = GeoLeaf.Core.init({
    mapId: "geoleaf-map",
    center: [45.76, 4.84], // Lyon, FR — [lat, lng]
    zoom: 13,
    theme: "light",
});

if (!adapter) {
    console.error("[App] Map initialization failed — check mapId and DOM.");
}
```

---

### 2.2 `GeoLeaf.Core.getMap()`

Returns the `IMapAdapter` instance already initialised, or `null` when no map exists.

```js
const adapter = GeoLeaf.Core.getMap();

if (adapter) {
    // Navigate to a new position
    adapter.setView({ lat: 48.85, lng: 2.35 }, 14); // Paris
    console.log("Current zoom:", adapter.getZoom());
}
```

**Recommended usage:**

- inside the other GeoLeaf modules (POI, GeoJSON, Route, Legend, and so on);
- in external code that needs to drive the map without reinitialising it.

---

### 2.3 `GeoLeaf.Core.getAdapter()`

Strict alias of `getMap()`. Used internally by the POI, Route and GeoJSON modules to state explicitly that they consume the adapter.

```js
const adapter = GeoLeaf.Core.getAdapter();
```

---

### 2.4 `GeoLeaf.Core.setTheme(theme)`

Changes the UI theme after initialisation.

```js
GeoLeaf.Core.setTheme("dark");
```

**Parameter:**

- `theme`: `"light"` or `"dark"`.

**Behaviour:**

- When `GeoLeaf.UI` is present, the call is delegated to the canonical theme engine: CSS classes
  `gl-theme-light` / `gl-theme-dark` on `document.body` **and** on the `#geoleaf-map`
  container (full-screen support), persistence in `localStorage`
  (`geoleaf_theme`), synchronisation of the theme button `aria-pressed` state,
  and emission of the `geoleaf:ui-theme-changed` event.
- Otherwise (UI not loaded), the `gl-theme-*` classes are applied to `document.body`.

On an invalid value:

- GeoLeaf.Core logs a warning: `[GeoLeaf.Core] setTheme() ignored an invalid theme: {value}`.
- The current theme is left unchanged.

`GeoLeaf.Core.setTheme()`, `GeoLeaf.setTheme()` and `GeoLeaf.UI.applyTheme()`
therefore reach the same engine: they are interchangeable.

---

### 2.5 `GeoLeaf.Core.getTheme()`

Returns the current UI theme.

```js
const currentTheme = GeoLeaf.Core.getTheme(); // "light" | "dark"
```

It reads through the canonical theme engine when `GeoLeaf.UI` is present, so the
value also reflects changes made by the theme button, by `GeoLeaf.setTheme()` or
by the boot sequence. Without `GeoLeaf.UI`, the value is derived from the class
present on `document.body` (default `"light"`).

**Typical usage:** synchronising an external component with the visual state of GeoLeaf.

---

## 3. Core options in detail

### 3.1 `mapId` (required)

- **Type**: `string`
- **Required**: **yes**
- **Description**: `id` of the DOM element in which the map must be created.

HTML example:

```html
<div id="geoleaf-map"></div>
```

**Validation:**

- `mapId` must be a non-empty string.
- A DOM element carrying that `id` must exist when the call is made.

If either fails (`mapId` missing, or DOM element not found):

- `Core.init()` throws an exception, caught internally.
- An error is logged: `[GeoLeaf.Core] ERROR: The required 'mapId' option is missing.`
- `null` is returned.

---

### 3.2 `center` (recommended)

- **Type**: `[number, number]` — `[latitude, longitude]` array
- **Convention**: latitude first (GeoLeaf order), longitude second.
- **Description**: initial centre of the map.

Example:

```js
center: [45.76, 4.84]; // Lyon, FR
```

In practice, during automatic boot the centre is computed from the `map.bounds` of the active profile. Specifying it manually is not required in that mode.

---

### 3.3 `zoom` (recommended)

- **Type**: `number`
- **Default value**: `CONSTANTS.DEFAULT_ZOOM` (defined in `modules/utils/constants/`)
- **Description**: initial zoom level of the map.

**Recommended ranges:**

- practical range: `2` to `18` for most base maps;
- some base maps go up to `19` or `20` depending on the provider.

---

### 3.4 `theme` (optional)

- **Type**: `"light"` | `"dark"`
- **Default value**: `"light"`
- **Description**: current UI theme. It applies to the interface (header, buttons, panels, legend) and **never** to the tiles.

```js
theme: "dark";
```

**Behaviour:**

- When `theme` is `"light"` or `"dark"`: the theme is stored and applied.
- When `theme` is absent: `"light"` is used.
- When `theme` holds an unknown value: a warning is logged and the current theme is left unchanged.

> Reminder: the tile choice (Street / Topo / Satellite) is handled by `GeoLeaf.Baselayers` and does not depend on the UI theme.

---

### 3.5 `mapOptions` (optional)

Additional options forwarded to the MapLibre GL JS engine through the adapter.

| Key         | Type            | Description                       |
| ----------- | --------------- | --------------------------------- |
| `minZoom`   | `number`        | Minimum allowed zoom              |
| `maxZoom`   | `number`        | Maximum allowed zoom              |
| `maxBounds` | `GeoLeafBounds` | Restricts panning to a given area |

`GeoLeafBounds` is an object `{ north, south, east, west }` (all in decimal degrees).

Example with a position constraint:

```js
GeoLeaf.Core.init({
    mapId: "geoleaf-map",
    center: [45.76, 4.84],
    zoom: 12,
    mapOptions: {
        minZoom: 8,
        maxZoom: 18,
        maxBounds: { north: 46.5, south: 45.0, east: 5.5, west: 4.0 },
    },
});
```

---

## 4. The IMapAdapter interface

`GeoLeaf.Core.getMap()` returns an `IMapAdapter` object, not a direct `maplibregl.Map` instance. That abstraction isolates the modules from the rendering engine.

### 4.1 Navigation and view

```js
const adapter = GeoLeaf.Core.getMap();

// Set view (center + zoom)
adapter.setView({ lat: 48.85, lng: 2.35 }, 14);

// Animate to position
adapter.flyTo({ lat: 45.76, lng: 4.84 }, 13);

// Pan without zoom change
adapter.panTo({ lat: 43.3, lng: 5.37 });

// Fit bounds
adapter.fitBounds(
    { north: 46.5, south: 45.0, east: 5.5, west: 4.0 },
    { padding: { x: 50, y: 50 }, animate: false }
);

// Read state
const center = adapter.getCenter(); // { lat, lng }
const zoom = adapter.getZoom(); // number
const bounds = adapter.getBounds(); // { north, south, east, west }
```

### 4.2 Events

```js
const adapter = GeoLeaf.Core.getMap();

const onMoveEnd = (e) => {
    console.log("Map moved, new center:", adapter.getCenter());
};

adapter.on("moveend", onMoveEnd);
adapter.once("load", () => console.log("Map loaded"));
adapter.off("moveend", onMoveEnd);
```

Events available through `IMapAdapter`:
`"click"`, `"dblclick"`, `"contextmenu"`, `"moveend"`, `"movestart"`, `"zoomend"`, `"zoomstart"`, `"load"`, `"unload"`, `"resize"`.

### 4.3 Coordinates — ordering convention

GeoLeaf always uses `{ lat, lng }` (latitude first).
MapLibre GL JS uses `[lng, lat]` (GeoJSON order, longitude first).
The conversion is handled internally by `MaplibreAdapter` — consumers never have to deal with it.

```js
// GeoLeaf convention throughout the public API
const center: GeoLeafLatLng = { lat: 45.764, lng: 4.835 };
```

---

## 5. Boot System v2

### 5.1 Overview

Since v2.0.0, GeoLeaf initialisation is fully orchestrated by the **boot system** located in `packages/core/src/app/`. That system handles sequential loading through a topologically sorted `ModuleRegistry`.

**Boot system files:**

| File                         | Role                                                                    |
| ---------------------------- | ----------------------------------------------------------------------- |
| `src/app/app-namespace.ts`   | Logging, path detection, plugin checks, notification helpers            |
| `src/app/boot.ts`            | Exposes `GeoLeaf.boot()`, loads the config, registers the modules       |
| `src/app/init.ts`            | Orchestrates map, UI, POI, Route, GeoJSON and legend creation           |
| `src/app/module-registry.ts` | `ModuleRegistry` — module lifecycle management with topological sorting |
| `src/app/init-features.ts`   | Fine-grained initialisation of the secondary modules                    |

### 5.2 Full startup sequence

```
1. Bundle loading
   <script type="module" src="geoleaf.esm.js">  → ESM bundle (CDN or bundler)
   <script type="module" src="geoleaf-offline-ui.plugin.js"> → Optional plugin (before GeoLeaf.boot())
   <script type="module" src="geoleaf-offline-ui.plugin.js">  → Optional plugin (before GeoLeaf.boot())

2. GeoLeaf.boot() call
   └─ Checks document.readyState
   └─ Calls _app.startApp()

3. _app.startApp()
   └─ Registers the modules in ModuleRegistry (B1 → B8 core)
   └─ Loads geoleaf.config.json through GeoLeaf.loadConfig()
   └─ Registers the optional modules according to the profile (Route, Labels, Legend, Table, Search)
   └─ Loads the resources of the active profile
   └─ Runs ModuleRegistry.init() (topological order) — see 4.

4. ModuleRegistry.init(cfg) — CoreMapModule → SharedModule → UIModule (among others)
   └─ CoreMapModule: reads the profile bounds (map.bounds required), calls
      GeoLeaf.init() → GeoLeaf.Core.init() → MaplibreAdapter
   └─ SharedModule: i18n, plugin check, app-wide lifecycles (pwa, offline)
   └─ UIModule: starts preloading the secondary modules (ESM code splitting),
      initialises UI, Storage, POI, Route, GeoJSON, Legend, LayerManager
   └─ Reveals the application after the geoleaf:theme:applied event
   └─ Emits geoleaf:map:ready then geoleaf:app:ready
```

### 5.3 `GeoLeaf.boot()`

The single recommended entry point to start GeoLeaf.

```js
// Minimal usage — auto DOMContentLoaded guard
GeoLeaf.boot();

// With performance metrics callback
GeoLeaf.boot({
    onPerformanceMetrics: (metrics) => {
        console.log("Time to map ready:", metrics.timeToMapReadyMs, "ms");
        console.log("Time to app ready:", metrics.timeToAppReadyMs, "ms");
        console.log("Total startup:", metrics.startupTotalMs, "ms");
    },
});
```

`GeoLeaf.boot()` handles `DOMContentLoaded` on its own: calling it before or after the DOM is ready makes no difference.

**Full signature:**

```ts
GeoLeaf.boot(options?: {
    onPerformanceMetrics?: (metrics: {
        timeToMapReadyMs: number | null;
        timeToAppReadyMs: number | null;
        startupTotalMs: number | null;
        capturedAt: string;
    }) => void;
}): void
```

### 5.4 Lifecycle events

The boot system emits the following events on `document`:

| Event                    | Emitted when                                      | `detail` payload            |
| ------------------------ | ------------------------------------------------- | --------------------------- |
| `geoleaf:theme:applying` | A theme starts loading (layers still being added) | —                           |
| `geoleaf:theme:applied`  | A theme has finished loading (all layers visible) | `{ themeName, layerCount }` |
| `geoleaf:profile:loaded` | The JSON profile has been loaded and parsed       | `{ profileId, data }`       |
| `geoleaf:map:ready`      | Map visible, loader removed, fitBounds done       | —                           |
| `geoleaf:app:ready`      | Application fully initialised                     | `{ version, timestamp }`    |
| `geoleaf:map:move`       | End of a map movement                             | `{ center, zoom }`          |
| `geoleaf:map:zoom`       | End of a zoom change                              | `{ zoom }`                  |

```js
// Listen for app ready
document.addEventListener("geoleaf:app:ready", (event) => {
    console.log("GeoLeaf v" + event.detail.version + " is ready.");
    const adapter = GeoLeaf.Core.getMap();
    // Use the adapter here...
});

// Listen for theme loaded
document.addEventListener("geoleaf:theme:applied", (event) => {
    console.log(event.detail.themeName + " loaded — layers:", event.detail.layerCount);
});
```

### 5.5 ModuleRegistry and initialisation sequence

The `ModuleRegistry` orchestrates module initialisation by resolving dependencies through a topological sort (Kahn's algorithm).

**Core modules registered by default:**

| Module ID      | Class               | Role                                     |
| -------------- | ------------------- | ---------------------------------------- |
| `core-map`     | `CoreMapModule`     | Creation of the MapLibre GL JS map       |
| `config`       | `ConfigModule`      | Loading and management of JSON profiles  |
| `shared`       | `SharedModule`      | State shared between modules             |
| `geojson`      | `GeoJSONModule`     | GeoJSON layers and styles                |
| `ui`           | `UIModule`          | Interface, controls, filters             |
| `theme-engine` | `ThemeEngineModule` | Applies the default theme of the profile |

::: info

There are six kernel modules, not eight. `SecurityModule` and `APIModule` are not registered
modules: their subsystems are facades installed at import time, so there is nothing to
sequence. `POIModule` no longer exists either — a POI is a generic GeoJSON point layer. The
six identifiers above are declared in `app/boot-modules/*.module.ts`.

:::

**Optional modules (registered according to the profile):**

| Profile condition                  | Registered module |
| ---------------------------------- | ----------------- |
| `route.enabled !== false`          | `RouteModule`     |
| `labels.enabled !== false`         | `LabelsModule`    |
| `modules.legend.enabled !== false` | `LegendModule`    |

::: info

The full-text search engine (`flexsearch`) has been removed from the core: it was dormant, with
no consumer. `SearchModule` is no longer registered and the `ui.showSearch` flag no longer
exists; UI text search is provided by the in-core `filter` capability (text field of the Filter
panel, now insensitive to accents and to word order).

:::

::: info

The data table has been moved out of the core into the MIT plugin `@geoleaf-plugins/table`.
`TableModule` is no longer registered by the core, and the `ui.showTable` flag has moved to
`modules.table.showButton`. See the plugin README for the configuration (`modules.table.*`) and
the migration.

:::

::: info

The legend is an in-core capability unified under `modules.legend`. `LegendModule` is still
registered, but through the `CapabilityRegistry` (gate `modules.legend.enabled`, opt-out); the
`ui.showLegend` flag and the `legendConfig` block have moved to `modules.legend.enabled` /
`modules.legend.{title,position,collapsedByDefault}` (file `config/plugins/legend.json`). See
the [Legend README](../legend/GeoLeaf_Legend_README.md).

:::

**Registering a third-party module:**

```js
// Third-party module self-registration (public API)
GeoLeaf.registry.register(new MyCustomModule());
```

### 5.6 Guard system (`checkPlugins`)

At startup, `helpers.ts` checks that the loaded plugins are consistent with the profile configuration:

- Logs a warning when `ui.showAddPoi=true` without the AddPOI plugin loaded.
- Logs a warning when `storage` is defined without the Storage plugin loaded.
- Logs a warning when `SyncHandler` is loaded without the Storage plugin.

These warnings are advisory — the application still starts, in degraded mode.

---

## 6. Integration with JSON configuration

### 6.1 Minimal JSON profile (geoleaf.config.json)

```json
{
    "map": {
        "target": "geoleaf-map",
        "bounds": [
            [45.5, 4.5],
            [46.0, 5.2]
        ],
        "initialMaxZoom": 13,
        "padding": [50, 50],
        "positionFixed": false
    },
    "ui": {
        "theme": "light",
        "showLegend": true,
        "showLayerManager": true,
        "showFilterPanel": true,
        "showCoordinates": true
    }
}
```

> **Important**: `map.bounds` is **required** since v2.0.0. When it is missing, the application refuses to start and logs an explicit error. There is no default world map.

### 6.2 Mapping between JSON fields and Core options

| JSON field                       | Equivalent Core option                    | Required    |
| -------------------------------- | ----------------------------------------- | ----------- |
| `map.target` / `map.id`          | `options.mapId`                           | yes         |
| `map.bounds`                     | centre computation + fitBounds            | **yes**     |
| `map.initialMaxZoom`             | `options.zoom`                            | recommended |
| `map.minZoom`                    | `options.mapOptions.minZoom`              | no          |
| `map.maxZoom`                    | `options.mapOptions.maxZoom`              | no          |
| `map.boundsMargin` (default 0.3) | `maxBounds` padding                       | no          |
| `map.positionFixed`              | `options.mapOptions.maxBounds` (computed) | no          |
| `ui.theme`                       | `options.theme`                           | no          |

### 6.3 Loading the active profile

In multi-profile mode, GeoLeaf reads `sessionStorage.getItem("gl-selected-profile")` at startup to load the right profile. Only alphanumeric identifiers (`/^[a-zA-Z0-9_-]{1,50}$/`) are accepted.

```js
// Select a profile before boot
sessionStorage.setItem("gl-selected-profile", "mon-profil");
GeoLeaf.boot();
```

---

## 7. Error handling and fallback behaviour

GeoLeaf.Core favours explicit behaviour (clear logs) over silent failure.

### 7.1 Summary of the main cases

| Situation                            | Log emitted                                                            | Return value      |
| ------------------------------------ | ---------------------------------------------------------------------- | ----------------- |
| `mapId` missing                      | `[GeoLeaf.Core] ERROR: The required 'mapId' option is missing.`        | `null`            |
| DOM element not found for `mapId`    | `[GeoLeaf.Core] ERROR: No DOM element found for mapId='...'`           | `null`            |
| `map.bounds` absent from the profile | `[GeoLeaf] Active profile does not define valid map.bounds`            | —                 |
| Unknown `theme` value                | `[GeoLeaf.Core] setTheme() → {value}`                                  | theme unchanged   |
| `Core.init()` already called         | `[GeoLeaf.Core] Map already initialized. Recycling existing instance.` | existing instance |
| MapLibre engine exception            | `[GeoLeaf.Core] ERROR: {message}`                                      | `null`            |

### 7.2 Optional error callback

```js
// Register an error callback before boot
window.GeoLeaf = window.GeoLeaf || {};
window.GeoLeaf.Core = window.GeoLeaf.Core || {};
window.GeoLeaf.Core.onError = function (err) {
    // Custom error handling (analytics, UI error banner, etc.)
    console.error("[App] Core error:", err.message);
};

GeoLeaf.boot();
```

### 7.3 Post-init best practice

```js
document.addEventListener("geoleaf:app:ready", () => {
    const adapter = GeoLeaf.Core.getMap();

    if (!adapter) {
        console.error("[App] Map not initialized — check configuration and DOM.");
        return;
    }

    // Adapter is ready — safe to use
    console.log("Map ready, zoom:", adapter.getZoom());
});
```

---

## 8. Quick summary of Core.init() options

| Option                 | Type                  | Required    | Default value            | Role                         |
| ---------------------- | --------------------- | ----------- | ------------------------ | ---------------------------- |
| `mapId`                | `string`              | yes         | —                        | ID of the map DOM container  |
| `center`               | `[number, number]`    | recommended | computed from `bounds`   | Initial centre `[lat, lng]`  |
| `zoom`                 | `number`              | recommended | `CONSTANTS.DEFAULT_ZOOM` | Initial zoom                 |
| `theme`                | `"light"` \| `"dark"` | no          | `"light"`                | UI theme (interface only)    |
| `mapOptions.minZoom`   | `number`              | no          | —                        | Minimum allowed zoom         |
| `mapOptions.maxZoom`   | `number`              | no          | —                        | Maximum allowed zoom         |
| `mapOptions.maxBounds` | `GeoLeafBounds`       | no          | —                        | Restricts panning to an area |

---

## 9. Usage best practices

1. **Always use `GeoLeaf.boot()`** in production:
    - it is the only entry point that loads the configuration, orchestrates the modules and emits `geoleaf:app:ready`.
    - calling `GeoLeaf.Core.init()` directly is reserved for tests and advanced integration.

2. **Listen for `geoleaf:app:ready`** rather than `DOMContentLoaded` before acting on the map:
    - by then every module is initialised and the map is visible.

3. **Use `GeoLeaf.Core.getMap()`** to retrieve the adapter in application code:
    - never store a direct reference to `maplibregl.Map` — the `IMapAdapter` abstraction is what keeps the code portable.

4. **Load the plugins before `GeoLeaf.boot()`**:
    - `geoleaf-offline-ui.plugin.js` extends the `GeoLeaf.*` namespace before startup; lazy plugins (`editor`, `table`, `print`, `measure`) do so on first use.

5. **Centralise the configuration in `geoleaf.config.json`**:
    - every option (map, ui, poi, storage, route) in a single profile file.
    - this avoids divergence between modules and deployments.

6. **Watch the `[GeoLeaf.Core]` logs during development**:
    - enable verbose logs with `?debug=true` in the URL.
    - they state precisely which option is missing or invalid.

7. **Popup security**: HTML content passed to `adapter.createPopup()` must be sanitised by the caller through `GeoLeaf.Security.sanitize()` beforehand. The adapter does not sanitise content.

---

## 10. See also

- **General architecture**: `docs/ARCHITECTURE_GUIDE.md`
- **Developer guide**: `docs/DEVELOPER_GUIDE.md`
- **Initialisation flow**: `docs/architecture/INITIALIZATION_FLOW.md`
- **IMapAdapter contract**: `packages/core/src/contracts/map-adapter.contract.ts`
- **MaplibreAdapter**: `packages/core/src/adapters/maplibre/maplibre-adapter.ts`
- **ModuleRegistry**: `packages/core/src/app/module-registry.ts`
- **Plugins**: each `@geoleaf-plugins/*` ships its documentation inside its npm package
