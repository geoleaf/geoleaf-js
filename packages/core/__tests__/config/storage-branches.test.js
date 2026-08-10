/**
 * Tests for config/storage.ts (ConfigStore singleton)
 * Sprint S5B.1 — consolidated ESM file (merged from storage.test.js + storage.esm.test.js)
 * Uses vi.hoisted() + static imports for Istanbul coverage instrumentation.
 */

const { mockLog } = vi.hoisted(() => {
    const mockLog = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };
    return { mockLog };
});

vi.mock("../../src/utils/log/index.js", () => ({ Log: mockLog }));

import { ConfigStore } from "../../src/kernel/config/storage.ts";

describe("config/storage — ConfigStore", () => {
    let mockConfig;

    beforeEach(() => {
        vi.clearAllMocks();
        mockConfig = {
            map: {
                center: [48.8566, 2.3522],
                zoom: 12,
                options: {
                    dragging: true,
                    scrollWheelZoom: false,
                },
            },
            basemaps: {
                street: {
                    url: "https://example.com/tiles/{z}/{x}/{y}.png",
                    attribution: "Map data",
                },
                satellite: {
                    url: "https://server.arcgisonline.com/tile/{z}/{x}/{y}",
                    attribution: "Esri",
                },
            },
            ui: { theme: "dark" },
            version: "2.0.0",
            layers: [],
        };
        ConfigStore.init(mockConfig);
    });

    afterEach(() => {
        ConfigStore._config = null;
    });

    // ────────────────────────────────────────────────────────────────────────────
    // init()
    // ────────────────────────────────────────────────────────────────────────────

    describe("init()", () => {
        it("initializes with config reference (same reference)", () => {
            const cfg = { test: true };
            ConfigStore.init(cfg);
            expect(ConfigStore.getAll()).toBe(cfg);
        });

        it("accepts null config and getAll() returns {}", () => {
            ConfigStore.init(null);
            expect(ConfigStore.getAll()).toEqual({});
        });

        it("accepts empty config object", () => {
            ConfigStore.init({});
            expect(ConfigStore.getAll()).toEqual({});
        });
    });

    // ────────────────────────────────────────────────────────────────────────────
    // getAll()
    // ────────────────────────────────────────────────────────────────────────────

    describe("getAll()", () => {
        it("returns the entire config object (same reference)", () => {
            expect(ConfigStore.getAll()).toBe(mockConfig);
        });

        it("returns empty object when _config is null", () => {
            ConfigStore._config = null;
            expect(ConfigStore.getAll()).toEqual({});
        });
    });

    // ────────────────────────────────────────────────────────────────────────────
    // get()
    // ────────────────────────────────────────────────────────────────────────────

    describe("get()", () => {
        it("gets a top-level value", () => {
            expect(ConfigStore.get("version")).toBe("2.0.0");
        });

        it("gets nested value via dot notation", () => {
            expect(ConfigStore.get("map.center")).toEqual([48.8566, 2.3522]);
        });

        it("gets deeply nested value", () => {
            expect(ConfigStore.get("map.options.dragging")).toBe(true);
        });

        it("returns undefined for non-existent path", () => {
            expect(ConfigStore.get("map.nonexistent")).toBeUndefined();
        });

        it("returns default value for non-existent path", () => {
            expect(ConfigStore.get("nonexistent", "default")).toBe("default");
        });

        it("returns default for empty path", () => {
            expect(ConfigStore.get("", "fallback")).toBe("fallback");
        });

        it("returns default for null path", () => {
            expect(ConfigStore.get(null, "fallback")).toBe("fallback");
        });

        it("returns default when _config is null", () => {
            ConfigStore._config = null;
            expect(ConfigStore.get("map", { fallback: true })).toEqual({ fallback: true });
        });

        it("returns undefined for non-string path (number)", () => {
            expect(ConfigStore.get(123)).toBeUndefined();
        });

        it("returns undefined for non-string path (object)", () => {
            expect(ConfigStore.get({})).toBeUndefined();
        });

        it("returns undefined when traversing through non-object intermediate", () => {
            expect(ConfigStore.get("version.nonexistent")).toBeUndefined();
        });
    });

    // ────────────────────────────────────────────────────────────────────────────
    // set()
    // ────────────────────────────────────────────────────────────────────────────

    describe("set()", () => {
        it("sets a top-level value", () => {
            ConfigStore.set("newKey", "newValue");
            expect(mockConfig.newKey).toBe("newValue");
        });

        it("sets nested value via dot notation", () => {
            ConfigStore.set("map.zoom", 15);
            expect(mockConfig.map.zoom).toBe(15);
        });

        it("sets deeply nested value", () => {
            ConfigStore.set("map.options.scrollWheelZoom", true);
            expect(mockConfig.map.options.scrollWheelZoom).toBe(true);
        });

        it("creates intermediate objects for new deep path", () => {
            ConfigStore.set("new.path.deep.value", 42);
            expect(mockConfig.new.path.deep.value).toBe(42);
        });

        it("overwrites an existing value", () => {
            ConfigStore.set("ui.theme", "light");
            expect(mockConfig.ui.theme).toBe("light");
        });

        it("replaces scalar intermediate with object", () => {
            ConfigStore.set("version.nested.value", "test");
            expect(mockConfig.version.nested.value).toBe("test");
        });

        it("logs warn and no-throws when _config is null", () => {
            ConfigStore._config = null;
            expect(() => ConfigStore.set("key", "value")).not.toThrow();
            expect(mockLog.warn).toHaveBeenCalled();
        });

        it("logs warn and no-throws for empty path", () => {
            ConfigStore.set("", "value");
            expect(mockLog.warn).toHaveBeenCalled();
        });

        it("logs warn and no-throws for non-string path", () => {
            ConfigStore.set(123, "value");
            expect(mockLog.warn).toHaveBeenCalled();
        });
    });

    // ────────────────────────────────────────────────────────────────────────────
    // getSection()
    // ────────────────────────────────────────────────────────────────────────────

    describe("getSection()", () => {
        it("returns section by name", () => {
            const section = ConfigStore.getSection("map");
            expect(section.center).toEqual([48.8566, 2.3522]);
            expect(section.zoom).toBe(12);
        });

        it("returns default for non-existent section", () => {
            expect(ConfigStore.getSection("missing", {})).toEqual({});
        });

        it("returns undefined for undefined section", () => {
            expect(ConfigStore.getSection("nonexistent")).toBeUndefined();
        });

        it("returns default for empty section name", () => {
            expect(ConfigStore.getSection("", "fallback")).toBe("fallback");
        });

        it("returns default for null section name", () => {
            expect(ConfigStore.getSection(null, "fallback")).toBe("fallback");
        });

        it("works with dot-path nested section names", () => {
            expect(ConfigStore.getSection("map.options").dragging).toBe(true);
        });
    });

    // ────────────────────────────────────────────────────────────────────────────
    // merge()
    // ────────────────────────────────────────────────────────────────────────────

    describe("merge()", () => {
        it("merges new keys into existing config", () => {
            ConfigStore.merge({ newSection: { key: "value" } });
            expect(ConfigStore.get("newSection.key")).toBe("value");
        });

        it("deep-merges nested keys (existing keys preserved)", () => {
            ConfigStore.merge({ ui: { size: "large" } });
            expect(ConfigStore.get("ui.theme")).toBe("dark");
            expect(ConfigStore.get("ui.size")).toBe("large");
        });

        it("logs warn and no-throws when _config is null", () => {
            ConfigStore._config = null;
            expect(() => ConfigStore.merge({ a: 1 })).not.toThrow();
            expect(mockLog.warn).toHaveBeenCalled();
        });

        it("logs warn for null config arg", () => {
            ConfigStore.merge(null);
            expect(mockLog.warn).toHaveBeenCalled();
        });

        it("logs warn for array config arg", () => {
            ConfigStore.merge([1, 2, 3]);
            expect(mockLog.warn).toHaveBeenCalled();
        });

        it("logs warn for non-object config arg (string)", () => {
            ConfigStore.merge("invalid");
            expect(mockLog.warn).toHaveBeenCalled();
        });
    });

    // ────────────────────────────────────────────────────────────────────────────
    // deepMerge()
    // ────────────────────────────────────────────────────────────────────────────

    describe("deepMerge()", () => {
        it("merges two simple objects", () => {
            const result = ConfigStore.deepMerge({ a: 1, b: 2 }, { b: 3, c: 4 });
            expect(result).toEqual({ a: 1, b: 3, c: 4 });
        });

        it("deep-merges nested objects", () => {
            const target = { config: { ui: { theme: "dark" }, map: { zoom: 10 } } };
            const source = { config: { ui: { size: "large" } } };
            const result = ConfigStore.deepMerge(target, source);
            expect(result.config.ui).toEqual({ theme: "dark", size: "large" });
            expect(result.config.map).toEqual({ zoom: 10 });
        });

        it("does not mutate original target or source", () => {
            const target = { a: 1 };
            const source = { b: 2 };
            ConfigStore.deepMerge(target, source);
            expect(target).toEqual({ a: 1 });
            expect(source).toEqual({ b: 2 });
        });

        it("handles null target", () => {
            expect(ConfigStore.deepMerge(null, { a: 1 })).toEqual({ a: 1 });
        });

        it("handles undefined target", () => {
            expect(ConfigStore.deepMerge(undefined, { a: 1 })).toEqual({ a: 1 });
        });

        it("handles null source", () => {
            expect(ConfigStore.deepMerge({ a: 1 }, null)).toEqual({ a: 1 });
        });

        it("handles undefined source", () => {
            expect(ConfigStore.deepMerge({ a: 1 }, undefined)).toEqual({ a: 1 });
        });

        it("replaces arrays (not merged)", () => {
            const result = ConfigStore.deepMerge({ items: [1, 2, 3] }, { items: [4, 5] });
            expect(result.items).toEqual([4, 5]);
        });

        it("overwrites object with primitive", () => {
            const result = ConfigStore.deepMerge({ a: { nested: true } }, { a: "string" });
            expect(result.a).toBe("string");
        });

        it("overwrites primitive with object", () => {
            const result = ConfigStore.deepMerge({ a: "string" }, { a: { nested: true } });
            expect(result.a).toEqual({ nested: true });
        });

        it("deep-merges 3 levels", () => {
            const target = { l1: { l2: { l3: { a: 1, b: 2 } } } };
            const source = { l1: { l2: { l3: { b: 3, c: 4 } } } };
            const result = ConfigStore.deepMerge(target, source);
            expect(result.l1.l2.l3).toEqual({ a: 1, b: 3, c: 4 });
        });
    });

    // ────────────────────────────────────────────────────────────────────────────
    // getValueByPath()
    // ────────────────────────────────────────────────────────────────────────────

    describe("getValueByPath()", () => {
        it("gets value by simple path", () => {
            expect(ConfigStore.getValueByPath({ a: 1 }, "a")).toBe(1);
        });

        it("gets value by nested path", () => {
            expect(ConfigStore.getValueByPath({ a: { b: { c: "val" } } }, "a.b.c")).toBe("val");
        });

        it("returns undefined for non-existent path", () => {
            expect(ConfigStore.getValueByPath({ a: 1 }, "a.b.c")).toBeUndefined();
        });

        it("returns undefined for null source", () => {
            expect(ConfigStore.getValueByPath(null, "a.b")).toBeUndefined();
        });

        it("returns undefined for undefined source", () => {
            expect(ConfigStore.getValueByPath(undefined, "a")).toBeUndefined();
        });

        it("returns undefined for null path", () => {
            expect(ConfigStore.getValueByPath({ a: 1 }, null)).toBeUndefined();
        });

        it("returns undefined for empty path", () => {
            expect(ConfigStore.getValueByPath({ a: 1 }, "")).toBeUndefined();
        });

        it("handles array index access via numeric string key", () => {
            const src = { items: ["first", "second"] };
            expect(ConfigStore.getValueByPath(src, "items.0")).toBe("first");
        });

        it("returns undefined when traversing through null intermediate", () => {
            expect(ConfigStore.getValueByPath({ a: null }, "a.b")).toBeUndefined();
        });
    });

    // ────────────────────────────────────────────────────────────────────────────
    // setValueByPath()
    // ────────────────────────────────────────────────────────────────────────────

    describe("setValueByPath()", () => {
        it("sets value by nested path", () => {
            const t = { a: {} };
            ConfigStore.setValueByPath(t, "a.b.c", "val");
            expect(t.a.b.c).toBe("val");
        });

        it("creates intermediate objects for new path", () => {
            const t = {};
            ConfigStore.setValueByPath(t, "deep.nested.path", 42);
            expect(t.deep.nested.path).toBe(42);
        });

        it("handles null target gracefully", () => {
            expect(() => ConfigStore.setValueByPath(null, "a.b", "val")).not.toThrow();
        });

        it("handles empty path gracefully", () => {
            const t = {};
            expect(() => ConfigStore.setValueByPath(t, "", "val")).not.toThrow();
        });

        it("overwrites existing value", () => {
            const t = { a: { b: "old" } };
            ConfigStore.setValueByPath(t, "a.b", "new");
            expect(t.a.b).toBe("new");
        });
    });

    // ────────────────────────────────────────────────────────────────────────────
    // Integration
    // ────────────────────────────────────────────────────────────────────────────

    describe("Integration", () => {
        it("full workflow: init → merge → get", () => {
            ConfigStore.init({ a: 1, b: { x: 10 } });
            ConfigStore.merge({ b: { y: 20 }, c: 3 });
            expect(ConfigStore.get("a")).toBe(1);
            expect(ConfigStore.get("b.x")).toBe(10);
            expect(ConfigStore.get("b.y")).toBe(20);
            expect(ConfigStore.get("c")).toBe(3);
        });

        it("set modifies the same config reference returned by getAll()", () => {
            const cfg = ConfigStore.getAll();
            ConfigStore.set("ui.theme", "light");
            expect(cfg.ui.theme).toBe("light");
        });
    });
});
