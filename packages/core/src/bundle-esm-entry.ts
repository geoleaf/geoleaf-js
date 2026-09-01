/*!
 * GeoLeaf Core — ESM Entry Point
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 *
 * @description
 * GeoLeaf Bundle ESM Entry Point — Phase 7.
 *
 * This is the **exclusive entry point for ESM bundle generation** via Rollup
 * (`esmConfig` in `rollup.config.mjs`).
 *
 * Responsibilities:
 *   - Side-effects: `globals.js` (assigns `window.GeoLeaf.*`) + `app/` bootstrap
 *   - The public named ESM exports intended for third-party bundlers (Vite, webpack, etc.)
 *
 * **BREAKING (S5) — `GeoLeaf._loadModule` and `GeoLeaf._loadAllSecondaryModules` are gone,**
 * with the whole `src/lazy/` machinery. They had no production caller, and by S4 the two
 * chunks they still dispatched to (`layer-manager`, `basemap-selector`) were re-export shells
 * over code that is in the eager closure anyway — Rollup was emitting them EMPTY. Splitting a
 * capability out of the payload is a **build-time** choice now (compose your own entry, see
 * `examples/minimal/entry.ts`), not a runtime fetch.
 *
 * @version 2.0.0
 * @see app/boot-core for the application initialization sequence
 */

// ── Side effects: globals.js + application bootstrap ──
// globals.js assigns window.GeoLeaf.* for CDN compatibility.
// app/* bootstraps the application.
import "./globals/globals.js";
import "./app/app-namespace.js";
import "./utils/performance/runtime-metrics.js";
import "./app/boot.js";

// ── Public ESM named exports (consumable by third-party bundlers) ──
//
// Split in two (S4):
//   - the KERNEL surface lives in `kernel-exports.ts` and is re-exported wholesale ;
//   - the CAPABILITY facades are listed HERE, because they are the half that varies
//     with what an entry embarks. A consumer entry re-exports the same kernel and only
//     the facades of the capabilities it chose (see `examples/minimal/entry.ts`).
//
// `export *` does not forward `default` — the entry keeps its own, below.
export * from "./kernel-exports.js";

// ── Capability facades — this entry embarks ALL in-core capabilities ──
// The count is deliberately NOT written here (same reason as `presets/manifest.full.ts`
// and `app/boot.ts`): a number in a header is a second source of truth that can only drift
// from the manifest. It said « 18 » for 21. What holds the promise is the guard
// `__tests__/guards/manifest-full-completeness.guard.test.ts`, which ties `FULL.capabilities`
// to the directories of `src/capabilities/` read ON DISK.
// `vector-tiles` (S5) embarks no facade: its surface is the internal `_VectorTiles`
// service-locator entry the GeoJSON loader pulls, not a public `GeoLeaf.X` namespace.
// POI subsystem dissolved (S9) — a POI is now a generic point layer (GeoLeaf.Layers)
// styled by taxonomy/cluster/feature-info. export { POI } removed (BREAKING). POI
// creation lives in the editor plugin under the GeoLeaf.Editor namespace (5.1-f: the
// addpoi plugin and its GeoLeaf.AddPOI namespace are gone, without an alias).
// Route module dissolved (S11) — route is now the in-core `route` capability
// (endpoint decorator, gate `modules.route`). export { Route } removed (BREAKING):
// itinerary lines are generic GeoJSON layers; the capability derives the endpoints.
// Storage is now a Plugin (@geoleaf-plugins/offline-ui)
// export { Storage } removed — use GeoLeaf.Storage namespace after loading the plugin
// Table is now a Plugin (@geoleaf-plugins/table)
// export { Table } removed — use GeoLeaf.Table namespace after loading the plugin
// Themes façade removed (RM-P0b) — dead per-layer theming API (no map effect in MapLibre).
// The live theme engine stays internal (ThemeApplierCore + GeoLeaf.UI light/dark toggle).
// Text search engine removed (dead module, 0 consumer, never wired). BREAKING:
// the named `Search` export was dropped; text search lives in the in-core filter capability.
export { Legend } from "./api/geoleaf.legend.js";
// `Filters` removed — BREAKING on this root entry. It exposed one
// method, `filterRouteList`, with zero caller in the repo, under a name one letter from
// `Filter` (a different object, 8 members). No replacement: list filtering is the
// integrator's own `Array.filter`.
export { Permalink } from "./api/geoleaf.permalink.js";
export { Share } from "./api/geoleaf.share.js";
export { Notifications } from "./capabilities/toast-renderer/public-api.js";
export { PWA } from "./api/geoleaf.pwa.js";

export default typeof window !== "undefined"
    ? (window as unknown as Record<string, unknown>)["GeoLeaf"]
    : {};
