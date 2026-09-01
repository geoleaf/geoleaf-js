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

// The toolbar seam is the canonical extension path, and it is TYPED — import the shape from
// the core instead of re-declaring `{ action: string }` inline. Before API publique S3 this
// type was reachable by no channel, so every plugin guessed it, and the guesses diverged
// (`action` vs `action?`, `element?: Element` vs `HTMLElement` vs omitted).
import type { GeoLeafRawEventMap } from "@geoleaf/core";

// Same reasoning for reaching the namespace: `getGeoLeaf()` replaces the
// `const _g = globalThis as any` accessor that the 13 plugins each re-declared their own
// way (STRUCT S2, F6). ⚠️ This file carried that pattern until 31/07/2026, and it was
// invisible to BOTH guards — `packages/_plugin-template/` sits in ESLint's `ignores`
// (placeholder tokens are not valid TS) and outside the `workspaces` globs that
// `count-any.cjs` walks. Every plugin ever scaffolded was therefore born with the two
// `as any` that `@geoleaf/host-runtime` exists to remove. Do not reintroduce them.
import { getGeoLeaf } from "@geoleaf/host-runtime";

import langFr from "./lang/lang-fr.js";
import langEn from "./lang/lang-en.js";

// Replaced at build time by rollup/replace — must be a plain string literal.
const _VERSION = "__GEOLEAF_VERSION__";

// 1 — Register i18n dictionaries FIRST so labels resolve during boot.
getGeoLeaf()?.I18n?.registerDict?.("navigation", {
    fr: langFr,
    en: langEn,
});

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

// Toolbar icon (22 px, stroke currentColor) — sanitised by core DOMSecurity.
const _ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"' +
    ' stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/></svg>';

// 4 & 5 — Register toolbar slot + wire the action event listener.
//
// ⚠️ `profileKey` MUST sit under `modules.<id>.*` — the SAME namespace `config.ts` reads.
// This file wrote `ui.showNavigation` until 08/08/2026, and the two tokens do not
// even substitute alike: `Navigation` is PascalCase, `navigation` kebab-case
// (`create-plugin.cjs`). A plugin scaffolded as `mon-plugin` therefore read its config at
// `modules.mon-plugin` while its button obeyed `ui.showMonPlugin` — two keys, two casings,
// two branches of the profile. Filling the profile the way `config.ts` documents left the
// button INVISIBLE, with nothing in the output to say why. `selfValidate()` now rejects any
// `profileKey` outside `modules.<id>.`. Reference shape: `packages/plugins/table/src/entry.ts`.
// The slot is declared only on the EAGER path — when the integrator loads this bundle before
// `GeoLeaf.boot()`, as the package README prescribes. There is no `init.js` on that path, so
// THIS call is the ONLY declaration of the slot and it is honoured.
//
// After `init()` — the LAZY path, where a host declares the slot itself with
// `registerLazyForAction()` and loads the bundle on demand — the toolbar is already built: the
// registration would be stored, never drawn, and would log a warning whose intended reader has
// already done what it recommends elsewhere.
//
// ⚠️ `!== true`, not `=== false`: a host without `isInitialized` yields `undefined`, and the
// slot IS declared. Failing open is the right way round — a spurious warning costs a console
// line, a missing declaration costs the button.
if (getGeoLeaf()?.registry?.isInitialized?.() !== true) {
    getGeoLeaf()?.registry?.register?.({
        id: "navigation",
        ui: {
            mobileIcon: {
                icon: _ICON,
                labelKey: "navigation.toolbar.button",
                profileKey: "modules.navigation.showButton",
                requiresPlugin: "navigation",
                action: "navigation",
            },
            desktopTabButton: {
                icon: _ICON,
                labelKey: "navigation.toolbar.button",
                profileKey: "modules.navigation.showButton",
                requiresPlugin: "navigation",
                action: "navigation",
            },
        },
    });
}

if (typeof document !== "undefined") {
    document.addEventListener("geoleaf:toolbar:action", (e: Event) => {
        const ce = e as CustomEvent<GeoLeafRawEventMap["geoleaf:toolbar:action"]>;
        if (ce.detail?.action !== "navigation") return;
        // Read the surface back OFF the namespace, never from a local — the local is what
        // the scaffold used, and removing it is what makes the namespace mount match the
        // literal form the guards require. Same shape as the rest of the fleet.
        // The optional call is not defensive padding: the panel lands with the feature, and
        // until then this listener must be a no-op rather than a crash.
        (getGeoLeaf()?.Navigation as { open?: () => void } | undefined)?.open?.();
    });
}
