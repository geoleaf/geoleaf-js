/**
 * Tests pour src/capabilities/filter/panel/proximity/
 * Tests the proximity orchestrator — delegates to sub-modules.
 * Sub-module behavior (GPS circle creation, marker drag, etc.) is tested in their own files.
 */

// ProximityState is a plain mutable object — use a hoisted ref so vi.mock factory can access it
const {
    mockProximityState,
    mockActivateGPS,
    mockHasRecentGPS,
    mockActivateManual,
    mockDeactivatePanel,
    mockResetProximity,
    mockRemoveCircleAndMarker,
    mockCleanupMapElements,
    mockLog,
} = vi.hoisted(() => ({
    mockProximityState: {
        mode: false,
        circle: null,
        marker: null,
        map: null,
        clickHandler: null,
        pendingRadius: null,
        eventCleanups: [],
    },
    mockActivateGPS: vi.fn(),
    mockHasRecentGPS: vi.fn(() => false),
    mockActivateManual: vi.fn(),
    mockDeactivatePanel: vi.fn(),
    mockResetProximity: vi.fn(),
    mockRemoveCircleAndMarker: vi.fn(),
    mockCleanupMapElements: vi.fn(),
    mockLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../../src/utils/general/utils-base.js", () => ({
    getDistance: vi.fn(),
}));

// `getLog` moved to di-accessors.js at KERNEL S10 — it must be stubbed at its
// own module or the subject resolves the real logger and this mock goes silent.
vi.mock("../../../src/utils/general/di-accessors.js", () => ({
    getLog: vi.fn(() => mockLog),
}));
vi.mock("../../../src/utils/i18n/i18n.js", () => ({
    getLabel: vi.fn((key) => {
        const labels = {
            "ui.filter.disable": "Disable",
            "ui.filter.enable": "Enable",
        };
        return labels[key] ?? key;
    }),
}));
vi.mock("../../../src/utils/general/event-listener-manager.js", () => ({
    events: {
        on: vi.fn((el, evt, cb, _capture, _id) => {
            el.addEventListener(evt, cb);
            return () => el.removeEventListener(evt, cb);
        }),
    },
}));
vi.mock("../../../src/capabilities/filter/panel/proximity/proximity-state.js", () => ({
    ProximityState: mockProximityState,
}));
vi.mock("../../../src/capabilities/filter/panel/proximity/proximity-circle.js", () => ({
    removeCircleAndMarker: mockRemoveCircleAndMarker,
}));
vi.mock("../../../src/capabilities/filter/panel/proximity/proximity-gps-mode.js", () => ({
    activateGPSMode: mockActivateGPS,
    hasRecentGPS: mockHasRecentGPS,
}));
vi.mock("../../../src/capabilities/filter/panel/proximity/proximity-manual-mode.js", () => ({
    activateManualMode: mockActivateManual,
}));
vi.mock("../../../src/capabilities/filter/panel/proximity/proximity-deactivation.js", () => ({
    cleanupMapElements: mockCleanupMapElements,
    deactivatePanel: mockDeactivatePanel,
    resetProximity: mockResetProximity,
}));

