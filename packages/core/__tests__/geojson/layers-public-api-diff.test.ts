/**
 * Unit tests — the DIFF path of `GeoLeaf.Layers` (R6, task 2.2).
 *
 * 🛑 WHAT THIS FILE EXISTS TO PREVENT. `applyDataDiff` is optional on `IMapAdapter`
 * and every call site falls back to a full re-feed when it is absent or declines. That
 * makes an always-falling-back implementation INDISTINGUISHABLE from a working one to
 * any test that merely asserts "the layer ended up correct" — the suite stays green, the
 * optimisation is gone, and nothing says so. Measured on this very change: the three
 * pre-existing suites (83 assertions) went green against the diff path without once
 * exercising it, because their fake adapters had no `applyDataDiff` and their fake
 * sources no `updateData`.
 *
 * So every assertion here is PAIRED: the same gesture is played on an eligible layer and
 * on an ineligible one, in the same test, asserting BOTH the method that must be called
 * and the one that must not. A predicate degenerating to a constant — `true` or `false` —
 * then fails exactly one half. Neither half alone would catch it.
 *
 * ⚠️ Eligibility is never hand-set here. The layers are made eligible by writing them
 * through the real `setData`, which is what recomputes and caches the flag in production;
 * stamping `_diffable = true` on a fixture would test the diff code against a fiction.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LayerDataApi } from "../../src/contracts/layer-data.contract.js";
import type { LayerDataDiff } from "../../src/contracts/map-adapter.contract.js";

const { buildLayersPublicApi } = await import("../../src/kernel/geojson/layers-public-api.ts");
const { GeoJSONShared } = await import("../../src/kernel/geojson/shared.ts");

/** The two adapter members this suite asserts on, spied. */
interface DiffSpyAdapter {
    updateLayerData: ReturnType<typeof vi.fn>;
    applyDataDiff: ReturnType<typeof vi.fn>;
    setFeatureState: ReturnType<typeof vi.fn>;
    setLayerFilter: ReturnType<typeof vi.fn>;
}

/**
 * Narrows away a `null`/`undefined` the suite's own setup rules out.
 *
 * Preferred to `!`: a non-null assertion is silent when the assumption breaks, and the
 * repo counts every one of them. This throws, naming what was missing — a fixture that
 * failed to seed is a broken test, not a failed assertion, and the two read differently.
 */
function must<T>(value: T | null | undefined, what: string): T {
    if (value == null) throw new Error(`fixture manquante : ${what}`);
    return value;
}

/** A feature's `properties.id` — the id space a diff addresses features in. */
function propId(f: GeoJSON.Feature): unknown {
    return must(f.properties, "properties")["id"];
}

/** Point feature carrying its id on both `id` and `properties.id`, as the loader does. */
function pt(id: string, extra: Record<string, unknown> = {}): GeoJSON.Feature {
    return {
        type: "Feature",
        id,
        geometry: { type: "Point", coordinates: [0, 0] },
        properties: { id, ...extra },
    };
}

/** Feature with NO usable `properties.id` — the shape that makes a layer unaddressable. */
function anonymous(tag: string): GeoJSON.Feature {
    return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [0, 0] },
        properties: { tag },
    };
}

let api: LayerDataApi;
let adapter: DiffSpyAdapter;

/** Seeds a layer and makes its eligibility be COMPUTED, through the production path. */
function seed(layerId: string, features: GeoJSON.Feature[]) {
    GeoJSONShared.state.layers.set(layerId, {
        id: layerId,
        config: {} as never,
        geometryType: "point",
    });
    api.setData(layerId, features);
    adapter.updateLayerData.mockClear();
    adapter.applyDataDiff.mockClear();
    return must(GeoJSONShared.getLayerById(layerId), `couche ${layerId}`);
}

beforeEach(() => {
    GeoJSONShared.reset();
    adapter = {
        updateLayerData: vi.fn(),
        // Returns true = "I took it", the contract's answer for a live diffable source.
        applyDataDiff: vi.fn(() => true),
        setFeatureState: vi.fn(),
        setLayerFilter: vi.fn(),
    };
    GeoJSONShared.state.adapter = adapter as never;
    api = buildLayersPublicApi();
});

afterEach(() => {
    GeoJSONShared.reset();
    vi.restoreAllMocks();
});

