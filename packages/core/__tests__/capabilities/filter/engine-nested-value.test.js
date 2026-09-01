/**
 */

vi.mock("../../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), warn: vi.fn() },
}));

import { getNestedValue } from "../../../src/capabilities/filter/engine/nested-value.js";

describe("capabilities/filter/engine/nested-value", () => {
    describe("getNestedValue", () => {
        it("returns value for simple path", () => {
            expect(getNestedValue({ a: 1 }, "a")).toBe(1);
        });
        it("returns nested value for dot path", () => {
            expect(getNestedValue({ a: { b: 2 } }, "a.b")).toBe(2);
        });
        it("returns null for missing path", () => {
            expect(getNestedValue({ a: {} }, "a.b.c")).toBeNull();
        });
        it("returns null when intermediate is undefined", () => {
            expect(getNestedValue({ a: {} }, "a.x.y")).toBeNull();
        });
    });

    // The 7 `getSearchFieldsFromProfile` cases left with the function: its
    // only caller was `route-filter.ts`, and the mechanism itself is
    // superseded by the filter descriptor's `searchFields`
    // (`engine/predicate.ts`). `extractRouteCoords` left with the
    // route-filter engine: its only caller was `route-filter.ts`'s proximity
    // predicate, deleted with `GeoLeaf.Filters`. The 4 cases covering it here
    // are removed with it.
});
