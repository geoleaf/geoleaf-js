/**
 */
/* Phase 2 — filter-panel/proximity.ts → 70% */

vi.mock("../../src/utils/general/di-accessors.js", () => ({
    getLog: () => ({ warn: vi.fn(), debug: vi.fn(), info: vi.fn() }),
}));
const mockOn = vi.fn(() => vi.fn());
let _eventsRef = { on: mockOn };
vi.mock("../../src/utils/general/event-listener-manager.js", () => ({
    get events() {
        return _eventsRef;
    },
}));
vi.mock("../../src/kernel/config/geoleaf-config/config-core.js", () => ({
    Config: { get: vi.fn((key, def) => def) },
}));
// vi.hoisted(): the vi.mock() factory below closes over this binding and runs hoisted,
// before the module body evaluates it. The former require() hid the TDZ.
const GeoLocationState = vi.hoisted(() => ({
    active: false,
    watchId: null,
    userPosition: null,
}));
vi.mock("../../src/capabilities/geolocation/state.js", () => ({ GeoLocationState }));

const mockRemoveLayer = vi.fn();
// CAPACITÉS S3.4 — the former `mockCircle` / `mockMarker` doubles lived here. They were
// `vi.fn()`s never passed to any `vi.mock()`, left over from the Leaflet era (`addTo`,
// `getLatLng`), so nothing could ever call them: every `expect(mockCircle).not
// .toHaveBeenCalled()` was true by construction. The circle and marker now go through the
// adapter, so the observable is `map.addGeoJSONLayer` / `map.createMarker` — asserted directly.

import { FilterPanelProximity } from "../../src/capabilities/filter/panel/proximity/proximity.js";

// Helper to add adapter methods to map mocks (MapLibre mode)
function withAdapterMethods(map) {
    map.addGeoJSONLayer = map.addGeoJSONLayer || vi.fn();
    map.hasLayer = map.hasLayer || vi.fn(() => false);
    map.removeLayer = map.removeLayer || vi.fn();
    map.createMarker =
        map.createMarker ||
        vi.fn(() => ({
            _stub: true,
            setLngLat: vi.fn().mockReturnThis(),
            addTo: vi.fn().mockReturnThis(),
            remove: vi.fn(),
            getElement: vi.fn(() => null),
            on: vi.fn().mockReturnThis(),
        }));
    map.updateLayerData = map.updateLayerData || vi.fn();
    map.setLayerStyle = map.setLayerStyle || vi.fn();
    return map;
}

// Patch initProximityFilter to auto-add adapter methods to map mocks
const _origInit = FilterPanelProximity.initProximityFilter;
FilterPanelProximity.initProximityFilter = function (map) {
    if (map) withAdapterMethods(map);
    return _origInit.call(this, map);
};

