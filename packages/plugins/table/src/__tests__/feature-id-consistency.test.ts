/**
 * Invariant: the feature-id space written to the DOM (via `getFeatureId`,
 * consumed by the selection manager) must equal the one used as `_featureIdMap`
 * keys (via `resolveFeatureId`, called from `table-api.refresh`). If the two
 * diverge, a selected row can never be resolved back, so highlight / zoom /
 * export-of-selection silently do nothing.
 *
 * Regression guard for the divergence fixed in PLUGINS S8: the renderer used
 * `String(v)` while the exporter used a JSON-aware serializer, so an
 * object-valued id property produced "[object Object]" on one side and JSON on
 * the other.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { getFeatureId, resetSyntheticIdCounter } from "../feature-id.js";
import { resolveFeatureId } from "../export.js";

describe("feature-id consistency (DOM ↔ map key)", () => {
    beforeEach(() => {
        resetSyntheticIdCounter();
    });

    it("agrees on an object-valued id property (no [object Object])", () => {
        const feature = { properties: { code: { ref: 12 } } };
        // DOM side (renderer → data-feature-id → _selectedIds)
        const domId = getFeatureId(feature);
        // Map-key side (table-api.refresh → _featureIdMap keys)
        const mapKey = resolveFeatureId(feature, 0);

        expect(domId).toBe(mapKey);
        expect(domId).not.toContain("[object Object]");
    });

    it("agrees on an array-valued id property", () => {
        const feature = { properties: { fid: [1, 2] } };
        expect(getFeatureId(feature)).toBe(resolveFeatureId(feature, 0));
    });

    it("does not collide two features with distinct object ids", () => {
        const a = resolveFeatureId({ properties: { code: { ref: 1 } } }, 0);
        const b = resolveFeatureId({ properties: { code: { ref: 2 } } }, 1);
        expect(a).not.toBe(b);
    });

    it("stays consistent for a plain primitive id (no behaviour change)", () => {
        const feature = { properties: { fid: "F-1" } };
        expect(getFeatureId(feature)).toBe("F-1");
        expect(getFeatureId(feature)).toBe(resolveFeatureId(feature, 0));
    });
});
