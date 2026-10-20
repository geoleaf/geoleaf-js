/**
 * Unit tests — capabilities/cluster strategy (revived S3).
 *
 * Behaviour ported from the former geojson/clustering.ts getClusteringStrategy —
 * now reading `modules.cluster` through the typed Config singleton (mocked here)
 * instead of the former `poiConfig` global seam. Adds the capability enable gate.
 */
import { describe, it, expect, afterEach, vi } from "vitest";

const { configGet } = vi.hoisted(() => ({ configGet: vi.fn() }));

vi.mock("../../../src/kernel/config/config-primitives.js", () => ({
    Config: { get: (...a) => configGet(...a) },
}));
vi.mock("../../../src/utils/general/di-accessors.js", () => ({
    getLog: () => ({ warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

const { getClusteringStrategy } = await import("../../../src/capabilities/cluster/strategy.ts");

const POINTS = { features: [{ geometry: { type: "Point" } }] };
const LINES = { features: [{ geometry: { type: "LineString" } }] };
const NONE = { shouldCluster: false };
const CLUSTERED = { shouldCluster: true };

/** Seeds `modules.cluster`; every other config path returns the passed default. */
function setCluster(cluster) {
    configGet.mockImplementation((k, d) => (k === "modules.cluster" ? cluster : d));
}

afterEach(() => configGet.mockReset());

describe("getClusteringStrategy — capability gate", () => {
    it("returns NONE when the capability is disabled (modules.cluster.enabled:false)", () => {
        setCluster({ enabled: false, clustering: true });
        expect(getClusteringStrategy({ clustering: true }, POINTS)).toEqual(NONE);
    });

    it("opt-out default: enabled true when modules.cluster is absent", () => {
        configGet.mockImplementation((_k, d) => d);
        // global clustering undefined + no per-layer opt-in → NONE (no clustering)
        expect(getClusteringStrategy({}, POINTS)).toEqual(NONE);
        // but a per-layer opt-in still clusters (capability active by default)
        expect(getClusteringStrategy({ clustering: { enabled: true } }, POINTS)).toEqual(CLUSTERED);
    });
});

describe("getClusteringStrategy — global gate (modules.cluster.clustering)", () => {
    it("false + no layer override → NONE", () => {
        setCluster({ clustering: false });
        expect(getClusteringStrategy({}, POINTS)).toEqual(NONE);
    });
    it("true + unified → clusters", () => {
        setCluster({ clustering: true, clusterStrategy: "unified" });
        expect(getClusteringStrategy({}, POINTS)).toEqual(CLUSTERED);
    });
    it("no Point geometry → never clusters", () => {
        setCluster({ clustering: true, clusterStrategy: "unified" });
        expect(getClusteringStrategy({ clustering: { enabled: true } }, LINES)).toEqual(NONE);
    });
    it("undefined features → NONE", () => {
        setCluster({ clustering: true });
        expect(getClusteringStrategy({ clustering: true }, {})).toEqual(NONE);
    });
});

describe("getClusteringStrategy — canonical clusterStrategy", () => {
    it("by-source (default sources) → clusters", () => {
        setCluster({ clustering: true, clusterStrategy: "by-source" });
        expect(getClusteringStrategy({}, POINTS)).toEqual(CLUSTERED);
    });
    it("by-source honours sources.geojson:false → NONE", () => {
        setCluster({
            clustering: true,
            clusterStrategy: "by-source",
            clusterStrategies: { "by-source": { sources: { geojson: false } } },
        });
        expect(getClusteringStrategy({}, POINTS)).toEqual(NONE);
    });
    it("json-only default → no GeoJSON clustering", () => {
        setCluster({ clustering: true, clusterStrategy: "json-only" });
        expect(getClusteringStrategy({}, POINTS)).toEqual(NONE);
    });
    it("json-only + geojsonClustering:true → clusters", () => {
        setCluster({
            clustering: true,
            clusterStrategy: "json-only",
            clusterStrategies: { "json-only": { geojsonClustering: true } },
        });
        expect(getClusteringStrategy({}, POINTS)).toEqual(CLUSTERED);
    });
    it("by-layer + layer silent → NONE (no per-layer opt-in)", () => {
        setCluster({ clustering: true, clusterStrategy: "by-layer" });
        expect(getClusteringStrategy({}, POINTS)).toEqual(NONE);
    });
    it("unknown strategy → defaults to unified (clusters)", () => {
        setCluster({ clustering: true, clusterStrategy: "nope-xyz" });
        expect(getClusteringStrategy({}, POINTS)).toEqual(CLUSTERED);
    });
    it("absent strategy → unified fallback (clusters)", () => {
        setCluster({ clustering: true });
        expect(getClusteringStrategy({}, POINTS)).toEqual(CLUSTERED);
    });
});

/**
 * B.34 — `clusterStrategies` is now declared in CLUSTER_CAPABILITY.configSchema with
 * `default: {}`. These two pin that the declared default is the REAL one: both read
 * sites fall back to an empty object, so an absent map and an empty map behave
 * identically on the only two strategies that consult it.
 */
describe("getClusteringStrategy — clusterStrategies absent ≡ {} (declared default)", () => {
    it("by-source: absent map and empty map both cluster", () => {
        setCluster({ clustering: true, clusterStrategy: "by-source" });
        const absent = getClusteringStrategy({}, POINTS);
        setCluster({ clustering: true, clusterStrategy: "by-source", clusterStrategies: {} });
        expect(getClusteringStrategy({}, POINTS)).toEqual(absent);
    });
    it("json-only: absent map and empty map both refuse to cluster", () => {
        setCluster({ clustering: true, clusterStrategy: "json-only" });
        const absent = getClusteringStrategy({}, POINTS);
        setCluster({ clustering: true, clusterStrategy: "json-only", clusterStrategies: {} });
        expect(getClusteringStrategy({}, POINTS)).toEqual(absent);
    });
});

describe("getClusteringStrategy — per-layer override (def.clustering)", () => {
    it("enabled:false forces NONE even if global clustering is on", () => {
        setCluster({ clustering: true, clusterStrategy: "unified" });
        expect(getClusteringStrategy({ clustering: { enabled: false } }, POINTS)).toEqual(NONE);
    });
    it("enabled:true clusters even if global clustering is off", () => {
        setCluster({ clustering: false, clusterStrategy: "unified" });
        expect(getClusteringStrategy({ clustering: { enabled: true } }, POINTS)).toEqual(CLUSTERED);
    });
    it("by-layer strategy with layer enabled → clusters", () => {
        setCluster({ clustering: true, clusterStrategy: "by-layer" });
        expect(getClusteringStrategy({ clustering: { enabled: true } }, POINTS)).toEqual(CLUSTERED);
    });
});

// A per-layer radius or zoom used to decide whether the layer got its OWN cluster rather than a
// shared one. Nothing is shared any more: they shape the cluster, never whether there is one.
describe("getClusteringStrategy — a radius or zoom of the layer never decides whether it clusters", () => {
    it.each([
        ["maxClusterRadius", { clustering: { enabled: true, maxClusterRadius: 50 } }],
        ["disableClusteringAtZoom", { clustering: { enabled: true, disableClusteringAtZoom: 10 } }],
        [
            "root clusterRadius",
            { clustering: true, clusterRadius: 60, disableClusteringAtZoom: 14 },
        ],
    ])("%s → clusters, like the same layer without it", (_name, def) => {
        setCluster({ clustering: true, clusterStrategy: "unified", clusterRadius: 80 });
        expect(getClusteringStrategy(def, POINTS)).toEqual(CLUSTERED);
    });
});

// 🛑 A SOURCE IS CLUSTERED OR NOT FOR GOOD, AT CREATION. The strategy read the first batch
// alone, so a point layer created empty and filled afterwards was never clustered.
describe("getClusteringStrategy — une couche servie VIDE", () => {
    const EMPTY = { features: [] };

    it("déclarée en points, elle est regroupée comme si elle en portait", () => {
        setCluster({ clustering: true });
        expect(getClusteringStrategy({ geometry: "point" }, EMPTY)).toEqual(CLUSTERED);
        expect(
            getClusteringStrategy({ geometry: "point", clustering: { enabled: true } }, EMPTY)
        ).toEqual(CLUSTERED);
    });

    it("les deux orthographes de la déclaration sont lues, dans les deux vocabulaires", () => {
        setCluster({ clustering: true });
        expect(getClusteringStrategy({ geometryType: "point" }, EMPTY)).toEqual(CLUSTERED);
        expect(getClusteringStrategy({ geometry: "MultiPoint" }, EMPTY)).toEqual(CLUSTERED);
    });

    // A clustered source indexes points alone: lines and polygons written to it later would
    // not be drawn. Only a declared point family may answer for an empty collection.
    it("sans déclaration, ou déclarée autrement qu'en points, elle n'est PAS regroupée", () => {
        setCluster({ clustering: true });
        expect(getClusteringStrategy({}, EMPTY)).toEqual(NONE);
        expect(getClusteringStrategy({ geometry: "polygon" }, EMPTY)).toEqual(NONE);
        expect(getClusteringStrategy({ geometry: "mixed" }, EMPTY)).toEqual(NONE);
        expect(getClusteringStrategy({ geometry: "point" }, {})).toEqual(CLUSTERED);
    });

    it("la donnée qui montre des entités l'emporte sur la déclaration", () => {
        setCluster({ clustering: true });
        expect(getClusteringStrategy({ geometry: "point" }, LINES)).toEqual(NONE);
        expect(getClusteringStrategy({ geometry: "polygon" }, POINTS)).toEqual(CLUSTERED);
    });

    it("les refus d'avant tiennent : capacité coupée, couche qui s'y oppose", () => {
        setCluster({ enabled: false, clustering: true });
        expect(getClusteringStrategy({ geometry: "point" }, EMPTY)).toEqual(NONE);
        setCluster({ clustering: true });
        expect(getClusteringStrategy({ geometry: "point", clustering: false }, EMPTY)).toEqual(
            NONE
        );
    });
});
