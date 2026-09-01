/**
 * Tests for GeoLeaf.Utils type guards (utils/general/type-guards.ts)
 * Feature-data narrowing helpers.
 */

import * as G from "../../src/utils/general/type-guards.js";

describe("utils/general/type-guards", () => {
    describe("asObject", () => {
        it("returns plain objects", () => {
            const o = { a: 1 };
            expect(G.asObject(o)).toBe(o);
        });
        it("rejects null, arrays and primitives", () => {
            expect(G.asObject(null)).toBeNull();
            expect(G.asObject([1, 2])).toBeNull();
            expect(G.asObject("x")).toBeNull();
        });
    });

    describe("asArray", () => {
        it("returns arrays unchanged", () => {
            const a = [1, 2, 3];
            expect(G.asArray(a)).toBe(a);
        });
        it("returns null for non-arrays", () => {
            expect(G.asArray({})).toBeNull();
            expect(G.asArray("ab")).toBeNull();
        });
    });
});
