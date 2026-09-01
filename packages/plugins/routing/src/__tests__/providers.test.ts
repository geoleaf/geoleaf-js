/**
 * @geoleaf-plugins/routing — the two engine adapters
 *
 * 🛑 **Nothing here touches the network.** `fetch` is replaced for the whole file, and the bodies
 * it answers come from the versioned corpus — the same files the normalisers are tested against.
 * That is decision D4, and it is not caution: a test hitting a public instance is subject to a
 * fair-use quota and makes the run non-reproducible, so its red would say "the internet moved".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createValhallaProvider } from "../providers/valhalla.js";
import { createOsrmProvider } from "../providers/osrm.js";
import { normalizeValhalla } from "../normalize-valhalla.js";
import { normalizeOsrm } from "../normalize-osrm.js";
import type { RouteRequest } from "../model.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, "../../fixtures");

/**
 * Reads one fixture.
 *
 * @param name File name under `fixtures/`.
 * @returns The parsed body.
 */
function fixture(name: string): unknown {
    return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));
}

const VALHALLA_BODY = fixture("valhalla-reunion-3-waypoints.json");
const OSRM_BODY = fixture("osrm-reunion-3-waypoints.json");

/** The trip the corpus was captured on. */
const REQUEST: RouteRequest = {
    waypoints: [
        { coordinates: [55.4504, -20.8823], name: "Saint-Denis" },
        { coordinates: [55.2708, -21.0096] },
        { coordinates: [55.4781, -21.3393] },
    ],
    profile: "car",
    language: "fr-FR",
};

/** What the replaced `fetch` was called with, so the request itself can be asserted. */
let calls: { url: string; init: RequestInit }[] = [];

/**
 * Installs a `fetch` that answers `body`.
 *
 * @param body What the engine answers.
 * @param status HTTP status.
 */
function answering(body: unknown, status = 200): void {
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init: RequestInit) => {
            calls.push({ url, init });
            return {
                ok: status >= 200 && status < 300,
                status,
                json: async () => body,
            } as unknown as Response;
        })
    );
}

