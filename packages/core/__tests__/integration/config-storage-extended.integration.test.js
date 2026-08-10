/**
 * Integration — Config.Storage extended
 * Sprint 2 reactivation: deferred/integration/config-storage-integration.test.js
 * Using ConfigStore directly (current API) instead of GeoLeaf._ConfigStorage (old IIFE).
 */

const mockLog = vi.hoisted(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}));

vi.mock("../../src/utils/log/index.js", () => ({ Log: mockLog }));

import { ConfigStore } from "../../src/kernel/config/storage.js";

describe("Integration — Config.Storage (extended)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        ConfigStore.init(null);
    });

    describe("init / getAll", () => {
        test("init with config and getAll returns it", () => {
            const config = { map: { zoom: 10 } };
            ConfigStore.init(config);
            expect(ConfigStore.getAll()).toBe(config);
        });

        test("should replace previous config on re-init", () => {
            ConfigStore.init({ value: "first" });
            ConfigStore.init({ value: "second" });
            expect(ConfigStore.getAll().value).toBe("second");
        });

        test("getAll returns empty object when not initialized", () => {
            ConfigStore.init(null);
            expect(ConfigStore.getAll()).toEqual({});
        });
    });

    describe("get with various paths", () => {
        beforeEach(() => {
            ConfigStore.init({
                map: { center: [48.85, 2.35], zoom: 12 },
                ui: { theme: "light", controls: { fullscreen: true, geolocation: true } },
                layers: [{ id: "lyr1" }, { id: "lyr2" }],
            });
        });

        test("get top-level key", () => {
            expect(ConfigStore.get("map")).toEqual({ center: [48.85, 2.35], zoom: 12 });
        });

        test("get nested path (3 levels deep)", () => {
            expect(ConfigStore.get("ui.controls.fullscreen")).toBe(true);
        });

        test("get array value", () => {
            const layers = ConfigStore.get("layers");
            expect(Array.isArray(layers)).toBe(true);
            expect(layers).toHaveLength(2);
        });

        test("get returns default for missing path", () => {
            expect(ConfigStore.get("missing.path", "defaultVal")).toBe("defaultVal");
        });

        test("get with falsy default returns undefined", () => {
            expect(ConfigStore.get("no.such.key")).toBeUndefined();
        });
    });

    describe("set scenarios", () => {
        beforeEach(() => {
            ConfigStore.init({ map: { zoom: 10 } });
        });

        test("set new nested key creates path", () => {
            ConfigStore.set("newSection.key", "newValue");
            expect(ConfigStore.get("newSection.key")).toBe("newValue");
        });

        test("set overrides existing value", () => {
            ConfigStore.set("map.zoom", 18);
            expect(ConfigStore.get("map.zoom")).toBe(18);
        });

        test("set null value removes key", () => {
            ConfigStore.set("map.zoom", null);
            expect(ConfigStore.get("map.zoom")).toBeNull();
        });

        test("set without prior init logs warning", () => {
            ConfigStore.init(null);
            ConfigStore.set("foo", "bar");
            expect(mockLog.warn).toHaveBeenCalled();
        });
    });

    describe("getSection", () => {
        beforeEach(() => {
            ConfigStore.init({
                poi: { enabled: true, clustering: true },
                map: { zoom: 12 },
            });
        });

        test("returns config section by key", () => {
            const poi = ConfigStore.getSection("poi");
            expect(poi).toEqual({ enabled: true, clustering: true });
        });

        test("returns undefined for unknown section", () => {
            const unknown = ConfigStore.getSection("nonexistent");
            expect(unknown).toBeUndefined();
        });
    });

    describe("integration scenario — config lifecycle", () => {
        test("init → get → set → get cycle", () => {
            ConfigStore.init({ map: { zoom: 10 }, ui: { theme: "light" } });
            expect(ConfigStore.get("map.zoom")).toBe(10);
            ConfigStore.set("map.zoom", 15);
            expect(ConfigStore.get("map.zoom")).toBe(15);
            expect(ConfigStore.get("ui.theme")).toBe("light");
        });

        test("reinit resets all values", () => {
            ConfigStore.init({ key: "old" });
            ConfigStore.init({ newKey: "new" });
            expect(ConfigStore.get("key")).toBeUndefined();
            expect(ConfigStore.get("newKey")).toBe("new");
        });
    });

    describe("edge cases", () => {
        test("get on null config returns default", () => {
            ConfigStore.init(null);
            expect(ConfigStore.get("any.path", "fallback")).toBe("fallback");
        });

        test("set boolean false is preserved", () => {
            ConfigStore.init({ flag: true });
            ConfigStore.set("flag", false);
            expect(ConfigStore.get("flag")).toBe(false);
        });

        test("set number 0 is preserved", () => {
            ConfigStore.init({ count: 5 });
            ConfigStore.set("count", 0);
            expect(ConfigStore.get("count")).toBe(0);
        });
    });
});
