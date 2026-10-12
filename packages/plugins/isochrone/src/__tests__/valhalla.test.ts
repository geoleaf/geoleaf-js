/**
 * @geoleaf-plugins/isochrone — the Valhalla adapter
 *
 * 🛑 **Nothing here touches the network.** `fetch` is replaced for the whole file, and what it
 * answers comes from the versioned corpus — the same files the normaliser is tested against.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { IsochroneRequest, TravelMode } from "../model.js";
import { createValhallaProvider } from "../providers/valhalla.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, "../../fixtures");

/**
 * Reads one capture.
 *
 * @param name File name under `fixtures/`.
 * @returns The status the engine answered, and its body.
 */
function capture(name: string): { status: number; body: unknown } {
    return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8")) as {
        status: number;
        body: unknown;
    };
}

const NOMINAL = capture("valhalla-isochrone-nominal.json");
const REFUSED = capture("valhalla-isochrone-refused-duration.json");

const ENDPOINT = "https://engine.example/valhalla";
const OPTIONS = { query: {}, timeoutMs: 1000 };

/**
 * Builds a request from Saint-Denis, the origin the corpus was captured on.
 *
 * @param minutes Durations asked.
 * @param mode Travel mode.
 * @returns The request.
 */
function request(minutes: number[], mode: TravelMode = "car"): IsochroneRequest {
    return { origin: [55.4504, -20.8823], mode, minutes, signal: new AbortController().signal };
}

/** The URLs the replaced `fetch` was called with. */
let urls: string[] = [];

/**
 * Installs a `fetch` that answers `body`.
 *
 * @param body What the engine answers, or an error for a body that cannot be read.
 * @param status HTTP status.
 */
function answering(body: unknown, status = 200): void {
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
            urls.push(url);
            return {
                ok: status >= 200 && status < 300,
                status,
                json: async () => {
                    if (body instanceof Error) throw body;
                    return body;
                },
            };
        })
    );
}

/** The page's namespace, reached without assuming the core's global declaration is loaded. */
const host = globalThis as { GeoLeaf?: unknown };
const previous = host.GeoLeaf;
let warn = vi.fn();

beforeEach(() => {
    urls = [];
    warn = vi.fn();
    host.GeoLeaf = { Log: { warn } };
});

afterEach(() => {
    vi.unstubAllGlobals();
    host.GeoLeaf = previous;
});

describe("@geoleaf-plugins/isochrone — what the Valhalla adapter declares", () => {
    it("names itself, credits the data it routes on, and states its limits", () => {
        const provider = createValhallaProvider(ENDPOINT, OPTIONS);
        expect(provider.id).toBe("valhalla");
        expect(provider.attribution).toBe("© OpenStreetMap contributors");
        expect(provider.limits).toEqual({ maxContours: 4, maxMinutes: 120 });
    });
});

describe("@geoleaf-plugins/isochrone — the request the Valhalla adapter sends", () => {
    it("asks the isochrone action of the address, with the question in `json`", async () => {
        answering(NOMINAL.body);
        await createValhallaProvider(ENDPOINT, OPTIONS).isochrone(request([5, 10, 15]));

        expect(urls).toHaveLength(1);
        const url = new URL(urls[0] ?? "");
        expect(`${url.origin}${url.pathname}`).toBe("https://engine.example/valhalla/isochrone");
        expect(JSON.parse(url.searchParams.get("json") ?? "")).toEqual({
            // The model carries `[lon, lat]`; the engine takes `{lat, lon}`.
            locations: [{ lat: -20.8823, lon: 55.4504 }],
            costing: "auto",
            contours: [{ time: 5 }, { time: 10 }, { time: 15 }],
            polygons: true,
        });
    });

    it.each([
        ["car", "auto"],
        ["foot", "pedestrian"],
        ["bike", "bicycle"],
    ] as const)("maps the mode %s onto the costing %s", async (mode, costing) => {
        answering(NOMINAL.body);
        await createValhallaProvider(ENDPOINT, OPTIONS).isochrone(request([5], mode));
        const url = new URL(urls[0] ?? "");
        expect(JSON.parse(url.searchParams.get("json") ?? "").costing).toBe(costing);
    });

    it("falls back on the car costing for a mode it does not know", async () => {
        answering(NOMINAL.body);
        await createValhallaProvider(ENDPOINT, OPTIONS).isochrone(
            request([5], "plane" as TravelMode)
        );
        const url = new URL(urls[0] ?? "");
        expect(JSON.parse(url.searchParams.get("json") ?? "").costing).toBe("auto");
    });

    it("adds the host's query parameters, and never lets one replace the question", async () => {
        answering(NOMINAL.body);
        const provider = createValhallaProvider(ENDPOINT, {
            query: { api_key: "k", json: "not the question" },
            timeoutMs: 1000,
        });
        await provider.isochrone(request([5]));
        const url = new URL(urls[0] ?? "");
        expect(url.searchParams.get("api_key")).toBe("k");
        expect(url.searchParams.getAll("json")).toHaveLength(1);
        expect(JSON.parse(url.searchParams.get("json") ?? "").costing).toBe("auto");
    });
});

