/**
 * @geoleaf-plugins/isochrone — a key reaches the engine, and nothing else
 *
 * A sentinel stands for a key given at runtime. It is followed through everything the plugin
 * can show: what its API answers, and every line it hands to a log.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildPublicApi } from "../public-api.js";
import { createProvider, registerProvider } from "../provider.js";
import "../providers/builtins.js";
import { maskUrl } from "../request-url.js";
import type { IIsochroneProvider, ProviderOptions } from "../model.js";

/** Stands for a key: it must reach the engine, and nothing else. */
const SENTINEL = "s3nt1nel-K3Y";

/** The page's namespace, reached without assuming the core's global declaration is loaded. */
const host = globalThis as { GeoLeaf?: unknown };
const previous = host.GeoLeaf;

/** Every line handed to the host's logger, whatever its level. */
let logged: unknown[][] = [];
/** Every line that reached the console directly. */
let printed: unknown[][] = [];

/** What a provider was built with — the one place the key is expected. */
let built: { endpoint: string; options: ProviderOptions }[] = [];

/**
 * Registers a provider that records how it was built.
 *
 * @param id Provider identifier.
 * @param attribution The credit it declares.
 */
function register(id: string, attribution: string): void {
    registerProvider(id, (endpoint, options) => {
        built.push({ endpoint, options });
        return {
            id,
            attribution,
            isochrone: async () => ({ ok: true, contours: [] }),
        } satisfies IIsochroneProvider;
    });
}

/**
 * Installs the profile branch, and a logger that records every level.
 *
 * @param branch The plugin's branch of the profile.
 */
function withProfileBranch(branch: Record<string, unknown>): void {
    const record = (...args: unknown[]): void => {
        logged.push(args);
    };
    host.GeoLeaf = {
        Log: { debug: record, info: record, warn: record, error: record },
        Config: {
            get: (key: string, fallback: unknown) =>
                key === "modules.isochrone" ? branch : fallback,
        },
    };
}

/**
 * Everything the plugin showed, flattened to text.
 *
 * @param shown Values the test collected from the API.
 * @returns One string holding the logs, the console and those values.
 */
function everythingShown(...shown: unknown[]): string {
    return JSON.stringify([logged, printed, shown], (_key, value: unknown) =>
        typeof value === "function" ? "[function]" : value
    );
}

beforeEach(() => {
    logged = [];
    printed = [];
    built = [];
    for (const level of ["debug", "info", "log", "warn", "error"] as const) {
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
            printed.push(args);
        });
    }
    withProfileBranch({});
});

afterEach(() => {
    buildPublicApi().configure(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    host.GeoLeaf = previous;
});

describe("@geoleaf-plugins/isochrone — the key travels to the engine", () => {
    it("hands the key to the provider, which is what sends it", () => {
        const api = buildPublicApi();
        register("keyed", "© Test data");
        withProfileBranch({ provider: "keyed", endpoint: "https://engine.example" });
        expect(api.configure({ query: { api_key: SENTINEL } })).toBe(true);
        api.getProvider();
        expect(built[0]?.options.query).toEqual({ api_key: SENTINEL });
    });
});

describe("@geoleaf-plugins/isochrone — and it shows nowhere else", () => {
    it("is absent from what the API answers once it has been given", () => {
        const api = buildPublicApi();
        register("keyed", "© Test data");
        withProfileBranch({ provider: "keyed", endpoint: "https://engine.example" });
        api.configure({ query: { api_key: SENTINEL } });
        expect(everythingShown(api.getProvider(), api.getConfig())).not.toContain(SENTINEL);
    });

    it("is absent from the report of a provider refused for its credit", () => {
        const api = buildPublicApi();
        register("uncredited", "   ");
        withProfileBranch({ provider: "uncredited", endpoint: "https://engine.example" });
        api.configure({ query: { api_key: SENTINEL } });
        expect(api.getProvider()).toBeNull();
        expect(logged).toHaveLength(1);
        expect(everythingShown()).not.toContain(SENTINEL);
    });

    it.each([
        ["an address in http", { endpoint: `http://engine.example/?api_key=${SENTINEL}` }],
        ["an address carrying it as credentials", { endpoint: `https://u:${SENTINEL}@e.example` }],
        ["the reserved parameter", { query: { json: SENTINEL } }],
        ["a parameter beside one that is refused", { query: { api_key: SENTINEL, n: 1 } }],
        ["a whole value that is not an object", SENTINEL],
    ])("is absent from the refusal of %s", (_label, overrides) => {
        const api = buildPublicApi();
        expect(api.configure(overrides as never)).toBe(false);
        expect(logged).toHaveLength(1);
        expect(everythingShown(api.getProvider(), api.getConfig())).not.toContain(SENTINEL);
    });

    it("never reaches the console directly, whatever happened above", () => {
        const api = buildPublicApi();
        api.configure({ endpoint: `http://engine.example/?api_key=${SENTINEL}` });
        api.configure({ query: { api_key: SENTINEL } });
        api.getProvider();
        expect(printed).toEqual([]);
    });
});

describe("@geoleaf-plugins/isochrone — through a request to the engine", () => {
    /** The URLs the replaced `fetch` was called with. */
    let urls: string[] = [];

    /**
     * Asks the built-in engine one zone, with the key given at runtime.
     *
     * @param respond What the replaced `fetch` does with the URL it receives.
     * @returns What the provider answered.
     */
    async function ask(respond: (url: string) => unknown): Promise<unknown> {
        urls = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string) => {
                urls.push(url);
                return respond(url);
            })
        );
        buildPublicApi().configure({ query: { api_key: SENTINEL } });
        return createProvider()?.isochrone({
            origin: [55.4504, -20.8823],
            mode: "car",
            minutes: [5],
            signal: new AbortController().signal,
        });
    }

    it.each([
        [
            "a refusal",
            // The engine echoes the request in its refusal — the worst case for a text kept.
            (url: string) => ({
                ok: false,
                status: 400,
                json: async () => ({ error_code: 151, error: `Refused: ${url}` }),
            }),
            "http",
        ],
        [
            "a request that does not go through",
            (url: string) => {
                throw new TypeError(`Failed to fetch ${url}`);
            },
            "network",
        ],
        [
            "an answer that cannot be read",
            () => ({ ok: true, status: 200, json: async () => ({ features: "none" }) }),
            "malformed",
        ],
    ])(
        "sends the key to the engine, and shows it nowhere, on %s",
        async (_label, respond, reason) => {
            const outcome = await ask(respond);
            expect(outcome).toMatchObject({ ok: false, reason });
            // It did travel: the test follows a key that is really sent.
            expect(new URL(urls[0] ?? "").searchParams.get("api_key")).toBe(SENTINEL);
            // And the failure was reported: the log is not empty by accident.
            expect(logged).toHaveLength(1);
            expect(everythingShown(outcome)).not.toContain(SENTINEL);
        }
    );

    it("is absent from the form of a URL that may reach a log", () => {
        expect(maskUrl(`https://engine.example/isochrone?api_key=${SENTINEL}`)).not.toContain(
            SENTINEL
        );
    });
});
