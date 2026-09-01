/*!
 * __PLUGIN_PKG__ — Entry point
 * Mounts GeoLeaf.__PLUGIN_NAMESPACE__ on the global namespace and registers the plugin.
 * ESM only — no UMD, no CommonJS. Loaded AFTER @geoleaf/core, BEFORE GeoLeaf.boot().
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
/* <ui> */
import "./css/geoleaf-__PLUGIN_NAME__.css";
/* </ui> */
import { buildPublicApi } from "./public-api.js";
/* <ui> */
// The toolbar seam is the canonical extension path, and it is TYPED — import the shape from
// the core instead of re-declaring `{ action: string }` inline. Before API publique S3 this
// type was reachable by no channel, so every plugin guessed it, and the guesses diverged
// (`action` vs `action?`, `element?: Element` vs `HTMLElement` vs omitted).
import type { GeoLeafRawEventMap } from "@geoleaf/core";
/* </ui> */
// Same reasoning for reaching the namespace: `getGeoLeaf()` replaces the
// `const _g = globalThis as any` accessor that the 13 plugins each re-declared their own
// way (STRUCT S2, F6). ⚠️ This file carried that pattern until 31/07/2026, and it was
// invisible to BOTH guards — `packages/_plugin-template/` sits in ESLint's `ignores`
// (placeholder tokens are not valid TS) and outside the `workspaces` globs that
// `count-any.cjs` walks. Every plugin ever scaffolded was therefore born with the two
// `as any` that `@geoleaf/host-runtime` exists to remove. Do not reintroduce them.
import { getGeoLeaf } from "@geoleaf/host-runtime";
/* <i18n> */
import langFr from "./lang/lang-fr.js";
import langEn from "./lang/lang-en.js";
/* </i18n> */

// Replaced at build time by rollup/replace — must be a plain string literal.
const _VERSION = "__GEOLEAF_VERSION__";

/* <i18n> */
// 1 — Register i18n dictionaries FIRST so labels resolve during boot.
getGeoLeaf()?.I18n?.registerDict?.("__PLUGIN_NAME__", {
    fr: langFr,
    en: langEn,
});
/* </i18n> */

// 2 — Mount the GeoLeaf.__PLUGIN_NAMESPACE__ namespace. The façade is kept in a local:
// reading it back off the namespace yields `unknown` (the trailing `[key: string]: unknown`
// of `GeoLeafHost`), and asserting it back would trade the `as any` for an `as`.
const _api = buildPublicApi();
const _host = getGeoLeaf();
if (_host) {
    _host.__PLUGIN_NAMESPACE__ = _api;
}

// 3 — Register in the plugin registry.
getGeoLeaf()?.plugins?.register?.("__PLUGIN_NAME__", {
    version: _VERSION,
    requires: [],
    optional: [],
    label: "__PLUGIN_NAME__",
    healthCheck: () => typeof getGeoLeaf()?.__PLUGIN_NAMESPACE__ === "object",
});

/* <ui> */
// Toolbar icon (22 px, stroke currentColor) — sanitised by core DOMSecurity.
const _ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"' +
    ' stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/></svg>';

// 4 & 5 — Register toolbar slot + wire the action event listener.
//
// ⚠️ `profileKey` MUST sit under `modules.<id>.*` — the SAME namespace `config.ts` reads.
// This file wrote `ui.show__PLUGIN_NAMESPACE__` until 08/08/2026, and the two tokens do not
// even substitute alike: `__PLUGIN_NAMESPACE__` is PascalCase, `__PLUGIN_NAME__` kebab-case
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
        id: "__PLUGIN_NAME__",
        ui: {
            mobileIcon: {
                icon: _ICON,
                labelKey: "__PLUGIN_NAME__.toolbar.button",
                profileKey: "modules.__PLUGIN_NAME__.showButton",
                requiresPlugin: "__PLUGIN_NAME__",
                action: "__PLUGIN_NAME__",
            },
            desktopTabButton: {
                icon: _ICON,
                labelKey: "__PLUGIN_NAME__.toolbar.button",
                profileKey: "modules.__PLUGIN_NAME__.showButton",
                requiresPlugin: "__PLUGIN_NAME__",
                action: "__PLUGIN_NAME__",
            },
        },
    });
}

if (typeof document !== "undefined") {
    document.addEventListener("geoleaf:toolbar:action", (e: Event) => {
        const ce = e as CustomEvent<GeoLeafRawEventMap["geoleaf:toolbar:action"]>;
        if (ce.detail?.action === "__PLUGIN_NAME__") {
            _api.open();
        }
    });
}
/* </ui> */