describe("eligibility is decided, not assumed", () => {
    it("routes the SAME gesture to the diff on an addressable layer and to a re-feed on an unaddressable one", () => {
        // 🛑 The two halves live in one test on purpose: a predicate stuck on `true` fails
        // the second, one stuck on `false` fails the first. Split across two tests, either
        // degeneration would leave a green test to point at.
        seed("OK", [pt("a"), pt("b")]);
        seed("DUP", [pt("same"), pt("same")]);

        api.addFeature("OK", pt("c"));
        expect(adapter.applyDataDiff).toHaveBeenCalledTimes(1);
        expect(adapter.updateLayerData).not.toHaveBeenCalled();

        adapter.applyDataDiff.mockClear();

        api.addFeature("DUP", pt("d"));
        expect(adapter.applyDataDiff).not.toHaveBeenCalled();
        expect(adapter.updateLayerData).toHaveBeenCalledTimes(1);
    });

    it("re-feeds the WHOLE collection when it falls back, not a fragment", () => {
        const entry = seed("DUP", [pt("same"), pt("same")]);
        api.addFeature("DUP", pt("z"));
        const [, data] = must(adapter.updateLayerData.mock.calls[0], "1er appel");
        expect(data.type).toBe("FeatureCollection");
        expect(data.features).toBe(entry.features);
        expect(data.features).toHaveLength(3);
    });

    it("a layer that loses its ids stops being diffable at the next collection write", () => {
        seed("L", [pt("a")]);
        api.addFeature("L", pt("b"));
        expect(adapter.applyDataDiff).toHaveBeenCalled();

        adapter.applyDataDiff.mockClear();
        api.setData("L", [anonymous("x")]);
        adapter.updateLayerData.mockClear();

        api.addFeature("L", pt("c"));
        expect(adapter.applyDataDiff).not.toHaveBeenCalled();
        expect(adapter.updateLayerData).toHaveBeenCalledTimes(1);
    });

    it("falls back when the adapter declines the diff", () => {
        // The adapter answers `false` for a source it cannot address — layer gone, style
        // swapped, engine without the primitive. The kernel owns the recovery.
        seed("L", [pt("a")]);
        adapter.applyDataDiff.mockReturnValue(false);
        api.addFeature("L", pt("b"));
        expect(adapter.applyDataDiff).toHaveBeenCalledTimes(1);
        expect(adapter.updateLayerData).toHaveBeenCalledTimes(1);
    });
});

describe("what each mutation emits", () => {
    it("addFeature emits the added feature alone", () => {
        seed("L", [pt("a")]);
        const added = pt("b");
        api.addFeature("L", added);
        expect(adapter.applyDataDiff).toHaveBeenCalledWith("L", { add: [added] });
    });

    it("removeFeature names properties.id, NOT the caller's argument", () => {
        // ⚠️ The one bug no round-trip assertion catches. `matchId` accepts a top-level
        // `id` too, so a caller may legitimately pass one that is not the promoted id.
        // Forwarding it would name an id the engine has never heard of — and MapLibre
        // skips an unknown id in silence: the store would drop the feature while the map
        // kept drawing it.
        const odd: GeoJSON.Feature = {
            type: "Feature",
            id: 42,
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: { id: "PT-42" },
        };
        seed("L", [odd, pt("b")]);
        expect(api.removeFeature("L", 42)).toBe(true);
        expect(adapter.applyDataDiff).toHaveBeenCalledWith("L", { remove: ["PT-42"] });
    });

    it("patchFeature with rerender emits a property update, and stays silent without it", () => {
        seed("L", [pt("a")]);
        api.patchFeature("L", "a", { _syncStatus: "pending" });
        expect(adapter.applyDataDiff).not.toHaveBeenCalled();
        expect(adapter.updateLayerData).not.toHaveBeenCalled();

        api.patchFeature("L", "a", { _syncStatus: "synced" }, { rerender: true });
        expect(adapter.applyDataDiff).toHaveBeenCalledWith("L", {
            update: [{ id: "a", addOrUpdateProperties: [{ key: "_syncStatus", value: "synced" }] }],
        });
    });

    it("updateFeatureId expresses an id change as remove-then-add", () => {
        seed("L", [pt("a"), pt("b")]);
        api.updateFeatureId("L", "a", "a2");
        const [, diff] = must(adapter.applyDataDiff.mock.calls[0], "1er diff");
        expect(diff.remove).toEqual(["a"]);
        expect(diff.add).toHaveLength(1);
        expect(propId(must(diff.add, "add")[0])).toBe("a2");
    });

    it("updateFeatureId falls back when the new id is already taken", () => {
        // The diff would collapse the two features into one in the source while the store
        // keeps both. A re-feed preserves today's behaviour instead of inventing one.
        seed("L", [pt("a"), pt("b")]);
        api.updateFeatureId("L", "a", "b");
        expect(adapter.applyDataDiff).not.toHaveBeenCalled();
        expect(adapter.updateLayerData).toHaveBeenCalledTimes(1);
    });

    it("mergeFeatures emits adds only — the engine's add IS an upsert", () => {
        seed("L", [pt("a"), pt("b")]);
        const incoming = [pt("b", { v: 2 }), pt("c")];
        api.mergeFeatures("L", incoming);
        expect(adapter.applyDataDiff).toHaveBeenCalledWith("L", { add: incoming });
        expect(api.getFeatures("L").map(propId)).toEqual(["a", "b", "c"]);
    });

    it("mergeFeatures falls back when an incoming feature cannot be addressed", () => {
        seed("L", [pt("a")]);
        api.mergeFeatures("L", [pt("b"), anonymous("nope")]);
        expect(adapter.applyDataDiff).not.toHaveBeenCalled();
        expect(adapter.updateLayerData).toHaveBeenCalledTimes(1);
    });

    it("setData and clear stay whole-collection writes", () => {
        // Replacing everything IS `setData`; expressing it as removeAll + N adds would cost
        // the engine an extra O(N) pass for nothing.
        seed("L", [pt("a")]);
        api.setData("L", [pt("x")]);
        api.clear("L");
        expect(adapter.applyDataDiff).not.toHaveBeenCalled();
        expect(adapter.updateLayerData).toHaveBeenCalledTimes(2);
    });
});

