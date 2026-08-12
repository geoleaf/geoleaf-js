---
title: "GeoLeaf-JS — FAQ"
---

# GeoLeaf-JS — FAQ

**Package:** `@geoleaf/core`
**Applies to:** `@geoleaf/core` v3.x
**License:** MIT

---

## Installation

### What is the correct package name?

`@geoleaf/core` — available on the public npm registry.

```bash
npm install @geoleaf/core maplibre-gl
```

> The name `geoleaf` (without a scope) is **incorrect** and refers to a different,
> unrelated package.

### What is the CDN URL?

```html
<!-- MapLibre GL JS — peer dependency, load it BEFORE GeoLeaf -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.css" />
<script type="module">
    import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.mjs";
    globalThis.maplibregl = maplibregl;
</script>

<!-- GeoLeaf CSS -->
<link
    rel="stylesheet"
    href="https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf-main.min.css"
/>

<!-- GeoLeaf JS (ESM) -->
<script
    type="module"
    src="https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf.esm.js"
></script>
```

**unpkg** variant — the same four tags, a different origin:

```html
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.css" />
<script type="module">
    import * as maplibregl from "https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.mjs";
    globalThis.maplibregl = maplibregl;
</script>
<link rel="stylesheet" href="https://unpkg.com/@geoleaf/core@3.0.0/dist/geoleaf-main.min.css" />
<script type="module" src="https://unpkg.com/@geoleaf/core@3.0.0/dist/geoleaf.esm.js"></script>
```

### What are the required peer dependencies?

```bash
npm install maplibre-gl
```

MapLibre GL JS (^6.0.0) is the only external dependency required — the range is the one
`packages/core/package.json` declares under `peerDependencies`.
Clustering is built in natively through supercluster (MapLibre clustering source) and vector
tiles are handled by MapLibre's own vector sources.

---

## Getting started

### How do I create a basic map?

**CDN/ESM:**

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.css" />
<script type="module">
    import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.mjs";
    globalThis.maplibregl = maplibregl;
</script>

<div id="map" style="height:500px"></div>
<script type="module">
    import { Core } from "https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf.esm.js";
    Core.init({
        mapId: "map",
        center: [48.8566, 2.3522], // [lat, lng] — GeoLeaf; MapLibre expects [lng, lat], conversion is internal
        zoom: 12,
    });
