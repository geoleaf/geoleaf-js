/**
 * Unit tests for MaplibreAdapter — Sprints 4 + 5.
 *
 * Layers, popups, sentinel, getLayerRegistry, markers, clusters, filtering.
 *
 * Extracted from maplibre-adapter.test.js to stay under 700 lines.
 *
 */

vi.mock("../../src/kernel/events/event-bus.js", () => ({
    dispatchGeoLeafEvent: vi.fn(),
}));

vi.mock("../../src/kernel/security/dom-security.js", () => ({
    DOMSecurity: {
        setSafeHTML: vi.fn((el, html) => {
            el.innerHTML = html;
        }),
        setTextContent: vi.fn((el, text) => {
            el.textContent = text;
        }),
    },
}));

// Mock canvas 2D context — jsdom does not implement getContext('2d').
// Required for setLayerStyle hatch tests that call registerHatchPattern → generateHatchImage.
const _mockHatchCtx = {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    rotate: vi.fn(),
    translate: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(16), width: 4, height: 4 })),
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    lineCap: "butt",
};
HTMLCanvasElement.prototype.getContext = vi.fn(() => _mockHatchCtx);

import { MaplibreAdapter } from "../../src/adapters/maplibre/maplibre-adapter.js";
import { DOMSecurity } from "../../src/kernel/security/dom-security.js";

// ── Mock MapLibre GL ─────────────────────────────────────────────────────────

let mockMapInstance;

beforeEach(() => {
    const _sources = {};
    const _layers = {};
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
        addSource: vi.fn((id, config) => {
            _sources[id] = { id, ...config, setData: vi.fn() };
        }),
        removeSource: vi.fn((id) => {
            delete _sources[id];
        }),
        getSource: vi.fn((id) => _sources[id] || null),
        addLayer: vi.fn((layerDef) => {
            _layers[layerDef.id] = layerDef;
        }),
        removeLayer: vi.fn((id) => {
            delete _layers[id];
        }),
        getLayer: vi.fn((id) => _layers[id] || null),
        setLayoutProperty: vi.fn(),
        setPaintProperty: vi.fn(),
        setFilter: vi.fn(),
        addImage: vi.fn(),
        removeImage: vi.fn(),
        hasImage: vi.fn().mockReturnValue(false),
        loaded: vi.fn().mockReturnValue(true),
        isStyleLoaded: vi.fn().mockReturnValue(true),
    };

    const mockMarkerInstance = {
        setLngLat: vi.fn().mockReturnThis(),
        addTo: vi.fn().mockReturnThis(),
        remove: vi.fn().mockReturnThis(),
        getElement: vi.fn(() => document.createElement("div")),
    };

    const mockPopupInstance = {
        setHTML: vi.fn().mockReturnThis(),
        setDOMContent: vi.fn().mockReturnThis(),
        setLngLat: vi.fn().mockReturnThis(),
        addTo: vi.fn().mockReturnThis(),
        remove: vi.fn().mockReturnThis(),
        once: vi.fn(),
        on: vi.fn(),
    };

    globalThis.maplibregl = {
        // Vitest 4: mocks invoked with `new` cannot use mockReturnValue nor an arrow
        // mockImplementation. Use a class whose constructor returns the fake instance
        // (the adapter calls `new maplibregl.Map/Marker/Popup(...)`).
        Map: vi.fn().mockImplementation(
            class {
                constructor() {
                    return mockMapInstance;
                }
            }
        ),
        Marker: vi.fn().mockImplementation(
            class {
                constructor() {
                    return mockMarkerInstance;
                }
            }
        ),
        Popup: vi.fn().mockImplementation(
            class {
                constructor() {
                    return mockPopupInstance;
                }
            }
        ),
    };
});

