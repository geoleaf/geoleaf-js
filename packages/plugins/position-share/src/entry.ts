/*!
 * @geoleaf-plugins/position-share — Entry point
 * Mounts GeoLeaf.PositionShare on the global namespace and registers the plugin.
 * ESM only — no UMD, no CommonJS. Loaded AFTER @geoleaf/core, BEFORE GeoLeaf.boot().
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import "./css/geoleaf-position-share.css";

import { buildPublicApi } from "./public-api.js";
import { destroyLifecycle, initLifecycle } from "./lifecycle.js";

// `getGeoLeaf()` replaces the
// `const _g = globalThis as any` accessor that the 13 plugins each re-declared their own
// way (STRUCT S2, F6). This file carried that pattern until 31/07/2026, and it was
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
getGeoLeaf()?.I18n?.registerDict?.("position-share", {
    fr: langFr,
    en: langEn,
});

/** The API this plugin mounts as `GeoLeaf.PositionShare`. */
export type PositionShareApi = ReturnType<typeof buildPublicApi>;

// The core declares `GeoLeaf.PositionShare` and cannot type it: it never imports a plugin. The type
// comes from here, through the registry the core reads — for whoever installs this package.
declare global {
    interface GeoLeafPluginApis {
        PositionShare: PositionShareApi;
    }
}

// 2 — Mount the GeoLeaf.PositionShare namespace.
//
// The assignment must read `.<Namespace> = buildPublicApi()` LITERALLY. Two guards match
// that shape by regex — `doc-plugin-manifest.guard.test.js` and
// `plugin-namespace-declared.guard.test.js` — and neither recognises the
// `const _api = buildPublicApi(); _host.X = _api;` form the scaffold emitted here. Keeping
// the façade in a local avoids one `as` at the listener below, but it costs the plugin BOTH
// guards, which is the worse trade: the listener re-reads through a narrow assertion instead,
// exactly as `packages/plugins/table/src/entry.ts` does.
const _host = getGeoLeaf();
if (_host) {
    _host.PositionShare = buildPublicApi();
}

// 3 — Register in the plugin registry.
getGeoLeaf()?.plugins?.register?.("position-share", {
    version: _VERSION,
    requires: [],
    optional: ["realtime-layer", "websocket"],
    label: "GeoLeaf Position Share",
    healthCheck: () => typeof getGeoLeaf()?.PositionShare === "object",
});

// 4 — Extension surface. `registerTransport` travels as a VALUE, the shapes as types: a
// consumer writing its own transport needs both, and omitting the type re-exports would hand
// them a `TS2305` that nothing on this side would ever show.
export { registerTransport } from "./transports/registry.js";
export type { PositionTransportFactory } from "./transports/registry.js";
export type { IPositionTransport, PositionPayload } from "./transports/contract.js";

// Toolbar icon (22 px, stroke currentColor) — sanitised by core DOMSecurity.
const _ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"' +
    ' stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/></svg>';

// 5 — Register the module: the teardown, and the toolbar slot (mobile icon + desktop tab button).
//
// The TEARDOWN is registered on both loading paths. `GeoLeaf.mount()` unmounts the application by
// destroying the core's module registry, and this module is how that reaches the emission loop —
// an interval of this plugin, which nothing else stops. See `destroyLifecycle()`.
//
// `profileKey` MUST sit under `modules.<id>.*` — the SAME namespace `config.ts` reads.
// This file wrote `ui.showPositionShare` until 08/08/2026, and the two tokens do not
// even substitute alike: `PositionShare` is PascalCase, `position-share` kebab-case
// (`create-plugin.cjs`). A plugin scaffolded as `mon-plugin` therefore read its config at
// `modules.mon-plugin` while its button obeyed `ui.showMonPlugin` — two keys, two casings,
// two branches of the profile. Filling the profile the way `config.ts` documents left the
// button INVISIBLE, with nothing in the output to say why. `selfValidate()` now rejects any
// `profileKey` outside `modules.<id>.`. Reference shape: `packages/plugins/table/src/entry.ts`.
//
// The SLOT only counts on the EAGER path, and `registerPluginModule` is what tells the two apart
// (`@geoleaf/host-runtime`, `lifecycle-seam.ts`) — nothing else in the page does, since the
// plugin cannot know who loaded it.
//
// EAGER: the integrator loads this bundle before `GeoLeaf.boot()`, which is what this package's
// README prescribes. There is no `init.js` on that path, so THIS call is the ONLY declaration of
// the slot; it runs before `init()` and is honoured. Removing it would delete the button.
//
// LAZY: the deployable app declares the slot before boot with `registerLazyForAction()`, then
// loads the bundle on demand. The slot would then land after `init()`, which stores it and does
// not draw it — the toolbar is built once per boot. The module is registered without it: the
// button belongs to the lazy declaration, which the core draws again at every boot.
registerPluginModule({
    id: "position-share",
    destroy: () => destroyLifecycle(),
    ui: {
        mobileIcon: {
            icon: _ICON,
            labelKey: "position-share.toolbar.button",
            profileKey: "modules.position-share.showButton",
            requiresPlugin: "position-share",
            action: "position-share",
        },
        desktopTabButton: {
            icon: _ICON,
            labelKey: "position-share.toolbar.button",
            profileKey: "modules.position-share.showButton",
            requiresPlugin: "position-share",
            action: "position-share",
            // Must match the `variant: "tab"` the app's init.js declares for this same
            // slot: the two declarations drifted for 4 slots out of 8 and
            // the SLOT gate now holds them equal. The shipped rendering already comes
            // from init.js (preloaded), so this line changes nothing on screen — it
            // makes the plugin's own declaration stop contradicting it.
            variant: "tab",
        },
    },
});

// 6 — Toolbar action: the button toggles emission (PS-09).
if (typeof document !== "undefined") {
    document.addEventListener("geoleaf:toolbar:action", (e: Event) => {
        const ce = e as CustomEvent<{ action?: string }>;
        if (ce.detail?.action !== "position-share") return;
        (getGeoLeaf()?.PositionShare as { toggle?: () => boolean } | undefined)?.toggle?.();
    });
}

// 7 — Boot wiring: `auto` emission and profile-driven reception, both deferred to
// `geoleaf:app:ready` — the geolocation control does not exist in the DOM before then.
initLifecycle();
