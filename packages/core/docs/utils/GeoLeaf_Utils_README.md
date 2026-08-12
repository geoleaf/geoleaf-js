---
title: "GeoLeaf.Utils — Utils module documentation"
---

# GeoLeaf.Utils — Utils module documentation

**Applies to**: @geoleaf/core v3.x

**Source file**: `packages/core/src/utils/general/utils-namespace.ts`

---

## Overview

The `GeoLeaf.Utils` namespace gathers the shared utility functions used across every GeoLeaf module. It is assembled in `utils-namespace.ts` and exposes:

- data manipulation functions (deepMerge, resolveField, compareByOrder)
- HTTP helpers (FetchHelper)
- DOM and security utilities (DOMSecurity)
- map helpers (ensureMap, fireMapEvent, getDistance)
- flow controllers (debounce, throttle)

The object is published on `window.GeoLeaf.Utils` (or `globalThis.GeoLeaf.Utils`) after initialisation.

> **Since v3** — the ESM export and the global carry the **same shape**:
> `import { Utils } from "@geoleaf/core"` and `window.GeoLeaf.Utils` expose the same
> members. They are two distinct objects (the global must remain re-appliable by the
> module lifecycle), but their surface is locked by a test.
>
> `performanceProfiler` is a **lazy, non-enumerable** accessor: it can be read through
> `GeoLeaf.Utils.performanceProfiler` but does not appear in `Object.keys()`.

---

## Module structure

```
packages/core/src/modules/utils/
├── general/
│   ├── utils-base.ts             // Core utility functions (the 12 base helpers)
│   ├── utils-namespace.ts        // Composition — the single GeoLeaf.Utils shape
│   ├── dom-helpers.ts            // DOM factory (domCreate / createElement)
│   ├── helpers-namespace.ts      // GeoLeaf.Helpers facade object
│   ├── object-utils.ts           // Nested-path get/has/set
│   ├── scale-utils.ts            // Map scale computation
│   └── fetch-helper.ts           // HTTP client with retry/timeout
├── geo/
│   └── wkt-parser.ts             // wktToGeoJSON
├── performance/
│   ├── performance-profiler.ts
│   ├── runtime-metrics.ts
│   ├── baseline-storage.ts
│   └── devtools-export.ts
├── constants/
│   └── index.ts                  // Frozen constants (CONSTANTS)
└── log/
    └── index.ts                  // Log module
```

---

## Public API

### `validateUrl(url, allowedProtocols?)`

Validates a URL through `GeoLeaf.Security`. Returns the normalised string, or `null`.

```ts
const safe = GeoLeaf.Utils.validateUrl("https://example.com/data.json");
// => "https://example.com/data.json" | null
```

---

### `deepMerge(target, source)`

Deep merge of two objects. Guards against prototype pollution (`__proto__`, `constructor` and `prototype` are ignored).

```ts
const merged = GeoLeaf.Utils.deepMerge(defaults, overrides);
```

---

### `mergeOptions(defaults, override)`

Shallow merge through `Object.assign`. Prefer it over `deepMerge` for simple options.

```ts
const opts = GeoLeaf.Utils.mergeOptions({ timeout: 5000, retries: 2 }, userOpts);
```

---

### `resolveField(obj, ...paths)`

Resolves the first non-empty field among a list of dotted paths.

```ts
const title = GeoLeaf.Utils.resolveField(poi, "title", "label", "name");
// => walks obj.title → obj.label → obj.name → "" when none match
```

Nested notation is supported: `"attributes.commune"`, `"properties.name"`.

---

### `compareByOrder(a, b, fallback?)`

Sort comparator for layout sections. Sorts on the `order` field (numeric).

```ts
const sorted = layout.sort(GeoLeaf.Utils.compareByOrder);
```

---

### `debounce(func, wait?, immediate?)`

Delays execution of a function until the burst of calls stops.

```ts
const onInput = GeoLeaf.Utils.debounce((e) => handleSearch(e), 300);
```

---

### `throttle(func, limit?)`

