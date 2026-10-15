/**
 * @geoleaf-plugins/isochrone — the façade and what it opens
 *
 * They hold what the plugin does through its public surface: the façade delegates, the plugin
 * opens once, closes cleanly, `enabled: false` switches it off, and the engine's side of the
 * façade reaches the registry and the runtime settings.
 */
import { afterEach, describe, expect, it } from "vitest";

import { destroyIsochrone } from "../isochrone-api.js";
import { buildPublicApi } from "../public-api.js";
import { createFakeMap } from "./fake-map.js";

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

describe("@geoleaf-plugins/isochrone public API — the stack", () => {
    const AREA = { type: "Polygon", coordinates: [] } as const;

    /**
     * Installs a profile naming an engine that answers every duration, and a map.
     *
     * @returns The fake map.
     */
    function withMapAndEngine() {
        const map = createFakeMap();
        buildPublicApi().registerProvider("facade-stack", () => ({
            id: "facade-stack",
            attribution: "© Facade data",
            isochrone: async (request) => ({
                ok: true,
                contours: request.minutes.map((minutes) => ({ minutes, geometry: AREA })),
            }),
        }));
        host.GeoLeaf = {
            Config: {
                get: (key: string, fallback: unknown) =>
                    key === "modules.isochrone"
                        ? { provider: "facade-stack", endpoint: "https://engine.example" }
                        : fallback,
            },
            Core: { getMap: () => map },
        };
        return map;
    }

    afterEach(() => destroyIsochrone());

    it("computes, lists, restyles, hides, moves and removes through the façade", async () => {
        const map = withMapAndEngine();
        const api = buildPublicApi();
        const result = await api.compute({ origin: [55.45, -20.88], minutes: [5, 10] });
        expect(result.ok).toBe(true);
        const [top = "", bottom = ""] = api.getLayers().map((l) => l.id);
        expect(api.setLayerStyle(top, { opacity: 0.5 })).toBe(true);
        expect(api.setLayerVisible(top, false)).toBe(true);
        expect(api.moveLayer(top, 1)).toBe(true);
        expect(map.topFirst()).toEqual([bottom, top]);
        expect(api.removeLayer(bottom)).toBe(true);
        expect(api.getLayers()).toMatchObject([{ id: top, opacity: 0.5, visible: false }]);
        api.clear();
        expect(map.layers).toEqual([]);
    });

    it("keeps the zones when the window closes, and removes them at teardown", async () => {
        const map = withMapAndEngine();
        const api = buildPublicApi();
        api.open();
        await api.compute({ origin: [55.45, -20.88], minutes: [5] });
        api.close();
        expect(map.layers).toHaveLength(1);
        destroyIsochrone();
        expect(map.layers).toEqual([]);
        expect(document.querySelector(".gl-isochrone")).toBeNull();
        expect(api.open()).toBe(true);
    });
});
