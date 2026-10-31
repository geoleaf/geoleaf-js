/*!
 * @geoleaf-plugins/routing — Valhalla adapter
 *
 * Builds a Valhalla request, calls it, and hands the body to the normaliser. Carries no
 * conversion of its own — every unit, order and precision fix lives in `normalize-valhalla.ts`.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { IRouteProvider, RouteRequest, RouteOutcome } from "../model.js";
import { normalizeValhalla } from "../normalize-valhalla.js";
import { fetchRouteJson, DEFAULT_TIMEOUT_MS, OSM_ATTRIBUTION } from "./http.js";
import { buildEngineUrl } from "../engine-url.js";

/**
 * ## Why this adapter is thin, and must stay thin
 *
 * It builds a request and forwards a body. It does NOT convert kilometres, does NOT re-encode the
 * polyline, does NOT map manoeuvre integers — all three live in the normaliser, which is tested
 * against a captured fixture of this very engine. Doing any of it here would put the same
 * conversion in two places, and the second one would drift silently: the fixture only exercises
 * the first.
 */

/** GeoLeaf travel profile → Valhalla costing model. */
const COSTING: Readonly<Record<RouteRequest["profile"], string>> = {
    car: "auto",
    foot: "pedestrian",
    bike: "bicycle",
};

/**
 * The `error_code` values by which Valhalla says that no route exists.
 *
 * 🛑 **Valhalla answers these with an HTTP 400, not with a `status` inside a success.** Measured on
 * a local instance: 171 for a stop too far from any road, 154 beyond the distance limit. Read as
 * a plain HTTP failure, they reached the user as "the service refused the request", the sentence
 * of a refused key, about a question that simply has no answer. 155 (outside the service area),
 * 170 (unconnected regions) and 442 (no path found) are the same answer in its documented forms.
 */
const NO_ROUTE_CODES: ReadonlySet<unknown> = new Set([154, 155, 170, 171, 442]);

/**
 * Names an HTTP error that is really an answer about the map.
 *
 * @param body The body of the error.
 * @returns `no-route` when the code says so, `null` for any other refusal.
 */
function classifyRefusal(body: unknown): "no-route" | null {
    const code = (body as { error_code?: unknown } | null)?.error_code;
    return NO_ROUTE_CODES.has(code) ? "no-route" : null;
}

/**
 * Builds the Valhalla adapter for one endpoint.
 *
 * @param endpoint Base URL, already accepted by `resolveEndpoint` — which is what refuses
 *                 anything that is not HTTPS.
 * @param timeoutMs How long the engine is given to answer.
 * @param query Query parameters every request must carry.
 * @returns The provider.
 */
export function createValhallaProvider(
    endpoint: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    query: Readonly<Record<string, string>> = {}
): IRouteProvider {
    return {
        id: "valhalla",
        attribution: OSM_ATTRIBUTION,
        async route(request: RouteRequest): Promise<RouteOutcome> {
            const body = {
                locations: request.waypoints.map((w) => ({
                    // ⚠️ Order swap: the model carries `[lon, lat]`, Valhalla takes `{lat, lon}`.
                    lat: w.coordinates[1],
                    lon: w.coordinates[0],
                })),
                costing: COSTING[request.profile] ?? COSTING.car,
                directions_options: {
                    // Metric, so the normaliser's kilometre conversion is the only one in play.
                    // Asking for miles would work — it handles both — but it would make the
                    // fixture and the live call disagree on the path exercised.
                    units: "kilometers",
                    // The narrative is asked of the SERVER, in the interface language. It is
                    // free, already written, and it spares the plugin a corpus of turn phrases.
                    ...(request.language ? { language: request.language } : {}),
                },
            };

            const url = buildEngineUrl(endpoint, "/route", query);
            if (url === null) return { ok: false, reason: "refused" };

            const res = await fetchRouteJson(
                url,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                },
                timeoutMs,
                classifyRefusal
            );
            if (!res.ok) return res;

            const route = normalizeValhalla(res.body);
            // 🛑 `no-route` and not `malformed`: a non-zero `status` is an ORDINARY answer about
            // the map. Reporting it as a malfunction would tell the user to retry something that
            // will never work. The usual form of that answer is the HTTP error `classifyRefusal`
            // reads; this branch covers the same answer inside a success.
            return route ? { ok: true, route } : { ok: false, reason: "no-route" };
        },
    };
}
