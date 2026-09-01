/*!
 * @geoleaf-plugins/navigation — Projection onto the route line
 *
 * Turns a raw GPS fix into a position ON the route, plus the three figures every other
 * guidance module reads off it.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import nearestPointOnLine from "@turf/nearest-point-on-line";
import { lineString, point } from "@turf/helpers";

/**
 * ## Why the runtime never decodes a polyline
 *
 * `RouteResult.geometry` is an encoded polyline, and this package may import only TYPES from
 * `@geoleaf-plugins/routing` — a value import would make the light package a runtime
 * prerequisite of the heavy one, which is the reverse of the dependency the split expresses.
 *
 * Copying the decoder here instead would be a fork, and this repository has a gate and a scar
 * for exactly that: a shared helper nobody re-read drifted from its nine copies in silence. So
 * the line arrives **already decoded**, from the caller that drew it. Guidance follows a
 * geometry; how that geometry was encoded is not its business.
 *
 * ## 🛑 Why the search is WINDOWED, and what happens without it
 *
 * Projecting each fix onto the whole line is wrong for guidance, and the failure is not
 * subtle. A route that passes near itself — a loop, a switchback, a hairpin, a street taken
 * twice — has two points of the line close together in SPACE and far apart ALONG it. A fix
 * near both projects onto whichever is a metre closer, and `distanceAlong` teleports.
 *
 * Measured on this package's own replayed trace before the window existed: remaining distance
 * went from 629 m back up to **775 m** between two consecutive fixes. On screen that is a
 * counter that counts up, and a counter that counts up makes a driver distrust the whole
 * display — including the parts that are right.
 *
 * So a fix is projected within a window around where the previous one landed — and the window
 * is bounded by SPEED, not by a fixed radius. Between two fixes separated by Δt, a vehicle
 * cannot advance more than v_max·Δt along the route; a projection that claims otherwise has
 * matched the wrong part of the line.
 *
 * 🛑 A fixed radius does not work, and this was measured rather than reasoned: with a ±300 m
 * window, the replayed trace still jumped **+171 m in 1.2 s** at a 90° corner — 513 km/h — and
 * then 147 m back on the next fix. The corner is not contrived: the perpendicular of one
 * branch is parallel to the other, and a user who leaves a route leaves it AT a junction.
 *
 * ⚠️ This is the jump filter of `measure/src/tools/tool-gps.ts` — `dist / Δt > max` — applied
 * to along-track progress instead of to the raw position. The other half of that filter, which
 * DROPS fixes below two metres, is deliberately not reused: dropping a fix would make a
 * stationary vehicle cease to exist and would stop a slow approach from ever reaching a stop.
 *
 * ⚠️ The window is skipped entirely when there is no previous position: after a suspension the
 * runtime genuinely does not know where the user is, and a window anchored to a stale value
 * would lock the projection to a place the user left twenty minutes ago. Same rule, same
 * reason, as the resume rule in `machine.ts`.
 */

/** A position in `[longitude, latitude]`, the order this repository uses everywhere. */
export type Position = readonly [number, number];

/**
 * A route line prepared for repeated projection.
 *
 * Built once per route: it carries the cumulative distance to each vertex, so a window can be
 * cut by distance rather than by counting vertices — vertices are not evenly spaced, and a
 * window of "20 vertices" is a window of anywhere between 20 m and 2 km.
 */
export interface RouteTrack {
    /** The geometry, decoded. */
    readonly line: readonly Position[];
    /** Cumulative distance from the start to each vertex, in METRES. Same length as `line`. */
    readonly cumulative: readonly number[];
    /** Total length, in METRES. */
    readonly length: number;
}

/** Where a fix falls on the route. */
export interface SnapResult {
    /** The fix projected onto the line. */
    readonly position: Position;
    /**
     * Distance from the raw fix to the line, in METRES.
     *
     * The figure a re-route threshold reads. Reported, never pre-judged: the threshold and its
     * hysteresis belong to the runtime and its configuration.
     */
    readonly distanceToLine: number;
    /** Distance travelled ALONG the line from its start to the projection, in METRES. */
    readonly distanceAlong: number;
}

/** Fallback speed ceiling when the caller gives no interval, in METRES PER SECOND (~200 km/h). */
const MAX_SPEED_MPS = 55;

/**
 * Prepares a line for repeated projection.
 *
 * @param line The route geometry, decoded, in `[longitude, latitude]` order.
 * @returns The prepared track. A line of fewer than two positions yields a zero-length track
 *          rather than throwing — a degenerate route must not take the page down.
 */
