/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 *
 * @description
 * ESM orchestrator — Phase 9 refactor.
 *
 * This runtime initialization module delegates to domain-specific sub-modules,
 * each of which imports its own dependencies and appends to `_g.GeoLeaf`.
 * It is imported as a **side-effect** by `bundle-esm-entry.ts` (ESM)
 * to populate `window.GeoLeaf.*`.
 *
 * Guaranteed execution order (ESM depth-first resolution):
 *   `globals.core` → `globals.config` → `globals.geojson` →
 *   `globals.ui` → `globals.storage` → `globals.api`
 *
 * History:
 *   - `_namespace.js` removed in Phase 8 — all modules use pure Pattern A
 *   - `globals.js` split into domain sub-files in Phase 9 (P3-DEAD-05)
 *
 * @see globals.core for runtime core (log, errors, utils)
 * @see globals.api for public facades and PluginRegistry
 * @see docs/architecture/BOOT_SEQUENCE.md
 */

// B1+B2  runtime core: log, errors, constants, security, utils (MUST be first)
// ── Kernel stylesheet (S6) ───────────────────────────────────────────────────
// The kernel's CSS enters the module graph HERE, at the root of the kernel's side effects, so any
// entry — the shipped one, or a consumer's ~25-line custom one — gets the shell styled without
// having to know about it. Capability CSS does NOT come through here: each capability imports its
// own from its `install.ts`, which is what lets a bundle drop a capability's styles along with its
// code. See src/css/geoleaf-main.css for the @layer cascade order.
import "../css/geoleaf-main.css";

import "./globals.core.js";
// B3+B4  helpers, validators, renderers, data, loaders, map, config
import "./globals.config.js";
// B5  geojson, route
import "./globals.geojson.js";
// B6+B7+B9  labels, legend, layer-manager, themes, ui
import "./globals.ui.js";
// B8  storage, cache, IndexedDB
import "./globals.storage.js";
// B11  facades geoleaf.*.js + api/ + PluginRegistry (MUST be last)
import "./globals.api.js";

// Re-export _g for the consumers that import it directly.
// Narrow structural host: exposes the (boot-populated) `GeoLeaf` namespace plus
// the `location` accessor read by `app/app-namespace.ts`. `GeoLeaf` is non-optional
// here — by the time consumers read `_g.GeoLeaf` the boot chain above has run.
interface GeoLeafGlobalHost {
    GeoLeaf: GeoLeafGlobal;
    location: Location;
}
const _g: GeoLeafGlobalHost = (typeof globalThis !== "undefined"
    ? globalThis
    : typeof window !== "undefined"
      ? window
      : {}) as unknown as GeoLeafGlobalHost;

export { _g };
