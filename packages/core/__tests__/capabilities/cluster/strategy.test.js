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
const NONE = { shouldCluster: false, useSharedCluster: false };
const SHARED = { shouldCluster: true, useSharedCluster: true };

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
        expect(getClusteringStrategy({ clustering: { enabled: true } }, POINTS)).toEqual(SHARED);
    });
});

describe("getClusteringStrategy — global gate (modules.cluster.clustering)", () => {
    it("false + no layer override → NONE", () => {
        setCluster({ clustering: false });
        expect(getClusteringStrategy({}, POINTS)).toEqual(NONE);
    });
    it("true + unified → shared cluster", () => {
        setCluster({ clustering: true, clusterStrategy: "unified" });
        expect(getClusteringStrategy({}, POINTS)).toEqual(SHARED);
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
    it("by-source (default sources) → clusters, not shared", () => {
        setCluster({ clustering: true, clusterStrategy: "by-source" });
        expect(getClusteringStrategy({}, POINTS)).toEqual({
            shouldCluster: true,
            useSharedCluster: false,
        });
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
    it("json-only + geojsonClustering:true → clusters, not shared", () => {
        setCluster({
            clustering: true,
            clusterStrategy: "json-only",
            clusterStrategies: { "json-only": { geojsonClustering: true } },
        });
        expect(getClusteringStrategy({}, POINTS)).toEqual({
            shouldCluster: true,
            useSharedCluster: false,
        });
    });
    it("by-layer + layer silent → NONE (no per-layer opt-in)", () => {
        setCluster({ clustering: true, clusterStrategy: "by-layer" });
        expect(getClusteringStrategy({}, POINTS)).toEqual(NONE);
    });
    it("unknown strategy → defaults to unified (shared)", () => {
        setCluster({ clustering: true, clusterStrategy: "nope-xyz" });
        expect(getClusteringStrategy({}, POINTS)).toEqual(SHARED);
    });
    it("absent strategy → unified fallback (shared)", () => {
        setCluster({ clustering: true });
        expect(getClusteringStrategy({}, POINTS)).toEqual(SHARED);
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
        expect(getClusteringStrategy({ clustering: { enabled: true } }, POINTS)).toEqual(SHARED);
    });
    it("by-layer strategy with layer enabled → clusters, not shared", () => {
        setCluster({ clustering: true, clusterStrategy: "by-layer" });
        expect(getClusteringStrategy({ clustering: { enabled: true } }, POINTS)).toEqual({
            shouldCluster: true,
            useSharedCluster: false,
        });
    });
});

describe("getClusteringStrategy — radius/zoom override vs defaults (ANO-031 parity)", () => {
    it("maxClusterRadius ≠ config.clusterRadius → independent (non-shared) cluster", () => {
        setCluster({ clustering: true, clusterStrategy: "unified", clusterRadius: 80 });
        expect(
            getClusteringStrategy({ clustering: { enabled: true, maxClusterRadius: 50 } }, POINTS)
        ).toEqual({ shouldCluster: true, useSharedCluster: false });
    });
    it("maxClusterRadius == config.clusterRadius → shared (no override)", () => {
        setCluster({ clustering: true, clusterStrategy: "unified", clusterRadius: 50 });
        expect(
            getClusteringStrategy({ clustering: { enabled: true, maxClusterRadius: 50 } }, POINTS)
        ).toEqual(SHARED);
    });
    it("disableClusteringAtZoom ≠ applied default → independent cluster", () => {
        setCluster({ clustering: true, clusterStrategy: "unified" });
        expect(
            getClusteringStrategy(
                { clustering: { enabled: true, disableClusteringAtZoom: 10 } },
                POINTS
            )
        ).toEqual({ shouldCluster: true, useSharedCluster: false });
    });
    it("disableClusteringAtZoom == applied default (14) → shared, not an override (S6: baseline aligned 18→14)", () => {
        setCluster({ clustering: true, clusterStrategy: "unified" });
        expect(
            getClusteringStrategy(
                { clustering: { enabled: true, disableClusteringAtZoom: 14 } },
                POINTS
            )
        ).toEqual(SHARED);
    });
    it("normalized form (clustering:true + root clusterRadius) drives the override", () => {
        setCluster({ clustering: true, clusterStrategy: "unified", clusterRadius: 80 });
        expect(
            getClusteringStrategy(
                { clustering: true, clusterRadius: 60, disableClusteringAtZoom: 14 },
                POINTS
            )
        ).toEqual({ shouldCluster: true, useSharedCluster: false });
    });
    it("def.clusterRadius used when maxClusterRadius absent", () => {
        setCluster({ clustering: true });
        expect(
            getClusteringStrategy({ clustering: { enabled: true }, clusterRadius: 42 }, POINTS)
        ).toEqual({ shouldCluster: true, useSharedCluster: false });
    });
});
