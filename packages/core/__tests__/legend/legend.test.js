/**
 */

// Tests for GeoLeaf.LayerManager module

describe("GeoLeaf.LayerManager", () => {
    let Legend;
    let mockMap;
    let mockControl;

    beforeEach(async () => {
        // Create mock control element
        const mockContainer = document.createElement("div");
        mockContainer.className = "geoleaf-legend";

        mockControl = {
            addTo: vi.fn().mockReturnThis(),
            remove: vi.fn(),
            getContainer: vi.fn().mockReturnValue(mockContainer),
        };

        // Mock map
        mockMap = {
            addControl: vi.fn(),
            removeControl: vi.fn(),
            hasLayer: vi.fn().mockReturnValue(true),
            on: vi.fn(),
            off: vi.fn(),
        };

        // Mock GeoLeaf namespace
        global.GeoLeaf = {
            Log: {
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
            },
            CONSTANTS: {},
            Core: {
                getMap: vi.fn().mockReturnValue(mockMap),
            },
            Config: {
                get: vi.fn().mockReturnValue(null),
            },
            Baselayers: {
                getBaseLayers: vi.fn().mockReturnValue({
                    street: { label: "Street" },
                    satellite: { label: "Satellite" },
                }),
            },
            _LayerManagerControl: {
                create: vi.fn().mockReturnValue(mockControl),
            },
        };

        vi.resetModules();
        const lmModule = await import("../../src/api/geoleaf.layer-manager.ts");

        Legend = lmModule.LayerManager;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("init()", () => {
        it("should initialize with map", () => {
            const result = Legend.init({ map: mockMap });

            expect(result).toBeDefined();
        });

        it("should get map from Core if not provided", () => {
            Legend.init({});

            expect(global.GeoLeaf.Core.getMap).toHaveBeenCalled();
        });

        it("should return null if no map available", () => {
            global.GeoLeaf.Core.getMap = vi.fn().mockReturnValue(null);

            const result = Legend.init({});

            expect(result).toBeNull();
            expect(global.GeoLeaf.Log.error).toHaveBeenCalled();
        });

        it("should return null if _LayerManagerControl not available", () => {
            global.GeoLeaf._LayerManagerControl = undefined;

            const result = Legend.init({ map: mockMap });

            expect(result).toBeNull();
        });

        it("should accept custom position", () => {
            Legend.init({ map: mockMap, position: "topleft" });

            expect(Legend._options.position).toBe("topleft");
        });

        it("should accept custom title", () => {
            Legend.init({ map: mockMap, title: "My Legend" });

            expect(Legend._options.title).toBe("My Legend");
        });

        it("should accept collapsible option", () => {
            Legend.init({ map: mockMap, collapsible: false });

            expect(Legend._options.collapsible).toBe(false);
        });

        it("should accept sections array", () => {
            const sections = [{ id: "test", label: "Test Section", items: [] }];

            Legend.init({ map: mockMap, sections });

            expect(Legend._options.sections).toContainEqual(
                expect.objectContaining({ id: "test" })
            );
        });
    });

    describe("Default options", () => {
        it("should have default position", () => {
            expect(Legend._options.position).toBe("bottomright");
        });

        // Backlog B.13 — le titre était codé en dur à « Gestionnaire de layers », un
        // franglais VISIBLE à l'écran. Il passe désormais par `ui.layer_manager.title`,
        // dont le défaut FR est « Gestionnaire de couches ». Le panneau devient
        // traduisible au passage (les clés voisines `ui.layer_manager.*` existaient déjà).
        it("should resolve its default title through i18n", () => {
            expect(Legend._options.title).toBe("Gestionnaire de couches");
        });

        it("should be collapsible by default", () => {
            expect(Legend._options.collapsible).toBe(true);
        });

        it("should not be collapsed by default", () => {
            expect(Legend._options.collapsed).toBe(false);
        });

        it("should have empty sections array by default", () => {
            expect(Legend._options.sections).toEqual([]);
        });
    });

    describe("removeSection()", () => {
        beforeEach(() => {
            Legend.init({
                map: mockMap,
                sections: [
                    { id: "section1", label: "Section 1", items: [] },
                    { id: "section2", label: "Section 2", items: [] },
                ],
            });
        });

        it("should have initialized sections", () => {
            expect(Legend._options.sections.length).toBeGreaterThan(0);
        });
    });

    describe("sections access", () => {
        beforeEach(() => {
            Legend.init({
                map: mockMap,
                sections: [{ id: "test", label: "Test", items: [] }],
            });
        });

        it("should have sections in options", () => {
            expect(Legend._options.sections).toBeDefined();
            expect(Array.isArray(Legend._options.sections)).toBe(true);
        });

        it("should find section via array methods", () => {
            const section = Legend._options.sections.find((s) => s.id === "test");
            expect(section).toBeDefined();
        });
    });

    describe("internal state", () => {
        beforeEach(() => {
            Legend.init({ map: mockMap });
        });

        it("should have _map reference", () => {
            expect(Legend._map).toBe(mockMap);
        });

        it("should have collapsed option", () => {
            expect(typeof Legend._options.collapsed).toBe("boolean");
        });
    });

    describe("_mergeOptions()", () => {
        it("should merge options objects", () => {
            const defaults = { a: 1, b: 2 };
            const overrides = { b: 3, c: 4 };

            const result = Legend._mergeOptions(defaults, overrides);

            expect(result.a).toBe(1);
            expect(result.b).toBe(3);
            expect(result.c).toBe(4);
        });
    });

    describe("Auto-population", () => {
        it("should auto-populate basemap section from Baselayers", () => {
            Legend.init({
                map: mockMap,
                sections: [{ id: "basemap", label: "Basemaps", items: [] }],
            });

            const basemapSection = Legend._options.sections.find((s) => s.id === "basemap");
            expect(basemapSection.items.length).toBeGreaterThan(0);
        });
    });

    describe("legendConfig integration", () => {
        it('should load sections from Config.get("legendConfig")', () => {
            global.GeoLeaf.Config.get = vi.fn((key) => {
                if (key === "layerManagerConfig") {
                    return {
                        title: "Custom Legend",
                        sections: [{ id: "custom", label: "Custom Section", order: 1 }],
                    };
                }
                return null;
            });

            Legend.init({ map: mockMap });

            expect(Legend._options.title).toBe("Custom Legend");
        });
    });
});
