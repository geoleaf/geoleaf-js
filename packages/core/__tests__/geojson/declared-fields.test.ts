/**
 * The pure half of the field diagnostic: the sample, the confrontation, and the two families
 * of keys the kernel reads itself. The guard over the repository's profiles calls these same
 * functions — what is locked here is locked for the build-time verdict too.
 */
import { describe, expect, it } from "vitest";
import {
    findMissingFields,
    kernelDeclaredFields,
    sampleFeatures,
} from "../../src/kernel/geojson/declared-fields.js";
import type { DeclaredField } from "../../src/kernel/shared/declared-fields-slot.js";

const feature = (properties: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    type: "Feature",
    geometry: null,
    properties,
    ...extra,
});

/** The kernel's style-rule fields — through the entry the runtime and the guard call. */
const styleRuleDeclaredFields = (style: Record<string, unknown> | null) =>
    kernelDeclaredFields({ layerId: "l", def: {}, style });

/** The kernel's searchable fields — through the same entry. */
const searchableDeclaredFields = (def: Record<string, unknown>) =>
    kernelDeclaredFields({ layerId: "l", def, style: null });

const declared = (field: string, present: DeclaredField["present"]): DeclaredField => ({
    key: `k.${field}`,
    field,
    present,
});

describe("sampleFeatures", () => {
    it("keeps the whole collection — a copy — when it is small enough", () => {
        const all = [1, 2, 3];
        const sample = sampleFeatures(all, 3);
        expect(sample).toEqual([1, 2, 3]);
        expect(sample).not.toBe(all);
    });

    it("spreads the sample over the collection rather than taking its head", () => {
        const all = Array.from({ length: 10 }, (_, i) => i);
        expect(sampleFeatures(all, 3)).toEqual([0, 4, 8]);
    });

    it("never exceeds its size, and a size of zero samples nothing", () => {
        const all = Array.from({ length: 2500 }, (_, i) => i);
        expect(sampleFeatures(all).length).toBeLessThanOrEqual(1000);
        expect(sampleFeatures(all, 0)).toEqual([]);
    });
});

describe("findMissingFields", () => {
    const has = (key: string) => (f: { properties?: Record<string, unknown> | null }) =>
        Object.prototype.hasOwnProperty.call(f.properties ?? {}, key);

    it("keeps a field one sampled feature carries, and accuses the one none carries", () => {
        const sample = [feature({ a: 1 }), feature({ a: 2, b: 3 })];
        const missing = findMissingFields(
            [declared("b", has("b")), declared("c", has("c"))],
            sample
        );
        expect(missing).toEqual([{ key: "k.c", field: "c", suggestion: null }]);
    });

    it("proves nothing on an empty sample", () => {
        expect(findMissingFields([declared("c", has("c"))], [])).toEqual([]);
    });

    it("hints the data's casing, in the declaration's own notation", () => {
        const sample = [feature({ name: "x", attributes: { Photo: "p.jpg" } })];
        const missing = findMissingFields(
            [
                declared("properties.NAME", () => false),
                declared("attributes.photo", () => false),
                declared("argentina_population_population_2022", () => false),
            ],
            sample
        );
        expect(missing.map((m) => m.suggestion)).toEqual([
            "properties.name",
            "attributes.Photo",
            null,
        ]);
    });

    it("does not accuse a field on the word of a reader whose rule throws", () => {
        const throwing = declared("x", () => {
            throw new Error("rule broke");
        });
        expect(findMissingFields([throwing], [feature({})])).toEqual([]);
    });
});

describe("styleRuleDeclaredFields — the converter's walk and the converter's key", () => {
    const style = {
        id: "par_population",
        styleRules: [
            { when: { field: "properties.pop", operator: ">", value: 1 } },
            { when: { field: "etat", value: "HS" } }, // no operator: the converter drops it
            {
                when: {
                    all: [
                        { field: "a", operator: "==", value: 1 },
                        { all: [{ field: "properties.b", operator: "==", value: 1 }] },
                    ],
                },
            },
        ],
    };

    it("declares every condition the converter turns into an expression, keyed by its path", () => {
        expect(styleRuleDeclaredFields(style).map((d) => [d.key, d.field])).toEqual([
            ["style[par_population].styleRules[0].when.field", "properties.pop"],
            ["style[par_population].styleRules[2].when.all[0].field", "a"],
            ["style[par_population].styleRules[2].when.all[1].all[0].field", "properties.b"],
        ]);
    });

    it("reads the key under `properties`, one leading `properties.` stripped — never `attributes`", () => {
        const [pop] = styleRuleDeclaredFields(style);
        expect(pop?.present(feature({ pop: null }))).toBe(true);
        expect(pop?.present(feature({ attributes: { pop: 1 } }))).toBe(false);
        expect(pop?.present(feature({ "properties.pop": 1 }))).toBe(false);
    });

    it("declares nothing for a style without rules, or no style", () => {
        expect(styleRuleDeclaredFields({ id: "x" })).toEqual([]);
        expect(styleRuleDeclaredFields(null)).toEqual([]);
    });
});

describe("searchableDeclaredFields — the layer search's rule", () => {
    it("finds the field at the feature root, then under `properties`", () => {
        const [title, nested] = searchableDeclaredFields({
            searchable: { fields: ["title", "properties.addr.city", ""] },
        });
        expect(title?.key).toBe("searchable.fields");
        expect(title?.present(feature({}, { title: "root" }))).toBe(true);
        expect(title?.present(feature({ title: null }))).toBe(true);
        expect(title?.present(feature({ name: "x" }))).toBe(false);
        expect(nested?.present(feature({ addr: { city: "Paris" } }))).toBe(true);
        expect(nested?.present(feature({ addr: {} }))).toBe(false);
    });

    it("declares nothing for a layer that is not searchable", () => {
        expect(searchableDeclaredFields({})).toEqual([]);
    });
});

describe("kernelDeclaredFields", () => {
    it("joins the style's rules and the searchable fields", () => {
        const fields = kernelDeclaredFields({
            layerId: "l",
            def: { searchable: { fields: ["nom"] } },
            style: { id: "s", styleRules: [{ when: { field: "etat", operator: "==", value: 1 } }] },
        });
        expect(fields.map((d) => d.field)).toEqual(["etat", "nom"]);
    });
});