describe("the diff and the store agree", () => {
    /** Reference applicator — the engine's documented order: remove → add → update. */
    function replay(seedFeatures: GeoJSON.Feature[], diffs: LayerDataDiff[]) {
        const clone = (f: GeoJSON.Feature): GeoJSON.Feature => ({
            ...f,
            properties: { ...f.properties },
        });
        let out: GeoJSON.Feature[] = seedFeatures.map(clone);
        for (const diff of diffs) {
            if (diff.removeAll) out = [];
            const removed = diff.remove;
            if (removed) out = out.filter((f) => !removed.includes(propId(f) as string));
            if (diff.add) {
                for (const f of diff.add) {
                    out = out.filter((o) => propId(o) !== propId(f));
                    out.push(clone(f));
                }
            }
            if (diff.update) {
                for (const u of diff.update) {
                    const target = out.find((f) => propId(f) === u.id);
                    if (!target) continue;
                    for (const { key, value } of u.addOrUpdateProperties ?? []) {
                        must(target.properties, "properties")[key] = value;
                    }
                }
            }
        }
        return out;
    }

    it("replaying every emitted diff over the seed reproduces the store, feature for feature", () => {
        // 🛑 The assertion that catches a diff naming the WRONG id. Every other test here
        // checks the store, and the store is mutated by code that never consults the diff:
        // the two could disagree indefinitely without a single red.
        const seedFeatures = [pt("a"), pt("b"), pt("c")];
        seed("L", seedFeatures);

        api.addFeature("L", pt("d"));
        api.removeFeature("L", "b");
        api.patchFeature("L", "c", { status: "ok" }, { rerender: true });
        api.updateFeatureId("L", "a", "a2");
        api.mergeFeatures("L", [pt("e")]);

        expect(adapter.updateLayerData).not.toHaveBeenCalled();
        const diffs = adapter.applyDataDiff.mock.calls.map(([, d]) => d);
        const rebuilt = replay(seedFeatures, diffs);
        const store = must(GeoJSONShared.getLayerById("L")?.features, "features de L");

        expect(rebuilt.map(propId).sort()).toEqual(
            store.map((f) => propId(f as unknown as GeoJSON.Feature)).sort()
        );
        const patched = must(
            rebuilt.find((f) => propId(f) === "c"),
            "feature c"
        );
        expect(must(patched.properties, "properties")["status"]).toBe("ok");
    });

    it("a unit mutation does not reallocate the stored array", () => {
        // The deterministic proxy for "cost independent of N": the store's array is
        // mutated in place, and no full re-feed follows.
        //
        // ⚠️ **The dose is small ON PURPOSE, and a bigger one would prove nothing more.**
        // Array identity is exact at any N — `toBe` either holds or it does not — so
        // 20 000 features would buy no additional certainty and would cost real memory in
        // a suite that already runs 513 files beside seventeen other packages. Measured:
        // the 20 000-feature version of this test was enough, under that parallel load, to
        // starve one boot-heavy guard past its 10 s budget. The wall-clock claim, and the
        // doses that make it meaningful, belong to the e2e bench (§6.2.9), which measures
        // 30 000 and 100 000 in a real browser.
        const entry = seed(
            "BIG",
            Array.from({ length: 500 }, (_, i) => pt(`f${i}`))
        );
        const before = entry.features;

        api.addFeature("BIG", pt("extra"));
        expect(entry.features).toBe(before);
        expect(entry.features).toHaveLength(501);

        api.removeFeature("BIG", "f0");
        expect(entry.features).toBe(before);
        expect(entry.features).toHaveLength(500);
        expect(adapter.updateLayerData).not.toHaveBeenCalled();
    });
});
