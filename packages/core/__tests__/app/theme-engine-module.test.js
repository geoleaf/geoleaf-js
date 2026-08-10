/**
 * ThemeEngineModule — S8/F2 registry-driven default-theme apply.
 *
 * Verifies that ThemeEngineModule.init() loads the active profile's themes config and
 * applies the resolved default theme (decoupled from the selector UI). init() must never
 * reject (a rejection would abort the ModuleRegistry chain).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// `ensureGeoLeaf()` returns a fixed reference the module reads at call time — mutate per test.
const mockGeoLeaf = {};
vi.mock("../../src/utils/general/geoleaf-global.js", () => ({
    ensureGeoLeaf: () => mockGeoLeaf,
    getGeoLeaf: () => mockGeoLeaf,
}));

const mockLoadThemesConfig = vi.fn();
vi.mock("../../src/kernel/themes/theme-loader.js", () => ({
    ThemeLoader: { loadThemesConfig: (id) => mockLoadThemesConfig(id) },
}));

const mockApplyTheme = vi.fn(() => Promise.resolve());
vi.mock("../../src/kernel/themes/theme-applier/core.js", () => ({
    ThemeApplierCore: { applyTheme: (theme) => mockApplyTheme(theme) },
}));

// Dynamic import — defer loading the module (and the mocked accessor) until mockGeoLeaf
// is initialized, so the vi.mock factory doesn't hit its TDZ.
const { ThemeEngineModule } = await import("../../src/app/boot-modules/theme-engine.module.ts");

describe("ThemeEngineModule (S8/F2 — default-theme apply)", () => {
    const AppLog = { log: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() };
    const themesConfig = {
        config: {},
        themes: [
            { id: "light", type: "primary" },
            { id: "dark", type: "primary" },
        ],
        defaultTheme: "light",
    };

    beforeEach(() => {
        vi.clearAllMocks();
        for (const k of Object.keys(mockGeoLeaf)) delete mockGeoLeaf[k];
        mockGeoLeaf._app = { AppLog };
        mockGeoLeaf.Config = { getActiveProfileId: () => "p1" };
        mockLoadThemesConfig.mockResolvedValue(themesConfig);
    });

    it("has id 'theme-engine' and depends on geojson + ui", () => {
        const mod = new ThemeEngineModule();
        expect(mod.id).toBe("theme-engine");
        expect([...mod.dependencies]).toEqual(["geojson", "ui"]);
    });

    it("init() applies the resolved default theme", async () => {
        await new ThemeEngineModule().init({}, {});
        expect(mockLoadThemesConfig).toHaveBeenCalledWith("p1");
        expect(mockApplyTheme).toHaveBeenCalledWith(themesConfig.themes[0]);
    });

    it("init() is a no-op when the profile declares no default theme", async () => {
        mockLoadThemesConfig.mockResolvedValue({ config: {}, themes: [], defaultTheme: null });
        await new ThemeEngineModule().init({}, {});
        expect(mockApplyTheme).not.toHaveBeenCalled();
    });

    it("init() is a no-op when there is no active profile id", async () => {
        mockGeoLeaf.Config = { getActiveProfileId: () => null };
        await new ThemeEngineModule().init({}, {});
        expect(mockLoadThemesConfig).not.toHaveBeenCalled();
        expect(mockApplyTheme).not.toHaveBeenCalled();
    });

    it("init() swallows an applyTheme rejection (never rejects the chain)", async () => {
        mockApplyTheme.mockRejectedValueOnce(new Error("apply fail"));
        await expect(new ThemeEngineModule().init({}, {})).resolves.toBeUndefined();
        expect(AppLog.warn).toHaveBeenCalled();
    });

    it("exposes a destroy() function (registry contract)", () => {
        const mod = new ThemeEngineModule();
        expect(typeof mod.destroy).toBe("function");
        expect(() => mod.destroy()).not.toThrow();
    });
});
