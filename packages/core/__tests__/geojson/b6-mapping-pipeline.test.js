/**
 * B.6 — runtime mapping pipeline (ANO-083 follow-up).
 *
 * Proves the wiring END-TO-END through the REAL single-layer loader:
 *   fetch raw external data  →  _applyDataMapping (data.mapping + data.itemsPath)
 *   →  ConfigNormalizer.normalizePoiWithMapping (per-source block, REAL)
 *   →  DataConverter.autoConvert (POI array → GeoJSON points, REAL)
 *   →  adapter.addGeoJSONLayer.
 *
 * Only the GeoJSON shared state + getLog are mocked; the normalizer and the data
 * converter are the real modules, so this exercises the actual transform.
 */
import {
    LoaderSingleLayer,
    setupSingleLayerDeps,
} from "../../src/kernel/geojson/loader/single-layer.js";
import { DataConverter } from "../../src/kernel/geojson/loader/data-converter.js";

const state = vi.hoisted(() => ({
    layers: new Map(),
    map: { addLayer: vi.fn(), fitBounds: vi.fn() },
    options: {},
    adapter: null,
}));

vi.mock("../../src/kernel/geojson/shared.js", () => ({
    GeoJSONShared: {
        state,
    },
}));

vi.mock("../../src/utils/general/di-accessors.js", () => ({
    getLog: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

// ── GBIF-shaped fixtures ──────────────────────────────────────────────────────

// mapping.json — one named per-source block "gbif" (the contract shape).
const MAPPING = {
    gbif: {
        source: "https://api.gbif.org/v1/occurrence/search",
        mapping: {
            id: "key",
            title: "vernacularName",
            description: "scientificName",
            category: "kingdom",
            "location.lat": "decimalLatitude",
            "location.lng": "decimalLongitude",
            "attributes.species": "species",
            "attributes.kingdom": "kingdom",
        },
    },
};

// GBIF Occurrence API response — the items array is nested under `results`.
const GBIF_RESPONSE = {
    offset: 0,
    limit: 2,
    endOfRecords: false,
    results: [
        {
            key: 123, // numeric — must be coerced to a string id
            vernacularName: "Jaguar",
            scientificName: "Panthera onca",
            kingdom: "Animalia",
            species: "Panthera onca",
            decimalLatitude: 4.5,
            decimalLongitude: -52.3,
        },
        {
            key: 456,
            vernacularName: "Ara rouge",
            scientificName: "Ara macao",
            kingdom: "Animalia",
            species: "Ara macao",
            decimalLatitude: 3.9,
            decimalLongitude: -53.1,
        },
    ],
};

function createMockAdapter() {
    return {
        addGeoJSONLayer: vi.fn(),
        getNativeMap: vi.fn(() => ({ on: vi.fn(), off: vi.fn() })),
        getLayerRegistry: vi.fn(() => ({ getSubLayerIds: vi.fn(() => []) })),
    };
}

function makeDeps(gleaf = {}) {
    return {
        getLayerManager: () => gleaf._GeoJSONLayerManager,
        getLoader: () => undefined,
        getConfig: () => gleaf.Config,
        getFeatureValidator: () => gleaf._GeoJSONFeatureValidator,
        getLayerConfig: () => gleaf._GeoJSONLayerConfig,
        getVectorTiles: () => gleaf._VectorTiles,
        getCluster: () => gleaf._Cluster,
        getUtils: () => gleaf.Utils,
        getNotifications: () => gleaf.Notifications,
        getCore: () => gleaf.Core,
        getPopupTooltip: () => gleaf._GeoJSONPopupTooltip,
        getLabels: () => gleaf.Labels,
        getWorkerManager: () => gleaf._WorkerManager,
        getDataConverter: () => gleaf._DataConverter,
        getNormalizer: () => gleaf._Normalizer,
        getAllLayerConfigs: () => gleaf._allLayerConfigs,
        setAllLayerConfigs: (configs) => {
            if (gleaf) gleaf._allLayerConfigs = configs;
        },
    };
}

function baseGeoLeaf(overrides = {}) {
    return {
        _WorkerManager: { isAvailable: () => false },
        _VectorTiles: null,
        _DataConverter: DataConverter, // REAL converter (POI array → GeoJSON points)
        _GeoJSONLayerConfig: {
            buildLayerOptions: () => ({}),
            inferGeometryType: () => "point",
            loadDefaultStyle: vi.fn().mockResolvedValue(null),
        },
        _GeoJSONLayerManager: {
            updateLayerVisibilityByZoom: vi.fn(),
            setLayerStyle: vi.fn(),
        },
        ThemeCache: { store: vi.fn() },
        ThemeSelector: null,
        Config: {
            getActiveProfileId: () => "guyane-biodiversite",
            get: () => null,
            getActiveProfileMapping: () => MAPPING,
        },
        Labels: null,
        Notifications: null,
        ...overrides,
    };
}

describe("B.6 — runtime mapping pipeline (single-layer loader)", () => {
    beforeEach(() => {
        state.layers = new Map();
        state.map = { addLayer: vi.fn(), fitBounds: vi.fn() };
        state.adapter = createMockAdapter();
        globalThis.GeoLeaf = baseGeoLeaf();
        setupSingleLayerDeps(makeDeps(globalThis.GeoLeaf));
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(GBIF_RESPONSE),
        });
    });

    afterEach(() => {
        globalThis.GeoLeaf = undefined;
        setupSingleLayerDeps(makeDeps({}));
        global.fetch = undefined;
    });

    it("normalizes a GBIF response (data.mapping + itemsPath) into GeoJSON points", async () => {
        const def = {
            url: "https://api.gbif.org/v1/occurrence/search?country=GF&limit=2",
            geometry: "point",
            data: { mapping: "gbif", itemsPath: "results" },
        };
        const result = await LoaderSingleLayer._loadSingleLayer(
            "observations_gbif",
            "GBIF",
            def,
            {}
        );

        expect(global.fetch).toHaveBeenCalledOnce();
        expect(state.adapter.addGeoJSONLayer).toHaveBeenCalledOnce();
        expect(result.featureCount).toBe(2);

        const fc = state.adapter.addGeoJSONLayer.mock.calls[0][1];
        expect(fc.type).toBe("FeatureCollection");
        expect(fc.features).toHaveLength(2);

        const jaguar = fc.features.find((f) => f.properties.title === "Jaguar");
        expect(jaguar).toBeDefined();
        // numeric GBIF `key` 123 → coerced string id
        expect(jaguar.properties.id).toBe("123");
        // location.lat/lng → GeoJSON [lng, lat]
        expect(jaguar.geometry).toEqual({ type: "Point", coordinates: [-52.3, 4.5] });
        // attributes flattened from the mapping
        expect(jaguar.properties.species).toBe("Panthera onca");
        expect(jaguar.properties.kingdom).toBe("Animalia");
    });

    it("passes raw data through untouched when no mapping.json is loaded", async () => {
        globalThis.GeoLeaf = baseGeoLeaf({
            Config: {
                getActiveProfileId: () => "x",
                get: () => null,
                getActiveProfileMapping: () => null, // mapping not loaded
            },
        });
        setupSingleLayerDeps(makeDeps(globalThis.GeoLeaf));
        // Already-GeoJSON response → autoConvert passes it through; mapping is a no-op.
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () =>
                Promise.resolve({
                    type: "FeatureCollection",
                    features: [
                        {
                            type: "Feature",
                            geometry: { type: "Point", coordinates: [2, 48] },
                            properties: { id: "a" },
                        },
                    ],
                }),
        });
        const def = {
            url: "https://example.com/data.geojson",
            geometry: "point",
            data: { mapping: "gbif", itemsPath: "results" },
        };
        const result = await LoaderSingleLayer._loadSingleLayer("x", "X", def, {});
        expect(result.featureCount).toBe(1);
        const fc = state.adapter.addGeoJSONLayer.mock.calls[0][1];
        expect(fc.features[0].properties.id).toBe("a");
    });

    it("does not touch a normal layer that declares no data.mapping", async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () =>
                Promise.resolve({
                    type: "FeatureCollection",
                    features: [
                        {
                            type: "Feature",
                            geometry: { type: "Point", coordinates: [1, 1] },
                            properties: { id: "p" },
                        },
                    ],
                }),
        });
        const def = { url: "https://example.com/plain.geojson", geometry: "point", data: {} };
        const result = await LoaderSingleLayer._loadSingleLayer("plain", "Plain", def, {});
        expect(result.featureCount).toBe(1);
    });
});
