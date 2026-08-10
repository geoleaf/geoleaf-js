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

// Forme du seam toolbar importée du contrat publié (API publique S3) au lieu d'une
// re-déclaration locale : les 7 plugins en portaient 4 formes divergentes.
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
// ⚠️ `optional` désigne des PLUGINS, résolus par `PluginRegistry.isLoaded()` (B-66). Ce champ a
// longtemps porté `["legend", "storage"]`, deux entrées fausses pour deux raisons différentes :
// `storage` a été renommé `offline-ui`, et `legend` n'a JAMAIS été un plugin — c'est une capacité
// in-core, qu'aucun `isLoaded()` ne verra jamais. La relation avec la légende est réelle mais elle
// se joue ailleurs, et correctement : `includeLegend` lit `GeoLeaf.Legend` par le namespace au
// moment de composer la planche. Un champ qui ne sait nommer que des plugins ne doit pas prétendre
// décrire autre chose.
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
if (getPrintConfig().enabled !== false) {
    getGeoLeaf()?.registry?.register?.({
        id: "print",
        ui: {
            mobileIcon: {
                icon: _PRINT_ICON,
                labelKey: "print.toolbar.button",
                profileKey: "ui.showPrint",
                requiresPlugin: "print",
                action: "print",
            },
            desktopTabButton: {
                icon: _PRINT_ICON,
                labelKey: "print.toolbar.button",
                profileKey: "ui.showPrint",
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
