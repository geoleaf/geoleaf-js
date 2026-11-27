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
 * The core's caps on a tile preparation (`CacheCalculator.defaults`): a zoom covering more tiles
 * than this is SKIPPED, and the enumeration stops at the total cap. Mirrored here, not imported:
 * the core prunes the calculator from its published artifact (see this file's header).
 */
const CORE_MAX_TILES_PER_ZOOM = 30_000;
const CORE_MAX_TOTAL_TILES = 200_000;

/** What the estimate leaves out, as the core's preparation will. */
interface VectorZoneEstimate {
    readonly tiles: number;
    readonly bytes: number;
    /** Zoom levels the core skips — too many tiles. */
    readonly skippedZooms: readonly number[];
    /** Whether the total cap cuts the enumeration. */
    readonly capped: boolean;
}

/**
 * Pre-download estimation of what the core's preparation will REALLY fetch: tile count over the
 * zoom range, with the core's caps applied, plus the total gzip weight.
 *
 * 🛑 THE ESTIMATE AND THE DOWNLOAD SPEAK OF THE SAME PERIMETER. The arithmetic count is kept — it
 * fixed an under-estimation, a 2°×2° zone at zoom 15 counting 0 — but a zoom the core skips is no
 * longer added: « ~69,40 GB (2425840 tuiles) » was announced for a preparation that fetched
 * 18 MB, the core having skipped every zoom past its per-zoom cap.
 *
 * @param zone - Zone and zoom range to estimate.
 * @returns The tiles and bytes the core will fetch, and what it will leave out.
 */
export function estimateVectorZone(zone: VectorZone): VectorZoneEstimate {
    let tiles = 0;
    let capped = false;
    const skippedZooms: number[] = [];
    for (let z = zone.cacheMinZoom; z <= zone.cacheMaxZoom; z++) {
        const atZoom = countTilesForBounds(zone.bounds, z);
        if (atZoom > CORE_MAX_TILES_PER_ZOOM) {
            skippedZooms.push(z);
            continue;
        }
        if (tiles + atZoom > CORE_MAX_TOTAL_TILES) {
            tiles = CORE_MAX_TOTAL_TILES;
            capped = true;
            break;
        }
        tiles += atZoom;
    }
    return { tiles, bytes: tiles * AVG_PBF_BYTES + GLYPH_SPRITE_OVERHEAD, skippedZooms, capped };
}
