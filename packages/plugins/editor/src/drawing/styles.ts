/*!
 * @geoleaf-plugins/editor — Terra Draw styles derived from GeoLeaf CSS variables
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { HexColor } from "terra-draw";

// ---------------------------------------------------------------------------
// Theme color reading
// ---------------------------------------------------------------------------

/**
 * The two colours the drawing styles are built from, read off the active GeoLeaf theme.
 *
 * Both fall back to built-in constants when the theme yields nothing usable, so the editor
 * always draws with a valid pair rather than inheriting an invalid CSS value.
 */
export interface ThemeColors {
    /** Primary colour — strokes, vertices, selection highlights. */
    accent: HexColor;
    /** Contrast colour used behind the accent (vertex fill, halos). */
    white: HexColor;
}

const _FALLBACK_ACCENT = "#2563eb" as HexColor;
const _FALLBACK_WHITE = "#ffffff" as HexColor;

/** Validates that s is a 3- or 6-digit hex string; returns fallback otherwise. */
function _hex(s: string, fallback: HexColor): HexColor {
    const t = s.trim();
    return /^#[0-9a-fA-F]{3}$/.test(t) || /^#[0-9a-fA-F]{6}$/.test(t) ? (t as HexColor) : fallback;
}

/**
 * Reads the palette's accent on `<html>`, to build the drawing colours.
 *
 * ⚠️ On `<html>` ON PURPOSE, and not where the light/dark theme resolves it. Under
 * `gl-theme-light` / `gl-theme-dark` the accent is an INTERFACE token — the light theme makes it a
 * pale surface tone (`#f4cfb4`), and a stroke in it all but vanishes on the map. Like the route
 * and the POI, the drawing keeps one colour across light and dark, for legibility. The palette is
 * different: it sets the brand accent on `<html>`, so reading there follows it.
 *
 * @returns The accent, or `#2563eb` when the palette yields no hex colour; and white.
 */
export function readThemeColors(): ThemeColors {
    if (typeof document === "undefined") {
        return { accent: _FALLBACK_ACCENT, white: _FALLBACK_WHITE };
    }
    const style = getComputedStyle(document.documentElement);
    return {
        accent: _hex(style.getPropertyValue("--gl-color-accent"), _FALLBACK_ACCENT),
        white: _FALLBACK_WHITE,
    };
}

// ---------------------------------------------------------------------------
// Style builders — returned as Partial<ModeStyling> passed to mode constructors
// ---------------------------------------------------------------------------

/** Drawing styles for TerraDrawPointMode. */
export function buildPointStyles(c: ThemeColors) {
    return {
        pointColor: c.accent,
        pointWidth: 6,
        pointOutlineColor: c.white,
        pointOutlineWidth: 2,
        pointOpacity: 1,
    };
}

/** Drawing styles for TerraDrawLineStringMode (used for both 'line' and 'polyline'). */
export function buildLineStyles(c: ThemeColors) {
    return {
        lineStringColor: c.accent,
        lineStringWidth: 3,
        lineStringOpacity: 1,
        closingPointColor: c.accent,
        closingPointWidth: 5,
        closingPointOutlineColor: c.white,
        closingPointOutlineWidth: 2,
        closingPointOpacity: 1,
        coordinatePointColor: c.accent,
        coordinatePointWidth: 4,
        coordinatePointOutlineColor: c.white,
        coordinatePointOutlineWidth: 1,
        coordinatePointOpacity: 0.8,
        snappingPointColor: c.white,
        snappingPointWidth: 6,
        snappingPointOutlineColor: c.accent,
        snappingPointOutlineWidth: 2,
        snappingPointOpacity: 1,
    };
}

/** Drawing styles for TerraDrawPolygonMode. */
export function buildPolygonStyles(c: ThemeColors) {
    return {
        fillColor: c.accent,
        fillOpacity: 0.18,
        outlineColor: c.accent,
        outlineOpacity: 1,
        outlineWidth: 2,
        closingPointColor: c.accent,
        closingPointWidth: 5,
        closingPointOutlineColor: c.white,
        closingPointOutlineWidth: 2,
        closingPointOpacity: 1,
        snappingPointColor: c.white,
        snappingPointWidth: 6,
        snappingPointOutlineColor: c.accent,
        snappingPointOutlineWidth: 2,
        snappingPointOpacity: 1,
        coordinatePointColor: c.accent,
        coordinatePointWidth: 4,
        coordinatePointOutlineColor: c.white,
        coordinatePointOutlineWidth: 1,
        coordinatePointOpacity: 0.8,
    };
}

/** Styles for TerraDrawSelectMode (vertex handles, midpoints, selected features). */
export function buildSelectStyles(c: ThemeColors) {
    return {
        selectedLineStringColor: c.accent,
        selectedLineStringWidth: 3,
        selectedLineStringOpacity: 1,
        selectedPolygonColor: c.accent,
        selectedPolygonFillOpacity: 0.22,
        selectedPolygonOutlineColor: c.accent,
        selectedPolygonOutlineOpacity: 1,
        selectedPolygonOutlineWidth: 2,
        selectedPointColor: c.accent,
        selectedPointWidth: 6,
        selectedPointOutlineColor: c.white,
        selectedPointOutlineWidth: 2,
        selectedPointOpacity: 1,
        selectionPointColor: c.white,
        selectionPointWidth: 8,
        selectionPointOutlineColor: c.accent,
        selectionPointOutlineWidth: 2,
        selectionPointOpacity: 1,
        midPointColor: c.white,
        midPointWidth: 5,
        midPointOutlineColor: c.accent,
        midPointOutlineWidth: 2,
        midPointOpacity: 1,
    };
}

// ---------------------------------------------------------------------------
// Theme change watcher
// ---------------------------------------------------------------------------

/** Emitted by the core on `document` once a palette switch has reached `<html>`. */
const PALETTE_CHANGED = "geoleaf:palette-changed";

/**
 * Calls `onUpdate` with fresh colours after every palette switch.
 *
 * Follows the event the core emits once the palette is on `<html>`. It used to observe
 * `<html>`'s classes, which nothing changes, while the palette switch changes `data-gl-palette`:
 * a switch was never seen. A light/dark switch is not followed, on purpose
 * (see {@link readThemeColors}).
 *
 * @param onUpdate - Receives the colours read after the switch.
 * @returns A cleanup function that stops listening.
 */
export function watchThemeChanges(onUpdate: (colors: ThemeColors) => void): () => void {
    if (typeof document === "undefined") return () => {};
    const refresh = (): void => onUpdate(readThemeColors());
    document.addEventListener(PALETTE_CHANGED, refresh);
    return () => document.removeEventListener(PALETTE_CHANGED, refresh);
}
