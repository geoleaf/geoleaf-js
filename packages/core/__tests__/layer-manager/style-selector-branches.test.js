/**
 * Deep branch-coverage tests for style-selector.ts
 * Covers: getCurrentStyle, setCurrentStyle, renderDOM, bindEvents,
 * applyStyle (modern + legacy), _resolveStyleConfig, _applyStyleResult.
 */
vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../src/kernel/config/config-primitives.js", () => ({
    Config: { get: vi.fn(() => ({ profilesBasePath: "profiles" })) },
}));
vi.mock("../../src/kernel/geojson/core.js", () => ({
    GeoJSONCore: {
        getLayerData: vi.fn(() => null),
        setLayerStyle: vi.fn(),
    },
}));
vi.mock("../../src/utils/loaders/style-loader.js", () => ({
    StyleLoader: { loadAndValidateStyle: vi.fn() },
}));
// Labels + button manager are consumed via the runtime global (getGeoLeaf),
// not a static import (S4 in-core capability decoupling) — mock the global seam.
const labelsMocks = vi.hoisted(() => ({
    Labels: { initializeLayerLabels: vi.fn() },
    LabelButtonManager: { syncImmediate: vi.fn() },
}));
vi.mock("../../src/utils/general/geoleaf-global.js", () => ({
    getGeoLeaf: () => ({
        Labels: labelsMocks.Labels,
        _LabelButtonManager: labelsMocks.LabelButtonManager,
    }),
}));
vi.mock("../../src/capabilities/legend/legend-seam.js", () => ({
    LegendContract: {
        isAvailable: vi.fn(() => false),
        loadLayerLegend: vi.fn(),
    },
}));

import { StyleSelector } from "../../src/kernel/layer-manager/style-selector.js";
import { GeoJSONCore } from "../../src/kernel/geojson/core.js";
import { StyleLoader } from "../../src/utils/loaders/style-loader.js";
import { LegendContract } from "../../src/capabilities/legend/legend-seam.js";

