/*!
 * @geoleaf-plugins/geocoding — Entry point
 * Mounts GeoLeaf.Geocoding on the global namespace and registers the plugin.
 * ESM only — no UMD, no CommonJS. Loaded AFTER @geoleaf/core, BEFORE GeoLeaf.boot().
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import "./css/geoleaf-geocoding.css";

import { buildPublicApi } from "./public-api.js";
import { GeocodingRegistry } from "./registry.js";

import langFr from "./lang/lang-fr.js";
import langEn from "./lang/lang-en.js";
import langEs from "./lang/lang-es.js";
import langPt from "./lang/lang-pt.js";
import langIt from "./lang/lang-it.js";
import langDe from "./lang/lang-de.js";

// Toolbar seam shape imported from the published contract instead of a local
// re-declaration: the 7 plugins carried 4 divergent shapes of it.
import type { GeoLeafRawEventMap } from "@geoleaf/core";
// Same for namespace access: `getGeoLeaf()` replaces the
// `interface GeoLeafHost` + `globalThis as unknown as …` pair the 13 plugins
// each re-declared their own way.
import { getGeoLeaf, registerPluginModule } from "@geoleaf/host-runtime";
// Replaced at build time by rollup/replace — must be a plain string literal.
const _VERSION = "__GEOLEAF_VERSION__";

// 1 — Register i18n dictionaries FIRST so labels resolve during boot.
// Keys are FLAT and dotted ("geocoding.toolbar.button"): `getLabel` indexes the
// merged table directly and never splits on ".", so a nested dictionary silently
// resolves to nothing (see i18n.ts `_rebuildPluginFlat`).
// No "al" entry is needed: the core aliases al → de, and `_rebuildPluginFlat`
// resolves the active code to "de" for both.
getGeoLeaf()?.I18n?.registerDict?.("geocoding", {
    fr: langFr,
    en: langEn,
    es: langEs,
    pt: langPt,
    it: langIt,
    de: langDe,
});

/** The API this plugin mounts as `GeoLeaf.Geocoding`. */
export type GeocodingApi = ReturnType<typeof buildPublicApi>;

// The core declares `GeoLeaf.Geocoding` and cannot type it: it never imports a plugin. The type
// comes from here, through the registry the core reads — for whoever installs this package.
declare global {
    interface GeoLeafPluginApis {
        Geocoding: GeocodingApi;
    }
}

// 2 — Mount the GeoLeaf.Geocoding namespace.
const _host = getGeoLeaf();
if (_host) {
    _host.Geocoding = buildPublicApi();
}

// 3 — Subscribe to geoleaf:map:ready so the control mounts when the map is ready.
GeocodingRegistry.init();

// 4 — Register in the plugin registry.
getGeoLeaf()?.plugins?.register?.("geocoding", {
    version: _VERSION,
    requires: [],
    optional: [],
    label: "Geocoding (recherche d'adresse)",
    healthCheck: () => typeof getGeoLeaf()?.Geocoding === "object",
});

// Toolbar icon (22 px, stroke currentColor) — sanitised by core DOMSecurity.
const _ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"' +
    ' stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/></svg>';

// 5 — Register the module: the teardown, and the mobile toolbar slot. Only a mobileIcon is
// declared: on desktop (≥ 769px) the search bar is always visible, so the pill toolbar button is
// hidden via CSS (geoleaf-geocoding.css @media min-width:769px) rather than registered as
// a desktopTabButton. The button thus appears only on tablet/mobile (≤ 768px),
// where it toggles the search bar — mirroring the historical core "search" button.
//
// The TEARDOWN: `GeoLeaf.mount()`'s unmount tears the core's module registry down, and this
// module's `destroy()` is what takes the search bar off the page — it stayed there after an
// unmount. The control mounts again on the next `geoleaf:map:ready`, which
// `GeocodingRegistry.init()` hears for good; the module's `init()` has nothing to do.
//
// ⚠️ Registered on BOTH loading paths since 1.1.3. It was registered before the boot only: a
// plugin loaded once the application ran registered nothing, and its control stayed in the page
// of an unmounted application (measured in a real browser). The SLOT alone is path-dependent:
// it is declared on the EAGER path — before `boot()`, where this call is the ONLY declaration
// (an integrator has no `init.js`) — and left to the lazy declaration after it, the toolbar being
// built by then. `registerPluginModule` tells the two apart (`@geoleaf/host-runtime`).
registerPluginModule({
    id: "geocoding",
    destroy: () => GeocodingRegistry.destroy(),
    ui: {
        mobileIcon: {
            icon: _ICON,
            labelKey: "geocoding.toolbar.button",
            profileKey: "modules.geocoding.showButton",
            legacyProfileKey: "ui.showGeocoding",
            requiresPlugin: "geocoding",
            action: "geocoding",
        },
    },
});

// 6 — Wire the action event listener: reveal the pill on the "geocoding" action.
if (typeof document !== "undefined") {
    document.addEventListener("geoleaf:toolbar:action", (e: Event) => {
        const ce = e as CustomEvent<GeoLeafRawEventMap["geoleaf:toolbar:action"]>;
        if (ce.detail?.action === "geocoding") {
            GeocodingRegistry.open(ce.detail.element ?? null);
        }
    });
}
