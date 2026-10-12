/**
 * @geoleaf-plugins/isochrone — the façade and what it opens
 *
 * They hold what the plugin does through its public surface: the façade delegates, the plugin
 * opens once, closes cleanly, `enabled: false` switches it off, and the engine's side of the
 * façade reaches the registry and the runtime settings.
 */
import { afterEach, describe, expect, it } from "vitest";

import { buildPublicApi } from "../public-api.js";

import langEn from "../lang/lang-en.js";
import langFr from "../lang/lang-fr.js";

/** The page's namespace, reached without assuming the core's global declaration is loaded. */
const host = globalThis as { GeoLeaf?: unknown };
const previous = host.GeoLeaf;

/** Installs a partial namespace: only `Config.get` is read by the code under test. */
function withProfileBranch(branch: Record<string, unknown>): void {
    host.GeoLeaf = {
        Config: {
            get: (key: string, fallback: unknown) =>
                key === "modules.isochrone" ? branch : fallback,
        },
    };
}

afterEach(() => {
    host.GeoLeaf = previous;
    document.body.replaceChildren();
});

describe("@geoleaf-plugins/isochrone public API", () => {
    it("opens when the plugin is enabled", () => {
        expect(buildPublicApi().open()).toBe(true);
        expect(document.querySelectorAll(".gl-isochrone")).toHaveLength(1);
    });

    it("builds its root element once, however many times it is opened", () => {
        const api = buildPublicApi();
        api.open();
        api.open();
        expect(document.querySelectorAll(".gl-isochrone")).toHaveLength(1);
    });

    it("stays closed when the profile switches the plugin off", () => {
        withProfileBranch({ enabled: false });
        expect(buildPublicApi().open()).toBe(false);
        expect(document.querySelector(".gl-isochrone")).toBeNull();
    });

    it("removes what it built when it is closed", () => {
        const api = buildPublicApi();
        api.open();
        api.close();
        expect(document.querySelector(".gl-isochrone")).toBeNull();
    });

    it("tolerates being closed when nothing was built, and opens again afterwards", () => {
        const api = buildPublicApi();
        expect(() => api.close()).not.toThrow();
        expect(api.open()).toBe(true);
        expect(document.querySelectorAll(".gl-isochrone")).toHaveLength(1);
    });
});

describe("@geoleaf-plugins/isochrone public API — the engine", () => {
    it("answers the validated configuration", () => {
        withProfileBranch({ timeoutMs: -1, durations: [30, 10] });
        const config = buildPublicApi().getConfig();
        expect(config.timeoutMs).toBe(10000);
        expect(config.durations).toEqual([10, 30]);
    });

    it("registers an engine, and answers its identity once the profile names it", () => {
        const api = buildPublicApi();
        api.registerProvider("facade-engine", () => ({
            id: "facade-engine",
            attribution: "© Facade data",
            isochrone: async () => ({ ok: true, contours: [] }),
        }));
        expect(api.getProvider()).toBeNull();
        withProfileBranch({ provider: "facade-engine", endpoint: "https://engine.example" });
        expect(api.getProvider()).toEqual({ id: "facade-engine", attribution: "© Facade data" });
    });

    it("applies runtime settings, refuses unusable ones, and clears them on null", () => {
        const api = buildPublicApi();
        const seen: string[] = [];
        api.registerProvider("facade-address", (endpoint) => {
            seen.push(endpoint);
            return {
                id: "facade-address",
                attribution: "© Facade data",
                isochrone: async () => ({ ok: true, contours: [] }),
            };
        });
        withProfileBranch({ provider: "facade-address", endpoint: "https://profile.example" });

        expect(api.configure({ endpoint: "https://runtime.example" })).toBe(true);
        api.getProvider();
        expect(api.configure({ endpoint: "http://plain.example" })).toBe(false);
        api.getProvider();
        expect(api.configure(null)).toBe(true);
        api.getProvider();

        expect(seen).toEqual([
            "https://runtime.example",
            // The refused settings applied nothing: the previous ones stayed in force.
            "https://runtime.example",
            "https://profile.example",
        ]);
    });
});

describe("@geoleaf-plugins/isochrone dictionaries", () => {
    it("carry the same keys in every language", () => {
        expect(Object.keys(langEn).sort()).toEqual(Object.keys(langFr).sort());
    });
});
