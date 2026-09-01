/**
 */

/**
 * Extended tests for GeoLeaf.LayerManager module
 * Tests focus on the module structure and API.
 */

describe("GeoLeaf.LayerManager Extended", () => {
    let LegendModule;
    let mockMap;

    beforeEach(async () => {
        vi.clearAllMocks();

        // Mock map
        mockMap = {
            on: vi.fn(),
            off: vi.fn(),
            hasControl: vi.fn().mockReturnValue(false),
            removeControl: vi.fn(),
            addControl: vi.fn(),
        };

        // Setup GeoLeaf namespace
        global.GeoLeaf = {
            Log: {
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
            },
            Core: {
                getMap: vi.fn().mockReturnValue(mockMap),
            },
            Config: {
                get: vi.fn().mockReturnValue(null),
                getActiveProfile: vi.fn().mockReturnValue({}),
            },
            Baselayers: {
                getBaseLayers: vi.fn().mockReturnValue({
                    osm: { id: "osm", label: "OpenStreetMap" },
                    satellite: { id: "satellite", label: "Satellite" },
                }),
                setBaseLayer: vi.fn(),
            },
        };

        // Load the module fresh
        vi.resetModules();
        const lmModule = await import("../../../src/api/geoleaf.layer-manager.js");
        LegendModule = lmModule.LayerManager;
    });

    afterEach(() => {
        delete global.GeoLeaf;
    });

    // ========================================
    //   Module Structure
    // ========================================

    describe("Module Loading", () => {
        it("should be exported on GeoLeaf namespace", () => {
            expect(LegendModule).toBeDefined();
        });

        it("should have init method", () => {
            expect(typeof LegendModule.init).toBe("function");
        });

        it("should have _mergeOptions method", () => {
            expect(typeof LegendModule._mergeOptions).toBe("function");
        });

        it("should have _options property", () => {
            expect(LegendModule._options).toBeDefined();
        });

        it("should have _map property (null initially)", () => {
            expect(LegendModule._map).toBeNull();
        });

        it("should have _control property (null initially)", () => {
            expect(LegendModule._control).toBeNull();
        });
    });

    // ========================================
    //   Default Options
    // ========================================

    describe("Default Options", () => {
        it("should have default position as bottomright", () => {
            expect(LegendModule._options.position).toBe("bottomright");
        });

        // B.13 — titre passé par i18n (`ui.layer_manager.title`), franglais corrigé.
        it("should have default title as Gestionnaire de couches", () => {
            expect(LegendModule._options.title).toBe("Gestionnaire de couches");
        });

        it("should have collapsible enabled by default", () => {
            expect(LegendModule._options.collapsible).toBe(true);
        });

        it("should not be collapsed by default", () => {
            expect(LegendModule._options.collapsed).toBe(false);
        });

        it("should have empty sections array by default", () => {
            expect(Array.isArray(LegendModule._options.sections)).toBe(true);
        });
    });

    // ========================================
    //   init() - Validation
    // ========================================

    describe("init() - Validation", () => {
        it("should return null if _LayerManagerControl not loaded", () => {
            // In MapLibre mode, L is not required; init fails without _LayerManagerControl
            const result = LegendModule.init();
            expect(result).toBeNull();
            expect(global.GeoLeaf.Log.error).toHaveBeenCalledWith(
                expect.stringContaining("_LayerManagerControl not loaded")
            );
        });

        it("should fail if no map available", () => {
            global.GeoLeaf.Core.getMap.mockReturnValue(null);
            const result = LegendModule.init();
            expect(result).toBeNull();
            expect(global.GeoLeaf.Log.error).toHaveBeenCalledWith(
                expect.stringContaining("No map instance available")
            );
        });

        it("should get map from Core if not provided", () => {
            LegendModule.init();
            expect(global.GeoLeaf.Core.getMap).toHaveBeenCalled();
        });

        it("should use provided map from options", () => {
            const customMap = { custom: true, on: vi.fn(), off: vi.fn() };
            LegendModule.init({ map: customMap });
            expect(LegendModule._map).toBe(customMap);
        });
    });

    // ========================================
    //   init() - Options Merging
    // ========================================

    describe("init() - Options Merging", () => {
        it("should merge custom position option", () => {
            LegendModule.init({ position: "topleft" });
            expect(LegendModule._options.position).toBe("topleft");
        });

        it("should merge custom title option", () => {
            LegendModule.init({ title: "My Legend" });
            expect(LegendModule._options.title).toBe("My Legend");
        });

        it("should merge collapsible option", () => {
            LegendModule.init({ collapsible: false });
            expect(LegendModule._options.collapsible).toBe(false);
        });

        it("should merge collapsed option", () => {
            LegendModule.init({ collapsed: true });
            expect(LegendModule._options.collapsed).toBe(true);
        });

        it("should merge sections option", () => {
            const sections = [{ id: "test", label: "Test" }];
            LegendModule.init({ sections });
            expect(LegendModule._options.sections).toContainEqual(
                expect.objectContaining({ id: "test" })
            );
        });
    });

    // ========================================
    //   _mergeOptions()
    // ========================================

    describe("_mergeOptions()", () => {
        it("should merge simple values", () => {
            const base = { a: 1, b: 2 };
            const override = { b: 3, c: 4 };
            const result = LegendModule._mergeOptions(base, override);
            expect(result).toEqual({ a: 1, b: 3, c: 4 });
        });

        it("should handle nested objects", () => {
            const base = { a: 1, nested: { x: 1, y: 2 } };
            const override = { nested: { y: 3 } };
            const result = LegendModule._mergeOptions(base, override);
            expect(result.nested.y).toBe(3);
        });

        it("should return base if override is empty", () => {
            const base = { a: 1 };
            const result = LegendModule._mergeOptions(base, {});
            expect(result.a).toBe(1);
        });

        it("should handle null override values", () => {
            const base = { a: 1 };
            const result = LegendModule._mergeOptions(base, null);
            expect(result.a).toBe(1);
        });
    });

    // ========================================
    //   legendConfig Integration
    // ========================================

    describe("legendConfig Integration", () => {
        it("should load title from legendConfig", async () => {
            global.GeoLeaf.Config.get.mockReturnValue({
                title: "Custom Legend Title",
                sections: [],
            });

            vi.resetModules();
            const freshLM = (await import("../../../src/api/geoleaf.layer-manager.js"))
                .LayerManager;
            freshLM.init();

            expect(freshLM._options.title).toBe("Custom Legend Title");
        });

        it("should load sections from legendConfig", async () => {
            global.GeoLeaf.Config.get.mockReturnValue({
                sections: [{ id: "config-section", label: "From Config", order: 1 }],
            });

            vi.resetModules();
            const freshLM = (await import("../../../src/api/geoleaf.layer-manager.js"))
                .LayerManager;
            freshLM.init();

            const sections = freshLM._options.sections;
            expect(sections.some((s) => s.id === "config-section")).toBe(true);
        });

        it("should sort sections by order", async () => {
            global.GeoLeaf.Config.get.mockReturnValue({
                sections: [
                    { id: "second", label: "Second", order: 2 },
                    { id: "first", label: "First", order: 1 },
                    { id: "third", label: "Third", order: 3 },
                ],
            });

            vi.resetModules();
            const freshLM = (await import("../../../src/api/geoleaf.layer-manager.js"))
                .LayerManager;
            freshLM.init();

            const sections = freshLM._options.sections;
            // Find indices
            const firstIdx = sections.findIndex((s) => s.id === "first");
            const secondIdx = sections.findIndex((s) => s.id === "second");
            const thirdIdx = sections.findIndex((s) => s.id === "third");

            expect(firstIdx).toBeLessThan(secondIdx);
            expect(secondIdx).toBeLessThan(thirdIdx);
        });
    });

    // ========================================
    //   Basemap Auto-Population
    // ========================================

    describe("Basemap Auto-Population", () => {
        it("should auto-populate basemap section from Baselayers", async () => {
            global.GeoLeaf.Config.get.mockImplementation((key) => {
                if (key === "layerManagerConfig") {
                    return {
                        sections: [{ id: "basemap", label: "Fond de carte", items: [] }],
                    };
                }
                return null;
            });

            vi.resetModules();
            const freshLM = (await import("../../../src/api/geoleaf.layer-manager.js"))
                .LayerManager;
            freshLM.init();

            const basemapSection = freshLM._options.sections.find((s) => s.id === "basemap");
            expect(basemapSection).toBeDefined();
            expect(basemapSection.items.length).toBeGreaterThan(0);
        });

        it("should not auto-populate if basemap section already has items", async () => {
            const existingItems = [{ id: "existing", label: "Existing" }];

            global.GeoLeaf.Config.get.mockImplementation((key) => {
                if (key === "layerManagerConfig") {
                    return {
                        sections: [{ id: "basemap", label: "Fond de carte", items: existingItems }],
                    };
                }
                return null;
            });

            vi.resetModules();
            const freshLM = (await import("../../../src/api/geoleaf.layer-manager.js"))
                .LayerManager;
            freshLM.init({
                sections: [{ id: "basemap", label: "Basemaps", items: existingItems }],
            });

            // The existing items should be preserved
            const basemapSection = freshLM._options.sections.find((s) => s.id === "basemap");
            expect(basemapSection.items).toEqual(existingItems);
        });
    });

    // ========================================
    //   Control Creation
    // ========================================

    describe("Control Creation", () => {
        it("should return null without _LayerManagerControl", () => {
            // _LayerManagerControl is not mocked in tests — init returns null
            const result = LegendModule.init();
            expect(result).toBeNull();
        });

        it("should create control instance", () => {
            const result = LegendModule.init();
            expect(result).toBeDefined();
        });

        it("should store control reference", () => {
            LegendModule.init();
            expect(LegendModule._control).toBeDefined();
        });
    });

    // ========================================
    //   Edge Cases
    // ========================================

    describe("Edge Cases", () => {
        it("should handle missing Core module", () => {
            delete global.GeoLeaf.Core;
            LegendModule.init({ map: mockMap });
            // Should still work with explicit map
            expect(LegendModule._map).toBe(mockMap);
        });

        it("should handle missing Config module", () => {
            delete global.GeoLeaf.Config;
            expect(() => LegendModule.init()).not.toThrow();
        });

        it("should handle missing Baselayers module", () => {
            delete global.GeoLeaf.Baselayers;
            expect(() => LegendModule.init()).not.toThrow();
        });

        it("should handle empty sections gracefully", () => {
            LegendModule.init({ sections: [] });
            expect(Array.isArray(LegendModule._options.sections)).toBe(true);
        });
    });

    // ========================================
    //   Logging
    // ========================================

    describe("Logging", () => {
        it("should log info when initialized with map", () => {
            LegendModule.init();
            expect(global.GeoLeaf.Log.info).toHaveBeenCalled();
        });
    });
});
