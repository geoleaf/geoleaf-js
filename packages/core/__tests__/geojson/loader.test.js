/**
 * geojson/loader — shim re-exports + single-layer integration (static imports for Istanbul)
 */
import { LoaderProfile } from "../../src/kernel/geojson/loader/profile.js";
import { LoaderSingleLayer } from "../../src/kernel/geojson/loader/single-layer.js";

const state = vi.hoisted(() => ({ layers: new Map(), map: null, options: {}, adapter: null }));
vi.mock("../../src/kernel/geojson/shared.js", () => ({
    GeoJSONShared: {
        state,
    },
}));
vi.mock("../../src/capabilities/cluster/strategy.js", () => ({
    getClusteringStrategy: vi.fn(() => ({ shouldCluster: false, useSharedCluster: false })),
}));
vi.mock("../../src/utils/general/di-accessors.js", () => ({
    getLog: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

describe("geojson/loader", () => {
    it("re-exports LoaderProfile, LoaderSingleLayer", () => {
        expect(LoaderProfile).toBeDefined();
        expect(LoaderSingleLayer).toBeDefined();
    });

    describe("LoaderSingleLayer._loadSingleLayer", () => {
        const _g = typeof globalThis !== "undefined" ? globalThis : window;

        beforeEach(() => {
            state.layers = new Map();
            state.map = null;
            state.adapter = null;
            _g.GeoLeaf = undefined;
        });

        it("rejects when fetch returns HTTP error (no worker path)", async () => {
            _g.GeoLeaf = {
                _WorkerManager: { isAvailable: () => false },
                _VectorTiles: null,
                _DataConverter: { autoConvert: (x) => x },
                _GeoJSONLayerConfig: {
                    buildLayerOptions: () => ({}),
                    inferGeometryType: () => "point",
                },
            };
            global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404 }));
            await expect(
                LoaderSingleLayer._loadSingleLayer(
                    "lyr1",
                    "Layer 1",
                    { url: "https://example.com/data.json" },
                    {}
                )
            ).rejects.toThrow(/HTTP.*404/);
        });

        it("resolves with featureCount when def._cachedData is GeoJSON (inline)", async () => {
            state.adapter = {
                addGeoJSONLayer: vi.fn(),
                getNativeMap: vi.fn(() => ({ on: vi.fn(), off: vi.fn() })),
                getLayerRegistry: vi.fn(() => ({ getSubLayerIds: vi.fn(() => []) })),
            };
            _g.GeoLeaf = {
                _WorkerManager: { isAvailable: () => false },
                _VectorTiles: null,
                _DataConverter: { autoConvert: (x) => x },
                _GeoJSONLayerConfig: {
                    buildLayerOptions: () => ({}),
                    inferGeometryType: () => "point",
                },
                _GeoJSONLayerManager: { updateLayerVisibilityByZoom: vi.fn() },
                ThemeCache: { store: vi.fn() },
                Config: { getActiveProfileId: () => null, get: () => null },
            };
            const def = {
                _cachedData: {
                    type: "FeatureCollection",
                    features: [
                        {
                            type: "Feature",
                            geometry: { type: "Point", coordinates: [2, 48] },
                            properties: {},
                        },
                    ],
                },
                id: "lyr1",
                zIndex: 10,
            };
            const result = await LoaderSingleLayer._loadSingleLayer("lyr1", "Layer 1", def, {});
            expect(result).toEqual({ id: "lyr1", label: "Layer 1", featureCount: 1 });
        });
    });
});
