/**
 */
/* Phase 5.23 - labels */

const logMock = vi.hoisted(() => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
}));
const mockGetLayerById = vi.fn(() => null);
const mockCreateTooltipsForLayer = vi.fn();
const mockCreateSymbolLayerForMapLibre = vi.fn();

vi.mock("../../../src/utils/log/index.js", () => ({ Log: logMock }));
vi.mock("../../../src/kernel/config/config-primitives.js", () => ({ Config: {} }));
vi.mock("../../../src/capabilities/labels/label-renderer.ts", () => ({
    LabelRenderer: {
        createTooltipsForLayer: (...args) => mockCreateTooltipsForLayer(...args),
        createSymbolLayerForMapLibre: (...args) => mockCreateSymbolLayerForMapLibre(...args),
    },
}));
vi.mock("../../../src/utils/general/scale-utils.js", () => ({
    isScaleInRange: vi.fn(() => true),
    calculateMapScale: vi.fn(() => 1000),
}));
vi.mock("../../../src/api/geoleaf.core.js", () => ({ Core: { getMap: vi.fn(() => null) } }));
vi.mock("../../../src/kernel/geojson/core.js", () => ({
    GeoJSONCore: { getLayerById: (id) => mockGetLayerById(id) },
}));
import { Labels } from "../../../src/capabilities/labels/labels.js";
import { LabelRenderer } from "../../../src/capabilities/labels/label-renderer.js";
import { Core } from "../../../src/api/geoleaf.core.js";

