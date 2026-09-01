/*!
 * @geoleaf-plugins/table — Entry point
 * Mounts GeoLeaf.Table on the global namespace and registers the plugin.
 * ESM only — no UMD, no CommonJS. Loaded AFTER @geoleaf/core, BEFORE GeoLeaf.boot().
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import "./css/geoleaf-table.css";

import { buildPublicApi } from "./public-api.js";
import { TableLifecycle } from "./lifecycle.js";

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
// No "al" entry is needed: the core aliases al → de, and `_rebuildPluginFlat`
// resolves the active code to "de" for both.
getGeoLeaf()?.I18n?.registerDict?.("table", {
    fr: langFr,
    en: langEn,
    es: langEs,
    pt: langPt,
    it: langIt,
    de: langDe,
});

// 2 — Mount the GeoLeaf.Table namespace.
const _host = getGeoLeaf();
if (_host) {
    _host.Table = buildPublicApi();
}

// 3 — Self-initialise on geoleaf:map:ready (builds the panel once the map exists).
TableLifecycle.init();

// 4 — Register in the plugin registry.
getGeoLeaf()?.plugins?.register?.("table", {
    version: _VERSION,
    requires: [],
    optional: [],
    label: "Table (vue tabulaire des couches)",
    healthCheck: () => typeof getGeoLeaf()?.Table === "object",
});

// Table grid icon (22 px, stroke currentColor) — sanitised by core DOMSecurity.
const _ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"' +
    ' stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="3" width="18" height="18" rx="2"/>' +
    '<path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>' +
    "</svg>";

// 5 — Register the toolbar slot (mobile icon + desktop tab button).
// The slot is declared only on the EAGER path — before `boot()`, where this call is the ONLY
// declaration (an integrator has no `init.js`). After `init()` the toolbar is already built:
// the registration would be stored, never drawn, and would log a warning whose intended reader
// has already done what it recommends elsewhere. `!== true` so a host without `isInitialized`
// still gets its slot.
if (getGeoLeaf()?.registry?.isInitialized?.() !== true) {
    getGeoLeaf()?.registry?.register?.({
        id: "table",
        ui: {
            mobileIcon: {
                icon: _ICON,
                labelKey: "table.toolbar.button",
                profileKey: "modules.table.showButton",
                requiresPlugin: "table",
                action: "table",
            },
            desktopTabButton: {
                icon: _ICON,
                labelKey: "table.toolbar.button",
                profileKey: "modules.table.showButton",
                requiresPlugin: "table",
                action: "table",
                // Render as a vertical-text tab "Tableau" (like Filtrer/Couches/Légende),
                // since the table replaces a former built-in core tab — not a bottom icon.
                variant: "tab",
            },
        },
    });
}

// 6 — Wire the toolbar action: lazily build then toggle the table on "table".
//     ensureInitialized() builds the panel on the first activation (lazy); the
//     first open then slides in, subsequent clicks toggle visibility.
if (typeof document !== "undefined") {
    document.addEventListener("geoleaf:toolbar:action", (e: Event) => {
        const ce = e as CustomEvent<GeoLeafRawEventMap["geoleaf:toolbar:action"]>;
        if (ce.detail?.action !== "table") return;
        if (!TableLifecycle.ensureInitialized()) return;
        (getGeoLeaf()?.Table as { open?: () => void } | undefined)?.open?.();
    });
}