afterEach(() => {
    delete globalThis.maplibregl;
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function createInitedAdapter() {
    const adapter = new MaplibreAdapter();
    adapter.init({ container: "map", center: { lat: 45, lng: -73 }, zoom: 12 });
    return adapter;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("MaplibreAdapter — Layers", () => {
    describe("addGeoJSONLayer", () => {
        let adapter;
        beforeEach(() => {
            adapter = createInitedAdapter();
        });

        it("adds source and sub-layers for polygon data", () => {
            const data = {
                type: "FeatureCollection",
                features: [{ geometry: { type: "Polygon" } }],
            };
            adapter.addGeoJSONLayer("parks", data, { fillColor: "#0f0" });

            expect(mockMapInstance.addSource).toHaveBeenCalledWith(
                "gl-src-parks",
                expect.objectContaining({ type: "geojson", data })
            );
            expect(mockMapInstance.addLayer).toHaveBeenCalledWith(
                expect.objectContaining({ id: "gl-parks-fill", type: "fill" }),
                expect.anything()
            );
            expect(mockMapInstance.addLayer).toHaveBeenCalledWith(
                expect.objectContaining({ id: "gl-parks-line", type: "line" }),
                expect.anything()
            );
        });

        it("adds circle sub-layer for Point data", () => {
            const data = {
                type: "FeatureCollection",
                features: [{ geometry: { type: "Point" } }],
            };
            adapter.addGeoJSONLayer("points", data);
            expect(mockMapInstance.addLayer).toHaveBeenCalledWith(
                expect.objectContaining({ id: "gl-points-circle", type: "circle" }),
                expect.anything()
            );
        });

        it("throws on duplicate layer id", () => {
            const data = { type: "FeatureCollection", features: [] };
            adapter.addGeoJSONLayer("dup", data);
            expect(() => adapter.addGeoJSONLayer("dup", data)).toThrow(
                'layer "dup" already exists'
            );
        });

        it("creates sentinel layer on first call", () => {
            adapter.addGeoJSONLayer("first", { type: "FeatureCollection", features: [] });
            expect(mockMapInstance.addLayer).toHaveBeenCalledWith(
                expect.objectContaining({ id: "gl-sentinel-poi", type: "background" })
            );
        });

        it("adds hidden layers when visible is false", () => {
            const data = {
                type: "FeatureCollection",
                features: [{ geometry: { type: "Point" } }],
            };
            adapter.addGeoJSONLayer("hidden", data, { visible: false });
            const circleCall = mockMapInstance.addLayer.mock.calls.find(
                (c) => c[0].id === "gl-hidden-circle"
            );
            expect(circleCall[0].layout).toEqual(expect.objectContaining({ visibility: "none" }));
        });
    });

    describe("removeLayer", () => {
        let adapter;
        beforeEach(() => {
            adapter = createInitedAdapter();
        });

        it("removes all sub-layers and source", () => {
            const data = {
                type: "FeatureCollection",
                features: [{ geometry: { type: "Point" } }],
            };
            adapter.addGeoJSONLayer("toremove", data);
            adapter.removeLayer("toremove");
            expect(mockMapInstance.removeLayer).toHaveBeenCalledWith("gl-toremove-circle");
            expect(mockMapInstance.removeSource).toHaveBeenCalledWith("gl-src-toremove");
        });

        it("does nothing for unknown layer id", () => {
            adapter.removeLayer("nonexistent");
            expect(mockMapInstance.removeLayer).not.toHaveBeenCalled();
        });
    });

    describe("hasLayer", () => {
        it("returns true for registered layer", () => {
            const adapter = createInitedAdapter();
            adapter.addGeoJSONLayer("test", { type: "FeatureCollection", features: [] });
            expect(adapter.hasLayer("test")).toBe(true);
        });

        it("returns false for unknown layer", () => {
            expect(createInitedAdapter().hasLayer("unknown")).toBe(false);
        });
    });

    describe("showLayer / hideLayer", () => {
        let adapter;
        beforeEach(() => {
            adapter = createInitedAdapter();
            const data = {
                type: "FeatureCollection",
                features: [{ geometry: { type: "Point" } }],
            };
            adapter.addGeoJSONLayer("toggle", data);
        });

        it("hideLayer sets visibility to none", () => {
            adapter.hideLayer("toggle");
            expect(mockMapInstance.setLayoutProperty).toHaveBeenCalledWith(
                "gl-toggle-circle",
                "visibility",
                "none"
            );
        });

        it("showLayer sets visibility to visible", () => {
            adapter.hideLayer("toggle");
            mockMapInstance.setLayoutProperty.mockClear();
            adapter.showLayer("toggle");
            expect(mockMapInstance.setLayoutProperty).toHaveBeenCalledWith(
                "gl-toggle-circle",
                "visibility",
                "visible"
            );
        });
    });

    describe("updateLayerData", () => {
        it("replaces source data via setData", () => {
            const adapter = createInitedAdapter();
            const data = {
                type: "FeatureCollection",
                features: [{ geometry: { type: "Point" } }],
            };
            adapter.addGeoJSONLayer("live", data);
            const newData = { type: "FeatureCollection", features: [{}, {}] };
            adapter.updateLayerData("live", newData);
            expect(mockMapInstance.getSource("gl-src-live").setData).toHaveBeenCalledWith(newData);
        });

        it("does nothing for unknown layer id", () => {
            createInitedAdapter().updateLayerData("nonexistent", {});
        });
    });

    describe("setLayerStyle", () => {
        it("updates paint properties on circle sub-layer", () => {
            const adapter = createInitedAdapter();
            const data = {
                type: "FeatureCollection",
                features: [{ geometry: { type: "Point" } }],
            };
            adapter.addGeoJSONLayer("styled", data);
            adapter.setLayerStyle("styled", { fillColor: "#ff0000" });
            expect(mockMapInstance.setPaintProperty).toHaveBeenCalledWith(
                "gl-styled-circle",
                "circle-color",
                "#ff0000"
            );
        });

        it("does nothing for unknown layer id", () => {
            createInitedAdapter().setLayerStyle("nonexistent", { fillColor: "#000" });
            expect(mockMapInstance.setPaintProperty).not.toHaveBeenCalled();
        });
    });

    describe("setLayerFilter", () => {
        // The guard a point sub-layer carries — see `geometryGuard` in maplibre-primitives.
        const POINT_GUARD = ["match", ["geometry-type"], ["Point", "MultiPoint"], true, false];
        const LINE_GUARD = [
            "match",
            ["geometry-type"],
            ["LineString", "MultiLineString", "Polygon", "MultiPolygon"],
            true,
            false,
        ];

        it("composes the caller filter with the sub-layer geometry guard", () => {
            const adapter = createInitedAdapter();
            const data = {
                type: "FeatureCollection",
                features: [{ geometry: { type: "Point" } }],
            };
            adapter.addGeoJSONLayer("filtered", data);
            const filter = ["==", ["get", "type"], "park"];
            adapter.setLayerFilter("filtered", filter);
            expect(mockMapInstance.setFilter).toHaveBeenCalledWith("gl-filtered-circle", [
                "all",
                POINT_GUARD,
                filter,
            ]);
        });

        // 🛑 Clearing must restore the GUARD, never `null`. A bare null would re-open the
        // defect for exactly as long as no filter is active.
        it("restores the guard alone when null is passed", () => {
            const adapter = createInitedAdapter();
            adapter.addGeoJSONLayer("f2", {
                type: "FeatureCollection",
                features: [{ geometry: { type: "Point" } }],
            });
            adapter.setLayerFilter("f2", null);
            expect(mockMapInstance.setFilter).toHaveBeenCalledWith("gl-f2-circle", POINT_GUARD);
        });

        it("gives each sub-layer of a mixed layer its own guard", () => {
            const adapter = createInitedAdapter();
            adapter.addGeoJSONLayer("mixed", {
                type: "FeatureCollection",
                features: [{ geometry: { type: "LineString" } }, { geometry: { type: "Point" } }],
            });
            adapter.setLayerFilter("mixed", null);
            expect(mockMapInstance.setFilter).toHaveBeenCalledWith("gl-mixed-line", LINE_GUARD);
            expect(mockMapInstance.setFilter).toHaveBeenCalledWith("gl-mixed-circle", POINT_GUARD);
        });
    });

    describe("getLayerRegistry", () => {
        it("returns the layer registry instance", () => {
            const registry = new MaplibreAdapter().getLayerRegistry();
            expect(typeof registry.has).toBe("function");
            expect(typeof registry.get).toBe("function");
        });

        it("reflects layers added via addGeoJSONLayer", () => {
            const adapter = createInitedAdapter();
            adapter.addGeoJSONLayer("tracked", { type: "FeatureCollection", features: [] });
            expect(adapter.getLayerRegistry().has("tracked")).toBe(true);
        });
    });
});

describe("MaplibreAdapter — Markers", () => {
    describe("createMarker", () => {
        let adapter;
        beforeEach(() => {
            adapter = createInitedAdapter();
        });

        it("creates a marker and adds it to the map", () => {
            adapter.createMarker("m1", { lat: 45, lng: -73 });
            expect(globalThis.maplibregl.Marker).toHaveBeenCalledTimes(1);
            const marker = globalThis.maplibregl.Marker.mock.results[0].value;
            expect(marker.setLngLat).toHaveBeenCalledWith([-73, 45]);
            expect(marker.addTo).toHaveBeenCalledWith(mockMapInstance);
        });

        it("updates position if marker id already exists", () => {
            adapter.createMarker("m2", { lat: 45, lng: -73 });
            const marker = globalThis.maplibregl.Marker.mock.results[0].value;
            adapter.createMarker("m2", { lat: 46, lng: -74 });
            expect(marker.setLngLat).toHaveBeenCalledWith([-74, 46]);
            expect(globalThis.maplibregl.Marker).toHaveBeenCalledTimes(1);
        });

        it("passes draggable option", () => {
            adapter.createMarker("m3", { lat: 45, lng: -73 }, { draggable: true });
            expect(globalThis.maplibregl.Marker).toHaveBeenCalledWith(
                expect.objectContaining({ draggable: true })
            );
        });

        it("passes icon SVG through DOMSecurity.setSafeHTML", () => {
            adapter.createMarker("m4", { lat: 45, lng: -73 }, { icon: "<svg><circle/></svg>" });
            expect(DOMSecurity.setSafeHTML).toHaveBeenCalled();
            expect(globalThis.maplibregl.Marker).toHaveBeenCalledWith(
                expect.objectContaining({ element: expect.any(HTMLElement) })
            );
        });

        it("sets iconSize dimensions on element", () => {
            adapter.createMarker(
                "m5",
                { lat: 45, lng: -73 },
                { icon: "<svg></svg>", iconSize: [24, 32] }
            );
            const opts = globalThis.maplibregl.Marker.mock.calls[0][0];
            expect(opts.element.style.width).toBe("24px");
            expect(opts.element.style.height).toBe("32px");
        });

        it("passes iconAnchor as offset", () => {
            adapter.createMarker("m6", { lat: 45, lng: -73 }, { iconAnchor: [12, 16] });
            expect(globalThis.maplibregl.Marker).toHaveBeenCalledWith(
                expect.objectContaining({ offset: [12, 16] })
            );
        });
    });

    describe("removeMarker", () => {
        it("removes a known marker", () => {
            const adapter = createInitedAdapter();
            adapter.createMarker("rm1", { lat: 45, lng: -73 });
            adapter.removeMarker("rm1");
            expect(globalThis.maplibregl.Marker.mock.results[0].value.remove).toHaveBeenCalled();
        });

        it("does nothing for unknown marker id", () => {
            createInitedAdapter().removeMarker("nonexistent");
        });
    });

    describe("updateMarkerPosition", () => {
        it("updates lngLat on an existing marker", () => {
            const adapter = createInitedAdapter();
            adapter.createMarker("up1", { lat: 45, lng: -73 });
            adapter.updateMarkerPosition("up1", { lat: 46, lng: -74 });
            expect(
                globalThis.maplibregl.Marker.mock.results[0].value.setLngLat
            ).toHaveBeenCalledWith([-74, 46]);
        });

        it("does nothing for unknown marker id", () => {
            createInitedAdapter().updateMarkerPosition("nonexistent", { lat: 0, lng: 0 });
        });
    });
});

describe("MaplibreAdapter — Clusters", () => {
    describe("createClusterGroup", () => {
        let adapter;
        beforeEach(() => {
            adapter = createInitedAdapter();
        });

        it("creates clustered source and 3 render layers", () => {
            adapter.createClusterGroup("pois");
            expect(mockMapInstance.addSource).toHaveBeenCalledWith(
                "gl-poi-src-pois",
                expect.objectContaining({ type: "geojson", cluster: true })
            );
            expect(mockMapInstance.addLayer).toHaveBeenCalledWith(
                expect.objectContaining({ id: "gl-poi-pois-clusters" })
            );
            expect(mockMapInstance.addLayer).toHaveBeenCalledWith(
                expect.objectContaining({ id: "gl-poi-pois-cluster-count" })
            );
            expect(mockMapInstance.addLayer).toHaveBeenCalledWith(
                expect.objectContaining({ id: "gl-poi-pois-unclustered" })
            );
        });

        it("throws on duplicate cluster group id", async () => {
            await adapter.createClusterGroup("dup-cluster");
            await expect(adapter.createClusterGroup("dup-cluster")).rejects.toThrow(
                'cluster group "dup-cluster" already exists'
            );
        });

        it("passes clusterRadius and clusterMaxZoom options", () => {
            adapter.createClusterGroup("custom", { clusterRadius: 80, clusterMaxZoom: 16 });
            expect(mockMapInstance.addSource).toHaveBeenCalledWith(
                "gl-poi-src-custom",
                expect.objectContaining({ clusterRadius: 80, clusterMaxZoom: 16 })
            );
        });

        it("registers cluster in layer registry", async () => {
            await adapter.createClusterGroup("reg");
            expect(adapter.hasLayer("reg")).toBe(true);
        });
    });
});

describe("MaplibreAdapter — Popups", () => {
    describe("createPopup", () => {
        it("creates popup with string content via setHTML", () => {
            const adapter = createInitedAdapter();
            adapter.createPopup("<p>Hello</p>");
            expect(globalThis.maplibregl.Popup.mock.results[0].value.setHTML).toHaveBeenCalledWith(
                "<p>Hello</p>"
            );
        });

        it("creates popup with HTMLElement via setDOMContent", () => {
            const adapter = createInitedAdapter();
            const el = document.createElement("div");
            adapter.createPopup(el);
            expect(
                globalThis.maplibregl.Popup.mock.results[0].value.setDOMContent
            ).toHaveBeenCalledWith(el);
        });

        it("passes maxWidth, className, closeOnClick options", () => {
            createInitedAdapter().createPopup("test", {
                maxWidth: 300,
                className: "my-popup",
                closeOnClick: false,
            });
            expect(globalThis.maplibregl.Popup).toHaveBeenCalledWith(
                expect.objectContaining({
                    maxWidth: "300px",
                    className: "my-popup",
                    closeOnClick: false,
                })
            );
        });

        it("passes minWidth and maxHeight options", () => {
            createInitedAdapter().createPopup("test", { minWidth: 100, maxHeight: 400 });
            expect(globalThis.maplibregl.Popup).toHaveBeenCalledWith(
                expect.objectContaining({ minWidth: "100px", maxHeight: "400px" })
            );
        });
    });

    describe("openPopup", () => {
        it("sets position and adds popup to map", () => {
            const adapter = createInitedAdapter();
            const popup = adapter.createPopup("content");
            adapter.openPopup(popup, { lat: 45, lng: -73 });
            const mock = globalThis.maplibregl.Popup.mock.results[0].value;
            expect(mock.setLngLat).toHaveBeenCalledWith([-73, 45]);
            expect(mock.addTo).toHaveBeenCalledWith(mockMapInstance);
        });

        it("opens popup without position", () => {
            const adapter = createInitedAdapter();
            const popup = adapter.createPopup("content");
            adapter.openPopup(popup);
            const mock = globalThis.maplibregl.Popup.mock.results[0].value;
            expect(mock.setLngLat).not.toHaveBeenCalled();
            expect(mock.addTo).toHaveBeenCalledWith(mockMapInstance);
        });
    });

    describe("closePopup", () => {
        it("closes a specific popup", () => {
            const adapter = createInitedAdapter();
            const popup = adapter.createPopup("content");
            adapter.openPopup(popup, { lat: 45, lng: -73 });
            adapter.closePopup(popup);
            expect(globalThis.maplibregl.Popup.mock.results[0].value.remove).toHaveBeenCalled();
        });

        it("closes all open popups when called without argument", () => {
            const adapter = createInitedAdapter();
            const p1 = adapter.createPopup("one");
            const p2 = adapter.createPopup("two");
            adapter.openPopup(p1, { lat: 45, lng: -73 });
            adapter.openPopup(p2, { lat: 46, lng: -74 });
            adapter.closePopup();
            expect(globalThis.maplibregl.Popup.mock.results[0].value.remove).toHaveBeenCalled();
            expect(globalThis.maplibregl.Popup.mock.results[1].value.remove).toHaveBeenCalled();
        });
    });
});

describe("MaplibreAdapter — Contract", () => {
    it("has all 33 IMapAdapter methods", () => {
        const adapter = new MaplibreAdapter();
        const expected = [
            "init",
            "isReady",
            "destroy",
            "setView",
            "getCenter",
            "getZoom",
            "setZoom",
            "panTo",
            "flyTo",
            "fitBounds",
            "getBounds",
            "on",
            "off",
            "once",
            "addGeoJSONLayer",
            "removeLayer",
            "hasLayer",
            "showLayer",
            "hideLayer",
            "updateLayerData",
            "setLayerStyle",
            "setLayerFilter",
            "createMarker",
            "removeMarker",
            "updateMarkerPosition",
            "createClusterGroup",
            "createPopup",
            "openPopup",
            "closePopup",
            "addControl",
            "removeControl",
            "latLngToPoint",
            "pointToLatLng",
            "getContainer",
        ];
        for (const method of expected) {
            expect(typeof adapter[method]).toBe("function");
        }
    });

    it("exposes getNativeMap (escape hatch)", () => {
        expect(typeof new MaplibreAdapter().getNativeMap).toBe("function");
    });
});

// ─── Extended branch coverage ─────────────────────────────────────────

describe("MaplibreAdapter — createMarker with title", () => {
    it("sets aria-label and role=img when title is provided", () => {
        const adapter = createInitedAdapter();
        adapter.createMarker(
            "m-title",
            { lat: 45, lng: -73 },
            {
                icon: '<svg><circle r="5"/></svg>',
                title: "My marker title",
            }
        );
        const markerOpts = globalThis.maplibregl.Marker.mock.calls[0][0];
        expect(markerOpts.element.getAttribute("aria-label")).toBe("My marker title");
        expect(markerOpts.element.getAttribute("role")).toBe("img");
    });
});

describe("MaplibreAdapter — addControl with native IControl", () => {
    it("passes a non-HTMLElement control directly to map.addControl", () => {
        const adapter = createInitedAdapter();
        const nativeControl = {
            onAdd: vi.fn().mockReturnValue(document.createElement("div")),
            onRemove: vi.fn(),
        };
        adapter.addControl(nativeControl, "bottomleft");
        expect(mockMapInstance.addControl).toHaveBeenCalledWith(nativeControl, "bottom-left");
    });
});

describe("MaplibreAdapter — setLayerStyle branches", () => {
    let adapter;

    beforeEach(() => {
        adapter = createInitedAdapter();
    });

    it("setLayerStyle updates fill sub-layer and registers hatch when enabled", () => {
        adapter.addGeoJSONLayer("poly-hatch", {
            type: "FeatureCollection",
            features: [{ geometry: { type: "Polygon" } }],
        });
        mockMapInstance.setPaintProperty.mockClear();
        expect(() =>
            adapter.setLayerStyle("poly-hatch", {
                hatch: {
                    enabled: true,
                    type: "dot",
                    spacingPx: 10,
                    stroke: { color: "#aabbcc", widthPx: 1, opacity: 1 },
                },
            })
        ).not.toThrow();
        expect(mockMapInstance.setPaintProperty).toHaveBeenCalled();
    });

    it("setLayerStyle updates casing sub-layer paint properties", () => {
        adapter.addGeoJSONLayer(
            "poly-casing",
            {
                type: "FeatureCollection",
                features: [{ geometry: { type: "Polygon" } }],
            },
            {
                casing: { enabled: true, color: "#ffffff", widthPx: 3 },
            }
        );
        mockMapInstance.setPaintProperty.mockClear();
        adapter.setLayerStyle("poly-casing", { color: "#ff0000" });
        expect(mockMapInstance.setPaintProperty).toHaveBeenCalledWith(
            "gl-poly-casing-casing",
            expect.any(String),
            expect.anything()
        );
    });

    it("setLayerStyle updates fill-extrusion sub-layer paint properties", () => {
        adapter.addGeoJSONLayer(
            "extrusion-layer",
            {
                type: "FeatureCollection",
                features: [{ geometry: { type: "Polygon" } }],
            },
            { geometry: "fill-extrusion", fillExtrusionColor: "#ff0000", fillExtrusionHeight: 10 }
        );
        mockMapInstance.setPaintProperty.mockClear();
        adapter.setLayerStyle("extrusion-layer", {
            fillExtrusionColor: "#00ff00",
            fillExtrusionHeight: 20,
            fillExtrusionOpacity: 0.8,
        });
        expect(mockMapInstance.setPaintProperty).toHaveBeenCalledWith(
            "gl-extrusion-layer-fill-extrusion",
            "fill-extrusion-color",
            "#00ff00"
        );
        expect(mockMapInstance.setPaintProperty).toHaveBeenCalledWith(
            "gl-extrusion-layer-fill-extrusion",
            "fill-extrusion-height",
            20
        );
    });

    it("addGeoJSONLayer with geometry:fill-extrusion creates only fill-extrusion sub-layer (no line)", () => {
        adapter.addGeoJSONLayer(
            "extrusion-only",
            {
                type: "FeatureCollection",
                features: [{ geometry: { type: "Polygon" } }],
            },
            { geometry: "fill-extrusion", fillExtrusionColor: "#aabbcc", fillExtrusionHeight: 5 }
        );
        const layerCalls = mockMapInstance.addLayer.mock.calls.map((c) => c[0]);
        const types = layerCalls.map((l) => l.type);
        expect(types).toContain("fill-extrusion");
        expect(types).not.toContain("line");
        expect(types).not.toContain("fill");
    });
});

describe("MaplibreAdapter — removeLayer hatch cleanup", () => {
    it("removes hatch pattern images matching the layer prefix, via listImages()", () => {
        const adapter = createInitedAdapter();
        adapter.addGeoJSONLayer("hatch-layer", {
            type: "FeatureCollection",
            features: [{ geometry: { type: "Polygon" } }],
        });
        // Simulate hatch images registered on the engine. Read through the PUBLIC
        // enumeration API — this used to reach into `map.style._images`.
        mockMapInstance.listImages = vi.fn(() => [
            "gl-hatch-hatch-layer-diagonal-45-10-000000-1-1",
            "gl-hatch-other-layer-dot-0-10-ff0000-1-1",
        ]);
        mockMapInstance.removeImage = vi.fn();
        adapter.removeLayer("hatch-layer");
        expect(mockMapInstance.listImages).toHaveBeenCalled();
        expect(mockMapInstance.removeImage).toHaveBeenCalledWith(
            "gl-hatch-hatch-layer-diagonal-45-10-000000-1-1"
        );
        expect(mockMapInstance.removeImage).not.toHaveBeenCalledWith(
            "gl-hatch-other-layer-dot-0-10-ff0000-1-1"
        );
    });

    it("removeLayer does not throw when listImages() is absent from the engine", () => {
        const adapter = createInitedAdapter();
        adapter.addGeoJSONLayer("no-images-layer", {
            type: "FeatureCollection",
            features: [{ geometry: { type: "Polygon" } }],
        });
        // Guard branch: an engine build without the enumeration API must not crash removeLayer.
        mockMapInstance.listImages = undefined;
        expect(() => adapter.removeLayer("no-images-layer")).not.toThrow();
    });
});

describe("MaplibreAdapter — setLayerFilter cluster branch", () => {
    it("routes filter through applyPoiFilter for registered cluster groups", async () => {
        const adapter = createInitedAdapter();
        await adapter.createClusterGroup("poi-group");
        mockMapInstance.setFilter.mockClear();
        const filter = ["==", ["get", "category"], "restaurant"];
        adapter.setLayerFilter("poi-group", filter);
        // applyPoiFilter calls map.setFilter on the unclustered layer IDs
        expect(mockMapInstance.setFilter).toHaveBeenCalled();
    });

    it("clears cluster filter when null is passed", async () => {
        const adapter = createInitedAdapter();
        await adapter.createClusterGroup("poi-group-2");
        mockMapInstance.setFilter.mockClear();
        adapter.setLayerFilter("poi-group-2", null);
        expect(mockMapInstance.setFilter).toHaveBeenCalled();
    });
});

describe("MaplibreAdapter — _ensureSentinel already created", () => {
    it("creates sentinel layer only once across multiple addGeoJSONLayer calls", () => {
        const adapter = createInitedAdapter();
        adapter.addGeoJSONLayer("first-layer", {
            type: "FeatureCollection",
            features: [{ geometry: { type: "Point" } }],
        });
        adapter.addGeoJSONLayer("second-layer", {
            type: "FeatureCollection",
            features: [{ geometry: { type: "Point" } }],
        });
        const sentinelCalls = mockMapInstance.addLayer.mock.calls.filter(
            (c) => c[0]?.id === "gl-sentinel-poi"
        );
        expect(sentinelCalls).toHaveLength(1);
    });
});
