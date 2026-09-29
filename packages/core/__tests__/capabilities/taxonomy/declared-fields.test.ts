/**
 * The taxonomy's side of the field diagnostic — which names it reads on a layer, where the
 * profile declares them, and the key-presence twin of its reader.
 */
import { describe, expect, it } from "vitest";
import { taxonomyDeclaredFields } from "../../../src/capabilities/taxonomy/declared-fields.js";
import { hasField, resolveFeatureEntry } from "../../../src/capabilities/taxonomy/resolver.js";
import type { TaxonomyConfig } from "../../../src/capabilities/taxonomy/types.js";

const config = (layers: TaxonomyConfig["layers"], enabled = true): TaxonomyConfig =>
    ({
        enabled,
        layers,
        taxonomies: {
            "poi-cat": {
                categoryField: "categoryId",
                subCategoryField: "subcategoryId",
                categories: {
                    eclairage: {
                        label: "Éclairage",
                        subcategories: { candelabres: { label: "Candélabres" } },
                    },
                },
            },
        },
    }) as TaxonomyConfig;

const feature = (properties: Record<string, unknown>) => ({ type: "Feature", properties });

describe("taxonomyDeclaredFields", () => {
    it("keys each field by where it is declared — the taxonomy, or the layer's override", () => {
        const fields = taxonomyDeclaredFields(
            config({ aires: { use: "poi-cat", subCategoryField: "subCategoryId" } }),
            "aires"
        );
        expect(fields.map((d) => [d.key, d.field])).toEqual([
            ["modules.taxonomy.taxonomies.poi-cat.categoryField", "categoryId"],
            ["modules.taxonomy.layers.aires.subCategoryField", "subCategoryId"],
        ]);
    });

    it("declares nothing for an unbound layer, an unknown taxonomy, or a disabled taxonomy", () => {
        expect(taxonomyDeclaredFields(config({}), "x")).toEqual([]);
        expect(taxonomyDeclaredFields(config({ x: { use: "nope" } }), "x")).toEqual([]);
        expect(taxonomyDeclaredFields(config({ x: { use: "poi-cat" } }, false), "x")).toEqual([]);
    });

    it("looks where the icon's reader looks at load time — `properties`, not a nested `attributes`", () => {
        const [cat] = taxonomyDeclaredFields(config({ l: { use: "poi-cat" } }), "l");
        expect(cat?.present(feature({ categoryId: "eclairage" }))).toBe(true);
        expect(cat?.present(feature({ categoryId: null }))).toBe(true);
        expect(cat?.present(feature({ attributes: { categoryId: "eclairage" } }))).toBe(false);
        expect(cat?.present({ type: "Feature", properties: null })).toBe(false);
    });
});

describe("hasField mirrors readField — the same three places, keys instead of values", () => {
    const cfg = config({ l: { use: "poi-cat" } });
    // `readField` is private: its verdict shows through the sub-category the resolver finds.
    const readsSub = (feat: Record<string, unknown>) =>
        resolveFeatureEntry(cfg, "l", { layerId: "l", categoryId: "eclairage", ...feat })?.sub !==
        null;

    it.each([
        ["the top level", { subcategoryId: "candelabres" }],
        ["attributes", { attributes: { subcategoryId: "candelabres" } }],
        ["properties", { properties: { subcategoryId: "candelabres" } }],
    ])("where readField finds a value — %s — hasField finds the key", (_where, feat) => {
        expect(readsSub(feat)).toBe(true);
        expect(hasField(feat, "subcategoryId")).toBe(true);
    });

    it("counts a null value as carried, where readField skips it — the documented difference", () => {
        const feat = { properties: { subcategoryId: null } };
        expect(readsSub(feat)).toBe(false);
        expect(hasField(feat, "subcategoryId")).toBe(true);
    });

    it("is case-sensitive, like readField", () => {
        const feat = { properties: { subCategoryId: "candelabres" } };
        expect(readsSub(feat)).toBe(false);
        expect(hasField(feat, "subcategoryId")).toBe(false);
    });
});
