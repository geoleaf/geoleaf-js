/**
 */
/* Phase 5.34 - theme-applier/visibility */

const mockResetAllUserOverrides = vi.hoisted(() => vi.fn());
const mockSetVisibility = vi.hoisted(() => vi.fn());
const mockGetLayers = vi.hoisted(() => vi.fn(() => []));
const mockLayersMap = new Map();
const mockScheduleLayerConfig = vi.fn(() => Promise.resolve());
const mockLoadLayerFromProfile = vi.fn(() => Promise.resolve(null));

vi.mock("../../src/utils/log/index.js", () => ({ Log: { warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../src/kernel/config/config-primitives.js", () => ({
    Config: { getActiveProfile: () => null },
}));
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
vi.mock("../../src/kernel/shared/layer-visibility-state.js", () => ({
    LayerVisibilityManager: {
        resetAllUserOverrides: mockResetAllUserOverrides,
        setVisibility: mockSetVisibility,
        VisibilitySource: { THEME: "theme" },
        getVisibilityState: () => ({ current: true }),
    },
}));
vi.mock("../../src/kernel/geojson/layers/style.js", () => ({
    LayerManagerStyle: { setLayerStyle: vi.fn() },
}));
vi.mock("../../src/utils/loaders/style-loader.js", () => ({
    StyleLoader: { loadAndValidateStyle: vi.fn() },
}));
// Labels + button manager are consumed via the runtime global (getGeoLeaf),
// not a static import (S4 in-core capability decoupling) — mock the global seam.
const labelsMocks = vi.hoisted(() => ({
    Labels: { disableLabels: vi.fn(), initializeLayerLabels: vi.fn() },
    LabelButtonManager: { syncImmediate: vi.fn() },
}));
vi.mock("../../src/utils/general/geoleaf-global.js", () => ({
    getGeoLeaf: () => ({
        Labels: labelsMocks.Labels,
        _LabelButtonManager: labelsMocks.LabelButtonManager,
    }),
    // ⚠️ Mock PARTIEL : `capabilities/legend/legend.ts` importe aussi `ensureGeoLeaf`, que
    // le shim `require()` rendait `undefined` en silence. Le mocker natif refuse un export
    // non déclaré. Déclaré avec sa valeur de fait — aucun test du fichier ne l'appelle.
    ensureGeoLeaf: undefined,
}));
vi.mock("../../src/api/geoleaf.layer-manager.js", () => ({
    LayerManager: { refresh: vi.fn() },
}));
vi.mock("../../src/kernel/layer-manager/style-selector.js", () => ({
    StyleSelector: { setCurrentStyle: vi.fn() },
}));
import { ThemeApplierVisibility as TA } from "../../src/kernel/themes/theme-applier/visibility.js";
import { StyleLoader } from "../../src/utils/loaders/style-loader.js";
import { LayerManagerStyle } from "../../src/kernel/geojson/layers/style.js";

describe("theme-applier/visibility (Phase 5.34)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockLayersMap.clear();
        TA._scheduleLayerConfig = mockScheduleLayerConfig;
        TA._loadLayerFromProfile = mockLoadLayerFromProfile;
        TA._updateStyleSelector = vi.fn();
        TA._loadLegendForStyle = vi.fn();
    });

    describe("_hideAllLayers", () => {
        it("calls resetAllUserOverrides and setVisibility for each layer", () => {
            const map = new Map([
                ["layer-1", {}],
                ["layer-2", {}],
            ]);
            mockGetLayers.mockReturnValue(map);
            TA._hideAllLayers();
            expect(mockResetAllUserOverrides).toHaveBeenCalled();
            expect(mockSetVisibility).toHaveBeenCalledWith("layer-1", false, "theme");
            expect(mockSetVisibility).toHaveBeenCalledWith("layer-2", false, "theme");
        });
    });

    describe("_applyLayerConfig", () => {
        it("resolves when layerConfig has no id", async () => {
            const spy = vi.spyOn(TA, "_setLayerVisibilityAndStyle");
            await expect(TA._applyLayerConfig({})).resolves.toBeUndefined();
            await expect(TA._applyLayerConfig(null)).resolves.toBeUndefined();
            expect(spy).not.toHaveBeenCalled();
            spy.mockRestore();
        });

        it("calls _setLayerVisibilityAndStyle when layer exists in state", async () => {
            mockLayersMap.set("layer-a", { config: {} });
            const setLayerSpy = vi.spyOn(TA, "_setLayerVisibilityAndStyle").mockResolvedValue();
            await TA._applyLayerConfig({ id: "layer-a", visible: true, style: "default" });
            expect(setLayerSpy).toHaveBeenCalledWith("layer-a", true, "default");
            setLayerSpy.mockRestore();
        });

        it("calls _loadLayerFromProfile then _scheduleLayerConfig when layer not in state", async () => {
            mockLoadLayerFromProfile.mockResolvedValue(null);
            await TA._applyLayerConfig({ id: "missing-layer", visible: false });
            expect(mockLoadLayerFromProfile).toHaveBeenCalledWith("missing-layer");
            expect(mockScheduleLayerConfig).toHaveBeenCalledWith("missing-layer", false, undefined);
        });

        it("calls _setLayerVisibilityAndStyle when _loadLayerFromProfile returns a layer", async () => {
            mockLoadLayerFromProfile.mockResolvedValueOnce({});
            const setLayerSpy = vi.spyOn(TA, "_setLayerVisibilityAndStyle").mockResolvedValue();
            await TA._applyLayerConfig({ id: "loaded-layer", visible: true });
            expect(setLayerSpy).toHaveBeenCalledWith("loaded-layer", true, undefined);
            setLayerSpy.mockRestore();
        });
    });

    describe("_setLayerVisibilityAndStyle", () => {
        it("resolves when layerData is missing", async () => {
            await TA._setLayerVisibilityAndStyle("nonexistent", true, "s1");
            expect(mockSetVisibility).not.toHaveBeenCalled();
        });

        it("sets visibility false and disables labels when visible is false", async () => {
            mockLayersMap.set("layer-hide", { config: { styles: { available: [] } } });
            await TA._setLayerVisibilityAndStyle("layer-hide", false);
            expect(mockSetVisibility).toHaveBeenCalledWith("layer-hide", false, "theme");
            expect(labelsMocks.Labels.disableLabels).toHaveBeenCalledWith("layer-hide");
            expect(labelsMocks.LabelButtonManager.syncImmediate).toHaveBeenCalledWith("layer-hide");
        });

        it("applies style when visible true and styleId exists", async () => {
            const cfg = {
                config: {
                    styles: {
                        available: [{ id: "default", file: "style.json" }],
                    },
                },
                _layerDirectory: "dir",
            };
            mockLayersMap.set("layer-style", cfg);
            // temporarily restore StyleLoader mock to a function
            StyleLoader.loadAndValidateStyle = vi
                .fn()
                .mockResolvedValue({ styleData: { id: "s" } });
            await TA._setLayerVisibilityAndStyle("layer-style", true, "default");
            expect(LayerManagerStyle.setLayerStyle).toHaveBeenCalled();
        });
    });
});
