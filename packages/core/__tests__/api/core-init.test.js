/**
 */

// Tests for GeoLeaf.Core module - Main map initialization (MapLibre migration)

// Mock the event-bus to avoid import errors from MaplibreAdapter
vi.mock("../../src/kernel/events/event-bus.ts", () => ({
    dispatchGeoLeafEvent: vi.fn(),
}));

describe("GeoLeaf.Core", () => {
    let Core;
    let mockMapInstance;
    let mockMapElement;

    beforeEach(async () => {
        // Create mock map element
        mockMapElement = document.createElement("div");
        mockMapElement.id = "geoleaf-map";
        document.body.appendChild(mockMapElement);

        // Mock MapLibre map instance
        mockMapInstance = {
            on: vi.fn(),
            off: vi.fn(),
            once: vi.fn(),
            remove: vi.fn(),
            getCenter: vi.fn().mockReturnValue({ lat: 48.8566, lng: 2.3522 }),
            getZoom: vi.fn().mockReturnValue(10),
            getBounds: vi.fn().mockReturnValue({
                getNorth: () => 49,
                getSouth: () => 48,
                getEast: () => 3,
                getWest: () => 2,
            }),
            jumpTo: vi.fn(),
            easeTo: vi.fn(),
            flyTo: vi.fn(),
            fitBounds: vi.fn(),
            getContainer: vi.fn().mockReturnValue(document.createElement("div")),
            project: vi.fn().mockReturnValue({ x: 0, y: 0 }),
            unproject: vi.fn().mockReturnValue({ lat: 0, lng: 0 }),
            resize: vi.fn(),
            addControl: vi.fn(),
            removeControl: vi.fn(),
        };

        // Mock MapLibre GL — Vitest 4: `new maplibregl.Map(...)` needs a constructable
        // mock (class returning the fake); mockReturnValue throws when called with `new`.
        global.maplibregl = {
            Map: vi.fn().mockImplementation(
                class {
                    constructor() {
                        return mockMapInstance;
                    }
                }
            ),
        };

        // Mock GeoLeaf namespace
        global.GeoLeaf = {
            Log: {
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
            },
            CONSTANTS: {
                DEFAULT_CENTER: [0, 0],
                DEFAULT_ZOOM: 3,
            },
            Config: {
                get: vi.fn().mockReturnValue(null),
            },
            UI: {
                applyTheme: vi.fn(),
            },
        };

        vi.resetModules();
        // Phase 7 B11: capture named export and attach to global (facades don't mutate global)
        const coreModule = await import("../../src/api/geoleaf.core.js");
        Core = coreModule.Core || global.GeoLeaf.Core;
        if (Core) global.GeoLeaf.Core = Core;
    });

    afterEach(() => {
        // Clean up DOM
        if (mockMapElement && mockMapElement.parentNode) {
            mockMapElement.parentNode.removeChild(mockMapElement);
        }
        // Core.getTheme() reads the body class as its no-UI fallback, so theme
        // classes must not leak between tests.
        document.body.classList.remove("gl-theme-light", "gl-theme-dark");
        vi.restoreAllMocks();
    });

    describe("init()", () => {
        it("should initialize map with valid options", () => {
            const result = Core.init({
                mapId: "geoleaf-map",
                center: [48.8566, 2.3522],
                zoom: 13,
            });

            expect(result).not.toBeNull();
            expect(result.isReady()).toBe(true);
            expect(global.maplibregl.Map).toHaveBeenCalled();
        });

        it("should use provided center and zoom", () => {
            Core.init({
                mapId: "geoleaf-map",
                center: [48.8566, 2.3522],
                zoom: 13,
            });

            expect(global.maplibregl.Map).toHaveBeenCalledWith(
                expect.objectContaining({
                    container: mockMapElement,
                    center: expect.any(Array),
                    zoom: expect.any(Number),
                })
            );
        });

        it("should return null if MapLibre not available", () => {
            delete global.maplibregl;

            const result = Core.init({
                mapId: "geoleaf-map",
                center: [48.8566, 2.3522],
                zoom: 13,
            });

            expect(result).toBeNull();
            expect(global.GeoLeaf.Log.error).toHaveBeenCalled();
        });

        it("should throw error if mapId is missing", () => {
            const result = Core.init({
                center: [48.8566, 2.3522],
                zoom: 13,
            });

            expect(result).toBeNull();
            expect(global.GeoLeaf.Log.error).toHaveBeenCalled();
        });

        it("should throw error if DOM element not found", () => {
            const result = Core.init({
                mapId: "nonexistent-map",
                center: [48.8566, 2.3522],
                zoom: 13,
            });

            expect(result).toBeNull();
            expect(global.GeoLeaf.Log.error).toHaveBeenCalled();
        });

        it("should use default center if not provided", () => {
            Core.init({
                mapId: "geoleaf-map",
                zoom: 10,
            });

            expect(global.maplibregl.Map).toHaveBeenCalledWith(
                expect.objectContaining({
                    container: mockMapElement,
                    center: expect.any(Array),
                })
            );
        });

        it("should use default zoom if not provided", () => {
            Core.init({
                mapId: "geoleaf-map",
                center: [48.8566, 2.3522],
            });

            expect(global.maplibregl.Map).toHaveBeenCalledWith(
                expect.objectContaining({
                    container: mockMapElement,
                    zoom: global.GeoLeaf.CONSTANTS.DEFAULT_ZOOM,
                })
            );
        });

        it("should apply theme on init", () => {
            Core.init({
                mapId: "geoleaf-map",
                center: [48.8566, 2.3522],
                zoom: 13,
                theme: "dark",
            });

            // `false` = applied, not persisted — the boot never overwrites the user's
            // stored theme choice (backlog B.18).
            expect(global.GeoLeaf.UI.applyTheme).toHaveBeenCalledWith("dark", false);
        });

        it("should reuse existing map instance", () => {
            const result1 = Core.init({
                mapId: "geoleaf-map",
                center: [48.8566, 2.3522],
                zoom: 13,
            });

            const result2 = Core.init({
                mapId: "geoleaf-map",
                center: [40.0, 3.0],
                zoom: 10,
            });

            expect(result1).toBe(result2);
            expect(global.maplibregl.Map).toHaveBeenCalledTimes(1);
            expect(global.GeoLeaf.Log.warn).toHaveBeenCalled();
        });

        it("should call onError callback on error", () => {
            const onErrorMock = vi.fn();
            global.GeoLeaf.Core.onError = onErrorMock;

            Core.init({
                mapId: "nonexistent-element",
                center: [48.8566, 2.3522],
                zoom: 13,
            });

            expect(onErrorMock).toHaveBeenCalled();
        });
    });

    describe("getMap()", () => {
        it("should return null before init", () => {
            expect(Core.getMap()).toBeNull();
        });

        it("should return map instance after init", () => {
            Core.init({
                mapId: "geoleaf-map",
                center: [48.8566, 2.3522],
                zoom: 13,
            });

            expect(Core.getMap()).not.toBeNull();
            expect(Core.getMap().isReady()).toBe(true);
        });
    });

    // Core.setTheme/getTheme delegate to the canonical UI theme engine
    // (_UITheme) when GeoLeaf.UI is mounted, and fall back to a plain body
    // class swap when it is not. Both paths are covered below.
    describe("setTheme() — delegating to GeoLeaf.UI", () => {
        it("should delegate light theme to the UI engine", () => {
            Core.setTheme("light");

            expect(global.GeoLeaf.UI.applyTheme).toHaveBeenCalledWith("light");
        });

        it("should delegate dark theme to the UI engine, and persist it", () => {
            Core.setTheme("dark");

            // One argument = `persist` keeps its default `true`. `Core.setTheme()` is the
            // EXPLICIT public entry point — an integrator or user choosing a theme — so it
            // must persist. That is precisely what the boot must NOT do (backlog B.18).
            expect(global.GeoLeaf.UI.applyTheme).toHaveBeenCalledWith("dark");
        });

        it("should warn for invalid theme and not delegate", () => {
            Core.setTheme("invalid");

            expect(global.GeoLeaf.Log.warn).toHaveBeenCalled();
            expect(global.GeoLeaf.UI.applyTheme).not.toHaveBeenCalled();
        });

        it("should fall back to the body class when the UI engine throws", () => {
            global.GeoLeaf.UI.applyTheme = vi.fn(() => {
                throw new Error("UI not ready");
            });

            Core.setTheme("dark");

            expect(document.body.classList.contains("gl-theme-dark")).toBe(true);
            expect(document.body.classList.contains("gl-theme-light")).toBe(false);
        });
    });

    describe("setTheme() — fallback without GeoLeaf.UI", () => {
        beforeEach(() => {
            delete global.GeoLeaf.UI;
        });

        it("should apply light theme", () => {
            Core.setTheme("light");

            expect(document.body.classList.contains("gl-theme-light")).toBe(true);
            expect(document.body.classList.contains("gl-theme-dark")).toBe(false);
        });

        it("should apply dark theme", () => {
            Core.setTheme("dark");

            expect(document.body.classList.contains("gl-theme-dark")).toBe(true);
            expect(document.body.classList.contains("gl-theme-light")).toBe(false);
        });

        it("should remove previous theme class", () => {
            Core.setTheme("light");
            Core.setTheme("dark");

            expect(document.body.classList.contains("gl-theme-dark")).toBe(true);
            expect(document.body.classList.contains("gl-theme-light")).toBe(false);
        });
    });

    describe("getTheme()", () => {
        it("should read through to the UI engine when mounted", () => {
            global.GeoLeaf.UI.getCurrentTheme = vi.fn().mockReturnValue("dark");

            expect(Core.getTheme()).toBe("dark");
            expect(global.GeoLeaf.UI.getCurrentTheme).toHaveBeenCalled();
        });

        it("should return the theme set through the fallback path", () => {
            delete global.GeoLeaf.UI;

            Core.setTheme("dark");

            expect(Core.getTheme()).toBe("dark");
        });

        it("should default to light theme", () => {
            delete global.GeoLeaf.UI;

            expect(Core.getTheme()).toBe("light");
        });
    });

    describe("Module exposure", () => {
        it("should expose Core on GeoLeaf namespace", () => {
            expect(global.GeoLeaf.Core).toBeDefined();
        });

        it("should expose init method", () => {
            expect(typeof Core.init).toBe("function");
        });

        it("should expose getMap method", () => {
            expect(typeof Core.getMap).toBe("function");
        });

        it("should expose setTheme method", () => {
            expect(typeof Core.setTheme).toBe("function");
        });

        it("should expose getTheme method", () => {
            expect(typeof Core.getTheme).toBe("function");
        });
    });
});
