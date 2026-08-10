/**
 * Unit tests for maplibre-primitives — coordinate conversion, constants,
 * GeoJSON detection, safeBeforeId, and addSubLayers.
 *
 */

import maplibregl from "../__mocks__/maplibre-gl.cjs";

// Mock canvas 2D context — jsdom does not implement getContext('2d')
const mockImageData = { data: new Uint8ClampedArray(64 * 64 * 4), width: 64, height: 64 };
const mockCtx = {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    rotate: vi.fn(),
    translate: vi.fn(),
    getImageData: vi.fn(() => mockImageData),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    lineCap: "butt",
};
HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx);

import {
    toMapLibreLngLat,
    fromMapLibreLngLat,
    toMapLibreBounds,
    fromMapLibreBounds,
    POSITION_MAP,
    SVG_ALLOWED_TAGS,
    detectGeometryTypes,
    resolveGeometryTypes,
    safeBeforeId,
    addSubLayers,
    toSubLayerId,
} from "../../src/adapters/maplibre/maplibre-primitives.js";
import {
    addClusterSubLayers,
    bindGeoJSONClusterEvents,
} from "../../src/adapters/maplibre/maplibre-cluster-builders.js";

// ─── Coordinate conversion ──────────────────────────────────────────────────

describe("toMapLibreLngLat", () => {
    it("converts standard lat/lng to [lng, lat]", () => {
        expect(toMapLibreLngLat({ lat: 45, lng: -73 })).toEqual([-73, 45]);
    });

    it("handles zero values (equator / prime meridian)", () => {
        expect(toMapLibreLngLat({ lat: 0, lng: 0 })).toEqual([0, 0]);
    });

    it("handles negative latitude (southern hemisphere)", () => {
        expect(toMapLibreLngLat({ lat: -33.87, lng: 151.21 })).toEqual([151.21, -33.87]);
    });

    it("handles extreme coordinates (antimeridian)", () => {
        expect(toMapLibreLngLat({ lat: 90, lng: -180 })).toEqual([-180, 90]);
    });
});

describe("fromMapLibreLngLat", () => {
    it("converts MapLibre {lng, lat} to GeoLeaf {lat, lng}", () => {
        const result = fromMapLibreLngLat({ lng: -73, lat: 45 });
        expect(result).toEqual({ lat: 45, lng: -73 });
    });

    it("preserves zero values", () => {
        expect(fromMapLibreLngLat({ lng: 0, lat: 0 })).toEqual({ lat: 0, lng: 0 });
    });

    it("handles negative longitude (western hemisphere)", () => {
        const result = fromMapLibreLngLat({ lng: -122.42, lat: 37.77 });
        expect(result).toEqual({ lat: 37.77, lng: -122.42 });
    });
});

// ─── Bounds conversion ──────────────────────────────────────────────────────

describe("toMapLibreBounds", () => {
    it("converts GeoLeafBounds to [[west, south], [east, north]]", () => {
        const result = toMapLibreBounds({
            south: 44,
            west: -74,
            north: 46,
            east: -72,
        });
        expect(result).toEqual([
            [-74, 44],
            [-72, 46],
        ]);
    });

    it("handles bounds crossing prime meridian", () => {
        const result = toMapLibreBounds({
            south: 48,
            west: -5,
            north: 52,
            east: 3,
        });
        expect(result).toEqual([
            [-5, 48],
            [3, 52],
        ]);
    });

    it("handles zero-width bounds (point)", () => {
        const result = toMapLibreBounds({
            south: 45,
            west: -73,
            north: 45,
            east: -73,
        });
        expect(result).toEqual([
            [-73, 45],
            [-73, 45],
        ]);
    });
});

describe("fromMapLibreBounds", () => {
    it("converts MapLibre LngLatBounds to GeoLeafBounds", () => {
        const mockBounds = maplibregl.__createMockLngLatBounds(
            { lng: -74, lat: 44 },
            { lng: -72, lat: 46 }
        );
        const result = fromMapLibreBounds(mockBounds);
        expect(result).toEqual({ south: 44, west: -74, north: 46, east: -72 });
    });

    it("calls getSouthWest and getNorthEast on the bounds object", () => {
        const mockBounds = maplibregl.__createMockLngLatBounds(
            { lng: 0, lat: 0 },
            { lng: 10, lat: 10 }
        );
        fromMapLibreBounds(mockBounds);
        expect(mockBounds.getSouthWest).toHaveBeenCalled();
        expect(mockBounds.getNorthEast).toHaveBeenCalled();
    });
});

