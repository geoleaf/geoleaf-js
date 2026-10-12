/**
 * @geoleaf-plugins/isochrone — the provider registry
 *
 * ⚠️ This file does NOT import `providers/builtins.js`, on purpose: the registry stays empty
 * of built-ins here, which is what lets "no provider registered" be exercised at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPluginConfig } from "../config.js";
import type { IIsochroneProvider, ProviderOptions } from "../model.js";
import { createProvider, getProvider, registerProvider, resolveEndpoint } from "../provider.js";
import { setOverrides } from "../runtime-overrides.js";

/** The page's namespace, reached without assuming the core's global declaration is loaded. */
const host = globalThis as { GeoLeaf?: unknown };
const previous = host.GeoLeaf;
let warn = vi.fn();

/** Installs a namespace carrying the plugin's branch of the profile and a spied logger. */
function withProfileBranch(branch: Record<string, unknown>): void {
    host.GeoLeaf = {
        Log: { warn },
        Config: {
            get: (key: string, fallback: unknown) =>
                key === "modules.isochrone" ? branch : fallback,
        },
    };
}

/** What a factory was called with, so the resolved address can be asserted. */
let built: { endpoint: string; options: ProviderOptions }[] = [];

/**
 * Registers a provider that records how it was built.
 *
 * @param id Provider identifier.
 * @param credit The credit it declares — a usable one when omitted.
 */
function register(id: string, ...credit: [attribution?: unknown]): void {
    // A rest parameter, not a default: `undefined` must be registrable as a credit, and a
    // default value would silently replace it.
    const attribution = credit.length > 0 ? credit[0] : "© Test data";
    registerProvider(id, (endpoint, options) => {
        built.push({ endpoint, options });
        return {
            id,
            attribution,
            isochrone: async () => ({ ok: true, contours: [] }),
        } as IIsochroneProvider;
    });
}

beforeEach(() => {
    warn = vi.fn();
    built = [];
    withProfileBranch({});
});

afterEach(() => {
    setOverrides(null);
    host.GeoLeaf = previous;
});

describe("@geoleaf-plugins/isochrone — createProvider", () => {
    it("answers null while no provider is registered under the configured name", () => {
        expect(createProvider()).toBeNull();
        expect(getProvider()).toBeNull();
    });

    it("answers null for a name nobody registered, and substitutes nothing", () => {
        register("valhalla");
        // ⚠️ With an address, on purpose: without one the lookup of a default address already
        // answers null, and the case would stay green with a substituted engine.
        withProfileBranch({ provider: "unknown-engine", endpoint: "https://engine.example" });
        expect(createProvider()).toBeNull();
        expect(built).toEqual([]);
    });

    it("builds the built-in name on its default address when the profile gives none", () => {
        register("valhalla");
        expect(createProvider()?.id).toBe("valhalla");
        expect(built).toEqual([
            {
                endpoint: "https://valhalla1.openstreetmap.de",
                options: { query: {}, timeoutMs: 10000 },
            },
        ]);
    });

    it("hands the factory the profile's timeout", () => {
        register("valhalla");
        withProfileBranch({ timeoutMs: 2500 });
        createProvider();
        expect(built[0]?.options.timeoutMs).toBe(2500);
    });

    it("answers null for a provider with no default address and none declared", () => {
        register("mine");
        withProfileBranch({ provider: "mine" });
        expect(createProvider()).toBeNull();
        expect(built).toEqual([]);
    });

    it("replaces a provider registered twice under one name", () => {
        register("twice", "© First");
        register("twice", "© Second");
        withProfileBranch({ provider: "twice", endpoint: "https://engine.example" });
        expect(getProvider()).toEqual({ id: "twice", attribution: "© Second" });
    });
});

describe("@geoleaf-plugins/isochrone — the address that applies", () => {
    it("prefers the runtime address to the profile's, and the profile's to the default", () => {
        const config = (branch: Record<string, unknown>) => {
            withProfileBranch(branch);
            return getPluginConfig();
        };
        expect(resolveEndpoint(config({}))).toBe("https://valhalla1.openstreetmap.de");
        expect(resolveEndpoint(config({ endpoint: "https://profile.example" }))).toBe(
            "https://profile.example"
        );
        setOverrides({ endpoint: "https://runtime.example" });
        expect(resolveEndpoint(config({ endpoint: "https://profile.example" }))).toBe(
            "https://runtime.example"
        );
        expect(resolveEndpoint(config({}))).toBe("https://runtime.example");
    });

    it("refuses an address in http, and does not fall back on the default one", () => {
        register("valhalla");
        withProfileBranch({ endpoint: "http://plain.example" });
        expect(resolveEndpoint(getPluginConfig())).toBeNull();
        expect(createProvider()).toBeNull();
        expect(built).toEqual([]);
    });

    it("lets the runtime address apply over a profile address that would be refused", () => {
        register("valhalla");
        withProfileBranch({ endpoint: "http://plain.example" });
        setOverrides({ endpoint: "https://runtime.example" });
        createProvider();
        expect(built[0]?.endpoint).toBe("https://runtime.example");
    });

    it("hands the factory the query parameters given at runtime", () => {
        register("valhalla");
        setOverrides({ query: { api_key: "k" } });
        createProvider();
        expect(built[0]?.options.query).toEqual({ api_key: "k" });
    });
});

describe("@geoleaf-plugins/isochrone — a provider must credit its data", () => {
    it.each([[""], ["   "], [undefined], [42]])(
        "refuses a provider whose credit is %s, and says so",
        (attribution) => {
            register("blank", attribution);
            withProfileBranch({ provider: "blank", endpoint: "https://engine.example" });
            expect(createProvider()).toBeNull();
            expect(getProvider()).toBeNull();
            expect(String(warn.mock.calls[0]?.[0])).toContain("declares no attribution");
        }
    );

    it("answers the identity of a provider that credits its data", () => {
        register("credited", "© Somebody");
        withProfileBranch({ provider: "credited", endpoint: "https://engine.example" });
        expect(getProvider()).toEqual({ id: "credited", attribution: "© Somebody" });
    });
});
