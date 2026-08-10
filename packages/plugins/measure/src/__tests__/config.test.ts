/**
 * Tests for config.ts — getMeasureConfig() merge, validation and clamping.
 *
 * config.ts is otherwise only exercised indirectly; these tests cover its
 * validation/clamp branches directly (S7 branch-coverage top-up).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { installMockGeoLeaf, uninstallMockGeoLeaf } from "./setup.js";
import { getMeasureConfig } from "../config.js";

afterEach(() => {
    uninstallMockGeoLeaf();
    vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// menuPosition — PLUGINS S5
//
// The contract is `"top-left" | {top,left}`. It used to be a free `string`, and every
// unrecognised value silently rendered top-left: `"bottom-right"` looked accepted and
// was not. The default being "top-left" is what hid it.
// ---------------------------------------------------------------------------

describe("getMeasureConfig — menuPosition", () => {
    it('defaults to "top-left" when unset', () => {
        installMockGeoLeaf({ measureConfig: {} });
        expect(getMeasureConfig().menuPosition).toBe("top-left");
    });

    it("keeps an explicit {top,left} pixel pair", () => {
        installMockGeoLeaf({ measureConfig: { menuPosition: { top: 50, left: 80 } } });
        expect(getMeasureConfig().menuPosition).toEqual({ top: 50, left: 80 });
    });

    it('accepts the "top-left" literal', () => {
        installMockGeoLeaf({ measureConfig: { menuPosition: "top-left" } });
        expect(getMeasureConfig().menuPosition).toBe("top-left");
    });

    it("rejects an unsupported corner and warns instead of applying it wrong", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        installMockGeoLeaf({ measureConfig: { menuPosition: "bottom-right" } });
        expect(getMeasureConfig().menuPosition).toBe("top-left");
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("bottom-right"));
    });

    it("rejects a malformed object (partial or non-numeric coordinates)", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        installMockGeoLeaf({ measureConfig: { menuPosition: { top: "50", left: 80 } } });
        expect(getMeasureConfig().menuPosition).toBe("top-left");
        expect(warn).toHaveBeenCalled();
    });

    it("does not warn when menuPosition is simply absent", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        installMockGeoLeaf({ measureConfig: {} });
        getMeasureConfig();
        expect(warn).not.toHaveBeenCalled();
    });
});

describe("getMeasureConfig — defaults", () => {
    it("returns the documented defaults when modules.measure is empty", () => {
        installMockGeoLeaf({ measureConfig: {} });
        const cfg = getMeasureConfig();
        expect(cfg.enabled).toBe(true);
        expect(cfg.showButton).toBe(true);
        expect(cfg.defaultDistanceUnit).toBe("m");
        expect(cfg.defaultAreaUnit).toBe("m2");
        expect(cfg.snapPx).toBe(12);
        expect(cfg.circleSteps).toBe(64);
        expect(cfg.maxFeatures).toBe(500);
        expect(cfg.gpsCloseThresholdM).toBe(15);
        expect(cfg.gpsMaxJumpMps).toBe(25);
        expect(cfg.enabledTools).toContain("distance");
        expect(cfg.enabledTools).toContain("annotation-tooltip");
    });

    it("returns defaults when GeoLeaf.Config yields nothing for modules.measure", () => {
        const gl = installMockGeoLeaf({ measureConfig: {} });
        gl.Config.get.mockImplementation((_key: string, def: unknown) => def);
        const cfg = getMeasureConfig();
        expect(cfg.enabled).toBe(true);
        expect(cfg.enabledTools.length).toBeGreaterThan(0);
    });
});

describe("getMeasureConfig — valid overrides", () => {
    it("honours valid profile values", () => {
        installMockGeoLeaf({
            measureConfig: {
                showButton: true,
                defaultDistanceUnit: "km",
                defaultAreaUnit: "ha",
                snapPx: 20,
                circleSteps: 128,
                maxFeatures: 50,
                gpsCloseThresholdM: 30,
                gpsMaxJumpMps: 10,
                enabledTools: ["distance", "circle"],
            },
        });
        const cfg = getMeasureConfig();
        expect(cfg.defaultDistanceUnit).toBe("km");
        expect(cfg.defaultAreaUnit).toBe("ha");
        expect(cfg.snapPx).toBe(20);
        expect(cfg.circleSteps).toBe(128);
        expect(cfg.maxFeatures).toBe(50);
        expect(cfg.gpsCloseThresholdM).toBe(30);
        expect(cfg.gpsMaxJumpMps).toBe(10);
        expect(cfg.enabledTools).toEqual(["distance", "circle"]);
    });

    it("resolves showButton from the ui.showMeasure alias when not set on the plugin", () => {
        const gl = installMockGeoLeaf({ measureConfig: {} });
        gl.Config.get.mockImplementation((key: string, def: unknown) => {
            if (key === "modules.measure") return {};
            if (key === "ui") return { showMeasure: false };
            return def;
        });
        expect(getMeasureConfig().showButton).toBe(false);
    });
});

describe("getMeasureConfig — validation & clamping", () => {
    it("falls back to all tools when enabledTools is not an array", () => {
        installMockGeoLeaf({ measureConfig: { enabledTools: "distance" } });
        const cfg = getMeasureConfig();
        expect(Array.isArray(cfg.enabledTools)).toBe(true);
        expect(cfg.enabledTools).toContain("distance");
        expect(cfg.enabledTools.length).toBeGreaterThan(1);
    });

    it("filters out unknown tool identifiers", () => {
        installMockGeoLeaf({
            measureConfig: { enabledTools: ["distance", "bogus", "circle"] },
        });
        expect(getMeasureConfig().enabledTools).toEqual(["distance", "circle"]);
    });

    it("clamps negative numeric bounds up to the minimum", () => {
        installMockGeoLeaf({
            measureConfig: {
                snapPx: -5,
                maxFeatures: -10,
                gpsCloseThresholdM: -3,
                gpsMaxJumpMps: -3,
            },
        });
        const cfg = getMeasureConfig();
        expect(cfg.snapPx).toBe(1);
        expect(cfg.maxFeatures).toBe(1);
        expect(cfg.gpsCloseThresholdM).toBe(1);
        expect(cfg.gpsMaxJumpMps).toBe(1);
    });

    it("substitutes the default when a numeric bound is the falsy value 0", () => {
        installMockGeoLeaf({
            measureConfig: { maxFeatures: 0, gpsCloseThresholdM: 0, gpsMaxJumpMps: 0 },
        });
        const cfg = getMeasureConfig();
        // `Number(0) || DEFAULT` → the documented default (0 is falsy), then Math.max(1, …).
        expect(cfg.maxFeatures).toBe(500);
        expect(cfg.gpsCloseThresholdM).toBe(15);
        expect(cfg.gpsMaxJumpMps).toBe(25);
    });

    it("clamps circleSteps above the maximum down to 256", () => {
        installMockGeoLeaf({ measureConfig: { circleSteps: 1000 } });
        expect(getMeasureConfig().circleSteps).toBe(256);
    });

    it("raises circleSteps below the minimum to 8", () => {
        installMockGeoLeaf({ measureConfig: { circleSteps: 2 } });
        expect(getMeasureConfig().circleSteps).toBe(8);
    });

    it("rejects invalid unit values and falls back to defaults", () => {
        installMockGeoLeaf({
            measureConfig: { defaultDistanceUnit: "miles", defaultAreaUnit: "acres" },
        });
        const cfg = getMeasureConfig();
        expect(cfg.defaultDistanceUnit).toBe("m");
        expect(cfg.defaultAreaUnit).toBe("m2");
    });

    it("accepts the 'auto' unit values", () => {
        installMockGeoLeaf({
            measureConfig: { defaultDistanceUnit: "auto", defaultAreaUnit: "auto" },
        });
        const cfg = getMeasureConfig();
        expect(cfg.defaultDistanceUnit).toBe("auto");
        expect(cfg.defaultAreaUnit).toBe("auto");
    });
});
