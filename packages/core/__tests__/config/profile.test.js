/**
 * Tests pour ProfileManager — Phase 1 step 1.2 (coverage 16% → 55%)
 */
const mockLog = vi.hoisted(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}));
vi.mock("../../src/utils/log/index.js", () => ({ Log: mockLog }));

const fetchJsonMock = vi.fn();
vi.mock("../../src/kernel/config/loader.js", () => ({
    ConfigLoader: { fetchJson: (...args) => fetchJsonMock(...args) },
}));

const normalizePoiMock = vi.hoisted(() => vi.fn((x) => x));
vi.mock("../../src/kernel/config/normalization.js", () => ({
    ConfigNormalizer: {
        normalizePoiWithMapping: normalizePoiMock,
    },
}));

const isModularProfileMock = vi.fn(() => false);
const loadModularProfileMock = vi.fn();
vi.mock("../../src/kernel/config/profile-loader.js", () => ({
    ProfileLoader: {
        isModularProfile: (...args) => isModularProfileMock(...args),
        loadModularProfile: (...args) => loadModularProfileMock(...args),
    },
}));

import { ProfileManager } from "../../src/kernel/config/profile.js";

describe("config/profile", () => {
    beforeEach(() => {
        mockLog.info.mockClear();
        mockLog.warn.mockClear();
        mockLog.error.mockClear();
        fetchJsonMock.mockReset();
        isModularProfileMock.mockReturnValue(false);
        loadModularProfileMock.mockReset();
        normalizePoiMock.mockImplementation((x) => x);
    });

    describe("init", () => {
        test("stores config", () => {
            const cfg = { data: {} };
            ProfileManager.init(cfg);
            expect(ProfileManager.getActiveProfileId()).toBeNull();
            expect(ProfileManager.getActiveProfile()).toBeNull();
        });
    });

    describe("isProfilePoiMappingEnabled", () => {
        test("default true when no data config", () => {
            ProfileManager.init({});
            expect(ProfileManager.isProfilePoiMappingEnabled()).toBe(true);
        });

        test("respects data.enableProfilePoiMapping", () => {
            ProfileManager.init({ data: { enableProfilePoiMapping: false } });
            expect(ProfileManager.isProfilePoiMappingEnabled()).toBe(false);
            ProfileManager.init({ data: { enableProfilePoiMapping: true } });
            expect(ProfileManager.isProfilePoiMappingEnabled()).toBe(true);
        });

        test("respects data.useProfilePoiMapping", () => {
            ProfileManager.init({ data: { useProfilePoiMapping: false } });
            expect(ProfileManager.isProfilePoiMappingEnabled()).toBe(false);
        });

        test("respects data.useMapping", () => {
            ProfileManager.init({ data: { useMapping: false } });
            expect(ProfileManager.isProfilePoiMappingEnabled()).toBe(false);
        });
    });

    describe("getters before load", () => {
        test("getActiveProfileId and getActiveProfile return null", () => {
            ProfileManager.init({ data: {} });
            expect(ProfileManager.getActiveProfileId()).toBeNull();
            expect(ProfileManager.getActiveProfile()).toBeNull();
        });

        test("getActiveProfileMapping returns null", () => {
            ProfileManager.init({ data: {} });
            expect(ProfileManager.getActiveProfileMapping()).toBeNull();
        });

        test("getActiveProfileLayersConfig returns null when no profile", () => {
            ProfileManager.init({ data: {} });
            expect(ProfileManager.getActiveProfileLayersConfig()).toBeNull();
        });
    });

    describe("loadActiveProfileResources", () => {
        test("resolves current config when no activeProfile", async () => {
            const cfg = { data: {}, map: { zoom: 10 } };
            ProfileManager.init(cfg);
            const out = await ProfileManager.loadActiveProfileResources({});
            expect(out).toBe(cfg);
            expect(fetchJsonMock).not.toHaveBeenCalled();
        });

        test("resolves when no data config", async () => {
            const cfg = { map: {} };
            ProfileManager.init(cfg);
            const out = await ProfileManager.loadActiveProfileResources({});
            expect(out).toBe(cfg);
        });

        test("simple profile without modular loads profile.json only", async () => {
            const cfg = { data: { activeProfile: "p1", profilesBasePath: "data/profiles" } };
            ProfileManager.init(cfg);
            const profileData = { layers: [{ normalized: true }] };
            fetchJsonMock.mockResolvedValue(profileData);

            const out = await ProfileManager.loadActiveProfileResources({});
            expect(out).toBe(cfg);
            expect(ProfileManager.getActiveProfileId()).toBe("p1");
            expect(ProfileManager.getActiveProfile()).toEqual(profileData);
        });

        test("non-legacy path: creates profiles object when missing", async () => {
            const cfg = { data: { activeProfile: "p1" } };
            ProfileManager.init(cfg);
            fetchJsonMock.mockResolvedValue({ layers: [] });
            await ProfileManager.loadActiveProfileResources({});
            expect(cfg.profiles).toBeDefined();
            expect(cfg.profiles.p1).toBeDefined();
            expect(cfg.profiles.p1.profile).toBeDefined();
            expect(cfg.profiles.p1.poi).toEqual([]);
            expect(cfg.profiles.p1.routes).toEqual([]);
        });

        test("dispatches geoleaf:profile:loaded event", async () => {
            const cfg = { data: { activeProfile: "p1" } };
            ProfileManager.init(cfg);
            fetchJsonMock.mockResolvedValue({ layers: [] });
            const spy = vi.spyOn(document, "dispatchEvent");
            await ProfileManager.loadActiveProfileResources({});
            expect(spy).toHaveBeenCalled();
            const event = spy.mock.calls.find((c) => c[0]?.type === "geoleaf:profile:loaded");
            expect(event).toBeDefined();
            expect(event[0].detail?.profileId).toBe("p1");
            spy.mockRestore();
        });

        test("modular path: loads via ProfileLoader.loadModularProfile", async () => {
            const cfg = { data: { activeProfile: "mod1" } };
            ProfileManager.init(cfg);
            isModularProfileMock.mockReturnValue(true);
            const modularProfile = { Files: {} };
            const enrichedProfile = { layers: [], themes: {} };
            fetchJsonMock.mockResolvedValue(modularProfile);
            loadModularProfileMock.mockResolvedValue(enrichedProfile);

            const out = await ProfileManager.loadActiveProfileResources({});
            expect(loadModularProfileMock).toHaveBeenCalledWith(
                modularProfile,
                expect.stringContaining("mod1"),
                "mod1",
                expect.any(Number),
                expect.any(Object),
                false
            );
            expect(ProfileManager.getActiveProfile()).toEqual(enrichedProfile);
            expect(out).toBeDefined();
        });

        // ── Regression: the modular path must RESOLVE with the merged config ──────
        // `_applyModularEnrichedProfile` merges the profile INTO `_config` (per-module
        // for the `modules` bag) and used to resolve with `enrichedProfile` — the
        // profile object, whose bag holds only the profile's own entries. `boot-core`
        // feeds that resolved value to `registry.init()` as `effectiveCfg`, so every
        // app-global block declared ONLY in `geoleaf.config.json` (`modules.pwa`,
        // `modules.branding`) was invisible to the modules. Concretely: the `offline`
        // capability gates on `modules.pwa.enabled` inside `SharedModule` #8 and never
        // started its engine — on EVERY profile, all of which are modular.
        // The flat path already resolved with `_config` (see the test above); this is
        // the same contract for the modular one.
        test("modular path: resolves with the MERGED config, not the profile object", async () => {
            const cfg = {
                data: { activeProfile: "mod1" },
                // App-global blocks: declared by the root config, by nothing else.
                modules: { pwa: { enabled: true }, branding: { enabled: true } },
            };
            ProfileManager.init(cfg);
            isModularProfileMock.mockReturnValue(true);
            fetchJsonMock.mockResolvedValue({ Files: {} });
            loadModularProfileMock.mockResolvedValue({
                layers: [],
                themes: {},
                map: { zoom: 8 },
                modules: { offline: { enabled: true }, addpoi: { enabled: true } },
            });

            const out = await ProfileManager.loadActiveProfileResources({});

            // Identity: the resolved object IS the merged config singleton.
            expect(out).toBe(cfg);
            // Union of both bags — root-only entries survive the profile merge.
            expect(Object.keys(out.modules).sort()).toEqual([
                "addpoi",
                "branding",
                "offline",
                "pwa",
            ]);
            // The `offline → pwa` dependency, read post-merge by SharedModule #8.
            expect(out.modules.pwa.enabled).toBe(true);
            expect(out.modules.offline.enabled).toBe(true);
            // Non-`modules` profile keys are copied over by the same pass.
            expect(out.map).toEqual({ zoom: 8 });
        });
    });

    describe("getActiveProfileLayersConfig", () => {
        test("getActiveProfileLayersConfig returns layers from active profile", async () => {
            const cfg = { data: { activeProfile: "p1" } };
            ProfileManager.init(cfg);
            const layers = [{ id: "l1" }];
            fetchJsonMock.mockResolvedValue({ layers });
            await ProfileManager.loadActiveProfileResources({});
            expect(ProfileManager.getActiveProfileLayersConfig()).toEqual(layers);
        });
    });
});