describe("GeoLeaf.UI.FilterPanel.Proximity", () => {
    let mockMap;
    let mockCircle;

    beforeEach(async () => {
        vi.clearAllMocks();

        // Reset ProximityState to initial values
        Object.assign(mockProximityState, {
            mode: false,
            circle: null,
            marker: null,
            map: null,
            clickHandler: null,
            pendingRadius: null,
            eventCleanups: [],
        });

        // Restore default mock behaviors after clearAllMocks
        mockHasRecentGPS.mockReturnValue(false);
        const genUtils = await import("../../../src/utils/general/di-accessors.js");
        genUtils.getLog.mockReturnValue(mockLog);

        mockCircle = { setRadius: vi.fn(), setLatLng: vi.fn() };

        mockMap = {
            removeLayer: vi.fn(),
            setView: vi.fn(),
            getZoom: vi.fn(() => 12),
            on: vi.fn(),
            off: vi.fn(),
            getContainer: vi.fn(() => {
                const div = document.createElement("div");
                div.style.cursor = "default";
                return div;
            }),
        };

        global.GeoLeaf = {
            Log: mockLog,
            Config: { get: vi.fn(() => false) },
            UI: {},
            _UIFilterPanelProximity: {},
        };

        vi.resetModules();
        const m = await import("../../../src/capabilities/filter/panel/proximity/proximity.js");
        global.GeoLeaf._UIFilterPanelProximity = m.FilterPanelProximity;
    });

    afterEach(() => {
        // Remove any document-level event listeners added during tests
        mockProximityState.eventCleanups.forEach((c) => typeof c === "function" && c());
        mockProximityState.eventCleanups = [];
        delete global.GeoLeaf;
        document.body.innerHTML = "";
        vi.clearAllMocks();
    });

    describe("initProximityFilter()", () => {
        test("should initialize ProximityState and log info", () => {
            GeoLeaf._UIFilterPanelProximity.initProximityFilter(mockMap);

            expect(mockProximityState.mode).toBe(false);
            expect(mockProximityState.circle).toBe(null);
            expect(mockProximityState.marker).toBe(null);
            expect(mockProximityState.map).toBe(mockMap);
            expect(mockLog.info).toHaveBeenCalledWith(
                expect.stringContaining("Proximity filter initialized")
            );
        });

        test("should warn and return when map not provided", () => {
            GeoLeaf._UIFilterPanelProximity.initProximityFilter(null);

            expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("Map not available"));
            expect(mockProximityState.map).toBe(null);
        });

        test("should wire document input listener for radius slider", () => {
            document.body.innerHTML = `
                <div data-gl-filter-id="proximity">
                    <div class="gl-filter-panel__proximity">
                        <input type="range" data-filter-proximity-radius value="10" />
                    </div>
                </div>
            `;

            GeoLeaf._UIFilterPanelProximity.initProximityFilter(mockMap);
            // Set circle on ProximityState so setRadius is called
            mockProximityState.circle = mockCircle;

            const slider = document.querySelector("[data-filter-proximity-radius]");
            slider.value = "15";
            slider.dispatchEvent(new Event("input", { bubbles: true }));

            const wrapper = document.querySelector('[data-gl-filter-id="proximity"]');
            expect(wrapper.getAttribute("data-proximity-radius")).toBe("15");
            expect(mockCircle.setRadius).toHaveBeenCalledWith(15000);
        });

        test("should wire document click listener for proximity button", () => {
            document.body.innerHTML = `
                <div data-gl-filter-id="proximity">
                    <div class="gl-filter-panel__proximity">
                        <button data-filter-proximity-btn>Activer</button>
                        <div class="gl-filter-panel__proximity-range" style="display:none"></div>
                        <div class="gl-filter-panel__proximity-instruction" style="display:none"></div>
                    </div>
                </div>
            `;

            GeoLeaf._UIFilterPanelProximity.initProximityFilter(mockMap);

            const btn = document.querySelector("[data-filter-proximity-btn]");
            btn.click();

            // Click toggles mode ON → delegates to activateManualMode (hasRecentGPS = false)
            expect(mockProximityState.mode).toBe(true);
            expect(mockActivateManual).toHaveBeenCalled();
        });
    });

    describe("destroy()", () => {
        test("should call removeCircleAndMarker and reset state", () => {
            mockProximityState.map = mockMap;
            mockProximityState.mode = true;

            GeoLeaf._UIFilterPanelProximity.destroy();

            expect(mockRemoveCircleAndMarker).toHaveBeenCalledWith(mockMap);
            expect(mockProximityState.map).toBe(null);
            expect(mockProximityState.mode).toBe(false);
        });

        test("should call cleanup functions from eventCleanups", () => {
            const cleanup1 = vi.fn();
            const cleanup2 = vi.fn();
            mockProximityState.eventCleanups = [cleanup1, cleanup2];

            GeoLeaf._UIFilterPanelProximity.destroy();

            expect(cleanup1).toHaveBeenCalled();
            expect(cleanup2).toHaveBeenCalled();
            expect(mockProximityState.eventCleanups).toEqual([]);
        });

        test("should not throw when map is null", () => {
            mockProximityState.map = null;
            expect(() => GeoLeaf._UIFilterPanelProximity.destroy()).not.toThrow();
            expect(mockRemoveCircleAndMarker).not.toHaveBeenCalled();
        });
    });

    describe("toggleProximityMode()", () => {
        test("should toggle ProximityState.mode and call activateGPSMode when GPS recent", () => {
            document.body.innerHTML = `
                <div data-gl-filter-id="proximity">
                    <div class="gl-filter-panel__proximity">
                        <button data-filter-proximity-btn>Activer</button>
                        <input type="range" data-filter-proximity-radius value="10" />
                        <div class="gl-filter-panel__proximity-range" style="display:none"></div>
                        <div class="gl-filter-panel__proximity-instruction" style="display:none"></div>
                    </div>
                </div>
            `;

            mockHasRecentGPS.mockReturnValue(true);
            const btn = document.querySelector("[data-filter-proximity-btn]");

            GeoLeaf._UIFilterPanelProximity.toggleProximityMode(btn, mockMap);

            expect(mockProximityState.mode).toBe(true);
            expect(mockActivateGPS).toHaveBeenCalled();
            expect(btn.classList.contains("gl-is-active")).toBe(true);
        });

        test("should call activateManualMode when no recent GPS", () => {
            document.body.innerHTML = `
                <div data-gl-filter-id="proximity">
                    <div class="gl-filter-panel__proximity">
                        <button data-filter-proximity-btn>Activer</button>
                        <input type="range" data-filter-proximity-radius value="10" />
                        <div class="gl-filter-panel__proximity-range" style="display:none"></div>
                        <div class="gl-filter-panel__proximity-instruction" style="display:none"></div>
                    </div>
                </div>
            `;

            mockHasRecentGPS.mockReturnValue(false);
            const btn = document.querySelector("[data-filter-proximity-btn]");

            GeoLeaf._UIFilterPanelProximity.toggleProximityMode(btn, mockMap);

            expect(mockProximityState.mode).toBe(true);
            expect(mockActivateManual).toHaveBeenCalled();
        });

        test("should call deactivatePanel when toggling OFF", () => {
            document.body.innerHTML = `
                <div class="gl-filter-panel__proximity">
                    <button data-filter-proximity-btn class="gl-is-active">Disable</button>
                    <div class="gl-filter-panel__proximity-range"></div>
                    <div class="gl-filter-panel__proximity-instruction"></div>
                </div>
            `;

            mockProximityState.mode = true; // Start in active state
            const btn = document.querySelector("[data-filter-proximity-btn]");
            const container = document.querySelector(".gl-filter-panel__proximity");

            GeoLeaf._UIFilterPanelProximity.toggleProximityMode(btn, mockMap);

            expect(mockProximityState.mode).toBe(false);
            expect(mockDeactivatePanel).toHaveBeenCalledWith(btn, container, mockMap);
        });
    });

    describe("activateGPSMode() — orchestrator delegation", () => {
        test("should delegate to sub-module activateGPSMode with wrapper", () => {
            document.body.innerHTML = `
                <div data-gl-filter-id="proximity">
                    <div class="gl-filter-panel__proximity">
                        <input type="range" data-filter-proximity-radius value="5" />
                    </div>
                </div>
            `;

            const container = document.querySelector(".gl-filter-panel__proximity");
            GeoLeaf._UIFilterPanelProximity.activateGPSMode(container, mockMap);

            const wrapper = document.querySelector('[data-gl-filter-id="proximity"]');
            expect(mockActivateGPS).toHaveBeenCalledWith(mockMap, wrapper, 5);
        });

        test("should return early when wrapper not found", () => {
            document.body.innerHTML = `<div class="gl-filter-panel__proximity"></div>`;
            const container = document.querySelector(".gl-filter-panel__proximity");

            GeoLeaf._UIFilterPanelProximity.activateGPSMode(container, mockMap);

            expect(mockActivateGPS).not.toHaveBeenCalled();
        });
    });

    describe("activateManualMode() — orchestrator delegation", () => {
        test("should delegate to sub-module activateManualMode with wrapper", () => {
            document.body.innerHTML = `
                <div data-gl-filter-id="proximity">
                    <div class="gl-filter-panel__proximity">
                        <input type="range" data-filter-proximity-radius value="8" />
                    </div>
                </div>
            `;

            const container = document.querySelector(".gl-filter-panel__proximity");
            GeoLeaf._UIFilterPanelProximity.activateManualMode(container, mockMap);

            const wrapper = document.querySelector('[data-gl-filter-id="proximity"]');
            expect(mockActivateManual).toHaveBeenCalledWith(mockMap, wrapper, expect.any(Function));
        });
    });

    describe("deactivateProximityMode()", () => {
        test("should delegate to deactivatePanel sub-module", () => {
            const btn = document.createElement("button");
            const container = document.createElement("div");

            GeoLeaf._UIFilterPanelProximity.deactivateProximityMode(btn, container, mockMap);

            expect(mockDeactivatePanel).toHaveBeenCalledWith(btn, container, mockMap);
        });
    });

    describe("resetProximity", () => {
        test("should be the resetProximity function from the deactivation sub-module", () => {
            expect(GeoLeaf._UIFilterPanelProximity.resetProximity).toBe(mockResetProximity);
        });
    });

    describe("setProximityRadius()", () => {
        test("should update pendingRadius and wrapper attribute", () => {
            document.body.innerHTML = `<div id="gl-proximity-toolbar-wrapper" data-gl-filter-id="proximity"></div>`;

            GeoLeaf._UIFilterPanelProximity.setProximityRadius(15);

            expect(mockProximityState.pendingRadius).toBe(15);
            const wrapper = document.getElementById("gl-proximity-toolbar-wrapper");
            expect(wrapper.getAttribute("data-proximity-radius")).toBe("15");
        });

        test("should update circle radius when mode is active and circle exists", () => {
            mockProximityState.mode = true;
            mockProximityState.circle = mockCircle;

            GeoLeaf._UIFilterPanelProximity.setProximityRadius(20);

            expect(mockCircle.setRadius).toHaveBeenCalledWith(20000);
        });

        test("should not call setRadius when mode is inactive", () => {
            mockProximityState.mode = false;
            mockProximityState.circle = mockCircle;

            GeoLeaf._UIFilterPanelProximity.setProximityRadius(10);

            expect(mockCircle.setRadius).not.toHaveBeenCalled();
        });
    });

    describe("toggleProximityToolbar()", () => {
        test("should toggle mode ON and call activateManualMode when no GPS", () => {
            mockHasRecentGPS.mockReturnValue(false);

            const result = GeoLeaf._UIFilterPanelProximity.toggleProximityToolbar(mockMap, 10);

            expect(mockProximityState.mode).toBe(true);
            expect(result).toBe(true);
            expect(mockActivateManual).toHaveBeenCalled();
        });

        test("should toggle mode ON and call activateGPSMode when GPS recent", () => {
            mockHasRecentGPS.mockReturnValue(true);

            GeoLeaf._UIFilterPanelProximity.toggleProximityToolbar(mockMap, 5);

            expect(mockActivateGPS).toHaveBeenCalled();
        });

        test("should toggle mode OFF and call cleanupMapElements", () => {
            mockProximityState.mode = true;

            const result = GeoLeaf._UIFilterPanelProximity.toggleProximityToolbar(mockMap, 10);

            expect(mockProximityState.mode).toBe(false);
            expect(result).toBe(false);
            expect(mockCleanupMapElements).toHaveBeenCalledWith(mockMap);
        });

        test("should create and reuse gl-proximity-toolbar-wrapper in DOM", () => {
            GeoLeaf._UIFilterPanelProximity.toggleProximityToolbar(mockMap, 10);

            const wrapper = document.getElementById("gl-proximity-toolbar-wrapper");
            expect(wrapper).not.toBeNull();
            expect(wrapper.getAttribute("data-gl-filter-id")).toBe("proximity");
        });
    });

    describe("_eventCleanups proxy", () => {
        test("should proxy to ProximityState.eventCleanups", () => {
            mockProximityState.eventCleanups = [];
            GeoLeaf._UIFilterPanelProximity._eventCleanups = ["fn1"];
            expect(mockProximityState.eventCleanups).toEqual(["fn1"]);
            expect(GeoLeaf._UIFilterPanelProximity._eventCleanups).toEqual(["fn1"]);
        });
    });
});
