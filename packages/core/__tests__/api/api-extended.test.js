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
            // 🗑️ The full POI mounting (9 members) is removed with the suites exercising it.
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

        // ⚠️ The fake controller must be an ACCESSOR, not a value.
        // `kernel/api/controller.ts` only installs its own if it does not
        // already find one (`getOwnPropertyDescriptor(...).get`); a fake set
        // as a plain value does not hold it back and gets overwritten as
        // soon as the `globals/` chain loads. It is also the REAL production
        // shape — the test gains fidelity, it works around nothing.
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

    // 🗑️ FOUR suites removed on 20/08/2026 — the POI facades `add`,
    // `remove`, `filter` and `centerOn` — because they ACTIVELY exercised a
    // **long-dissolved** subsystem.
    //
    // 🛑 They were green by TAUTOLOGY: the `beforeEach` does
    // `GeoLeafAPI = global.GeoLeaf` and the fixture itself set the POI
    // mounting on that very object. Checking a member there is "function"
    // thus only asserted the fixture, and the rest verified that a mock
    // called a mock.
    //
    // The OPPOSITE contract is written in `src/kernel/api/module-catalog.ts`:
    // `CATALOG_EXPECTED_ABSENT` carries the POI entry with its motive, and
    // `getModule` must return `null` on it. Nothing is lost in the removal —
    // that absence is already guarded by
    // `__tests__/api/module-discovery.characterisation.test.js`, which
    // requires a catalogue entry absent from the namespace to carry a
    // motive, and confronts each motive.
    //
    // ⚠️ There is NO useful "negative" equivalent to write here, unlike
    // `api.test.js` where the assertion could flip into a useful absence
    // test: a suite exercising the methods of an absent subsystem has
    // nothing to flip.
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
     * 🛑 SIX GHOST-API TESTS, FOUND AND REQUALIFIED.
     *
     * This block contained `GeoLeaf.Baselayers.add()`, `.set()` and
     * `.list()` — three "should be defined" and three delegations. **None
     * of the three methods exists.** The real facade
     * (`kernel/basemaps/facade.ts`) exposes `registerBaseLayer`,
     * `setBaseLayer`, `getBaseLayers` and their aliases; `add`, `set` and
     * `list` were only defined by the harness's fake `Baselayers`, a few
     * hundred lines above.
     *
     * These tests **asserted themselves**. They passed because the old
     * `geoleaf-api.js` did not touch `Baselayers` and left the mock in
     * place; they turned red the second the file was repointed to
     * `globals/globals.api.js`, which mounts the REAL facade.
     *
     * Exactly the `GeoLeaf.Events` class this repo already paid for (cf.
     * `globals.api.ts`'s note): a surface documented and tested, never
     * mounted. Except here the oracle was the mock, which made it
     * undetectable — a green test on an API that does not exist.
     */
    describe("GeoLeaf.Baselayers — la façade RÉELLE, pas celle du harnais", () => {
        test("le namespace porte la façade importée, pas le faux du harnais", async () => {
            const { Baselayers } = await import("../../src/api/geoleaf.baselayers.js");
            expect(GeoLeafAPI.Baselayers).toBe(Baselayers);
            // The historical alias points at the SAME reference — the
            // `get BaseLayers` defect of the API review, where
            // `Object.assign` wrote `undefined` over it.
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

    // The 4 `GeoLeaf.Filters.apply/reset` tests left with `Filters`.
    // They were tautological twice: `geoleaf-api.ts` does
    // `Object.assign(existing, …)` where `existing === globalThis.GeoLeaf`,
    // so they tested the mock against itself; and the mock declared
    // `apply`/`reset`/`get`, three methods the real `Filters` never carried
    // (it only had `filterRouteList`). They would have stayed GREEN after
    // the module's deletion.

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
