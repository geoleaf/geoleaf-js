/*!
 * @geoleaf-plugins/routing — Valhalla response normaliser
 *
 * Turns a Valhalla `/route` response into a `RouteResult`. Pure: no network, no globals.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { OSM_ATTRIBUTION } from "./providers/http.js";
import type { RouteResult, RouteLeg, RouteStep, Waypoint } from "./model.js";
import { decodePolyline, encodePolyline } from "./polyline.js";

/**
 * ## Everything that differs between the two engines is converted HERE
 *
 * `RouteResult` is OSRM-shaped, so this file carries the whole asymmetry. Three conversions,
 * each measured on the fixture corpus rather than read in a document:
 *
 *  1. **Kilometres to metres.** Valhalla answers `length` in kilometres when asked for metric
 *     units; the model is metres. Skipping this turns an 80 km trip into 80 metres, and every
 *     downstream threshold — "recompute beyond 50 m off route" — becomes nonsense.
 *  2. **Precision 6 to precision 5.** Valhalla's shape is encoded at 1e6. Decoded at the model's
 *     1e5 it reads latitude −208, which does not exist. Re-encoded here, once.
 *  3. **Integer manoeuvre types to OSRM's vocabulary.** Valhalla numbers its manoeuvres; the
 *     model names them. The table below is the mapping.
 *
 * ## And one thing this engine has that the other does not
 *
 * `instruction` — a localised sentence, when the request asked for a language. It is the reason
 * this provider is first rank, and it costs nothing: the server writes it.
 */

/** Valhalla's `units` value that means kilometres. Anything else is treated as miles. */
const KILOMETRES = "kilometers";

/** Metres in one mile, for the `units: "miles"` answer. */
const METRES_PER_MILE = 1609.344;

/**
 * Valhalla manoeuvre type → OSRM `[maneuver, modifier?]`.
 *
 * ⚠️ **Ten of these are exercised by the corpus** (3, 6, 9, 10, 15, 18, 20, 24, 26, 27); the
 * rest are written from Valhalla's published enumeration and are NOT covered by a fixture. That
 * distinction is stated because a reader would otherwise assume the whole table is verified —
 * and an unverified row here produces a manoeuvre that renders as the wrong arrow, silently.
 */
const MANEUVER_TABLE: Readonly<Record<number, readonly [string, string?]>> = {
    0: ["continue", "straight"],
    1: ["depart"],
    2: ["depart", "right"],
    3: ["depart", "left"],
    4: ["arrive"],
    5: ["arrive", "right"],
    6: ["arrive", "left"],
    7: ["new name", "straight"],
    8: ["continue", "straight"],
    9: ["turn", "slight right"],
    10: ["turn", "right"],
    11: ["turn", "sharp right"],
    12: ["continue", "uturn"],
    13: ["continue", "uturn"],
    14: ["turn", "sharp left"],
    15: ["turn", "left"],
    16: ["turn", "slight left"],
    17: ["on ramp", "straight"],
    18: ["on ramp", "right"],
    19: ["on ramp", "left"],
    20: ["off ramp", "right"],
    21: ["off ramp", "left"],
    22: ["fork", "straight"],
    23: ["fork", "right"],
    24: ["fork", "left"],
    25: ["merge", "straight"],
    26: ["roundabout"],
    27: ["exit roundabout"],
    28: ["notification"],
    29: ["notification"],
};

/** One raw Valhalla manoeuvre. */
interface ValhallaManeuver {
    type?: number;
    instruction?: string;
    street_names?: string[];
    length?: number;
    time?: number;
    begin_shape_index?: number;
}

/** One raw Valhalla leg. */
interface ValhallaLeg {
    maneuvers?: ValhallaManeuver[];
    summary?: { length?: number; time?: number };
    shape?: string;
}

/** Minimal shape this normaliser reads. */
interface ValhallaResponse {
    trip?: {
        status?: number;
        units?: string;
        legs?: ValhallaLeg[];
        summary?: { length?: number; time?: number };
        locations?: { lat?: number; lon?: number }[];
    };
}

/**
 * Normalises a Valhalla response.
 *
 * @param raw The parsed response body.
 * @returns The route, or `null` when the response carries none.
 */
export function normalizeValhalla(raw: unknown): RouteResult | null {
    const trip = (raw as ValhallaResponse)?.trip;
    if (!trip || trip.status !== 0) return null;
    if (!Array.isArray(trip.legs) || trip.legs.length === 0) return null;

    const toMetres = trip.units === KILOMETRES ? 1000 : METRES_PER_MILE;

    const shape: [number, number][] = [];
    const legs: RouteLeg[] = trip.legs.map((leg) => {
        // Valhalla carries one shape per LEG; the model carries one per route. Concatenating is
        // the whole conversion — the legs are contiguous by construction, the last point of one
        // being the first of the next.
        if (typeof leg.shape === "string" && leg.shape.length > 0) {
            const points = decodePolyline(leg.shape, 6);
            shape.push(...(shape.length > 0 ? points.slice(1) : points));
        }
        return {
            distance: num(leg.summary?.length) * toMetres,
            duration: num(leg.summary?.time),
            steps: (leg.maneuvers ?? []).map((m) => toStep(m, toMetres)),
        };
    });

    return {
        distance: num(trip.summary?.length) * toMetres,
        duration: num(trip.summary?.time),
        legs,
        geometry: encodePolyline(shape, 5),
        waypoints: (trip.locations ?? []).map(toWaypoint),
        provider: "valhalla",
        attribution: OSM_ATTRIBUTION,
    };
}

/**
 * One Valhalla manoeuvre.
 *
 * @param m The raw manoeuvre.
 * @param toMetres Factor from the response's length unit to metres.
 * @returns The normalised step.
 */
function toStep(m: ValhallaManeuver, toMetres: number): RouteStep {
    const [maneuver, modifier] = MANEUVER_TABLE[num(m.type)] ?? ["continue", "straight"];
    const base: RouteStep = {
        distance: num(m.length) * toMetres,
        duration: num(m.time),
        // Valhalla answers an ARRAY of street names — a way can carry several. The first is the
        // primary one; joining them would put "A1 / E15 / Route du Nord" where a name goes.
        name: m.street_names?.[0] ?? "",
        maneuver,
        // Not carried by Valhalla per-manoeuvre in the shape the model wants; the shape index is
        // an offset into the leg polyline, not a coordinate. Filled by the adapter when it has
        // the decoded shape — see the note in `model.ts` on what is measured and what is not.
        location: [0, 0],
    };
    const withModifier = modifier ? { ...base, modifier } : base;
    // The narrative is the reason this provider is first rank — but only when the request asked
    // for a language. Absent, the step stays instruction-less rather than carrying `""`.
    return m.instruction ? { ...withModifier, instruction: m.instruction } : withModifier;
}

/**
 * One Valhalla location, as SNAPPED to the network.
 *
 * @param loc The raw location.
 * @returns The normalised waypoint.
 */
function toWaypoint(loc: { lat?: number; lon?: number }): Waypoint {
    // ⚠️ Order swap: Valhalla answers `{lat, lon}`, the model carries `[lon, lat]`.
    return { coordinates: [num(loc.lon), num(loc.lat)] };
}

/**
 * A finite number, or 0.
 *
 * @param v Candidate.
 * @returns The number.
 */
function num(v: unknown): number {
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
