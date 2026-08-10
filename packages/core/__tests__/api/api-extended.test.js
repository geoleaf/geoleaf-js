/**
 * Extended tests for GeoLeaf API module
 */

describe("GeoLeaf API Extended", () => {
    let GeoLeafAPI;

    beforeEach(async () => {
        vi.clearAllMocks();

        // Setup mock modules
        global.GeoLeaf = {
            Log: {
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
            },
            CONSTANTS: {
                DEFAULT_CENTER: [0, 0],
                DEFAULT_ZOOM: 10,
            },
            Core: {
                init: vi.fn().mockReturnValue({ map: "mockMap" }),
                setTheme: vi.fn(),
                getMap: vi.fn().mockReturnValue({ on: vi.fn() }),
            },
            UI: {
                applyTheme: vi.fn(),
            },
            Config: {
                init: vi.fn().mockResolvedValue({ data: "config" }),
                get: vi.fn().mockReturnValue({ data: "config" }),
                getActiveProfile: vi.fn().mockReturnValue({}),
            },
            POI: {
                addPoi: vi.fn().mockReturnValue({ marker: "mockMarker" }),
                add: vi.fn().mockImplementation((poi) => {
                    if (!poi) throw new Error("invalid input");
                    const p = { ...poi };
                    if (Array.isArray(poi.latlng)) {
                        p.lat = poi.latlng[0];
                        p.lng = poi.latlng[1];
                    }
                    return global.GeoLeaf.POI.addPoi(p);
                }),
                removePoi: vi.fn().mockReturnValue(true),
                remove: vi.fn().mockImplementation(() => {
                    global.GeoLeaf.Log.warn("[POI.remove] Not yet implemented");
                }),
                filterPoi: vi.fn().mockReturnValue([]),
                filter: vi.fn().mockImplementation((opts) => {
                    if (global.GeoLeaf.POI.setFilter) global.GeoLeaf.POI.setFilter(opts);
                }),
                setFilter: vi.fn(),
                centerOn: vi.fn(),
            },
            GeoJSON: {
                load: vi.fn().mockImplementation(() => {
                    throw new Error("loadUrl not available");
                }),
                loadLayer: vi.fn().mockResolvedValue({ layer: "mockLayer" }),
                removeLayer: vi.fn().mockReturnValue(true),
                showLayer: vi.fn(),
                hideLayer: vi.fn(),
            },
            Baselayers: {
                add: vi.fn().mockReturnValue({ layer: "mockBaselayer" }),
                set: vi.fn(),
                list: vi.fn().mockReturnValue(["osm", "satellite"]),
            },
            Legend: {
                init: vi.fn().mockReturnValue({ legend: "mockLegend" }),
                update: vi.fn(),
                show: vi.fn(),
                hide: vi.fn(),
            },
            LayerManager: {
                init: vi.fn().mockReturnValue({ legend: "mockLegend" }),
                show: vi.fn(),
                hide: vi.fn(),
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
        };

        // Mock CustomEvent
        global.CustomEvent = vi.fn((name, opts) => ({
            type: name,
            detail: opts?.detail,
        }));

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

        // Load the API module
        vi.resetModules();
        await import("../../src/globals/globals.api.js");
        GeoLeafAPI = global.GeoLeaf;
    });

    afterEach(() => {
        delete global.GeoLeaf;
        delete global.CustomEvent;
    });

    describe("GeoLeaf.init()", () => {
        test("should be defined", () => {
            expect(typeof GeoLeafAPI.init).toBe("function");
        });

        test("should call Core.init with structured options", () => {
            GeoLeafAPI.init({
                map: {
                    target: "map-container",
                    center: [45, 5],
                    zoom: 8,
                },
                ui: {
                    theme: "dark",
                },
            });

            expect(global.GeoLeaf._APIController.geoleafInit).toHaveBeenCalledWith(
                expect.objectContaining({
                    map: expect.objectContaining({ target: "map-container" }),
                })
            );
        });

        test("should call Core.init with flat options (legacy)", () => {
            GeoLeafAPI.init({
                target: "map-container",
                center: [45, 5],
                zoom: 8,
                theme: "light",
            });

            expect(global.GeoLeaf._APIController.geoleafInit).toHaveBeenCalledWith(
                expect.objectContaining({
                    target: "map-container",
                })
            );
        });

        test("should use default center and zoom if not provided", () => {
            GeoLeafAPI.init({
                target: "map-container",
            });

            expect(global.GeoLeaf._APIController.geoleafInit).toHaveBeenCalledWith(
                expect.objectContaining({
                    target: "map-container",
                })
            );
        });

        test("should throw if no options provided", () => {
            global.GeoLeaf._APIController.geoleafInit.mockImplementation(() => {
                throw new Error("No options");
            });
            expect(() => GeoLeafAPI.init()).toThrow();
        });

        test("should throw if no target provided", () => {
            global.GeoLeaf._APIController.geoleafInit.mockImplementation(() => {
                throw new Error("No target");
            });
            expect(() => GeoLeafAPI.init({})).toThrow();
        });
    });

    describe("GeoLeaf.setTheme()", () => {
        test("should be defined", () => {
            expect(typeof GeoLeafAPI.setTheme).toBe("function");
        });

        test("should call UI.applyTheme", () => {
            GeoLeafAPI.setTheme("dark");
            expect(global.GeoLeaf._APIController.geoleafSetTheme).toHaveBeenCalledWith("dark");
        });

        test("should call Core.setTheme", () => {
            GeoLeafAPI.setTheme("dark");
            expect(global.GeoLeaf._APIController.geoleafSetTheme).toHaveBeenCalledWith("dark");
        });

        test("should return theme value", () => {
            GeoLeafAPI.setTheme("dark");
            expect(global.GeoLeaf._APIController.geoleafSetTheme).toHaveBeenCalledWith("dark");
        });

        test("should warn if no theme provided", () => {
            GeoLeafAPI.setTheme();
            expect(global.GeoLeaf._APIController.geoleafSetTheme).toHaveBeenCalled();
        });

        test("should handle UI.applyTheme error", () => {
            global.GeoLeaf._APIController.geoleafSetTheme.mockImplementation(() => {
                throw new Error("theme error");
            });

            expect(() => GeoLeafAPI.setTheme("dark")).toThrow();
        });
    });

    describe("GeoLeaf.loadConfig()", () => {
        test("should be defined", () => {
            expect(typeof GeoLeafAPI.loadConfig).toBe("function");
        });

        test("should accept URL string", async () => {
            await GeoLeafAPI.loadConfig("config.json");
            expect(global.GeoLeaf._APIController.geoleafLoadConfig).toHaveBeenCalledWith(
                "config.json"
            );
        });

        test("should accept options object", async () => {
            await GeoLeafAPI.loadConfig({
                url: "config.json",
                headers: { "X-Token": "abc" },
            });
            expect(global.GeoLeaf._APIController.geoleafLoadConfig).toHaveBeenCalled();
        });

        test("should dispatch geoleaf:config:loaded event", async () => {
            await GeoLeafAPI.loadConfig("config.json");
            expect(global.GeoLeaf._APIController.geoleafLoadConfig).toHaveBeenCalled();
        });

        test("should throw on invalid input", () => {
            expect(() => GeoLeafAPI.loadConfig(123)).toThrow();
        });

        test("should return promise", () => {
            const result = GeoLeafAPI.loadConfig("config.json");
            expect(result).toBeInstanceOf(Promise);
        });
    });

    describe("GeoLeaf.POI.add()", () => {
        test("should be defined", () => {
            expect(typeof GeoLeafAPI.POI.add).toBe("function");
        });

        test("should call POI.addPoi", () => {
            GeoLeafAPI.POI.add({
                id: "poi-1",
                latlng: [45, 5],
                label: "Test POI",
            });
            expect(global.GeoLeaf.POI.addPoi).toHaveBeenCalled();
        });

        test("should convert latlng array to lat/lng", () => {
            GeoLeafAPI.POI.add({
                id: "poi-1",
                latlng: [45, 5],
            });
            expect(global.GeoLeaf.POI.addPoi).toHaveBeenCalledWith(
                expect.objectContaining({
                    lat: 45,
                    lng: 5,
                })
            );
        });

        test("should throw on invalid input", () => {
            expect(() => GeoLeafAPI.POI.add()).toThrow();
        });
    });

    describe("GeoLeaf.POI.remove()", () => {
        test("should be defined", () => {
            expect(typeof GeoLeafAPI.POI.remove).toBe("function");
        });

        test("should log warning (not yet implemented)", () => {
            GeoLeafAPI.POI.remove("poi-1");
            // API is defined but logs a warning that it's not yet implemented
            expect(global.GeoLeaf.Log.warn).toHaveBeenCalled();
        });
    });

    describe("GeoLeaf.POI.filter()", () => {
        test("should be defined", () => {
            expect(typeof GeoLeafAPI.POI.filter).toBe("function");
        });

        test("should call POI.setFilter when available", () => {
            global.GeoLeaf.POI.setFilter = vi.fn();
            GeoLeafAPI.POI.filter({ category: "restaurant" });
            expect(global.GeoLeaf.POI.setFilter).toHaveBeenCalled();
        });
    });

    describe("GeoLeaf.POI.centerOn()", () => {
        test("should be defined", () => {
            expect(typeof GeoLeafAPI.POI.centerOn).toBe("function");
        });

        test("should call POI.centerOn with id", () => {
            GeoLeafAPI.POI.centerOn("poi-1");
            expect(global.GeoLeaf.POI.centerOn).toHaveBeenCalledWith("poi-1");
        });
    });

    describe("GeoLeaf.GeoJSON.load()", () => {
        test("should be defined", () => {
            expect(typeof GeoLeafAPI.GeoJSON.load).toBe("function");
        });

        test("should throw when loadUrl is not available", () => {
            expect(() => {
                GeoLeafAPI.GeoJSON.load("https://example.com/data.geojson");
            }).toThrow();
        });
    });

    describe("GeoLeaf.GeoJSON.showLayer()", () => {
        test("should be defined", () => {
            expect(typeof GeoLeafAPI.GeoJSON.showLayer).toBe("function");
        });

        test("should handle missing original showLayer gracefully", () => {
            // The API wraps the original - test that it's callable
            expect(() => GeoLeafAPI.GeoJSON.showLayer("layer-1")).not.toThrow();
        });
    });

    describe("GeoLeaf.GeoJSON.hideLayer()", () => {
        test("should be defined", () => {
            expect(typeof GeoLeafAPI.GeoJSON.hideLayer).toBe("function");
        });

        test("should handle missing original hideLayer gracefully", () => {
            expect(() => GeoLeafAPI.GeoJSON.hideLayer("layer-1")).not.toThrow();
        });
    });

    /**
     * 🛑 SIX TESTS D'API FANTÔME, TROUVÉS ET REQUALIFIÉS À SOCLE-INIT 7.7.
     *
     * Ce bloc contenait `GeoLeaf.Baselayers.add()`, `.set()` et `.list()` — trois « should be
     * defined » et trois délégations. **Aucune des trois méthodes n'existe.** La façade réelle
     * (`kernel/basemaps/facade.ts`) expose `registerBaseLayer`, `setBaseLayer`, `getBaseLayers`
     * et leurs alias ; `add`, `set` et `list` n'étaient définies que par le faux `Baselayers` du
     * harnais, quelques centaines de lignes plus haut.
     *
     * Ces tests **s'assertaient eux-mêmes**. Ils passaient parce que l'ancien `geoleaf-api.js` ne
     * touchait pas à `Baselayers` et laissait le mock en place ; ils ont rougi à la seconde où le
     * fichier a été repointé sur `globals/globals.api.js`, qui monte la façade RÉELLE.
     *
     * C'est exactement la classe `GeoLeaf.Events` que ce dépôt a déjà payée (cf. la note de
     * `globals.api.ts`) : une surface documentée et testée, jamais montée. Sauf qu'ici l'oracle
     * était le mock, ce qui la rendait indétectable — un test vert sur une API qui n'existe pas.
     */
    describe("GeoLeaf.Baselayers — la façade RÉELLE, pas celle du harnais", () => {
        test("le namespace porte la façade importée, pas le faux du harnais", async () => {
            const { Baselayers } = await import("../../src/api/geoleaf.baselayers.js");
            expect(GeoLeafAPI.Baselayers).toBe(Baselayers);
            // L'alias historique pointe la MÊME référence — c'est le défaut `get BaseLayers` de
            // l'API S4.2, où `Object.assign` écrivait `undefined` par-dessus.
            expect(GeoLeafAPI.BaseLayers).toBe(GeoLeafAPI.Baselayers);
        });

        test("expose les méthodes qu'elle déclare, et AUCUNE des trois fantômes", () => {
            for (const real of ["registerBaseLayer", "setBaseLayer", "getBaseLayers"]) {
                expect(typeof GeoLeafAPI.Baselayers[real], `Baselayers.${real}`).toBe("function");
            }
            for (const ghost of ["add", "set", "list"]) {
                expect(
                    GeoLeafAPI.Baselayers[ghost],
                    `Baselayers.${ghost} n'a jamais existé — si elle apparaît, c'est qu'un mock ` +
                        `a repris la place de la façade, et ce fichier a déjà payé ce défaut`
                ).toBeUndefined();
            }
        });
    });

    describe("GeoLeaf.LayerManager.init()", () => {
        test("should be defined", () => {
            expect(typeof GeoLeafAPI.Legend.init).toBe("function");
        });

        test("should call Legend.init", () => {
            GeoLeafAPI.Legend.init({ position: "bottomright" });
            expect(global.GeoLeaf.Legend.init).toHaveBeenCalled();
        });
    });

    describe("GeoLeaf.LayerManager.show()", () => {
        test("should be defined", () => {
            expect(typeof GeoLeafAPI.Legend.show).toBe("function");
        });

        test("should call Legend.show", () => {
            GeoLeafAPI.Legend.show();
            expect(global.GeoLeaf.Legend.show).toHaveBeenCalled();
        });
    });

    describe("GeoLeaf.LayerManager.hide()", () => {
        test("should be defined", () => {
            expect(typeof GeoLeafAPI.Legend.hide).toBe("function");
        });

        test("should call Legend.hide", () => {
            GeoLeafAPI.Legend.hide();
            expect(global.GeoLeaf.Legend.hide).toHaveBeenCalled();
        });
    });

    // Les 4 tests `GeoLeaf.Filters.apply/reset` sont partis avec `Filters` (API S4.5).
    // Ils étaient tautologiques deux fois : `geoleaf-api.ts` fait `Object.assign(existing, …)`
    // où `existing === globalThis.GeoLeaf`, donc ils testaient le mock contre lui-même ; et
    // le mock déclarait `apply`/`reset`/`get`, trois méthodes que le vrai `Filters` n'a
    // jamais portées (il n'avait que `filterRouteList`). Ils seraient restés VERTS après la
    // suppression du module.

    describe("Module Checks", () => {
        test("should handle missing Core module", async () => {
            global.GeoLeaf.Core = null;

            vi.resetModules();
            await import("../../src/globals/globals.api.js");

            expect(() => global.GeoLeaf.init({ target: "map" })).not.toThrow();
        });

        test("should handle missing Config module", async () => {
            global.GeoLeaf.Config = null;

            vi.resetModules();
            await import("../../src/globals/globals.api.js");

            await expect(global.GeoLeaf.loadConfig("config.json")).resolves.toBeDefined();
        });
    });
});
