---
title: "Performance architecture — GeoLeaf"
---

# Performance architecture — GeoLeaf

**Applies to:** `@geoleaf/core` v3.x

---

A short document on the technical choices behind **performance** in GeoLeaf (GeoJSON Worker, lazy loading, requestIdleCallback, MapLibre GL JS rendering, best practices).

---

## 1. GeoJSON Worker

GeoJSON layer loading can run **fetch + parse** inside a **Web Worker** so that the main thread stays free. If the Worker is unavailable, or if the data comes from the cache, the parse may run on the main thread (large files then risk freezing the UI).

- **Files involved**: `packages/core/src/kernel/geojson/` — `loader/`, `geojson-worker.ts`,
  `worker-manager.ts`.
- **Best practice**: for very large GeoJSON files, prefer splitting into several layers, per-view lazy loading, or vector tiles when the profile allows it.

---

## 2. Lazy loading (code splitting)

- **There is no lazy chunk system.** POI, Route, Themes, Table and Search no longer exist as separate modules; Legend, LayerManager and Labels are **eager** — part of the boot closure. What is genuinely lazy are the individual **dynamic `import()` calls** (for example the offline engine, loaded on demand), not a secondary chunk system.
- **Preloading**: none. Boot performs no network round-trip for secondary chunks.
- **Lazy UI**: `lazyLoadImage` (IntersectionObserver) and `lazyExecute` (deferred execution through `requestIdleCallback` or `setTimeout`) in the DOM helpers.

---

## 3. requestIdleCallback

Used to **spread work out** and keep the UI responsive:

- **GeoJSON**: after parsing (in the Worker or on the main thread), features are added to the MapLibre GL layer in **chunks** (for example 200 features per batch) through `requestIdleCallback` (falling back to `setTimeout`) so the main thread is not blocked. See `geojson/loader/single-layer.ts` (`_addFeaturesChunked`).
- **Profile / layers**: heavy tasks such as layer loading are scheduled with `requestIdleCallback` (3000 ms timeout), falling back to `setTimeout`. See `geojson/loader/profile.ts`.
- **Helpers**: `lazyExecute(callback, timeout)` uses `requestIdleCallback` when available.

---

## 4. MapLibre GL JS rendering

GeoLeaf uses **MapLibre GL JS ^6.0.0** as its map engine. Key characteristics:

- **WebGL rendering**: all vector and raster layers are rendered on the GPU through WebGL.
- **Style expressions**: filters, colours and visibility are expressed as MapLibre GL Style Spec expressions — evaluated by the rendering engine, not in JavaScript.
- **GeoJSON source**: GeoJSON data is pushed through `map.getSource(id).setData(geojson)` for incremental updates without recreating the layer.
- **Native clustering**: POI clustering uses MapLibre GL built-in clustering (source side, no JavaScript recomputation).

---

## 5. Best practices

| Topic                 | Recommendation                                                                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GeoJSON size**      | Avoid a single huge file; split into layers, or by area or view where possible. For a large file, the Worker plus chunked feature insertion limits freezes.                                  |
| **Number of layers**  | Limit the number of simultaneously active layers when the data is heavy; use per-theme visibility and lazy layer loading.                                                                    |
| **Boot payload**      | Enforced by `npm run size` (closure of static imports from the entry point); inspect the breakdown with `dist/stats.html`. To ship less, compose your own entry (`COOKBOOK.md`, _Recipe 8_). |
| **Runtime metrics**   | Use `GeoLeaf.getPerformanceMetrics()` or `GeoLeaf.boot({ onPerformanceMetrics })` to track time to first layer and time to interactivity.                                                    |
| **Style expressions** | Prefer MapLibre GL Style Spec expressions over JavaScript functions for filtering and styling (they run on the rendering thread).                                                            |
| **resize()**          | Call `map.resize()` after any change to the container dimensions (fullscreen, side panel). Use `CONSTANTS.FULLSCREEN_TRANSITION_MS` as the delay.                                            |

---

## 6. Bundle budget

The figure that matters at load time is the **boot payload**: the `geoleaf.esm.js` entry **plus the transitive closure of the chunks it imports statically**. Since `kernel-exports`, much of the entry's content lives in those chunks, so budgeting the entry alone catches no regression of the payload. `check-bundle-size.cjs` therefore measures the closure. **Dynamic** `import()` calls are not tracked (they are genuinely lazy). MapLibre GL is an external peer dependency, outside the bundle.

> ⚠️ **Do not call `geoleaf.esm.js` "a shim", and do not copy a size for it here.** The ~1 KB shim is the _granular_ entry (`dist/esm/`); the flat entry is much larger, and conflating the two is how a figure written in this very table drifted by a factor of 150 with every gate green. Every row below carries its **command**, never a value.

| Artefact                                 | Target / status                                           | Verification command |
| ---------------------------------------- | --------------------------------------------------------- | -------------------- |
| **Boot payload** (entry + static chunks) | warning > 270 KB gz, **build failure > 300 KB**           | `npm run size`       |
| `geoleaf.esm.js` alone                   | **informational, NOT a budget** — the closure is budgeted | `npm run size`       |
| Granular entry (`dist/esm/`)             | the re-export shim — informational                        | `npm run size`       |
| Sourcemaps (`.map`, published to npm)    | soft limit > 900 KB gz (never fails the build)            | `npm run size`       |

---

## See also

- `packages/core/docs/performance/CSS_ANIMATION_OPTIMIZATION.md` — CSS animation optimisation
- `packages/core/docs/ARCHITECTURE_GUIDE.md` — modular architecture and boot sequence
- `packages/core/docs/geojson/GEOJSON_LAYERS_GUIDE.md` — GeoJSON layers
- `packages/core/docs/PERFORMANCE_METRICS.md` — runtime metrics and boot payload budget
