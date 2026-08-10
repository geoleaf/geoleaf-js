/**
 * Tests pour config-accessors — Phase 1 step 1.4 (0% → 60%)
 */
const mockLog = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));
vi.mock("../../src/utils/log/index.js", () => ({ Log: mockLog }));

const storageGet = vi.hoisted(() => vi.fn());
const storageGetAll = vi.hoisted(() => vi.fn());
const storageSet = vi.hoisted(() => vi.fn());
const storageGetSection = vi.hoisted(() => vi.fn());
vi.mock("../../src/kernel/config/storage.js", () => ({
    ConfigStore: {
        get: storageGet,
        getAll: storageGetAll,
        set: storageSet,
        getSection: storageGetSection,
    },
}));

const profileGetActiveProfileId = vi.hoisted(() => vi.fn(() => null));
const profileGetActiveProfile = vi.hoisted(() => vi.fn(() => null));
const profileGetActiveProfileMapping = vi.hoisted(() => vi.fn(() => null));
const profileIsProfilePoiMappingEnabled = vi.hoisted(() => vi.fn(() => true));
vi.mock("../../src/kernel/config/profile.js", () => ({
    ProfileManager: {
        getActiveProfileId: profileGetActiveProfileId,
        getActiveProfile: profileGetActiveProfile,
        getActiveProfileMapping: profileGetActiveProfileMapping,
        isProfilePoiMappingEnabled: profileIsProfilePoiMappingEnabled,
    },
}));

const mockConfigInstance = vi.hoisted(() => ({
    _config: {},
    _isLoaded: false,
    _initSubModules: function () {
        this._isLoaded = true;
    },
}));
vi.mock("../../src/kernel/config/geoleaf-config/config-core.js", () => ({
    Config: mockConfigInstance,
}));
import { Config } from "../../src/kernel/config/geoleaf-config/config-accessors.js";
import * as storageMod from "../../src/kernel/config/storage.js";
import * as profileMod from "../../src/kernel/config/profile.js";
import { ConfigStore } from "../../src/kernel/config/storage.js";

