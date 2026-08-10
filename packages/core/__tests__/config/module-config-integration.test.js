/**
 * Integration tests for the Plugin Contract v1 modules.* read path — real
 * Config + real ConfigStore (no storage mocks), locking the modular flows
 * plugins rely on: repeated config applies, Config.set, and the modular
 * profile loading path (per-entry modules bag merge).
 * (S0 legacy-key mirror removed in S14 — modules.<id> is the only form.)
 */

const { mockLog } = vi.hoisted(() => {
    const mockLog = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        setLevel: vi.fn(),
    };
    return { mockLog };
});

vi.mock("../../src/utils/log/index.js", () => ({ Log: mockLog }));

vi.mock("../../src/kernel/config/profile-loader.js", () => ({
    ProfileLoader: {
        isModularProfile: vi.fn(() => true),
        loadModularProfile: vi.fn(),
    },
}));

import { Config } from "../../src/kernel/config/geoleaf-config/config-accessors.ts";
import { ConfigStore } from "../../src/kernel/config/storage.ts";
import { ProfileManager } from "../../src/kernel/config/profile.ts";
import { ProfileLoader as MockedModularLoader } from "../../src/kernel/config/profile-loader.js";

describe("config/module-config — integration (real Config + ConfigStore)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Config._config = {};
        Config._isLoaded = false;
        Config._subModulesInitialized = false;
        Config._source = null;
        ConfigStore._config = null;
        ProfileManager._config = null;
        ProfileManager._activeProfileId = null;
        ProfileManager._activeProfile = null;
    });

    it("Config.init exposes modules.<id> end-to-end", async () => {
        await Config.init({
            config: { modules: { storage: { cache: { x: 1 } } } },
            autoEvent: false,
        });
        expect(Config.get("modules.storage.cache.x")).toBe(1);
        expect(Config.getModuleConfig("storage", "cache.x")).toBe(1);
    });

    it("a second apply (inline then url) keeps modules.<id> reads fresh", async () => {
        await Config.init({
            config: { modules: { storage: { cache: { x: 1 } } } },
            autoEvent: false,
        });
        Config._applyConfig({ modules: { storage: { cache: { x: 2 } } } }, "url");
        expect(Config.get("modules.storage.cache.x")).toBe(2);
        expect(Config.getModuleConfig("storage", "cache.x")).toBe(2);
    });

    it("Config.set replacing a whole module block is read back", async () => {
        await Config.init({
            config: { modules: { storage: { cache: { x: 1 } } } },
            autoEvent: false,
        });
        Config.set("modules.storage", { cache: { y: 5 } });
        expect(Config.get("modules.storage.cache.y")).toBe(5);
        expect(Config.getModuleConfig("storage", "cache.y")).toBe(5);
    });

    it("Config.set below the block level is read back", async () => {
        await Config.init({
            config: { modules: { storage: { cache: { x: 1 } } } },
            autoEvent: false,
        });
        Config.set("modules.storage.cache.x", 9);
        expect(Config.get("modules.storage.cache.x")).toBe(9);
        expect(Config.getModuleConfig("storage", "cache.x")).toBe(9);
    });

    it("modular profile load merges its modules bag per entry (no wholesale clobber)", async () => {
        await Config.init({
            config: { data: { activeProfile: "p1" }, modules: { print: { format: "A3" } } },
            autoEvent: false,
        });
        MockedModularLoader.loadModularProfile.mockResolvedValue({
            id: "p1",
            modules: { storage: { cache: { a: 1 } } },
            layers: [],
        });

        await ProfileManager._loadModularProfile({}, "profiles/p1", 123, {});

        // Boot-config entry for another plugin is preserved (no wholesale clobber)
        expect(Config.get("modules.print.format")).toBe("A3");
        // Profile-declared module block propagated into _config
        expect(Config.get("modules.storage.cache.a")).toBe(1);
    });

    it("modular profile declaring a modules bag propagates it into _config", async () => {
        await Config.init({ config: { data: { activeProfile: "p1" } }, autoEvent: false });
        MockedModularLoader.loadModularProfile.mockResolvedValue({
            id: "p1",
            modules: { editor: { snap: true } },
            layers: [],
        });

        await ProfileManager._loadModularProfile({}, "profiles/p1", 123, {});

        expect(Config.get("modules.editor.snap")).toBe(true);
        expect(Config.getModuleConfig("editor", "snap")).toBe(true);
    });
});
