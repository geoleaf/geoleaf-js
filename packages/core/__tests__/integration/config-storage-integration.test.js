/**
 * Integration tests pour Config.Storage module
 * Teste le module IIFE real avec son API complete
 */

// Mock the Log module so warn/error assertions work (storage.ts uses direct import)
vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("Config.Storage Module - Integration Tests", () => {
    let GeoLeaf;
    let mockLog;

    beforeEach(async () => {
        // Setup window.GeoLeaf for browser-based IIFE
        global.window = global;
        global.GeoLeaf = {
            Config: {},
        };

        // Clear module cache to allow re-requiring
        vi.resetModules();

        // Load the real storage module — captures named export (module doesn't self-register on global)
        const storageModule = await import("../../src/kernel/config/storage.js");
        global.GeoLeaf._ConfigStorage = storageModule.ConfigStore;
        GeoLeaf = global.GeoLeaf;

        // Get the fresh Log mock instance (re-created after resetModules)
        mockLog = (await import("../../src/utils/log/index.js")).Log;
        global.GeoLeaf.Log = mockLog;
    });

    afterEach(() => {
        delete global.GeoLeaf;
        delete global.window;
    });

    // ========================================
    //   INITIALIZATION
    // ========================================

    describe("init", () => {
        test("should initialize with config object", () => {
            const config = { map: { zoom: 10 } };

            GeoLeaf._ConfigStorage.init(config);

            const result = GeoLeaf._ConfigStorage.getAll();
            expect(result).toBe(config);
        });

        test("should handle init with empty object", () => {
            const config = {};

            GeoLeaf._ConfigStorage.init(config);

            const result = GeoLeaf._ConfigStorage.getAll();
            expect(result).toEqual({});
        });

        test("should replace previous config on re-init", () => {
            const config1 = { value: "first" };
            const config2 = { value: "second" };

            GeoLeaf._ConfigStorage.init(config1);
            GeoLeaf._ConfigStorage.init(config2);

            const result = GeoLeaf._ConfigStorage.getAll();
            expect(result.value).toBe("second");
        });
    });

    // ========================================
    //   GET / GETALL
    // ========================================

    describe("get", () => {
        beforeEach(() => {
            const config = {
                map: {
                    center: [48.8566, 2.3522],
                    zoom: 12,
                    options: {
                        zoomControl: true,
                        attributionControl: false,
                    },
                },
                basemaps: {
                    street: {
                        url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
                        attribution: "OSM",
                    },
                },
                ui: {
                    theme: "light",
                    language: "fr",
                },
                nullValue: null,
                zeroValue: 0,
                falseValue: false,
                emptyString: "",
            };
            GeoLeaf._ConfigStorage.init(config);
        });

        test("should get top-level property", () => {
            const result = GeoLeaf._ConfigStorage.get("map");

            expect(result).toEqual({
                center: [48.8566, 2.3522],
                zoom: 12,
                options: {
                    zoomControl: true,
                    attributionControl: false,
                },
            });
        });

        test("should get nested property with dot notation", () => {
            const result = GeoLeaf._ConfigStorage.get("map.center");

            expect(result).toEqual([48.8566, 2.3522]);
        });

        test("should get deeply nested property", () => {
            const result = GeoLeaf._ConfigStorage.get("map.options.zoomControl");

            expect(result).toBe(true);
        });

        test("should get string property", () => {
            const result = GeoLeaf._ConfigStorage.get("basemaps.street.url");

            expect(result).toBe("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
        });

        test("should return default value for non-existent path", () => {
            const result = GeoLeaf._ConfigStorage.get("nonexistent.path", "default");

            expect(result).toBe("default");
        });

        test("should return undefined for non-existent path without default", () => {
            const result = GeoLeaf._ConfigStorage.get("nonexistent.path");

            expect(result).toBeUndefined();
        });

        test("should return default for partial non-existent path", () => {
            const result = GeoLeaf._ConfigStorage.get("map.nonexistent.property", "fallback");

            expect(result).toBe("fallback");
        });

        test("should handle null values correctly", () => {
            const result = GeoLeaf._ConfigStorage.get("nullValue", "default");

            expect(result).toBeNull();
        });

        test("should handle zero values correctly", () => {
            const result = GeoLeaf._ConfigStorage.get("zeroValue", 999);

            expect(result).toBe(0);
        });

        test("should handle false values correctly", () => {
            const result = GeoLeaf._ConfigStorage.get("falseValue", true);

            expect(result).toBe(false);
        });

        test("should handle empty string values correctly", () => {
            const result = GeoLeaf._ConfigStorage.get("emptyString", "default");

            expect(result).toBe("");
        });

        test("should return default for invalid path type", () => {
            const result = GeoLeaf._ConfigStorage.get(null, "default");

            expect(result).toBe("default");
        });

        test("should return default for empty path", () => {
            const result = GeoLeaf._ConfigStorage.get("", "default");

            expect(result).toBe("default");
        });

        test("should return default for non-string path", () => {
            const result = GeoLeaf._ConfigStorage.get(123, "default");

            expect(result).toBe("default");
        });
    });

    describe("getAll", () => {
        test("should return full config object", () => {
            const config = {
                map: { zoom: 10 },
                basemaps: { street: { url: "test" } },
            };
            GeoLeaf._ConfigStorage.init(config);

            const result = GeoLeaf._ConfigStorage.getAll();

            expect(result).toEqual(config);
        });

        test("should return same reference as init config", () => {
            const config = { value: "test" };
            GeoLeaf._ConfigStorage.init(config);

            const result = GeoLeaf._ConfigStorage.getAll();

            expect(result).toBe(config);
        });

        test("should return empty object if not initialized", () => {
            // Don't call init
            const result = GeoLeaf._ConfigStorage.getAll();

            expect(result).toEqual({});
        });

        test("should return empty object after init with null", () => {
            GeoLeaf._ConfigStorage.init(null);

            const result = GeoLeaf._ConfigStorage.getAll();

            expect(result).toEqual({});
        });
    });

    // ========================================
    //   SET
    // ========================================

    describe("set", () => {
        beforeEach(() => {
            const config = {
                map: {
                    center: [48.8566, 2.3522],
                    zoom: 12,
                },
            };
            GeoLeaf._ConfigStorage.init(config);
        });

        test("should set top-level property", () => {
            GeoLeaf._ConfigStorage.set("newProp", "value");

            const result = GeoLeaf._ConfigStorage.get("newProp");
            expect(result).toBe("value");
        });

        test("should set nested property", () => {
            GeoLeaf._ConfigStorage.set("map.zoom", 15);

            const result = GeoLeaf._ConfigStorage.get("map.zoom");
            expect(result).toBe(15);
        });

        test("should create intermediate objects if needed", () => {
            GeoLeaf._ConfigStorage.set("new.nested.property", "created");

            const result = GeoLeaf._ConfigStorage.get("new.nested.property");
            expect(result).toBe("created");
        });

        test("should create deeply nested path", () => {
            GeoLeaf._ConfigStorage.set("a.b.c.d.e", "deep");

            const result = GeoLeaf._ConfigStorage.get("a.b.c.d.e");
            expect(result).toBe("deep");
        });

        test("should overwrite existing property", () => {
            GeoLeaf._ConfigStorage.set("map.center", [50, 3]);

            const result = GeoLeaf._ConfigStorage.get("map.center");
            expect(result).toEqual([50, 3]);
        });

        test("should set null value", () => {
            GeoLeaf._ConfigStorage.set("map.zoom", null);

            const result = GeoLeaf._ConfigStorage.get("map.zoom", "default");
            expect(result).toBeNull();
        });

        test("should set undefined value", () => {
            GeoLeaf._ConfigStorage.set("map.zoom", undefined);

            // When value is set to undefined, get() without default returns undefined
            const result = GeoLeaf._ConfigStorage.get("map.zoom");
            expect(result).toBeUndefined();
        });

        test("should set object value", () => {
            const obj = { key: "value", nested: { data: 123 } };
            GeoLeaf._ConfigStorage.set("complex", obj);

            const result = GeoLeaf._ConfigStorage.get("complex");
            expect(result).toEqual(obj);
        });

        test("should set array value", () => {
            const arr = [1, 2, 3, 4, 5];
            GeoLeaf._ConfigStorage.set("map.layers", arr);

            const result = GeoLeaf._ConfigStorage.get("map.layers");
            expect(result).toEqual(arr);
        });

        test("should warn and do nothing if not initialized", async () => {
            // Use a fresh ConfigStore that has no _config set
            vi.resetModules();
            const { ConfigStore: freshStorage } = await import(
                "../../src/kernel/config/storage.js"
            );
            const freshLog = (await import("../../src/utils/log/index.js")).Log;
            freshStorage.set("test", "value");

            expect(freshLog.warn).toHaveBeenCalledWith(expect.stringContaining("non initialisée"));
        });

        test("should warn for null path", () => {
            GeoLeaf._ConfigStorage.set(null, "value");

            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining("requiert un chemin string")
            );
        });

        test("should warn for empty path", () => {
            GeoLeaf._ConfigStorage.set("", "value");

            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining("requiert un chemin string")
            );
        });

        test("should warn for non-string path", () => {
            GeoLeaf._ConfigStorage.set(123, "value");

            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining("requiert un chemin string")
            );
        });
    });

    // ========================================
    //   MERGE
    // ========================================

    describe("merge", () => {
        beforeEach(() => {
            const config = {
                map: {
                    center: [48.8566, 2.3522],
                    zoom: 12,
                    options: {
                        zoomControl: true,
                    },
                },
                ui: {
                    theme: "light",
                },
            };
            GeoLeaf._ConfigStorage.init(config);
        });

        test("should merge new properties", () => {
            const newConfig = {
                basemaps: {
                    street: { url: "test" },
                },
            };

            GeoLeaf._ConfigStorage.merge(newConfig);

            expect(GeoLeaf._ConfigStorage.get("basemaps.street.url")).toBe("test");
            expect(GeoLeaf._ConfigStorage.get("map.zoom")).toBe(12);
        });

        test("should overwrite existing properties", () => {
            const newConfig = {
                map: {
                    zoom: 15,
                },
            };

            GeoLeaf._ConfigStorage.merge(newConfig);

            expect(GeoLeaf._ConfigStorage.get("map.zoom")).toBe(15);
        });

        test("should deep merge nested objects", () => {
            const newConfig = {
                map: {
                    options: {
                        attributionControl: false,
                    },
                },
            };

            GeoLeaf._ConfigStorage.merge(newConfig);

            expect(GeoLeaf._ConfigStorage.get("map.options.zoomControl")).toBe(true);
            expect(GeoLeaf._ConfigStorage.get("map.options.attributionControl")).toBe(false);
        });

        test("should preserve existing nested properties", () => {
            const newConfig = {
                ui: {
                    language: "en",
                },
            };

            GeoLeaf._ConfigStorage.merge(newConfig);

            expect(GeoLeaf._ConfigStorage.get("ui.theme")).toBe("light");
            expect(GeoLeaf._ConfigStorage.get("ui.language")).toBe("en");
        });

        test("should handle multiple merges", () => {
            GeoLeaf._ConfigStorage.merge({ a: 1 });
            GeoLeaf._ConfigStorage.merge({ b: 2 });
            GeoLeaf._ConfigStorage.merge({ c: 3 });

            expect(GeoLeaf._ConfigStorage.get("a")).toBe(1);
            expect(GeoLeaf._ConfigStorage.get("b")).toBe(2);
            expect(GeoLeaf._ConfigStorage.get("c")).toBe(3);
        });

        test("should handle merge with empty object", () => {
            const before = GeoLeaf._ConfigStorage.getAll();

            GeoLeaf._ConfigStorage.merge({});

            const after = GeoLeaf._ConfigStorage.getAll();
            expect(after).toEqual(before);
        });

        test("should warn and do nothing if not initialized", async () => {
            // Use a fresh ConfigStore that has no _config set
            vi.resetModules();
            const { ConfigStore: freshStorage } = await import(
                "../../src/kernel/config/storage.js"
            );
            const freshLog = (await import("../../src/utils/log/index.js")).Log;
            freshStorage.merge({ test: "value" });

            expect(freshLog.warn).toHaveBeenCalledWith(expect.stringContaining("non initialisée"));
        });

        test("should warn for null config", () => {
            GeoLeaf._ConfigStorage.merge(null);

            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining("merge() requiert un objet valide")
            );
        });

        test("should warn for non-object config", () => {
            GeoLeaf._ConfigStorage.merge("not an object");

            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining("merge() requiert un objet valide")
            );
        });

        test("should warn for array config", () => {
            GeoLeaf._ConfigStorage.merge([1, 2, 3]);

            expect(mockLog.warn).toHaveBeenCalledWith(
                expect.stringContaining("merge() requiert un objet valide")
            );
        });
    });

    // ========================================
    //   INTEGRATION SCENARIOS
    // ========================================

    describe("Integration Scenarios", () => {
        test("should handle complete config workflow", () => {
            // 1. Initialize with base config
            const baseConfig = {
                map: { zoom: 10, center: [48, 2] },
            };
            GeoLeaf._ConfigStorage.init(baseConfig);

            // 2. Merge additional config
            GeoLeaf._ConfigStorage.merge({
                basemaps: { street: { url: "test" } },
            });

            // 3. Set specific values
            GeoLeaf._ConfigStorage.set("ui.theme", "dark");

            // 4. Verify all values
            expect(GeoLeaf._ConfigStorage.get("map.zoom")).toBe(10);
            expect(GeoLeaf._ConfigStorage.get("basemaps.street.url")).toBe("test");
            expect(GeoLeaf._ConfigStorage.get("ui.theme")).toBe("dark");
        });

        test("should handle dynamic config updates", () => {
            GeoLeaf._ConfigStorage.init({ counter: 0 });

            // Simulate multiple updates
            for (let i = 1; i <= 5; i++) {
                GeoLeaf._ConfigStorage.set("counter", i);
            }

            expect(GeoLeaf._ConfigStorage.get("counter")).toBe(5);
        });

        test("should maintain referential integrity", () => {
            const config = { shared: { data: "test" } };
            GeoLeaf._ConfigStorage.init(config);

            // Modify via set
            GeoLeaf._ConfigStorage.set("shared.data", "modified");

            // Verify original object was modified
            expect(config.shared.data).toBe("modified");
        });
    });

    // ========================================
    //   EDGE CASES
    // ========================================

    describe("Edge Cases", () => {
        test("should handle path with trailing dots", () => {
            const config = { test: "value" };
            GeoLeaf._ConfigStorage.init(config);

            const result = GeoLeaf._ConfigStorage.get("test.");

            // Should return undefined since "test." has empty segment
            expect(result).toBeUndefined();
        });

        test("should handle path with leading dots", () => {
            const config = { test: "value" };
            GeoLeaf._ConfigStorage.init(config);

            const result = GeoLeaf._ConfigStorage.get(".test");

            // Should return undefined since ".test" starts with empty segment
            expect(result).toBeUndefined();
        });

        test("should handle multiple consecutive dots", () => {
            const config = { test: "value" };
            GeoLeaf._ConfigStorage.init(config);

            const result = GeoLeaf._ConfigStorage.get("test..nested");

            expect(result).toBeUndefined();
        });

        test("should handle very deep nesting (100 levels)", () => {
            GeoLeaf._ConfigStorage.init({});

            // Create 100-level deep path
            const path = Array(100).fill("level").join(".");
            GeoLeaf._ConfigStorage.set(path, "deep");

            const result = GeoLeaf._ConfigStorage.get(path);
            expect(result).toBe("deep");
        });

        test("should handle special characters in keys", () => {
            GeoLeaf._ConfigStorage.init({});

            // Keys with special chars (not in path, but as keys)
            GeoLeaf._ConfigStorage.set("key-with-dashes", "value1");
            GeoLeaf._ConfigStorage.set("key_with_underscores", "value2");

            expect(GeoLeaf._ConfigStorage.get("key-with-dashes")).toBe("value1");
            expect(GeoLeaf._ConfigStorage.get("key_with_underscores")).toBe("value2");
        });

        test("should handle large config objects", () => {
            const largeConfig = {};
            for (let i = 0; i < 1000; i++) {
                largeConfig[`key${i}`] = `value${i}`;
            }

            GeoLeaf._ConfigStorage.init(largeConfig);

            expect(GeoLeaf._ConfigStorage.get("key500")).toBe("value500");
            expect(GeoLeaf._ConfigStorage.get("key999")).toBe("value999");
        });
    });

    // ========================================
    //   PERFORMANCE
    // ========================================

    describe("Performance", () => {
        test("should get from deep path efficiently", () => {
            const config = {
                a: { b: { c: { d: { e: { f: { g: { h: "value" } } } } } } },
            };
            GeoLeaf._ConfigStorage.init(config);

            const start = performance.now();

            for (let i = 0; i < 1000; i++) {
                GeoLeaf._ConfigStorage.get("a.b.c.d.e.f.g.h");
            }

            const duration = performance.now() - start;
            expect(duration).toBeLessThan(50); // Should complete in <50ms
        });

        test("should set nested properties efficiently", () => {
            GeoLeaf._ConfigStorage.init({});

            const start = performance.now();

            for (let i = 0; i < 100; i++) {
                GeoLeaf._ConfigStorage.set(`path${i}.nested.value`, i);
            }

            const duration = performance.now() - start;
            expect(duration).toBeLessThan(100); // Should complete in <100ms
        });

        test("should merge large configs efficiently", () => {
            GeoLeaf._ConfigStorage.init({});

            const largeConfig = {};
            for (let i = 0; i < 100; i++) {
                largeConfig[`key${i}`] = { nested: { value: i } };
            }

            const start = performance.now();
            GeoLeaf._ConfigStorage.merge(largeConfig);
            const duration = performance.now() - start;

            expect(duration).toBeLessThan(50); // Should complete in <50ms
        });
    });
});