describe("config/config-accessors", () => {
    beforeEach(() => {
        mockConfigInstance._isLoaded = false;
        storageGet.mockReset();
        storageGetAll.mockReset();
        storageSet.mockReset();
        storageGetSection.mockReset();
        profileGetActiveProfileId.mockReturnValue(null);
    });

    describe("getAll", () => {
        it("calls _initSubModules when not loaded", () => {
            const cfg = { map: { zoom: 10 } };
            storageGetAll.mockReturnValue(cfg);
            const out = Config.getAll();
            expect(mockConfigInstance._isLoaded).toBe(true);
            expect(out).toBe(cfg);
        });
        it("returns Storage.getAll() when Storage available", () => {
            mockConfigInstance._isLoaded = true;
            const cfg = { data: {} };
            storageGetAll.mockReturnValue(cfg);
            expect(Config.getAll()).toBe(cfg);
        });
    });

    describe("get", () => {
        it("returns Storage.get(path, defaultValue) when Storage available", () => {
            mockConfigInstance._isLoaded = true;
            storageGet.mockReturnValue(42);
            expect(Config.get("map.zoom")).toBe(42);
            expect(storageGet).toHaveBeenCalledWith("map.zoom", undefined);
        });
        it("passes defaultValue to Storage.get", () => {
            mockConfigInstance._isLoaded = true;
            storageGet.mockReturnValue("fallback");
            expect(Config.get("missing", "fallback")).toBe("fallback");
            expect(storageGet).toHaveBeenCalledWith("missing", "fallback");
        });
        it("calls _initSubModules when not loaded", () => {
            mockConfigInstance._isLoaded = false;
            storageGet.mockReturnValue("val");
            Config.get("key");
            expect(mockConfigInstance._isLoaded).toBe(true);
        });
    });

    describe("getModuleConfig", () => {
        it("reads modules.<id>.<key> first", () => {
            mockConfigInstance._isLoaded = true;
            storageGet.mockImplementation((path) => {
                if (path === "modules.print") return { format: "A3" };
                if (path === "modules.print.format") return "A3";
                return undefined;
            });
            expect(Config.getModuleConfig("print", "format")).toBe("A3");
            expect(storageGet).toHaveBeenCalledWith("modules.print.format");
        });

        it("does NOT fall back on the legacy root key (mirror removed in S14)", () => {
            mockConfigInstance._isLoaded = true;
            storageGet.mockImplementation((path) =>
                path === "printConfig.format" ? "A5" : undefined
            );
            expect(Config.getModuleConfig("print", "format", "A4")).toBe("A4");
        });

        it("returns defaultValue and inits submodules when not loaded", () => {
            mockConfigInstance._isLoaded = false;
            storageGet.mockReturnValue(undefined);
            expect(Config.getModuleConfig("measure", "units", "metric")).toBe("metric");
            expect(mockConfigInstance._isLoaded).toBe(true);
        });
    });

    describe("set", () => {
        it("calls Storage.set when Storage available", () => {
            Config.set("map.zoom", 12);
            expect(storageSet).toHaveBeenCalledWith("map.zoom", 12);
        });

        it("logs warn when Storage.set not available", () => {
            // Temporarily remove `set` from the mock
            storageSet.mockImplementation(() => {
                throw new Error("not available");
            });
            const origSet = ConfigStore.set;
            ConfigStore.set = undefined;
            mockLog.warn.mockClear();
            Config.set("key", "value");
            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining("Storage module unavailable")
            );
            ConfigStore.set = origSet;
        });
    });

    describe("getSection", () => {
        it("returns Storage.getSection when available", () => {
            const section = { zoom: 10 };
            storageGetSection.mockReturnValue(section);
            expect(Config.getSection("map")).toBe(section);
            expect(storageGetSection).toHaveBeenCalledWith("map", undefined);
        });
    });

    describe("Profile accessors", () => {
        it("getActiveProfileId returns Profile.getActiveProfileId()", () => {
            profileGetActiveProfileId.mockReturnValue("p1");
            expect(Config.getActiveProfileId()).toBe("p1");
        });
        it("getActiveProfile returns Profile.getActiveProfile()", () => {
            const p = { layers: [] };
            profileGetActiveProfile.mockReturnValue(p);
            expect(Config.getActiveProfile()).toBe(p);
        });
        it("getActiveProfileMapping returns the Profile mapping", () => {
            const mapping = {};
            profileGetActiveProfileMapping.mockReturnValue(mapping);
            expect(Config.getActiveProfileMapping()).toBe(mapping);
        });
        it("isProfilePoiMappingEnabled returns Profile value or true", () => {
            profileIsProfilePoiMappingEnabled.mockReturnValue(false);
            expect(Config.isProfilePoiMappingEnabled()).toBe(false);
        });
    });

    describe("null-module fallback branches", () => {
        beforeEach(() => {
            mockConfigInstance._isLoaded = true;
        });

        it("getAll returns this._config when Storage.getAll not available", () => {
            const orig = storageMod.ConfigStore.getAll;
            storageMod.ConfigStore.getAll = undefined;
            mockConfigInstance._config = { fallback: true };
            const result = Config.getAll();
            expect(result).toEqual({ fallback: true });
            storageMod.ConfigStore.getAll = orig;
        });

        it("get returns defaultValue when Storage.get not available", () => {
            const orig = storageMod.ConfigStore.get;
            storageMod.ConfigStore.get = undefined;
            expect(Config.get("missing.key", "fallback-val")).toBe("fallback-val");
            storageMod.ConfigStore.get = orig;
        });

        it("getSection returns defaultValue when Storage.getSection not available", () => {
            const orig = storageMod.ConfigStore.getSection;
            storageMod.ConfigStore.getSection = undefined;
            expect(Config.getSection("map", { zoom: 5 })).toEqual({ zoom: 5 });
            storageMod.ConfigStore.getSection = orig;
        });

        it("getActiveProfileId returns null when Profile.getActiveProfileId not available", () => {
            const orig = profileMod.ProfileManager.getActiveProfileId;
            profileMod.ProfileManager.getActiveProfileId = undefined;
            expect(Config.getActiveProfileId()).toBeNull();
            profileMod.ProfileManager.getActiveProfileId = orig;
        });

        it("getActiveProfile returns null when Profile.getActiveProfile not available", () => {
            const orig = profileMod.ProfileManager.getActiveProfile;
            profileMod.ProfileManager.getActiveProfile = undefined;
            expect(Config.getActiveProfile()).toBeNull();
            profileMod.ProfileManager.getActiveProfile = orig;
        });

        it("getActiveProfileMapping returns null when Profile.getActiveProfileMapping not available", () => {
            const orig = profileMod.ProfileManager.getActiveProfileMapping;
            profileMod.ProfileManager.getActiveProfileMapping = undefined;
            expect(Config.getActiveProfileMapping()).toBeNull();
            profileMod.ProfileManager.getActiveProfileMapping = orig;
        });

        it("isProfilePoiMappingEnabled returns true when Profile.isProfilePoiMappingEnabled not available", () => {
            const orig = profileMod.ProfileManager.isProfilePoiMappingEnabled;
            profileMod.ProfileManager.isProfilePoiMappingEnabled = undefined;
            expect(Config.isProfilePoiMappingEnabled()).toBe(true);
            profileMod.ProfileManager.isProfilePoiMappingEnabled = orig;
        });
    });
});
