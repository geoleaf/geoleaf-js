/**
 * `geoleaf:layer:updated` and `hideFeatures` — the two members `GeoLeaf.Layers` gains in 3.12.0.
 *
 * ① The event. The store changed by unit mutations and announced none: the open table and the
 *   active filter, which derive from it, kept a stale view (measured on 27/09/2026, `e2e/69`).
 *   What is pinned here is WHEN it fires — once per mutation that changed something, and never
 *   for what does not change the store: a silent patch, a missing id, an unknown layer.
 * ② The hidden set. Hiding an edited feature wrote the layer's filter and replaced the panel's;
 *   `hideFeatures` writes its own owner's slot (`setLayerFilter`'s third argument).
 *
 * Every case marked `🛑` is a TARGET, seen red before the change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LayerDataApi } from "../../src/contracts/layer-data.contract.js";

const { buildLayersPublicApi } = await import("../../src/kernel/geojson/layers-public-api.ts");
const { GeoJSONShared } = await import("../../src/kernel/geojson/shared.ts");
const { GeoJSONCore } = await import("../../src/kernel/geojson/core.ts");

const pt = (id: string): GeoJSON.Feature => ({
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates: [0, 0] },
    properties: { id },
});

let api: LayerDataApi;
let adapter: {
    updateLayerData: ReturnType<typeof vi.fn>;
    applyDataDiff: ReturnType<typeof vi.fn>;
    setFeatureState: ReturnType<typeof vi.fn>;
    setLayerFilter: ReturnType<typeof vi.fn>;
};
let seen: string[];
const record = (e: Event) => seen.push((e as CustomEvent<{ layerId: string }>).detail.layerId);

beforeEach(() => {
    GeoJSONShared.reset();
    adapter = {
        updateLayerData: vi.fn(),
        applyDataDiff: vi.fn(() => true),
        setFeatureState: vi.fn(),
        setLayerFilter: vi.fn(),
    };
    GeoJSONShared.state.adapter = adapter as never;
    api = buildLayersPublicApi();
    GeoJSONShared.state.layers.set("L", { id: "L", config: {} as never, geometryType: "point" });
    api.setData("L", [pt("a"), pt("b")]);
    seen = [];
    document.addEventListener("geoleaf:layer:updated", record);
});

afterEach(() => {
    document.removeEventListener("geoleaf:layer:updated", record);
    GeoJSONShared.reset();
    vi.restoreAllMocks();
});

describe("geoleaf:layer:updated", () => {
    it("🛑 fires once per mutation of the store, naming the layer", () => {
        api.addFeature("L", pt("c"));
        api.removeFeature("L", "a");
        api.updateFeatureId("L", "b", "b2");
        api.patchFeature("L", "c", { title: "x" }, { rerender: true });
        api.mergeFeatures("L", [pt("d"), pt("e")]);
        api.setData("L", [pt("z")]);
        api.clear("L");
        expect(seen).toEqual(["L", "L", "L", "L", "L", "L", "L"]);
    });

    it("does not fire when nothing in the store changed", () => {
        api.removeFeature("L", "missing");
        api.updateFeatureId("L", "missing", "x");
        api.patchFeature("L", "missing", { title: "x" }, { rerender: true });
        expect(seen).toEqual([]);
    });

    it("does not fire for a silent patch — state only, the map is not told either", () => {
        api.patchFeature("L", "a", { _flag: true });
        expect(seen).toEqual([]);
    });

    it("does not fire for a layer the store does not hold", () => {
        api.addFeature("UNKNOWN", pt("c"));
        api.setData("UNKNOWN", [pt("c")]);
        expect(seen).toEqual([]);
    });

    it("does not fire for a visible subset — it changes what is drawn, not what is held", () => {
        api.setVisibleSubset("L", () => false);
        api.clearVisibleSubset("L");
        expect(seen).toEqual([]);
    });
});

describe("geoleaf:layer:updated — a writer of the whole collection, around this API", () => {
    // A real-time tick, an OGC auto-refresh and a host's own `GeoLeaf.GeoJSON.updateLayerData`
    // rewrite the store this API reads, and announced nothing: the open table and the active
    // filter stayed stale until the user's next gesture (`e2e/69`). The announcement now lives
    // in the one place every such writer goes through, `GeoJSONShared.setLayerCollection`.
    const fc = (...ids: string[]) => ({ type: "FeatureCollection", features: ids.map(pt) });

    it("🛑 fires for `GeoJSONCore.updateLayerData`", () => {
        GeoJSONCore.updateLayerData("L", fc("z"));
        expect(seen).toEqual(["L"]);
    });

    it("🛑 fires for the funnel itself — the OGC auto-refresh writes through it directly", () => {
        GeoJSONShared.setLayerCollection("L", fc("z"));
        expect(seen).toEqual(["L"]);
    });

    it("does not fire for a layer the store does not hold", () => {
        GeoJSONCore.updateLayerData("UNKNOWN", fc("z"));
        GeoJSONShared.setLayerCollection("UNKNOWN", fc("z"));
        expect(seen).toEqual([]);
    });

    // The three unit mutations that FALL BACK to a whole-collection write reach the funnel:
    // announcing there AND in the API would say each of them twice.
    it("🛑 an id collision in `updateFeatureId` is announced once", () => {
        api.updateFeatureId("L", "a", "b");
        expect(seen).toEqual(["L"]);
    });

    it("🛑 a rerendered patch of a feature with no `properties.id` is announced once", () => {
        // Found by its top-level `id`, but a diff must name `properties.id`: with none, the
        // API rewrites the whole collection instead.
        const topLevelOnly = {
            type: "Feature",
            id: "top",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: { name: "n" },
        } as GeoJSON.Feature;
        api.setData("L", [topLevelOnly]);
        seen = [];
        api.patchFeature("L", "top", { title: "x" }, { rerender: true });
        expect(seen).toEqual(["L"]);
    });

    it("🛑 a merge carrying an id-less feature is announced once", () => {
        const idless = {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: {},
        } as GeoJSON.Feature;
        api.mergeFeatures("L", [idless]);
        expect(seen).toEqual(["L"]);
    });

    it("🛑 the diff verdict is invalidated BEFORE the announcement, on both writers", () => {
        // A listener that mutates the layer synchronously must not read a verdict computed
        // for the collection that was just replaced.
        const entry = GeoJSONShared.state.layers.get("L") as { _diffable?: boolean };
        const read: Array<boolean | undefined> = [];
        const listener = () => read.push(entry._diffable);
        document.addEventListener("geoleaf:layer:updated", listener);
        try {
            entry._diffable = true;
            GeoJSONCore.updateLayerData("L", fc("z"));
            entry._diffable = true;
            GeoJSONShared.setLayerCollection("L", fc("y"));
        } finally {
            document.removeEventListener("geoleaf:layer:updated", listener);
        }
        expect(read).toEqual([undefined, undefined]);
    });
});

describe("hideFeatures", () => {
    it("🛑 writes the `hidden` slot of the layer's filter, never the panel's", () => {
        api.hideFeatures("L", ["a", 7]);
        expect(adapter.setLayerFilter).toHaveBeenLastCalledWith(
            "L",
            ["match", ["to-string", ["get", "id"]], ["a", "7"], false, true],
            "hidden"
        );
    });

    it("🛑 matches `properties.id` alone — never the engine's feature id", () => {
        // A GeoJSON source promotes `properties.id` (`promoteId`), and the engine's feature
        // id is then `parseInt(properties.id)`: `["id"]` added nothing but its misses — "12.5"
        // and "12-A" read 12 and hidden with "12", a cluster bubble hidden when its cluster
        // id was listed.
        api.hideFeatures("L", ["12"]);
        const [, filter] = adapter.setLayerFilter.mock.lastCall ?? [];
        expect(JSON.stringify(filter)).not.toContain('["id"]');
    });

    it("clears its slot on `null` or an empty list", () => {
        api.hideFeatures("L", null);
        expect(adapter.setLayerFilter).toHaveBeenLastCalledWith("L", null, "hidden");
        api.hideFeatures("L", []);
        expect(adapter.setLayerFilter).toHaveBeenLastCalledWith("L", null, "hidden");
    });

    it("🛑 on a vector-tile layer, matches the tile's own feature id too", () => {
        // A vector-tile source is not promoted: its feature id is the tile's own, and the
        // editor hides by that id (`feature.id ?? properties.id`). No `parseInt` there, and no
        // cluster bubble, so the `["id"]` branch the GeoJSON filter must not carry is right here.
        GeoJSONShared.state.layers.set("VT", {
            id: "VT",
            config: {} as never,
            geometryType: "point",
            isVectorTile: true,
        } as never);
        api.hideFeatures("VT", [42]);
        expect(adapter.setLayerFilter).toHaveBeenLastCalledWith(
            "VT",
            [
                "all",
                ["match", ["to-string", ["get", "id"]], ["42"], false, true],
                ["match", ["to-string", ["id"]], ["42"], false, true],
            ],
            "hidden"
        );
    });

    it("lists an id once — `match` refuses a label repeated", () => {
        api.hideFeatures("L", ["a", "a", 1, "1"]);
        const [, filter] = adapter.setLayerFilter.mock.lastCall ?? [];
        expect((filter as unknown[])[2]).toEqual(["a", "1"]);
    });

    it("fires no `layer:updated` — the store is untouched", () => {
        api.hideFeatures("L", ["a"]);
        expect(seen).toEqual([]);
    });
});
