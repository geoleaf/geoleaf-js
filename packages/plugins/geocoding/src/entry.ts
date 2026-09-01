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
import { getGeoLeaf } from "@geoleaf/host-runtime";
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

// 5 — Register the mobile toolbar slot. Only a mobileIcon is declared: on desktop
// (≥ 769px) the search bar is always visible, so the pill toolbar button is hidden
// via CSS (geoleaf-geocoding.css @media min-width:769px) rather than registered as
// a desktopTabButton. The button thus appears only on tablet/mobile (≤ 768px),
// where it toggles the search bar — mirroring the historical core "search" button.
// The slot is declared only on the EAGER path — before `boot()`, where this call is the ONLY
// declaration (an integrator has no `init.js`). After `init()` the toolbar is already built:
// the registration would be stored, never drawn, and would log a warning whose intended reader
// has already done what it recommends elsewhere. `!== true` so a host without `isInitialized`
// still gets its slot.
if (getGeoLeaf()?.registry?.isInitialized?.() !== true) {
    getGeoLeaf()?.registry?.register?.({
        id: "geocoding",
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
}

// 6 — Wire the action event listener: reveal the pill on the "geocoding" action.
if (typeof document !== "undefined") {
    document.addEventListener("geoleaf:toolbar:action", (e: Event) => {
        const ce = e as CustomEvent<GeoLeafRawEventMap["geoleaf:toolbar:action"]>;
        if (ce.detail?.action === "geocoding") {
            GeocodingRegistry.open(ce.detail.element ?? null);
        }
    });
}
