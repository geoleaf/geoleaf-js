/*!
 * @geoleaf-plugins/routing — OSRM response normaliser
 *
 * Turns an OSRM `/route/v1` response into a `RouteResult`. Pure: no network, no globals.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { OSM_ATTRIBUTION } from "./providers/http.js";
import type { RouteResult, RouteLeg, RouteStep, Waypoint } from "./model.js";

/**
 * ## Why this one is nearly a copy, and why that is the point
 *
 * `RouteResult` is deliberately OSRM-shaped, so this normaliser is mostly a projection: metres
 * stay metres, seconds stay seconds, the polyline is already at precision 5, and the manoeuvre
 * vocabulary is already the target one. That is the intended asymmetry — the identity buys a
 * trivial adapter here and a real one for every engine that projects onto OSRM.
 *
 * ⚠️ **The one thing this normaliser cannot produce is a narrative.** Measured on the public
 * instance: its steps carry `maneuver.type` and `maneuver.modifier`, never a sentence. So
 * `RouteStep.instruction` comes back undefined for every step, and guidance built on OSRM alone
 * is mute. That is a property of the provider, not a gap in this file.
 */

/** One raw OSRM step. */
interface OsrmStep {
    distance?: number;
    duration?: number;
    name?: string;
    maneuver?: { type?: string; modifier?: string; location?: number[] };
}

/** One raw OSRM leg. */
interface OsrmLeg {
    distance?: number;
    duration?: number;
    steps?: OsrmStep[];
}

/** One raw OSRM waypoint. */
interface OsrmWaypoint {
    name?: string;
    location?: number[];
}

/** Minimal shape this normaliser reads. Anything else in the response is ignored. */
interface OsrmResponse {
    code?: string;
    routes?: {
        distance?: number;
        duration?: number;
        geometry?: string;
        legs?: OsrmLeg[];
    }[];
    waypoints?: OsrmWaypoint[];
}

/**
 * Normalises an OSRM response.
 *
 * @param raw The parsed response body.
 * @returns The route, or `null` when the response carries none.
 */
export function normalizeOsrm(raw: unknown): RouteResult | null {
    const res = raw as OsrmResponse;
    if (res?.code !== "Ok") return null;

    const route = res.routes?.[0];
    if (!route || !Array.isArray(route.legs) || route.legs.length === 0) return null;

    const legs: RouteLeg[] = route.legs.map((leg) => ({
        distance: num(leg.distance),
        duration: num(leg.duration),
        steps: (leg.steps ?? []).map(toStep),
    }));

    return {
        distance: num(route.distance),
        duration: num(route.duration),
        legs,
        // Already precision 5 — the target. Re-encoding it would be a lossless no-op at best.
        geometry: typeof route.geometry === "string" ? route.geometry : "",
        waypoints: (res.waypoints ?? []).map(toWaypoint),
        provider: "osrm",
        attribution: OSM_ATTRIBUTION,
    };
}

/**
 * One OSRM step.
 *
 * @param step The raw step.
 * @returns The normalised step.
 */
function toStep(step: OsrmStep): RouteStep {
    const m = step.maneuver ?? {};
    const base: RouteStep = {
        distance: num(step.distance),
        duration: num(step.duration),
        // `""` for an unnamed way, never a placeholder: an unnamed road is a fact about the map,
        // and "Unnamed road" would put a fabricated string in front of a user.
        name: typeof step.name === "string" ? step.name : "",
        maneuver: typeof m.type === "string" ? m.type : "",
        location: toCoords(m.location),
    };
    // `modifier` is absent on `depart` and `arrive`; spreading conditionally keeps it absent
    // rather than present-and-empty, which a consumer would render as a blank direction.
    return typeof m.modifier === "string" ? { ...base, modifier: m.modifier } : base;
}

/**
 * One OSRM waypoint, as SNAPPED to the network.
 *
 * @param wp The raw waypoint.
 * @returns The normalised waypoint.
 */
function toWaypoint(wp: OsrmWaypoint): Waypoint {
    const coordinates = toCoords(wp.location);
    // OSRM answers `""` for a waypoint on an unnamed way. Carrying an empty name is worse than
    // carrying none: `name?: string` means "the caller may label this", and "" is not a label.
    return wp.name ? { coordinates, name: wp.name } : { coordinates };
}

/**
 * `[lon, lat]`, already OSRM's order.
 *
 * @param loc The raw pair.
 * @returns The coordinates, `[0, 0]` when the pair is unusable.
 */
function toCoords(loc: number[] | undefined): readonly [number, number] {
    return Array.isArray(loc) && loc.length >= 2 ? [num(loc[0]), num(loc[1])] : [0, 0];
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