// ─── Constants ──────────────────────────────────────────────────────────────

describe("POSITION_MAP", () => {
    it("maps all four GeoLeaf positions to MapLibre equivalents", () => {
        expect(POSITION_MAP).toEqual({
            topleft: "top-left",
            topright: "top-right",
            bottomleft: "bottom-left",
            bottomright: "bottom-right",
        });
    });
});

describe("SVG_ALLOWED_TAGS", () => {
    it("contains exactly 12 tags", () => {
        expect(SVG_ALLOWED_TAGS).toHaveLength(12);
    });

    it("includes core SVG elements", () => {
        expect(SVG_ALLOWED_TAGS).toContain("svg");
        expect(SVG_ALLOWED_TAGS).toContain("path");
        expect(SVG_ALLOWED_TAGS).toContain("circle");
        expect(SVG_ALLOWED_TAGS).toContain("rect");
        expect(SVG_ALLOWED_TAGS).toContain("g");
    });

    it("includes structural and drawing elements", () => {
        expect(SVG_ALLOWED_TAGS).toContain("use");
        expect(SVG_ALLOWED_TAGS).toContain("line");
        expect(SVG_ALLOWED_TAGS).toContain("polygon");
        expect(SVG_ALLOWED_TAGS).toContain("polyline");
        expect(SVG_ALLOWED_TAGS).toContain("ellipse");
        expect(SVG_ALLOWED_TAGS).toContain("defs");
        expect(SVG_ALLOWED_TAGS).toContain("clipPath");
    });

    it("does not include dangerous tags (script, foreignObject)", () => {
        expect(SVG_ALLOWED_TAGS).not.toContain("script");
        expect(SVG_ALLOWED_TAGS).not.toContain("foreignObject");
        expect(SVG_ALLOWED_TAGS).not.toContain("iframe");
    });
});

// ─── detectGeometryTypes ─────────────────────────────────────────────────────

describe("detectGeometryTypes", () => {
    it("returns geometry types from a FeatureCollection", () => {
        const data = {
            type: "FeatureCollection",
            features: [{ geometry: { type: "Point" } }, { geometry: { type: "LineString" } }],
        };
        const types = detectGeometryTypes(data);
        expect(types).toBeInstanceOf(Set);
        expect(types.has("Point")).toBe(true);
        expect(types.has("LineString")).toBe(true);
        expect(types.size).toBe(2);
    });

    it("returns geometry type from a single Feature", () => {
        const data = {
            type: "Feature",
            geometry: { type: "Polygon" },
        };
        const types = detectGeometryTypes(data);
        expect(types.has("Polygon")).toBe(true);
        expect(types.size).toBe(1);
    });

    it("deduplicates repeated geometry types", () => {
        const data = {
            type: "FeatureCollection",
            features: [
                { geometry: { type: "Point" } },
                { geometry: { type: "Point" } },
                { geometry: { type: "Point" } },
            ],
        };
        const types = detectGeometryTypes(data);
        expect(types.size).toBe(1);
        expect(types.has("Point")).toBe(true);
    });

    it("handles mixed geometry collections", () => {
        const data = {
            type: "FeatureCollection",
            features: [
                { geometry: { type: "Point" } },
                { geometry: { type: "MultiPolygon" } },
                { geometry: { type: "LineString" } },
                { geometry: { type: "MultiPoint" } },
            ],
        };
        const types = detectGeometryTypes(data);
        expect(types.size).toBe(4);
        expect(types.has("Point")).toBe(true);
        expect(types.has("MultiPolygon")).toBe(true);
        expect(types.has("LineString")).toBe(true);
        expect(types.has("MultiPoint")).toBe(true);
    });

    it("skips features with no geometry", () => {
        const data = {
            type: "FeatureCollection",
            features: [
                { geometry: { type: "Point" } },
                { geometry: null },
                {},
                { geometry: { type: "LineString" } },
            ],
        };
        const types = detectGeometryTypes(data);
        expect(types.size).toBe(2);
        expect(types.has("Point")).toBe(true);
        expect(types.has("LineString")).toBe(true);
    });

    it("returns all 3 defaults for null input", () => {
        const types = detectGeometryTypes(null);
        expect(types.size).toBe(3);
        expect(types.has("Point")).toBe(true);
        expect(types.has("LineString")).toBe(true);
        expect(types.has("Polygon")).toBe(true);
    });

    it("returns all 3 defaults for undefined input", () => {
        const types = detectGeometryTypes(undefined);
        expect(types.size).toBe(3);
    });

    it("returns all 3 defaults for empty FeatureCollection", () => {
        const data = { type: "FeatureCollection", features: [] };
        const types = detectGeometryTypes(data);
        expect(types.size).toBe(3);
        expect(types.has("Point")).toBe(true);
        expect(types.has("LineString")).toBe(true);
        expect(types.has("Polygon")).toBe(true);
    });

    it("returns all 3 defaults for FeatureCollection with only null geometries", () => {
        const data = {
            type: "FeatureCollection",
            features: [{ geometry: null }, { geometry: null }],
        };
        const types = detectGeometryTypes(data);
        expect(types.size).toBe(3);
    });
});

