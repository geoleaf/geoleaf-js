/**
 * Unit tests for MaplibreAdapter — Sprint 2.
 *
 * Init, view/navigation, events, controls, utilities, getNativeMap.
 * Layers, markers, clusters, popups → maplibre-adapter-layers.test.js
 *
 */

vi.mock("../../src/kernel/events/event-bus.js", () => ({
    dispatchGeoLeafEvent: vi.fn(),
}));

import { MaplibreAdapter } from "../../src/adapters/maplibre/maplibre-adapter.js";
import { dispatchGeoLeafEvent } from "../../src/kernel/events/event-bus.js";

// ── Mock MapLibre GL ─────────────────────────────────────────────────────────

let mockMapInstance;

beforeEach(() => {
    mockMapInstance = {
        on: vi.fn(),
        off: vi.fn(),
        once: vi.fn(),
        remove: vi.fn(),
        getCenter: vi.fn().mockReturnValue({ lat: 45, lng: -73 }),
        getZoom: vi.fn().mockReturnValue(10),
        getBounds: vi.fn().mockReturnValue({
            getSouthWest: () => ({ lat: 44, lng: -74 }),
            getNorthEast: () => ({ lat: 46, lng: -72 }),
        }),
        jumpTo: vi.fn(),
        easeTo: vi.fn(),
        flyTo: vi.fn(),
        fitBounds: vi.fn(),
        getContainer: vi.fn().mockReturnValue(document.createElement("div")),
        getCanvas: vi.fn().mockReturnValue({ style: { cursor: "" } }),
        project: vi.fn().mockReturnValue({ x: 100, y: 200 }),
        unproject: vi.fn().mockReturnValue({ lat: 45, lng: -73 }),
        resize: vi.fn(),
        addControl: vi.fn(),
        removeControl: vi.fn(),
        addSource: vi.fn(),
        addLayer: vi.fn(),
        getLayer: vi.fn(() => null),
        setLayerZoomRange: vi.fn(),
    };

    globalThis.maplibregl = {
        // Vitest 4: a mock invoked with `new` (constructor) cannot use mockReturnValue
        // nor an arrow mockImplementation. Use a class whose constructor returns the
        // fake instance (the adapter calls `new maplibregl.Map(...)`).
        Map: vi.fn().mockImplementation(
            class {
                constructor() {
                    return mockMapInstance;
                }
            }
        ),
    };
});