export function buildTrack(line: readonly Position[]): RouteTrack {
    const cumulative: number[] = [0];
    for (let i = 1; i < line.length; i++) {
        cumulative.push(
            (cumulative[i - 1] as number) + haversine(line[i - 1] as Position, line[i] as Position)
        );
    }
    return { line, cumulative, length: cumulative[cumulative.length - 1] ?? 0 };
}

/**
 * Projects a fix onto a route track.
 *
 * @param track The prepared track.
 * @param fix   The raw position from the platform.
 * @param near  Distance along the line at the previous accepted fix, in METRES, or `null` when
 *              there is none — at the start, and after a suspension. See the windowing note.
 * @param elapsedSeconds Seconds since the previous accepted fix, which bounds how far the
 *                        projection may advance. `null` falls back to one second's travel at
 *                        the ceiling — never to an unbounded search, which is the defect this
 *                        parameter exists to prevent.
 * @returns Where the fix falls, or `null` when the track is too short to project onto.
 */
export function snapToTrack(
    track: RouteTrack,
    fix: Position,
    near: number | null = null,
    elapsedSeconds: number | null = null
): SnapResult | null {
    if (track.line.length < 2) return null;

    const maxAdvance =
        elapsedSeconds === null || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0
            ? MAX_SPEED_MPS
            : MAX_SPEED_MPS * elapsedSeconds;
    // 🛑 The lower bound is the anchor itself: the projection admits NO backtrack.
    //
    // A route is not un-travelled. Noise that would pull the projection
    // backwards leaves it in place, and a real U-turn leaves the line — which
    // confirms an exit, requests a recompute, and releases the anchor. The
    // 25 m tolerance tried first was exactly what made the remainder CLIMB by
    // 24 m mid-guidance: a climbing counter makes the whole screen doubtful,
    // including what is right.
    const from = near === null ? 0 : near;
    const to = near === null ? track.length : Math.min(track.length, near + maxAdvance);
    const slice = sliceByDistance(track, from, to);
    if (slice.line.length < 2) return null;

    const snapped = nearestPointOnLine(
        lineString(slice.line.map((p) => [p[0], p[1]])),
        point([fix[0], fix[1]]),
        { units: "meters" }
    );
    const coords = snapped.geometry.coordinates;

    // 🛑 The result is bounded, not just the slice. `sliceByDistance` keeps
    // its vertices WHOLE, so the slice overflows the window by one segment on
    // each side — measured, 101 m/s of progress where the bound asked 55.
    // Bounding the slice without bounding the result is a guard that looks
    // set and does not hold.
    //
    // ⚠️ Only `distanceAlong` is bounded. `distanceToLine` stays what was
    // measured: it is the figure the exit detection reads, and truncating it
    // would make a user moving away look close to the line — exactly the
    // opposite of what it serves to see.
    const along = slice.offset + (snapped.properties.location ?? 0);

    return {
        position: [coords[0] as number, coords[1] as number],
        distanceToLine: snapped.properties.dist ?? 0,
        distanceAlong: Math.min(Math.max(along, from), to),
    };
}

/**
 * The portion of a track between two distances along it.
 *
 * ⚠️ The bounding vertices are kept whole rather than interpolated. The extra length that adds
 * at each end is accounted for by `offset`, so `distanceAlong` stays exact; interpolating
 * would buy a shorter slice at the cost of a second geodesic convention to keep in step with
 * the first.
 *
 * @param track The track.
 * @param from  Lower bound, in METRES along the line.
 * @param to    Upper bound, in METRES along the line.
 * @returns The slice, and the distance along the full line at which it starts.
 */
function sliceByDistance(
    track: RouteTrack,
    from: number,
    to: number
): { line: readonly Position[]; offset: number } {
    let start = 0;
    while (start + 1 < track.line.length && (track.cumulative[start + 1] as number) < from) start++;
    let end = start;
    while (end + 1 < track.line.length && (track.cumulative[end] as number) < to) end++;
    return { line: track.line.slice(start, end + 1), offset: track.cumulative[start] as number };
}

/**
 * Great-circle distance between two positions, in METRES.
 *
 * ⚠️ Written here rather than taken from `@turf/distance` so that the cumulative table and
 * turf's own `location` are built on the same earth radius. Mixing two conventions makes
 * `distanceAlong` drift from `cumulative` by a fraction of a percent — small, constant, and
 * exactly the kind of discrepancy that is blamed on GPS for months.
 *
 * @param a First position.
 * @param b Second position.
 * @returns Metres.
 */
function haversine(a: Position, b: Position): number {
    const R = 6371008.8;
    const toRad = Math.PI / 180;
    const dLat = (b[1] - a[1]) * toRad;
    const dLon = (b[0] - a[0]) * toRad;
    const s =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
