/**
 * Unit tests — capabilities/filter/engine/options.ts (S5, F1).
 *
 * Taxonomy category expansion (via the GeoLeaf.Taxonomy seam) + `"auto"` tag/enum
 * option derivation from the data.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { taxo } = vi.hoisted(() => ({ taxo: { getCategories: vi.fn() } }));

vi.mock("../../../src/utils/general/geoleaf-global.js", () => ({
    getGeoLeaf: () => ({ Taxonomy: taxo }),
}));

const { expandCategorySelection, distinctFieldValues } = await import(
    "../../../src/capabilities/filter/engine/options.ts"
);

afterEach(() => taxo.getCategories.mockReset());

describe("expandCategorySelection", () => {
    it("adds sub-category ids of a selected parent (hierarchical select)", () => {
        taxo.getCategories.mockReturnValue({
            CULTURES: { subcategories: { MUSEE: {}, SITE: {} } },
            HEBERGEMENT: {},
        });
        expect(expandCategorySelection("poi-cat", ["CULTURES"])).toEqual([
            "CULTURES",
            "MUSEE",
            "SITE",
        ]);
    });
    it("leaves a leaf (sub-category) selection unchanged", () => {
        taxo.getCategories.mockReturnValue({ CULTURES: { subcategories: { MUSEE: {} } } });
        expect(expandCategorySelection("poi-cat", ["MUSEE"])).toEqual(["MUSEE"]);
    });
    it("returns the input unchanged for an empty selection", () => {
        expect(expandCategorySelection("poi-cat", [])).toEqual([]);
        expect(taxo.getCategories).not.toHaveBeenCalled();
    });
    it("returns the selection as-is for an unknown taxonomy ref", () => {
        taxo.getCategories.mockReturnValue({});
        expect(expandCategorySelection("nope", ["X"])).toEqual(["X"]);
    });
});

describe("distinctFieldValues", () => {
    it("collects distinct scalar values, sorted", () => {
        const features = [
            { properties: { fclass: "b" } },
            { properties: { fclass: "a" } },
            { properties: { fclass: "b" } },
        ];
        expect(distinctFieldValues("fclass", features)).toEqual(["a", "b"]);
    });
    it("normalises tag values when asTags is set (array + CSV)", () => {
        const features = [{ attributes: { tags: "x, y" } }, { attributes: { tags: ["y", "z"] } }];
        expect(distinctFieldValues("attributes.tags", features, true)).toEqual(["x", "y", "z"]);
    });
});
