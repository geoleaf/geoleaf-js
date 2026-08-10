/**
 * S5/P-1 — avertissement sur les points rendus sans clustering.
 *
 * L'avertissement d'origine vivait dans le monolithe POI (`poi/core.ts`, dissous en S9) et
 * a disparu avec lui : il n'existait plus AUCUN seuil, aucun garde-fou, aucune décimation.
 * La roadmap croyait « durcir un console.warn » — il n'y avait plus rien à durcir.
 *
 * Il était de toute façon quasi muet : sa condition exigeait `clustering === false`, une
 * égalité STRICTE, alors que le défaut est `undefined`. Il ne parlait donc QUE pour les
 * profils qui désactivaient explicitement le clustering — jamais pour le cas par défaut,
 * précisément celui qui dégrade le navigateur en silence.
 *
 * Ces tests verrouillent le nouveau : il parle dès que des points s'affichent réellement
 * sans cluster, quelle qu'en soit la raison.
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

/** FeatureCollection de `count` géométries du type demandé. */
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
        // `_cachedData` + `fromCache` : le chemin qui alimente le loader sans réseau.
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
        expect(message).toContain("clustering"); // dit quoi faire, pas seulement que ça va mal
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
