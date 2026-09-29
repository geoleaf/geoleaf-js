/**
 * The filter's side of the field diagnostic — only a descriptor that LISTS a layer promises it
 * a field; `text` and `proximity` promise none a layer could miss on its own.
 */
import { describe, expect, it } from "vitest";
import { filterDeclaredFields } from "../../../src/capabilities/filter/declared-fields.js";
import type { FilterConfig } from "../../../src/capabilities/filter/types.js";

const CONFIG: FilterConfig = {
    enabled: true,
    fields: [
        { id: "q", kind: "text", searchFields: ["properties.adresse"], layers: ["candelabres"] },
        {
            id: "categories",
            kind: "taxonomy",
            field: "categoryId",
            subField: "subCategoryId",
            layers: ["candelabres"],
        },
        { id: "etat", kind: "tag", field: "statut", subField: "ignored" },
        { id: "near", kind: "proximity", layers: ["candelabres"] },
    ],
};

const feature = (properties: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    type: "Feature",
    properties,
    ...extra,
});

describe("filterDeclaredFields", () => {
    it("declares field and subField of the taxonomy descriptor listing the layer — nothing else", () => {
        expect(filterDeclaredFields(CONFIG, "candelabres").map((d) => [d.key, d.field])).toEqual([
            ["modules.filter.fields[1].field", "categoryId"],
            ["modules.filter.fields[1].subField", "subCategoryId"],
        ]);
    });

    it("declares nothing for a layer no descriptor lists — an unscoped field is normal to miss", () => {
        expect(filterDeclaredFields(CONFIG, "armoires")).toEqual([]);
    });

    it("declares no subField outside a taxonomy descriptor", () => {
        const tag: FilterConfig = {
            enabled: true,
            fields: [{ id: "t", kind: "tag", field: "statut", subField: "x", layers: ["l"] }],
        };
        expect(filterDeclaredFields(tag, "l").map((d) => d.field)).toEqual(["statut"]);
    });

    it("finds the field at the root, then under properties — a null value is carried", () => {
        const [cat] = filterDeclaredFields(CONFIG, "candelabres");
        expect(cat?.present(feature({ categoryId: null }))).toBe(true);
        expect(cat?.present(feature({}, { categoryId: "x" }))).toBe(true);
        expect(cat?.present(feature({ categoryid: "x" }))).toBe(false);
    });

    it("declares nothing when the filter is disabled", () => {
        expect(filterDeclaredFields({ ...CONFIG, enabled: false }, "candelabres")).toEqual([]);
    });
});
