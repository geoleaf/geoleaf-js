---
title: "Runtime performance metrics (GeoLeaf)"
---

# Runtime performance metrics (GeoLeaf)

This page describes the **custom metrics** exposed by GeoLeaf once the map has loaded.

## Collected metrics

| Metric             | Description                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| `timeToMapReadyMs` | Time between page load (navigation start) and the **map ready** event (first layer displayed), in ms. |
| `timeToAppReadyMs` | Time between page load and the **app ready** event (application interactive), in ms.                  |
| `startupTotalMs`   | Initialisation duration (the `geoleaf:startup-total` measure: from `initApp` start to ready), in ms.  |
| `capturedAt`       | Capture time of the metrics (ISO string).                                                             |

The metrics are computed once, when the `geoleaf:app:ready` event fires.

## Usage

### Reading the metrics after load

```js
// After geoleaf:app:ready
const metrics = GeoLeaf.getPerformanceMetrics();
console.log(metrics.timeToMapReadyMs, metrics.startupTotalMs);
```

Equivalent: `GeoLeaf.getRuntimeMetrics()`.

### Boot callback (recommended in production)

To send the metrics to a backend or an analytics tool without writing to the console:

```js
GeoLeaf.boot({
    onPerformanceMetrics: function (metrics) {
        // Send to your own analytics / beacon endpoint
        if (navigator.sendBeacon && metrics.timeToMapReadyMs != null) {
            navigator.sendBeacon("/api/perf", JSON.stringify(metrics));
        }
    },
});
```

### Console output (development)

To print the metrics to the console on every load:

- **Option 1**: before calling `GeoLeaf.boot()`, set  
  `GeoLeaf._debugPerf = true;`
- **Option 2**: globally, set  
  `window.__GEOLEAF_PERF_DEBUG__ = true;`

Then call `GeoLeaf.boot()` as usual. When `geoleaf:app:ready` fires, a line such as  
`[GeoLeaf Perf] map ready: 1234ms | app ready: 1250ms | startup: 1200.0ms`  
is logged.

### Reset (tests / SPA)

If the map is reloaded without reloading the page:

```js
GeoLeaf.resetRuntimeMetrics();
```

The next call to `getPerformanceMetrics()` or `onPerformanceMetrics` recomputes the metrics.

## Events used internally

- `geoleaf:map:ready`: map ready, first layer displayed.
- `geoleaf:app:ready`: application ready (detail carries `version` and `timestamp`).

The Performance API marks in use are `geoleaf:initApp:start` and `geoleaf:initApp:ready`, plus the `geoleaf:startup-total` measure.

## Boot payload target

The real cost at boot is the `geoleaf.esm.js` entry **plus the transitive closure of its static imports** — dynamic `import()` calls are excluded. That closure is what is measured, and enforced at build time by `npm run size` (`scripts/check-bundle-size.cjs`): **warning above 270 KB gzip**, **build failure above 300 KB gzip**.

> **There is no "Lite" bundle.** To ship less than the whole library, compose your own entry point from the installers of the capabilities you need: everything else is then **tree-shaken** — absent, not deferred. Recipe: `COOKBOOK.md`, _Recipe 8_; worked example: `examples/minimal/entry.ts` (9 capabilities out of 18).

### Reference measurements (perf-baseline.json)

Sizes recorded as a baseline:

| Artefact                             | Raw size  | Gzip size     | Note                                             |
| ------------------------------------ | --------- | ------------- | ------------------------------------------------ |
| ESM flat bundle (all chunks inlined) | 580.67 KB | **127.42 KB** | Baseline reference                               |
| ESM main entry (split build)         | 5.81 KB   | 1.73 KB       | Entry point alone — chunks are loaded separately |
| CSS bundle                           | 151.88 KB | 22.58 KB      | Complete UI styles                               |

### Verification

- **Boot payload gate**: `npm run size` (at the monorepo root) measures the closure of static imports from the entry point and fails above the budget. This is the authoritative check.
- **Benchmark script**: `npm run benchmark` (at the monorepo root) prints the raw and gzip sizes of the artefacts in `dist/`.
- **Rollup visualizer**: after `npm run build` in `packages/core`, open `packages/core/dist/stats.html` in a browser to see the size breakdown (gzip included) per module.

Run these regularly — before a release, or after large changes — to keep the target in view.

## Web Vitals (LCP, INP, CLS)

The metrics above are **custom** (time to first layer, time to interactivity). For **Web Vitals** (LCP, INP, CLS), integrate the [web-vitals](https://github.com/GoogleChrome/web-vitals) library on the application side and combine its callback with `onPerformanceMetrics` to send a single payload (custom metrics plus Web Vitals) to your analytics.
