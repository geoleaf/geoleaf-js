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
            // 🗑️ A `POI: { init, loadPois }` was mounted here, and the
            // "should have POI namespace" test below verified it existed —
            // the fixture attested its own making. The POI subsystem is
            // **long dissolved**: `kernel/api/module-catalog.ts`
            // declares it by name, and its comment `:56` says
            // `getModule("POI")` must return `null`. Removed on 17/08/2026;
            // the assertion is flipped to attest the absence, not the fixture.
            GeoJSON: {
                init: vi.fn(),
                // `loadGeoJSON` removed on 20/08/2026: the `GeoJSON` facade
                // carries 27 members, neither `load` nor `loadGeoJSON`. The
                // neighbour `load` exists elsewhere in the repo but NOT on
                // this facade — the "homonym seam" false positive.
            },
            // 🗑️ A `Baselayers: { init, setBaselayer }` was mounted here. It
            // carried a member the facade does not know (it carries
            // `setBaseLayer`, capital `L`), and the motive written in place
            // said rewiring it "changes what the test exercises". MEASURED:
            // it changes NOTHING. `globals.api.ts` does
            // `_gl.Baselayers = Baselayers` — the real facade OVERWRITES
            // this double before the first assertion, and
            // `GeoLeaf.Baselayers.setBaselayer` is `undefined` in this
            // suite. The double was not exercised: it was dead and invisible.
            Legend: {
                init: vi.fn(),
            },
        };

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
            // 🛑 Requalified. This assertion read
            // `GeoLeaf.Core.getMap(); expect(global.GeoLeaf.Core.getMap).toHaveBeenCalled();`
            // — a TAUTOLOGY: `GeoLeaf` IS `global.GeoLeaf`, so it verified
            // that calling a spy calls it. It only passed because the old
            // `geoleaf-api.js` did not touch `Core` and thus left the
            // harness's fake in place.
            //
            // What is true, and worth guarding: `assignApiFacades` mounts
            // the REAL facade, overwriting what the harness had set. The
            // `get BaseLayers` defect class taken by the right end — who
            // writes what on the namespace, and is it the expected reference.
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

        it("n'a PAS de namespace POI — dissous au S9, et l'absence est le contrat", () => {
            // 🛑 This assertion is the inverse of the one it replaces, and
            // that is the fact the old one could not render: it verified an
            // object the fixture three screens up had just made. The real
            // contract lives in `kernel/api/module-catalog.ts` — `POI` is in
            // `PUBLIC_MODULES` with its motive (POI subsystem dissolved, no
            // installer mounts this key), so an integrator still querying
            // that name receives `null` and not an error.
            expect(GeoLeaf.POI).toBeUndefined();
        });

        it("should have GeoJSON namespace", () => {
            expect(GeoLeaf.GeoJSON).toBeDefined();
        });

        it("should have Baselayers namespace", () => {
            expect(GeoLeaf.Baselayers).toBeDefined();
        });

        it("should have BaseLayers alias", () => {
            // ⚠️ This assertion read `GeoLeaf.Baselayers` — the canonical
            // name, not the alias: it passed without `BaseLayers` existing.
            // `globals.api.ts` mounts both on the SAME object, and that
            // identity is what makes the alias.
            expect(GeoLeaf.BaseLayers).toBeDefined();
            expect(GeoLeaf.BaseLayers).toBe(GeoLeaf.Baselayers);
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
