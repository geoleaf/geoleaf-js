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
 * logger out of that bundle (CAPACITÉS S1 — it used to reach `calculator.ts`, whose
 * `Log` import tethered the whole logger to the plugin).
 *
 * `calculator.ts` delegates to these helpers rather than duplicating them, so the
 * engine and the UI estimate share one implementation.
 */
"use strict";

/**
 * Web Mercator latitude cutoff — the projection diverges beyond it.
 *
 * Module-private: `CacheCalculator` owns the mutable copy (`defaults.webMercatorMaxLat`)
 * and forwards it explicitly, so exporting a second name for the same constant would
 * just be a second source of truth.
 */
const WEB_MERCATOR_MAX_LAT = 85.0511;

// API publique S4.4 — `AVG_PBF_BYTES`, `GLYPH_SPRITE_OVERHEAD`, `countTilesForBounds` et
// `estimateVectorZone` ont été DÉPLACÉS dans `@geoleaf-plugins/offline-ui`
// (`src/sync/vector-zone-estimate.ts`). Ils étaient du code MORT ici : zéro appelant dans le
// core, et le build les élaguait de l'artefact publié — `dist/esm/.../tile-math.js` n'exportait
// que `latLngToTile`. Storage, seul consommateur, les atteignait par un alias vers ces SOURCES,
// ce qui lui interdisait un `rootDir`.
//
// ⚠️ Leçon à garder : un sous-chemin publié ne garantit que le FICHIER. Son CONTENU dépend du
// tree-shaking du paquet qui l'émet — un symbole qu'aucun code du paquet n'appelle n'est pas
// dans l'artefact, quoi qu'annonce la carte `exports`. `check-subpath-resolve` ne voit pas
// cette classe : il vérifie l'existence des cibles, pas la présence des symboles.

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
