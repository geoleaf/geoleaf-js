/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview Pure tile arithmetic for the offline cache: Web Mercator tile
 * coordinates and pre-download zone estimation.
 *
 * ⚠️ This module is deliberately DEPENDENCY-FREE — no `Log`, no formatters, no core
 * import at all. `plugin-storage` reaches it through the `@core-offline/*` alias, and
 * rollup COPIES the resolved source into the plugin bundle: every import added here is
 * copied with it. Keeping the file self-contained is precisely what keeps the core
 * logger out of that bundle (it used to reach `calculator.ts`, whose
 * `Log` import tethered the whole logger to the plugin).
 *
 * `calculator.ts` delegates to these helpers rather than duplicating them, so the
 * engine and the UI estimate share one implementation.
 */

/**
 * Web Mercator latitude cutoff — the projection diverges beyond it.
 *
 * Module-private: `CacheCalculator` owns the mutable copy (`defaults.webMercatorMaxLat`)
 * and forwards it explicitly, so exporting a second name for the same constant would
 * just be a second source of truth.
 */
const WEB_MERCATOR_MAX_LAT = 85.0511;

// Public-API review — `AVG_PBF_BYTES`, `GLYPH_SPRITE_OVERHEAD`, `countTilesForBounds`
// and `estimateVectorZone` were MOVED into `@geoleaf-plugins/offline-ui`
// (`src/sync/vector-zone-estimate.ts`). They were DEAD code here: zero callers in
// the core, and the build pruned them from the published artifact —
// `dist/esm/.../tile-math.js` exported only `latLngToTile`. Storage, the sole
// consumer, reached them through an alias to these SOURCES, which forbade it a
// `rootDir`.
//
// ⚠️ Lesson to keep: a published subpath only guarantees the FILE. Its CONTENT
// depends on the emitting package's tree-shaking — a symbol no code of the package
// calls is not in the artifact, whatever the `exports` map announces.
// `check-subpath-resolve` cannot see this class: it checks that targets exist, not
// that symbols are present.

/** Geographic bounding box, in degrees. */
export interface Bounds {
    north: number;
    south: number;
    east: number;
    west: number;
}

/** Tile coordinates in the XYZ scheme (Y increases southwards). */
export interface TileCoord {
    x: number;
    y: number;
}

/** A vector download zone: an area plus the zoom range to cache. */
export interface VectorZone {
    bounds: Bounds;
    cacheMinZoom: number;
    cacheMaxZoom: number;
}

/**
 * Converts lat/lng to XYZ tile coordinates (Web Mercator projection).
 *
 * @param lat - Latitude in degrees; clamped to the Web Mercator range.
 * @param lng - Longitude in degrees; clamped to [-180, 180].
 * @param zoom - Zoom level.
 * @param maxLat - Latitude cutoff. Passed explicitly by `CacheCalculator` so that
 *   mutating its `defaults.webMercatorMaxLat` stays effective.
 * @returns Tile coordinates `{ x, y }`.
 */
export function latLngToTile(
    lat: number,
    lng: number,
    zoom: number,
    maxLat: number = WEB_MERCATOR_MAX_LAT
): TileCoord {
    const clampedLat = Math.max(-maxLat, Math.min(maxLat, lat));
    const clampedLng = Math.max(-180, Math.min(180, lng));

    const n = Math.pow(2, zoom);
    const x = Math.floor(((clampedLng + 180) / 360) * n);

    // Safe tan/cos: the latitude clamp above keeps the argument finite.
    const latRad = (clampedLat * Math.PI) / 180;
    const y = Math.floor(
        ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
    );

    return { x, y };
}
