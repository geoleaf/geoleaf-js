/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 *
 * @description
 * UMD/ESM bridge — B1 + B2 — runtime core initialization.
 *
 * This runtime initialization module registers the foundational GeoLeaf services
 * on `globalThis.GeoLeaf`. It is imported as a side-effect by `globals.ts` and
 * must be the **first** sub-module executed.
 *
 * Registers:
 *   - **B1** — `Log`, `Errors`, `CONSTANTS`, `Security`, `CSRFToken`
 *   - **B2** — `Utils` (DOM, events, fetch, map helpers, object utils,
 *     performance, scale, timers)
 *
 * Also sets `_g.GeoLeaf._version` from the Rollup-injected `__GEOLEAF_VERSION__`
 * constant, falling back to the shared {@link VERSION_FALLBACK} in development mode.
 *
 * The imperative body lives in {@link setupSecurity} (B1) and {@link setupCoreMap} (B2), both
 * called at the bottom of this file — PHASE A: the facades are posted at import, in ESM order.
 * Neither takes a parameter (no map adapter, no config), so there is nothing for the registry
 * to order. `SecurityModule` is gone (S6 Lot 6): it was a wrapper with an empty init()/destroy()
 * around a facade-only subsystem. `CoreMapModule` remains — it owns the real runtime (map
 * creation), which does need the adapter and the merged config.
 *
 * @see globals for the orchestrator and import order
 * @see docs/architecture/BOOT_SEQUENCE.md
 */

// B1 : log, errors, constants, security
import { Log } from "../utils/log/index.js";
import { Errors } from "../utils/errors/errors.js";
import { CONSTANTS, VERSION_FALLBACK } from "../utils/constants/constants.js";
import { Security } from "../kernel/security/index.js";

// B2 : utils
// The `GeoLeaf.Utils` members themselves are composed by `applyUtilsNamespace` (S14);
// what remains imported here is only what this module mounts OUTSIDE that namespace —
// the top-level shortcuts (`_gl.DOMSecurity`, `_gl.fetch/get/post`, `_gl.mark/measure`…).
import { applyUtilsNamespace } from "../utils/general/utils-namespace.js";
import { DOMSecurity } from "../kernel/security/dom-security.js";
import { notifyPrimitive } from "../utils/notify/notify.primitive.js";
import { FetchHelper } from "../utils/general/fetch-helper.js";
import { getPerformanceProfiler } from "../utils/performance/performance-profiler.js";
import { registerDict, getLabel, t, getActiveLang } from "../utils/i18n/i18n.js";
import { ensureGeoLeaf } from "../utils/general/geoleaf-global.js";

declare const __GEOLEAF_VERSION__: string | undefined;

/**
 * B1 — foundational services: version flag, `Log`, `Errors`, `CONSTANTS`,
 * `Security`, `CSRFToken`. Re-callable; bound to the `security` module lifecycle.
 */
export function setupSecurity(): void {
    const _gl = ensureGeoLeaf();
    // Version injectable at build time — fallback for dev without build step
    _gl._version =
        typeof __GEOLEAF_VERSION__ !== "undefined" ? __GEOLEAF_VERSION__ : VERSION_FALLBACK;

    // -- B1 assignations ------------------------------------------------------
    _gl.Log = Log;
    _gl.Errors = Errors;
    _gl.CONSTANTS = CONSTANTS;
    if (!_gl.Security) _gl.Security = {};
    const security = _gl.Security as Record<string, unknown>;
    // `CSRFToken` used to be grafted here, one line below this assign. The barrel now
    // carries it (backlog B.16), so `security/index.ts` is the single definition of the
    // namespace instead of "the barrel, plus whatever the boot bolts on".
    Object.assign(security, Security);
}

/**
 * B2 — runtime utilities exposed under `GeoLeaf.Utils` plus the top-level
 * shortcuts (fetch/get/post, map helpers, animation, perf, lazy, events, i18n).
 * Re-callable; bound to the `core-map` module lifecycle.
 */
export function setupCoreMap(): void {
    const _gl = ensureGeoLeaf();
    // -- B2 assignations ------------------------------------------------------
    if (!_gl.Utils) _gl.Utils = {};
    const utils = _gl.Utils as Record<string, unknown>;
    // KERNEL S14 — the composition moved to `utils/general/utils-namespace.ts` so that
    // `kernel-exports.ts` can build the SAME shape without importing this boot-ordered
    // module. Applied in place (not replaced) because `setupCoreMap()` is re-callable and
    // a caller may already hold a reference to `GeoLeaf.Utils`.
    applyUtilsNamespace(utils);
    _gl.DOMSecurity = DOMSecurity;
    // FetchHelper shortcuts
    _gl.fetch = FetchHelper.fetch.bind(FetchHelper);
    _gl.get = FetchHelper.get.bind(FetchHelper);
    _gl.post = FetchHelper.post.bind(FetchHelper);
    // ⚠️ S13 — `GeoLeaf.ensureMap` / `requireMap` / `hasMap` and `Utils.MapHelpers`
    // were removed here, with `utils/general/map-helpers.ts`. They had 0 callers in the
    // whole monorepo (plugins, demos, index.html, init.js, e2e, profiles), 0 entry in
    // global.d.ts or the then-existing root index.d.ts (removed at S6), and 0
    // documentation. Worse, their duck-type required
    // `setView` — a Leaflet API absent from MapLibre — so `GeoLeaf.ensureMap(nativeMap)`
    // returned null: it read as "is this a map?" while asking "is this our adapter?".
    // The single surviving resolver is `Utils.ensureMap` (general-utils), the one that
    // is documented, ESM-exported and actually called; it gained the validation this
    // pair was carrying, minus the Leaflet requirement.
    // PerformanceProfiler shortcuts
    _gl.mark = (name: string) => getPerformanceProfiler().mark(name);
    _gl.measure = (name: string, s: string, e?: string) =>
        getPerformanceProfiler().measure(name, s, e);
    _gl.getPerformanceReport = () => getPerformanceProfiler().generateReport();
    _gl.establishBaseline = () => getPerformanceProfiler().establishBaseline();
    // I18n namespace — registerDict for plugins, getLabel for consumers, and the
    // `t(key, fallback)` seam consumed by feature-info / the field renderer (RM-P2 #7).
    _gl.I18n = { registerDict, getLabel, t, getActiveLang };
    // Notify primitive — stable `GeoLeaf.notify()` anchor available immediately at boot
    _gl.notify = notifyPrimitive.notify.bind(notifyPrimitive);
}

// ── PHASE A — the facades, at import, in ESM order ───────────────────────────────────────────
//
// Direct calls (S6 Lot 5): the `setModuleSetup`/`runModuleSetup` indirection is gone. It existed
// to let `ICoreModule.init()` run these setups at registry time, with a per-id guard to stop the
// import-time run and the init()-time run from firing twice. Since Lot 2 posts every facade here
// and Lot 4 removed the init()-time calls, the registry no longer runs setups at all — the
// registry orders the RUNTIME (map, DOM, layers), not the facades.
//
// Neither setup reads an (adapter, config) param — none of the seven kernel setups do — so there
// is nothing for the registry to order. And these anchors MUST exist at bundle-import time:
// plugin scripts (`<script type="module">`, loaded before GeoLeaf.boot()) call
// GeoLeaf.I18n.registerDict() / GeoLeaf.notify() at their own top-level. ESM guarantees this
// module is evaluated exactly once, so no guard is needed — the guard only ever existed to
// reconcile two call sites that no longer compete.
setupSecurity();
setupCoreMap();
