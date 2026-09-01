/*!
 * GeoLeaf Storage — Vector zone estimation
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Pre-download estimation of a vector zone: tile count and weight.
 *
 *
 * ## Why this code lives HERE and no longer in the core
 *
 * It was in `@geoleaf/core` (`capabilities/offline/cache/tile-math.ts`), and
 * storage reached it via a `@core-offline/*` alias to the core's SOURCES — which
 * forbade storage a `rootDir`, hence publishing its types.
 *
 * Repointing to the published subpath
 * `@geoleaf/core/capabilities/offline/cache/tile-math.js` **does not work**, and
 * the reason deserves writing: the file is published, but the SYMBOL is not in
 * it. The core's build prunes `estimateVectorZone` from its own artifact —
 * measured, `dist/esm/.../tile-math.js` exports only `latLngToTile` — because NO
 * core code calls it. A published subpath only guarantees the file; its content
 * depends on the emitting package's tree-shaking.
 *
 * So it was DEAD code on the core side (0 callers, absent from the bundle) and
 * alive on the storage side. It was moved, not copied: the core keeps no orphan
 * version of it.
 *
 * `latLngToTile` stays in the core — it serves 4 places there, survives the
 * build, and is imported here through the published subpath. Tile geometry is
 * the core's business; the bytes-per-tile heuristic is storage's.
 */

import { latLngToTile } from "@geoleaf/core/capabilities/offline/cache/tile-math.js";
import type { Bounds, VectorZone } from "@geoleaf/core/capabilities/offline/cache/tile-math.js";

/** Coupure de latitude Web Mercator. */
const WEB_MERCATOR_MAX_LAT = 85.0511;

/** Average gzip weight of a vector tile (.pbf), for zone estimation. */
const AVG_PBF_BYTES = 30 * 1024;

/** Glyphs + sprites flat fee, fetched once per zone whatever the tile count. */
const GLYPH_SPRITE_OVERHEAD = 800 * 1024;

/**
 * Counts the tiles covering `bounds` at `zoom`.
 *
 * ⚠️ Counts arithmetically, without enumerating coordinates: the old path went
 * through `getTileCoordsForBounds`, which returns an EMPTY list beyond its
 * safety cap of 30,000 tiles per zoom. Any zoom exceeding that cap therefore
 * contributed 0 to the total.
 *
 * @param bounds - Zone to cover. Absent or invalid bounds yield 0.
 * @param zoom - Zoom level.
 * @param maxLat - Latitude cut-off, forwarded to `latLngToTile`.
 */
function countTilesForBounds(
    bounds: Bounds | null | undefined,
    zoom: number,
    maxLat: number = WEB_MERCATOR_MAX_LAT
): number {
    if (!bounds || bounds.north <= bounds.south || bounds.east <= bounds.west) {
        return 0;
    }
    const minTile = latLngToTile(bounds.south, bounds.west, zoom, maxLat);
    const maxTile = latLngToTile(bounds.north, bounds.east, zoom, maxLat);
    return (Math.abs(maxTile.x - minTile.x) + 1) * (Math.abs(minTile.y - maxTile.y) + 1);
}

/**
 * Rough pre-download estimation: tile count over the zoom range, plus the total
 * gzip weight (tiles + glyphs/sprites flat fee).
 *
 * ⚠️ A silent UNDER-estimation was fixed here: a 2°×2° zone at zoom 15
 * (~33k tiles) already crossed the old implementation's cap and counted 0.
 *
 * @param zone - Zone and zoom range to estimate.
 * @returns `{ tiles, bytes }` — tile count and estimated size.
 */
export function estimateVectorZone(zone: VectorZone): { tiles: number; bytes: number } {
    let tiles = 0;
    for (let z = zone.cacheMinZoom; z <= zone.cacheMaxZoom; z++) {
        tiles += countTilesForBounds(zone.bounds, z);
    }
    return { tiles, bytes: tiles * AVG_PBF_BYTES + GLYPH_SPRITE_OVERHEAD };
}