afterEach(() => {
    delete globalThis.maplibregl;
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function createAdapter() {
    return new MaplibreAdapter();
}

function createInitedAdapter() {
    const adapter = createAdapter();
    adapter.init({ container: "map", center: { lat: 45, lng: -73 }, zoom: 12 });
    return adapter;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("MaplibreAdapter (Sprint 2)", () => {
    describe("Initialisation", () => {
        it("init creates a maplibregl.Map instance", () => {
            const adapter = createInitedAdapter();
            expect(globalThis.maplibregl.Map).toHaveBeenCalledTimes(1);
            expect(adapter.isReady()).toBe(true);
        });

        it("double init throws", () => {
            const adapter = createInitedAdapter();
            expect(() => adapter.init({ container: "map" })).toThrow(
                "MaplibreAdapter: init() has already been called."
            );
        });

        it("isReady returns false before init", () => {
            expect(createAdapter().isReady()).toBe(false);
        });

        it("isReady returns true after init", () => {
            expect(createInitedAdapter().isReady()).toBe(true);
        });

        it("destroy cleans up and sets isReady to false", () => {
            const adapter = createInitedAdapter();
            adapter.destroy();
            expect(mockMapInstance.remove).toHaveBeenCalled();
            expect(adapter.isReady()).toBe(false);
        });

        it("destroy deregisters named event handlers before remove", () => {
            const adapter = createInitedAdapter();
            adapter.destroy();
            expect(mockMapInstance.off).toHaveBeenCalledWith("load", expect.any(Function));
            expect(mockMapInstance.off).toHaveBeenCalledWith("zoomstart", expect.any(Function));
            expect(mockMapInstance.off).toHaveBeenCalledWith("zoomend", expect.any(Function));
            expect(mockMapInstance.off).toHaveBeenCalledWith("moveend", expect.any(Function));
        });

        it("destroy clears the event-handler wrapper map", () => {
            const adapter = createInitedAdapter();
            adapter.on("click", vi.fn());
            adapter.on("mousemove", vi.fn());
            expect(adapter._wrapperMap.size).toBe(2);
            adapter.destroy();
            expect(adapter._wrapperMap.size).toBe(0);
        });

        // Regression — one handler on two events (the scale control does exactly this:
        // `updateScale` on both `zoomend` and `moveend`). A handler-only wrapper key made
        // the second `on()` overwrite the first wrapper, so BOTH listeners survived off().
        it("off() removes the right wrapper when one handler is bound to two events", () => {
            const adapter = createInitedAdapter();
            const handler = vi.fn();

            // init() already binds its own zoomend/moveend handlers — start from a clean
            // slate so the filter below sees only OUR two registrations.
            mockMapInstance.on.mockClear();
            adapter.on("zoomend", handler);
            adapter.on("moveend", handler);

            const onCalls = mockMapInstance.on.mock.calls.filter(
                (c) => c[0] === "zoomend" || c[0] === "moveend"
            );
            expect(onCalls).toHaveLength(2);
            const zoomWrapper = onCalls.find((c) => c[0] === "zoomend")[1];
            const moveWrapper = onCalls.find((c) => c[0] === "moveend")[1];
            // Each registration must get its OWN wrapper, else one is unreachable.
            expect(zoomWrapper).not.toBe(moveWrapper);

            mockMapInstance.off.mockClear();
            adapter.off("zoomend", handler);
            adapter.off("moveend", handler);

            // Both wrappers actually handed back to map.off — no leak.
            expect(mockMapInstance.off).toHaveBeenCalledWith("zoomend", zoomWrapper);
            expect(mockMapInstance.off).toHaveBeenCalledWith("moveend", moveWrapper);
            expect(adapter._wrapperMap.size).toBe(0);
        });

        it("off() on one event keeps the same handler's other event bound", () => {
            const adapter = createInitedAdapter();
            const handler = vi.fn();

            adapter.on("zoomend", handler);
            adapter.on("moveend", handler);
            adapter.off("zoomend", handler);

            // The handler still has a live `moveend` registration → entry must survive.
            expect(adapter._wrapperMap.size).toBe(1);
            expect(adapter._wrapperMap.get(handler).has("moveend")).toBe(true);
            expect(adapter._wrapperMap.get(handler).has("zoomend")).toBe(false);
        });

        it("methods throw after destroy", () => {
            const adapter = createInitedAdapter();
            adapter.destroy();
            expect(() => adapter.getCenter()).toThrow("map is not ready");
        });

        it("init with bounds calls fitBounds on map", () => {
            const adapter = createAdapter();
            adapter.init({
                container: "map",
                bounds: { north: 46, south: 44, east: -72, west: -74 },
            });
            expect(mockMapInstance.fitBounds).toHaveBeenCalledWith(
                [
                    [-74, 44],
                    [-72, 46],
                ],
                { animate: false }
            );
        });
    });

    // S5/N-1b — le moteur porte la fenêtre d'échelle. La plage doit atteindre TOUTES les
    // sous-couches, clusters compris : ils sont enregistrés via `customSubLayerIds` et
    // n'apparaissent donc pas dans `subLayerTypes` (le piège qui fait que `applyLayerStyle`
    // ne re-style jamais un cluster).
    describe("setLayerZoomRange", () => {
        let adapter;
        beforeEach(() => {
            adapter = createInitedAdapter();
            mockMapInstance.getLayer = vi.fn(() => ({}));
            adapter._layerRegistry.getSubLayerIds = vi.fn(() => [
                "gl-lyr-circle",
                "gl-lyr-clusters",
                "gl-lyr-cluster-count",
            ]);
        });

        it("pose la plage sur chaque sous-couche, clusters inclus", () => {
            adapter.setLayerZoomRange("lyr", 6, 18);
            expect(mockMapInstance.setLayerZoomRange).toHaveBeenCalledTimes(3);
            expect(mockMapInstance.setLayerZoomRange).toHaveBeenCalledWith(
                "gl-lyr-clusters",
                6,
                18
            );
        });

        it("traduit null en bornes MapLibre par défaut (= pas de contrainte)", () => {
            adapter.setLayerZoomRange("lyr", null, null);
            expect(mockMapInstance.setLayerZoomRange).toHaveBeenCalledWith("gl-lyr-circle", 0, 24);
        });

        it("ignore les sous-couches absentes de la carte", () => {
            mockMapInstance.getLayer = vi.fn(() => null);
            adapter.setLayerZoomRange("lyr", 6, 18);
            expect(mockMapInstance.setLayerZoomRange).not.toHaveBeenCalled();
        });
    });

    describe("View / Navigation", () => {
        let adapter;
        beforeEach(() => {
            adapter = createInitedAdapter();
        });

        it("setView calls jumpTo with center and zoom", () => {
            adapter.setView({ lat: 46, lng: -74 }, 8);
            expect(mockMapInstance.jumpTo).toHaveBeenCalledWith({ center: [-74, 46], zoom: 8 });
        });

        it("getCenter returns { lat, lng }", () => {
            expect(adapter.getCenter()).toEqual({ lat: 45, lng: -73 });
        });

        it("getZoom returns numeric zoom", () => {
            expect(adapter.getZoom()).toBe(10);
        });

        it("setZoom calls jumpTo with zoom only", () => {
            adapter.setZoom(5);
            expect(mockMapInstance.jumpTo).toHaveBeenCalledWith({ zoom: 5 });
        });

        it("panTo calls easeTo with center", () => {
            adapter.panTo({ lat: 46, lng: -74 });
            expect(mockMapInstance.easeTo).toHaveBeenCalledWith({ center: [-74, 46] });
        });

        it("flyTo calls map.flyTo with center", () => {
            adapter.flyTo({ lat: 46, lng: -74 });
            expect(mockMapInstance.flyTo).toHaveBeenCalledWith({ center: [-74, 46] });
        });

        it("flyTo with zoom includes zoom in options", () => {
            adapter.flyTo({ lat: 46, lng: -74 }, 15);
            expect(mockMapInstance.flyTo).toHaveBeenCalledWith({ center: [-74, 46], zoom: 15 });
        });

        it("fitBounds converts GeoLeafBounds to MapLibre format", () => {
            adapter.fitBounds({ north: 46, south: 44, east: -72, west: -74 });
            expect(mockMapInstance.fitBounds).toHaveBeenCalledWith(
                [
                    [-74, 44],
                    [-72, 46],
                ],
                {}
            );
        });

        it("fitBounds with padding maps GeoLeafPoint to uniform padding", () => {
            adapter.fitBounds(
                { north: 46, south: 44, east: -72, west: -74 },
                { padding: { x: 10, y: 20 } }
            );
            expect(mockMapInstance.fitBounds).toHaveBeenCalledWith(
                [
                    [-74, 44],
                    [-72, 46],
                ],
                { padding: { top: 20, bottom: 20, left: 10, right: 10 } }
            );
        });

        it("fitBounds with animate false forwards animate to MapLibre", () => {
            adapter.fitBounds(
                { north: 46, south: 44, east: -72, west: -74 },
                { padding: { x: 10, y: 20 }, animate: false }
            );
            expect(mockMapInstance.fitBounds).toHaveBeenCalledWith(
                [
                    [-74, 44],
                    [-72, 46],
                ],
                { padding: { top: 20, bottom: 20, left: 10, right: 10 }, animate: false }
            );
        });

        it("getBounds returns { north, south, east, west }", () => {
            expect(adapter.getBounds()).toEqual({ north: 46, south: 44, east: -72, west: -74 });
        });
    });

    describe("Events", () => {
        let adapter;
        beforeEach(() => {
            adapter = createInitedAdapter();
        });

        it("on forwards to map.on", () => {
            adapter.on("click", vi.fn());
            expect(mockMapInstance.on).toHaveBeenCalledWith("click", expect.any(Function));
        });

        it("off forwards to map.off", () => {
            const handler = vi.fn();
            adapter.off("click", handler);
            expect(mockMapInstance.off).toHaveBeenCalledWith("click", handler);
        });

        it("once forwards to map.once", () => {
            const handler = vi.fn();
            adapter.once("click", handler);
            expect(mockMapInstance.once).toHaveBeenCalledWith("click", handler);
        });
    });

    describe("Controls", () => {
        let adapter;
        beforeEach(() => {
            adapter = createInitedAdapter();
        });

        it("addControl wraps HTMLElement in IControl", () => {
            const el = document.createElement("div");
            adapter.addControl(el, "topright");
            expect(mockMapInstance.addControl).toHaveBeenCalledWith(
                expect.objectContaining({
                    onAdd: expect.any(Function),
                    onRemove: expect.any(Function),
                }),
                "top-right"
            );
        });

        it("addControl returns a GeoLeafControl with remove()", () => {
            const ctrl = adapter.addControl(document.createElement("div"), "topleft");
            expect(ctrl.position).toBe("topleft");
            expect(typeof ctrl.remove).toBe("function");
        });

        it("removeControl calls control.remove()", () => {
            const removeFn = vi.fn();
            adapter.removeControl({ position: "topright", remove: removeFn });
            expect(removeFn).toHaveBeenCalled();
        });

        it("wrapped IControl onAdd returns the element", () => {
            const el = document.createElement("div");
            adapter.addControl(el, "topright");
            const wrapped = mockMapInstance.addControl.mock.calls[0][0];
            expect(wrapped.onAdd()).toBe(el);
        });
    });

    describe("Utilities", () => {
        let adapter;
        beforeEach(() => {
            adapter = createInitedAdapter();
        });

        it("latLngToPoint returns { x, y }", () => {
            expect(adapter.latLngToPoint({ lat: 45, lng: -73 })).toEqual({ x: 100, y: 200 });
        });

        it("pointToLatLng returns { lat, lng }", () => {
            expect(adapter.pointToLatLng({ x: 100, y: 200 })).toEqual({ lat: 45, lng: -73 });
        });

        it("getContainer returns the map container element", () => {
            expect(adapter.getContainer()).toBeInstanceOf(HTMLElement);
        });
    });

    describe("getNativeMap", () => {
        it("returns null before init", () => {
            expect(createAdapter().getNativeMap()).toBeNull();
        });

        it("returns map instance after init", () => {
            expect(createInitedAdapter().getNativeMap()).toBe(mockMapInstance);
        });

        it("returns null after destroy", () => {
            const adapter = createInitedAdapter();
            adapter.destroy();
            expect(adapter.getNativeMap()).toBeNull();
        });
    });
});

// ─── S5.6 — Internal event handler branch coverage ───────────────────────────

describe("MaplibreAdapter — internal event handlers (S5.6)", () => {
    let adapter;

    beforeEach(() => {
        adapter = createInitedAdapter();
    });

    it("_handleZoomStart invokes getZoom and stores prevZoom", () => {
        const call = mockMapInstance.on.mock.calls.find((c) => c[0] === "zoomstart");
        expect(call).toBeDefined();
        mockMapInstance.getZoom.mockReturnValue(8);
        expect(() => call[1]()).not.toThrow();
        expect(mockMapInstance.getZoom).toHaveBeenCalled();
    });

    it("_handleZoomEnd dispatches geoleaf:map:zoom with zoom and center", () => {
        const call = mockMapInstance.on.mock.calls.find((c) => c[0] === "zoomend");
        expect(call).toBeDefined();
        call[1]();
        expect(dispatchGeoLeafEvent).toHaveBeenCalledWith(
            "geoleaf:map:zoom",
            expect.objectContaining({ zoom: expect.any(Number) })
        );
    });

    it("_handleMoveEnd dispatches geoleaf:map:move with center and zoom", () => {
        const call = mockMapInstance.on.mock.calls.find((c) => c[0] === "moveend");
        expect(call).toBeDefined();
        call[1]();
        expect(dispatchGeoLeafEvent).toHaveBeenCalledWith(
            "geoleaf:map:move",
            expect.objectContaining({ center: expect.any(Object) })
        );
    });

    it("_handleZoomEnd is a no-op when map is null (after destroy)", () => {
        const call = mockMapInstance.on.mock.calls.find((c) => c[0] === "zoomend");
        adapter.destroy();
        expect(() => call[1]()).not.toThrow();
    });

    it("_handleMoveEnd is a no-op when map is null (after destroy)", () => {
        const call = mockMapInstance.on.mock.calls.find((c) => c[0] === "moveend");
        adapter.destroy();
        expect(() => call[1]()).not.toThrow();
    });
});

// ─── S5.6 — on/off lngLat wrapper branch coverage ────────────────────────────

describe("MaplibreAdapter — on/off lngLat wrapper (S5.6)", () => {
    let adapter;

    beforeEach(() => {
        adapter = createInitedAdapter();
    });

    it("on() wraps handler: injects latlng from lngLat", () => {
        const handler = vi.fn();
        adapter.on("click", handler);
        const clickCalls = mockMapInstance.on.mock.calls.filter((c) => c[0] === "click");
        const wrapped = clickCalls[clickCalls.length - 1][1];
        const e = { lngLat: { lng: -73, lat: 45 } };
        wrapped(e);
        expect(handler).toHaveBeenCalledWith(e);
        expect(e.latlng).toEqual({ lat: 45, lng: -73 });
    });

    it("on() does not overwrite an existing latlng property", () => {
        const handler = vi.fn();
        adapter.on("click", handler);
        const clickCalls = mockMapInstance.on.mock.calls.filter((c) => c[0] === "click");
        const wrapped = clickCalls[clickCalls.length - 1][1];
        const existing = { lat: 99, lng: 99 };
        const e = { lngLat: { lng: -73, lat: 45 }, latlng: existing };
        wrapped(e);
        expect(e.latlng).toBe(existing);
    });

    it("off() passes the memoized wrapper, not the original handler", () => {
        const handler = vi.fn();
        adapter.on("click", handler);
        adapter.off("click", handler);
        const offCalls = mockMapInstance.off.mock.calls.filter((c) => c[0] === "click");
        const passedFn = offCalls[offCalls.length - 1][1];
        expect(passedFn).not.toBe(handler);
        expect(typeof passedFn).toBe("function");
    });

    it("off() falls back to the original handler when no wrapper exists", () => {
        const handler = vi.fn();
        adapter.off("click", handler);
        const offCalls = mockMapInstance.off.mock.calls.filter((c) => c[0] === "click");
        const passedFn = offCalls[offCalls.length - 1][1];
        expect(passedFn).toBe(handler);
    });
});

// ─── S5.6 — Double destroy ───────────────────────────────────────────────────

describe("MaplibreAdapter — double destroy (S5.6)", () => {
    it("second destroy() is a no-op and does not throw", () => {
        const adapter = createInitedAdapter();
        adapter.destroy();
        expect(() => adapter.destroy()).not.toThrow();
    });
});
