/**
 */
const state = { layers: new Map() };
vi.mock("../../src/kernel/geojson/shared.js", () => ({
    GeoJSONShared: {
        get state() {
            return state;
        },
    },
}));
vi.mock("../../src/utils/log/index.js", () => ({
    Log: { warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/utils/general/di-accessors.js", () => ({
    getLog: () => ({ warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("../../src/utils/general/scale-utils.js", () => ({
    calculateMapScale: vi.fn(() => 1000),
    isScaleInRange: vi.fn(() => true),
}));
import { isScaleInRange } from "../../src/utils/general/scale-utils.js";
import { LayerManagerVisibility } from "../../src/kernel/geojson/layers/visibility.js";

describe("geojson/layers/visibility", () => {
    beforeEach(() => {
        state.layers = new Map();
        isScaleInRange.mockClear();
        if (typeof globalThis !== "undefined") globalThis.GeoLeaf = undefined;
    });

    it("showLayer warns and returns when layer not found", () => {
        LayerManagerVisibility.showLayer("missing");
        expect(state.layers.has("missing")).toBe(false);
    });

    it("showLayer errors and returns when VisibilityManager not available", () => {
        state.layers.set("lyr1", { id: "lyr1" });
        globalThis.GeoLeaf = {};
        LayerManagerVisibility.showLayer("lyr1");
        globalThis.GeoLeaf = undefined;
    });

    it("hideLayer warns and returns when layer not found", () => {
        LayerManagerVisibility.hideLayer("missing");
    });

    it("hideLayer errors and returns when VisibilityManager not available", () => {
        state.layers.set("lyr1", { id: "lyr1" });
        globalThis.GeoLeaf = {};
        LayerManagerVisibility.hideLayer("lyr1");
        globalThis.GeoLeaf = undefined;
    });

    it("toggleLayer warns when layer not found", () => {
        LayerManagerVisibility.toggleLayer("missing");
    });

    it("toggleLayer toggles visibility when VisibilityManager available", () => {
        state.layers.set("lyr1", { id: "lyr1", visible: true, config: {} });
        const setVisibility = vi.fn();
        globalThis.GeoLeaf = {
            _LayerVisibilityManager: {
                setVisibility,
                getVisibilityState: () => ({ current: true, logicalState: true }),
                VisibilitySource: { USER: "user" },
            },
        };
        LayerManagerVisibility.toggleLayer("lyr1");
        // Assert the DIRECTION, not just that it was called: `setVisibility` runs for both
        // show and hide, so `toHaveBeenCalled()` alone cannot tell a working toggle from
        // an inverted one.
        expect(setVisibility).toHaveBeenCalledWith("lyr1", false, "user");
        globalThis.GeoLeaf = undefined;
    });

    // Backlog B.19 — the bug this pins. `toggleLayer` used to decide on
    // `getVisibilityState().current`, the PHYSICAL visibility, which the zoom can force
    // to `false`. On a layer the user had switched ON but that the current zoom hides,
    // `current` was `false`, so the click called `showLayer()` — and the button, which
    // reads `logicalState` via `store.getAllLayers()`, would not switch off.
    it("toggleLayer switches OFF a zoom-hidden layer that is logically ON", () => {
        state.layers.set("lyr1", { id: "lyr1", visible: true, config: {} });
        const setVisibility = vi.fn();
        globalThis.GeoLeaf = {
            _LayerVisibilityManager: {
                setVisibility,
                // The exact situation: button ON, screen OFF because of the zoom.
                getVisibilityState: () => ({
                    current: false,
                    logicalState: true,
                    zoomConstrained: true,
                }),
                VisibilitySource: { USER: "user" },
            },
        };

        LayerManagerVisibility.toggleLayer("lyr1");

        expect(setVisibility).toHaveBeenCalledWith("lyr1", false, "user");
        globalThis.GeoLeaf = undefined;
    });

    it("toggleLayer switches ON a layer that is logically OFF", () => {
        state.layers.set("lyr1", { id: "lyr1", visible: false, config: {} });
        const setVisibility = vi.fn();
        globalThis.GeoLeaf = {
            _LayerVisibilityManager: {
                setVisibility,
                getVisibilityState: () => ({ current: false, logicalState: false }),
                VisibilitySource: { USER: "user" },
            },
        };

        LayerManagerVisibility.toggleLayer("lyr1");

        expect(setVisibility).toHaveBeenCalledWith("lyr1", true, "user");
        globalThis.GeoLeaf = undefined;
    });

    it("toggleLayer falls back to layerData.visible when logicalState is absent", () => {
        state.layers.set("lyr1", { id: "lyr1", visible: true, config: {} });
        const setVisibility = vi.fn();
        globalThis.GeoLeaf = {
            _LayerVisibilityManager: {
                setVisibility,
                getVisibilityState: () => ({ current: false }), // no logicalState
                VisibilitySource: { USER: "user" },
            },
        };

        LayerManagerVisibility.toggleLayer("lyr1");

        // Same fallback as store.getAllLayers(), so button and toggle stay in agreement.
        expect(setVisibility).toHaveBeenCalledWith("lyr1", false, "user");
        globalThis.GeoLeaf = undefined;
    });

    it("updateLayerVisibilityByZoom returns early when state.map is null", () => {
        state.map = null;
        expect(() => LayerManagerVisibility.updateLayerVisibilityByZoom()).not.toThrow();
    });

    it("updateLayerVisibilityByZoom returns early when VisibilityManager not available", () => {
        state.map = {};
        globalThis.GeoLeaf = {};
        expect(() => LayerManagerVisibility.updateLayerVisibilityByZoom()).not.toThrow();
        globalThis.GeoLeaf = undefined;
    });

    it("updateLayerVisibilityByZoom iterates layers and calls setVisibility when map and VisibilityManager set", () => {
        state.map = {};
        const setVisibility = vi.fn();
        globalThis.GeoLeaf = {
            _LayerVisibilityManager: {
                setVisibility,
                VisibilitySource: { ZOOM: "zoom" },
            },
        };
        state.layers.set("lyr1", {
            id: "lyr1",
            config: {},
            currentStyle: { layerScale: {} },
            _visibility: { logicalState: true },
        });
        LayerManagerVisibility.updateLayerVisibilityByZoom();
        expect(setVisibility).toHaveBeenCalledWith("lyr1", true, "zoom");
        globalThis.GeoLeaf = undefined;
        state.layers.clear();
    });

    it("showLayer with VisibilityManager and changed true calls updateLayerVisibilityByZoom", () => {
        state.layers.set("lyr1", { id: "lyr1", currentStyle: {} });
        LayerManagerVisibility._loadLayerLegend = vi.fn();
        const setVisibility = vi.fn(() => true);
        const updateSpy = vi.spyOn(LayerManagerVisibility, "updateLayerVisibilityByZoom");
        globalThis.GeoLeaf = {
            _LayerVisibilityManager: {
                setVisibility,
                VisibilitySource: { USER: "user" },
            },
            _GeoJSONLayerManager: LayerManagerVisibility,
        };
        LayerManagerVisibility.showLayer("lyr1");
        expect(setVisibility).toHaveBeenCalledWith("lyr1", true, "user");
        expect(updateSpy).toHaveBeenCalled();
        expect(LayerManagerVisibility._loadLayerLegend).toHaveBeenCalledWith(
            "lyr1",
            expect.any(Object)
        );
        updateSpy.mockRestore();
        delete LayerManagerVisibility._loadLayerLegend;
        globalThis.GeoLeaf = undefined;
        state.layers.clear();
    });

    it("hideLayer with changed true calls updateLayerVisibilityByZoom and disableLabels when Labels set", () => {
        state.layers.set("lyr1", { id: "lyr1" });
        const setVisibility = vi.fn(() => true);
        const disableLabels = vi.fn();
        const syncImmediate = vi.fn();
        globalThis.GeoLeaf = {
            _LayerVisibilityManager: { setVisibility, VisibilitySource: { USER: "user" } },
            Labels: { disableLabels },
            _LabelButtonManager: { syncImmediate },
        };
        LayerManagerVisibility.hideLayer("lyr1");
        expect(setVisibility).toHaveBeenCalledWith("lyr1", false, "user");
        expect(disableLabels).toHaveBeenCalledWith("lyr1");
        expect(syncImmediate).toHaveBeenCalledWith("lyr1");
        globalThis.GeoLeaf = undefined;
        state.layers.clear();
    });

    // ── T22d — visibility.ts branch coverage ──────────────────────
    it("toggleLayer errors and returns when VisibilityManager not available (layer found)", () => {
        state.layers.set("lyr1", { id: "lyr1" });
        globalThis.GeoLeaf = {}; // no _LayerVisibilityManager
        expect(() => LayerManagerVisibility.toggleLayer("lyr1")).not.toThrow();
        globalThis.GeoLeaf = undefined;
        state.layers.clear();
    });

    it("toggleLayer calls showLayer when layer is not currently visible", () => {
        state.layers.set("lyr1", { id: "lyr1", config: {} });
        const setVisibility = vi.fn();
        const showSpy = vi.spyOn(LayerManagerVisibility, "showLayer");
        globalThis.GeoLeaf = {
            _LayerVisibilityManager: {
                setVisibility,
                getVisibilityState: () => ({ current: false }),
                VisibilitySource: { USER: "user" },
            },
        };
        LayerManagerVisibility.toggleLayer("lyr1");
        expect(showSpy).toHaveBeenCalledWith("lyr1");
        showSpy.mockRestore();
        globalThis.GeoLeaf = undefined;
        state.layers.clear();
    });

    // ─── scaleConfig → isScaleInRange (N-1) ──────────────────────────────────
    // These assert the ARGUMENTS handed to isScaleInRange, not just "it didn't throw".
    // The previous versions passed a dead `layerScale` field and asserted
    // `expect.any(Boolean)`, so they stayed green no matter what the code read — which is
    // how `zoomConfig.minZoom` reached the denominator slot unnoticed for ~3 months.

    it("updateLayerVisibilityByZoom reads scaleConfig.{minScale,maxScale} verbatim", () => {
        state.map = {};
        const setVisibility = vi.fn();
        globalThis.GeoLeaf = {
            _LayerVisibilityManager: { setVisibility, VisibilitySource: { ZOOM: "zoom" } },
        };
        state.layers.set("lyr1", {
            id: "lyr1",
            config: {},
            currentStyle: { scaleConfig: { minScale: 9222148, maxScale: 2252 } },
        });
        LayerManagerVisibility.updateLayerVisibilityByZoom();
        // calculateMapScale is mocked to 1000; bounds must arrive untouched.
        expect(isScaleInRange).toHaveBeenCalledWith(1000, 9222148, 2252, expect.anything());
        globalThis.GeoLeaf = undefined;
        state.layers.clear();
    });

    it("updateLayerVisibilityByZoom applies no constraint when scaleConfig is absent", () => {
        state.map = {};
        const setVisibility = vi.fn();
        globalThis.GeoLeaf = {
            _LayerVisibilityManager: { setVisibility, VisibilitySource: { ZOOM: "zoom" } },
        };
        state.layers.set("lyr1", { id: "lyr1", config: {}, currentStyle: {} });
        LayerManagerVisibility.updateLayerVisibilityByZoom();
        // Absent scaleConfig = no bounds, not "hidden": both bounds must be null.
        expect(isScaleInRange).toHaveBeenCalledWith(1000, null, null, expect.anything());
        expect(setVisibility).toHaveBeenCalledWith("lyr1", true, "zoom");
        globalThis.GeoLeaf = undefined;
        state.layers.clear();
    });

    it("updateLayerVisibilityByZoom normalizes bounds <= 0 to null (constraint disabled)", () => {
        state.map = {};
        const setVisibility = vi.fn();
        globalThis.GeoLeaf = {
            _LayerVisibilityManager: { setVisibility, VisibilitySource: { ZOOM: "zoom" } },
        };
        state.layers.set("lyr1", {
            id: "lyr1",
            config: {},
            currentStyle: { scaleConfig: { minScale: 0, maxScale: -100 } },
        });
        LayerManagerVisibility.updateLayerVisibilityByZoom();
        expect(isScaleInRange).toHaveBeenCalledWith(1000, null, null, expect.anything());
        globalThis.GeoLeaf = undefined;
        state.layers.clear();
    });

    // The scale window rules. Ticking a layer no longer overrides it — the
    // old `userForcedVisible` produced exactly the symptom that masked the
    // original defect for ~3 months: ticked layer visible at every zoom, no
    // threshold respected any more.
    it("updateLayerVisibilityByZoom masque une couche cochée hors de sa plage", () => {
        state.map = {};
        const setVisibility = vi.fn();
        globalThis.GeoLeaf = {
            _LayerVisibilityManager: { setVisibility, VisibilitySource: { ZOOM: "zoom" } },
        };
        isScaleInRange.mockReturnValueOnce(false); // hors plage
        state.layers.set("lyr1", {
            id: "lyr1",
            config: {},
            currentStyle: { scaleConfig: { minScale: 9222148, maxScale: 2252 } },
            _visibility: { userOverride: true, logicalState: true }, // cochée par l'utilisateur
        });
        LayerManagerVisibility.updateLayerVisibilityByZoom();
        expect(setVisibility).toHaveBeenCalledWith("lyr1", false, "zoom");
        globalThis.GeoLeaf = undefined;
        state.layers.clear();
    });

    it("updateLayerVisibilityByZoom garde visible une couche cochée DANS sa plage", () => {
        state.map = {};
        const setVisibility = vi.fn();
        globalThis.GeoLeaf = {
            _LayerVisibilityManager: { setVisibility, VisibilitySource: { ZOOM: "zoom" } },
        };
        isScaleInRange.mockReturnValueOnce(true);
        state.layers.set("lyr1", {
            id: "lyr1",
            config: {},
            currentStyle: { scaleConfig: { minScale: 9222148, maxScale: 2252 } },
            _visibility: { userOverride: true, logicalState: true },
        });
        LayerManagerVisibility.updateLayerVisibilityByZoom();
        expect(setVisibility).toHaveBeenCalledWith("lyr1", true, "zoom");
        globalThis.GeoLeaf = undefined;
        state.layers.clear();
    });

    it("updateLayerVisibilityByZoom ignores a retired zoomConfig block", () => {
        state.map = {};
        const setVisibility = vi.fn();
        globalThis.GeoLeaf = {
            _LayerVisibilityManager: { setVisibility, VisibilitySource: { ZOOM: "zoom" } },
        };
        state.layers.set("lyr1", {
            id: "lyr1",
            config: {},
            currentStyle: { zoomConfig: { minZoom: 6, maxZoom: 18 } },
        });
        LayerManagerVisibility.updateLayerVisibilityByZoom();
        // A stale profile must lose its constraint (and stay visible), never get its zoom
        // levels read as denominators. The validator rejects the block upstream.
        expect(isScaleInRange).toHaveBeenCalledWith(1000, null, null, expect.anything());
        globalThis.GeoLeaf = undefined;
        state.layers.clear();
    });

    it("showLayer calls enableLabels when Labels.hasLabelConfig and visibleByDefault true", () => {
        const enableLabels = vi.fn();
        const syncImmediate = vi.fn();
        state.layers.set("lyr1", {
            id: "lyr1",
            currentStyle: { label: { visibleByDefault: true } },
        });
        globalThis.GeoLeaf = {
            _LayerVisibilityManager: {
                setVisibility: vi.fn(() => true),
                VisibilitySource: { USER: "user" },
            },
            Labels: {
                hasLabelConfig: () => true,
                enableLabels,
                areLabelsEnabled: vi.fn(() => false),
            },
            _LabelButtonManager: { syncImmediate },
        };
        LayerManagerVisibility.showLayer("lyr1");
        expect(enableLabels).toHaveBeenCalledWith("lyr1", {}, true);
        expect(syncImmediate).toHaveBeenCalledWith("lyr1");
        globalThis.GeoLeaf = undefined;
        state.layers.clear();
    });

    it("showLayer calls refreshLabels when Labels enabled but visibleByDefault false", () => {
        const refreshLabels = vi.fn();
        state.layers.set("lyr1", {
            id: "lyr1",
            currentStyle: { label: { visibleByDefault: false } },
        });
        globalThis.GeoLeaf = {
            _LayerVisibilityManager: {
                setVisibility: vi.fn(() => true),
                VisibilitySource: { USER: "user" },
            },
            Labels: {
                hasLabelConfig: () => true,
                areLabelsEnabled: () => true,
                refreshLabels,
            },
        };
        LayerManagerVisibility.showLayer("lyr1");
        expect(refreshLabels).toHaveBeenCalledWith("lyr1");
        globalThis.GeoLeaf = undefined;
        state.layers.clear();
    });
});
