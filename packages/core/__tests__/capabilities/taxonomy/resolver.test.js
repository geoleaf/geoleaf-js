/**
 * Unit tests — capabilities/taxonomy resolver.
 *
 * Pure resolution: no seams, resolvers take config + values.
 *
 * ⚠ This fixture deliberately declares NO `iconColor` anywhere. That makes every
 * `symbolId` assertion below a live check of the "no tint, no suffix" invariant:
 * a profile that asks for no colour must keep byte-identical symbol ids, or its
 * icons stop matching the images registered in the atlas. Tinting is covered in
 * `id-spaces.test.js`, on its own fixture.
 */
import { describe, it, expect } from "vitest";

const {
    resolveCategoryKey,
    resolveLayerBinding,
    resolveCategoryEntry,
    resolvePoiIcon,
    resolveTitleIcon,
} = await import("../../../src/capabilities/taxonomy/resolver.ts");

const CONFIG = {
    enabled: true,
    icons: { symbolPrefix: "ref-poi-cat-", defaultIcon: "activity-generic" },
    taxonomies: {
        "poi-cat": {
            categoryField: "categoryId",
            subCategoryField: "subCategoryId",
            categories: {
                randonnee: {
                    svgId: "activity-mountain",
                    label: "Randonnée",
                    subcategories: { trail: { svgId: "activity-trail" } },
                },
                musee: { svgId: "culture-building", label: "Musée" },
                novalue: { label: "No style" },
            },
        },
    },
    layers: {
        pois: { use: "poi-cat" },
        zones: { use: "poi-cat", categoryField: "type_zone" },
        broken: { use: "missing-taxonomy" },
    },
};

const DEF = CONFIG.taxonomies["poi-cat"];

describe("resolveCategoryKey", () => {
    it("matches exact, upper, lower and case-folded keys", () => {
        expect(resolveCategoryKey(DEF.categories, "randonnee")).toBe("randonnee");
        expect(resolveCategoryKey(DEF.categories, "RANDONNEE")).toBe("randonnee");
        expect(resolveCategoryKey(DEF.categories, "Musee")).toBe("musee");
    });
    it("returns null for nullish / unknown values", () => {
        expect(resolveCategoryKey(DEF.categories, undefined)).toBeNull();
        expect(resolveCategoryKey(DEF.categories, null)).toBeNull();
        expect(resolveCategoryKey(DEF.categories, "ghost")).toBeNull();
    });
});

describe("resolveLayerBinding", () => {
    it("resolves a bound layer with its taxonomy + fields", () => {
        const b = resolveLayerBinding(CONFIG, "pois");
        expect(b?.categoryField).toBe("categoryId");
        expect(b?.subCategoryField).toBe("subCategoryId");
    });
    it("honours a per-layer categoryField override", () => {
        expect(resolveLayerBinding(CONFIG, "zones")?.categoryField).toBe("type_zone");
    });
    it("returns null for unbound layers or unknown taxonomies", () => {
        expect(resolveLayerBinding(CONFIG, "unbound")).toBeNull();
        expect(resolveLayerBinding(CONFIG, "broken")).toBeNull();
    });
});

describe("resolveCategoryEntry", () => {
    it("resolves category and matching sub-category", () => {
        const { category, sub } = resolveCategoryEntry(DEF, "randonnee", "trail");
        expect(category?.svgId).toBe("activity-mountain");
        expect(sub?.svgId).toBe("activity-trail");
    });
    it("returns null sub when no sub-category value or match", () => {
        expect(resolveCategoryEntry(DEF, "randonnee", undefined).sub).toBeNull();
        expect(resolveCategoryEntry(DEF, "musee", "x").sub).toBeNull();
    });
});

