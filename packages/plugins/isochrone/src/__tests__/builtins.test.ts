/**
 * @geoleaf-plugins/isochrone — the engine the package ships with
 *
 * Importing `providers/builtins.js` is what registers it: no call the host must remember.
 * 🛑 Nothing here touches the network — `fetch` is replaced.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import "../providers/builtins.js";
import { createProvider, getProvider } from "../provider.js";
import { setOverrides } from "../runtime-overrides.js";

/** The page's namespace, reached without assuming the core's global declaration is loaded. */
const host = globalThis as { GeoLeaf?: unknown };
const previous = host.GeoLeaf;

/** Installs the plugin's branch of the profile. */
function withProfileBranch(branch: Record<string, unknown>): void {
    host.GeoLeaf = {
        Config: {
            get: (key: string, fallback: unknown) =>
                key === "modules.isochrone" ? branch : fallback,
        },
    };
}

/**
 * Asks the configured provider one zone, and answers the URL it called.
 *
 * @returns The URL handed to the replaced `fetch`.
 */
async function calledUrl(): Promise<URL> {
    const urls: string[] = [];
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
            urls.push(url);
            return { ok: true, status: 200, json: async () => ({ features: [] }) };
        })
    );
    await createProvider()?.isochrone({
        origin: [55.4504, -20.8823],
        mode: "car",
        minutes: [5],
        signal: new AbortController().signal,
    });
    return new URL(urls[0] ?? "");
}

afterEach(() => {
    setOverrides(null);
    vi.unstubAllGlobals();
    host.GeoLeaf = previous;
});

describe("@geoleaf-plugins/isochrone — the built-in engine", () => {
    it("is registered by importing the module, under the default name of the profile", () => {
        expect(getProvider()).toEqual({
            id: "valhalla",
            attribution: "© OpenStreetMap contributors",
        });
    });

    it("declares what one request may carry", () => {
        expect(createProvider()?.limits).toEqual({ maxContours: 4, maxMinutes: 120 });
    });

    it("calls its default address when neither the profile nor the host gives one", async () => {
        const url = await calledUrl();
        expect(`${url.origin}${url.pathname}`).toBe("https://valhalla1.openstreetmap.de/isochrone");
    });

    it("calls the address of the profile, then the one given at runtime", async () => {
        withProfileBranch({ endpoint: "https://profile.example/valhalla" });
        expect((await calledUrl()).href).toContain("https://profile.example/valhalla/isochrone");
        setOverrides({ endpoint: "https://runtime.example", query: { api_key: "k" } });
        const url = await calledUrl();
        expect(`${url.origin}${url.pathname}`).toBe("https://runtime.example/isochrone");
        expect(url.searchParams.get("api_key")).toBe("k");
    });

    it("answers no engine for an address of the profile that is refused", () => {
        withProfileBranch({ endpoint: "http://plain.example" });
        expect(getProvider()).toBeNull();
    });
});