</script>
```

**ESM/npm:**

```ts
import { Core } from "@geoleaf/core";
Core.init({ mapId: "map", center: [48.8566, 2.3522], zoom: 12 });
```

### How do I load a JSON profile?

```js
GeoLeaf.Core.init({
    mapId: "map",
    configUrl: "/profiles/my-profile.json",
});
```

Or using the `loadConfig` method:

```js
await GeoLeaf.loadConfig("/profiles/my-profile.json");
// or with an inline object:
await GeoLeaf.loadConfig({ map: { center: [48.8566, 2.3522], zoom: 12 } });
```

---

## GeoJSON & layers

### How do I add GeoJSON layers?

GeoJSON layers are defined in the JSON profile and managed by `GeoLeaf.LayerManager`.
There is no `GeoLeaf.GeoJSON` public API.

Add layers in your profile:

```json
{
    "layers": [
        {
            "id": "regions",
            "type": "geojson",
            "url": "/data/regions.geojson",
            "style": { "color": "#e74c3c", "weight": 2 }
        }
    ]
}
```

Then access the layer manager:

```js
GeoLeaf.LayerManager.init({ map });
GeoLeaf.LayerManager.refresh();
```

Layer visibility is managed through the LayerManager UI control (toggle buttons in the panel).

---

## POI

### How do I show POI markers?

**There is no POI module any more** (dissolved in v3). A POI is just a point layer: declare it in
your profile like any other layer, and let `taxonomy` (symbols + tints), `cluster` and
`feature-info` (popup / tooltip / side-panel) style and enrich it. Nothing to load, nothing to
init. Creating POIs interactively is the job of the `@geoleaf-plugins/editor` plugin
(`GeoLeaf.Editor.AddForm.openAddForm({ lat, lng })`).

---

## Themes

### How do I apply a UI theme (light/dark)?

```js
GeoLeaf.setTheme("dark"); // via top-level API
GeoLeaf.Core.setTheme("dark"); // via Core facade
```

---

## Capabilities

### How do I load secondary modules?

**You don't — and you can't.** `GeoLeaf._loadModule()` and `GeoLeaf._loadAllSecondaryModules()`
were removed in v3. Every in-core capability ships in the bundle and is available as soon as
it is parsed. If your code called them, delete the call.

To ship _less code_, compose your own entry — see
[COOKBOOK Recipe 8](COOKBOOK.md#recipe-8--shipping-less-than-the-whole-library). That is a
build-time choice, and it actually removes the code from the file; a runtime flag never could.

### Why is my module undefined after boot?

Three usual suspects, in order of likelihood:

1. **It is a plugin, not core.** `GeoLeaf.Table`, `GeoLeaf.Editor`, `GeoLeaf.Storage`… come from
   their own `<script type="module">`, loaded after `@geoleaf/core`.
2. **The capability is gated off** by your profile (`modules.<id>.enabled: false`).
3. **You read it too early.** Wait for `geoleaf:app:ready` before touching a facade.

---

## Plugins

### How do I install the Storage plugin?

The Storage plugin (`@geoleaf-plugins/offline-ui`) is MIT, published on npmjs.org:

```bash
npm install @geoleaf-plugins/offline-ui
```

### How do I check which plugins are loaded?

```js
GeoLeaf.plugins.isLoaded("storage"); // → true/false
GeoLeaf.plugins.getLoadedPlugins(); // → ["core", "storage"]
```

> **ESM import:** `import { PluginRegistry } from "@geoleaf/core"` for bundlers.

---

## Geocoding (address search)

::: warning

**Moved out to a plugin.** Address search (geocoding) is no longer part of `@geoleaf/core` — it
is now provided by the MIT plugin **`@geoleaf-plugins/geocoding`** (public on npmjs.org). The
configuration moves from the root key **`geocodingConfig`** to **`modules.geocoding.*`**
(declared in `config/plugins/geocoding.json` through `Files.modules.geocoding`) — a **breaking
migration, with no shim**. The `GeoLeaf.Geocoding` API, the `geoleaf:geocoding:result` event and
the search control are supplied by the plugin. See the plugin README
(`packages/plugins/geocoding/README.md`).

:::

---

## Troubleshooting

### "GeoLeaf is not defined"

Check that the GeoLeaf script uses `type="module"`, and above all that **the MapLibre
JavaScript** is loaded before it — not only its stylesheet:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.css" />
<script type="module">
    import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.mjs";
    globalThis.maplibregl = maplibregl;
</script>
<link
    rel="stylesheet"
    href="https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf-main.min.css"
/>
<script type="module" src="geoleaf.esm.js"></script>
```

::: warning

Loading only the MapLibre stylesheet is the most frequent cause of this error:
`geoleaf.esm.js` declares `maplibre-gl` as `external` and reaches it solely through
`globalThis.maplibregl`, which v6 no longer sets by itself.

:::

> GeoLeaf v2 is ESM-only. The `type="module"` attribute is mandatory.

### "APIController missing"

This means a facade method was called before the boot sequence completed.
Wrap in an `init` callback or use `await GeoLeaf.init(options)`.

### `GeoLeaf._loadModule is not a function`

It was removed in v3, along with the whole lazy-loading machinery. Delete the call —
whatever you were loading is already in the bundle. See
[COOKBOOK Recipe 8](COOKBOOK.md#recipe-8--shipping-less-than-the-whole-library) if what you
wanted was a _smaller_ bundle rather than a deferred one.

### Map container not found

Ensure the DOM element exists before calling `Core.init()`:

```js
document.addEventListener("DOMContentLoaded", () => {
  GeoLeaf.Core.init({ mapId: "map", ... });
});
```

---

## API conventions

### `GeoLeaf.GeoJSON` — is there a public API?

`GeoLeaf.GeoJSON` is internal. Layer loading is configured in the
JSON profile and accessed via `GeoLeaf.LayerManager`.

If you need layers loaded at runtime, define them in your profile or use the
configuration API — see [PROFILES_GUIDE.md](PROFILES_GUIDE.md).

### `GeoLeaf.BaseLayers` vs `GeoLeaf.Baselayers`

Both work — `BaseLayers` is a backward-compatible alias for `Baselayers`.
Prefer `Baselayers` (lowercase 'l') in new code.
