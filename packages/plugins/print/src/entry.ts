/*!
 * @geoleaf-plugins/print — Entry point
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import "./css/geoleaf-print.css";
import { buildPublicApi } from "./public-api.js";
import { getPrintConfig } from "./config.js";
import { closePrintFlows } from "./flow.js";
import { getGeoLeaf, registerPluginModule } from "@geoleaf/host-runtime";
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

/** The API this plugin mounts as `GeoLeaf.Print`. */
export type PrintApi = ReturnType<typeof buildPublicApi>;

// The core declares `GeoLeaf.Print` and cannot type it: it never imports a plugin. The type
// comes from here, through the registry the core reads — for whoever installs this package.
declare global {
    interface GeoLeafPluginApis {
        Print: PrintApi;
    }
}

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

// 4 & 5 — Register the module + wire event listener (skipped if enabled === false).
// The SLOT is declared only on the EAGER path — before `boot()`, where this call is the ONLY
// declaration (no `init.js` at an integrator's). After `init()` the toolbar is already built:
// a slot registered then would be stored, not drawn before the next mount, and would log a
// warning with no reachable audience.
if (getPrintConfig().enabled !== false) {
    // ⚠️ Scope fixed on 25/08/2026: the eager-path guard once wrapped the WHOLE block below —
    // listeners included — so on the LAZY path the plugin mounted its API and never wired its
    // UI: no handler, no error. Only the slot is path-dependent; everything else, the teardown
    // included, runs on BOTH paths.
    //
    // ── The module carries the TEARDOWN on BOTH paths (1.3.4): `GeoLeaf.mount()` unmounts the
    // application by destroying the core's module registry, and this is how that reaches a print
    // flow left open — see `closePrintFlows()`. The slot is joined on the eager path only
    // (`registerPluginModule`, `@geoleaf/host-runtime`).
    registerPluginModule({
        id: "print",
        destroy: () => closePrintFlows(),
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
