/**
 */
/* Phase 5.31 - theme-applier/core */

const mockShowLoading = vi.hoisted(() => vi.fn());
const mockHideLoading = vi.hoisted(() => vi.fn());
const mockRefresh = vi.hoisted(() => vi.fn());

vi.mock("../../src/kernel/config/config-primitives.js", () => ({
    Config: { Profile: { getActiveProfileConfig: vi.fn(() => ({ performance: {} })) } },
}));
vi.mock("../../src/api/geoleaf.legend.js", () => ({
    Legend: {
        showLoadingOverlay: mockShowLoading,
        hideLoadingOverlay: mockHideLoading,
    },
}));
vi.mock("../../src/api/geoleaf.layer-manager.js", () => ({
    LayerManager: { refresh: mockRefresh },
}));
vi.mock("../../src/kernel/geojson/core.js", () => ({ GeoJSONCore: {} }));

import { ThemeApplierCore } from "../../src/kernel/themes/theme-applier/core.js";

describe("theme-applier/core (Phase 5.31)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        ThemeApplierCore._currentThemeId = null;
        ThemeApplierCore._hideAllLayers = vi.fn();
        ThemeApplierCore._applyLayerConfig = vi.fn(() => Promise.resolve());
        ThemeApplierCore._syncLegendVisibility = vi.fn();
        ThemeApplierCore._fitBoundsOnAllLayers = vi.fn();
    });

    describe("ThemeApplierCore export", () => {
        it("exports applyTheme and getCurrentThemeId", () => {
            expect(ThemeApplierCore.applyTheme).toBeDefined();
            expect(ThemeApplierCore.getCurrentThemeId).toBeDefined();
        });
    });

    describe("getCurrentThemeId", () => {
        it("returns null initially", () => {
            expect(ThemeApplierCore.getCurrentThemeId()).toBeNull();
        });
    });

    describe("applyTheme", () => {
        it("rejects when theme is null or missing id", async () => {
            await expect(ThemeApplierCore.applyTheme(null)).rejects.toThrow("Invalid theme");
            await expect(ThemeApplierCore.applyTheme({})).rejects.toThrow("Invalid theme");
            await expect(ThemeApplierCore.applyTheme({ id: "" })).rejects.toThrow("Invalid theme");
        });

        it("calls Legend.showLoadingOverlay and hideLoadingOverlay", async () => {
            const theme = { id: "test-theme", name: "Test", layers: [] };
            await ThemeApplierCore.applyTheme(theme);
            expect(mockShowLoading).toHaveBeenCalled();
            expect(mockHideLoading).toHaveBeenCalled();
        });

        it("calls _hideAllLayers and sets _currentThemeId on success", async () => {
            const theme = { id: "my-theme", name: "My Theme", layers: [] };
            await ThemeApplierCore.applyTheme(theme);
            expect(ThemeApplierCore._hideAllLayers).toHaveBeenCalled();
            expect(ThemeApplierCore.getCurrentThemeId()).toBe("my-theme");
        });

        it("dispatches geoleaf:theme:applying and geoleaf:theme:applied", async () => {
            const applying = vi.fn();
            const applied = vi.fn();
            document.addEventListener("geoleaf:theme:applying", applying);
            document.addEventListener("geoleaf:theme:applied", applied);
            await ThemeApplierCore.applyTheme({ id: "evt", layers: [] });
            expect(applying).toHaveBeenCalled();
            expect(applied).toHaveBeenCalled();
            document.removeEventListener("geoleaf:theme:applying", applying);
            document.removeEventListener("geoleaf:theme:applied", applied);
        });
    });
});
