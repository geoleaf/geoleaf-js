/**
 * The two icon id-spaces — the failure mode this chantier is most exposed to.
 *
 * `resolvePoiIcon` feeds `icon-image: ["get","symbolId"]`, i.e. the MapLibre ATLAS.
 * A tinted glyph is a distinct image there, so its id carries a `--<tint>` suffix.
 *
 * `resolveTitleIcon` feeds `<use href="#…">` in feature-info, i.e. the DOM `<symbol>`
 * elements of the injected sprite. There is no tinted `<symbol>` — the glyph takes
 * its colour from `currentColor`. A tinted id here resolves to nothing.
 *
 * Get this backwards and the icons silently disappear from the map (or the popup)
 * while every other test stays green — hence a file of its own.
 */
import { describe, it, expect } from "vitest";
import {
    resolvePoiIcon,
    resolveTitleIcon,
    resolveIconVariants,
} from "../../../src/capabilities/taxonomy/resolver.ts";
import { tintKey, tintedSymbolId } from "../../../src/capabilities/taxonomy/tint.ts";

const CONFIG = {
    enabled: true,
    icons: { symbolPrefix: "t-", defaultIcon: "generic" },
    render: { popup: { showIconCategory: true, showIconSubcategory: true } },
    taxonomies: {
        "poi-cat": {
            categoryField: "categoryId",
            subCategoryField: "subcategoryId",
            categories: {
                culture: {
                    svgId: "building",
                    iconColor: "#6A1B9A",
                    subcategories: {
                        // Inherits the category tint (declares none of its own).
                        musee: { svgId: "museum" },
                        // Overrides it.
                        opera: { svgId: "opera", iconColor: "#fff" },
                    },
                },
                // No iconColor anywhere: must stay untinted.
                plain: { svgId: "plain-icon" },
            },
        },
    },
    layers: { pois: { use: "poi-cat" } },
};

const feature = (categoryId, subcategoryId) => ({
    layerId: "pois",
    properties: { categoryId, subcategoryId },
});

describe("resolvePoiIcon — the MapLibre atlas id-space", () => {
    it("suffixes the tint, lower-cased and stripped of its #", () => {
        expect(resolvePoiIcon(CONFIG, feature("culture")).symbolId).toBe("t-building--6a1b9a");
    });

    it("a sub-category inherits its category's tint", () => {
        expect(resolvePoiIcon(CONFIG, feature("culture", "musee")).symbolId).toBe(
            "t-museum--6a1b9a"
        );
    });

    it("a sub-category's own iconColor wins over its category's", () => {
        expect(resolvePoiIcon(CONFIG, feature("culture", "opera")).symbolId).toBe("t-opera--fff");
    });

    it("no iconColor anywhere → NO suffix (the invariant)", () => {
        expect(resolvePoiIcon(CONFIG, feature("plain")).symbolId).toBe("t-plain-icon");
    });

    it("iconId stays the bare, unprefixed, untinted svgId", () => {
        expect(resolvePoiIcon(CONFIG, feature("culture")).iconId).toBe("building");
    });
});

describe("resolveTitleIcon — the DOM <symbol> id-space", () => {
    it("returns a RAW id even when the category is tinted", () => {
        expect(resolveTitleIcon(CONFIG, "pois", feature("culture"), "popup")).toBe("t-building");
    });

    it("never emits a tint suffix, whatever the level", () => {
        for (const f of [feature("culture"), feature("culture", "musee"), feature("plain")]) {
            expect(resolveTitleIcon(CONFIG, "pois", f, "popup")).not.toMatch(/--/);
        }
    });
});

describe("the two resolvers on the SAME feature", () => {
    it("disagree for a tinted category, and the atlas id extends the DOM id", () => {
        const f = feature("culture", "musee");
        const atlasId = resolvePoiIcon(CONFIG, f).symbolId;
        const domId = resolveTitleIcon(CONFIG, "pois", f, "popup");

        expect(atlasId).toBe("t-museum--6a1b9a");
        expect(domId).toBe("t-museum");
        expect(atlasId.startsWith(domId + "--")).toBe(true);
    });

    it("agree exactly when nothing is tinted", () => {
        const f = feature("plain");
        expect(resolvePoiIcon(CONFIG, f).symbolId).toBe(
            resolveTitleIcon(CONFIG, "pois", f, "popup")
        );
    });
});

describe("tintKey", () => {
    it("normalises hex to a bare lower-case key", () => {
        expect(tintKey("#6A1B9A")).toBe("6a1b9a");
    });

    it("collapses separators rather than stripping them, so colours stay distinct", () => {
        // Stripping non-alphanumerics would fold these two onto the same key.
        expect(tintKey("rgb(255, 0, 0)")).toBe("rgb-255-0-0");
        expect(tintKey("rgb(25, 50, 0)")).toBe("rgb-25-50-0");
        expect(tintKey("rgb(255, 0, 0)")).not.toBe(tintKey("rgb(25, 50, 0)"));
    });

    it("never produces the `--` separator itself, so the suffix stays unambiguous", () => {
        for (const c of ["#fff", "rgba(0,0,0,.5)", "hsl(10, 20%, 30%)", "red"]) {
            expect(tintKey(c)).not.toMatch(/--/);
        }
    });
});

describe("tintedSymbolId", () => {
    it("returns the id untouched when there is no tint", () => {
        expect(tintedSymbolId("t-icon", null)).toBe("t-icon");
    });

    it("appends the key when there is one", () => {
        expect(tintedSymbolId("t-icon", "#ABC")).toBe("t-icon--abc");
    });
});

describe("resolveIconVariants — what the adapter has to rasterise", () => {
    it("lists every referenced (icon × tint) pair, and only those", () => {
        const variants = resolveIconVariants(CONFIG);
        expect(variants).toEqual(
            expect.arrayContaining([
                { svgId: "building", symbolId: "t-building--6a1b9a", color: "#6A1B9A" },
                { svgId: "museum", symbolId: "t-museum--6a1b9a", color: "#6A1B9A" },
                { svgId: "opera", symbolId: "t-opera--fff", color: "#fff" },
            ])
        );
    });

    it("omits untinted icons — the raw sprite pass already registers those", () => {
        const ids = resolveIconVariants(CONFIG).map((v) => v.symbolId);
        expect(ids).not.toContain("t-plain-icon");
        expect(ids.every((id) => id.includes("--"))).toBe(true);
    });

    it("is not a cartesian product: one entry per referenced pair, deduplicated", () => {
        // 2 tints across 3 icons → 3 pairs, not 3 × 2.
        expect(resolveIconVariants(CONFIG)).toHaveLength(3);
    });

    it("returns nothing when the capability is disabled", () => {
        expect(resolveIconVariants({ ...CONFIG, enabled: false })).toEqual([]);
    });
});