describe("style-selector — branch coverage", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        GeoJSONCore.getLayerData = vi.fn(() => null);
        GeoJSONCore.setLayerStyle = vi.fn();
        StyleLoader.loadAndValidateStyle = vi.fn();
        LegendContract.isAvailable = vi.fn(() => false);
        labelsMocks.Labels.initializeLayerLabels = vi.fn();
        labelsMocks.LabelButtonManager.syncImmediate = vi.fn();
    });

    // ── getCurrentStyle / setCurrentStyle ─────────────────────────────────
    it("getCurrentStyle returns null for unknown layer", () => {
        expect(StyleSelector.getCurrentStyle("unknownLayer")).toBeNull();
    });

    it("setCurrentStyle stores and getCurrentStyle retrieves", () => {
        StyleSelector.setCurrentStyle("lyr1", "dark");
        expect(StyleSelector.getCurrentStyle("lyr1")).toBe("dark");
    });

    // ── renderDOM ────────────────────────────────────────────────────────
    it("renderDOM returns null when no styles", () => {
        expect(StyleSelector.renderDOM({ id: "l", styles: null })).toBeNull();
    });

    it("renderDOM returns null when styles.available not array", () => {
        expect(StyleSelector.renderDOM({ id: "l", styles: { available: "str" } })).toBeNull();
    });

    it("renderDOM returns null when only 1 style", () => {
        expect(
            StyleSelector.renderDOM({
                id: "l",
                styles: { available: [{ id: "s1" }] },
            })
        ).toBeNull();
    });

    it("renderDOM creates select with multiple options", () => {
        const el = StyleSelector.renderDOM({
            id: "l1",
            styles: { available: [{ id: "s1", label: "Style 1" }, { id: "s2" }] },
        });
        expect(el).not.toBeNull();
        const select = el.querySelector("select");
        expect(select.options.length).toBe(2);
        expect(select.options[0].textContent).toBe("Style 1");
        expect(select.options[1].textContent).toBe("s2"); // fallback to id
    });

    it("renderDOM uses getCurrentStyle for selected option", () => {
        StyleSelector.setCurrentStyle("lx", "s2");
        const el = StyleSelector.renderDOM({
            id: "lx",
            styles: { available: [{ id: "s1" }, { id: "s2" }] },
        });
        const select = el.querySelector("select");
        expect(select.value).toBe("s2");
    });

    it("renderDOM uses default style when getCurrentStyle returns null", () => {
        const el = StyleSelector.renderDOM({
            id: "lDefault",
            styles: { available: [{ id: "a" }, { id: "b" }], default: "b" },
        });
        const select = el.querySelector("select");
        expect(select.value).toBe("b");
    });

    it("renderDOM falls back to first available when no default", () => {
        const el = StyleSelector.renderDOM({
            id: "lFallback",
            styles: { available: [{ id: "x" }, { id: "y" }] },
        });
        const select = el.querySelector("select");
        expect(select.value).toBe("x");
    });

    // ── bindEvents ───────────────────────────────────────────────────────
    it("bindEvents returns early when no styles", () => {
        const container = document.createElement("div");
        // Should not throw
        StyleSelector.bindEvents(container, { id: "l", styles: null });
    });

    it("bindEvents returns early when available.length <= 1", () => {
        const container = document.createElement("div");
        StyleSelector.bindEvents(container, {
            id: "l",
            styles: { available: [{ id: "s1" }] },
        });
    });

    it("bindEvents returns early when select not found", () => {
        const container = document.createElement("div");
        StyleSelector.bindEvents(container, {
            id: "l",
            styles: { available: [{ id: "a" }, { id: "b" }] },
        });
    });

    it("bindEvents attaches change listener that calls applyStyle", () => {
        const item = {
            id: "lBind",
            styles: { available: [{ id: "a" }, { id: "b" }] },
        };
        const container = StyleSelector.renderDOM(item);
        const spy = vi.spyOn(StyleSelector, "applyStyle").mockResolvedValue(undefined);
        StyleSelector.bindEvents(container, item);
        const select = container.querySelector("select");
        select.value = "b";
        select.dispatchEvent(new Event("change"));
        expect(spy).toHaveBeenCalledWith("lBind", "b");
        spy.mockRestore();
    });

    // ── applyStyle ───────────────────────────────────────────────────────
    it("applyStyle returns early when _resolveStyleConfig returns null", async () => {
        GeoJSONCore.getLayerData = vi.fn(() => null);
        await StyleSelector.applyStyle("missing", "s1");
        expect(StyleLoader.loadAndValidateStyle).not.toHaveBeenCalled();
    });

    it("applyStyle resolves config and calls StyleLoader", async () => {
        GeoJSONCore.getLayerData = vi.fn(() => ({
            config: {
                id: "lyr",
                _profileId: "p1",
                _layerDirectory: "dir",
                styles: { available: [{ id: "s1", file: "s1.json" }] },
            },
        }));
        StyleLoader.loadAndValidateStyle = vi.fn().mockResolvedValue({
            styleData: { style: { fillColor: "red" } },
            metadata: {},
        });
        LegendContract.isAvailable = vi.fn(() => true);
        await StyleSelector.applyStyle("lyr", "s1");
        expect(StyleLoader.loadAndValidateStyle).toHaveBeenCalled();
        expect(GeoJSONCore.setLayerStyle).toHaveBeenCalledWith("lyr", { fillColor: "red" });
        expect(LegendContract.loadLayerLegend).toHaveBeenCalled();
    });

    it("applyStyle unwraps nested style object from styleData", async () => {
        GeoJSONCore.getLayerData = vi.fn(() => ({
            config: {
                id: "lyr",
                _profileId: "p1",
                _layerDirectory: "d",
                styles: { available: [{ id: "s", file: "s.json" }] },
            },
        }));
        StyleLoader.loadAndValidateStyle = vi.fn().mockResolvedValue({
            styleData: { style: { radius: 5 } },
            metadata: {},
        });
        await StyleSelector.applyStyle("lyr", "s");
        expect(GeoJSONCore.setLayerStyle).toHaveBeenCalledWith("lyr", { radius: 5 });
    });

    it("applyStyle uses raw styleData when no nested .style", async () => {
        GeoJSONCore.getLayerData = vi.fn(() => ({
            config: {
                id: "lyr",
                _profileId: "p1",
                _layerDirectory: "d",
                styles: { available: [{ id: "s", file: "s.json" }] },
            },
        }));
        StyleLoader.loadAndValidateStyle = vi.fn().mockResolvedValue({
            styleData: { fillColor: "blue" },
            metadata: {},
        });
        await StyleSelector.applyStyle("lyr", "s");
        expect(GeoJSONCore.setLayerStyle).toHaveBeenCalledWith("lyr", { fillColor: "blue" });
    });

    it("applyStyle returns early when profileId missing", async () => {
        GeoJSONCore.getLayerData = vi.fn(() => ({
            config: {
                id: "lyr",
                _profileId: null,
                _layerDirectory: "d",
                styles: { available: [{ id: "s" }] },
            },
        }));
        await StyleSelector.applyStyle("lyr", "s");
        expect(StyleLoader.loadAndValidateStyle).not.toHaveBeenCalled();
    });

    it("applyStyle returns early when layerDirectory missing", async () => {
        GeoJSONCore.getLayerData = vi.fn(() => ({
            config: {
                id: "lyr",
                _profileId: "p",
                _layerDirectory: null,
                styles: { available: [{ id: "s" }] },
            },
        }));
        await StyleSelector.applyStyle("lyr", "s");
        expect(StyleLoader.loadAndValidateStyle).not.toHaveBeenCalled();
    });

    it("applyStyle catches StyleLoader errors gracefully", async () => {
        GeoJSONCore.getLayerData = vi.fn(() => ({
            config: {
                id: "lyr",
                _profileId: "p1",
                _layerDirectory: "d",
                styles: { available: [{ id: "s", file: "s.json" }] },
            },
        }));
        StyleLoader.loadAndValidateStyle = vi.fn().mockRejectedValue(new Error("fail"));
        // Should not throw
        await StyleSelector.applyStyle("lyr", "s");
    });

    it("applyStyle calls Labels.initializeLayerLabels", async () => {
        GeoJSONCore.getLayerData = vi.fn(() => ({
            config: {
                id: "lyr",
                _profileId: "p1",
                _layerDirectory: "d",
                styles: { available: [{ id: "s", file: "f.json" }] },
            },
        }));
        StyleLoader.loadAndValidateStyle = vi.fn().mockResolvedValue({
            styleData: { fillColor: "red" },
            metadata: {},
        });
        await StyleSelector.applyStyle("lyr", "s");
        expect(labelsMocks.Labels.initializeLayerLabels).toHaveBeenCalledWith("lyr");
    });

    it("applyStyle calls LabelButtonManager.syncImmediate", async () => {
        GeoJSONCore.getLayerData = vi.fn(() => ({
            config: {
                id: "lyr",
                _profileId: "p",
                _layerDirectory: "d",
                styles: { available: [{ id: "s", file: "f.json" }] },
            },
        }));
        StyleLoader.loadAndValidateStyle = vi.fn().mockResolvedValue({
            styleData: {},
            metadata: {},
        });
        await StyleSelector.applyStyle("lyr", "s");
        expect(labelsMocks.LabelButtonManager.syncImmediate).toHaveBeenCalledWith("lyr");
    });

    // ── _resolveStyleConfig branch: no styles array ──────────────────────
    it("applyStyle returns early when layerData has no styles.available", async () => {
        GeoJSONCore.getLayerData = vi.fn(() => ({
            config: { id: "l", styles: { available: null } },
        }));
        await StyleSelector.applyStyle("l", "s");
        expect(StyleLoader.loadAndValidateStyle).not.toHaveBeenCalled();
    });

    it("applyStyle returns early when styleId not found in available", async () => {
        GeoJSONCore.getLayerData = vi.fn(() => ({
            config: { id: "l", styles: { available: [{ id: "a" }] } },
        }));
        await StyleSelector.applyStyle("l", "z");
        expect(StyleLoader.loadAndValidateStyle).not.toHaveBeenCalled();
    });
});
