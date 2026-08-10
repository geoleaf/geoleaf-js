/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview Scale utilities - compute map scale and test visibility ranges
 */

// Map-like interface for scale calculation
interface MapLike {
    getCenter?: () => { lat: number };
    getZoom?: () => number;
}

interface ScaleOptions {
    force?: boolean;
    logger?: { debug?: (msg: string) => void };
}

interface ScaleCache {
    zoom: number | null;
    lat: number | null;
    scale: number | null;
}

const _scaleCache: ScaleCache = {
    zoom: null,
    lat: null,
    scale: null,
};

/**
 * Metres covered by one screen pixel at zoom 0, on the equator (Web Mercator):
 * the exact `2·π·6_378_137 / 256`. Kept exact (was rounded to `156543.04`) so this module
 * is the single, most-precise source of the scale math — the scale control consumed a
 * private copy of this constant before S6 and now imports {@link scaleAtZoom} instead.
 */
const METERS_PER_PIXEL_AT_ZOOM_0 = 156543.03392;
const METERS_PER_INCH = 0.0254;
const DPI = 96;

/**
 * Scale denominator at zoom 0 on the equator: `metres/px × DPI / metres-per-inch`.
 * Shared by {@link scaleAtZoom} and {@link zoomAtScale} so the two stay exact inverses —
 * duplicating the constants is how they drift apart.
 */
const SCALE_AT_ZOOM_0 = (METERS_PER_PIXEL_AT_ZOOM_0 * DPI) / METERS_PER_INCH;

/**
 * The scale denominator (the X in 1:X) rendered at `zoom` and `lat` — the pure Web Mercator
 * forward map, no caching. Both {@link calculateMapScale} (which reads a live map and caches)
 * and the scale control build on this, so the forward formula lives in exactly one place.
 *
 * @param zoom - Map zoom level.
 * @param lat - Latitude in degrees.
 * @returns The scale denominator, rounded to an integer.
 */
export function scaleAtZoom(zoom: number, lat: number): number {
    return Math.round((SCALE_AT_ZOOM_0 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom));
}

/**
 * The fractional, unclamped zoom that renders scale denominator `scale` at `lat` — the pure
 * inverse of {@link scaleAtZoom}. Callers add their own guards and clamping: {@link scaleToZoom}
 * wraps it with MapLibre's [0 ; 24] clamp and null guards; the scale control seeds its damped
 * solver with it and clamps to [0 ; 22].
 *
 * @param scale - Scale denominator (the X in 1:X). Must be finite and > 0.
 * @param lat - Latitude in degrees.
 * @returns The raw zoom (may be fractional, negative, or beyond MapLibre's range).
 */
export function zoomAtScale(scale: number, lat: number): number {
    return Math.log2((SCALE_AT_ZOOM_0 * Math.cos((lat * Math.PI) / 180)) / scale);
}

/**
 * Calculates the scale (1:X) of the map at its current zoom and latitude.
 * Returns the cached value when zoom/latitude are unchanged.
 */
export function calculateMapScale(
    map: MapLike | null | undefined,
    options: ScaleOptions = {}
): number {
    if (!map) return 0;

    const logger = options.logger;
    const center = map.getCenter?.();
    const zoom = map.getZoom?.();

    if (!center || typeof zoom !== "number") {
        return 0;
    }

    if (!options.force && _scaleCache.zoom === zoom && _scaleCache.lat === center.lat) {
        return _scaleCache.scale ?? 0;
    }

    const scale = scaleAtZoom(zoom, center.lat);

    _scaleCache.zoom = zoom;
    _scaleCache.lat = center.lat;
    _scaleCache.scale = scale;

    if (logger && typeof logger.debug === "function") {
        logger.debug(
            `[ScaleUtils] Scale calculation: zoom=${zoom}, lat=${center.lat.toFixed(2)}, scale=1:${scale.toLocaleString()}`
        );
    }

    return scale;
}

/**
 * Checks whether the current scale falls within the [maxScale ; minScale] interval.
 */
