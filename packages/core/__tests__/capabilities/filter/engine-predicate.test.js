/**
 * Unit tests — capabilities/filter/engine/predicate.ts (S5, F1).
 *
 * The geometry-agnostic JS predicate across the 6 kinds + per-layer opt-in scoping.
 */
import { describe, expect, it } from "vitest";

const { fieldPredicate, featurePasses, fieldAppliesToLayer } = await import(
    "../../../src/capabilities/filter/engine/predicate.ts"
);

const af = (descriptor, payload = {}) => ({ descriptor, ...payload });

describe("fieldPredicate — taxonomy (value membership)", () => {
    const d = { id: "cat", kind: "taxonomy", field: "fclass" };
    it("passes when the feature value is selected", () => {
        expect(
            fieldPredicate(af(d, { values: ["museum"] }), { properties: { fclass: "museum" } })
        ).toBe(true);
    });
    it("fails when the feature value is not selected", () => {
        expect(
            fieldPredicate(af(d, { values: ["museum"] }), { properties: { fclass: "hotel" } })
        ).toBe(false);
    });
    it("passes everything when the selection is empty", () => {
        expect(fieldPredicate(af(d, { values: [] }), { properties: { fclass: "hotel" } })).toBe(
            true
        );
    });
    it("matches two levels: field (category) OR subField (sub-category)", () => {
        const dSub = {
            id: "cat",
            kind: "taxonomy",
            field: "categoryId",
            subField: "subcategoryId",
        };
        const hotel = { properties: { categoryId: "HEBERGEMENT", subcategoryId: "HOTEL" } };
        const camp = { properties: { categoryId: "HEBERGEMENT", subcategoryId: "CAMPING" } };
        // Leaf sub-category selected → matches via subField only.
        expect(fieldPredicate(af(dSub, { values: ["HOTEL"] }), hotel)).toBe(true);
        expect(fieldPredicate(af(dSub, { values: ["HOTEL"] }), camp)).toBe(false);
        // Parent category selected → matches via field for both children.
        expect(fieldPredicate(af(dSub, { values: ["HEBERGEMENT"] }), camp)).toBe(true);
    });
});

describe("fieldPredicate — tag (list membership)", () => {
    const d = { id: "tags", kind: "tag", field: "attributes.tags" };
    it("matches a CSV tag field", () => {
        expect(fieldPredicate(af(d, { values: ["b"] }), { attributes: { tags: "a, b ,c" } })).toBe(
            true
        );
    });
    it("matches an array tag field", () => {
        expect(fieldPredicate(af(d, { values: ["x"] }), { attributes: { tags: ["x", "y"] } })).toBe(
            true
        );
    });
    it("fails when no selected tag is present", () => {
        expect(fieldPredicate(af(d, { values: ["z"] }), { attributes: { tags: ["x", "y"] } })).toBe(
            false
        );
    });
});

describe("fieldPredicate — boolean / range", () => {
    it("boolean passes only truthy features when active", () => {
        const d = { id: "pmr", kind: "boolean", field: "accessible" };
        expect(fieldPredicate(af(d, { bool: true }), { properties: { accessible: true } })).toBe(
            true
        );
        expect(fieldPredicate(af(d, { bool: true }), { properties: { accessible: false } })).toBe(
            false
        );
        // inactive toggle → passes all
        expect(fieldPredicate(af(d, { bool: false }), { properties: { accessible: false } })).toBe(
            true
        );
    });
    it("range respects min/max bounds", () => {
        const d = { id: "s", kind: "range", field: "surface" };
        expect(
            fieldPredicate(af(d, { range: { min: 10, max: 50 } }), { properties: { surface: 30 } })
        ).toBe(true);
        expect(fieldPredicate(af(d, { range: { min: 10 } }), { properties: { surface: 5 } })).toBe(
            false
        );
        expect(
            fieldPredicate(af(d, { range: { max: 50 } }), { properties: { surface: 100 } })
        ).toBe(false);
    });
});

