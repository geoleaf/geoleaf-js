---
title: "GeoLeaf-JS — API Reference"
---

# GeoLeaf-JS — API Reference

**Package:** `@geoleaf/core`
**Version:** 3.0.0
**License:** MIT

> **Auto-generated HTML docs:** Run `npm run docs:api` in `packages/core` to generate the TypeDoc API reference at `packages/core/docs/api/`. This produces per-module HTML pages for all named exports including full method signatures, parameter types, and return types. Published at **[geoleaf.dev/docs/api/](https://www.geoleaf.dev/docs/api/)**.

---

## Table of contents

1. [ESM named exports (27)](#esm-named-exports)
2. [Extension contracts (TypeScript)](#extension-contracts-typescript)
3. [GeoLeafAPI — top-level API](#geoleafapi--top-level-api)
4. [Core — map lifecycle](#core--map-lifecycle)
5. [Layers — feature data](#layers--feature-data)
6. [Taxonomy — the point symbol](#taxonomy--the-point-symbol)
7. [UI — interface controls](#ui--interface-controls)
8. [Filter — the filter panel (singular)](#filter--the-filter-panel-singular)
9. [Filters — removed in v3.1 (plural)](#filters--removed-in-v31-plural)
10. [Table — data table](#table--data-table)
11. [Legend — legend panel](#legend--legend-panel)
12. [LayerManager — GeoJSON layers](#layermanager--geojson-layers)
13. [Baselayers — base tiles](#baselayers--base-tiles)
14. [Helpers](#helpers)
15. [Validators](#validators)
16. [API sub-modules](#api-sub-modules)
17. [Log](#log)
18. [Errors — typed error classes](#errors--typed-error-classes)
19. [CONSTANTS](#constants)
20. [Utils](#utils)
21. [Config](#config)
22. [Geocoding — address search](#geocoding--address-search)
23. [Notifications — toast notifications](#notifications--toast-notifications)
24. [Popup — popup action buttons](#popup--popup-action-buttons)
25. [PWA — install prompt](#pwa--install-prompt)
26. [Composing a lighter bundle](#composing-a-lighter-bundle)
27. [Global namespace (window.GeoLeaf.\*)](#global-namespace-windowgeoleaf)
28. [TypeScript types](#typescript-types)

---

## ESM named exports

All symbols available via `import { … } from "@geoleaf/core"`:

```ts
// Kernel facades
import { Core } from "@geoleaf/core"; // Map lifecycle
import { GeoLeafAPI } from "@geoleaf/core"; // Unified top-level API
import { UI } from "@geoleaf/core"; // UI controls
import { LayerManager } from "@geoleaf/core"; // GeoJSON layer management
import { Baselayers } from "@geoleaf/core"; // Base tile layers
import { Helpers } from "@geoleaf/core"; // Utility helpers
import { Validators } from "@geoleaf/core"; // Input validators
import { Events } from "@geoleaf/core"; // DOM event bus

// API sub-modules
import { APIController } from "@geoleaf/core";
import { APIFactoryManager } from "@geoleaf/core";
import { APIInitializationManager } from "@geoleaf/core";
import { APIModuleManager } from "@geoleaf/core";
import { PluginRegistry } from "@geoleaf/core";
import { BootInfo } from "@geoleaf/core";
import { showBootInfo } from "@geoleaf/core";

// Utilities
import { Log } from "@geoleaf/core"; // Logging
import { Errors } from "@geoleaf/core"; // Typed error classes
import { CONSTANTS } from "@geoleaf/core"; // Constants
import { Utils } from "@geoleaf/core"; // Utility modules
import { applyCssText } from "@geoleaf/core"; // CSP-safe CSSOM style helper
import { Config } from "@geoleaf/core"; // Config access

// Capability system
import { CapabilityRegistry } from "@geoleaf/core"; // Declare / gate a capability (since v3.31)

// Capability facades (this entry bundles all 18 in-core capabilities)
import { Legend } from "@geoleaf/core"; // Legend panel
import { Permalink } from "@geoleaf/core"; // URL deep linking
import { Share } from "@geoleaf/core"; // Share dialog
import { Notifications } from "@geoleaf/core"; // Toast notifications
import { PWA } from "@geoleaf/core"; // PWA install prompt

export default GeoLeaf; // default export: window.GeoLeaf (CDN/global passthrough)
```

> **Removed in v3.1** _(breaking)_: `Filters` — see [the section below](#filters--removed-in-v31-plural).

> **Removed in v3** _(breaking)_: `POI` (subsystem dissolved — see [Layers](#layers--feature-data)),
> `Route` (now the in-core `route` capability), `Table` and `Themes` (extracted / removed), and
> `Search` (dead engine purged, with the `flexsearch` dependency).

> **Many facades are global-only.** `GeoLeaf.Layers`, `GeoLeaf.Taxonomy`, `GeoLeaf.Filter`,
> `GeoLeaf.Cluster`, `GeoLeaf.FeatureInfo` and `GeoLeaf.Introspection` are mounted on
> `window.GeoLeaf` at boot but are **not** named ESM exports — `import { Layers } from "@geoleaf/core"`
> does not work.

> **`GeoJSON` is not a named ESM export — but `GeoLeaf.GeoJSON` does exist.** It is mounted on
> `window.GeoLeaf` at boot, like the global-only facades above, and it is typed in
> `GeoLeafHost` (`@geoleaf/host-runtime`) since v3.31. Use `GeoLeaf.Layers` for per-layer feature
> data (`LayerDataApi`), and `GeoLeaf.GeoJSON` for layer-level operations (`getLayerById`,
> `showLayer`, `setLayerStyle`…).

---

## Extension contracts (TypeScript)

_Since v3.31._ The interfaces a plugin must implement are published. Before that release they were
reachable through **no channel at all**: a plugin implementing `ICoreModule` had to re-declare it,
and the declaration drifted from the core's.

All 19 types are re-exported from the entry point, which is the form to prefer:

```ts
import type { ICoreModule, IMapAdapter, GeoLeafEventMap } from "@geoleaf/core";
```

Each contract is also reachable one by one, when you want to depend on exactly one file:

```ts
import type { ILifecycleModule } from "@geoleaf/core/contracts/core-module.contract.js";
```

| Subpath                               | Types                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `./contracts/core-module.contract.js` | `ICoreModule`, `ILifecycleModule`, `IUISlotModule`, `IModuleRegistry`, `IModuleUISlot`                                  |
| `./contracts/capability.contract.js`  | `ICapabilityDeclaration`, `ICapabilityRegistry`, `ICapabilitySchema`, `ICapabilityFieldSchema`, `ICapabilityConfigGate` |
| `./contracts/config.contract.js`      | `IGeoLeafConfig`                                                                                                        |
| `./contracts/map-adapter.contract.js` | `IMapAdapter` and the geometry types it uses                                                                            |
| `./contracts/layer-data.contract.js`  | `LayerDataApi`, `LayerFeatureState`                                                                                     |
| `./contracts/event-bus.contract.js`   | `GeoLeafEventMap`, `GeoLeafRawEventMap`, `IEventBus`                                                                    |

`PluginMetadata` (the metadata argument of `GeoLeaf.plugins.register`) and `UtilsNamespace` are
exported from the entry point only.

> **These six modules are `type`-only.** They declare a `types` condition and emit no JavaScript:
> `import type` works, and a **value** import fails outright rather than resolving to nothing.

### `ICoreModule` is a union — implement `ILifecycleModule`

```ts
type ICoreModule = ILifecycleModule | IUISlotModule;
```

`GeoLeaf.registry.register()` has always accepted **two** shapes: a full lifecycle module, or a
bare UI slot `{ id, ui }` — which is what any plugin does when it adds a toolbar button without
running code at startup. TypeScript does not allow an `implements` clause on a union, so:

```ts
// Correct
class MyModule implements ILifecycleModule {
    id = "my-module";
    dependencies = [];
    init() {}
    destroy() {}
}

// Also valid — registered as a UI slot, no lifecycle
GeoLeaf.registry.register({ id: "my-toolbar-button", ui: myElement });

// Invalid — TypeScript error: a class cannot implement a union type
class MyModule implements ICoreModule {}
```

`ICoreModule` remains the name of `register()`'s parameter. **Nothing changed at runtime** — the
type moved to match the registry, not the other way round.

---

## GeoLeafAPI — top-level API

The top-level GeoLeaf API. Available as `GeoLeaf` (CDN/global) or `GeoLeafAPI` (ESM).

### Methods

| Method         | Signature                                          | Description                                                                                  |
| -------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `init`         | `(options: object) => Promise<void>`               | Initialize GeoLeaf with a map container and options                                          |
| `loadConfig`   | `(input: string \| object) => Promise<void>`       | Load config from URL or inline object                                                        |
| `setTheme`     | `(theme: string) => void`                          | Apply a visual theme                                                                         |
| `createMap`    | `(id: string, options?: object) => object \| null` | Create a new managed map instance                                                            |
| `getMap`       | `(id: string) => object \| null`                   | Get a map instance by container id — same registry as `Core.getMap()` since v3.1.0           |
| `getAllMaps`   | `() => object[]`                                   | Get all active map instances — same registry as `Core.listMaps()` since v3.1.0               |
| `removeMap`    | —                                                  | **Removed, not deprecated** — the method does not exist. Use **`Core.destroy(id)`** instead. |
| `getModule`    | `(name: string) => object \| null`                 | Get a registered module by name                                                              |
| `hasModule`    | `(name: string) => boolean`                        | Check if a module is registered                                                              |
| `getNamespace` | `(name: string) => object \| null`                 | Get a top-level GeoLeaf namespace by name                                                    |
| `getHealth`    | `() => object \| null`                             | Get APIController health/metrics                                                             |
| `getMetrics`   | `() => object \| null`                             | Alias for `getHealth()`                                                                      |

### Properties

| Property     | Type     | Description                                             |
| ------------ | -------- | ------------------------------------------------------- |
| `version`    | `string` | Current GeoLeaf version (e.g. `"3.0.0"`)                |
| `CONSTANTS`  | `object` | Reference to `GeoLeaf.CONSTANTS`                        |
| `BaseLayers` | `object` | Alias for `GeoLeaf.Baselayers` (backward compatibility) |

---

## Core — map lifecycle

> **Generated signatures:** `packages/core/docs/api/variables/Core.html` (run `npm run docs:api` in `packages/core`)

```ts
import { Core } from "@geoleaf/core";
// or: GeoLeaf.Core (CDN/global)
```

Since **v3.0.0**, `Core` manages a **keyed registry** of map adapters (`Map<mapId, IMapAdapter>`): N maps can coexist on one page, each with its own lifecycle. The former module-level singleton (≤ v2.1.x) is gone.

| Method       | Signature                                  | Description                                                                                                                                     |
| ------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`       | `(options: object) => IMapAdapter \| null` | Initialise a map. **Requires `options.mapId`** (returns `null` + logs otherwise). Re-init of an existing `mapId` returns the existing instance. |
| `getMap`     | `(mapId?: string) => IMapAdapter \| null`  | With `mapId`, the targeted instance; **without arg, the first active instance** (backward compatible for single-map apps).                      |
| `getAdapter` | `(mapId?: string) => IMapAdapter \| null`  | Alias of `getMap`.                                                                                                                              |
| `destroy`    | `(mapId: string) => boolean`               | Destroy the instance (`map.remove()` + free the slot). `true` if found. Call on consumer unmount.                                               |
| `hasMap`     | `(mapId: string) => boolean`               | Whether an instance is registered under `mapId`.                                                                                                |
| `listMaps`   | `() => string[]`                           | Ids of all active map instances.                                                                                                                |
| `isAttached` | `(mapId: string) => boolean`               | Registered **and** its container is still in the document. Stronger than `hasMap` — see below. `false` after `destroy()`, never throws.         |
| `reattach`   | `(mapId, parent: HTMLElement) => boolean`  | Move a live map into another parent, without destroying it. The **whole container** moves. ⚠️ The panels do not follow — see below.             |
| `setTheme`   | `(theme: string) => void`                  | Apply a theme to the map container.                                                                                                             |
| `getTheme`   | `() => string`                             | Get the current theme name.                                                                                                                     |

> **Note (v3.0.0 scope):** legend and theme remain **global** and bind to the **first** instance. Per-map legend/theme isolation is out of scope for this release.

**Init options:**

```ts
Core.init({
    mapId: "map", // DOM element id (REQUIRED) — unique per map
    center: [lat, lng], // Initial center [lat, lng]
    zoom: 12, // Initial zoom level
    theme: "light", // Theme name (default: "light") — applied to the first map only
    mapOptions: {}, // Additional MapLibre GL JS MapOptions (optional)
});
```

**Multi-map example:**

```ts
const a = GeoLeaf.Core.init({ mapId: "map-1", center: [48.85, 2.35], zoom: 10 });
const b = GeoLeaf.Core.init({ mapId: "map-2", center: [45.76, 4.83], zoom: 11 });
GeoLeaf.Core.listMaps(); // ["map-1", "map-2"]
// On unmount:
GeoLeaf.Core.destroy("map-1");
```

**Moving a map instead of rebuilding it** — a full-screen toggle, a tab switch, a panel that re-mounts:

```ts
const Core = GeoLeaf?.Core;
if (Core && !Core.isAttached("main")) {
    Core.reattach("main", document.getElementById("fullscreen-slot")!);
}
```

- `hasMap()` says the **registry** holds an entry; `isAttached()` says that entry is still wired into the page. They diverge where it matters: a host that removes the map's subtree without calling `destroy()` leaves a registered map that renders nowhere, and `hasMap()` still returns `true`.
- `reattach()` re-parents the **whole container**, never its children one by one. MapLibre memorises the element it was constructed with, so moving the children would leave `map.getContainer()` pointing at the old node. It calls the adapter's optional `resize()` afterwards, so the WebGL canvas picks up the new container size.

> ⚠️ **The panels do not follow the map.** `#gl-right-panel` and its siblings live in the shell, not inside the map container, so `reattach()` leaves them where they are. Rebuilding them at the new location is the host's call: `GeoLeaf.UI.destroyDesktopPanel()` → `initDesktopPanel()` → `activateDesktopPanel()`, all three already public. Making the panels follow would tie this API to the shell's DOM — exactly the coupling it exists to remove.

---

## Layers — feature data

```js
GeoLeaf.Layers.getFeatures("hebergements");
```

> **Global only — not an ESM named export.** `Layers` is mounted on `window.GeoLeaf` at boot.
> `import { Layers } from "@geoleaf/core"` does **not** work.

`GeoLeaf.Layers` is the single read/write surface for the feature data of any layer, whatever its
geometry. **It is what replaced `GeoLeaf.POI`**, dissolved in v3: a "POI" is now simply a point
feature of a normal layer, styled by the [`taxonomy`](#taxonomy--the-point-symbol) and `cluster`
capabilities and rendered on click by `feature-info`. Interactive POI _creation_ lives in the
`@geoleaf-plugins/editor` plugin (`GeoLeaf.Editor.AddForm`). The former
`@geoleaf-plugins/addpoi` merged into it in v3 and `GeoLeaf.AddPOI` was removed without an alias.

A layer id is the one declared in the profile (`config/core/layers.json`).

**Read**

| Method            | Signature                          | Description                                                 |
| ----------------- | ---------------------------------- | ----------------------------------------------------------- |
| `getFeatures`     | `(layerId) => Feature[]`           | All features of a layer — `[]` when the layer is unknown.   |
| `getFeatureById`  | `(layerId, id) => Feature \| null` | One feature by stable id (`feature.id` or `properties.id`). |
| `getFeatureCount` | `(layerId) => number`              | Number of features currently held.                          |
| `listLayerIds`    | `() => string[]`                   | Ids of every layer known to the store.                      |
| `hasLayer`        | `(layerId) => boolean`             | `true` when a layer with this id exists.                    |

**Write — base dataset**

| Method    | Signature                     | Description                                               |
| --------- | ----------------------------- | --------------------------------------------------------- |
| `setData` | `(layerId, features) => void` | Replaces the base features, re-renders the source, emits. |
| `clear`   | `(layerId) => void`           | Empties a layer (same as `setData(layerId, [])`).         |

**Write — unit mutations**

| Method            | Signature                             | Description                                                                                                                             |
| ----------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `addFeature`      | `(layerId, feature) => void`          | Appends one feature.                                                                                                                    |
| `removeFeature`   | `(layerId, id) => boolean`            | Removes one feature by id; `true` when one was removed.                                                                                 |
| `updateFeatureId` | `(layerId, oldId, newId) => void`     | Re-keys a feature (temp id → server id), on `id` **and** `properties.id`.                                                               |
| `patchFeature`    | `(layerId, id, patch, opts?) => void` | Merges `patch` into `properties` (**baked** — survives source rebuilds). Silent by default; pass `{ rerender: true }` to re-render now. |

**Filtered display** — without mutating the base dataset

| Method               | Signature                      | Description                                                                                                                                   |
| -------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `setVisibleSubset`   | `(layerId, predicate) => void` | Displays only matching features. The subset is re-derived from the full base on each apply (GPU `setFilter` id-match, JS predicate fallback). |
| `clearVisibleSubset` | `(layerId) => void`            | Restores full visibility.                                                                                                                     |

**Reactive paint & merge**

| Method            | Signature                      | Description                                                                                                                                                                                             |
| ----------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setFeatureState` | `(layerId, id, state) => void` | **Ephemeral** GPU-side state (sync badge, hover, selection). Requires `promoteId` on the source, and is **cleared by any source rebuild** (`setData`) — use `patchFeature` for state that must persist. |
| `mergeFeatures`   | `(layerId, features) => void`  | Upserts features, de-duplicated by id (offline replay).                                                                                                                                                 |

**Example — add a point after boot**

```js
// `Layers` needs the layer to exist: defer to app:ready.
document.addEventListener("geoleaf:app:ready", () => {
    GeoLeaf.Layers.addFeature("hebergements", {
        type: "Feature",
        geometry: { type: "Point", coordinates: [2.3522, 48.8566] },
        properties: { id: "paris", title: "Paris", categoryId: "hotel" },
    });
});
```

**Migrating from `GeoLeaf.POI`**

| Removed (v2)                                                    | Use instead                                                                                    |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `POI.getAllPois()` / `getPoiById()` / `getDisplayedPoisCount()` | `Layers.getFeatures` / `getFeatureById` / `getFeatureCount`                                    |
| `POI.displayPois()` / `reload()`                                | `Layers.setData`                                                                               |
| `POI.addPoi()` / `add()`                                        | `Layers.addFeature`                                                                            |
| `POI.setFilteredDisplay()`                                      | `Layers.setVisibleSubset`                                                                      |
| `POI.updatePoiId()`                                             | `Layers.updateFeatureId`                                                                       |
| `POI.updatePoiSyncStatus()`                                     | `Layers.patchFeature` (persisted) **+** `setFeatureState` (live badge)                         |
| `POI.loadAndMergeStoredPois()`                                  | `Layers.mergeFeatures`                                                                         |
| `POI.getLayer()`                                                | **Removed** — it always returned `null`.                                                       |
| `POI.resolveCategoryDisplay()`                                  | `Taxonomy.resolvePoiIcon`                                                                      |
| `POI.init()` / `showPoiDetails()` / `openSidePanel()`           | **Removed** — rendering is configured per layer under `layers.<id>.capabilities.feature-info`. |

---

## Taxonomy — the point symbol

```js
GeoLeaf.Taxonomy.getLayerCategories("hebergements");
```

> **Global only — not an ESM named export.** `import { Taxonomy } from "@geoleaf/core"` does **not**
> work.

Since v3, the `taxonomy` capability owns **the symbol of the point, and nothing else**: the icon,
its colour, the marker disc (fill / stroke) and the colour of the category / sub-category pill
badges. The **colour of the geometry** (polygon fill, line stroke, and the business colour of
points) and the **size of the point** belong to the layer's `styleRules`.

Configured under `modules.taxonomy` (`config/plugins/taxonomy.json`). **Opt-out**: active unless
`modules.taxonomy.enabled: false` — and the gate is **total**: disabled, every reader below returns
empty, and map icons, disc, pills, legend icons and category filter options all switch off.

A layer receives a taxonomy only if it is **bound** to one: `modules.taxonomy.layers.<id>.use`.

| Method               | Signature                                                          | Description                                                                                                  |
| -------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `isEnabled`          | `() => boolean`                                                    | Whether the capability is active.                                                                            |
| `getIcons`           | `() => TaxonomyIconsConfig \| null`                                | The `modules.taxonomy.icons` block (`spriteUrl`, `symbolPrefix`, `defaultIcon`, `showOnMap`, `iconSize`).    |
| `getCategories`      | `(ref: string) => Record<string, TaxonomyCategory>`                | Categories of a **named** taxonomy (e.g. `"poi-cat"`).                                                       |
| `getLayerCategories` | `(layerId: string) => Record<string, TaxonomyCategory>`            | Categories bound to a **layer** — resolves `layers.<id>.use` for you. `{}` if unbound, unknown, or disabled. |
| `getFieldMappings`   | `(ref: string) => TaxonomyFieldMappings`                           | Declarative `field → value → categoryId` mapping (raw attributes, e.g. OSM `fclass`).                        |
| `resolvePoiIcon`     | `(feature) => ResolvedIcon`                                        | Resolves a feature's map icon.                                                                               |
| `getIconVariants`    | `() => TaxonomyIconVariant[]`                                      | The tinted icon variants to register as MapLibre images.                                                     |
| `resolveMarkerPaint` | `(layerId, existingPaint) => Record<string, unknown> \| null`      | Composes the disc paint; `null` when taxonomy overrides nothing.                                             |
| `resolveTitleIcon`   | `(layerId, feature, surface) => string \| null`                    | Icon next to the title in a `popup` / `tooltip` / `sidepanel`.                                               |
| `resolveBadgeStyle`  | `(layerId, feature, surface, field) => ResolvedBadgeStyle \| null` | Pill badge colours (needs `render.<surface>.colorBadges`).                                                   |
| `ensureSprite`       | `() => void`                                                       | Ensures the SVG sprite is fetched and injected.                                                              |

::: warning
**`resolvePoiIcon` and `resolveTitleIcon` are not interchangeable.** `resolvePoiIcon` returns a
**tinted MapLibre atlas id** (a raster image registered on the map); `resolveTitleIcon` returns a
**raw DOM id**, for `<use href="#…">` in an info surface. Swapping them renders nothing.
:::

**Prefer `getLayerCategories(layerId)` over `getCategories(ref)` whenever you start from a layer.**
`getCategories` expects the _name_ of a taxonomy, which only the `layers` binding table knows.
Reading that binding yourself means re-implementing the resolution — which is exactly what cost the
AddPOI form its category lists, empty on every profile and without a single message (fixed in
v3.0.0).

---

## UI — interface controls

```ts
import { UI } from "@geoleaf/core";
// or: GeoLeaf.UI (CDN/global)
```

UI manages controls, panels, content builder, and notification system.

---

## Filter — the filter panel (singular)

```js
GeoLeaf.Filter.getActiveFilter();
```

::: warning
**`Filter` (singular) and `Filters` (plural) are two different things.** `Filter` is the in-core
filter **capability** — the panel your users actually interact with. `Filters` is a small legacy
helper namespace (see below). If you are looking for text, category or proximity filtering, it is
**`Filter`**.
:::

> **Global only — not an ESM named export.**

Configured under `modules.filter` (`config/plugins/filter.json`), **opt-out** (active unless
`modules.filter.enabled: false`). Field kinds: `taxonomy` / `tag` / `range` / `text` / `boolean` /
`proximity`.

| Method             | Signature               | Description                                                     |
| ------------------ | ----------------------- | --------------------------------------------------------------- |
| `isEnabled`        | `() => boolean`         | Whether the capability is active.                               |
| `getConfig`        | `() => object`          | The resolved `modules.filter` block.                            |
| `getActiveFilter`  | `() => object`          | The active filter state — **serialisable** (used by permalink). |
| `applyFilter`      | `(state) => void`       | Restores a filter state, without touching the DOM.              |
| `applyNow`         | `() => void`            | Applies the current panel state immediately.                    |
| `reset`            | `() => void`            | Clears all filters.                                             |
| `hasActiveFilters` | `() => boolean`         | Whether any filter is currently narrowing the display.          |
| `proximity`        | `{ setRadius, toggle }` | Geographic proximity sub-controls.                              |

---

## Filters — removed in v3.1 (plural)

> **BREAKING (v3.1.0)** — the `Filters` namespace is **gone**, both as a named ESM export
> (`import { Filters } from "@geoleaf/core"`) and as a global (`GeoLeaf.Filters`).
>
> It held exactly one function, `filterRouteList(baseRoutes, filterState)`, and that function
> had no caller anywhere. What made it worth removing rather than keeping was not its size but
> its **name**: one letter from `GeoLeaf.Filter`, a different object with eight members and a
> permalink serialisation contract. The typed one was not on the ESM root entry; the untyped
> one was.
>
> **Migration.** There is no drop-in replacement, and none is needed:
>
> - for filtering the map, use the **`Filter`** capability above (`getActiveFilter()`,
>   `applyFilter(state)`) — unchanged;
> - for filtering a plain array in your own code, use `Array.prototype.filter`. That is all
>   `filterRouteList` ever did.
>
> Earlier removals from this namespace (v3.0.0, no consumer): `filterPoiList` and the six
> statistics helpers `getUniqueCategories`, `getUniqueSubCategories`, `getUniqueTags`,
> `countByCategory`, `countBySubCategory`, `getRatingStats`.

---

## Table — data table

::: info
The data table has been extracted from the core into the MIT plugin `@geoleaf-plugins/table`. See the plugin README for installation, configuration (`modules.table.*`), and migration.
:::

---

## Legend — legend panel

```ts
import { Legend } from "@geoleaf/core";
// or: GeoLeaf.Legend (CDN/global) — mounted at boot if `modules.legend` is enabled
```

Legend is lazy-loaded.

> **Note:** `GeoLeaf.Legend` and `GeoLeaf.LayerManager` are **independent modules** with separate implementations. `Legend` manages visual legend panels generated from layer style data. `LayerManager` manages GeoJSON layer loading and visibility controls.

| Method               | Signature                                                         | Description                                                                                                                                                                                                                                                                             |
| -------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`               | `(mapInstance: any, options?: object) => boolean`                 | Initialise the module with a map instance                                                                                                                                                                                                                                               |
| `loadLayerLegend`    | `(layerId: string, styleId: string, layerConfig: object) => void` | Load and display the legend of a layer                                                                                                                                                                                                                                                  |
| `setLayerVisibility` | `(layerId: string, visible: boolean) => void`                     | Show / hide a layer from the legend                                                                                                                                                                                                                                                     |
| `getAllLayers`       | `() => Map<string, object>`                                       | Return every layer known to the legend                                                                                                                                                                                                                                                  |
| `hideLegend`         | `() => void`                                                      | Hide the legend panel                                                                                                                                                                                                                                                                   |
| `removeLegend`       | `() => void`                                                      | Remove the legend panel from the DOM                                                                                                                                                                                                                                                    |
| `isLegendVisible`    | `() => boolean`                                                   | Return the current visibility of the panel                                                                                                                                                                                                                                              |
| `toggleAccordion`    | `(layerId: string) => void`                                       | **Does not drive the accordion.** Notification hook the renderer calls **after** it has toggled the accordion itself; its body is empty. Calling it neither opens nor closes anything. Drive the accordion by clicking, or by toggling `gl-legend__accordion--collapsed` on the element |

---

## LayerManager — GeoJSON layers

```ts
import { LayerManager } from "@geoleaf/core";
// or: GeoLeaf.LayerManager (CDN/global) — posted at import
```

LayerManager manages GeoJSON layers loaded from profiles. It is the primary way
to work with GeoJSON data in GeoLeaf.

> **Note:** `GeoLeaf.GeoJSON` does **not** exist as a public API. Data access
> is exclusively through `LayerManager` and JSON profiles.

---

## Baselayers — base tiles

```ts
import { Baselayers } from "@geoleaf/core";
// or: GeoLeaf.Baselayers (CDN/global)
```

Baselayers manages raster tile layers and vector tile layers (via MapLibre GL).

---

## Helpers

```ts
import { Helpers } from "@geoleaf/core";
// or: GeoLeaf.Helpers (CDN/global)
```

---

## Validators

```ts
import { Validators } from "@geoleaf/core";
// or: GeoLeaf.Validators (CDN/global)
```

---

## API sub-modules

```ts
import {
    APIController,
    APIFactoryManager,
    APIInitializationManager,
    APIModuleManager,
    PluginRegistry,
    BootInfo,
    showBootInfo,
} from "@geoleaf/core";
```

### PluginRegistry

```ts
GeoLeaf.plugins.isLoaded("storage"); // → boolean
GeoLeaf.plugins.getLoadedPlugins(); // → string[]
GeoLeaf.plugins.canActivate("addpoi"); // → boolean
GeoLeaf.plugins.register("name", metadata); // called by plugins
GeoLeaf.plugins.registerLazy("name", fn); // called by bundle-entry
```

### showBootInfo / BootInfo

```ts
import { showBootInfo } from "@geoleaf/core";

// The namespace is the FIRST parameter and is NOT optional. Called without it, the function
// returns immediately (`if (!GeoLeaf) return;`): it does not warn, it does nothing.
type BootNs = Parameters<typeof showBootInfo>[0];

showBootInfo(GeoLeaf as BootNs); // show the boot toast
showBootInfo(GeoLeaf as BootNs, { force: true, duration: 8000 }); // override `debug.showBootInfo`
```

::: warning
**The cast is required today.** `showBootInfo` is exported publicly, but the type of its parameter
(`BootInfoNamespace`) is not — an integrator cannot even name it, hence the `Parameters<…>[0]`
above. And `GeoLeafGlobal` does not satisfy it structurally: its `_APIController` is declared
`unknown` where the contract expects `{ init(): boolean } | null`. In practice this function is
called by the core boot sequence; a manual call is rarely useful.
:::

---

## Log

```ts
import { Log } from "@geoleaf/core";
// or: GeoLeaf.Log (CDN/global)

Log.info("message");
Log.warn("message");
Log.error("message", error);
```

---

## Errors — typed error classes

```ts
import { Errors } from "@geoleaf/core";
// or: GeoLeaf.Errors (CDN/global)
```

9 typed error classes (see [errors/GeoLeaf_Errors_README.md](errors/GeoLeaf_Errors_README.md)).

---

## CONSTANTS

```ts
import { CONSTANTS } from "@geoleaf/core";
// or: GeoLeaf.CONSTANTS (CDN/global)

CONSTANTS.DEFAULT_CENTER; // Default map center
CONSTANTS.DEFAULT_ZOOM; // Default zoom level
CONSTANTS.MAX_ZOOM_ON_FIT; // Zoom ceiling applied by fitBounds
// … see constants/GeoLeaf_Constants_README.md for full list
```

::: warning
**`CONSTANTS` carries no `VERSION`.** The object is `Object.freeze`d over 15 keys covering map,
POI, route, GeoJSON and UI. The library version has no public accessor: it is posted on
`GeoLeaf._version`, whose `_` prefix says exactly what to make of it. Read `package.json` on the
integrator side.
:::

---

## Utils

```ts
import { Utils } from "@geoleaf/core";
// or: GeoLeaf.Utils (CDN/global)
```

9 utility sub-modules registered on `GeoLeaf.Utils`:

| Sub-module                   | Description                  |
| ---------------------------- | ---------------------------- |
| `DOMSecurity`                | Safe DOM manipulation        |
| `ErrorLogger`                | Error logging utilities      |
| `EventListenerManager`       | Managed event listeners      |
| `EventBus`                   | Pub/sub event bus            |
| `FetchHelper`                | Fetch with cache/timeout     |
| `MapHelpers`                 | MapLibre GL JS map utilities |
| `PerformanceProfiler`        | Timing/perf profiling        |
| `TimerManager`               | Managed timers/debounce      |
| `ObjectUtils` / `ScaleUtils` | Object & scale helpers       |

::: warning
**`PerformanceProfiler.analyzeMemoryLeaks()` will normally answer `unavailable`, and that is the
honest answer.** Its only source of heap figures is `performance.memory`, which Chrome quantises
and then caches for the lifetime of the page (and which no other browser exposes at all), so the
samples it judges are usually identical to the byte. Rather than return a reassuring `normal`
computed from an input that never moved, the method reports `{ status: "unavailable", reason }` and
explains itself in `recommendation`. **Do not read `unavailable` as "no leak"** — it means the
browser gave nothing to judge. Timing marks, measures and the rest of `generateReport()` are
unaffected.
:::

---

## Config

```ts
import { Config } from "@geoleaf/core";
// or: GeoLeaf.Config (CDN/global)

Config.get("map"); // Get a config section
Config.get("ui"); // Get UI config
Config.set("key", value); // Set a config value
```

### Per-module configuration (`modules.*`)

Plugin configuration is declared under a `modules.<id>` block in the profile (e.g. `modules.storage`, `modules.print`). Legacy root keys (`storage`, `poiAddConfig`, `printConfig`, `measureConfig`, `editorConfig`) are deprecated but keep working during the transition (a one-time console warning is emitted per module).

```ts
// Reads modules.<id>.<key>, falling back on the module's legacy root key
Config.getModuleConfig("storage", "cache.enableProfileCache", true);
// Dot-notation equivalent (no legacy fallback)
Config.get("modules.storage.cache.enableProfileCache");
```

---

## Geocoding — address search

::: warning
**Extracted into a plugin.** Address search (geocoding) is no longer part of `@geoleaf/core` — it is provided by the MIT plugin **`@geoleaf-plugins/geocoding`** (public on npmjs.org). Configuration moves from the root key **`geocodingConfig`** to **`modules.geocoding.*`** (declared in `config/plugins/geocoding.json` through `Files.modules.geocoding`) — a **breaking** migration, with no shim. The `GeoLeaf.Geocoding` API, the `geoleaf:geocoding:result` event and the search control are provided by the plugin. See the plugin README (`packages/plugins/geocoding/README.md`).
:::

```ts
import { Permalink } from "@geoleaf/core";
// or: GeoLeaf.Permalink (CDN/global)
```

Synchronises map state (center, zoom, active layers, filters) to the URL hash or query string.
Enable in config: `{ "ui": { "permalink": { "enabled": true, "mode": "hash" } } }`.

| Method             | Signature                                    | Description                                           |
| ------------------ | -------------------------------------------- | ----------------------------------------------------- |
| `init`             | `(config: PermalinkConfig) => void`          | Initialise with the `ui.permalink` config block       |
| `readAndStore`     | `() => void`                                 | Parse current URL and cache the state                 |
| `applyStoredState` | `(map: any) => void`                         | Restore the cached state to a map instance            |
| `startSync`        | `(map: any) => void`                         | Begin continuous URL synchronisation on map move/zoom |
| `getState`         | `() => PermalinkState \| null`               | Return the last cached state (read-only)              |
| `buildUrl`         | `(state?: PermalinkState \| null) => string` | Serialise a state to a URL fragment/query string      |

```ts
// Typical lifecycle (handled automatically by the boot sequence):
Permalink.init(config.ui.permalink);
Permalink.readAndStore(); // before map creation
Permalink.applyStoredState(map); // after map + modules are ready
Permalink.startSync(map); // begin sync
```

> **Security:** `lat`, `lng`, `zoom` are validated via `validateNumber()` / `validateCoordinates()`. Layer IDs are string-filtered (max 100 entries). Filter text is truncated to 200 chars.

---

## Notifications — toast notifications

```ts
import { Notifications } from "@geoleaf/core";
// or: GeoLeaf.Notifications (CDN/global) — or shortcut: GeoLeaf.notify(msg, type)
```

Displays non-blocking toast messages. Queued automatically when the DOM is not yet ready.

`Toast` below is `HTMLElement | null | undefined` — the toast element, `null` when the queue rejected the notification, `undefined` when the renderer is not initialised.

| Method      | Signature                          | Description                                        |
| ----------- | ---------------------------------- | -------------------------------------------------- |
| `notify`    | `(msg, typeOrOpts?, ms?) => Toast` | Display a toast (generic)                          |
| `show`      | `(msg, typeOrOpts?, ms?) => Toast` | Alias of `notify`                                  |
| `success`   | `(msg, msOrOpts?) => Toast`        | Green success toast                                |
| `error`     | `(msg, msOrOpts?) => Toast`        | Red error toast (5 s default, persistent option)   |
| `warning`   | `(msg, msOrOpts?) => Toast`        | Yellow warning toast                               |
| `info`      | `(msg, msOrOpts?) => Toast`        | Blue informational toast                           |
| `dismiss`   | `(toastEl: HTMLElement) => void`   | Dismiss a specific toast                           |
| `clearAll`  | `() => void`                       | Remove all toasts and clear the queue              |
| `getStatus` | `() => NotifyStatus`               | Return current system state (activeToasts, queued) |

The second argument is **either** a duration in milliseconds **or** an options object — never both. The third argument only applies to `notify` / `show`, and only when the second one is a type string.

```ts
Notifications.success("Data loaded");
Notifications.error("Loading failed", { persistent: true, dismissible: true });
Notifications.notify("Info", "info", 8000); // positional: type + duration (ms)
Notifications.notify("Info", { type: "info", duration: 8000 }); // or an options object

// Keep the handle to dismiss a persistent toast yourself
const toast = Notifications.info("Import in progress…", { persistent: true });
if (toast) Notifications.dismiss(toast);
```

---

## Popup — popup action buttons

Action buttons (field renderer `type: "action"` in `popup.fields[]`, rendered by the in-core `feature-info` capability on the popup **and** the side panel) dispatch the `geoleaf:popup:action` DOM event on click. Listen via `GeoLeaf.Events.on("geoleaf:popup:action", …)` (see `EVENTS_API.md`). There is no handler-registry facade — the core stays backend-agnostic and `actionId` semantics are entirely the host's.

Since 14/08/2026 the payload is **no longer JSON-only**: alongside the data fields it carries `button` (the clicked node), `setBusy(busy)` and `close()`. `JSON.stringify(e.detail)` therefore throws — copy the fields you need. And `properties` is **empty unless the button declares `payloadFields`**; both points are detailed in `EVENTS_API.md`.

```ts
// Example — open a host form when a popup action button is clicked
GeoLeaf.Events.on("geoleaf:popup:action", async (e) => {
    const { actionId, layerId, featureId, properties } = e.detail;
    if (actionId !== "host:open-form") return;
    await fetch("/api/poi/open", {
        method: "POST",
        headers: GeoLeaf.Security.CSRFToken.addTokenToHeaders({
            "Content-Type": "application/json",
        }),
        body: JSON.stringify({ id: featureId, layerId }),
    });
});
```

> **Security:** `actionId` is validated (token `^[A-Za-z0-9:_-]{1,64}$`) at render and dispatch; labels are HTML-escaped. Buttons render as `<button type="button" data-action-id>` (no inline `onclick`).

---

## PWA — install prompt

```ts
import { PWA } from "@geoleaf/core";
// or: GeoLeaf.PWA (CDN/global)
```

Manages the Progressive Web App install banner (iOS) and install prompt (Chrome/Android).
Activated automatically by the boot sequence when `pwa.installPrompt.enabled: true` in config.

| Method          | Signature                     | Description                                                           |
| --------------- | ----------------------------- | --------------------------------------------------------------------- |
| `init`          | `(config: PWAConfig) => void` | Initialise PWA features (called by boot — opt-in only)                |
| `isInstallable` | `() => boolean`               | `true` when the app can still be installed on this device — see below |

### `isInstallable()`

Use it to render **your own** install button instead of the built-in banner:

```ts
if (GeoLeaf.PWA.isInstallable()) {
    myInstallButton.hidden = false;
}
```

It mirrors the platform split of the banner:

- **iOS Safari** — `true` when running on iOS and not already installed. iOS never fires
  `beforeinstallprompt`, so this is the only signal available there.
- **Android / Chrome / Edge** — `true` once the browser has offered a deferred install prompt.

::: warning
On Android this answers **"a prompt is available"**, not "this browser could install the app". The
deferred prompt is only captured when `installPrompt.enabled` is `true` — with the banner disabled,
it returns `false` even on an installable Chrome. iOS is unaffected.
:::

```ts
// Opt-in via geoleaf.config.json:
// { "pwa": { "installPrompt": { "enabled": true } } }

// Manual check (advanced):
GeoLeaf.PWA.init({ installPrompt: { enabled: true } });
```

> **Note:** PWA features are opt-in. Without `installPrompt.enabled: true`, `init()` is a no-op.

---

## Composing a lighter bundle

> **REMOVED in v3** — `GeoLeaf._loadModule()` and `GeoLeaf._loadAllSecondaryModules()` no
> longer exist, and nothing replaces them. The `lite` build is gone too. Delete the calls.

Every in-core capability ships in `geoleaf.esm.js`. A config flag (`modules.<id>.enabled`) turns
one _off_; only a build-time choice takes its code _out of the file_. To do that, compose your own
entry from the capability installers you need — see
[COOKBOOK Recipe 8](COOKBOOK.md#recipe-8--shipping-less-than-the-whole-library) and the tested
recipe in `examples/minimal/entry.ts`.

---

## Global namespace (window.GeoLeaf.\*)

After loading `dist/geoleaf.esm.js` via CDN (`<script type="module">`), properties are available on
`window.GeoLeaf` in **two waves**.

**1. Kernel facades — posted at import, before `GeoLeaf.boot()`**

A script or plugin loaded before `boot()` can already call them. _(This restored a behaviour that an
internal v2.x refactor had silently removed: the surface available at import went back from 64 to
**88** keys in v3.)_

| Property                                 | Description                                        |
| ---------------------------------------- | -------------------------------------------------- |
| `GeoLeaf.Core`                           | Map lifecycle                                      |
| `GeoLeaf.Layers`                         | Feature data — see [Layers](#layers--feature-data) |
| `GeoLeaf.UI`                             | UI controls                                        |
| `GeoLeaf.LayerManager`                   | Layer management                                   |
| `GeoLeaf.Baselayers`                     | Base tile layers                                   |
| `GeoLeaf.Helpers` · `GeoLeaf.Validators` | Helpers, input validators                          |
| `GeoLeaf.Events`                         | DOM event bus                                      |
| `GeoLeaf.I18n`                           | `registerDict` / `getLabel` / `t`                  |
| `GeoLeaf.Utils` · `GeoLeaf.CONSTANTS`    | Utilities, constants                               |
| `GeoLeaf.Log` · `GeoLeaf.Errors`         | Logging, typed error classes                       |
| `GeoLeaf.Security`                       | XSS/CSRF protection                                |
| `GeoLeaf.Config`                         | Config access                                      |
| `GeoLeaf.Introspection`                  | Capability schemas, and their activation verdict   |
| `GeoLeaf.plugins`                        | Plugin registry                                    |
| `GeoLeaf.notify()`                       | Notification primitive (buffered)                  |
| `GeoLeaf._version`                       | Version string                                     |

**2. Capability facades — mounted at boot, gated by configuration**

Each is posted by its capability's installer and **only if its gate is open** (`modules.<id>.enabled`).
Most are opt-out (active unless set to `false`); check the individual section.

| Property                | Gate                      | Description                                        |
| ----------------------- | ------------------------- | -------------------------------------------------- |
| `GeoLeaf.Taxonomy`      | `modules.taxonomy`        | [The point symbol](#taxonomy--the-point-symbol)    |
| `GeoLeaf.Filter`        | `modules.filter`          | [Filter panel](#filter--the-filter-panel-singular) |
| `GeoLeaf.Cluster`       | `modules.cluster`         | Point clustering (read-only)                       |
| `GeoLeaf.Legend`        | `modules.legend`          | Legend panel                                       |
| `GeoLeaf.Permalink`     | `modules.permalink`       | URL deep linking                                   |
| `GeoLeaf.Share`         | `modules.permalink.share` | Share dialog                                       |
| `GeoLeaf.Notifications` | `modules.toast-renderer`  | Rich toast surface                                 |
| `GeoLeaf.PWA`           | `modules.pwa`             | PWA install prompt                                 |
| `GeoLeaf.Labels`        | `modules.labels`          | Layer labels                                       |

**3. Plugin namespaces — after their script has loaded**

`GeoLeaf.Storage`, `GeoLeaf.Editor`, `GeoLeaf.Table`, `GeoLeaf.FeatureInfo`, `GeoLeaf.Geocoding`,
`GeoLeaf.Measure`, `GeoLeaf.Print`… — load the plugin script **after** `geoleaf.esm.js` and
**before** `GeoLeaf.boot()`.

> `GeoLeaf._loadModule` / `GeoLeaf._loadAllSecondaryModules` were **removed in v3** — see
> [Composing a lighter bundle](#composing-a-lighter-bundle).

> **TypeDoc (generated):** Run `npm run docs:api` in `packages/core` to generate
> complete API documentation from TSDoc comments into `docs/api/`.

---

## TypeScript types

`@geoleaf/core` ships TypeScript declarations. The canonical types entry point is:

```ts
// tsconfig.json path (built declarations)
"types": ["@geoleaf/core"]
// Resolves to: node_modules/@geoleaf/core/dist/types/bundle-esm-entry.d.ts
```

::: tip
**The package exports 19 named types.** See [Extension contracts](#extension-contracts-typescript)
for the list and the per-contract subpaths. If you previously re-declared these interfaces in your
own project, delete those declarations — that duplication is exactly what publishing the contracts
was meant to end.
:::

The generated declarations ship in **`dist/types/bundle-esm-entry.d.ts`** (resolved by
`package.json#types`). Types that remain internal — `LayerConfig`, `ThemeConfig` and the rest of
the source's type surface — are **not** part of the public API: do not import them by path, it is
not a supported entry point. The rule is simple: **if it is not re-exported from `@geoleaf/core`
or from a `./contracts/*` subpath, it is not public.**

_(There is no hand-written `index.d.ts` anywhere — the declarations are generated from the source
at build time. The generated `dist/types/` is the only contract.)_