// ─── resolveGeometryTypes (dormant fast-path) ────────────────────────────────

describe("resolveGeometryTypes", () => {
    // A FeatureCollection whose actual content differs from the declared type,
    // so we can prove the declaration short-circuits the scan.
    const pointsFC = {
        type: "FeatureCollection",
        features: [{ geometry: { type: "Point" } }, { geometry: { type: "Point" } }],
    };

    it("uses a declared GeoJSON type and skips the scan", () => {
        const types = resolveGeometryTypes(pointsFC, "Polygon");
        expect(types).toBeInstanceOf(Set);
        expect(types.has("Polygon")).toBe(true);
        // Declaration wins over the actual Point content → no Point in the set.
        expect(types.has("Point")).toBe(false);
        expect(types.size).toBe(1);
    });

    it("accepts an array of declared GeoJSON types", () => {
        const types = resolveGeometryTypes(pointsFC, ["Point", "LineString"]);
        expect(types.size).toBe(2);
        expect(types.has("Point")).toBe(true);
        expect(types.has("LineString")).toBe(true);
    });

    it("filters out invalid entries, keeping valid GeoJSON types", () => {
        const types = resolveGeometryTypes(pointsFC, ["Polygon", "nope", 42, null]);
        expect(types.size).toBe(1);
        expect(types.has("Polygon")).toBe(true);
    });

    it("falls back to scanning for lowercase render hints", () => {
        // "point"/"line"/"polygon" are render hints, not GeoJSON vocabulary.
        const types = resolveGeometryTypes(pointsFC, "point");
        expect(types.size).toBe(1);
        expect(types.has("Point")).toBe(true); // from the scan, not the hint
    });

    it("falls back to scanning for an unknown declared value", () => {
        const types = resolveGeometryTypes(pointsFC, "fill-extrusion");
        expect(types.has("Point")).toBe(true);
    });

    it("falls back to scanning when nothing is declared", () => {
        for (const declared of [undefined, null, [], ""]) {
            const types = resolveGeometryTypes(pointsFC, declared);
            expect(types.has("Point")).toBe(true);
            expect(types.size).toBe(1);
        }
    });

    it("falls back to scan defaults when undeclared data is empty", () => {
        const types = resolveGeometryTypes(null, undefined);
        expect(types.size).toBe(3); // detectGeometryTypes defaults
    });
});

// ─── safeBeforeId ────────────────────────────────────────────────────────────

describe("safeBeforeId", () => {
    it("returns beforeId when layer exists", () => {
        const map = maplibregl.__createMockMap();
        // Add a layer so getLayer returns it
        map.addLayer({ id: "my-layer", type: "fill", source: "s" });
        const result = safeBeforeId(map, "my-layer");
        expect(result).toBe("my-layer");
    });

    it("returns undefined when layer does not exist", () => {
        const map = maplibregl.__createMockMap();
        const result = safeBeforeId(map, "nonexistent");
        expect(result).toBeUndefined();
    });
});

// ─── addSubLayers ────────────────────────────────────────────────────────────