describe("ui/filter-panel/proximity", () => {
    beforeEach(() => {
        mockOn.mockClear();
        FilterPanelProximity._eventCleanups = [];
    });

    it("initProximityFilter returns early when map null", () => {
        expect(() => FilterPanelProximity.initProximityFilter(null)).not.toThrow();
    });

    it("initProximityFilter registers event listeners when map and events available", () => {
        const map = {};
        FilterPanelProximity.initProximityFilter(map);
        expect(mockOn).toHaveBeenCalledWith(
            document,
            "input",
            expect.any(Function),
            false,
            "ProximityFilter.radiusInput"
        );
        expect(mockOn).toHaveBeenCalledWith(
            document,
            "click",
            expect.any(Function),
            false,
            "ProximityFilter.buttonClick"
        );
    });

    it("destroy runs cleanups and removes layers", () => {
        const map = { removeLayer: mockRemoveLayer, getContainer: () => ({ style: {} }) };
        FilterPanelProximity.initProximityFilter(map);
        const cleanup = vi.fn();
        FilterPanelProximity._eventCleanups.push(cleanup);
        FilterPanelProximity.destroy();
        expect(cleanup).toHaveBeenCalled();
    });

    it("toggleProximityMode toggles UI and calls deactivate when already active", () => {
        const btn = document.createElement("button");
        const container = document.createElement("div");
        container.className = "gl-filter-panel__proximity";
        const rangeWrapper = document.createElement("div");
        rangeWrapper.className = "gl-filter-panel__proximity-range";
        const instruction = document.createElement("div");
        instruction.className = "gl-filter-panel__proximity-instruction";
        container.appendChild(rangeWrapper);
        container.appendChild(instruction);
        btn.closest = () => container;
        const map = {
            removeLayer: vi.fn(),
            getContainer: () => ({ style: {} }),
            on: vi.fn(),
            off: vi.fn(),
        };
        FilterPanelProximity.toggleProximityMode(btn, map);
        expect(btn.classList.contains("gl-is-active")).toBe(true);
        FilterPanelProximity.toggleProximityMode(btn, map);
        expect(btn.classList.contains("gl-is-active")).toBe(false);
        expect(btn.textContent).toBe("Activer");
    });

    it("toggleProximityMode with recent GPS calls activateGPSMode", () => {
        GeoLocationState.userPosition = { lat: 48.8, lng: 2.3, timestamp: Date.now() - 60000 };
        const btn = document.createElement("button");
        const container = document.createElement("div");
        container.className = "gl-filter-panel__proximity";
        const rangeWrapper = document.createElement("div");
        rangeWrapper.className = "gl-filter-panel__proximity-range";
        const instruction = document.createElement("div");
        instruction.className = "gl-filter-panel__proximity-instruction";
        const radiusInput = document.createElement("input");
        radiusInput.setAttribute("data-filter-proximity-radius", "5");
        radiusInput.value = "5";
        container.appendChild(rangeWrapper);
        container.appendChild(instruction);
        container.appendChild(radiusInput);
        const wrapper = document.createElement("div");
        wrapper.setAttribute("data-gl-filter-id", "proximity");
        wrapper.appendChild(container);
        btn.closest = () => container;
        container.closest = () => wrapper;
        const map = {
            removeLayer: vi.fn(),
            getContainer: () => ({ style: {} }),
            setView: vi.fn(),
            getZoom: () => 12,
        };
        FilterPanelProximity.initProximityFilter(map);
        FilterPanelProximity.toggleProximityMode(btn, map);
        // In MapLibre mode, circle is created via adapter, not L.circle
        expect(map.addGeoJSONLayer).toHaveBeenCalled();
        GeoLocationState.userPosition = null;
    });

    it("resetProximity removes click handler and layers when map was set", () => {
        const map = { off: vi.fn(), removeLayer: vi.fn(), getContainer: () => ({ style: {} }) };
        FilterPanelProximity.initProximityFilter(map);
        FilterPanelProximity.resetProximity();
        expect(map.removeLayer).toHaveBeenCalledTimes(0);
    });

    it("deactivateProximityMode hides range and instruction and removes layers", () => {
        const btn = document.createElement("button");
        const container = document.createElement("div");
        container.className = "gl-filter-panel__proximity";
        const rangeWrapper = document.createElement("div");
        rangeWrapper.className = "gl-filter-panel__proximity-range";
        const instruction = document.createElement("div");
        instruction.className = "gl-filter-panel__proximity-instruction";
        container.appendChild(rangeWrapper);
        container.appendChild(instruction);
        const wrapper = document.createElement("div");
        wrapper.setAttribute("data-gl-filter-id", "proximity");
        wrapper.appendChild(container);
        container.closest = () => wrapper;
        const map = { removeLayer: vi.fn(), getContainer: () => ({ style: {} }) };
        FilterPanelProximity.deactivateProximityMode(btn, container, map);
        expect(rangeWrapper.style.display).toBe("none");
        expect(btn.textContent).toBe("Activer");
    });

    it("activateManualMode sets crosshair and attaches click handler", () => {
        const containerStyle = {};
        let clickHandler;
        const map = withAdapterMethods({
            getContainer: vi.fn(() => ({ style: containerStyle })),
            on: vi.fn((ev, fn) => {
                clickHandler = fn;
            }),
            off: vi.fn(),
            getZoom: () => 12,
        });
        const container = document.createElement("div");
        const radiusInput = document.createElement("input");
        radiusInput.setAttribute("data-filter-proximity-radius", "10");
        radiusInput.value = "10";
        container.appendChild(radiusInput);
        const wrapper = document.createElement("div");
        wrapper.setAttribute("data-gl-filter-id", "proximity");
        container.closest = () => wrapper;
        FilterPanelProximity.activateManualMode(container, map);
        expect(containerStyle.cursor).toBe("crosshair");
        expect(map.on).toHaveBeenCalledWith("click", expect.any(Function));
        clickHandler({ latlng: { lat: 48.5, lng: 2.1 } });
        // In MapLibre mode, circle drawn via adapter, not L.circle
        expect(map.addGeoJSONLayer).toHaveBeenCalled();
        expect(containerStyle.cursor).toBe("");
    });

    it("destroy when _proximityMap set removes layers", () => {
        const map = {
            removeLayer: vi.fn(),
            getContainer: () => ({ style: {} }),
            setView: vi.fn(),
            getZoom: () => 12,
        };
        FilterPanelProximity.initProximityFilter(map);
        FilterPanelProximity._eventCleanups = [];
        GeoLocationState.userPosition = { lat: 48, lng: 2, timestamp: Date.now() };
        const btn = document.createElement("button");
        const container = document.createElement("div");
        container.className = "gl-filter-panel__proximity";
        const rangeWrapper = document.createElement("div");
        const instruction = document.createElement("div");
        const radiusInput = document.createElement("input");
        radiusInput.value = "5";
        radiusInput.setAttribute("data-filter-proximity-radius", "5");
        container.appendChild(rangeWrapper);
        container.appendChild(instruction);
        container.appendChild(radiusInput);
        const wrapper = document.createElement("div");
        wrapper.setAttribute("data-gl-filter-id", "proximity");
        wrapper.appendChild(container);
        btn.closest = () => container;
        container.closest = () => wrapper;
        FilterPanelProximity.toggleProximityMode(btn, map);
        FilterPanelProximity.destroy();
        // In MapLibre mode, removeLayer may be called with layer IDs
        // The important thing is destroy doesn't throw
        GeoLocationState.userPosition = null;
    });

    it("input handler updates radius and circle when _proximityCircle exists", () => {
        const map = {};
        FilterPanelProximity.initProximityFilter(map);
        const inputCalls = mockOn.mock.calls.filter((c) => c[1] === "input");
        const inputHandler = inputCalls[0][2];
        const slider = document.createElement("input");
        slider.setAttribute("data-filter-proximity-radius", "10");
        slider.value = "15";
        const proximityControl = document.createElement("div");
        proximityControl.className = "gl-filter-panel__proximity";
        const wrapper = document.createElement("div");
        wrapper.setAttribute("data-gl-filter-id", "proximity");
        proximityControl.appendChild(slider);
        wrapper.appendChild(proximityControl);
        slider.closest = (sel) => {
            if (sel === "[data-filter-proximity-radius]") return slider;
            if (sel === ".gl-filter-panel__proximity") return proximityControl;
            if (sel === "[data-gl-filter-id='proximity']") return wrapper;
            return null;
        };
        proximityControl.closest = () => wrapper;
        let mapClickHandler;
        const mapWithClick = withAdapterMethods({
            getContainer: () => ({ style: {} }),
            on: vi.fn((ev, fn) => {
                mapClickHandler = fn;
            }),
            off: vi.fn(),
            getZoom: () => 12,
        });
        FilterPanelProximity.activateManualMode(proximityControl, mapWithClick);
        mapClickHandler({ latlng: { lat: 48, lng: 2 } });
        // In MapLibre mode, circle is drawn via adapter, not L.circle
        expect(mapWithClick.addGeoJSONLayer).toHaveBeenCalled();
        inputHandler({ target: slider });
        expect(wrapper.getAttribute("data-proximity-radius")).toBe("15");
    });

    it("click handler triggers toggleProximityMode when button is target", () => {
        const map = {
            getContainer: () => ({ style: {} }),
            on: vi.fn(),
            off: vi.fn(),
            removeLayer: vi.fn(),
        };
        FilterPanelProximity.initProximityFilter(map);
        const clickCalls = mockOn.mock.calls.filter((c) => c[1] === "click");
        const clickHandler = clickCalls[0][2];
        const btn = document.createElement("button");
        btn.setAttribute("data-filter-proximity-btn", "1");
        btn.closest = () => btn;
        const preventDefault = vi.fn();
        clickHandler({ target: btn, preventDefault });
        expect(preventDefault).toHaveBeenCalled();
    });

    it("activateGPSMode returns early when wrapper not found", () => {
        const container = document.createElement("div");
        container.closest = () => null;
        const map = withAdapterMethods({
            removeLayer: vi.fn(),
            getContainer: vi.fn(),
            setView: vi.fn(),
        });
        GeoLocationState.userPosition = { lat: 48, lng: 2, timestamp: Date.now() };
        FilterPanelProximity.activateGPSMode(container, map);
        expect(map.addGeoJSONLayer).not.toHaveBeenCalled();
        GeoLocationState.userPosition = null;
    });

    it("activateGPSMode with GeoLocationState.active true does not create marker", () => {
        GeoLocationState.active = true;
        GeoLocationState.userPosition = { lat: 48, lng: 2, timestamp: Date.now() };
        const wrapper = document.createElement("div");
        wrapper.setAttribute("data-gl-filter-id", "proximity");
        const container = document.createElement("div");
        const radiusInput = document.createElement("input");
        radiusInput.setAttribute("data-filter-proximity-radius", "5");
        radiusInput.value = "5";
        container.appendChild(radiusInput);
        container.closest = () => wrapper;
        const map = withAdapterMethods({
            removeLayer: vi.fn(),
            getContainer: () => ({ style: {} }),
            setView: vi.fn(),
            getZoom: () => 12,
        });
        FilterPanelProximity.activateGPSMode(container, map);
        // In MapLibre mode, circle drawn via adapter
        expect(map.addGeoJSONLayer).toHaveBeenCalled();
        // With GeoLocationState.active, no manual marker is created
        expect(map.createMarker).not.toHaveBeenCalled();
        GeoLocationState.active = false;
        GeoLocationState.userPosition = null;
    });

    it("activateGPSMode removes existing circle and marker when already set", () => {
        GeoLocationState.userPosition = { lat: 48, lng: 2, timestamp: Date.now() };
        const wrapper = document.createElement("div");
        wrapper.setAttribute("data-gl-filter-id", "proximity");
        const container = document.createElement("div");
        const radiusInput = document.createElement("input");
        radiusInput.setAttribute("data-filter-proximity-radius", "5");
        radiusInput.value = "5";
        container.appendChild(radiusInput);
        container.closest = () => wrapper;
        const map = withAdapterMethods({
            removeLayer: vi.fn(),
            getContainer: () => ({ style: {} }),
            setView: vi.fn(),
            getZoom: () => 12,
        });
        FilterPanelProximity.activateGPSMode(container, map);
        expect(map.addGeoJSONLayer).toHaveBeenCalled();
        map.hasLayer.mockReturnValue(true);
        FilterPanelProximity.activateGPSMode(container, map);
        // Second call should remove+re-add
        expect(map.removeLayer).toHaveBeenCalled();
        GeoLocationState.userPosition = null;
    });

    it("destroy skips non-function cleanups", () => {
        const map = { removeLayer: vi.fn(), getContainer: () => ({ style: {} }) };
        FilterPanelProximity.initProximityFilter(map);
        FilterPanelProximity._eventCleanups.push(null);
        FilterPanelProximity._eventCleanups.push("not-a-function");
        expect(() => FilterPanelProximity.destroy()).not.toThrow();
    });

    it("manual mode click handler when wrapper not found returns early", () => {
        const container = document.createElement("div");
        container.closest = () => null;
        const map = withAdapterMethods({
            getContainer: () => ({ style: {} }),
            on: vi.fn((ev, fn) => {
                fn({ latlng: { lat: 48, lng: 2 } });
            }),
            off: vi.fn(),
        });
        FilterPanelProximity.activateManualMode(container, map);
        expect(map.addGeoJSONLayer).not.toHaveBeenCalled();
    });

    // CAPACITÉS S3.4 — this case used to assert nothing. Its `markerInstance` was reached
    // through `mockMarker`, a `vi.fn()` never wired to any `vi.mock`, and the map double
    // exposed no way to resolve a native marker — so `_resolveNativeMarker` always returned
    // null, `dragendCb` stayed undefined and the three assertions sat behind an
    // `if (dragendCb)` that was never true. It also mocked `getLatLng()` (Leaflet) where the
    // code calls `getLngLat()` (MapLibre). Rebuilt so it genuinely exercises the drag path.
    it("manual mode dragend updates circle and wrapper attributes", () => {
        const containerStyle = {};
        let mapClickHandler;
        let dragendCb;
        const markerInstance = {
            on: vi.fn((ev, fn) => {
                if (ev === "dragend") dragendCb = fn;
                return markerInstance;
            }),
            getLngLat: () => ({ lat: 48.9, lng: 2.4 }),
        };
        const wrapper = document.createElement("div");
        wrapper.setAttribute("data-gl-filter-id", "proximity");
        const container = document.createElement("div");
        const radiusInput = document.createElement("input");
        radiusInput.setAttribute("data-filter-proximity-radius", "10");
        radiusInput.value = "10";
        container.appendChild(radiusInput);
        container.closest = () => wrapper;
        const map = withAdapterMethods({
            getContainer: () => ({ style: containerStyle }),
            on: vi.fn((ev, fn) => {
                mapClickHandler = fn;
            }),
            off: vi.fn(),
            removeLayer: vi.fn(),
            getZoom: () => 12,
            getMarkerHandle: vi.fn(() => markerInstance),
        });
        FilterPanelProximity.activateManualMode(container, map);
        mapClickHandler({ latlng: { lat: 48.5, lng: 2.1 } });
        expect(map.addGeoJSONLayer).toHaveBeenCalled();

        // The drag handler must have been bound — this is what silently did not happen.
        expect(dragendCb).toBeTypeOf("function");
        map.updateLayerData.mockClear();
        dragendCb();
        // The circle follows the marker (ProximityState.circle re-renders its polygon)…
        expect(map.updateLayerData).toHaveBeenCalled();
        // …and the wrapper carries the dragged position, read back by the filter engine.
        expect(wrapper.getAttribute("data-proximity-lat")).toBe("48.9");
        expect(wrapper.getAttribute("data-proximity-lng")).toBe("2.4");
    });

    it("deactivateProximityMode removes click handler and wrapper attributes", () => {
        const containerStyle = {};
        const map = {
            getContainer: () => ({ style: containerStyle }),
            on: vi.fn(),
            off: vi.fn(),
            removeLayer: vi.fn(),
        };
        const wrapper = document.createElement("div");
        wrapper.setAttribute("data-gl-filter-id", "proximity");
        wrapper.setAttribute("data-proximity-active", "true");
        wrapper.setAttribute("data-proximity-lat", "48");
        wrapper.setAttribute("data-proximity-lng", "2");
        const container = document.createElement("div");
        const radiusInput = document.createElement("input");
        radiusInput.setAttribute("data-filter-proximity-radius", "10");
        container.appendChild(radiusInput);
        container.closest = () => wrapper;
        const btn = document.createElement("button");
        btn.classList.add("gl-is-active");
        const rangeWrapper = document.createElement("div");
        const instruction = document.createElement("div");
        container.appendChild(rangeWrapper);
        container.appendChild(instruction);
        FilterPanelProximity.activateManualMode(container, map);
        expect(map.on).toHaveBeenCalledWith("click", expect.any(Function));
        FilterPanelProximity.deactivateProximityMode(btn, container, map);
        expect(map.off).toHaveBeenCalled();
        expect(wrapper.hasAttribute("data-proximity-active")).toBe(false);
        expect(wrapper.hasAttribute("data-proximity-lat")).toBe(false);
        expect(wrapper.hasAttribute("data-proximity-lng")).toBe(false);
    });

    it("resetProximity clears click handler, circle and marker when set", () => {
        const containerStyle = {};
        let clickHandler;
        const map = withAdapterMethods({
            getContainer: () => ({ style: containerStyle }),
            on: vi.fn((ev, fn) => {
                clickHandler = fn;
            }),
            off: vi.fn(),
            removeLayer: vi.fn(),
            getZoom: () => 12,
        });
        const wrapper = document.createElement("div");
        wrapper.setAttribute("data-gl-filter-id", "proximity");
        const container = document.createElement("div");
        const radiusInput = document.createElement("input");
        radiusInput.setAttribute("data-filter-proximity-radius", "10");
        container.appendChild(radiusInput);
        container.closest = () => wrapper;
        FilterPanelProximity.initProximityFilter(map);
        FilterPanelProximity.activateManualMode(container, map);
        clickHandler({ latlng: { lat: 48, lng: 2 } });
        map.hasLayer.mockReturnValue(true);
        FilterPanelProximity.resetProximity();
        expect(map.off).toHaveBeenCalled();
        expect(map.removeLayer).toHaveBeenCalled();
        expect(containerStyle.cursor).toBe("");
    });
});

