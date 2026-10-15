/**
 * @geoleaf-plugins/isochrone — the configuration reader
 *
 * Every key falls back on its own: a value the plugin cannot use costs the profile that key,
 * and no other.
 */
import { afterEach, describe, expect, it } from "vitest";

import { getPluginConfig } from "../config.js";

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
});

describe("@geoleaf-plugins/isochrone configuration — defaults", () => {
    it("applies every built-in default when the profile says nothing", () => {
        expect(getPluginConfig()).toEqual({
            enabled: true,
            showButton: true,
            provider: "valhalla",
            endpoint: "",
            timeoutMs: 10000,
            mode: "car",
            modes: ["car", "foot", "bike"],
            durations: [5, 10, 15],
            maxLayers: 8,
            zIndex: 50,
            palette: [
                "#3987e5",
                "#d95926",
                "#199e70",
                "#c98500",
                "#d55181",
                "#008300",
                "#9085e9",
                "#e66767",
            ],
            fillOpacity: 0.25,
        });
    });

    it("lets the profile override a default, from the plugin's own branch", () => {
        withProfileBranch({
            enabled: false,
            showButton: false,
            provider: "mine",
            endpoint: "https://engine.example",
            timeoutMs: 2500,
            mode: "bike",
            modes: ["bike", "foot"],
            durations: [20, 40],
            maxLayers: 3,
            zIndex: 70,
            palette: ["#000000", "#FFFFFF"],
            fillOpacity: 0.5,
        });
        expect(getPluginConfig()).toEqual({
            enabled: false,
            showButton: false,
            provider: "mine",
            endpoint: "https://engine.example",
            timeoutMs: 2500,
            mode: "bike",
            modes: ["bike", "foot"],
            durations: [20, 40],
            maxLayers: 3,
            zIndex: 70,
            palette: ["#000000", "#FFFFFF"],
            fillOpacity: 0.5,
        });
    });

    it("keeps a key it does not know, rather than dropping it at the type boundary", () => {
        withProfileBranch({ future: "kept" });
        expect(getPluginConfig()["future"]).toBe("kept");
    });

    it("hands out a fresh list each time, so a caller cannot edit the defaults", () => {
        (getPluginConfig().modes as string[]).push("plane");
        (getPluginConfig().durations as number[]).push(99);
        (getPluginConfig().palette as string[]).length = 0;
        const config = getPluginConfig();
        expect(config.modes).toEqual(["car", "foot", "bike"]);
        expect(config.durations).toEqual([5, 10, 15]);
        expect(config.palette).toHaveLength(8);
    });
});

describe("@geoleaf-plugins/isochrone configuration — fallbacks", () => {
    it.each([[0], [-5], [Number.NaN], [Number.POSITIVE_INFINITY], ["2500"], [null]])(
        "falls back on the default timeout for %s",
        (timeoutMs) => {
            withProfileBranch({ timeoutMs });
            expect(getPluginConfig().timeoutMs).toBe(10000);
        }
    );

    it("discards a mode it does not know, and a mode named twice", () => {
        withProfileBranch({ modes: ["bike", "plane", "bike", 3] });
        expect(getPluginConfig().modes).toEqual(["bike"]);
    });

    it.each([[[]], [["plane"]], ["car"], [undefined]])(
        "offers the three modes when the list %s leaves none",
        (modes) => {
            withProfileBranch({ modes });
            expect(getPluginConfig().modes).toEqual(["car", "foot", "bike"]);
        }
    );

    it("falls back on `car` for a mode it does not know", () => {
        withProfileBranch({ mode: "plane" });
        expect(getPluginConfig().mode).toBe("car");
    });

    it("opens on the first mode offered when the preferred one is not offered", () => {
        withProfileBranch({ mode: "car", modes: ["foot", "bike"] });
        expect(getPluginConfig().mode).toBe("foot");
    });

    it("keeps whole positive minutes only, once each, ascending", () => {
        withProfileBranch({ durations: [15, 5, 5, 2.5, -1, 0, "10", Number.NaN] });
        expect(getPluginConfig().durations).toEqual([5, 15]);
    });

    it.each([[[]], [[0, -3]], ["5,10"]])(
        "offers the default durations when %s leaves none",
        (durations) => {
            withProfileBranch({ durations });
            expect(getPluginConfig().durations).toEqual([5, 10, 15]);
        }
    );

    it.each([[0], [2.5], [-1], ["4"], [100]])(
        "falls back on the default cap for %s",
        (maxLayers) => {
            withProfileBranch({ maxLayers });
            expect(getPluginConfig().maxLayers).toBe(8);
        }
    );

    it("keeps a cap of 99, the highest the stack can rank", () => {
        withProfileBranch({ maxLayers: 99 });
        expect(getPluginConfig().maxLayers).toBe(99);
    });

    it("takes any finite number as the base rank, and nothing else", () => {
        withProfileBranch({ zIndex: -1.5 });
        expect(getPluginConfig().zIndex).toBe(-1.5);
        withProfileBranch({ zIndex: "70" });
        expect(getPluginConfig().zIndex).toBe(50);
    });

    it("keeps the colours written `#rrggbb`, and falls back when none is", () => {
        withProfileBranch({ palette: ["#FFFFFF", "red", "#12345", "#abcdef", 7] });
        expect(getPluginConfig().palette).toEqual(["#FFFFFF", "#abcdef"]);
        withProfileBranch({ palette: ["red", "rgb(0,0,0)"] });
        expect(getPluginConfig().palette).toHaveLength(8);
    });

    it("keeps an opacity from 0 to 1, bounds included, and falls back outside", () => {
        withProfileBranch({ fillOpacity: 0 });
        expect(getPluginConfig().fillOpacity).toBe(0);
        withProfileBranch({ fillOpacity: 1 });
        expect(getPluginConfig().fillOpacity).toBe(1);
        withProfileBranch({ fillOpacity: 1.5 });
        expect(getPluginConfig().fillOpacity).toBe(0.25);
        withProfileBranch({ fillOpacity: -0.1 });
        expect(getPluginConfig().fillOpacity).toBe(0.25);
    });

    it("reads a switch as a boolean, never as a truthy value", () => {
        withProfileBranch({ enabled: "false", showButton: 0 });
        expect(getPluginConfig().enabled).toBe(true);
        expect(getPluginConfig().showButton).toBe(true);
    });

    it("falls back on the built-in engine when `provider` is empty or not a string", () => {
        withProfileBranch({ provider: "" });
        expect(getPluginConfig().provider).toBe("valhalla");
        withProfileBranch({ provider: 42 });
        expect(getPluginConfig().provider).toBe("valhalla");
    });

    it("does not judge `endpoint` here: a refused address must stay visible further on", () => {
        withProfileBranch({ endpoint: "http://plain.example" });
        expect(getPluginConfig().endpoint).toBe("http://plain.example");
        withProfileBranch({ endpoint: 42 });
        expect(getPluginConfig().endpoint).toBe("");
    });
});