describe("addSubLayers", () => {
    let map;

    beforeEach(() => {
        map = maplibregl.__createMockMap();
    });

    it("creates fill + line layers for Polygon geometry", () => {
        const geomTypes = new Set(["Polygon"]);
        const created = addSubLayers(
            map,
            "test",
            "src-test",
            geomTypes,
            { fillColor: "#ff0000", color: "#000" },
            { visibility: "visible" },
            undefined
        );
        expect(created).toContain("fill");
        expect(created).toContain("line");
        expect(created).not.toContain("circle");
        expect(map.addLayer).toHaveBeenCalledTimes(2);
    });

    it("creates circle layer for Point geometry", () => {
        const geomTypes = new Set(["Point"]);
        const created = addSubLayers(
            map,
            "test",
            "src-test",
            geomTypes,
            { fillColor: "#00f" },
            { visibility: "visible" },
            undefined
        );
        expect(created).toEqual(["circle"]);
        expect(map.addLayer).toHaveBeenCalledTimes(1);
    });

    it("creates line layer for LineString geometry", () => {
        const geomTypes = new Set(["LineString"]);
        const created = addSubLayers(
            map,
            "test",
            "src-test",
            geomTypes,
            { color: "#333", weight: 2 },
            { visibility: "visible" },
            undefined
        );
        expect(created).toEqual(["line"]);
        expect(map.addLayer).toHaveBeenCalledTimes(1);
    });

    it("creates fill + line + circle for mixed geometries", () => {
        const geomTypes = new Set(["Polygon", "LineString", "Point"]);
        const created = addSubLayers(
            map,
            "mixed",
            "src-mixed",
            geomTypes,
            { fillColor: "#ff0", color: "#000" },
            {},
            undefined
        );
        expect(created).toEqual(["fill", "line", "circle"]);
        expect(map.addLayer).toHaveBeenCalledTimes(3);
    });

    it("uses correct sub-layer IDs via toSubLayerId", () => {
        const geomTypes = new Set(["Point"]);
        addSubLayers(
            map,
            "poi",
            "src-poi",
            geomTypes,
            { fillColor: "#0f0" },
            { visibility: "visible" },
            undefined
        );
        const layerDef = map.addLayer.mock.calls[0][0];
        expect(layerDef.id).toBe(toSubLayerId("poi", "circle"));
        expect(layerDef.type).toBe("circle");
        expect(layerDef.source).toBe("src-poi");
    });

    it("passes beforeId to map.addLayer", () => {
        const geomTypes = new Set(["Point"]);
        addSubLayers(map, "test", "src-test", geomTypes, {}, {}, "some-before-layer");
        const beforeIdArg = map.addLayer.mock.calls[0][1];
        expect(beforeIdArg).toBe("some-before-layer");
    });

    it("passes undefined beforeId when not specified", () => {
        const geomTypes = new Set(["Point"]);
        addSubLayers(map, "test", "src-test", geomTypes, {}, {}, undefined);
        const beforeIdArg = map.addLayer.mock.calls[0][1];
        expect(beforeIdArg).toBeUndefined();
    });

    it("handles MultiPolygon geometry (creates fill + line)", () => {
        const geomTypes = new Set(["MultiPolygon"]);
        const created = addSubLayers(
            map,
            "mp",
            "src-mp",
            geomTypes,
            { fillColor: "#abc" },
            {},
            undefined
        );
        expect(created).toContain("fill");
        expect(created).toContain("line");
        expect(created).not.toContain("circle");
    });

    it("handles MultiPoint geometry (creates circle)", () => {
        const geomTypes = new Set(["MultiPoint"]);
        const created = addSubLayers(map, "mpt", "src-mpt", geomTypes, {}, {}, undefined);
        expect(created).toEqual(["circle"]);
    });

    it("handles MultiLineString geometry (creates line only)", () => {
        const geomTypes = new Set(["MultiLineString"]);
        const created = addSubLayers(
            map,
            "mls",
            "src-mls",
            geomTypes,
            { color: "#999" },
            {},
            undefined
        );
        expect(created).toEqual(["line"]);
    });

    it("returns empty array when no geometry types match", () => {
        const geomTypes = new Set(["GeometryCollection"]);
        const created = addSubLayers(map, "gc", "src-gc", geomTypes, {}, {}, undefined);
        expect(created).toEqual([]);
        expect(map.addLayer).not.toHaveBeenCalled();
    });

    it("spreads layoutBase into each layer definition", () => {
        const geomTypes = new Set(["Point"]);
        const layoutBase = { visibility: "none" };
        addSubLayers(map, "test", "src-test", geomTypes, {}, layoutBase, undefined);
        const layerDef = map.addLayer.mock.calls[0][0];
        expect(layerDef.layout).toEqual({ visibility: "none" });
        // Ensure it is a copy, not the same reference
        expect(layerDef.layout).not.toBe(layoutBase);
    });

    // ─── Hatch pattern integration ──────────────────────────────────────

    it("registers hatch pattern image before creating fill layer", () => {
        const geomTypes = new Set(["Polygon"]);
        const flat = {
            fillColor: "transparent",
            hatch: {
                enabled: true,
                type: "dot",
                spacingPx: 14,
                stroke: { color: "#c1eaff", widthPx: 1, opacity: 1 },
                renderMode: "pattern_only",
            },
        };
        addSubLayers(map, "pluv", "src-pluv", geomTypes, flat, {}, undefined);
        // Pattern should have been registered via map.addImage
        expect(map.addImage).toHaveBeenCalled();
        const patternId = map.addImage.mock.calls[0][0];
        expect(patternId).toContain("gl-hatch-pluv");
        // fill layer paint should include fill-pattern
        const fillLayerDef = map.addLayer.mock.calls[0][0];
        expect(fillLayerDef.paint["fill-pattern"]).toBe(patternId);
    });

    it("does NOT register hatch when not enabled", () => {
        const geomTypes = new Set(["Polygon"]);
        addSubLayers(map, "no-hatch", "src-no", geomTypes, { fillColor: "#abc" }, {}, undefined);
        expect(map.addImage).not.toHaveBeenCalled();
    });

    it("uses styleRulesToPaint for data-driven fill when styleRules provided", () => {
        const geomTypes = new Set(["Polygon"]);
        const flat = { fillColor: "#aaa" };
        const styleRules = [
            {
                when: { field: "class_id", operator: "==", value: 2 },
                style: { fillColor: "#bbb" },
            },
        ];
        addSubLayers(map, "dr", "src-dr", geomTypes, flat, {}, undefined, { styleRules });
        const fillLayerDef = map.addLayer.mock.calls[0][0];
        // fill-color should be a case expression (data-driven), not a static string
        expect(Array.isArray(fillLayerDef.paint["fill-color"])).toBe(true);
        expect(fillLayerDef.paint["fill-color"][0]).toBe("case");
    });
});

