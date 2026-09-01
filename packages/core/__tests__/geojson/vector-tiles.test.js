/**
 */
vi.mock("../../src/utils/log/index.js", () => ({
    Log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/utils/general/di-accessors.js", () => ({
    getLog: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

// var (not let/const) so jest.mock hoisting can access it via closure
let _sharedState;
vi.mock("../../src/kernel/geojson/shared.js", () => ({
    GeoJSONShared: {
        get state() {
            return _sharedState;
        },
    },
}));

const _g = typeof globalThis !== "undefined" ? globalThis : window;

// S5 (presets build): vector-tiles moved out of the geojson kernel into its own capability.
// The tests stay here — what they exercise is the layer-loading path, which is geojson's.
import { VectorTiles } from "../../src/capabilities/vector-tiles/vector-tiles.js";

describe("geojson/vector-tiles", () => {
    afterEach(() => {
        delete _g.L;
    });

    describe("shouldUseVectorTiles", () => {
        // No longer checks L.vectorGrid — requires an absolute tile URL.
        it("returns false when no vectorTiles config", () => {
            expect(VectorTiles.shouldUseVectorTiles({})).toBe(false);
            expect(VectorTiles.shouldUseVectorTiles({ id: "x" })).toBe(false);
        });
        it("returns false when vectorTiles.enabled is false", () => {
            expect(
                VectorTiles.shouldUseVectorTiles({
                    vectorTiles: {
                        enabled: false,
                        tilesUrl: "https://tiles.example.com/{z}/{x}/{y}.pbf",
                    },
                })
            ).toBe(false);
        });
        it("returns false when enabled but no url provided", () => {
            expect(VectorTiles.shouldUseVectorTiles({ vectorTiles: { enabled: true } })).toBe(
                false
            );
        });
        it("returns true when absolute https url is provided", () => {
            expect(
                VectorTiles.shouldUseVectorTiles({
                    vectorTiles: {
                        enabled: true,
                        tilesUrl: "https://tiles.example.com/{z}/{x}/{y}.pbf",
                    },
                })
            ).toBe(true);
        });
        it("returns true when url starts with /", () => {
            expect(
                VectorTiles.shouldUseVectorTiles({
                    vectorTiles: { enabled: true, tilesUrl: "/tiles/{z}/{x}/{y}.pbf" },
                })
            ).toBe(true);
        });
        it("returns false when url is a relative path", () => {
            expect(
                VectorTiles.shouldUseVectorTiles({
                    vectorTiles: { enabled: true, tilesUrl: "relative/tiles" },
                })
            ).toBe(false);
        });
    });

    describe("_getVTConfig", () => {
        it("returns null for null def", () => {
            expect(VectorTiles._getVTConfig(null)).toBeNull();
        });
        it("returns def.vectorTiles when object", () => {
            const vt = { enabled: true };
            expect(VectorTiles._getVTConfig({ vectorTiles: vt })).toBe(vt);
        });
        it("returns def.data.vectorTiles when def.vectorTiles missing", () => {
            const vt = { tilesUrl: "/tiles" };
            expect(VectorTiles._getVTConfig({ data: { vectorTiles: vt } })).toBe(vt);
        });
        it("returns null when neither present", () => {
            expect(VectorTiles._getVTConfig({ id: "x" })).toBeNull();
        });
    });

    describe("_resolveTileUrl", () => {
        it("returns vtConfig.url when url starts with http", () => {
            const def = {};
            const vtConfig = { tilesUrl: "https://tiles.example.com/{z}/{x}/{y}.pbf" };
            expect(VectorTiles._resolveTileUrl(def, vtConfig)).toBe(vtConfig.tilesUrl);
        });
        it("returns vtConfig.url when url starts with /", () => {
            const def = {};
            const vtConfig = { tilesUrl: "/tiles/{z}/{x}/{y}.pbf" };
            expect(VectorTiles._resolveTileUrl(def, vtConfig)).toBe(vtConfig.tilesUrl);
        });
        it("builds path from profileId and _layerDirectory when no absolute url", () => {
            const def = { _profileId: "p1", _layerDirectory: "layer-a" };
            const vtConfig = {};
            const before = _g.GeoLeaf;
            _g.GeoLeaf = undefined;
            expect(VectorTiles._resolveTileUrl(def, vtConfig)).toBe(
                "profiles/p1/layer-a/tiles/{z}/{x}/{y}.pbf"
            );
            _g.GeoLeaf = before;
        });
        it("uses Config.get data.profilesBasePath when available", () => {
            const def = { _profileId: "p1", _layerDirectory: "layer-a" };
            const vtConfig = { tilesDirectory: "vt" };
            const before = _g.GeoLeaf;
            _g.GeoLeaf = {
                Config: { get: (k) => (k === "data" ? { profilesBasePath: "custom" } : null) },
            };
            expect(VectorTiles._resolveTileUrl(def, vtConfig)).toBe(
                "custom/p1/layer-a/vt/{z}/{x}/{y}.pbf"
            );
            _g.GeoLeaf = before;
        });
        it("returns vtConfig.url when url starts with //", () => {
            const def = {};
            const vtConfig = { tilesUrl: "//cdn.example.com/tiles/{z}/{x}/{y}.pbf" };
            expect(VectorTiles._resolveTileUrl(def, vtConfig)).toBe(vtConfig.tilesUrl);
        });
        it("returns vtConfig.url when profileId missing (fallback)", () => {
            const def = { _layerDirectory: "d" };
            const vtConfig = { tilesUrl: "https://tiles.example.com/{z}/{x}/{y}.pbf" };
            expect(VectorTiles._resolveTileUrl(def, vtConfig)).toBe(vtConfig.tilesUrl);
        });
    });
});

describe("geojson/vector-tiles — branches T18", () => {
    let mockMap;
    let adapterMock;

    beforeEach(() => {
        // MapLibre native API — no Leaflet/VectorGrid dependency.
        mockMap = {
            addLayer: vi.fn(),
            removeLayer: vi.fn(),
            addSource: vi.fn(),
            getSource: vi.fn().mockReturnValue(undefined),
            getLayer: vi.fn().mockReturnValue(undefined),
            setPaintProperty: vi.fn(),
        };
        // Socle B.1: VT delegates all MapLibre building to the adapter.
        adapterMock = {
            addVectorTileLayer: vi.fn().mockReturnValue(["gl-layer1-fill"]),
            updateVectorTileLayerStyle: vi.fn(),
            getNativeMap: vi.fn().mockReturnValue(mockMap),
        };
        _g.GeoLeaf = { Core: { getMap: () => adapterMock } };
        _sharedState = {
            layers: new Map(),
            options: { defaultStyle: {}, maxZoomOnFit: 18 },
            map: mockMap,
        };
    });

    afterEach(() => {
        delete _g.L;
        delete _g.GeoLeaf;
        _sharedState = undefined;
    });

    // ── _resolveTileUrl missing branch ────────────────────────────
    describe("_resolveTileUrl — null fallback", () => {
        it("returns null when no url and no profileId/layerDir", () => {
            delete _g.GeoLeaf;
            expect(VectorTiles._resolveTileUrl({}, {})).toBeNull();
        });
    });

    // ── updateLayerStyle ─────────────────────────────────────────
    describe("updateLayerStyle", () => {
        it("returns early when no layerData", () => {
            expect(() => VectorTiles.updateLayerStyle("missing", {})).not.toThrow();
        });

        it("returns early when layerData.isVectorTile is false", () => {
            _sharedState.layers.set("l1", { isVectorTile: false });
            expect(() => VectorTiles.updateLayerStyle("l1", {})).not.toThrow();
        });

        it("returns early when vtLayer is null", () => {
            _sharedState.layers.set("l1", { isVectorTile: true, vtLayerName: "x", layer: null });
            expect(() => VectorTiles.updateLayerStyle("l1", {})).not.toThrow();
        });

        it("returns early when vtLayer has no options", () => {
            _sharedState.layers.set("l1", { isVectorTile: true, vtLayerName: "x", layer: {} });
            expect(() => VectorTiles.updateLayerStyle("l1", {})).not.toThrow();
        });

        it("delegates to adapter.updateVectorTileLayerStyle for existing sub-layers", () => {
            _sharedState.layers.set("l1", {
                isVectorTile: true,
                vtLayerName: "myLayer",
                layer: null,
                _maplibreSubLayerIds: ["l1-fill"],
            });
            VectorTiles.updateLayerStyle("l1", { defaultStyle: { color: "#f00" } });
            expect(adapterMock.updateVectorTileLayerStyle).toHaveBeenCalledWith(
                "l1",
                ["l1-fill"],
                expect.objectContaining({ resolvedStyle: { color: "#f00" } })
            );
        });

        it("does not throw when _maplibreSubLayerIds is empty", () => {
            _sharedState.layers.set("l1", {
                isVectorTile: true,
                vtLayerName: "myLayer",
                layer: null,
                _maplibreSubLayerIds: [],
            });
            expect(() => VectorTiles.updateLayerStyle("l1", null)).not.toThrow();
        });
    });

    // ── loadVectorTileLayer ──────────────────────────────────────
    describe("loadVectorTileLayer", () => {
        it("throws when no vtConfig", async () => {
            await expect(VectorTiles.loadVectorTileLayer("id1", "L", {}, {})).rejects.toThrow(
                "No vectorTiles config"
            );
        });

        it("throws when tileUrl cannot be resolved", async () => {
            // no _profileId/_layerDirectory, no url → null
            const def = { vectorTiles: { enabled: true } };
            await expect(VectorTiles.loadVectorTileLayer("id1", "L", def, {})).rejects.toThrow(
                "Cannot resolve tile URL"
            );
        });

        it("loads layer successfully and adds to state", async () => {
            const def = {
                id: "layer1",
                _profileId: "p1",
                _layerDirectory: "dir-a",
                vectorTiles: { enabled: true, interactive: false },
                zIndex: 450,
            };
            const result = await VectorTiles.loadVectorTileLayer("layer1", "Layer 1", def, {});
            expect(result).toMatchObject({ id: "layer1", isVectorTile: true, featureCount: 0 });
            expect(_sharedState.layers.has("layer1")).toBe(true);
            // Socle B.1: VT delegates building to the adapter (no direct native addSource).
            expect(adapterMock.addVectorTileLayer).toHaveBeenCalledWith(
                "layer1",
                expect.objectContaining({
                    tileUrl: expect.any(String),
                    sourceLayer: "layer1",
                    geometryType: expect.any(String),
                })
            );
        });

        it("calls LayerManager.updateLayerVisibilityByZoom when present", async () => {
            const updateFn = vi.fn();
            _g.GeoLeaf = {
                Core: { getMap: () => adapterMock },
                _GeoJSONLayerManager: { updateLayerVisibilityByZoom: updateFn },
            };
            const def = {
                id: "layer2",
                _profileId: "p1",
                _layerDirectory: "dir-b",
                vectorTiles: { enabled: true, interactive: false },
                zIndex: 450,
            };
            await VectorTiles.loadVectorTileLayer("layer2", "L", def, {});
            expect(updateFn).toHaveBeenCalled();
        });
    });
});
