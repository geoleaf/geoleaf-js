/*!
 * @geoleaf-plugins/print — Preview modal composition maths (PLUGINS S6)
 *
 * Single source of truth for the two geometry questions the preview modal asks:
 *
 *  - `buildComposeArgs()` — what to hand `createComposedCanvas()` for the current
 *    form state. Both the live preview and the export button go through it; they
 *    previously carried two verbatim copies of the same ~45-line block, which is
 *    exactly how they could drift apart unnoticed.
 *  - `mapViewport()` — how to size and aim the off-screen session. Replaces two
 *    hand-inlined copies of the zoom formula that duplicated `calcZoom()`.
 *
 * Both functions are pure: no DOM, no globals beyond the print config read by
 * `computeZones`/`computeBbox`. That is what makes them directly testable.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import {
    ZONE_OPTS_MAP_ONLY,
    calcZoom,
    computeBbox,
    computeTargetPixels,
    computeZones,
    resolvePageDimensions,
} from "./page-format.js";
import type { ComposeOptions } from "./layout-composer.js";
import type { EmpriseBbox, PageOrientation, PageZones } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The modal form state that determines page geometry and composition. */
export interface ComposeInputs {
    format: string;
    orientation: PageOrientation;
    /** Scale denominator locked by the emprise step — never recomputed. */
    lockedScale: number;
    center: { lng: number; lat: number };
    dpi: number;
    title: string;
    description: string;
    includeLegend: boolean;
    includeScale: boolean;
    includeNorthArrow: boolean;
    includeAnnotations: boolean;
}

/** Everything a composition pass needs, derived once from {@link ComposeInputs}. */
export interface ComposeArgs {
    zones: PageZones;
    targetPx: Record<keyof PageZones, { widthPx: number; heightPx: number }>;
    composeOpts: ComposeOptions;
    /** Geographic extent of the composed map zone. */
    bbox: EmpriseBbox;
    /** Page dimensions after the orientation swap. */
    widthMm: number;
    heightMm: number;
}

/** Off-screen session geometry: container size plus camera placement. */
interface MapViewport {
    widthPx: number;
    heightPx: number;
    center: [number, number];
    zoom: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derives the zones, pixel targets and composition options for the current form
 * state. Returns `null` when the paper format is not registered — callers treat
 * that as "nothing to draw", as they did before this was factored out.
 */
export function buildComposeArgs(inputs: ComposeInputs): ComposeArgs | null {
    const dims = resolvePageDimensions(inputs.format, inputs.orientation);
    if (!dims) return null;

    const zoneOpts = {
        includeTitle: !!inputs.title.trim(),
        includeLegend: inputs.includeLegend,
        // The scale bar and north arrow are painted ON the map zone, not in a band
        // of their own — passing them here would shrink the map for nothing.
        includeScale: false,
        includeNorthArrow: false,
        includeFooter: !!inputs.description.trim(),
    };

    const zones = computeZones(inputs.format, inputs.orientation, zoneOpts);
    const targetPx = computeTargetPixels(zones, inputs.dpi);
    const bbox = computeBbox(
        inputs.format,
        inputs.lockedScale,
        inputs.orientation,
        inputs.center,
        zoneOpts
    );

    return {
        zones,
        targetPx,
        bbox,
        widthMm: dims.widthMm,
        heightMm: dims.heightMm,
        composeOpts: {
            title: inputs.title,
            description: inputs.description,
            scaleDenominator: inputs.lockedScale,
            dpi: inputs.dpi,
            includeScale: inputs.includeScale,
            includeNorthArrow: inputs.includeNorthArrow,
            includeLegend: inputs.includeLegend,
            includeAnnotations: inputs.includeAnnotations,
            bbox,
            pageSizeMm: { widthMm: dims.widthMm, heightMm: dims.heightMm },
        },
    };
}

/**
 * Sizes and aims the off-screen session for the given format and locked scale.
 *
 * The viewport is deliberately computed against {@link ZONE_OPTS_MAP_ONLY} — the
 * *largest* map zone the format can yield. Bands (title, legend, footer) only ever
 * shrink that zone, so the captured canvas is always a superset of what gets
 * composed, and toggling a band needs a re-composition but never a re-render.
 * `createComposedCanvas` crops the surplus rather than squeezing it.
 *
 * Returns `null` for an unregistered format.
 */
export function mapViewport(
    format: string,
    orientation: PageOrientation,
    lockedScale: number,
    center: { lng: number; lat: number },
    dpi: number
): MapViewport | null {
    if (!resolvePageDimensions(format, orientation)) return null;

    const zones = computeZones(format, orientation, ZONE_OPTS_MAP_ONLY);
    const { widthPx, heightPx } = computeTargetPixels(zones, dpi).map;

    return {
        widthPx,
        heightPx,
        center: [center.lng, center.lat],
        zoom: calcZoom(lockedScale, center.lat, dpi),
    };
}
