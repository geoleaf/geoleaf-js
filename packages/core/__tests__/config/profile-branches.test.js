/**
 * @file profile-branches.test.js
 * @description ESM branch-coverage tests for ProfileManager (config/profile.ts)
 *   Migrates profile.test.js (CJS) to ESM + adds missing branch coverage.
 *   Sprint S5B.14 — Phase C coverage improvement.
 */

const { mockLog, fetchJsonMock, normalizePoiMock, isModularProfileMock, loadModularProfileMock } =
    vi.hoisted(() => ({
        mockLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        fetchJsonMock: vi.fn(),
        normalizePoiMock: vi.fn((x) => x),
        isModularProfileMock: vi.fn(() => false),
        loadModularProfileMock: vi.fn(),
    }));

vi.mock("../../src/utils/log/index.js", () => ({ Log: mockLog }));

vi.mock("../../src/kernel/config/loader.js", () => ({
    ConfigLoader: { fetchJson: fetchJsonMock },
}));

vi.mock("../../src/kernel/config/normalization.js", () => ({
    ConfigNormalizer: {
        normalizePoiWithMapping: normalizePoiMock,
    },
}));

vi.mock("../../src/kernel/config/profile-loader.js", () => ({
    ProfileLoader: {
        isModularProfile: isModularProfileMock,
        loadModularProfile: loadModularProfileMock,
    },
}));

import { ProfileManager } from "../../src/kernel/config/profile.ts";

