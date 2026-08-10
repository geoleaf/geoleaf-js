/**
 */

// Tests for GeoLeaf.API module (public API facade)

describe("GeoLeaf API", () => {
    let GeoLeaf;

    beforeEach(async () => {
        // Mock DOM
        const mapDiv = document.createElement("div");
        mapDiv.id = "geoleaf-map";
        document.body.appendChild(mapDiv);

        // Mock map instance returned by Core.init / Core.getMap
        const mockMapInstance = {
            setView: vi.fn().mockReturnThis(),
            addLayer: vi.fn(),
            on: vi.fn(),
        };

        // Mock GeoLeaf namespace with modules
        global.GeoLeaf = {
            Log: {
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
            },
            CONSTANTS: {
                DEFAULT_CENTER: [48.8566, 2.3522],
                DEFAULT_ZOOM: 13,
            },
            // _APIController mock required by geoleaf.api.js (Phase 7 B11)
            _APIController: {
                isInitialized: true,
                geoleafInit: vi.fn().mockResolvedValue({ success: true }),
                geoleafSetTheme: vi.fn().mockResolvedValue(true),
                geoleafLoadConfig: vi.fn().mockResolvedValue({}),
                geoleafCreateMap: vi.fn().mockReturnValue({}),
                getHealthStatus: vi
                    .fn()
                    .mockReturnValue({ healthy: true, managers: 3, errors: [] }),
                moduleAccessFn: vi.fn().mockReturnValue(null),
                managers: {
                    factory: {
                        getMapInstance: vi.fn().mockReturnValue(null),
                        getAllMapInstances: vi.fn().mockReturnValue([]),
                        removeMapInstance: vi.fn().mockReturnValue(false),
                    },
                },
            },
            Core: {
                init: vi.fn().mockReturnValue({
                    map: mockMapInstance,
                    container: mapDiv,
                }),
                getMap: vi.fn().mockReturnValue(mockMapInstance),
                setTheme: vi.fn(),
            },
            UI: {
                init: vi.fn(),
                applyTheme: vi.fn(),
                getCurrentTheme: vi.fn().mockReturnValue("light"),
            },
            Config: {
                init: vi.fn().mockResolvedValue({}),
                get: vi.fn(),
                set: vi.fn(),
                loadUrl: vi.fn().mockResolvedValue({}),
            },
            POI: {
                init: vi.fn(),
                loadPois: vi.fn(),
            },
            GeoJSON: {
                init: vi.fn(),
                loadGeoJSON: vi.fn().mockResolvedValue({}),
            },
            Baselayers: {
                init: vi.fn(),
                setBaselayer: vi.fn(),
            },
            Legend: {
                init: vi.fn(),
            },
        };

        // ⚠️ socle-init 7.7 — le faux contrôleur doit être un ACCESSEUR, pas une valeur.
        // `kernel/api/controller.ts` n'installe le sien que s'il n'en trouve pas déjà un
        // (`getOwnPropertyDescriptor(...).get`) ; un faux posé en valeur simple ne le retient
        // donc pas et se fait écraser dès que la chaîne `globals/` est chargée. C'est aussi la
        // forme RÉELLE en production — le test gagne en fidélité, il ne contourne rien.
        const _fakeController = global.GeoLeaf._APIController;
        Object.defineProperty(global.GeoLeaf, "_APIController", {
            get: () => _fakeController,
            configurable: true,
            enumerable: true,
        });

        // Clear module cache
        vi.resetModules();

        // Load the module (Phase 7 B11: capture named export)
        await import("../../src/globals/globals.api.js");
        GeoLeaf = global.GeoLeaf;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = "";
    });

    describe("init()", () => {
        it("should initialize with structured options", () => {
            GeoLeaf.init({
                map: {
                    target: "geoleaf-map",
                    center: [48.8566, 2.3522],
                    zoom: 13,
                },
                ui: {
                    theme: "dark",
                },
            });

            expect(global.GeoLeaf._APIController.geoleafInit).toHaveBeenCalled();
        });

        it("should initialize with flat options (legacy)", () => {
            GeoLeaf.init({
                target: "geoleaf-map",
                center: [48.8566, 2.3522],
                zoom: 13,
                theme: "light",
            });

            expect(global.GeoLeaf._APIController.geoleafInit).toHaveBeenCalledWith(
                expect.objectContaining({
                    target: "geoleaf-map",
                })
            );
        });

        it("should throw error if no options provided", () => {
            global.GeoLeaf._APIController.geoleafInit.mockImplementation(() => {
                throw new Error("No options");
            });
            expect(() => GeoLeaf.init()).toThrow();
        });

        it("should throw error if no target provided", () => {
            global.GeoLeaf._APIController.geoleafInit.mockImplementation(() => {
                throw new Error("No target");
            });
            expect(() => GeoLeaf.init({ map: {} })).toThrow();
        });

        it("should use default center and zoom if not provided", () => {
            GeoLeaf.init({
                map: { target: "geoleaf-map" },
            });

            expect(global.GeoLeaf._APIController.geoleafInit).toHaveBeenCalledWith(
                expect.objectContaining({
                    map: expect.objectContaining({ target: "geoleaf-map" }),
                })
            );
        });
    });

    describe("setTheme()", () => {
        it("should apply theme via UI module", () => {
            GeoLeaf.setTheme("dark");

            expect(global.GeoLeaf._APIController.geoleafSetTheme).toHaveBeenCalledWith("dark");
        });

        it("should apply theme via Core module", () => {
            GeoLeaf.setTheme("dark");

            expect(global.GeoLeaf._APIController.geoleafSetTheme).toHaveBeenCalledWith("dark");
        });

        it("should warn if no theme provided", () => {
            GeoLeaf.setTheme();

            expect(global.GeoLeaf._APIController.geoleafSetTheme).toHaveBeenCalled();
        });

        it("should handle UI.applyTheme errors gracefully", () => {
            global.GeoLeaf.UI.applyTheme.mockImplementation(() => {
                throw new Error("Theme error");
            });

            expect(() => GeoLeaf.setTheme("dark")).not.toThrow();
        });
    });

    describe("loadConfig()", () => {
        it("should load config from URL", async () => {
            await GeoLeaf.loadConfig("/config.json");

            expect(global.GeoLeaf._APIController.geoleafLoadConfig).toHaveBeenCalledWith(
                "/config.json"
            );
        });

        it("should load config from object", async () => {
            const configObj = { map: { zoom: 10 } };

            await GeoLeaf.loadConfig(configObj);

            expect(global.GeoLeaf._APIController.geoleafLoadConfig).toHaveBeenCalled();
        });

        it("should throw for invalid input", () => {
            expect(() => GeoLeaf.loadConfig(123)).toThrow();
        });
    });

    describe("Config namespace", () => {
        it("should expose Config.get method", () => {
            expect(typeof GeoLeaf.Config.get).toBe("function");
        });

        it("should expose Config.set method", () => {
            expect(typeof GeoLeaf.Config.set).toBe("function");
        });
    });

    describe("Core namespace", () => {
        it("should expose Core.getMap method", () => {
            expect(typeof GeoLeaf.Core.getMap).toBe("function");
        });

        it("monte la VRAIE façade Core, elle n'hérite pas de ce que l'appelant avait posé", async () => {
            // 🛑 Requalifié à socle-init 7.7. Cette assertion s'écrivait
            // `GeoLeaf.Core.getMap(); expect(global.GeoLeaf.Core.getMap).toHaveBeenCalled();`
            // — une TAUTOLOGIE : `GeoLeaf` EST `global.GeoLeaf`, donc elle vérifiait qu'appeler
            // un espion l'appelle. Elle ne passait que parce que l'ancien `geoleaf-api.js` ne
            // touchait pas à `Core` et laissait donc le faux du harnais en place.
            //
            // Ce qui est vrai, et qui vaut d'être gardé : `assignApiFacades` monte la façade
            // RÉELLE, en écrasant ce que le harnais avait posé. C'est la classe de défaut de
            // `get BaseLayers` (API S4.2) prise par le bon bout — qui écrit quoi sur le
            // namespace, et est-ce bien la référence attendue.
            const { Core } = await import("../../src/api/geoleaf.core.js");
            expect(GeoLeaf.Core).toBe(Core);
            expect(typeof GeoLeaf.Core.getMap).toBe("function");
        });
    });

    describe("Module namespaces", () => {
        it("should have Core namespace", () => {
            expect(GeoLeaf.Core).toBeDefined();
        });

        it("should have UI namespace", () => {
            expect(GeoLeaf.UI).toBeDefined();
        });

        it("should have Config namespace", () => {
            expect(GeoLeaf.Config).toBeDefined();
        });

        it("should have POI namespace", () => {
            expect(GeoLeaf.POI).toBeDefined();
        });

        it("should have GeoJSON namespace", () => {
            expect(GeoLeaf.GeoJSON).toBeDefined();
        });

        it("should have Baselayers namespace", () => {
            expect(GeoLeaf.Baselayers).toBeDefined();
        });

        it("should have BaseLayers alias", () => {
            // BaseLayers is an alias for Baselayers
            expect(GeoLeaf.Baselayers).toBeDefined();
        });
    });

    describe("version", () => {
        it("should have version property", () => {
            expect(GeoLeaf.version).toBeDefined();
            expect(typeof GeoLeaf.version).toBe("string");
        });
    });

    describe("createMap()", () => {
        it("should be a function", () => {
            expect(typeof GeoLeaf.createMap).toBe("function");
        });
    });
});
