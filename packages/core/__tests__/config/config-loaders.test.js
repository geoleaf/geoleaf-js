/**
 * Tests pour config-loaders — Phase 1 step 1.5 (0% → 60%)
 */
// `vi.hoisted()` is what makes the static import below possible. `vi.mock()` calls are
// hoisted above the module body, so a factory closing over a plain `const` fires while that
// const is still in its TDZ — the deferred `require()` used to hide this by running the
// factory late. Declaring the fixtures here runs them before any factory.
const { mockLog, loadUrlMock, loadActiveProfileResourcesMock, mockConfigInstance } = vi.hoisted(
    () => ({
        mockLog: { error: vi.fn() },
        loadUrlMock: vi.fn(),
        loadActiveProfileResourcesMock: vi.fn(),
        mockConfigInstance: {
            _config: { map: {} },
            _applyConfig: vi.fn(),
            _maybeFireLoadedEvent: vi.fn(),
        },
    })
);

vi.mock("../../src/utils/log/index.js", () => ({ Log: mockLog }));

vi.mock("../../src/kernel/config/loader.js", () => ({
    ConfigLoader: { loadUrl: (...args) => loadUrlMock(...args) },
}));

vi.mock("../../src/kernel/config/profile.js", () => ({
    ProfileManager: {
        loadActiveProfileResources: (...args) => loadActiveProfileResourcesMock(...args),
    },
}));

vi.mock("../../src/kernel/config/geoleaf-config/config-core.js", () => ({
    Config: mockConfigInstance,
}));

import { Config } from "../../src/kernel/config/geoleaf-config/config-loaders.js";

describe("config/config-loaders", () => {
    beforeEach(() => {
        mockConfigInstance._config = { map: {} };
        mockConfigInstance._applyConfig.mockClear();
        mockConfigInstance._maybeFireLoadedEvent.mockClear();
        loadUrlMock.mockReset();
        loadActiveProfileResourcesMock.mockReset();
    });

    describe("loadUrl", () => {
        it("applies config and returns _config on success", async () => {
            const jsonCfg = { map: { zoom: 10 } };
            loadUrlMock.mockResolvedValue(jsonCfg);
            const out = await Config.loadUrl("/config.json");
            expect(mockConfigInstance._applyConfig).toHaveBeenCalledWith(jsonCfg, "url");
            expect(mockConfigInstance._maybeFireLoadedEvent).toHaveBeenCalled();
            expect(out).toBe(mockConfigInstance._config);
        });
        it("returns _config on fetch error (catch)", async () => {
            loadUrlMock.mockRejectedValue(new Error("Network error"));
            const out = await Config.loadUrl("/config.json");
            expect(mockLog.error).toHaveBeenCalled();
            expect(out).toBe(mockConfigInstance._config);
        });
    });

    describe("loadActiveProfileResources", () => {
        it("returns Profile.loadActiveProfileResources result", async () => {
            const cfg = { data: {} };
            loadActiveProfileResourcesMock.mockResolvedValue(cfg);
            const out = await Config.loadActiveProfileResources({ headers: {} });
            expect(out).toBe(cfg);
            expect(loadActiveProfileResourcesMock).toHaveBeenCalledWith({ headers: {} });
        });

        it("uses default options={} when called without argument", async () => {
            loadActiveProfileResourcesMock.mockResolvedValue({});
            await Config.loadActiveProfileResources();
            expect(loadActiveProfileResourcesMock).toHaveBeenCalledWith({});
        });
    });

    describe("null-module rejection branches", () => {
        let loaderMod, profileMod;

        beforeEach(async () => {
            loaderMod = await import("../../src/kernel/config/loader.js");
            profileMod = await import("../../src/kernel/config/profile.js");
            mockLog.error.mockClear();
        });

        it("loadUrl rejects with error when ConfigLoader is not available", async () => {
            const orig = loaderMod.ConfigLoader;
            loaderMod.ConfigLoader = null;
            await expect(Config.loadUrl("/config.json")).rejects.toThrow(
                "Loader module not available"
            );
            expect(mockLog.error).toHaveBeenCalledWith(
                expect.stringContaining("Loader module not available")
            );
            loaderMod.ConfigLoader = orig;
        });

        it("loadActiveProfileResources rejects with error when ProfileManager is not available", async () => {
            const orig = profileMod.ProfileManager;
            profileMod.ProfileManager = null;
            await expect(Config.loadActiveProfileResources()).rejects.toThrow(
                "Profile module not available"
            );
            expect(mockLog.error).toHaveBeenCalledWith(
                expect.stringContaining("Profile module not available")
            );
            profileMod.ProfileManager = orig;
        });
    });
});
