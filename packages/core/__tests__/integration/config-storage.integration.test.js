/**
 * Lightweight integration tests — Config.Storage (storage module)
 * Couvre init, get, set, getAll, getSection, deepMerge
 */

const mockLog = vi.hoisted(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}));

vi.mock("../../src/utils/log/index.js", () => ({
    Log: mockLog,
}));

import { ConfigStore } from "../../src/kernel/config/storage.js";

describe("Integration — Config.Storage", () => {
    beforeEach(() => {
        mockLog.warn.mockClear();
        mockLog.error.mockClear();
        ConfigStore.init(null);
    });

    describe("init / getAll", () => {
        test("init with config and getAll returns it", () => {
            const config = { map: { zoom: 10 } };
            ConfigStore.init(config);
            expect(ConfigStore.getAll()).toBe(config);
        });

        test("getAll returns empty object when not initialized", () => {
            ConfigStore.init(null);
            expect(ConfigStore.getAll()).toEqual({});
        });
    });

    describe("get", () => {
        beforeEach(() => {
            ConfigStore.init({
                map: { center: [48.85, 2.35], zoom: 12 },
                ui: { theme: "light" },
            });
        });

        test("get top-level key", () => {
            expect(ConfigStore.get("map")).toEqual({ center: [48.85, 2.35], zoom: 12 });
        });

        test("get nested path with dot notation", () => {
            expect(ConfigStore.get("map.center")).toEqual([48.85, 2.35]);
            expect(ConfigStore.get("map.zoom")).toBe(12);
        });

        test("get returns default for missing path", () => {
            expect(ConfigStore.get("missing", "default")).toBe("default");
            expect(ConfigStore.get("missing")).toBeUndefined();
        });
    });

    describe("set", () => {
        beforeEach(() => {
            ConfigStore.init({ map: { zoom: 10 } });
        });

        test("set top-level and nested", () => {
            ConfigStore.set("ui.theme", "dark");
            expect(ConfigStore.get("ui.theme")).toBe("dark");
            ConfigStore.set("map.zoom", 15);
            expect(ConfigStore.get("map.zoom")).toBe(15);
        });

        test("set without init calls Log.warn", () => {
            ConfigStore.init(null);
            ConfigStore.set("key", "value");
            expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("Configuration no"));
        });

        test("set and get nested object value", () => {
            ConfigStore.init({});
            ConfigStore.set("layers.poi.style", { color: "#f00", weight: 2 });
            expect(ConfigStore.get("layers.poi.style")).toEqual({ color: "#f00", weight: 2 });
            expect(ConfigStore.get("layers.poi.style.color")).toBe("#f00");
        });

        test("set with invalid path calls Log.warn", () => {
            ConfigStore.set("", "v");
            expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("requiert"));
        });
    });

    describe("getSection", () => {
        beforeEach(() => {
            ConfigStore.init({ map: { zoom: 10 }, ui: {} });
        });

        test("getSection returns section or default", () => {
            expect(ConfigStore.getSection("map")).toEqual({ zoom: 10 });
            expect(ConfigStore.getSection("ui")).toEqual({});
            expect(ConfigStore.getSection("missing", {})).toEqual({});
        });
    });

    describe("deepMerge", () => {
        test("deepMerge merges objects", () => {
            const a = { x: 1, y: { a: 1 } };
            const b = { y: { b: 2 }, z: 3 };
            const out = ConfigStore.deepMerge(a, b);
            expect(out).toEqual({ x: 1, y: { a: 1, b: 2 }, z: 3 });
        });

        test("deepMerge with null returns copy of source", () => {
            const a = { x: 1 };
            expect(ConfigStore.deepMerge(a, null)).toEqual({ x: 1 });
            expect(ConfigStore.deepMerge(null, a)).toEqual({ x: 1 });
        });
    });

    describe("workflow config + storage", () => {
        test("init then set then get", () => {
            ConfigStore.init({ map: { zoom: 10 } });
            ConfigStore.set("map.center", [50, 3]);
            ConfigStore.set("ui.theme", "dark");
            expect(ConfigStore.get("map.center")).toEqual([50, 3]);
            expect(ConfigStore.get("ui.theme")).toBe("dark");
            expect(ConfigStore.getAll().map.zoom).toBe(10);
        });
    });
});