// ─── bindGeoJSONClusterEvents (S5.6) ───────────────────────────────────────

describe("bindGeoJSONClusterEvents", () => {
    let map;

    beforeEach(() => {
        map = maplibregl.__createMockMap();
    });

    it("registers click, mouseenter, mouseleave handlers on cluster layer", () => {
        bindGeoJSONClusterEvents(map, "src-clusters", "gl-clusters-layer");
        expect(map.on).toHaveBeenCalledWith("click", "gl-clusters-layer", expect.any(Function));
        expect(map.on).toHaveBeenCalledWith(
            "mouseenter",
            "gl-clusters-layer",
            expect.any(Function)
        );
        expect(map.on).toHaveBeenCalledWith(
            "mouseleave",
            "gl-clusters-layer",
            expect.any(Function)
        );
    });

    it("click handler calls getClusterExpansionZoom and flyTo on success", async () => {
        bindGeoJSONClusterEvents(map, "src-clusters", "gl-clusters-layer");
        const clickCall = map.on.mock.calls.find(
            (c) => c[0] === "click" && c[1] === "gl-clusters-layer"
        );
        expect(clickCall).toBeDefined();
        const handler = clickCall[2];
        // The mock addSource creates source with getClusterExpansionZoom resolving to 15
        map.addSource("src-clusters", { type: "geojson", cluster: true });
        const e = {
            features: [{ properties: { cluster_id: 42 } }],
            lngLat: { lng: -73, lat: 45 },
        };
        await handler(e);
        expect(map.flyTo).toHaveBeenCalledWith(expect.objectContaining({ zoom: 15 }));
    });

    it("click handler flyTo zoom+2 when getClusterExpansionZoom rejects", async () => {
        bindGeoJSONClusterEvents(map, "src-err", "gl-clusters-err");
        const clickCall = map.on.mock.calls.find(
            (c) => c[0] === "click" && c[1] === "gl-clusters-err"
        );
        const handler = clickCall[2];
        map.addSource("src-err", { type: "geojson", cluster: true });
        // Override getClusterExpansionZoom to reject
        map.getSource("src-err").getClusterExpansionZoom.mockRejectedValue(new Error("fail"));
        map.getZoom.mockReturnValue(10);
        const e = {
            features: [{ properties: { cluster_id: 99 } }],
            lngLat: { lng: -73, lat: 45 },
        };
        await handler(e);
        // flush microtask queue: rejection chain requires 2+ ticks
        await Promise.resolve();
        await Promise.resolve();
        expect(map.flyTo).toHaveBeenCalledWith(expect.objectContaining({ zoom: 12 }));
    });

    it("click handler is a no-op when features array is empty", () => {
        bindGeoJSONClusterEvents(map, "src-empty", "gl-clusters-empty");
        const clickCall = map.on.mock.calls.find(
            (c) => c[0] === "click" && c[1] === "gl-clusters-empty"
        );
        const handler = clickCall[2];
        expect(() => handler({ features: [], lngLat: { lng: 0, lat: 0 } })).not.toThrow();
        expect(map.flyTo).not.toHaveBeenCalled();
    });

    it("click handler is a no-op when cluster_id is undefined", () => {
        bindGeoJSONClusterEvents(map, "src-no-id", "gl-clusters-no-id");
        const clickCall = map.on.mock.calls.find(
            (c) => c[0] === "click" && c[1] === "gl-clusters-no-id"
        );
        const handler = clickCall[2];
        expect(() =>
            handler({
                features: [{ properties: {} }],
                lngLat: { lng: 0, lat: 0 },
            })
        ).not.toThrow();
        expect(map.flyTo).not.toHaveBeenCalled();
    });

    it("click handler is a no-op when source does not exist in map", () => {
        bindGeoJSONClusterEvents(map, "src-missing", "gl-clusters-miss");
        const clickCall = map.on.mock.calls.find(
            (c) => c[0] === "click" && c[1] === "gl-clusters-miss"
        );
        const handler = clickCall[2];
        // No addSource called for "src-missing"
        expect(() =>
            handler({
                features: [{ properties: { cluster_id: 1 } }],
                lngLat: { lng: 0, lat: 0 },
            })
        ).not.toThrow();
        expect(map.flyTo).not.toHaveBeenCalled();
    });

    it("mouseenter sets canvas cursor to pointer", () => {
        const canvas = { style: { cursor: "" } };
        map.getCanvas = vi.fn().mockReturnValue(canvas);
        bindGeoJSONClusterEvents(map, "src-cursor", "gl-clusters-cursor");
        const enterCall = map.on.mock.calls.find(
            (c) => c[0] === "mouseenter" && c[1] === "gl-clusters-cursor"
        );
        expect(enterCall).toBeDefined();
        enterCall[2]();
        expect(canvas.style.cursor).toBe("pointer");
    });

    it("mouseleave resets canvas cursor to empty string", () => {
        const canvas = { style: { cursor: "pointer" } };
        map.getCanvas = vi.fn().mockReturnValue(canvas);
        bindGeoJSONClusterEvents(map, "src-cursor2", "gl-clusters-cursor2");
        const leaveCall = map.on.mock.calls.find(
            (c) => c[0] === "mouseleave" && c[1] === "gl-clusters-cursor2"
        );
        expect(leaveCall).toBeDefined();
        leaveCall[2]();
        expect(canvas.style.cursor).toBe("");
    });
});

