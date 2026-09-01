/*!
 * @geoleaf-plugins/offline-ui — Corridor tile enumeration
 *
 * Lists the tiles within a buffer of a route line, as an alternative to enumerating its
 * bounding box.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { latLngToTile } from "@geoleaf/core/capabilities/offline/cache/tile-math.js";

/**
 * ## ⛔ This path ADDS to the bbox path, it does not replace it
 *
 * A corridor costs roughly the line's length times the buffer; a bbox costs the
 * AREA of its rectangle. The two do not grow at the same rate, so which is
 * cheaper depends on scale — and the bbox wins over a whole domain that is not
 * marginal.
 *
 * **Measured by `scripts/probe-corridor-cost.mjs`**:
 *
 * | line             | diagonal  | verdict                                                     |
 * | ---------------- | --------- | ------------------------------------------------------------ |
 * | short, sinuous   | 3.0 km    | the bbox wins on **11 zooms out of 12**; beyond a 500 m       |
 * |                  |           | buffer, the corridor is **never** cheaper                    |
 * | medium, sinuous  | 14.9 km   | flips at zoom 12                                              |
 * | long, sinueux    | 59,7 km   | bascule au zoom 10                                            |
 * | long, diagonal   | 55.7 km   | flips at zoom 10                                              |
 * | **long, ALIGNED**| 43.7 km   | 🛑 the bbox wins on **all 12 zooms**, at **every** buffer     |
 *
 * 🛑 **The deciding factor is neither zoom, nor length, nor sinuosity: it is the
 * SHARE of the rectangle the line fills.** The last two rows have the same length
 * class and opposite verdicts — a diagonal has a SQUARE bounding rectangle, i.e.
 * the bbox's worst case, while an axis-aligned line has a thin rectangle, barely
 * wider than its own corridor, which the buffer suffices to overflow.
 *
 * ⚠️ The decision imposing this path speaks of "low zooms". A proxy, and two
 * approximations separate it from the true criterion: this run first concluded
 * "length", then "sinuosity", before measuring the aligned case that overturns
 * both. A UI offering the corridor alone would make a whole domain of ordinary
 * trips pay more — a coastal road, a valley, a motorway: all aligned.
 *
 * ## Why the line is resampled before being walked
 *
 * Two vertices a kilometre apart would leave a HOLE in the corridor at high
 * zoom: the tiles between them would never be visited. The rendered corridor
 * would be cheaper than the real one — and a too-low figure here would download
 * a holed zone, whose defect would only show while driving through it,
 * off-network.
 */

/** A position as `[longitude, latitude]`. */
export type Position = readonly [number, number];

/** A tile, by its grid coordinates. */
export interface TileRef {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

/** Web Mercator projection cut-off latitude — the same as the `offline` capability's. */
const WEB_MERCATOR_MAX_LAT = 85.0511;

/** Metres per degree of latitude. Constant; longitude contracts with the cosine. */
const METRES_PER_DEGREE = 111_320;

/**
 * The line, resampled so no step exceeds `stepM`.
 *
 * @param line  The line, as `[longitude, latitude]`.
 * @param stepM The maximum step, in METRES.
 * @returns The densified line. Returned as-is when it has fewer than two points —
 *          there is then no segment to subdivide, and looping over it would
 *          return an empty array.
 */
export function densify(line: readonly Position[], stepM: number): Position[] {
    if (line.length < 2 || !(stepM > 0)) return [...line];
    const out: Position[] = [];
    for (let i = 0; i < line.length - 1; i++) {
        const a = line[i] as Position;
        const b = line[i + 1] as Position;
        const metres = Math.hypot(
            (b[0] - a[0]) * METRES_PER_DEGREE * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180),
            (b[1] - a[1]) * METRES_PER_DEGREE
        );
        const steps = Math.max(1, Math.ceil(metres / stepM));
        for (let k = 0; k < steps; k++) {
            out.push([a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps]);
        }
    }
    out.push(line[line.length - 1] as Position);
    return out;
}

/**
 * A corridor's tiles, at one zoom.
 *
 * @param line    The line, as `[longitude, latitude]`.
 * @param zoom    The zoom level.
 * @param bufferM The buffer radius, in METRES.
 * @returns The distinct tiles, no order guaranteed. Empty when the line or
 *          buffer is degenerate — a corridor without a line is not an error, it
 *          is an empty corridor.
 */
export function corridorTilesAtZoom(
    line: readonly Position[],
    zoom: number,
    bufferM: number
): TileRef[] {
    if (line.length === 0 || !(bufferM > 0)) return [];

    const seen = new Set<string>();
    const out: TileRef[] = [];
    const dLat = bufferM / METRES_PER_DEGREE;

    for (const [lng, lat] of densify(line, bufferM)) {
        // Longitude contracts with latitude: a 500 m buffer covers more degrees
        // near the poles. Using dLat for both would under-estimate the corridor
        // at high latitudes — hence yield a holed zone where the network is
        // scarcest.
        const dLng = bufferM / (METRES_PER_DEGREE * Math.cos((lat * Math.PI) / 180));
        const a = latLngToTile(lat - dLat, lng - dLng, zoom, WEB_MERCATOR_MAX_LAT);
        const b = latLngToTile(lat + dLat, lng + dLng, zoom, WEB_MERCATOR_MAX_LAT);
        for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) {
            for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) {
                const key = `${x}/${y}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({ x, y, z: zoom });
            }
        }
    }
    return out;
}

/**
 * A corridor's tiles over a zoom range.
 *
 * @param line    The line.
 * @param minZoom Lowest zoom, inclusive.
 * @param maxZoom Highest zoom, inclusive.
 * @param bufferM The buffer radius, in METRES.
 * @returns The tiles, all zooms together. ⚠️ Keys are deduplicated ONLY per
 *          zoom: one zoom's `{x, y}` has nothing to do with the same pair at
 *          another.
 */
export function corridorTiles(
    line: readonly Position[],
    minZoom: number,
    maxZoom: number,
    bufferM: number
): TileRef[] {
    const out: TileRef[] = [];
    for (let z = Math.min(minZoom, maxZoom); z <= Math.max(minZoom, maxZoom); z++) {
        out.push(...corridorTilesAtZoom(line, z, bufferM));
    }
    return out;
}
