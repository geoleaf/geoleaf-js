/**
 */
/* theme-applier/ui-sync */

const mockLoadLayerLegend = vi.hoisted(() => vi.fn());
const mockSetLayerVisibility = vi.hoisted(() => vi.fn());
const mockGetLayers = vi.hoisted(() => vi.fn(() => []));
const mockLayersMap = new Map();

vi.mock("../../src/kernel/shared/geojson-state.js", () => ({
    GeoJSONShared: {
        state: {
            get layers() {
                return mockLayersMap;
            },
        },
        getLayers: mockGetLayers,
    },
}));
const mockGetVisibilityState = vi.fn(() => ({ current: true }));
vi.mock("../../src/kernel/shared/layer-visibility-state.js", () => ({
    LayerVisibilityManager: { getVisibilityState: (...args) => mockGetVisibilityState(...args) },
}));
import { ThemeApplierUISync as TA } from "../../src/kernel/themes/theme-applier/ui-sync.js";
import { provideLegend } from "../../src/kernel/shared/legend-slot.js";

// The kernel reaches the legend through its slot, which the legend capability fills at boot —
// it no longer imports the capability. The test fills it with a stand-in.
const legend = {
    isAvailable: vi.fn(() => false),
    loadLayerLegend: mockLoadLayerLegend,
    setLayerVisibility: mockSetLayerVisibility,
};
provideLegend(legend);

describe("theme-applier/ui-sync", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = "";
    });

    describe("_updateStyleSelector", () => {
        it("does nothing when no select element exists", () => {
            TA._updateStyleSelector("layer-1", "default");
            expect(document.getElementById("style-selector-layer-1")).toBeNull();
        });

        it("sets select value when element exists", () => {
            const select = document.createElement("select");
            select.id = "style-selector-layer-1";
            const opt1 = document.createElement("option");
            opt1.value = "default";
            const opt2 = document.createElement("option");
            opt2.value = "style-dark";
            select.appendChild(opt1);
            select.appendChild(opt2);
            document.body.appendChild(select);
            TA._updateStyleSelector("layer-1", "style-dark");
            expect(select.value).toBe("style-dark");
        });
    });

    describe("_loadLegendForStyle", () => {
        it("returns early when LegendContract is not available", () => {
            TA._loadLegendForStyle("layer-1", "default");
            expect(mockLoadLayerLegend).not.toHaveBeenCalled();
        });

        it("calls loadLayerLegend when contract available and layer has config", () => {
            legend.isAvailable = vi.fn(() => true);
            mockLayersMap.set("layer-1", { config: { id: "layer-1" } });
            TA._loadLegendForStyle("layer-1", "default");
            expect(mockLoadLayerLegend).toHaveBeenCalledWith("layer-1", "default", {
                id: "layer-1",
            });
            mockLayersMap.clear();
            legend.isAvailable = vi.fn(() => false);
        });
    });

    describe("_syncLegendVisibility", () => {
        it("returns early when LegendContract is not available", () => {
            TA._syncLegendVisibility();
            expect(mockSetLayerVisibility).not.toHaveBeenCalled();
        });

        it("syncs visibility when LegendContract and GeoJSONShared available", () => {
            legend.isAvailable = vi.fn(() => true);
            mockGetLayers.mockReturnValueOnce(new Map([["layer-1", { visible: true }]]));
            TA._syncLegendVisibility();
            expect(mockSetLayerVisibility).toHaveBeenCalledWith("layer-1", true);
            legend.isAvailable = vi.fn(() => false);
        });

        it("uses layerData.visible when getVisibilityState returns null", () => {
            legend.isAvailable = vi.fn(() => true);
            mockGetVisibilityState.mockReturnValueOnce(null);
            mockGetLayers.mockReturnValueOnce(new Map([["ly", { visible: false }]]));
            TA._syncLegendVisibility();
            expect(mockSetLayerVisibility).toHaveBeenCalledWith("ly", false);
            legend.isAvailable = vi.fn(() => false);
        });
    });

    describe("_loadLegendForStyle branches", () => {
        it("returns early when layer has no config", () => {
            legend.isAvailable = vi.fn(() => true);
            mockLayersMap.set("no-config", {});
            TA._loadLegendForStyle("no-config", "default");
            expect(mockLoadLayerLegend).not.toHaveBeenCalled();
            mockLayersMap.delete("no-config");
            legend.isAvailable = vi.fn(() => false);
        });
    });
});