describe("fieldPredicate — text / proximity", () => {
    it("text matches a case-insensitive substring in searchFields", () => {
        const d = { id: "q", kind: "text", field: "", searchFields: ["properties.name"] };
        expect(fieldPredicate(af(d, { text: "mus" }), { properties: { name: "Museum" } })).toBe(
            true
        );
        expect(fieldPredicate(af(d, { text: "xyz" }), { properties: { name: "Museum" } })).toBe(
            false
        );
    });
    it("text is accent-insensitive (recif → Récif and vice-versa)", () => {
        const d = { id: "q", kind: "text", field: "", searchFields: ["properties.name"] };
        expect(fieldPredicate(af(d, { text: "recif" }), { properties: { name: "Le Récif" } })).toBe(
            true
        );
        expect(fieldPredicate(af(d, { text: "récif" }), { properties: { name: "Le Recif" } })).toBe(
            true
        );
    });
    it("text is word-order independent (every term must be present)", () => {
        const d = { id: "q", kind: "text", field: "", searchFields: ["properties.name"] };
        const feat = { properties: { name: "Le Récif — Saint-Gilles" } };
        expect(fieldPredicate(af(d, { text: "gilles récif" }), feat)).toBe(true);
        expect(fieldPredicate(af(d, { text: "récif gilles" }), feat)).toBe(true);
        expect(fieldPredicate(af(d, { text: "récif hotel" }), feat)).toBe(false);
    });
    it("text still matches a contiguous substring (backward compatible)", () => {
        const d = { id: "q", kind: "text", field: "", searchFields: ["properties.name"] };
        expect(
            fieldPredicate(af(d, { text: "le récif" }), { properties: { name: "Le Récif" } })
        ).toBe(true);
    });
    it("text matches across array field values", () => {
        const d = { id: "q", kind: "text", field: "", searchFields: ["properties.tags"] };
        expect(
            fieldPredicate(af(d, { text: "plage" }), { properties: { tags: ["Vue mer", "Plage"] } })
        ).toBe(true);
    });
    it("text with a blank query passes everything", () => {
        const d = { id: "q", kind: "text", field: "", searchFields: ["properties.name"] };
        expect(fieldPredicate(af(d, { text: "   " }), { properties: { name: "Museum" } })).toBe(
            true
        );
    });
    it("proximity passes features within the radius (metres)", () => {
        const d = { id: "near", kind: "proximity", field: "" };
        const center = { center: { lat: 0, lng: 0 }, radius: 1000 };
        expect(
            fieldPredicate(af(d, { proximity: center }), {
                geometry: { type: "Point", coordinates: [0.001, 0] },
            })
        ).toBe(true);
        expect(
            fieldPredicate(af(d, { proximity: center }), {
                geometry: { type: "Point", coordinates: [1, 0] },
            })
        ).toBe(false);
    });
});

describe("layer scoping (opt-in) + featurePasses", () => {
    it("fieldAppliesToLayer: absent layers ⟹ all; present ⟹ only listed", () => {
        expect(fieldAppliesToLayer({ id: "a", kind: "tag" }, "L1")).toBe(true);
        expect(fieldAppliesToLayer({ id: "a", kind: "tag", layers: [] }, "L1")).toBe(true);
        expect(fieldAppliesToLayer({ id: "a", kind: "tag", layers: ["L1"] }, "L1")).toBe(true);
        expect(fieldAppliesToLayer({ id: "a", kind: "tag", layers: ["L2"] }, "L1")).toBe(false);
    });
    it("featurePasses ignores a field that does not apply to the layer", () => {
        const active = [
            {
                descriptor: { id: "cat", kind: "taxonomy", field: "fclass", layers: ["L2"] },
                values: ["museum"],
            },
        ];
        // On L1 the field is out of scope → feature passes despite non-matching value.
        expect(featurePasses(active, { properties: { fclass: "hotel" } }, "L1")).toBe(true);
        // On L2 the field applies → non-matching value fails.
        expect(featurePasses(active, { properties: { fclass: "hotel" } }, "L2")).toBe(false);
    });
    it("featurePasses is the conjunction of applicable active fields", () => {
        const active = [
            { descriptor: { id: "cat", kind: "taxonomy", field: "fclass" }, values: ["museum"] },
            { descriptor: { id: "tags", kind: "tag", field: "tags" }, values: ["free"] },
        ];
        expect(
            featurePasses(active, { properties: { fclass: "museum", tags: ["free"] } }, "L1")
        ).toBe(true);
        expect(
            featurePasses(active, { properties: { fclass: "museum", tags: ["paid"] } }, "L1")
        ).toBe(false);
    });
});
