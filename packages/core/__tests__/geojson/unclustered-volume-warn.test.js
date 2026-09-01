/**
 * Warning on points rendered without clustering.
 *
 * The original warning lived in the POI monolith (`poi/core.ts`, long
 * dissolved) and vanished with it: NO threshold, no guardrail, no decimation
 * existed any more. The plan believed it was "hardening a console.warn" —
 * there was nothing left to harden.
 *
 * It was near mute anyway: its condition required `clustering === false`, a
 * STRICT equality, while the default is `undefined`. It thus only spoke for
 * profiles explicitly disabling clustering — never for the default case,
 * precisely the one that degrades the browser silently.
 *
 * These tests lock the new one: it speaks as soon as points really display
 * unclustered, whatever the reason.
 */
import {
    LoaderSingleLayer,
    setupSingleLayerDeps,
} from "../../src/kernel/geojson/loader/single-layer.js";

const warn = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/general/di-accessors.js", () => ({
    getLog: () => ({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }),
}));

const state = vi.hoisted(() => ({
    layers: new Map(),
    map: null,
    options: {},
    adapter: null,
}));
vi.mock("../../src/kernel/geojson/shared.js", () => ({
    GeoJSONShared: { state },
}));

/** FeatureCollection of `count` geometries of the requested type. */
const makeData = (count, type = "Point") => ({
    type: "FeatureCollection",
    features: Array.from({ length: count }, (_, i) => ({
        type: "Feature",
        properties: { id: `f${i}` },
        geometry: {
            type,
            coordinates:
                type === "Point"
                    ? [0, 0]
                    : [
                          [
                              [0, 0],
                              [1, 0],
                              [1, 1],
                              [0, 0],
                          ],
                      ],
        },
    })),
});

function makeDeps(shouldCluster) {
    return {
        getLayerManager: () => ({ updateLayerVisibilityByZoom: vi.fn(), setLayerStyle: vi.fn() }),
        getLoader: () => undefined,
        getConfig: () => ({ getActiveProfileId: () => null, get: () => null }),
        getFeatureValidator: () => undefined,
        getLayerConfig: () => ({
            buildLayerOptions: () => ({}),
            inferGeometryType: () => "point",
            loadDefaultStyle: vi.fn().mockResolvedValue(null),
        }),
        getVectorTiles: () => null,
        getCluster: () => ({
            getClusteringStrategy: () => ({ shouldCluster, useSharedCluster: false }),
            applyGeoJSONClusterOptions: vi.fn(),
        }),
        getUtils: () => undefined,
        getNotifications: () => null,
        getCore: () => undefined,
        getPopupTooltip: () => undefined,
        getLabels: () => null,
        getWorkerManager: () => ({ isAvailable: () => false }),
        getDataConverter: () => ({ autoConvert: (x) => x }),
        getNormalizer: () => undefined,
        getAllLayerConfigs: () => undefined,
        setAllLayerConfigs: () => {},
    };
}

describe("geojson/loader — avertissement volume non clusterisé (P-1)", () => {
    beforeEach(() => {
        warn.mockClear();
        state.layers = new Map();
        state.map = { addLayer: vi.fn(), fitBounds: vi.fn(), getCenter: () => ({ lat: 4 }) };
        state.adapter = {
            addGeoJSONLayer: vi.fn(),
            setLayerZoomRange: vi.fn(),
            showLayer: vi.fn(),
            hideLayer: vi.fn(),
            getNativeMap: () => state.map,
        };
        globalThis.GeoLeaf = { Config: { get: () => null, getActiveProfileId: () => null } };
    });

    afterEach(() => {
        globalThis.GeoLeaf = undefined;
    });

    const volumeWarnings = () =>
        warn.mock.calls.filter((c) => String(c[0]).includes("unclustered"));

    async function load(count, { type = "Point", shouldCluster = false } = {}) {
        setupSingleLayerDeps(makeDeps(shouldCluster));
        // `_cachedData` + `fromCache`: the path feeding the loader without network.
        await LoaderSingleLayer._loadSingleLayer(
            "lyr",
            "Ma couche",
            { _cachedData: makeData(count, type) },
            {}
        );
    }

    it("avertit au-delà du seuil quand les points ne sont pas clusterisés", async () => {
        await load(1001);
        expect(volumeWarnings()).toHaveLength(1);
        const message = volumeWarnings()[0][0];
        expect(message).toContain("Ma couche");
        expect(message).toContain("1001");
        expect(message).toContain("clustering"); // says what to do, not only that things are bad
    });

    it("reste muet pile au seuil", async () => {
        await load(1000);
        expect(volumeWarnings()).toHaveLength(0);
    });

    it("reste muet quand la couche EST clusterisée — c'est déjà la parade", async () => {
        await load(5000, { shouldCluster: true });
        expect(volumeWarnings()).toHaveLength(0);
    });

    it("ignore les polygones : le clustering ne vise que les points", async () => {
        await load(5000, { type: "Polygon" });
        expect(volumeWarnings()).toHaveLength(0);
    });
});
