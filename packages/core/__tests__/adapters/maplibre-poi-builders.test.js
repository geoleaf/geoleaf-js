/**
 * Unit tests for maplibre-poi-builders — POI cluster sources, layers,
 * events, filtering, and data conversion.
 *
 */

import { createRequire } from "node:module";

vi.mock("../../src/adapters/maplibre/maplibre-style-converter.js", () => ({
    toClusterCirclePaint: vi.fn((_config) => ({
        "circle-color": ["step", ["get", "point_count"], "#51bbd6", 100, "#f1f075", 750, "#f28cb1"],
        "circle-radius": ["step", ["get", "point_count"], 18, 100, 24, 750, 32],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
    })),
}));

import {
    toClusterSourceId,
    toClusterLayerIds,
    createClusteredSource,
    applyPoiFilter,
    bindPoiEvents,
    getClusterExpansionZoom,
} from "../../src/adapters/maplibre/maplibre-poi-builders.js";

const require = createRequire(import.meta.url);
const maplibregl = require("../__mocks__/maplibre-gl.cjs");

// ── Helpers ──────────────────────────────────────────────────────────────────

function freshMap() {
    return maplibregl.__createMockMap();
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("maplibre-poi-builders", () => {
    // ── ID builders ─────────────────────────────────────────────────────────

    describe("toClusterSourceId", () => {
        it("returns prefixed source ID", () => {
            expect(toClusterSourceId("restaurants")).toBe("gl-poi-src-restaurants");
        });

        it("handles empty string", () => {
            expect(toClusterSourceId("")).toBe("gl-poi-src-");
        });
    });

    describe("toClusterLayerIds", () => {
        it("returns all layer IDs with correct prefixes", () => {
            const ids = toClusterLayerIds("shops");
            expect(ids.sourceId).toBe("gl-poi-src-shops");
            expect(ids.clustersLayerId).toBe("gl-poi-shops-clusters");
            expect(ids.clusterCountLayerId).toBe("gl-poi-shops-cluster-count");
            expect(ids.unclusteredLayerId).toBe("gl-poi-shops-unclustered");
            expect(ids.unclusteredIconsLayerId).toBe("gl-poi-shops-unclustered-icons");
        });

        it("allLayerIds contains exactly 4 layer IDs", () => {
            const ids = toClusterLayerIds("hotels");
            expect(ids.allLayerIds).toEqual([
                "gl-poi-hotels-clusters",
                "gl-poi-hotels-cluster-count",
                "gl-poi-hotels-unclustered",
                "gl-poi-hotels-unclustered-icons",
            ]);
            expect(ids.allLayerIds).toHaveLength(4);
        });

        it("sourceId is consistent with toClusterSourceId", () => {
            const ids = toClusterLayerIds("parks");
            expect(ids.sourceId).toBe(toClusterSourceId("parks"));
        });
    });

    // ── createClusteredSource ───────────────────────────────────────────────

    describe("createClusteredSource", () => {
        let map;

        beforeEach(() => {
            map = freshMap();
        });

        it("adds a GeoJSON source with cluster:true", () => {
            createClusteredSource(map, "poi-src");
            expect(map.addSource).toHaveBeenCalledWith(
                "gl-poi-src-poi-src",
                expect.objectContaining({
                    type: "geojson",
                    cluster: true,
                    clusterRadius: 50,
                    clusterMaxZoom: 14,
                })
            );
        });

        it("defaults to empty FeatureCollection when no data provided", () => {
            createClusteredSource(map, "empty");
            expect(map.addSource).toHaveBeenCalledWith(
                "gl-poi-src-empty",
                expect.objectContaining({
                    data: { type: "FeatureCollection", features: [] },
                })
            );
        });

        it("uses custom clusterRadius and clusterMaxZoom", () => {
            createClusteredSource(map, "custom", {
                clusterRadius: 80,
                clusterMaxZoom: 16,
            });
            expect(map.addSource).toHaveBeenCalledWith(
                "gl-poi-src-custom",
                expect.objectContaining({
                    clusterRadius: 80,
                    clusterMaxZoom: 16,
                })
            );
        });

        it("uses custom initial data", () => {
            const fc = { type: "FeatureCollection", features: [{ type: "Feature" }] };
            createClusteredSource(map, "with-data", { data: fc });
            expect(map.addSource).toHaveBeenCalledWith(
                "gl-poi-src-with-data",
                expect.objectContaining({ data: fc })
            );
        });

        it("adds exactly 4 layers (clusters, count, unclustered, unclustered-icons)", () => {
            createClusteredSource(map, "layers");
            expect(map.addLayer).toHaveBeenCalledTimes(4);

            // Clusters circle layer
            expect(map.addLayer).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: "gl-poi-layers-clusters",
                    type: "circle",
                    source: "gl-poi-src-layers",
                    filter: ["has", "point_count"],
                })
            );

            // Cluster count symbol layer
            expect(map.addLayer).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: "gl-poi-layers-cluster-count",
                    type: "symbol",
                    source: "gl-poi-src-layers",
                    filter: ["has", "point_count"],
                })
            );

            // Unclustered point circle layer
            expect(map.addLayer).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: "gl-poi-layers-unclustered",
                    type: "circle",
                    source: "gl-poi-src-layers",
                    filter: ["!", ["has", "point_count"]],
                })
            );

            // Unclustered icons symbol layer
            expect(map.addLayer).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: "gl-poi-layers-unclustered-icons",
                    type: "symbol",
                    source: "gl-poi-src-layers",
                    filter: ["all", ["!", ["has", "point_count"]], ["has", "symbolId"]],
                    layout: expect.objectContaining({ "icon-image": ["get", "symbolId"] }),
                })
            );
        });

        it("returns the ClusterLayerIds object", async () => {
            const ids = await createClusteredSource(map, "ret");
            expect(ids.sourceId).toBe("gl-poi-src-ret");
            expect(ids.clustersLayerId).toBe("gl-poi-ret-clusters");
            expect(ids.clusterCountLayerId).toBe("gl-poi-ret-cluster-count");
            expect(ids.unclusteredLayerId).toBe("gl-poi-ret-unclustered");
            expect(ids.unclusteredIconsLayerId).toBe("gl-poi-ret-unclustered-icons");
            expect(ids.allLayerIds).toHaveLength(4);
        });

        it("registers source and layers in map internal state", () => {
            createClusteredSource(map, "state");
            expect(map.__sources["gl-poi-src-state"]).toBeDefined();
            expect(map.__layers["gl-poi-state-clusters"]).toBeDefined();
            expect(map.__layers["gl-poi-state-cluster-count"]).toBeDefined();
            expect(map.__layers["gl-poi-state-unclustered"]).toBeDefined();
            expect(map.__layers["gl-poi-state-unclustered-icons"]).toBeDefined();
        });
    });

    // ── applyPoiFilter ──────────────────────────────────────────────────────

    describe("applyPoiFilter", () => {
        let map;

        beforeEach(() => {
            map = freshMap();
            createClusteredSource(map, "filter");
        });

        it("resets to default filter when filter is null", () => {
            applyPoiFilter(map, "filter", null);
            expect(map.setFilter).toHaveBeenCalledWith("gl-poi-filter-unclustered", [
                "!",
                ["has", "point_count"],
            ]);
            expect(map.setFilter).toHaveBeenCalledWith("gl-poi-filter-unclustered-icons", [
                "all",
                ["!", ["has", "point_count"]],
                ["has", "symbolId"],
            ]);
        });

        it("resets to default filter when filter is undefined", () => {
            applyPoiFilter(map, "filter", undefined);
            expect(map.setFilter).toHaveBeenCalledWith("gl-poi-filter-unclustered", [
                "!",
                ["has", "point_count"],
            ]);
            expect(map.setFilter).toHaveBeenCalledWith("gl-poi-filter-unclustered-icons", [
                "all",
                ["!", ["has", "point_count"]],
                ["has", "symbolId"],
            ]);
        });

        it("combines base filter with provided filter using 'all'", () => {
            const customFilter = ["==", ["get", "categoryId"], "food"];
            applyPoiFilter(map, "filter", customFilter);
            expect(map.setFilter).toHaveBeenCalledWith("gl-poi-filter-unclustered", [
                "all",
                ["!", ["has", "point_count"]],
                customFilter,
            ]);
            expect(map.setFilter).toHaveBeenCalledWith("gl-poi-filter-unclustered-icons", [
                "all",
                ["!", ["has", "point_count"]],
                ["has", "symbolId"],
                customFilter,
            ]);
        });
    });

    // ── bindPoiEvents ───────────────────────────────────────────────────────

    describe("bindPoiEvents", () => {
        let map;

        beforeEach(() => {
            map = freshMap();
            createClusteredSource(map, "events");
        });

        it("registers click handler on unclustered layer", () => {
            const onPointClick = vi.fn();
            bindPoiEvents(map, "events", { onPointClick });
            expect(map.on).toHaveBeenCalledWith(
                "click",
                "gl-poi-events-unclustered",
                expect.any(Function)
            );
        });

        it("registers click handler on clusters layer", () => {
            const onClusterClick = vi.fn();
            bindPoiEvents(map, "events", { onClusterClick });
            expect(map.on).toHaveBeenCalledWith(
                "click",
                "gl-poi-events-clusters",
                expect.any(Function)
            );
        });

        it("always registers mouseenter/mouseleave on unclustered layer", () => {
            bindPoiEvents(map, "events", {});
            expect(map.on).toHaveBeenCalledWith(
                "mouseenter",
                "gl-poi-events-unclustered",
                expect.any(Function)
            );
            expect(map.on).toHaveBeenCalledWith(
                "mouseleave",
                "gl-poi-events-unclustered",
                expect.any(Function)
            );
        });

        it("always registers mouseenter/mouseleave on unclustered-icons layer", () => {
            bindPoiEvents(map, "events", {});
            expect(map.on).toHaveBeenCalledWith(
                "mouseenter",
                "gl-poi-events-unclustered-icons",
                expect.any(Function)
            );
            expect(map.on).toHaveBeenCalledWith(
                "mouseleave",
                "gl-poi-events-unclustered-icons",
                expect.any(Function)
            );
        });

        it("registers click handler on unclustered-icons layer when onPointClick provided", () => {
            const onPointClick = vi.fn();
            bindPoiEvents(map, "events", { onPointClick });
            expect(map.on).toHaveBeenCalledWith(
                "click",
                "gl-poi-events-unclustered-icons",
                expect.any(Function)
            );
        });

        it("icon layer click handler calls onPointClick with feature and lngLat", () => {
            const onPointClick = vi.fn();
            bindPoiEvents(map, "events", { onPointClick });

            const handlers = map.__eventHandlers["click:gl-poi-events-unclustered-icons"];
            expect(handlers).toBeDefined();
            expect(handlers.length).toBeGreaterThan(0);

            const mockFeature = {
                properties: { id: "poi-icon", symbolId: "tourism-poi-cat-activity-generic" },
            };
            const mockEvent = { features: [mockFeature], lngLat: { lng: 1.5, lat: 43.6 } };

            handlers[0](mockEvent);
            expect(onPointClick).toHaveBeenCalledWith(mockFeature, { lng: 1.5, lat: 43.6 });
        });

        it("icon layer click handler does nothing when no features", () => {
            const onPointClick = vi.fn();
            bindPoiEvents(map, "events", { onPointClick });

            const handlers = map.__eventHandlers["click:gl-poi-events-unclustered-icons"];
            handlers[0]({ features: [] });
            expect(onPointClick).not.toHaveBeenCalled();
        });

        it("always registers mouseenter/mouseleave on clusters layer", () => {
            bindPoiEvents(map, "events", {});
            expect(map.on).toHaveBeenCalledWith(
                "mouseenter",
                "gl-poi-events-clusters",
                expect.any(Function)
            );
            expect(map.on).toHaveBeenCalledWith(
                "mouseleave",
                "gl-poi-events-clusters",
                expect.any(Function)
            );
        });

        it("unclustered click handler calls onPointClick with feature and lngLat", () => {
            const onPointClick = vi.fn();
            bindPoiEvents(map, "events", { onPointClick });

            // Find the registered handler for unclustered click
            const handlers = map.__eventHandlers["click:gl-poi-events-unclustered"];
            expect(handlers).toBeDefined();
            expect(handlers.length).toBeGreaterThan(0);

            const mockFeature = { properties: { id: "poi-1" } };
            const mockEvent = {
                features: [mockFeature],
                lngLat: { lng: 2.3, lat: 48.8 },
            };

            handlers[0](mockEvent);
            expect(onPointClick).toHaveBeenCalledWith(mockFeature, { lng: 2.3, lat: 48.8 });
        });

        it("cluster click handler calls onClusterClick with feature and lngLat", () => {
            const onClusterClick = vi.fn();
            bindPoiEvents(map, "events", { onClusterClick });

            const handlers = map.__eventHandlers["click:gl-poi-events-clusters"];
            expect(handlers).toBeDefined();

            const mockFeature = { properties: { cluster_id: 42, point_count: 10 } };
            const mockEvent = {
                features: [mockFeature],
                lngLat: { lng: -73.5, lat: 45.5 },
            };

            handlers[0](mockEvent);
            expect(onClusterClick).toHaveBeenCalledWith(mockFeature, { lng: -73.5, lat: 45.5 });
        });

        it("unclustered click handler does nothing when no features", () => {
            const onPointClick = vi.fn();
            bindPoiEvents(map, "events", { onPointClick });

            const handlers = map.__eventHandlers["click:gl-poi-events-unclustered"];
            handlers[0]({ features: [] });
            expect(onPointClick).not.toHaveBeenCalled();

            handlers[0]({});
            expect(onPointClick).not.toHaveBeenCalled();
        });

        it("mouseenter sets cursor to pointer", () => {
            // Pin the canvas mock so all getCanvas() calls return the same object
            const canvasObj = { style: { cursor: "" } };
            map.getCanvas.mockReturnValue(canvasObj);

            bindPoiEvents(map, "events", {});

            const enterHandlers = map.__eventHandlers["mouseenter:gl-poi-events-unclustered"];
            expect(enterHandlers).toBeDefined();

            enterHandlers[0]();
            expect(canvasObj.style.cursor).toBe("pointer");
        });

        it("mouseleave resets cursor to empty", () => {
            const canvasObj = { style: { cursor: "pointer" } };
            map.getCanvas.mockReturnValue(canvasObj);

            bindPoiEvents(map, "events", {});

            const leaveHandlers = map.__eventHandlers["mouseleave:gl-poi-events-unclustered"];
            leaveHandlers[0]();
            expect(canvasObj.style.cursor).toBe("");
        });
    });

    // ── getClusterExpansionZoom ──────────────────────────────────────────────

    describe("getClusterExpansionZoom", () => {
        it("calls source.getClusterExpansionZoom with cluster ID", async () => {
            const map = freshMap();
            createClusteredSource(map, "expand");

            // Add getClusterExpansionZoom to the mock source
            const source = map.getSource("gl-poi-src-expand");
            source.getClusterExpansionZoom = vi.fn().mockResolvedValue(7);

            const zoom = await getClusterExpansionZoom(map, "expand", 42);
            expect(source.getClusterExpansionZoom).toHaveBeenCalledWith(42);
            expect(zoom).toBe(7);
        });
    });
});
