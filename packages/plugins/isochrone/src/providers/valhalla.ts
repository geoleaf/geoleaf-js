/*!
 * @geoleaf-plugins/isochrone — Valhalla adapter
 *
 * Builds a Valhalla isochrone request, calls it, and classifies what comes back. Carries no
 * conversion of its own — reading the zones lives in `normalize-valhalla.ts`.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import type {
    IIsochroneProvider,
    IsochroneOutcome,
    IsochroneRequest,
    ProviderLimits,
    ProviderOptions,
    TravelMode,
} from "../model.js";
import { Log } from "@geoleaf/host-runtime";
import { normalizeValhalla } from "../normalize-valhalla.js";
import { buildRequestUrl, maskUrl } from "../request-url.js";
import { fetchIsochroneJson } from "./http.js";

/** GeoLeaf travel mode → Valhalla costing model. */
const COSTING: Readonly<Record<TravelMode, string>> = {
    car: "auto",
    foot: "pedestrian",
    bike: "bicycle",
};

/**
 * What one request may carry.
 *
 * ⚠️ These are the values read in the configuration of a self-hosted instance, and NOT those
 * of the public one this adapter calls by default, which stops at 60 minutes. Declaring 60
 * would impose the demonstration server's cap on every instance an integrator points
 * `endpoint` at. So a duration between 61 and 120 minutes leaves for the default address and
 * comes back refused — late, but named: `http`, with the status and the engine's code.
 */
const LIMITS: ProviderLimits = { maxContours: 4, maxMinutes: 120 };

/**
 * The credit the built-in engine owes.
 *
 * ⚠️ It credits **OpenStreetMap**, not the engine: what requires attribution is the DATA it
 * routes on. An integrator pointing `endpoint` at an instance fed with something else must
 * register their own provider with their own credit — which is why `attribution` is a
 * required field of a provider and not a constant of the plugin.
 */
const OSM_ATTRIBUTION = "© OpenStreetMap contributors";

/**
 * Reads the engine's own code out of a refusal.
 *
 * A Valhalla refusal is `{ "error_code": 151, "error": "…", "status_code": 400, … }`. The
 * number is kept; the text is not — it is an external input, and nothing an engine wrote is
 * ever displayed or stored.
 *
 * @param refusal The parsed body of the refusal, when it could be read.
 * @returns The code, or `undefined` when the body carries no whole number there.
 */
function refusalCode(refusal: unknown): number | undefined {
    const code = ((refusal ?? {}) as { error_code?: unknown }).error_code;
    return typeof code === "number" && Number.isInteger(code) ? code : undefined;
}

/**
 * Writes a failure to the host's log, and hands it back.
 *
 * 🛑 **Only the origin and the path of the URL are written.** A key travels in the query
 * string, so the query never reaches a log — and neither does anything the engine wrote. A
 * cancellation is not logged at all: the user asked for it.
 *
 * @param url The URL that was called.
 * @param outcome The failure being answered.
 * @returns `outcome`, untouched.
 */
function reported(url: string, outcome: IsochroneOutcome & { ok: false }): IsochroneOutcome {
    if (outcome.reason !== "aborted") {
        const numbers = [outcome.status, outcome.code].filter((n) => n !== undefined).join(" · ");
        Log.warn(
            `[isochrone] ${maskUrl(url)} — ${outcome.reason}${numbers === "" ? "" : ` (${numbers})`}`
        );
    }
    return outcome;
}

/**
 * Builds the Valhalla adapter for one address.
 *
 * @param endpoint Base URL, already accepted by `resolveEndpoint` — which is what refuses
 *                 anything that is not HTTPS.
 * @param options Query parameters to add to every request, and the time the engine is given.
 * @returns The provider.
 */
export function createValhallaProvider(
    endpoint: string,
    options: ProviderOptions
): IIsochroneProvider {
    return {
        id: "valhalla",
        attribution: OSM_ATTRIBUTION,
        limits: LIMITS,
        async isochrone(request: IsochroneRequest): Promise<IsochroneOutcome> {
            const question = {
                // ⚠️ Order swap: the model carries `[lon, lat]`, Valhalla takes `{lat, lon}`.
                // It happens here, and nowhere else.
                locations: [{ lat: request.origin[1], lon: request.origin[0] }],
                costing: COSTING[request.mode] ?? COSTING.car,
                contours: request.minutes.map((time) => ({ time })),
                polygons: true,
            };

            // GET, the question in the URL: a simple request in the CORS sense, so no
            // preflight a front end we do not control would have to let through. ⚠️ `json`
            // is written LAST: a host parameter can never replace the question.
            const url = buildRequestUrl(endpoint, "/isochrone", {
                ...options.query,
                json: JSON.stringify(question),
            });
            if (url === null) return { ok: false, reason: "network" };

            const res = await fetchIsochroneJson(url, request.signal, options.timeoutMs);
            if (!res.ok) {
                const code = refusalCode(res.refusal);
                return reported(url, {
                    ok: false,
                    reason: res.reason,
                    ...(res.status !== undefined ? { status: res.status } : {}),
                    ...(code !== undefined ? { code } : {}),
                });
            }

            const contours = normalizeValhalla(res.body, request.minutes);
            return contours
                ? { ok: true, contours }
                : reported(url, { ok: false, reason: "malformed" });
        },
    };
}