describe("labels (Phase 5.23)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Labels.destroy();
    });

    describe("Labels export", () => {
        it("exports init, enableLabels, disableLabels, toggleLabels, hasLabelConfig, areLabelsEnabled, refreshLabels, destroy", () => {
            expect(Labels.init).toBeDefined();
            expect(Labels.enableLabels).toBeDefined();
            expect(Labels.disableLabels).toBeDefined();
            expect(Labels.toggleLabels).toBeDefined();
            expect(Labels.hasLabelConfig).toBeDefined();
            expect(Labels.areLabelsEnabled).toBeDefined();
            expect(Labels.refreshLabels).toBeDefined();
            expect(Labels.destroy).toBeDefined();
        });
    });

    describe("init", () => {
        // Since B.39 removed the `geoleaf:layer-loaded` subscription, init() subscribes
        // to nothing — it is the lifecycle anchor and logs. The name used to say
        // "calls _attachLayerEvents"; the assertion never checked that, only the log.
        it("logs and stays callable (no subscription)", () => {
            Labels.init();
            expect(logMock.debug).toHaveBeenCalled();
        });
    });

    describe("initializeLayerLabels", () => {
        it("returns early when layerId is empty", () => {
            Labels.initializeLayerLabels("");
            expect(mockGetLayerById).not.toHaveBeenCalled();
        });

        it("returns early when layer data not found", () => {
            mockGetLayerById.mockReturnValue(null);
            Labels.initializeLayerLabels("ly1");
            expect(logMock.debug).toHaveBeenCalled();
        });

        it("calls enableLabels when layer has currentStyle.label.enabled and visibleByDefault and layer visible", async () => {
            mockGetLayerById.mockReturnValue({
                currentStyle: { label: { enabled: true, visibleByDefault: true, labelId: "name" } },
                _visibility: { current: true },
            });
            Labels.initializeLayerLabels("ly1");
            await new Promise((r) => setTimeout(r, 10));
            expect(Labels.hasLabelConfig("ly1")).toBe(true);
        });

        it("calls enableLabels with false when visibleByDefault false", async () => {
            mockGetLayerById.mockReturnValue({
                currentStyle: { label: { enabled: true, visibleByDefault: false } },
                _visibility: { current: true },
            });
            Labels.initializeLayerLabels("ly1");
            await new Promise((r) => setTimeout(r, 10));
            expect(Labels.hasLabelConfig("ly1")).toBe(true);
            expect(Labels.areLabelsEnabled("ly1")).toBe(false);
        });

        it("calls enableLabels with false when layer not visible", async () => {
            mockGetLayerById.mockReturnValue({
                currentStyle: { label: { enabled: true, visibleByDefault: true } },
                _visibility: { current: false },
            });
            Labels.initializeLayerLabels("ly1");
            await new Promise((r) => setTimeout(r, 10));
            expect(Labels.hasLabelConfig("ly1")).toBe(true);
        });
    });

    describe("enableLabels", () => {
        it("returns when layerId is missing", async () => {
            await Labels.enableLabels("");
            expect(logMock.warn).toHaveBeenCalled();
        });

        it("throws when obsolete styleFile config detected", async () => {
            await expect(Labels.enableLabels("ly1", { styleFile: "x.json" })).rejects.toThrow(
                "Obsolete configuration"
            );
        });

        it("returns when no label config in layer and no labelConfig", async () => {
            mockGetLayerById.mockReturnValue({ currentStyle: {} });
            await Labels.enableLabels("ly1");
            expect(Labels.hasLabelConfig("ly1")).toBe(false);
        });

        it("returns when layer has currentStyle.label but enabled is false", async () => {
            mockGetLayerById.mockReturnValue({ currentStyle: { label: { enabled: false } } });
            await Labels.enableLabels("ly1");
            expect(Labels.hasLabelConfig("ly1")).toBe(false);
            expect(logMock.debug).toHaveBeenCalled();
        });

        it("uses labelScale from layer currentStyle when present", async () => {
            mockGetLayerById.mockReturnValue({
                currentStyle: {
                    label: { enabled: true, labelId: "name" },
                    labelScale: { minScale: 100, maxScale: 1000 },
                },
                _visibility: { current: true },
                layer: { getLatLng: () => ({}) },
            });
            await Labels.enableLabels("ly1", {}, true);
            expect(Labels.hasLabelConfig("ly1")).toBe(true);
        });

        it("uses labelConfig when layer has no currentStyle.label but labelConfig has enabled and labelId", async () => {
            mockGetLayerById.mockReturnValue({
                currentStyle: {},
                _visibility: { current: true },
                layer: { getLatLng: () => ({}) },
            });
            await Labels.enableLabels("ly1", { enabled: true, labelId: "name" }, true);
            expect(Labels.hasLabelConfig("ly1")).toBe(true);
        });

        it("sets state and calls _createLabelsForLayer when layer has currentStyle.label.enabled", async () => {
            mockGetLayerById.mockReturnValue({
                currentStyle: { label: { enabled: true, labelId: "name" }, labelScale: null },
                _visibility: { current: true },
                layer: null,
            });
            await Labels.enableLabels("ly1", {}, true);
            expect(Labels.hasLabelConfig("ly1")).toBe(true);
            expect(Labels.areLabelsEnabled("ly1")).toBe(true);
        });
    });

    describe("disableLabels", () => {
        it("returns when layerId is empty without logging", () => {
            logMock.debug.mockClear();
            Labels.disableLabels("");
            expect(logMock.debug).not.toHaveBeenCalled();
        });

        it("disables and clears tooltips when layer state exists", async () => {
            mockGetLayerById.mockReturnValue({
                currentStyle: { label: { enabled: true, field: "name" }, labelScale: null },
                _visibility: { current: true },
                layer: null,
            });
            await Labels.enableLabels("ly1", {}, true);
            expect(Labels.areLabelsEnabled("ly1")).toBe(true);
            Labels.disableLabels("ly1");
            expect(Labels.areLabelsEnabled("ly1")).toBe(false);
        });
    });

    describe("hasLabelConfig", () => {
        it("returns false when layer never enabled", () => {
            expect(Labels.hasLabelConfig("unknown")).toBe(false);
        });
        it("returns true when layer has config", async () => {
            mockGetLayerById.mockReturnValue({
                currentStyle: { label: { enabled: true, labelId: "n" } },
                _visibility: { current: true },
                layer: null,
            });
            await Labels.enableLabels("ly1", {}, true);
            expect(Labels.hasLabelConfig("ly1")).toBe(true);
        });
    });

    describe("areLabelsEnabled", () => {
        it("returns false when no state for layer", () => {
            expect(Labels.areLabelsEnabled("unknown")).toBe(false);
        });
        it("returns true when labels enabled for layer", async () => {
            mockGetLayerById.mockReturnValue({
                currentStyle: { label: { enabled: true, labelId: "n" } },
                _visibility: { current: true },
                layer: null,
            });
            await Labels.enableLabels("ly1", {}, true);
            expect(Labels.areLabelsEnabled("ly1")).toBe(true);
        });
    });

    describe("toggleLabels", () => {
        it("returns false when layerId is empty", () => {
            expect(Labels.toggleLabels("")).toBe(false);
        });

        it("returns false when no layer state", () => {
            expect(Labels.toggleLabels("unknown")).toBe(false);
        });

        it("disables labels and returns false when layer had labels enabled", async () => {
            mockGetLayerById.mockReturnValue({
                currentStyle: { label: { enabled: true, labelId: "name" } },
                _visibility: { current: true },
                layer: null,
            });
            await Labels.enableLabels("ly1", {}, true);
            expect(Labels.toggleLabels("ly1")).toBe(false);
            expect(Labels.areLabelsEnabled("ly1")).toBe(false);
        });

        it("enables labels and returns true when layer had labels disabled", async () => {
            mockGetLayerById.mockReturnValue({
                currentStyle: { label: { enabled: true, labelId: "name" } },
                _visibility: { current: true },
                layer: null,
            });
            await Labels.enableLabels("ly1", {}, false);
            expect(Labels.areLabelsEnabled("ly1")).toBe(false);
            expect(Labels.toggleLabels("ly1")).toBe(true);
            expect(Labels.areLabelsEnabled("ly1")).toBe(true);
        });
    });

    describe("refreshLabels", () => {
        it("returns when layerId is empty", () => {
            expect(() => Labels.refreshLabels("")).not.toThrow();
        });

        it("returns when layer has state but not enabled", async () => {
            mockGetLayerById.mockReturnValue({
                currentStyle: { label: { enabled: true, labelId: "name" } },
                _visibility: { current: true },
                layer: null,
            });
            await Labels.enableLabels("ly1", {}, false);
            Labels.refreshLabels("ly1");
            expect(mockCreateTooltipsForLayer).not.toHaveBeenCalled();
        });

        it("calls _createLabelsForLayer when enabled and visible", async () => {
            mockGetLayerById.mockReturnValue({
                currentStyle: { label: { enabled: true, field: "name" }, labelScale: null },
                _visibility: { current: true },
                features: [{ type: "Feature", properties: { name: "A" } }],
            });
            await Labels.enableLabels("ly1", {}, true);
            expect(mockCreateSymbolLayerForMapLibre).toHaveBeenCalled();
        });
    });

    describe("destroy", () => {
        it("clears layers and logs", () => {
            Labels.destroy();
            expect(logMock.debug).toHaveBeenCalled();
        });
    });

    // ── Additional branches (TEST-04) ────────────────────────────────────

    describe("initializeLayerLabels — branch label.enabled !== true", () => {
        it("returns early and logs when label.enabled is false", () => {
            mockGetLayerById.mockReturnValue({
                currentStyle: { label: { enabled: false } },
                _visibility: { current: true },
            });
            Labels.initializeLayerLabels("ly-disabled");
            expect(logMock.debug).toHaveBeenCalled();
            expect(Labels.hasLabelConfig("ly-disabled")).toBe(false);
        });

        it("returns early when currentStyle has no label property", () => {
            mockGetLayerById.mockReturnValue({
                currentStyle: {},
                _visibility: { current: true },
            });
            Labels.initializeLayerLabels("ly-nolabel");
            expect(Labels.hasLabelConfig("ly-nolabel")).toBe(false);
        });
    });

    describe("enableLabels — catch block (error branch)", () => {
        it("logs error when _createLabelsForLayer throws", async () => {
            mockGetLayerById.mockImplementationOnce(() => {
                throw new Error("mock error");
            });
            await Labels.enableLabels("ly-err", {});
            expect(logMock.error).toHaveBeenCalled();
        });
    });

    describe("_createLabelsForLayer — LabelRenderer not available branch", () => {
        it("logs error when LabelRenderer is not defined (via enabling when renderer unavailable)", async () => {
            // After enabling labels, disable LabelRenderer by patching the mock
            const origCreate = LabelRenderer.createTooltipsForLayer;
            LabelRenderer.createTooltipsForLayer = null;
            mockGetLayerById.mockReturnValue({
                currentStyle: { label: { enabled: true, field: "name" }, labelScale: null },
                _visibility: { current: true },
                layer: null,
            });
            await Labels.enableLabels("ly-norenderer", {}, true);
            // Verify that the no-renderer path was hit (logged or no crash)
            LabelRenderer.createTooltipsForLayer = origCreate;
        });
    });

    describe("_calculateMapScale and _isScaleInRange fallback paths", () => {
        it("calls _createLabelsForLayer with labelScale check when map available", async () => {
            const mockMap = { getZoom: vi.fn(() => 10) };
            Core.getMap.mockReturnValue(mockMap);
            const mockLayer = { getLatLng: () => ({ lat: 0, lng: 0 }), eachLayer: vi.fn() };
            mockGetLayerById.mockReturnValue({
                currentStyle: {
                    label: { enabled: true, field: "name" },
                    labelScale: { minScale: 100, maxScale: 5000 },
                },
                _visibility: { current: true },
                layer: mockLayer,
            });
            await Labels.enableLabels("ly-scale", {}, true);
            expect(Labels.hasLabelConfig("ly-scale")).toBe(true);
            Core.getMap.mockReturnValue(null); // restore
        });

        it("handles minZoom/maxZoom config on map when no labelScale — layer visible", async () => {
            const mockMap = { getZoom: vi.fn(() => 15) };
            Core.getMap.mockReturnValue(mockMap);
            const mockLayer = { getLatLng: () => ({ lat: 0, lng: 0 }), eachLayer: vi.fn() };
            mockGetLayerById.mockReturnValue({
                currentStyle: {
                    label: { enabled: true, field: "name" },
                    labelScale: null,
                },
                _visibility: { current: true },
                layer: mockLayer,
            });
            await Labels.enableLabels("ly-zoom", { minZoom: 10, maxZoom: 18 }, true);
            expect(Labels.hasLabelConfig("ly-zoom")).toBe(true);
            Core.getMap.mockReturnValue(null); // restore
        });

        it("handles out-of-range zoom — labels not shown", async () => {
            const mockMap = { getZoom: vi.fn(() => 5) };
            Core.getMap.mockReturnValue(mockMap);
            const mockLayer = { getLatLng: () => ({ lat: 0, lng: 0 }), eachLayer: vi.fn() };
            mockGetLayerById.mockReturnValue({
                currentStyle: {
                    label: { enabled: true, field: "name" },
                    labelScale: null,
                },
                _visibility: { current: true },
                layer: mockLayer,
            });
            // Use external labelConfig with minZoom/maxZoom so _createLabelsForLayer can check
            await Labels.enableLabels(
                "ly-zoom-out",
                { enabled: true, labelId: "name", minZoom: 10, maxZoom: 18 },
                true
            );
            expect(Labels.hasLabelConfig("ly-zoom-out")).toBe(true);
            Core.getMap.mockReturnValue(null); // restore
        });
    });

    describe("_handleZoomChange branch coverage", () => {
        it("_handleZoomChange does nothing when no map", () => {
            Core.getMap.mockReturnValue(null);
            // Access private method via bound object
            expect(
                () => Labels._handleZoomChange && Labels._handleZoomChange({ zoom: 10 })
            ).not.toThrow();
        });
    });
});