describe("ui/filter-panel/proximity (events null fallback)", () => {
    it("initProximityFilter uses document.addEventListener when events is null", async () => {
        const addSpy = vi.spyOn(document, "addEventListener").mockImplementation(() => {});
        const prev = _eventsRef;
        _eventsRef = null;
        vi.resetModules();
        const { FilterPanelProximity: P } = await import(
            "../../src/capabilities/filter/panel/proximity/proximity.js"
        );
        const map = withAdapterMethods({
            getContainer: () => ({ style: {} }),
            on: vi.fn(),
            off: vi.fn(),
        });
        P.initProximityFilter(map);
        expect(addSpy).toHaveBeenCalledWith("input", expect.any(Function));
        expect(addSpy).toHaveBeenCalledWith("click", expect.any(Function));
        const inputHandler = addSpy.mock.calls.find((c) => c[0] === "input")[1];
        const clickHandler = addSpy.mock.calls.find((c) => c[0] === "click")[1];
        const slider = document.createElement("input");
        slider.setAttribute("data-filter-proximity-radius", "5");
        slider.value = "5";
        const proximityControl = document.createElement("div");
        proximityControl.className = "gl-filter-panel__proximity";
        const wrapper = document.createElement("div");
        wrapper.setAttribute("data-gl-filter-id", "proximity");
        proximityControl.appendChild(slider);
        wrapper.appendChild(proximityControl);
        slider.closest = (sel) =>
            sel === "[data-filter-proximity-radius]"
                ? slider
                : sel === ".gl-filter-panel__proximity"
                  ? proximityControl
                  : wrapper;
        proximityControl.closest = () => wrapper;
        inputHandler({ target: slider });
        expect(wrapper.getAttribute("data-proximity-radius")).toBe("5");
        const btn = document.createElement("button");
        btn.setAttribute("data-filter-proximity-btn", "1");
        const containerForBtn = document.createElement("div");
        containerForBtn.className = "gl-filter-panel__proximity";
        btn.closest = () => containerForBtn;
        clickHandler({ target: btn, preventDefault: vi.fn() });
        addSpy.mockRestore();
        _eventsRef = prev;
    });
});
