/*!
 * @geoleaf-plugins/navigation — Entry point
 * Mounts GeoLeaf.Navigation on the global namespace and registers the plugin.
 * ESM only — no UMD, no CommonJS. Loaded AFTER @geoleaf/core, BEFORE GeoLeaf.boot().
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import "./css/geoleaf-navigation.css";

import { buildPublicApi } from "./public-api.js";

// The guidance contract IS the public type surface of this package: what a route is handed
// to, what a progress sample looks like, what unsubscribing returns. Re-exported from the
// entry because that is what `exports["."].types` points at. Declarations are erased at
// build, so this costs no byte — and it is also what makes the dependency on
// `@geoleaf-plugins/routing` REAL rather than declared: the contract types against its model.
export type { GuidanceRuntime, GuidanceListener } from "./guidance-contract.js";

// Same reasoning for reaching the namespace: `getGeoLeaf()` replaces the
// `const _g = globalThis as any` accessor that the 13 plugins each re-declared their own
// way (STRUCT S2, F6). ⚠️ This file carried that pattern until 31/07/2026, and it was
// invisible to BOTH guards — `packages/_plugin-template/` sits in ESLint's `ignores`
// (placeholder tokens are not valid TS) and outside the `workspaces` globs that
// `count-any.cjs` walks. Every plugin ever scaffolded was therefore born with the two
// `as any` that `@geoleaf/host-runtime` exists to remove. Do not reintroduce them.
import { getGeoLeaf, registerPluginModule } from "@geoleaf/host-runtime";

import langFr from "./lang/lang-fr.js";
import langEn from "./lang/lang-en.js";

// Replaced at build time by rollup/replace — must be a plain string literal.
const _VERSION = "__GEOLEAF_VERSION__";

// 1 — Register i18n dictionaries FIRST so labels resolve during boot.
getGeoLeaf()?.I18n?.registerDict?.("navigation", {
    fr: langFr,
    en: langEn,
});

/** The API this plugin mounts as `GeoLeaf.Navigation`. */
export type NavigationApi = ReturnType<typeof buildPublicApi>;

// The core declares `GeoLeaf.Navigation` and cannot type it: it never imports a plugin. The type
// comes from here, through the registry the core reads — for whoever installs this package.
declare global {
    interface GeoLeafPluginApis {
        Navigation: NavigationApi;
    }
}

// 1 bis — `requires: ["routing"]`, HELD rather than declared.
//
// The registry stores `requires` and applies it nowhere: loaded on a bundle without `routing`,
// this plugin mounted `GeoLeaf.Navigation`, said nothing, and its guidance had no route to
// follow — ever. It refuses here, before mounting anything, and names the dependency; the
// throw rejects `plugins.load("navigation")`, which the core reports as a failed load.
// ⚠️ `=== false`, not `!== true`: a host without `isLoaded` cannot answer, and is not refused.
if (getGeoLeaf()?.plugins?.isLoaded?.("routing") === false) {
    throw new Error(
        "[navigation] requires the routing plugin — load @geoleaf-plugins/routing before it"
    );
}

// 2 — Mount the GeoLeaf.Navigation namespace.
//
// ⚠️ The assignment must read `.<Namespace> = buildPublicApi()` LITERALLY, on ONE
// statement. Two guards read this file as TEXT and match a regex — `plugin-namespace-
// declared.guard` wants `/\.([A-Z][A-Za-z0-9]*)\s*=\s*buildPublicApi\s*\(/`. The
// `const _api = buildPublicApi(); _host.X = _api;` form that `create-plugin.cjs` emits
// is matched by NEITHER, so a plugin scaffolded and committed as-is fails a gate that
// never names the scaffold as the cause.
const _host = getGeoLeaf();
if (_host) {
    _host.Navigation = buildPublicApi();
}

// 3 — Register in the plugin registry.
getGeoLeaf()?.plugins?.register?.("navigation", {
    version: _VERSION,
    requires: ["routing"],
    optional: [],
    label: "Navigation (guidage temps réel)",
    healthCheck: () => typeof getGeoLeaf()?.Navigation === "object",
});

// 4 — The teardown, and NO toolbar slot.
//
// 🛑 The slot is gone, with `modules.navigation.showButton`: it never opened anything — its
// listener called `Navigation.open()`, which this namespace has never had. Guidance is entered
// from the route, in `routing`'s panel, where the button exists only when there is a line to
// follow.
//
// 🛑 A TEARDOWN ON BOTH PATHS. A guidance session did not end with the application: measured in
// a browser, after an `unmount()` the banner stayed in the page, the position watch and the screen
// wake lock stayed held, and the session kept reading fixes for a map that was gone. `stop()` is
// read off the namespace: it is idempotent, and a no-op when no session runs. A module registered
// after `init()` is torn down by a core ≥ 3.14.2.
registerPluginModule({
    id: "navigation",
    destroy: () => (getGeoLeaf()?.Navigation as { stop?: () => void } | undefined)?.stop?.(),
});
