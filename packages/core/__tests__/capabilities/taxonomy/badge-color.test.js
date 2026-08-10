/**
 * Pill badge colours — taxonomy decides, feature-info paints.
 *
 * The routing is by COLUMN NAME, not by the field's `style`. Profiles do not tag
 * their badges consistently: in `tourism/cultures` the sidepanel badges carry
 * `style: "category"` while the popup badges carry only `field: "properties.categoryId"`.
 * Routing on `style` would leave the popup grey, and nobody would notice for months.
 */
import { describe, it, expect } from "vitest";
import { resolveBadgeStyle } from "../../../src/capabilities/taxonomy/badge.ts";

const CONFIG = {
    enabled: true,
    render: {
        popup: { colorBadges: true },
        sidepanel: { colorBadges: false },
        tooltip: {},
    },
    taxonomies: {
        "poi-cat": {
            categoryField: "categoryId",
            subCategoryField: "subcategoryId",
            categories: {
                culture: {
                    marker: { fill: "#6a1b9a", stroke: "#38006b" },
                    subcategories: {
                        musee: { marker: { fill: "#8e24aa", stroke: "#4a148c" } },
                        // No marker → inherits its category's colours.
                        opera: {},
                    },
                },
                // A bare icon has no colours to lend.
                bare: { marker: false },
                // Declares nothing at all.
                plain: { label: "Plain" },
                // A light fill — the text must flip to dark for contrast.
                light: { marker: { fill: "#fdd835" } },
            },
        },
    },
    layers: { pois: { use: "poi-cat" } },
};

const feature = (categoryId, subcategoryId) => ({ properties: { categoryId, subcategoryId } });

const badge = (cat, sub, field, surface = "popup") =>
    resolveBadgeStyle(CONFIG, "pois", feature(cat, sub), surface, field);

describe("the colorBadges gate", () => {
    it("colours nothing until a surface opts in", () => {
        expect(badge("culture", null, "categoryId", "sidepanel")).toBeNull();
        expect(badge("culture", null, "categoryId", "tooltip")).toBeNull();
    });

    it("colours the surface that did", () => {
        expect(badge("culture", null, "categoryId", "popup")).not.toBeNull();
    });

    it("stays silent when the capability is off", () => {
        const off = { ...CONFIG, enabled: false };
        expect(
            resolveBadgeStyle(off, "pois", feature("culture"), "popup", "categoryId")
        ).toBeNull();
    });
});

describe("routing by column name", () => {
    it("matches the layer's categoryField", () => {
        expect(badge("culture", null, "categoryId")?.background).toBe("#6a1b9a");
    });

    it("matches its subCategoryField", () => {
        expect(badge("culture", "musee", "subcategoryId")?.background).toBe("#8e24aa");
    });

    it("strips the `properties.` prefix profiles write in popup badges", () => {
        // The exact shape of tourism/cultures' popup config.
        expect(badge("culture", null, "properties.categoryId")?.background).toBe("#6a1b9a");
        expect(badge("culture", "musee", "properties.subcategoryId")?.background).toBe("#8e24aa");
    });

    it("leaves somebody else's badge alone", () => {
        expect(badge("culture", null, "properties.opening_hours")).toBeNull();
    });
});

describe("what a badge inherits, and what it declines", () => {
    it("a sub-category with no marker falls back to its category's colours", () => {
        const b = badge("culture", "opera", "subcategoryId");
        expect(b?.background).toBe("#6a1b9a");
        expect(b?.border).toBe("#38006b");
    });

    it("a bare icon (marker: false) lends no colours", () => {
        expect(badge("bare", null, "categoryId")).toBeNull();
    });

    it("a category that declares nothing lends nothing", () => {
        expect(badge("plain", null, "categoryId")).toBeNull();
    });

    it("an unknown category resolves to nothing", () => {
        expect(badge("ghost", null, "categoryId")).toBeNull();
    });

    it("falls back to the fill when no stroke is declared", () => {
        expect(badge("light", null, "categoryId")?.border).toBe("#fdd835");
    });
});

describe("text contrast", () => {
    it("uses white on a dark fill", () => {
        expect(badge("culture", null, "categoryId")?.text).toBe("#ffffff");
    });

    it("flips to dark on a light fill — the bug that made the pills unreadable", () => {
        expect(badge("light", null, "categoryId")?.text).toBe("#1f2937");
    });
});

describe("colour validation (the values come from a profile, i.e. from data)", () => {
    it("drops a colour the CSS parser would reject", () => {
        const bad = {
            ...CONFIG,
            taxonomies: {
                "poi-cat": {
                    categoryField: "categoryId",
                    categories: { evil: { marker: { fill: "red; background:url(//x)" } } },
                },
            },
        };
        expect(resolveBadgeStyle(bad, "pois", feature("evil"), "popup", "categoryId")).toBeNull();
    });

    it("accepts the notations a profile legitimately uses", () => {
        const ok = {
            ...CONFIG,
            taxonomies: {
                "poi-cat": {
                    categoryField: "categoryId",
                    categories: {
                        hex3: { marker: { fill: "#f00" } },
                        rgb: { marker: { fill: "rgb(255, 0, 0)" } },
                    },
                },
            },
        };
        expect(
            resolveBadgeStyle(ok, "pois", feature("hex3"), "popup", "categoryId")?.background
        ).toBe("#f00");
        expect(
            resolveBadgeStyle(ok, "pois", feature("rgb"), "popup", "categoryId")?.background
        ).toBe("rgb(255, 0, 0)");
    });
});
