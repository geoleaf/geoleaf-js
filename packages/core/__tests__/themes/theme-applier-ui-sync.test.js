/**
 */
/* Phase 5.33 - theme-applier/ui-sync */

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
const mockGetMarkerLayer = vi.fn(() => null);
vi.mock("../../src/kernel/shared/poi-state.js", () => ({
    POIShared: { getMarkerLayer: (...args) => mockGetMarkerLayer(...args) },
}));
const mockGetVisibilityState = vi.fn(() => ({ current: true }));
vi.mock("../../src/kernel/shared/layer-visibility-state.js", () => ({
    LayerVisibilityManager: { getVisibilityState: (...args) => mockGetVisibilityState(...args) },
}));
vi.mock("../../src/capabilities/legend/legend-seam.js", () => ({
    LegendContract: {
        isAvailable: vi.fn(() => false),
        loadLayerLegend: mockLoadLayerLegend,
        setLayerVisibility: mockSetLayerVisibility,
    },
}));
const mockGetMap = vi.fn(() => null);
vi.mock("../../src/api/geoleaf.core.js", () => ({
    Core: { getMap: (...args) => mockGetMap(...args) },
}));
import { ThemeApplierUISync as TA } from "../../src/kernel/themes/theme-applier/ui-sync.js";
import { LegendContract as legend } from "../../src/capabilities/legend/legend-seam.js";

describe("theme-applier/ui-sync (Phase 5.33)", () => {
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

    describe("_fitBoundsOnAllLayers", () => {
        it("returns early when Core.getMap() is null", () => {
            mockGetMap.mockReturnValueOnce(null);
            expect(() => TA._fitBoundsOnAllLayers()).not.toThrow();
        });

        it("does not throw when layers and map available (MapLibre mode)", () => {
            const map = { fitBounds: vi.fn() };
            mockGetMap.mockReturnValueOnce(map);
            mockGetLayers.mockReturnValueOnce([
                ["layer-1", { layer: { id: "l1" } }],
                ["layer-2", { layer: { id: "l2" } }],
            ]);
            const el = document.createElement("div");
            el.id = "geoleaf-map";
            document.body.appendChild(el);
            expect(() => TA._fitBoundsOnAllLayers()).not.toThrow();
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

    describe("_fitBoundsOnAllLayers branches", () => {
        it("calls loading screen updateProgress when present", () => {
            const updateProgress = vi.fn();
            window._glLoadingScreen = { updateProgress };
            const map = { fitBounds: vi.fn() };
            mockGetMap.mockReturnValueOnce(map);
            mockGetLayers.mockReturnValueOnce([["l1", { layer: {} }]]);
            document.body.innerHTML = '<div id="geoleaf-map"></div>';
            TA._fitBoundsOnAllLayers();
            expect(updateProgress).toHaveBeenCalledWith(99);
            delete window._glLoadingScreen;
        });

        it("does not throw when map container exists", () => {
            const map = { fitBounds: vi.fn() };
            mockGetMap.mockReturnValueOnce(map);
            mockGetLayers.mockReturnValueOnce(new Map([["l1", { layer: {} }]]));
            const container = document.createElement("div");
            container.id = "geoleaf-map";
            document.body.appendChild(container);
            expect(() => TA._fitBoundsOnAllLayers()).not.toThrow();
        });

        it("does not call fitBounds in MapLibre mode (no Leaflet bounds path)", () => {
            const map = { fitBounds: vi.fn() };
            mockGetMap.mockReturnValueOnce(map);
            mockGetLayers.mockReturnValueOnce(new Map([["l1", { layer: {} }]]));
            TA._fitBoundsOnAllLayers();
            expect(map.fitBounds).not.toHaveBeenCalled();
        });

        it("does not throw when POI marker layer present (MapLibre mode)", () => {
            const poiLayer = {};
            mockGetMarkerLayer.mockReturnValueOnce(poiLayer);
            const map = { fitBounds: vi.fn() };
            mockGetMap.mockReturnValueOnce(map);
            mockGetLayers.mockReturnValueOnce([]);
            document.body.innerHTML = '<div id="geoleaf-map"></div>';
            expect(() => TA._fitBoundsOnAllLayers()).not.toThrow();
        });

        it("does not throw while iterating layers (MapLibre mode)", () => {
            const map = { fitBounds: vi.fn() };
            mockGetMap.mockReturnValueOnce(map);
            mockGetLayers.mockReturnValueOnce([["l1", { layer: {} }]]);
            document.body.innerHTML = '<div id="geoleaf-map"></div>';
            expect(() => TA._fitBoundsOnAllLayers()).not.toThrow();
        });
    });
});
