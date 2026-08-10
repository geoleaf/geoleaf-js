/**
 */

// Tests for GeoLeaf.UI module - User Interface functions

describe("GeoLeaf.UI", () => {
    let UI;

    beforeEach(async () => {
        // Create DOM elements for testing
        document.body.innerHTML = `
            <div id="geoleaf-map"></div>
            <div id="filter-panel" class="gl-filter-panel"></div>
            <div id="poi-panel"></div>
        `;

        // Mock GeoLeaf namespace
        global.GeoLeaf = {
            Log: {
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
            },
            CONSTANTS: {
                MOBILE_BREAKPOINT: 768,
            },
            Config: {
                get: vi.fn().mockReturnValue(null),
                getActiveProfile: vi.fn().mockReturnValue({
                    id: "test",
                    taxonomy: {
                        categories: {},
                    },
                }),
            },
            Core: {
                getMap: vi.fn().mockReturnValue({
                    on: vi.fn(),
                    off: vi.fn(),
                }),
            },
        };

        // Mock event delegation sub-module
        global.GeoLeaf._UIEventDelegation = {
            attachAccordionEvents: vi.fn(),
            attachFilterInputEvents: vi.fn(),
            cleanupAllListeners: vi.fn().mockReturnValue(0),
        };

        vi.resetModules();
        // Phase 7 B11: capture named export
        const uiModule = await import("../../src/api/geoleaf.ui.js");
        UI = uiModule.UI || global.GeoLeaf.UI;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = "";
    });

    describe("Module structure", () => {
        it("should expose UI on GeoLeaf namespace", () => {
            expect(global.GeoLeaf.UI).toBeDefined();
        });

        it("should expose init function", () => {
            expect(typeof UI.init).toBe("function");
        });
    });

    describe("init()", () => {
        it("should initialize with default options", () => {
            expect(() => UI.init()).not.toThrow();
        });

        it("should initialize with custom options", () => {
            expect(() =>
                UI.init({
                    theme: "dark",
                    filterPanel: "#filter-panel",
                })
            ).not.toThrow();
        });

        it("should initialize without throwing on minimal config", () => {
            expect(() => UI.init({})).not.toThrow();
        });
    });
});
