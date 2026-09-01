/*!
 * @geoleaf-plugins/print — Paper format registry
 *
 * Provides:
 *  - Built-in A4 / A3 definitions; registerPageFormat() for A2/A1/A0
 *  - computeZones()        → PageZones in mm (title / map / legend / footer)
 *  - computeBbox()         → EmpriseBbox from centre + locked scale + format
 *  - computeTargetPixels() → pixel dimensions per zone at a given DPI
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import type {
    EmpriseBbox,
    PageFormatDef,
    PageMargins,
    PageOrientation,
    PageZones,
    Rect,
    ZoneOptions,
} from "./types.js";
import { getPrintConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Earth radius used for Web Mercator projection (EPSG:3857). */
export const R_EARTH = 6_378_137;

/** Ground resolution (m/px) at zoom 0, equator — matches scale-utils.ts line 51. */
export const METERS_PER_PIXEL_AT_ZOOM_0 = 156543.04;

/** Title band height (mm) when a title is present. */
const TITLE_HEIGHT_MM = 14;

/**
 * Legend band height (mm) — a provisional default.
 * legend-inline.ts measures the actual canvas height and adjusts.
 */
const LEGEND_HEIGHT_MM = 24;

/** Footer band height (mm) when a footer (attribution + description) is present. */
const FOOTER_HEIGHT_MM = 10;

/**
 * Zone options for a pure map-zone layout — no title / legend / footer band.
 * This is the *maximum* map zone for a given format: every band can only shrink it.
 * Used to size off-screen captures, which are deliberately rendered as a superset
 * of the composed map zone so that toggling a band never forces a re-render.
 */
export const ZONE_OPTS_MAP_ONLY: ZoneOptions = {
    includeTitle: false,
    includeLegend: false,
    includeScale: false,
    includeNorthArrow: false,
    includeFooter: false,
};

// ---------------------------------------------------------------------------
// Internal registry
// ---------------------------------------------------------------------------

const _formatRegistry = new Map<string, PageFormatDef>();

// ---------------------------------------------------------------------------
// Zone computation
// ---------------------------------------------------------------------------

/**
 * Computes zone layout (title / map / legend / footer) in mm for the given
 * format dimensions, orientation, and included zone options.
 * Margins are read from printConfig at call time.
 */
function _computeZonesForFormat(
    portraitWidthMm: number,
    portraitHeightMm: number,
    orientation: PageOrientation,
    opts: ZoneOptions
): PageZones {
    const margins: PageMargins = getPrintConfig().margins;

    const pageW = orientation === "landscape" ? portraitHeightMm : portraitWidthMm;
    const pageH = orientation === "landscape" ? portraitWidthMm : portraitHeightMm;

    const usableX = margins.left;
    const usableY = margins.top;
    const usableW = pageW - margins.left - margins.right;
    const usableH = pageH - margins.top - margins.bottom;

    const titleH = opts.includeTitle ? TITLE_HEIGHT_MM : 0;
    const legendH = opts.includeLegend ? LEGEND_HEIGHT_MM : 0;
    // Footer band (attribution + optional description), drawn below the legend.
    const footerH = opts.includeFooter ? FOOTER_HEIGHT_MM : 0;

    const mapH = usableH - titleH - legendH - footerH;

    const title: Rect = { x: usableX, y: usableY, width: usableW, height: titleH };
    const map: Rect = { x: usableX, y: usableY + titleH, width: usableW, height: mapH };
    const legend: Rect = {
        x: usableX,
        y: usableY + titleH + mapH,
        width: usableW,
        height: legendH,
    };
    const footer: Rect = {
        x: usableX,
        y: usableY + titleH + mapH + legendH,
        width: usableW,
        height: footerH,
    };

    return { title, map, legend, footer };
}

/** Builds a PageFormatDef for a portrait-dimensioned ISO format. */
function _makeFormatDef(widthMm: number, heightMm: number): PageFormatDef {
    return {
        widthMm,
        heightMm,
        computeZones(orientation: PageOrientation, opts: ZoneOptions): PageZones {
            return _computeZonesForFormat(widthMm, heightMm, orientation, opts);
        },
    };
}

// ---------------------------------------------------------------------------
// Built-in formats
// ---------------------------------------------------------------------------

_formatRegistry.set("A4", _makeFormatDef(210, 297));
_formatRegistry.set("A3", _makeFormatDef(297, 420));

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the PageFormatDef for the given format name, or `undefined` if unknown.
 */
export function getPageFormat(name: string): PageFormatDef | undefined {
    return _formatRegistry.get(name);
}

/**
 * Registers a custom paper format (A2, A1, A0, …).
 * Overwrites any existing entry with the same name.
 */
export function registerPageFormat(name: string, def: PageFormatDef): void {
    _formatRegistry.set(name, def);
}

/**
 * Returns the page dimensions in mm after the orientation swap, or `null` when
 * the format is not registered. Formats are stored portrait-dimensioned, so
 * landscape swaps width and height.
 */