describe("resolvePoiIcon", () => {
    it("resolves sub-category icon over category icon, with prefix", () => {
        const r = resolvePoiIcon(CONFIG, {
            layerId: "pois",
            categoryId: "randonnee",
            subCategoryId: "trail",
        });
        expect(r).toEqual({
            useIcon: true,
            iconId: "activity-trail",
            symbolId: "ref-poi-cat-activity-trail",
        });
    });
    it("falls back to category icon when sub-category has none", () => {
        const r = resolvePoiIcon(CONFIG, { layerId: "pois", categoryId: "musee" });
        expect(r.iconId).toBe("culture-building");
        expect(r.symbolId).toBe("ref-poi-cat-culture-building");
    });
    it("falls back to defaultIcon for unknown / value-less categories", () => {
        expect(resolvePoiIcon(CONFIG, { layerId: "pois", categoryId: "ghost" }).iconId).toBe(
            "activity-generic"
        );
        expect(resolvePoiIcon(CONFIG, { layerId: "pois", categoryId: "novalue" }).iconId).toBe(
            "activity-generic"
        );
    });
    it("reads the category value from attributes / properties bags", () => {
        expect(
            resolvePoiIcon(CONFIG, { layerId: "pois", attributes: { categoryId: "musee" } }).iconId
        ).toBe("culture-building");
        expect(
            resolvePoiIcon(CONFIG, { layerId: "pois", properties: { categoryId: "musee" } }).iconId
        ).toBe("culture-building");
    });
    it("uses _layerConfig.id when layerId is absent", () => {
        expect(
            resolvePoiIcon(CONFIG, { _layerConfig: { id: "pois" }, categoryId: "musee" }).useIcon
        ).toBe(true);
    });
    it("returns no-icon when no layer, no binding, or no icon resolves", () => {
        expect(resolvePoiIcon(CONFIG, { categoryId: "musee" }).useIcon).toBe(false);
        expect(resolvePoiIcon(CONFIG, { layerId: "unbound", categoryId: "musee" }).useIcon).toBe(
            false
        );
        const noDefault = { ...CONFIG, icons: { symbolPrefix: "p-" } };
        expect(resolvePoiIcon(noDefault, { layerId: "pois", categoryId: "ghost" }).useIcon).toBe(
            false
        );
    });
});

describe("resolveTitleIcon", () => {
    // Per-surface flags: popup enables both levels, sidepanel only the category,
    // tooltip neither.
    const RENDER = {
        ...CONFIG,
        render: {
            popup: { showIconCategory: true, showIconSubcategory: true },
            sidepanel: { showIconCategory: true },
            tooltip: {},
        },
    };
    const feature = { attributes: { categoryId: "randonnee", subCategoryId: "trail" } };

    it("resolves the sub-category icon (priority) when both flags on and sub resolves", () => {
        expect(resolveTitleIcon(RENDER, "pois", feature, "popup")).toBe(
            "ref-poi-cat-activity-trail"
        );
    });

    it("resolves the category icon when only the category flag is on", () => {
        expect(resolveTitleIcon(RENDER, "pois", feature, "sidepanel")).toBe(
            "ref-poi-cat-activity-mountain"
        );
    });

    it("returns null when no flag is on for the surface", () => {
        expect(resolveTitleIcon(RENDER, "pois", feature, "tooltip")).toBeNull();
    });

    it("returns null when the config declares no render block at all", () => {
        expect(resolveTitleIcon(CONFIG, "pois", feature, "popup")).toBeNull();
    });

    it("returns null for an unbound layer", () => {
        expect(resolveTitleIcon(RENDER, "unbound", feature, "popup")).toBeNull();
    });

    it("falls back to the category icon when the sub-category has no svgId", () => {
        // musee: category icon (culture-building), no sub-category.
        const f = { attributes: { categoryId: "musee" } };
        expect(resolveTitleIcon(RENDER, "pois", f, "popup")).toBe("ref-poi-cat-culture-building");
    });

    it("falls back to defaultIcon when neither level declares an svgId", () => {
        const f = { attributes: { categoryId: "novalue" } };
        expect(resolveTitleIcon(RENDER, "pois", f, "popup")).toBe("ref-poi-cat-activity-generic");
    });

    it("with only the sub-category flag on, does not fall back to the category icon", () => {
        // musee has a category icon but no sub → sub-only flag → default, not category.
        const subOnly = { ...CONFIG, render: { popup: { showIconSubcategory: true } } };
        const f = { attributes: { categoryId: "musee" } };
        expect(resolveTitleIcon(subOnly, "pois", f, "popup")).toBe("ref-poi-cat-activity-generic");
    });

    it("returns null when nothing resolves and there is no defaultIcon", () => {
        const noDefault = { ...RENDER, icons: { symbolPrefix: "p-" } };
        const f = { attributes: { categoryId: "ghost" } };
        expect(resolveTitleIcon(noDefault, "pois", f, "popup")).toBeNull();
    });
});

describe("no tint, no suffix (the invariant that keeps existing profiles working)", () => {
    it("leaves every symbolId untinted when no category declares an iconColor", () => {
        for (const categoryId of ["randonnee", "musee", "novalue", "ghost"]) {
            const { symbolId } = resolvePoiIcon(CONFIG, { layerId: "pois", categoryId });
            expect(symbolId).not.toMatch(/--/);
            expect(symbolId).toMatch(/^ref-poi-cat-/);
        }
    });
});