describe("@geoleaf-plugins/isochrone — what the Valhalla adapter answers", () => {
    it("answers one zone per duration asked, read from the captured body", async () => {
        answering(NOMINAL.body, NOMINAL.status);
        const out = await createValhallaProvider(ENDPOINT, OPTIONS).isochrone(request([5, 10, 15]));
        expect(out.ok && out.contours.map((c) => c.minutes)).toEqual([5, 10, 15]);
        expect(warn).not.toHaveBeenCalled();
    });

    it("answers `http` with the status and the engine's code, from the captured refusal", async () => {
        expect(REFUSED.status).toBe(400);
        answering(REFUSED.body, REFUSED.status);
        const out = await createValhallaProvider(ENDPOINT, OPTIONS).isochrone(request([90]));
        expect(out).toEqual({ ok: false, reason: "http", status: 400, code: 151 });
    });

    it("keeps the two numbers of a refusal, and none of the text the engine wrote", async () => {
        const text = (REFUSED.body as { error: string }).error;
        expect(text.length).toBeGreaterThan(0);
        answering(REFUSED.body, REFUSED.status);
        const out = await createValhallaProvider(ENDPOINT, OPTIONS).isochrone(request([90]));
        expect(JSON.stringify(out)).not.toContain(text);
        expect(warn.mock.calls.flat().map(String).join(" ")).not.toContain(text);
    });

    it.each([
        ["cannot be read", new SyntaxError("Unexpected token <")],
        ["carries no code", { error: "nope" }],
        ["carries a code that is not a whole number", { error_code: "151" }],
        ["carries a fractional code", { error_code: 151.5 }],
        ["is null", null],
    ])("answers the status alone when the refusal %s", async (_label, body) => {
        answering(body, 429);
        const out = await createValhallaProvider(ENDPOINT, OPTIONS).isochrone(request([5]));
        expect(out).toEqual({ ok: false, reason: "http", status: 429 });
    });

    it("answers `malformed` when a duration asked is missing from a 200", async () => {
        answering(NOMINAL.body);
        const out = await createValhallaProvider(ENDPOINT, OPTIONS).isochrone(request([5, 20]));
        expect(out).toEqual({ ok: false, reason: "malformed" });
    });

    it("answers `network` without calling anything when the address cannot be read", async () => {
        answering(NOMINAL.body);
        const out = await createValhallaProvider("not an address", OPTIONS).isochrone(request([5]));
        expect(out).toEqual({ ok: false, reason: "network" });
        expect(urls).toEqual([]);
    });
});

describe("@geoleaf-plugins/isochrone — what the Valhalla adapter logs", () => {
    it("logs a failure with the origin and the path of the URL, and its numbers", async () => {
        answering(REFUSED.body, REFUSED.status);
        await createValhallaProvider(ENDPOINT, OPTIONS).isochrone(request([90]));
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toBe(
            "[isochrone] https://engine.example/valhalla/isochrone — http (400 · 151)"
        );
    });

    it("logs a failure that carries no number without empty brackets", async () => {
        answering(NOMINAL.body);
        await createValhallaProvider(ENDPOINT, OPTIONS).isochrone(request([5, 20]));
        expect(warn.mock.calls[0]?.[0]).toBe(
            "[isochrone] https://engine.example/valhalla/isochrone — malformed"
        );
    });

    it("logs nothing for a cancellation: the user asked for it", async () => {
        answering(NOMINAL.body);
        const caller = new AbortController();
        caller.abort();
        const out = await createValhallaProvider(ENDPOINT, OPTIONS).isochrone({
            ...request([5]),
            signal: caller.signal,
        });
        expect(out).toEqual({ ok: false, reason: "aborted" });
        expect(warn).not.toHaveBeenCalled();
    });
});