function _logScale(logger: { debug?: (msg: string) => void } | undefined, msg: string) {
    logger?.debug?.(msg);
}

function _normalizeScaleBound(val: number | null | undefined): number | null {
    return typeof val === "number" && val > 0 ? val : null;
}

/**
 * Whether a scale denominator falls within an optional min/max range.
 *
 * ⚠️ Bounds are **scale denominators** (the X of 1:X), never MapLibre zoom levels — and the
 * two run in opposite directions: a larger denominator means a smaller scale. An absent bound
 * means no constraint on that side.
 */
export function isScaleInRange(
    currentScale: number,
    minScale: number | null | undefined,
    maxScale: number | null | undefined,
    logger?: { debug?: (msg: string) => void }
): boolean {
    const normalizedMin = _normalizeScaleBound(minScale);
    const normalizedMax = _normalizeScaleBound(maxScale);

    if (normalizedMin !== null && currentScale > normalizedMin) {
        _logScale(
            logger,
            `[ScaleUtils] ${currentScale} > minScale ${normalizedMin} → invisible (too zoomed out)`
        );
        return false;
    }

    if (normalizedMax !== null && currentScale < normalizedMax) {
        _logScale(
            logger,
            `[ScaleUtils] ${currentScale} < maxScale ${normalizedMax} → invisible (too zoomed in)`
        );
        return false;
    }

    _logScale(
        logger,
        `[ScaleUtils] ${currentScale} within [${normalizedMax ?? "∞"} ; ${normalizedMin ?? "∞"}] → visible`
    );

    return true;
}

/** MapLibre refuses a zoom outside this range. */
const MAPLIBRE_MIN_ZOOM = 0;
const MAPLIBRE_MAX_ZOOM = 24;

/**
 * Web Mercator's latitude limit — the projection diverges at the poles, and MapLibre
 * clamps to this. Beyond it there is no meaningful scale: `Math.cos(90°)` returns 6.1e-17
 * rather than 0 in JS, so a bare `cos <= 0` guard never fires and the conversion silently
 * yields a garbage (clamped) zoom instead of "no answer".
 */
const MAX_MERCATOR_LAT = 85.051129;

/**
 * Converts a scale denominator (the X in 1:X) to the MapLibre zoom level that renders it
 * at `lat` — the exact inverse of {@link calculateMapScale}.
 *
 * Lets the engine carry a constraint the profile expresses in the user's unit (scale)
 * while MapLibre only speaks zoom. **The conversion depends on latitude, not on zoom**:
 * that is why a scale bound cannot be a fixed `minzoom` in general, and why callers only
 * need to recompute when the latitude moves — never when the user zooms.
 *
 * Because the denominator grows as you zoom out, the mapping is order-preserving here:
 * `minScale` (widest view, larger number) → `minzoom`, `maxScale` → `maxzoom`.
 *
 * @param scale - Scale denominator. `<= 0` or non-finite means "no constraint" → `null`.
 * @param lat - Latitude the bound is evaluated at, in degrees.
 * @returns The zoom level, clamped to MapLibre's [0 ; 24], or `null` if unconstrained.
 */
export function scaleToZoom(scale: number | null | undefined, lat: number): number | null {
    if (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0) return null;
    if (typeof lat !== "number" || !Number.isFinite(lat)) return null;
    if (Math.abs(lat) > MAX_MERCATOR_LAT) return null;

    const cosLat = Math.cos((lat * Math.PI) / 180);
    if (cosLat <= 0) return null;

    const zoom = zoomAtScale(scale, lat);
    if (!Number.isFinite(zoom)) return null;
    return Math.min(MAPLIBRE_MAX_ZOOM, Math.max(MAPLIBRE_MIN_ZOOM, zoom));
}

/**
 * Empties the memoised scale computations.
 *
 * Needed after the map's projection or container size changed, since cached values were
 * computed against the previous geometry.
 */
export function clearScaleCache(): void {
    _scaleCache.zoom = null;
    _scaleCache.lat = null;
    _scaleCache.scale = null;
}
