/**
 * Unit tests — kernel/geojson/layers-public-api.ts (the `GeoLeaf.Layers` seam, D1).
 *
 * Exercises the promotion of the per-layer GeoJSON store: reads, base-dataset
 * writes, unit mutations, dedup-merge, the reactive-paint passthrough and the
 * non-mutating visible-subset. The store (`GeoJSONShared.state`) is seeded
 * directly and the adapter is a spy — no MapLibre map is involved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { buildLayersPublicApi } = await import("../../src/kernel/geojson/layers-public-api.ts");
const { GeoJSONShared } = await import("../../src/kernel/geojson/shared.ts");

/** Builds a point feature carrying its id on both `id` and `properties.id`. */
function pt(id, extra = {}) {
    return {
        type: "Feature",
        id,
        geometry: { type: "Point", coordinates: [0, 0] },
        properties: { id, ...extra },
    };
}

let api;
let adapter;

beforeEach(() => {
    GeoJSONShared.reset();
    adapter = {
        updateLayerData: vi.fn(),
        setFeatureState: vi.fn(),
        setLayerFilter: vi.fn(),
    };
    GeoJSONShared.state.adapter = adapter;
    GeoJSONShared.state.layers.set("L1", {
        id: "L1",
        config: {},
        geometryType: "point",
        features: [pt("a"), pt("b"), pt("c")],
    });
    GeoJSONShared.state.layers.set("L2", {
        id: "L2",
        config: {},
        geometryType: "point",
        features: [pt("x")],
    });
    api = buildLayersPublicApi();
});

afterEach(() => {
    GeoJSONShared.reset();
    vi.restoreAllMocks();
});

describe("reads (GeoJSONCore promotion)", () => {
    it("getFeatures returns a layer's features; [] for unknown", () => {
        expect(api.getFeatures("L1").map((f) => f.properties.id)).toEqual(["a", "b", "c"]);
        expect(api.getFeatures("nope")).toEqual([]);
    });

    it("getFeatureById matches by id; null when absent", () => {
        expect(api.getFeatureById("L1", "b")?.properties.id).toBe("b");
        expect(api.getFeatureById("L1", "zzz")).toBeNull();
    });

    it("getFeatureCount reflects the stored length", () => {
        expect(api.getFeatureCount("L1")).toBe(3);
        expect(api.getFeatureCount("nope")).toBe(0);
    });

    it("listLayerIds enumerates every layer", () => {
        expect(api.listLayerIds().sort()).toEqual(["L1", "L2"]);
    });

    it("hasLayer tests existence", () => {
        expect(api.hasLayer("L1")).toBe(true);
        expect(api.hasLayer("nope")).toBe(false);
    });
});

describe("base dataset writes", () => {
    it("setData replaces the base and re-renders via the adapter", () => {
        api.setData("L1", [pt("z")]);
        expect(api.getFeatures("L1").map((f) => f.properties.id)).toEqual(["z"]);
        expect(adapter.updateLayerData).toHaveBeenCalledWith(
            "L1",
            expect.objectContaining({ type: "FeatureCollection" })
        );
    });

    it("clear empties the layer", () => {
        api.clear("L1");
        expect(api.getFeatureCount("L1")).toBe(0);
    });

    it("addFeature appends one feature", () => {
        api.addFeature("L1", pt("d"));
        expect(api.getFeatures("L1").map((f) => f.properties.id)).toEqual(["a", "b", "c", "d"]);
    });

    it("removeFeature removes by id (true) / no-op when absent (false)", () => {
        expect(api.removeFeature("L1", "b")).toBe(true);
        expect(api.getFeatures("L1").map((f) => f.properties.id)).toEqual(["a", "c"]);
        expect(api.removeFeature("L1", "zzz")).toBe(false);
    });
});

describe("unit mutations", () => {
    it("updateFeatureId re-keys both feature.id and properties.id", () => {
        api.updateFeatureId("L1", "a", "a-server");
        const f = api.getFeatureById("L1", "a-server");
        expect(f).not.toBeNull();
        expect(f.id).toBe("a-server");
        expect(f.properties.id).toBe("a-server");
        expect(api.getFeatureById("L1", "a")).toBeNull();
    });

    it("patchFeature bakes into properties SILENTLY (no source rebuild) by default", () => {
        api.patchFeature("L1", "a", { _syncStatus: "pending" });
        expect(api.getFeatureById("L1", "a").properties._syncStatus).toBe("pending");
        expect(adapter.updateLayerData).not.toHaveBeenCalled();
    });

    it("patchFeature re-renders when opts.rerender is set", () => {
        api.patchFeature("L1", "a", { _syncStatus: "pending" }, { rerender: true });
        expect(adapter.updateLayerData).toHaveBeenCalledWith(
            "L1",
            expect.objectContaining({ type: "FeatureCollection" })
        );
    });
});

describe("mergeFeatures (offline replay, dedup by id)", () => {
    it("upserts by id — existing entries replaced in place, new ones appended", () => {
        api.mergeFeatures("L1", [pt("b", { v: 2 }), pt("d")]);
        expect(api.getFeatures("L1").map((f) => f.properties.id)).toEqual(["a", "b", "c", "d"]);
        // "b" was replaced (not duplicated): the merged copy carries v:2.
        expect(api.getFeatureById("L1", "b").properties.v).toBe(2);
    });
});

describe("setVisibleSubset (base NEVER mutated)", () => {
    it("applies a GPU id-filter for the matching subset without touching the base", () => {
        api.setVisibleSubset("L1", (f) => f.properties.id !== "b");

        // Semantic check: the base dataset still holds ALL three features.
        expect(GeoJSONShared.state.layers.get("L1").features.map((f) => f.properties.id)).toEqual([
            "a",
            "b",
            "c",
        ]);
        // The visible subset {a,c} is applied on the GPU (match-by-id), not re-fed.
        expect(adapter.setLayerFilter).toHaveBeenCalledTimes(1);
        const [lid, filter] = adapter.setLayerFilter.mock.calls[0];
        expect(lid).toBe("L1");
        expect(filter).toEqual(["match", ["to-string", ["get", "id"]], ["a", "c"], true, false]);
        expect(adapter.updateLayerData).not.toHaveBeenCalled();
    });

    it("clearVisibleSubset clears the filter and leaves the base intact", () => {
        api.setVisibleSubset("L1", (f) => f.properties.id === "a");
        adapter.setLayerFilter.mockClear();

        api.clearVisibleSubset("L1");
        // All features visible again → filter cleared (null).
        expect(adapter.setLayerFilter).toHaveBeenCalledWith("L1", null);
        expect(api.getFeatureCount("L1")).toBe(3);
    });
});

describe("setFeatureState (adapter passthrough)", () => {
    it("forwards to adapter.setFeatureState with the same arguments", () => {
        api.setFeatureState("L1", "a", { syncStatus: "pending" });
        expect(adapter.setFeatureState).toHaveBeenCalledWith("L1", "a", { syncStatus: "pending" });
    });

    it("is a safe no-op when the adapter has no setFeatureState", () => {
        GeoJSONShared.state.adapter = { updateLayerData: vi.fn() };
        expect(() => api.setFeatureState("L1", "a", { hover: true })).not.toThrow();
    });
});