// ─── addSubLayers — showIconsOnMap (S5.6) ──────────────────────────────────

describe("addSubLayers — showIconsOnMap (S5.6)", () => {
    let map;

    beforeEach(() => {
        map = maplibregl.__createMockMap();
    });

    it("creates symbol layer when showIconsOnMap is true for Point geometry", () => {
        const geomTypes = new Set(["Point"]);
        const created = addSubLayers(
            map,
            "icons",
            "src-icons",
            geomTypes,
            {},
            { visibility: "visible" },
            undefined,
            { showIconsOnMap: true }
        );
        expect(created).toContain("symbol");
        const symbolLayer = map.addLayer.mock.calls.find((c) => c[0]?.type === "symbol");
        expect(symbolLayer).toBeDefined();
        expect(symbolLayer[0].layout["icon-image"]).toEqual(["get", "symbolId"]);
    });

    it("does not create symbol layer when showIconsOnMap is false", () => {
        const geomTypes = new Set(["Point"]);
        addSubLayers(map, "no-icons", "src-no", geomTypes, {}, {}, undefined, {
            showIconsOnMap: false,
        });
        const symbolLayer = map.addLayer.mock.calls.find((c) => c[0]?.type === "symbol");
        expect(symbolLayer).toBeUndefined();
    });
});

