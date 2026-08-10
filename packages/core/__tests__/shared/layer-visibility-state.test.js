/**
 * Phase 60 — Step 4.6: src/kernel/shared/layer-visibility-state.ts (0% → 60%)
 * Re-exporte VisibilityManager comme LayerVisibilityManager
 */
const mockSetLayerVisibility = vi.hoisted(() => vi.fn());
const mockIsLayerVisible = vi.hoisted(() => vi.fn(() => false));
const mockGetHiddenLayers = vi.hoisted(() => vi.fn(() => new Set()));

vi.mock("../../src/kernel/geojson/visibility-manager.ts", () => ({
    VisibilityManager: {
        setLayerVisibility: mockSetLayerVisibility,
        isLayerVisible: mockIsLayerVisible,
        getHiddenLayers: mockGetHiddenLayers,
    },
}));

import { LayerVisibilityManager } from "../../src/kernel/shared/layer-visibility-state.js";

describe("shared/layer-visibility-state (step 4.6)", () => {
    beforeEach(() => {
        mockSetLayerVisibility.mockClear();
        mockIsLayerVisible.mockClear();
        mockGetHiddenLayers.mockClear();
    });

    it("exporte LayerVisibilityManager", () => {
        expect(LayerVisibilityManager).toBeDefined();
    });
    it("LayerVisibilityManager.setLayerVisibility delegates to VisibilityManager", () => {
        LayerVisibilityManager.setLayerVisibility("lyr1", false);
        expect(mockSetLayerVisibility).toHaveBeenCalledWith("lyr1", false);
    });
    it("LayerVisibilityManager.isLayerVisible delegates to VisibilityManager", () => {
        mockIsLayerVisible.mockReturnValue(true);
        expect(LayerVisibilityManager.isLayerVisible("lyr1")).toBe(true);
        expect(mockIsLayerVisible).toHaveBeenCalledWith("lyr1");
    });
    it("LayerVisibilityManager.getHiddenLayers delegates to VisibilityManager", () => {
        const set = new Set(["a"]);
        mockGetHiddenLayers.mockReturnValue(set);
        expect(LayerVisibilityManager.getHiddenLayers()).toBe(set);
    });
});
