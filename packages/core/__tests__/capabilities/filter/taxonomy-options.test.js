/**
 * Unit tests — capabilities/filter/taxonomy-options.ts.
 *
 * Taxonomy expansion + panel option resolution. Decoupled by construction: reads the
 * taxonomy seam, never POI/Route.
 *
 * The native-apply half (`applyActiveFilter`/`planLayers`/`applyNativeFilters` + their
 * tests) was retired in S5/N-4: complete and tested, but never called, and not worth
 * wiring — `text` is JS-only and sits in 9 profiles out of 9. Its live path is covered by
 * `apply.test.js` and `geojson/geojson-filter-apply.test.js`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { taxo } = vi.hoisted(() => ({ taxo: { getCategories: vi.fn() } }));
vi.mock("../../../src/utils/general/geoleaf-global.js", () => ({
    getGeoLeaf: () => ({ Taxonomy: taxo }),
}));

const { expandActiveFilter, resolveFieldOptions } =
    await import("../../../src/capabilities/filter/taxonomy-options.ts");

afterEach(() => taxo.getCategories.mockReset());

describe("expandActiveFilter", () => {
    it("expands a selected parent category to its sub-categories", () => {
        taxo.getCategories.mockReturnValue({
            CULTURES: { subcategories: { MUSEE: {}, SITE: {} } },
        });
        const active = [
            {
                descriptor: { id: "cat", kind: "taxonomy", field: "fclass", taxonomyRef: "poi" },
                values: ["CULTURES"],
            },
        ];
        expect(expandActiveFilter(active)[0].values).toEqual(["CULTURES", "MUSEE", "SITE"]);
    });
    it("passes non-taxonomy fields through unchanged", () => {
        const active = [{ descriptor: { id: "t", kind: "tag", field: "tags" }, values: ["x"] }];
        expect(expandActiveFilter(active)[0].values).toEqual(["x"]);
        expect(taxo.getCategories).not.toHaveBeenCalled();
    });
});

describe("resolveFieldOptions", () => {
    it("resolves taxonomy trees + declared tag lists, omits auto/optionless", () => {
        taxo.getCategories.mockReturnValue({
            CULTURES: { label: "Culture", subcategories: { MUSEE: {} } },
        });
        const config = {
            enabled: true,
            fields: [
                { id: "cat", kind: "taxonomy", field: "fclass", taxonomyRef: "poi" },
                { id: "tags", kind: "tag", field: "t", options: ["free", "paid"] },
                { id: "auto", kind: "tag", field: "t2", options: "auto" },
                { id: "q", kind: "text", field: "", searchFields: ["name"] },
            ],
        };
        const opts = resolveFieldOptions(config);
        expect(opts.cat.categories).toHaveProperty("CULTURES");
        expect(opts.tags.values).toEqual([{ value: "free" }, { value: "paid" }]);
        expect(opts.auto).toBeUndefined();
        expect(opts.q).toBeUndefined();
    });
});
