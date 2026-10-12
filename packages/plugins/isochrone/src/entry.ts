/*!
 * @geoleaf-plugins/isochrone — Entry point
 * Mounts GeoLeaf.Isochrone on the global namespace and registers the plugin.
 * ESM only — no UMD, no CommonJS. Loaded on demand by a host, or before GeoLeaf.boot().
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import "./css/geoleaf-isochrone.css";

import { buildPublicApi, type IsochronePublicApi } from "./public-api.js";
import { closeIsochrone, openIsochrone } from "./isochrone-api.js";
// Side effect: registers the engine this package ships with. An integrator plugging their own
// goes through `GeoLeaf.Isochrone.registerProvider()`.
import "./providers/builtins.js";

// The toolbar seam is typed by the core — the shape is imported rather than re-declared inline.
import type { GeoLeafRawEventMap } from "@geoleaf/core";

import { getGeoLeaf, registerPluginModule } from "@geoleaf/host-runtime";

import langFr from "./lang/lang-fr.js";
import langEn from "./lang/lang-en.js";

// Replaced at build time by rollup/replace — must be a plain string literal.
const _VERSION = "__GEOLEAF_VERSION__";

// 1 — Register i18n dictionaries FIRST so labels resolve during boot.
getGeoLeaf()?.I18n?.registerDict?.("isochrone", {
    fr: langFr,
    en: langEn,
});

/** The API this plugin mounts as `GeoLeaf.Isochrone`. */
export type IsochroneApi = IsochronePublicApi;

// The core declares `GeoLeaf.Isochrone` and cannot type it: it never imports a plugin. The type
// comes from here, through the registry the core reads — for whoever installs this package.
declare global {
    interface GeoLeafPluginApis {
        Isochrone: IsochroneApi;
    }
}

// 2 — Mount the GeoLeaf.Isochrone namespace.
//
// ⚠️ The assignment must read `.<Namespace> = buildPublicApi()` LITERALLY, on ONE statement.
// Two guards of the core read this file as TEXT and match that shape —
// `plugin-namespace-declared.guard.test.js` and `doc-plugin-manifest.guard.test.js`. Keeping the
// façade in a local and assigning the local is matched by NEITHER: the plugin then reads as one
// that mounts nothing. What needs the behaviour below reaches the domain module directly.
const _host = getGeoLeaf();
if (_host) {
    _host.Isochrone = buildPublicApi();
}

// 3 — Register in the plugin registry.
getGeoLeaf()?.plugins?.register?.("isochrone", {
    version: _VERSION,
    requires: [],
    optional: [],
    label: "GeoLeaf Isochrone",
    healthCheck: () => typeof getGeoLeaf()?.Isochrone === "object",
});

// 4 — Extension surface: the shapes a host needs to write its own provider, or to hold what
// this plugin answers. Types only — omitting them would hand an integrator a `TS2305` that
// nothing on this side would ever show.
export type {
    IIsochroneProvider,
    IsochroneContour,
    IsochroneFailure,
    IsochroneGeometry,
    IsochroneOutcome,
    IsochronePosition,
    IsochroneProviderFactory,
    IsochroneRequest,
    ProviderLimits,
    ProviderOptions,
    RuntimeOverrides,
    TravelMode,
} from "./model.js";

// Toolbar icon (22 px, stroke currentColor) — sanitised by core DOMSecurity.
const _ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"' +
    ' stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/></svg>';

// 5 — Register the module: the teardown, and the toolbar slot.
//
// The TEARDOWN is registered on both loading paths. `GeoLeaf.mount()` unmounts the application by
// destroying the core's module registry, and this module is how that reaches what the plugin
// built in the page.
//
// The SLOT only counts on the EAGER path, and `registerPluginModule` is what tells the two apart:
// loaded before `GeoLeaf.boot()`, this call is the ONLY declaration of the button. Loaded on
// demand, the toolbar is already built — the button then belongs to the host's own
// `registerLazyForAction()` declaration, which the core draws again at every boot.
//
// `profileKey` sits under `modules.isochrone.*` — the SAME branch `config.ts` reads (INV-CONFIG).
registerPluginModule({
    id: "isochrone",
    destroy: () => closeIsochrone(),
    ui: {
        mobileIcon: {
            icon: _ICON,
            labelKey: "isochrone.toolbar.button",
            profileKey: "modules.isochrone.showButton",
            requiresPlugin: "isochrone",
            action: "isochrone",
        },
        desktopTabButton: {
            icon: _ICON,
            labelKey: "isochrone.toolbar.button",
            profileKey: "modules.isochrone.showButton",
            requiresPlugin: "isochrone",
            action: "isochrone",
        },
    },
});

// 6 — Toolbar action: the button opens the plugin.
//
// ⚠️ Wired here, at load, and not on a boot signal: a plugin loaded on demand would subscribe
// after the signal had fired.
if (typeof document !== "undefined") {
    document.addEventListener("geoleaf:toolbar:action", (e: Event) => {
        const ce = e as CustomEvent<GeoLeafRawEventMap["geoleaf:toolbar:action"]>;
        if (ce.detail?.action === "isochrone") {
            openIsochrone();
        }
    });
}
