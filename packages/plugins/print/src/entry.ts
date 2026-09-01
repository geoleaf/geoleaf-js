/*!
 * @geoleaf-plugins/print — Entry point
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import "./css/geoleaf-print.css";
import { buildPublicApi } from "./public-api.js";
import { getPrintConfig } from "./config.js";
import { getGeoLeaf } from "@geoleaf/host-runtime";
import langFr from "./lang/lang-fr.js";
import langEn from "./lang/lang-en.js";
import langEs from "./lang/lang-es.js";
import langPt from "./lang/lang-pt.js";
import langIt from "./lang/lang-it.js";
import langDe from "./lang/lang-de.js";

// Toolbar seam shape imported from the published contract instead of a local
// re-declaration: the 7 plugins carried 4 divergent shapes of it.
import type { GeoLeafRawEventMap } from "@geoleaf/core";
// Replaced at build time by rollup/replace — must be a plain string literal.
const _VERSION = "__GEOLEAF_VERSION__";

// 1 — Register i18n dictionaries FIRST so labels resolve during boot (pill button).
getGeoLeaf()?.I18n?.registerDict?.("print", {
    fr: langFr,
    en: langEn,
    es: langEs,
    pt: langPt,
    it: langIt,
    de: langDe,
});

// 2 — Mount GeoLeaf.Print namespace (only when the core is present).
const _gl = getGeoLeaf();
if (_gl) {
    _gl.Print = buildPublicApi();
}

// 3 — Register in the plugin registry.
//
// ⚠️ `optional` names PLUGINS, resolved through `PluginRegistry.isLoaded()`.
// This field long carried `["legend", "storage"]`, two wrong entries for two
// different reasons: `storage` was renamed `offline-ui`, and `legend` NEVER
// was a plugin — it is an in-core capability no `isLoaded()` will ever see.
// The relation with the legend is real but plays out elsewhere, correctly:
// `includeLegend` reads `GeoLeaf.Legend` through the namespace when composing
// the sheet. A field that can only name plugins must not claim to describe
// anything else.
getGeoLeaf()?.plugins?.register?.("print", {
    version: _VERSION,
    requires: [],
    optional: ["offline-ui"],
    label: "Print (carte à l'échelle → PDF / JPG)",
    healthCheck: () => typeof getGeoLeaf()?.Print === "object",
});

// Printer icon (22 px, stroke currentColor) — sanitised by core DOMSecurity.setSafeHTML.
const _PRINT_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"' +
    ' stroke-linecap="round" stroke-linejoin="round">' +
    '<polyline points="6 9 6 2 18 2 18 9"/>' +
    '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>' +
    '<rect x="6" y="14" width="12" height="8"/>' +
    "</svg>";

// 4 & 5 — Register toolbar slot + wire event listener (skipped if enabled === false).
// The slot is declared only on the EAGER path — before `boot()`, where this call is the ONLY
// declaration (no `init.js` at an integrator's). After `init()` the toolbar is already built:
// the registration would be stored, never drawn, and would log a warning with no reachable
// audience. `!== true` so a host without `isInitialized` still gets its slot.
if (getPrintConfig().enabled !== false) {
    // ── The SLOT DECLARATIONS only — guarded since 21/08/2026 (eager path is their only
    // reader: after init() the toolbar is built and a stored slot is never drawn). `!== true`
    // so a host without `isInitialized` still gets its slots.
    // ⚠️ Scope fixed on 25/08/2026: this guard once wrapped the WHOLE block below — listeners
    // and map-ready wiring included — so on the LAZY path (isInitialized === true) the plugin
    // mounted its API and never wired its UI: no root, no handler, no error. The guard must
    // cover the registers alone; everything after it runs on BOTH paths.
    if (getGeoLeaf()?.registry?.isInitialized?.() !== true) {
        getGeoLeaf()?.registry?.register?.({
            id: "print",
            ui: {
                mobileIcon: {
                    icon: _PRINT_ICON,
                    labelKey: "print.toolbar.button",
                    profileKey: "modules.print.showButton",
                    legacyProfileKey: "ui.showPrint",
                    requiresPlugin: "print",
                    action: "print",
                },
                desktopTabButton: {
                    icon: _PRINT_ICON,
                    labelKey: "print.toolbar.button",
                    profileKey: "modules.print.showButton",
                    legacyProfileKey: "ui.showPrint",
                    requiresPlugin: "print",
                    action: "print",
                },
            },
        });
    }

    if (typeof document !== "undefined") {
        document.addEventListener("geoleaf:toolbar:action", (e: Event) => {
            const ce = e as CustomEvent<GeoLeafRawEventMap["geoleaf:toolbar:action"]>;
            if (ce.detail?.action === "print") {
                (getGeoLeaf()?.Print as { openPrintFlow?(): void } | undefined)?.openPrintFlow?.();
            }
        });
    }
}

// Re-export public types for TypeScript consumers.
export type {
    PageOrientation,
    EmpriseBbox,
    Rect,
    PageMargins,
    PageZones,
    ZoneOptions,
    PageFormatDef,
    CaptureOptions,
    CaptureResult,
    ExportOptions,
    PrintFlowOptions,
    ComposedExportOpts,
    ExporterFn,
    ComposeSlot,
} from "./types.js";