export function resolvePageDimensions(
    formatName: string,
    orientation: PageOrientation
): { widthMm: number; heightMm: number } | null {
    const def = _formatRegistry.get(formatName);
    if (!def) return null;
    return orientation === "landscape"
        ? { widthMm: def.heightMm, heightMm: def.widthMm }
        : { widthMm: def.widthMm, heightMm: def.heightMm };
}

/**
 * Computes zone layout (in mm) for the given format, orientation, and zone options.
 * Falls back to A4 if the format name is not registered.
 */
export function computeZones(
    formatName: string,
    orientation: PageOrientation,
    opts: ZoneOptions
): PageZones {
    const def = _formatRegistry.get(formatName) ?? _formatRegistry.get("A4")!;
    return def.computeZones(orientation, opts);
}

/**
 * Computes the geographic bounding box for the map zone, given a locked scale denominator,
 * a format, an orientation, and a centre point.
 *
 * The scale denominator is held constant: changing the format changes the bbox, not the scale.
 * Uses Web Mercator projection (EPSG:3857) for accuracy.
 *
 * `zoneOpts` describes which bands (title, legend, footer) the page carries — they
 * shrink the map zone, hence the ground it covers at the locked scale. Omitting it
 * yields the full-page map zone ({@link ZONE_OPTS_MAP_ONLY}), which is what the
 * off-screen capture is sized against.
 */
export function computeBbox(
    formatName: string,
    scaleDenominator: number,
    orientation: PageOrientation,
    center: { lng: number; lat: number },
    zoneOpts: ZoneOptions = ZONE_OPTS_MAP_ONLY
): EmpriseBbox {
    // Derived from computeZones so the bands are honoured — recomputing the margins
    // here is what let the bbox claim the whole page while a band had shrunk it.
    const mapZone = computeZones(formatName, orientation, zoneOpts).map;
    const mapW = mapZone.width;
    const mapH = mapZone.height;

    // Ground dimensions: groundM = (mm / 1000) × scaleDenominator
    const groundWidthM = (mapW / 1000) * scaleDenominator;
    const groundHeightM = (mapH / 1000) * scaleDenominator;

    // Project centre to Web Mercator (metres)
    const lngRad = (center.lng * Math.PI) / 180;
    const latRad = (center.lat * Math.PI) / 180;
    const xC = R_EARTH * lngRad;
    const yC = R_EARTH * Math.log(Math.tan(Math.PI / 4 + latRad / 2));

    // Extend ±half ground dimension
    const xMin = xC - groundWidthM / 2;
    const xMax = xC + groundWidthM / 2;
    const yMin = yC - groundHeightM / 2;
    const yMax = yC + groundHeightM / 2;

    // Inverse projection back to WGS-84
    const minLng = (xMin / R_EARTH) * (180 / Math.PI);
    const maxLng = (xMax / R_EARTH) * (180 / Math.PI);
    const minLat = (2 * Math.atan(Math.exp(yMin / R_EARTH)) - Math.PI / 2) * (180 / Math.PI);
    const maxLat = (2 * Math.atan(Math.exp(yMax / R_EARTH)) - Math.PI / 2) * (180 / Math.PI);

    return { minLng, minLat, maxLng, maxLat };
}

/**
 * Computes the MapLibre zoom level that renders the map at the target print scale.
 * Mirrors the inverse of calculateMapScale (scale-utils.ts).
 *
 * metersPerPixelTarget = scaleDenominator × 0.0254 / printDpi
 * zoom = log₂(156543.04 × cos(lat) / metersPerPixelTarget)
 *
 * Lives here rather than next to the off-screen renderer: it is pure projection
 * maths, and both the one-shot capture and the preview modal need it — the modal
 * used to carry two verbatim copies.
 */
export function calcZoom(scaleDenominator: number, lat: number, dpi: number): number {
    const metersPerPixelTarget = (scaleDenominator * 0.0254) / dpi;
    return Math.log2(
        (METERS_PER_PIXEL_AT_ZOOM_0 * Math.cos((lat * Math.PI) / 180)) / metersPerPixelTarget
    );
}

/**
 * Computes pixel dimensions for each zone at the target DPI.
 * Returns `{ map, title, legend, footer }` each with `widthPx` and `heightPx`.
 */
export function computeTargetPixels(
    zones: PageZones,
    dpi: number
): Record<keyof PageZones, { widthPx: number; heightPx: number }> {
    const mmToPx = (mm: number): number => Math.round((mm / 25.4) * dpi);

    return {
        map: { widthPx: mmToPx(zones.map.width), heightPx: mmToPx(zones.map.height) },
        title: { widthPx: mmToPx(zones.title.width), heightPx: mmToPx(zones.title.height) },
        legend: { widthPx: mmToPx(zones.legend.width), heightPx: mmToPx(zones.legend.height) },
        footer: { widthPx: mmToPx(zones.footer.width), heightPx: mmToPx(zones.footer.height) },
    };
}
