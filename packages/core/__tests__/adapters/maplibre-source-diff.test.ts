/**
 * Unit tests — `adapters/maplibre/maplibre-source-diff.ts` and the adapter's
 * `applyDataDiff` (R6, task 2.2).
 *
 * Pure translation only — no map, no mock engine. Three objects, three homes: whether
 * the KERNEL chose the diff path lives in `geojson/layers-public-api-diff.test.ts`;
 * whether the ADAPTER wires it to a live source lives in
 * `maplibre-adapter-layers.test.js`, which already owns a faithful engine double;
 * whether the SHAPE handed to the engine is right lives here.
 */
import { describe, expect, it } from "vitest";

import type { LayerDataDiff } from "../../src/contracts/map-adapter.contract.js";
import type { GeoJSONSourceLike } from "../../src/adapters/maplibre/maplibre-adapter-types.js";

const { toSourceDiff, isDiffableSource } =
    await import("../../src/adapters/maplibre/maplibre-source-diff.ts");

/** Narrows a refusal away — see the twin in `layers-public-api-diff.test.ts`. */
function must<T>(value: T | null | undefined, what: string): T {
    if (value == null) throw new Error(`fixture manquante : ${what}`);
    return value;
}

function pt(id: string): GeoJSON.Feature {
    return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [0, 0] },
        properties: { id, name: `n-${id}` },
    };
}

/** A source double, typed as the adapter narrows a live one. */
const src = (o: Partial<GeoJSONSourceLike>): GeoJSONSourceLike =>
    ({ setData() {}, ...o }) as GeoJSONSourceLike;

describe("isDiffableSource", () => {
    it("accepts a source that can update and promotes `id`", () => {
        expect(isDiffableSource(src({ async updateData() {}, promoteId: "id" }))).toBe(true);
    });

    it("refuses an engine without the primitive, a source without promoteId, and no source at all", () => {
        // Three refusals in one test, and paired with the acceptance above: an
        // `isDiffableSource` degenerating to a constant fails one side or the other.
        expect(isDiffableSource(src({ promoteId: "id" }))).toBe(false);
        expect(isDiffableSource(src({ async updateData() {} }))).toBe(false);
        expect(isDiffableSource(src({ async updateData() {}, promoteId: "ref" }))).toBe(false);
        expect(isDiffableSource(undefined)).toBe(false);
    });
});

describe("toSourceDiff", () => {
    it("copies each added feature and stamps the promoted id at the TOP level", () => {
        // 🛑 Two engine facts in one assertion, neither of them optional.
        //
        // The top-level id: `updateData` coalesces pending diffs through
        // `mergeSourceDiffs(prev, next)` — two arguments where the function takes three,
        // so `promoteId` is never passed — and the coalescing hashes `add` by
        // `feature.id`. Two adds carrying their id only under `properties.id` would both
        // hash under `undefined`, and one would be dropped without a word.
        //
        // The copy: `promoteFeatureIds` writes `feature.id` and `demoteFeatureIds`
        // deletes it, on the very objects handed over — which are the store's own
        // features. Passing them uncopied lets the engine add and remove a field on
        // GeoLeaf's state.
        const input = pt("a");
        const diff: LayerDataDiff = { add: [input] };
        const added = must(must(toSourceDiff(diff), "diff traduit").add, "add")[0];
        expect(must(added, "1re feature").id).toBe("a");
        expect(added).not.toBe(input);
        expect(input.id).toBeUndefined();
        expect(must(added, "1re feature").properties).toBe(input.properties);
    });

    it("carries removals, property updates and removeAll through unchanged in shape", () => {
        expect(toSourceDiff({ remove: ["a", 2] })).toEqual({ remove: ["a", 2] });
        expect(toSourceDiff({ removeAll: true })).toEqual({ removeAll: true });
        expect(
            toSourceDiff({ update: [{ id: "a", addOrUpdateProperties: [{ key: "k", value: 1 }] }] })
        ).toEqual({ update: [{ id: "a", addOrUpdateProperties: [{ key: "k", value: 1 }] }] });
    });

    it("REFUSES a diff naming a feature the engine could not address", () => {
        // 🛑 Refusal is the only safe answer, and it must happen BEFORE the call.
        // `_dispatchWorkerUpdate` wraps the whole update in a try/catch ending in
        // `fire(new ErrorEvent(...))`, so the promise resolves either way — and the
        // incompatibility is detected on the main thread only AFTER the worker has
        // already applied the diff. No `.catch()` downstream could rescue this.
        const anonymous = { type: "Feature", geometry: null, properties: { name: "x" } };
        expect(toSourceDiff({ add: [anonymous] } as unknown as LayerDataDiff)).toBeNull();
        expect(toSourceDiff({ remove: [null] } as unknown as LayerDataDiff)).toBeNull();
        expect(toSourceDiff({ update: [{ id: null }] } as unknown as LayerDataDiff)).toBeNull();
    });

    it("does not invent members it was not given", () => {
        // An empty `remove: []` reaching the engine would be a diff that says nothing but
        // still costs a worker round-trip.
        expect(toSourceDiff({})).toEqual({});
        expect(toSourceDiff({ add: [] })).toEqual({});
    });
});
