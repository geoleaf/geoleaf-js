---
title: "GeoLeaf-JS — Cookbook"
---

# GeoLeaf-JS — Cookbook

**Package:** `@geoleaf/core`
**Applies to:** `@geoleaf/core` v3.x
**License:** MIT
**Map engine:** MapLibre GL JS ^6.0.0

Practical recipes for common GeoLeaf use cases.

> **Note (v3.0.0):** GeoLeaf is built on **MapLibre GL JS v6** (WebGL rendering,
> native vector tiles, ESM-only).
> MapLibre GL JS is a **peer dependency** — install it separately.

---

## Table of contents

1. [Minimal map](#recipe-1--minimal-map)
2. [Map with JSON profile](#recipe-2--map-with-json-profile)
3. [Styling points by category](#recipe-3--styling-points-by-category)
4. [Filter panel](#recipe-4--filter-panel)
5. [Applying themes](#recipe-5--applying-themes)
6. [Data table](#recipe-6--data-table)
7. [Layer visibility toggle](#recipe-7--layer-visibility-toggle)
8. [Shipping less than the whole library](#recipe-8--shipping-less-than-the-whole-library)
9. [Plugin health check](#recipe-9--plugin-health-check)
10. [Custom basemap](#recipe-10--custom-basemap)
11. [Address search (geocoding)](#recipe-11--address-search-geocoding)

---

## Recipe 1 — Minimal map

The simplest possible GeoLeaf map. MapLibre GL JS is loaded as a peer dependency.

**ESM/npm (recommended):**

```bash
npm install @geoleaf/core maplibre-gl
```

```ts
import { Core } from "@geoleaf/core";
import "maplibre-gl/dist/maplibre-gl.css";
import "@geoleaf/core/style.css";

Core.init({
    mapId: "map",
    center: [48.8566, 2.3522], // [lat, lng] in GeoLeaf; MapLibre expects [lng, lat], the conversion is internal
    zoom: 12,
});
```

**CDN/ESM:**

```html
<!DOCTYPE html>
<html lang="fr">
    <head>
        <meta charset="UTF-8" />
        <!-- MapLibre GL JS (peer dependency) -->
        <link
            rel="stylesheet"
            href="https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.css"
        />
        <!-- GeoLeaf styles -->
        <link
            rel="stylesheet"
            href="https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf-main.min.css"
        />
        <style>
            #map {
                width: 100vw;
                height: 100vh;
                margin: 0;
            }
        </style>
    </head>
    <body>
        <div id="map"></div>
        <!-- The shim first, in its OWN tag: the `import` statements of a module are hoisted and
             evaluated before any code, so setting the global between two imports would set it
             AFTER GeoLeaf has been evaluated. Two module tags, by contrast, run in order. -->
        <script type="module">
            import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.mjs";
            globalThis.maplibregl = maplibregl;
        </script>
        <script type="module">
            import { Core } from "https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf.esm.js";

            Core.init({
                mapId: "map",
                center: [48.8566, 2.3522],
                zoom: 12,
            });
        </script>
    </body>
</html>
```

---

## Recipe 2 — Map with JSON profile

Load a full JSON configuration profile. All layers, styles, POI taxonomy,
and UI settings are defined in the profile — no additional code required.

```js
await GeoLeaf.loadConfig("/profiles/my-app.json");
```

Or pass directly in `init`:

```js
GeoLeaf.Core.init({
    mapId: "map",
    configUrl: "/profiles/my-app.json",
});
```

See [PROFILES_GUIDE.md](PROFILES_GUIDE.md) for profile structure.

---

## Recipe 3 — Styling points by category

A "POI" is not a special object in v3 — it is a **point feature of a normal layer**. Its symbol is
owned by the `taxonomy` capability, and it is configured **declaratively in the profile**, not by
an API call.

Three steps, all in `config/plugins/taxonomy.json` (referenced by `Files.modules.taxonomy`):

**1. Declare a named taxonomy** and the sprite its icons come from.

```json
{
    "enabled": true,
    "icons": {
        "spriteUrl": "../profiles/tourism/icons/sprite_tourism.svg",
        "symbolPrefix": "tourism-poi-cat-"
    },
    "taxonomies": {
        "poi-cat": {
            "categories": {
                "hebergement": {
                    "label": "Hébergements",
                    "icon": "bed",
                    "iconColor": "#ffe9d6",
                    "marker": { "fill": "#c2410c", "stroke": "#ffffff", "strokeWidth": 1.5 }
                },
                "restaurant": {
                    "label": "Restaurants",
                    "icon": "fork",
                    "marker": { "fill": "#15803d" }
                }
            }
        }
    }
}
```

**2. Bind your layers to it** — a layer gets icons **only** if it is bound. This is the step people
miss:

```json
{
    "layers": {
        "hebergements": { "use": "poi-cat" },
        "cultures": { "use": "poi-cat" }
    }
}
```

**3. Tell your features which category they belong to** — the `categoryId` property of each feature
must match a key of `categories`.

**What belongs where.** The capability owns the **symbol**: icon, `iconColor` (the glyph tint) and
the `marker` disc (`fill` / `stroke` / `strokeWidth`), plus the colour of category pill badges. It
does **not** own the **size** of the point, nor the **colour of geometry** — those stay in the
layer's `styleRules`, because one category serves layers with different radii. `marker: false`
renders a bare icon, with no disc at all.

**Reading it back from code:**

```js
// Prefer getLayerCategories when you start from a layer: it resolves the binding for you.
const cats = GeoLeaf.Taxonomy.getLayerCategories("hebergements");
// → { hebergement: { label: "Hébergements", icon: "bed", … }, … }
```

> **BREAKING (v3.0.0)** — `GeoLeaf.POI.init()` no longer exists, and neither do the per-category
> `colorFill` / `colorStroke` / `color` / `colorRoute` keys: they were documented as painting
> geometry but **never painted anything** — the module reading them was never registered. Express
> geometry colour in the layer's `styleRules` instead. `modules.taxonomy.enabled` is now
> **opt-out** (default `true`) and the gate is **total**.

A complete, working example ships with the repo: `profiles/tourism/`.

---

## Recipe 4 — Filter panel

Filters are configured in the profile. The filter panel UI is managed
automatically — use the `GeoLeaf.Filter` (singular) capability for programmatic
access to the active panel state:

```js
// Read the active filter state (e.g. for a permalink)
const state = GeoLeaf.Filter.getActiveFilter();

// Restore a serialised filter state onto the panel + sources
GeoLeaf.Filter.applyFilter(state);

// Check whether any field is currently constrained
const hasActive = GeoLeaf.Filter.hasActiveFilters();
```

> **BREAKING (v3.0.0)** — `GeoLeaf.Filters.filterPoiList` and the stats helpers
> (`getUniqueCategories`, `countByCategory`, …) are removed: they had no internal
> consumer.
>
> **BREAKING (v3.1.0)** — the whole `GeoLeaf.Filters` namespace is gone, along with its
> last method `filterRouteList`. Use the `GeoLeaf.Filter` capability (singular) — see
> [API_REFERENCE.md](API_REFERENCE.md#filter--the-filter-panel-singular).

---

## Recipe 5 — Applying themes

Apply a UI theme (light/dark):

```js
// Apply via top-level API
GeoLeaf.setTheme("dark");
GeoLeaf.setTheme("light"); // default

// Apply via Core facade
GeoLeaf.Core.setTheme("dark");

// Get current UI theme
const current = GeoLeaf.Core.getTheme(); // → "dark"
```

---

## Recipe 6 — Data table

::: info

The data table has been extracted from the core into the MIT plugin `@geoleaf-plugins/table`. See the plugin README for installation, configuration (`modules.table.*`), and migration.

:::

```js
// Import the table plugin via its own script/entry (after @geoleaf/core).
// `GeoLeaf.Table` is available once the plugin is loaded — no _loadModule("table").

// Initialize with POI data from the profile
GeoLeaf.Table.init({ visible: true });

// Show/hide table
GeoLeaf.Table.show();
GeoLeaf.Table.hide();
GeoLeaf.Table.toggle();
```

---

## Recipe 7 — Layer visibility toggle

LayerManager creates a UI control panel for toggling layer visibility. It is part of the
kernel — it is in the bundle as soon as GeoLeaf is, nothing to load first:

```js
// Initialize the LayerManager on the map
GeoLeaf.LayerManager.init({ map });

// Refresh the panel display
GeoLeaf.LayerManager.refresh();
```

Layer visibility is toggled via the UI toggle buttons in the panel.
Layers must be defined in the profile. Layer ids come from the profile `layers[].id` field.

---

## Recipe 8 — Shipping less than the whole library

> **BREAKING (v3)** — `GeoLeaf._loadModule()` and `GeoLeaf._loadAllSecondaryModules()` **no
> longer exist**, and there is nothing to call in their place. If your code called them, delete
> the call: everything they used to fetch is already in the bundle by the time your script runs.

They were a runtime answer to a build-time question. Every in-core capability now ships in
`dist/geoleaf.esm.js` and is available the moment the bundle is parsed — a config flag
(`modules.<id>.enabled`) can switch a capability _off_, but it can never take its code out of
the file the browser downloaded.

If what you actually want is a **smaller file**, that is a build-time choice, and GeoLeaf
supports it directly: write your own entry listing only the capability installers you need, and
point your bundler at it. Everything you left out is tree-shaken away — not deferred, _absent_.

```ts
// my-entry.ts
import "@geoleaf/core/globals"; // populates window.GeoLeaf.* — also pulls in the kernel stylesheet
import "@geoleaf/core/helpers";
import { installBoot } from "@geoleaf/core/boot";
import { LEGEND_INSTALLER } from "@geoleaf/core/capabilities/legend/install.js";
import { CLUSTER_INSTALLER } from "@geoleaf/core/capabilities/cluster/install.js";

installBoot({ id: "my-app", capabilities: [LEGEND_INSTALLER, CLUSTER_INSTALLER] });

export * from "@geoleaf/core/kernel";
export { Legend } from "@geoleaf/core/facades/legend.js";
```

> **BREAKING (v3)** — the subpaths above are the supported ones. Imports through
> `@geoleaf/core/src/…` do not resolve: `src/` is not listed in the package's `files`, so it is
> never published, and `exports` never exposed it. The supported subpaths are checked on every
> build — see below.

**The CSS follows the code.** Since v3, each capability imports its own stylesheet from its
`install.ts`, so the CSS is a node of the module graph: leave `filter` out and your bundle carries
neither its JavaScript nor its proximity bar's CSS. Your bundler extracts the result the usual way
(GeoLeaf's own build emits `dist/geoleaf-main.min.css`, still reachable as
`@geoleaf/core/style.css` if you prefer the plain `<link>`). The cascade is pinned with
`@layer gl.reset, gl.tokens, gl.kernel, gl.capabilities, gl.overrides`, so it does not depend on
the order your bundler happens to concatenate in — and `gl.overrides` is yours: a rule you put
there wins without `!important`.

**How this is verified.** Two entries are built and measured on every single build:

|                              | What it proves                                                                                                                                                 | Command                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `examples/minimal/entry.ts`  | the **source graph** tree-shakes                                                                                                                               | `npm run size:example`  |
| `examples/consumer/entry.ts` | the **published package** does — it imports through the very subpaths printed above, resolving through `exports` into `dist/esm/` exactly as your bundler will | `npm run size:consumer` |

Both read the **sourcemaps** of the real eager closure (JS _and_ CSS): not one source file, and not
one stylesheet, of an excluded capability is in it. The second entry exists because the first cannot
see past the repository — only a resolution through the published `exports` map proves what an
integrator actually receives.

---

## Recipe 9 — Plugin health check

Verify that required plugins and modules are correctly loaded:

```js
// Check a plugin (CDN / global namespace)
GeoLeaf.plugins.isLoaded("storage"); // → boolean
GeoLeaf.plugins.isLoaded("addpoi"); // → boolean

// List all loaded plugins
console.log(GeoLeaf.plugins.getLoadedPlugins());
// → ["core", "storage", "labels", "legend", ...]

// Check if a plugin's dependencies are met
GeoLeaf.plugins.canActivate("addpoi"); // → true if "storage" is loaded

// APIController health
console.log(GeoLeaf.getHealth());
// → { initialized: true, modules: {...}, errors: [] }
```

> **ESM import:** `import { PluginRegistry } from "@geoleaf/core"` for bundlers.

---

## Recipe 10 — Custom basemap

Register and activate a custom vector or raster basemap.

**Vector basemap (MapLibre GL JS style):**

```js
// Register a vector tile basemap (MapLibre GL JS style spec)
GeoLeaf.Baselayers.registerBaseLayer("my-vector-map", {
    style: "https://tiles.myserver.com/style.json",
});

// Activate it
GeoLeaf.Baselayers.setBaseLayer("my-vector-map");
```

**Register multiple basemaps at once:**

```js
GeoLeaf.Baselayers.registerBaseLayers({
    "osm-standard": {
        url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
    },
    satellite: {
        style: "https://tiles.myserver.com/satellite-style.json",
    },
});

// Activate one
GeoLeaf.Baselayers.setBaseLayer("satellite");

// Get current active key
console.log(GeoLeaf.Baselayers.getActiveKey());
```

Basemaps are typically defined in the JSON profile. Use the programmatic API
for dynamic basemap switching.

---

## Recipe 11 — Address search (geocoding)

::: warning

**Extracted into a plugin.** Address search (geocoding) is no longer part of `@geoleaf/core` — it is provided by the MIT plugin **`@geoleaf-plugins/geocoding`**. The configuration moves from the root key **`geocodingConfig`** to **`modules.geocoding.*`** (declared in `config/plugins/geocoding.json` through `Files.modules.geocoding`) — a **breaking migration, with no shim**. The `GeoLeaf.Geocoding` API, the `geoleaf:geocoding:result` event and the search control all come from the plugin. See the plugin README (`packages/plugins/geocoding/README.md`).

:::

---

## Named ESM exports reference

Direct imports available from `@geoleaf/core` (modern bundlers):

::: warning

The **`Filter`** and **`Filters`** capabilities are not among them, and never were: the first lives
on the global (`GeoLeaf.Filter`), the second was removed in v3.1.0.

:::

```ts
import {
    // Kernel facades
    Core,
    GeoLeafAPI,
    UI,
    LayerManager,
    Baselayers,
    Helpers,
    Validators,
    Events,

    // API sub-modules
    APIController,
    APIFactoryManager,
    APIInitializationManager,
    APIModuleManager,
    PluginRegistry,
    BootInfo,
    showBootInfo,

    // Utilities
    Log,
    Errors,
    CONSTANTS,
    Utils,
    applyCssText,
    Config,

    // Capability facades
    Legend,
    Permalink,
    Share,
    Notifications,
    PWA,
} from "@geoleaf/core";
```

> **Removed in v3** _(breaking)_: `POI` (subsystem dissolved — use the `GeoLeaf.Layers` global),
> `Route` (now the in-core `route` capability), `Table` (extracted → `@geoleaf-plugins/table`),
> `Themes` (dead facade, removed) and `Search` (engine purged, along with its `flexsearch`
> dependency).

::: warning

**`Layers`, `Taxonomy`, `Filter`, `Cluster` and `Introspection` are NOT ESM exports** — they live
**only** on the `window.GeoLeaf` global. `import { Layers } from "@geoleaf/core"` fails. See
`API_REFERENCE.md` — _Global namespace_.

:::
