/*!
 * @geoleaf-plugins/routing — OSRM adapter
 *
 * Builds an OSRM `/route/v1` request, calls it, and hands the body to the normaliser.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { IRouteProvider, RouteRequest, RouteOutcome } from "../model.js";
import { normalizeOsrm } from "../normalize-osrm.js";
import { fetchRouteJson, DEFAULT_TIMEOUT_MS, OSM_ATTRIBUTION } from "./http.js";
import { buildEngineUrl } from "../engine-url.js";

/**
 * ## The second provider is not redundancy, it is the test of the model
 *
 * `RouteResult` is OSRM-shaped, so this adapter is almost a pass-through — and that is exactly
 * why a second engine had to exist before the contract could be believed. A model validated
 * against one provider only proves it can describe that provider.
 *
 * ⚠️ **This engine emits no narrative.** Measured on the public instance: its steps carry a
 * manoeuvre type and a modifier, never a sentence. Nothing here can change that, and pretending
 * otherwise — by synthesising a phrase from the type — would put a string nobody wrote in front
 * of a user, in a language nobody chose.
 */

/** GeoLeaf travel profile → OSRM routing profile. */
const PROFILE: Readonly<Record<RouteRequest["profile"], string>> = {
    car: "driving",
    foot: "walking",
    bike: "cycling",
};

/**
 * Builds the OSRM adapter for one endpoint.
 *
 * @param endpoint Base URL, already accepted by `resolveEndpoint`.
 * @param timeoutMs How long the engine is given to answer.
 * @param query Query parameters every request must carry.
 * @returns The provider.
 */
export function createOsrmProvider(
    endpoint: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    query: Readonly<Record<string, string>> = {}
): IRouteProvider {
    return {
        id: "osrm",
        attribution: OSM_ATTRIBUTION,
        async route(request: RouteRequest): Promise<RouteOutcome> {
            // OSRM takes `lon,lat` in its path — the model's own order, so no swap here. The
            // ONE adapter that swaps is Valhalla's, and it says so where it does it.
            const coords = request.waypoints
                .map((w) => `${w.coordinates[0]},${w.coordinates[1]}`)
                .join(";");
            const profile = PROFILE[request.profile] ?? PROFILE.car;
            // `geometries=polyline` is OSRM's default and the model's precision — asking for
            // GeoJSON would buy a second decoding path for the one engine that does not need it.
            const url = buildEngineUrl(endpoint, `/route/v1/${profile}/${coords}`, {
                ...query,
                steps: "true",
                overview: "full",
                geometries: "polyline",
            });
            if (url === null) return { ok: false, reason: "refused" };

            const res = await fetchRouteJson(url, { method: "GET" }, timeoutMs);
            if (!res.ok) return res;

            const route = normalizeOsrm(res.body);
            // OSRM answers `code: "NoRoute"` with HTTP 200 when the points cannot be joined. An
            // ordinary answer about the map, not a malfunction.
            return route ? { ok: true, route } : { ok: false, reason: "no-route" };
        },
    };
}
