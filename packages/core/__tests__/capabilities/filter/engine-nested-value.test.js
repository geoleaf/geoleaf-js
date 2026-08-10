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

    // Les 7 cas `getSearchFieldsFromProfile` sont partis avec la fonction (API S4.5) :
    // son unique appelant était `route-filter.ts`, et le mécanisme lui-même est supersédé
    // par les `searchFields` du descripteur de filtre (`engine/predicate.ts:95`).
    // `extractRouteCoords` est parti avec le moteur route-filter (API S4.5) : son unique
    // appelant était le prédicat de proximité de `route-filter.ts`, supprimé avec
    // `GeoLeaf.Filters`. Les 4 cas qui le couvraient ici sont retirés avec lui.
});
