/**
 * Invariant: the feature-id space written to the DOM must equal the one used as
 * `_featureIdMap` keys. If the two diverge, a selected row can never be resolved back, so
 * highlight / zoom / export-of-selection silently do nothing — or, worse, act on another
 * feature.
 *
 * Regression guard for the divergence fixed in PLUGINS S8: the renderer used `String(v)`
 * while the exporter used a JSON-aware serializer, so an object-valued id property
 * produced "[object Object]" on one side and JSON on the other.
 *
 * 🛑 **THERE IS NO LONGER A SECOND SIDE TO COMPARE, AND THAT IS THE FIX.** Until this change
 * the DOM ids came from `getFeatureId`, a stateful counter reset only by `render()`, while
 * the map keys came from `resolveFeatureId` called in `table-api.refresh`. Two producers,
 * one invariant, and they drifted — a row displaying `PT-105` carried the id of `PT-33`.
 * `view-model.rebuild` is now the single producer of both, so a test comparing "the two
 * sides" would compare one function to itself. What is guarded here instead is that the
 * ids this single producer emits still hold the properties the invariant needs: they are
 * what the pure resolver yields, they serialise objects without `[object Object]`, they do
 * not collide, and they number synthetics by COUNT rather than by array position.
 */

import { describe, it, expect } from "vitest";

import { rebuild, idIndexEntries } from "../view-model.js";
import type { TableFeature } from "../types.js";
import { resolveFeatureId } from "../export.js";

/** The ids the renderer writes AND the keys `_featureIdMap` carries — one producer. */
function idsOf(features: TableFeature[]) {
    rebuild(features, []);
    return idIndexEntries().map(([id]) => id);
}

describe("feature-id consistency (DOM ↔ map key)", () => {
    it("serialises an object-valued id property without [object Object]", () => {
        const [id] = idsOf([{ properties: { code: { ref: 12 } } }]);
        expect(id).not.toContain("[object Object]");
        expect(id).toBe(resolveFeatureId({ properties: { code: { ref: 12 } } }, 0));
    });

    it("serialises an array-valued id property through the same resolver", () => {
        const feature = { properties: { fid: [1, 2] } };
        expect(idsOf([feature])).toEqual([resolveFeatureId(feature, 0)]);
    });

    it("does not collide two features with distinct object ids", () => {
        const [a, b] = idsOf([
            { properties: { code: { ref: 1 } } },
            { properties: { code: { ref: 2 } } },
        ]);
        expect(a).not.toBe(b);
    });

    it("stays consistent for a plain primitive id (no behaviour change)", () => {
        expect(idsOf([{ properties: { fid: "F-1" } }])).toEqual(["F-1"]);
    });

    it("numbers synthetic ids by SYNTHETIC COUNT, not by array position", () => {
        // A mixed layer is where the two conventions part company: the second feature is
        // the FIRST without an identifier, so it is `__gl_row_0`, not `__gl_row_1`.
        expect(idsOf([{ id: "real" }, { properties: {} }, { properties: {} }])).toEqual([
            "real",
            "__gl_row_0",
            "__gl_row_1",
        ]);
    });

    it("keys the map to the position each id occupies in display order", () => {
        // The other half of the invariant, and the one a sort used to break: the index the
        // map carries must be where `_cachedData` actually holds that feature.
        rebuild([{ id: "a" }, { id: "b" }, { id: "c" }], []);
        expect(idIndexEntries()).toEqual([
            ["a", 0],
            ["b", 1],
            ["c", 2],
        ]);
    });
});