// ─── addSubLayers — casing (S5.6) ──────────────────────────────────────────

describe("addSubLayers — casing (S5.6)", () => {
    let map;

    beforeEach(() => {
        map = maplibregl.__createMockMap();
    });

    it("creates casing sub-layer when casing is enabled for LineString geometry", () => {
        const geomTypes = new Set(["LineString"]);
        const created = addSubLayers(
            map,
            "road",
            "src-road",
            geomTypes,
            { casing: { enabled: true, color: "#ffffff", widthPx: 2 } },
            {},
            undefined
        );
        expect(created).toContain("casing");
        const casingLayer = map.addLayer.mock.calls.find(
            (c) => c[0]?.id === toSubLayerId("road", "casing")
        );
        expect(casingLayer).toBeDefined();
        expect(casingLayer[0].type).toBe("line");
    });

    it("does not create casing layer when casing.enabled is false", () => {
        const geomTypes = new Set(["LineString"]);
        addSubLayers(
            map,
            "road-nc",
            "src-road-nc",
            geomTypes,
            { casing: { enabled: false } },
            {},
            undefined
        );
        const casingLayer = map.addLayer.mock.calls.find(
            (c) => c[0]?.id === toSubLayerId("road-nc", "casing")
        );
        expect(casingLayer).toBeUndefined();
    });
});

// ─── addSubLayers — minZoom / maxZoom (S5.6) ───────────────────────────────

describe("addSubLayers — minZoom / maxZoom (S5.6)", () => {
    let map;

    beforeEach(() => {
        map = maplibregl.__createMockMap();
    });

    it("applies minzoom to layer definition when minZoom option is provided", () => {
        const geomTypes = new Set(["Point"]);
        addSubLayers(map, "zoomed", "src-z", geomTypes, {}, {}, undefined, { minZoom: 8 });
        const layerDef = map.addLayer.mock.calls[0][0];
        expect(layerDef.minzoom).toBe(8);
    });

    it("applies maxzoom to layer definition when maxZoom option is provided", () => {
        const geomTypes = new Set(["Point"]);
        addSubLayers(map, "zoomed2", "src-z2", geomTypes, {}, {}, undefined, { maxZoom: 16 });
        const layerDef = map.addLayer.mock.calls[0][0];
        expect(layerDef.maxzoom).toBe(16);
    });

    it("does not set minzoom/maxzoom when options are not provided", () => {
        const geomTypes = new Set(["Point"]);
        addSubLayers(map, "no-zoom", "src-nz", geomTypes, {}, {}, undefined);
        const layerDef = map.addLayer.mock.calls[0][0];
        expect(layerDef.minzoom).toBeUndefined();
        expect(layerDef.maxzoom).toBeUndefined();
    });
});

// ─── addClusterSubLayers — minZoom / maxZoom (S5/N-1b) ─────────────────────────
// C'était le SEUL builder sans zoomProps : les 6 autres les posaient. Une couche
// clusterisée gardait donc ses pastilles hors de sa fenêtre d'échelle.

describe("addClusterSubLayers — minZoom / maxZoom (N-1b)", () => {
    let map;

    beforeEach(() => {
        map = maplibregl.__createMockMap();
    });

    it("applique la plage aux DEUX sous-couches de cluster", () => {
        addClusterSubLayers(map, "poi", "src-poi", {}, undefined, { minZoom: 6, maxZoom: 18 });
        const [cercles, compteur] = map.addLayer.mock.calls.map((c) => c[0]);
        expect(cercles.minzoom).toBe(6);
        expect(cercles.maxzoom).toBe(18);
        expect(compteur.minzoom).toBe(6);
        expect(compteur.maxzoom).toBe(18);
    });

    it("ne pose aucune borne quand aucune n'est fournie", () => {
        addClusterSubLayers(map, "poi", "src-poi", {}, undefined);
        const cercles = map.addLayer.mock.calls[0][0];
        expect(cercles.minzoom).toBeUndefined();
        expect(cercles.maxzoom).toBeUndefined();
    });
});