beforeEach(() => {
    calls = [];
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("valhalla adapter", () => {
    it("answers exactly what the normaliser answers on the same body", async () => {
        // 🛑 The assertion that pins the adapter as THIN. Every unit, order and precision fix
        // lives in the normaliser; if the adapter converted anything of its own, the two would
        // differ here — and only here, since the fixture is what the normaliser is tested on.
        answering(VALHALLA_BODY);
        const res = await createValhallaProvider("https://valhalla.example").route(REQUEST);
        expect(res.ok).toBe(true);
        expect(res.ok && res.route).toEqual(normalizeValhalla(VALHALLA_BODY));
    });

    it("sends {lat, lon} — the order swap the model does NOT use", async () => {
        answering(VALHALLA_BODY);
        await createValhallaProvider("https://valhalla.example").route(REQUEST);
        const body = JSON.parse(String(calls[0].init.body));
        expect(body.locations[0]).toEqual({ lat: -20.8823, lon: 55.4504 });
    });

    it("asks the SERVER for the narrative, in the requested language", async () => {
        // The reason this engine is first rank. Translating manoeuvres client-side would mean
        // shipping and maintaining a corpus of turn phrases per locale, for a string the server
        // already writes.
        answering(VALHALLA_BODY);
        await createValhallaProvider("https://valhalla.example").route(REQUEST);
        const body = JSON.parse(String(calls[0].init.body));
        expect(body.directions_options.language).toBe("fr-FR");
        expect(body.directions_options.units).toBe("kilometers");
    });

    it("omits `language` entirely when none was asked for", async () => {
        // Absent, not `""`: an empty tag is a request for a language named "", which a server is
        // free to answer however it likes.
        answering(VALHALLA_BODY);
        await createValhallaProvider("https://valhalla.example").route({
            ...REQUEST,
            language: undefined,
        });
        const body = JSON.parse(String(calls[0].init.body));
        expect("language" in body.directions_options).toBe(false);
    });

    it("maps the travel profile onto Valhalla's costing vocabulary", async () => {
        answering(VALHALLA_BODY);
        const p = createValhallaProvider("https://valhalla.example");
        for (const [profile, costing] of [
            ["car", "auto"],
            ["foot", "pedestrian"],
            ["bike", "bicycle"],
        ] as const) {
            calls = [];
            await p.route({ ...REQUEST, profile });
            expect(JSON.parse(String(calls[0].init.body)).costing).toBe(costing);
        }
    });

    it("does not double the slash when the endpoint carries a trailing one", async () => {
        answering(VALHALLA_BODY);
        await createValhallaProvider("https://valhalla.example/").route(REQUEST);
        expect(calls[0].url).toBe("https://valhalla.example/route");
    });
});

describe("osrm adapter", () => {
    it("answers exactly what the normaliser answers on the same body", async () => {
        answering(OSRM_BODY);
        const res = await createOsrmProvider("https://osrm.example").route(REQUEST);
        expect(res.ok).toBe(true);
        expect(res.ok && res.route).toEqual(normalizeOsrm(OSRM_BODY));
    });

    it("sends lon,lat in the path — the model's own order, no swap", async () => {
        answering(OSRM_BODY);
        await createOsrmProvider("https://osrm.example").route(REQUEST);
        expect(calls[0].url).toContain("/55.4504,-20.8823;55.2708,-21.0096;55.4781,-21.3393");
    });

    it("asks for a POLYLINE geometry, never GeoJSON", async () => {
        // Asking for GeoJSON would buy a second decoding path for the one engine that does not
        // need it — Valhalla only ever emits an encoded polyline.
        answering(OSRM_BODY);
        await createOsrmProvider("https://osrm.example").route(REQUEST);
        expect(calls[0].url).toContain("geometries=polyline");
        expect(calls[0].url).toContain("steps=true");
    });

    it("maps the travel profile onto OSRM's profile vocabulary", async () => {
        answering(OSRM_BODY);
        const p = createOsrmProvider("https://osrm.example");
        for (const [profile, name] of [
            ["car", "driving"],
            ["foot", "walking"],
            ["bike", "cycling"],
        ] as const) {
            calls = [];
            await p.route({ ...REQUEST, profile });
            expect(calls[0].url).toContain(`/route/v1/${name}/`);
        }
    });
});

describe("the four failures are NAMED, and none of them yields a partial route", () => {
    const cases = [
        ["valhalla", () => createValhallaProvider("https://x.example")],
        ["osrm", () => createOsrmProvider("https://x.example")],
    ] as const;

    it.each(cases)("%s — a non-2xx is `http`, and carries the status", async (_id, make) => {
        // A 429 is a quota and a 400 is a bad request. The caller can act on neither, but the
        // message must not suggest otherwise — which is why the status travels with the reason.
        answering({}, 429);
        const res = await make().route(REQUEST);
        expect(res).toEqual({ ok: false, reason: "http", status: 429 });
    });

    it.each(cases)("%s — a body that is not JSON is `malformed`", async (_id, make) => {
        // Distinct from `http` on purpose: the engine believed it answered, so the fault is in
        // the shape and not in the request. Telling the user to retry would be wrong.
        vi.stubGlobal(
            "fetch",
            vi.fn(
                async () =>
                    ({
                        ok: true,
                        status: 200,
                        json: async () => {
                            throw new SyntaxError("Unexpected token <");
                        },
                    }) as unknown as Response
            )
        );
        const res = await make().route(REQUEST);
        expect(res).toEqual({ ok: false, reason: "malformed" });
    });

    it.each(cases)("%s — an aborted request is `timeout`", async (_id, make) => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                const e = new Error("aborted");
                e.name = "AbortError";
                throw e;
            })
        );
        const res = await make().route(REQUEST);
        expect(res).toEqual({ ok: false, reason: "timeout" });
    });

    it.each(cases)("%s — anything else thrown is `network`", async (_id, make) => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new TypeError("Failed to fetch");
            })
        );
        const res = await make().route(REQUEST);
        expect(res).toEqual({ ok: false, reason: "network" });
    });

    it("valhalla — an unroutable pair is `no-route`, NOT an error", async () => {
        // 🛑 An ordinary answer about the map: two points on different islands have none.
        // Rendering it as "an error occurred" is a lie, and it tells the user to retry something
        // that will never work.
        answering({ trip: { status: 171, status_message: "No path could be found", legs: [] } });
        const res = await createValhallaProvider("https://x.example").route(REQUEST);
        expect(res).toEqual({ ok: false, reason: "no-route" });
    });

    it("osrm — a `NoRoute` code with HTTP 200 is `no-route`", async () => {
        answering({ code: "NoRoute", routes: [] });
        const res = await createOsrmProvider("https://x.example").route(REQUEST);
        expect(res).toEqual({ ok: false, reason: "no-route" });
    });

    it("no failure ever carries a route — not even an empty one", async () => {
        // An empty `RouteResult` would be indistinguishable from a zero-length route, and a
        // consumer reading `res.route.distance` on a failure would render "0 m" as an answer.
        answering({}, 500);
        for (const [, make] of cases) {
            const res = await make().route(REQUEST);
            expect("route" in res).toBe(false);
        }
    });
});