describe("config/profile — ProfileManager", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset singleton state between tests
        ProfileManager._activeProfileId = null;
        ProfileManager._activeProfile = null;
        ProfileManager._activeProfileData = { mapping: null };
        // Restore default mock implementations
        isModularProfileMock.mockReturnValue(false);
        normalizePoiMock.mockImplementation((x) => x);
    });

    // ─────────────────────────────────────────────────────────────────
    // init
    // ─────────────────────────────────────────────────────────────────
    describe("init", () => {
        test("stores config reference", () => {
            const cfg = { data: {} };
            ProfileManager.init(cfg);
            expect(ProfileManager.getActiveProfileId()).toBeNull();
            expect(ProfileManager.getActiveProfile()).toBeNull();
        });
    });

    // ─────────────────────────────────────────────────────────────────
    // isProfilePoiMappingEnabled
    // ─────────────────────────────────────────────────────────────────
    describe("isProfilePoiMappingEnabled", () => {
        test("returns true when no config", () => {
            ProfileManager.init({});
            expect(ProfileManager.isProfilePoiMappingEnabled()).toBe(true);
        });

        test("returns true when data config is missing", () => {
            ProfileManager.init({ data: undefined });
            expect(ProfileManager.isProfilePoiMappingEnabled()).toBe(true);
        });

        test("respects enableProfilePoiMapping = false", () => {
            ProfileManager.init({ data: { enableProfilePoiMapping: false } });
            expect(ProfileManager.isProfilePoiMappingEnabled()).toBe(false);
        });

        test("respects enableProfilePoiMapping = true", () => {
            ProfileManager.init({ data: { enableProfilePoiMapping: true } });
            expect(ProfileManager.isProfilePoiMappingEnabled()).toBe(true);
        });

        test("respects useProfilePoiMapping = false when enableProfilePoiMapping absent", () => {
            ProfileManager.init({ data: { useProfilePoiMapping: false } });
            expect(ProfileManager.isProfilePoiMappingEnabled()).toBe(false);
        });

        test("respects useMapping = false as last fallback", () => {
            ProfileManager.init({ data: { useMapping: false } });
            expect(ProfileManager.isProfilePoiMappingEnabled()).toBe(false);
        });

        test("enableProfilePoiMapping takes priority over useProfilePoiMapping", () => {
            ProfileManager.init({
                data: {
                    enableProfilePoiMapping: true,
                    useProfilePoiMapping: false,
                    useMapping: false,
                },
            });
            expect(ProfileManager.isProfilePoiMappingEnabled()).toBe(true);
        });
    });

    // ─────────────────────────────────────────────────────────────────
    // Getters — before any profile load
    // ─────────────────────────────────────────────────────────────────
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

    // ─────────────────────────────────────────────────────────────────
    // loadActiveProfileResources — no active profile
    // ─────────────────────────────────────────────────────────────────
    describe("loadActiveProfileResources — no active profile", () => {
        test("resolves config when no activeProfile in data", async () => {
            const cfg = { data: {}, map: { zoom: 10 } };
            ProfileManager.init(cfg);
            const result = await ProfileManager.loadActiveProfileResources({});
            expect(result).toBe(cfg);
            expect(fetchJsonMock).not.toHaveBeenCalled();
        });

        test("resolves config when no data config at all", async () => {
            const cfg = { map: {} };
            ProfileManager.init(cfg);
            const result = await ProfileManager.loadActiveProfileResources({});
            expect(result).toBe(cfg);
        });
    });

    // ─────────────────────────────────────────────────────────────────
    // loadActiveProfileResources — non-legacy path
    // ─────────────────────────────────────────────────────────────────
    describe("loadActiveProfileResources — non-legacy path", () => {
        test("loads profile.json only when all layers are normalized", async () => {
            const cfg = { data: { activeProfile: "p1", profilesBasePath: "data/profiles" } };
            ProfileManager.init(cfg);
            const profileData = { layers: [{ normalized: true }] };
            fetchJsonMock.mockResolvedValue(profileData);

            const result = await ProfileManager.loadActiveProfileResources({});
            expect(result).toBe(cfg);
            expect(ProfileManager.getActiveProfileId()).toBe("p1");
            expect(ProfileManager.getActiveProfile()).toEqual(profileData);
            expect(fetchJsonMock).toHaveBeenCalledTimes(1);
        });

        test("fetches mapping.json when a layer has normalized:false", async () => {
            const cfg = { data: { activeProfile: "p1" } };
            ProfileManager.init(cfg);
            const profileData = { layers: [{ normalized: false }] };
            const mappingData = { field: "value" };
            fetchJsonMock
                .mockResolvedValueOnce(profileData) // profile.json
                .mockResolvedValueOnce(mappingData); // mapping.json

            await ProfileManager.loadActiveProfileResources({});
            expect(fetchJsonMock).toHaveBeenCalledTimes(2);
            const secondCall = fetchJsonMock.mock.calls[1][0];
            expect(secondCall).toContain("mapping.json");
        });

        test("mapping.json fetch error logs and returns null mapping", async () => {
            const cfg = { data: { activeProfile: "p1" } };
            ProfileManager.init(cfg);
            fetchJsonMock
                .mockResolvedValueOnce({ layers: [{ normalized: false }] })
                .mockRejectedValueOnce(new Error("mapping not found"));

            await ProfileManager.loadActiveProfileResources({});
            expect(mockLog.error).toHaveBeenCalledWith(
                expect.stringContaining("mapping.json required"),
                expect.any(Error)
            );
            expect(ProfileManager.getActiveProfileMapping()).toBeNull();
        });

        test("creates profiles object when missing", async () => {
            const cfg = { data: { activeProfile: "p1" } };
            ProfileManager.init(cfg);
            fetchJsonMock.mockResolvedValue({ layers: [] });
            await ProfileManager.loadActiveProfileResources({});
            expect(cfg.profiles).toBeDefined();
            expect(cfg.profiles["p1"]).toBeDefined();
            expect(cfg.profiles["p1"].poi).toEqual([]);
            expect(cfg.profiles["p1"].routes).toEqual([]);
        });

        test("non-legacy: fetch failure returns config", async () => {
            const cfg = { data: { activeProfile: "p1" } };
            ProfileManager.init(cfg);
            fetchJsonMock.mockRejectedValue(new Error("network error"));
            const result = await ProfileManager.loadActiveProfileResources({});
            expect(result).toBe(cfg);
        });

        test("poi mapping disabled skips fetching mapping.json even with normalized:false", async () => {
            const cfg = {
                data: { activeProfile: "p1", enableProfilePoiMapping: false },
            };
            ProfileManager.init(cfg);
            fetchJsonMock.mockResolvedValue({ layers: [{ normalized: false }] });
            await ProfileManager.loadActiveProfileResources({});
            expect(fetchJsonMock).toHaveBeenCalledTimes(1);
        });

        test("dispatches geoleaf:profile:loaded event after load", async () => {
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

        test("profile with no layers array does not require mapping", async () => {
            const cfg = { data: { activeProfile: "p1" } };
            ProfileManager.init(cfg);
            fetchJsonMock.mockResolvedValue({ name: "nolayers" }); // no .layers
            await ProfileManager.loadActiveProfileResources({});
            expect(fetchJsonMock).toHaveBeenCalledTimes(1);
            expect(ProfileManager.getActiveProfile()).toEqual({ name: "nolayers" });
        });
    });

    // ─────────────────────────────────────────────────────────────────
    // loadActiveProfileResources — modular path
    // ─────────────────────────────────────────────────────────────────
    describe("loadActiveProfileResources — modular path", () => {
        test("calls loadModularProfile when isModularProfile returns true", async () => {
            const cfg = { data: { activeProfile: "mod1" } };
            ProfileManager.init(cfg);
            isModularProfileMock.mockReturnValue(true);
            const modularProfile = { Files: {} };
            const enrichedProfile = { layers: [], themes: {} };
            fetchJsonMock.mockResolvedValue(modularProfile);
            loadModularProfileMock.mockResolvedValue(enrichedProfile);

            const result = await ProfileManager.loadActiveProfileResources({});
            expect(loadModularProfileMock).toHaveBeenCalledWith(
                modularProfile,
                expect.stringContaining("mod1"),
                "mod1",
                expect.any(Number),
                expect.any(Object),
                false
            );
            expect(ProfileManager.getActiveProfile()).toEqual(enrichedProfile);
            expect(result).toBeDefined();
        });

        test("modular: non-layer keys copied into config", async () => {
            const cfg = { data: { activeProfile: "mod3" } };
            ProfileManager.init(cfg);
            isModularProfileMock.mockReturnValue(true);
            fetchJsonMock.mockResolvedValue({ Files: {} });
            loadModularProfileMock.mockResolvedValue({
                layers: [],
                themes: {},
                customKey: "customValue",
            });

            await ProfileManager.loadActiveProfileResources({});
            expect(cfg.customKey).toBe("customValue");
        });

        test("modular: profiles map created with empty poi and routes", async () => {
            const cfg = { data: { activeProfile: "mod4" } };
            ProfileManager.init(cfg);
            isModularProfileMock.mockReturnValue(true);
            fetchJsonMock.mockResolvedValue({ Files: {} });
            loadModularProfileMock.mockResolvedValue({ layers: [], themes: {} });

            await ProfileManager.loadActiveProfileResources({});
            expect(cfg.profiles?.["mod4"].poi).toEqual([]);
            expect(cfg.profiles?.["mod4"].routes).toEqual([]);
        });
    });

    // ─────────────────────────────────────────────────────────────────
    // getActiveProfileLayersConfig
    // ─────────────────────────────────────────────────────────────────
    describe("getActiveProfileLayersConfig", () => {
        test("getActiveProfileLayersConfig returns layers from loaded profile", async () => {
            const cfg = { data: { activeProfile: "p1" } };
            ProfileManager.init(cfg);
            const layers = [{ id: "l1" }];
            fetchJsonMock.mockResolvedValue({ layers });
            await ProfileManager.loadActiveProfileResources({});
            expect(ProfileManager.getActiveProfileLayersConfig()).toEqual(layers);
        });

        test("getActiveProfileLayersConfig returns null when no profile loaded", () => {
            ProfileManager.init({ data: {} });
            expect(ProfileManager.getActiveProfileLayersConfig()).toBeNull();
        });
    });

    // ─────────────────────────────────────────────────────────────────
    // _fireProfileLoadedEvent — event dispatch branches
    // ─────────────────────────────────────────────────────────────────
    describe("_fireProfileLoadedEvent — event dispatch", () => {
        test("uses legacy createEvent/initCustomEvent when CustomEvent throws", async () => {
            const cfg = { data: { activeProfile: "p1" } };
            ProfileManager.init(cfg);
            fetchJsonMock.mockResolvedValue({ layers: [] });

            // Patch CustomEvent to throw to force legacy fallback
            const origCustomEvent = globalThis.CustomEvent;
            globalThis.CustomEvent = class {
                constructor() {
                    throw new Error("CustomEvent not supported");
                }
            };

            const legacyEvent = { initCustomEvent: vi.fn() };
            const createEventSpy = vi.spyOn(document, "createEvent").mockReturnValue(legacyEvent);
            const dispatchSpy = vi.spyOn(document, "dispatchEvent").mockImplementation(() => {});

            await ProfileManager.loadActiveProfileResources({});

            expect(createEventSpy).toHaveBeenCalledWith("CustomEvent");
            expect(legacyEvent.initCustomEvent).toHaveBeenCalledWith(
                "geoleaf:profile:loaded",
                false,
                false,
                expect.objectContaining({ profileId: "p1" })
            );
            expect(dispatchSpy).toHaveBeenCalled();

            globalThis.CustomEvent = origCustomEvent;
            createEventSpy.mockRestore();
            dispatchSpy.mockRestore();
        });

        test("warns when both CustomEvent and legacy dispatch fail", async () => {
            const cfg = { data: { activeProfile: "p1" } };
            ProfileManager.init(cfg);
            fetchJsonMock.mockResolvedValue({ layers: [] });

            const origCustomEvent = globalThis.CustomEvent;
            globalThis.CustomEvent = class {
                constructor() {
                    throw new Error("not supported");
                }
            };
            const createEventSpy = vi.spyOn(document, "createEvent").mockImplementation(() => {
                throw new Error("createEvent also fails");
            });

            await ProfileManager.loadActiveProfileResources({});
            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining("Unable to dispatch geoleaf:profile:loaded event")
            );

            globalThis.CustomEvent = origCustomEvent;
            createEventSpy.mockRestore();
        });
    });

    // ─────────────────────────────────────────────────────────────────
    // profiles-map normalization branches (non-legacy path)
    // ─────────────────────────────────────────────────────────────────
    describe("profiles-map normalization branches", () => {
        test("profiles map overwritten when it's an array", async () => {
            const cfg = { data: { activeProfile: "p1" }, profiles: [] }; // array → invalid
            ProfileManager.init(cfg);
            fetchJsonMock.mockResolvedValue({ layers: [] });
            await ProfileManager.loadActiveProfileResources({});
            expect(typeof cfg.profiles).toBe("object");
            expect(Array.isArray(cfg.profiles)).toBe(false);
        });
    });
});