Caps how often a function may run.

```ts
const onScroll = GeoLeaf.Utils.throttle(updateUI, 100);
```

---

### `getDistance(lat1, lng1, lat2, lng2)`

Computes the haversine distance between two geographic points. Returns the distance in kilometres.

```ts
const km = GeoLeaf.Utils.getDistance(48.85, 2.35, 43.29, 5.38);
```

---

### `ensureMap(explicitMap?)`

Resolves the MapLibre GL map instance from `GeoLeaf.Core.getMap()` or from an explicit argument.

```ts
const map = GeoLeaf.Utils.ensureMap(options.map);
if (map) {
    map.fitBounds(bounds);
}
```

**Returns `null` when no map is available** — and, since v3, **also when the argument is
not a map**. The value is checked by duck-typing on `getCenter` / `getBounds` / `on` / `off`,
which exist both on a GeoLeaf adapter and on a raw `maplibregl.Map`. The `if (map)` test in
the example above therefore remains the right way to call it.

> Before v3, the function returned any non-empty argument **as-is**:
> `ensureMap("foo")` evaluated to `"foo"`. The failure only surfaced at the first method
> call, far from its cause. Code that relied on that behaviour to carry something other
> than a map must now pass it directly.

---

### `fireMapEvent(map, eventName, payload?)`

Emits an event on the MapLibre GL map instance (through `map.fire()`).

```ts
GeoLeaf.Utils.fireMapEvent(map, "geoleaf:layer:loaded", { layerId: "poi" });
```

---

### `DOMSecurity`

DOM security sub-module. It exposes in particular:

- `DOMSecurity.clearElementFast(el)` — empties an element without `innerHTML`
- `DOMSecurity.setSafeHTML(el, html)` — sanitised HTML injection

```ts
GeoLeaf.Utils.DOMSecurity.clearElementFast(container);
```

---

### `FetchHelper`

Unified HTTP client with retry, timeout and automatic parsing. See `fetch-helper.ts`.

```ts
const data = await GeoLeaf.Utils.FetchHelper.fetch("/api/data.json", {
    timeout: 10000,
    retries: 2,
});
```

---

### `escapeHtml(str)` — **does not exist**

::: warning

`GeoLeaf.Utils.escapeHtml()` is not installed on the runtime namespace. It only ever lived on
the object assembled by `utils-api.ts`, whose single entry point disappeared along with the
UMD builds in v2.0.0. Calling it throws a `TypeError`.

**Use `GeoLeaf.Security.escapeHtml()`**, which is mounted, tested and documented.

:::

---

### `wktToGeoJSON(wkt)`

Converts a WKT geometry into a GeoJSON geometry.

```ts
const geom = GeoLeaf.Utils.wktToGeoJSON("POINT(2.35 48.85)");
// → { type: "Point", coordinates: [2.35, 48.85] }
```

> Announced in the changelog as of v2 but missing from the runtime for the same reason as
> `escapeHtml` above — **actually available since v3**.

---

## Full example

```ts
import { Utils } from "@geoleaf/core";

// Resolve the first non-empty field in a POI
const name = Utils.resolveField(poi, "title", "label", "name");

// Merge options with defaults
const opts = Utils.mergeOptions({ zoom: 10, padding: 20 }, userOptions);

// Debounce a search handler
// The full-text engine is not part of the core: filtering goes through the `filter` capability.
const onSearch = Utils.debounce((query: string) => {
    GeoLeaf.Filter?.applyFilter({ text: query });
}, 250);

// Compute distance between two coordinates
const distKm = Utils.getDistance(48.85, 2.35, 45.76, 4.83);
```

---

## Related modules

- `packages/core/src/modules/utils/constants/index.ts` — global constants (`CONSTANTS`)
- `packages/core/src/modules/utils/renderers/abstract-renderer.ts` — base class for renderers
- `packages/core/src/modules/built-in/security/` — XSS sanitisation, URL validation
- `packages/core/src/modules/built-in/config/` — access to the active configuration
