/**
 * The marker disc — taxonomy replaces the layer's DEFAULT, it does not outrank it.
 *
 * `styleRulesToPaint` emits `["case", cond₁, val₁, …, DEFAULT]` for every paint key
 * that varies across a layer's style rules. Taxonomy rewrites only the DEFAULT.
 * Effective cascade: styleRules > sub-category > category > the layer's own default.
 */
import { describe, it, expect } from "vitest";
import { buildMarkerPaint } from "../../../src/capabilities/taxonomy/marker-paint.ts";

const CONFIG = {
    enabled: true,
    taxonomies: {
        "poi-cat": {
            categoryField: "categoryId",
            subCategoryField: "subcategoryId",
            categories: {
                // Upper-case key: the match must case-fold, like resolveCategoryKey does.
                CULTURES: {
                    marker: { fill: "#6a1b9a", stroke: "#38006b", strokeWidth: 2 },
                    subcategories: {
                        MUSEE: { marker: { fill: "#8e24aa" } },
                        // No marker → falls through to its category.
                        "SITE ARCHEOLOGIQUE": {},
                    },
                },
                nature: {
                    marker: { fill: "#00695c" },
                    // ⚠ `nature.parc` and `Environnement.PARC` case-fold to the same
                    // label. A flat match on the sub-category column would collide.
                    subcategories: { parc: { marker: { fill: "#26a69a" } } },
                },
                Environnement: {
                    marker: { fill: "#2e7d32" },
                    subcategories: { PARC: { marker: { fill: "#66bb6a" } } },
                },
                // A bare icon: no disc at all.
                bare: { marker: false },
                // Declares nothing → the layer keeps this feature entirely.
                plain: { label: "Plain" },
            },
        },
    },
    layers: { pois: { use: "poi-cat" } },
};

/** Finds the value a `["match", getter, k, v, …, fallback]` maps `key` to. */
const branch = (expr, key) => {
    for (let i = 2; i < expr.length - 1; i += 2) if (expr[i] === key) return expr[i + 1];
    return undefined;
};
const fallbackOf = (expr) => expr[expr.length - 1];

describe("buildMarkerPaint — when it declines to act", () => {
    it("returns null for an unbound layer", () => {
        expect(buildMarkerPaint(CONFIG, "not-bound", {})).toBeNull();
    });

    it("returns null when the capability is disabled", () => {
        expect(buildMarkerPaint({ ...CONFIG, enabled: false }, "pois", {})).toBeNull();
    });

    it("returns null when no category declares a marker at all", () => {
        const cfg = {
            enabled: true,
            taxonomies: { t: { categoryField: "c", categories: { a: { label: "A" } } } },
            layers: { pois: { use: "t" } },
        };
        expect(buildMarkerPaint(cfg, "pois", { "circle-color": "#f00" })).toBeNull();
    });

    it("never touches circle-radius — point SIZE belongs to the layer", () => {
        const paint = buildMarkerPaint(CONFIG, "pois", { "circle-radius": 8 });
        expect(paint).not.toHaveProperty("circle-radius");
    });
});

describe("buildMarkerPaint — replacing the default", () => {
    it("turns a scalar into a match that falls back to that same scalar", () => {
        const { "circle-color": expr } = buildMarkerPaint(CONFIG, "pois", {
            "circle-color": "#e74c3c",
        });
        expect(expr[0]).toBe("match");
        expect(fallbackOf(expr)).toBe("#e74c3c");
    });

    it("keeps every style-rule branch of a case, swapping only its default", () => {
        const styleRules = [
            "case",
            ["==", ["get", "fclass"], "museum"],
            "#bb1fd9",
            ["==", ["get", "fclass"], "hotel"],
            "#add42d",
            "#cccccc",
        ];
        const { "circle-color": expr } = buildMarkerPaint(CONFIG, "pois", {
            "circle-color": styleRules,
        });

        expect(expr[0]).toBe("case");
        // The two business rules survive untouched — styleRules still win.
        expect(expr.slice(0, 5)).toEqual(styleRules.slice(0, 5));
        // Only the last element changed, and it falls back to the old default.
        expect(expr[5][0]).toBe("match");
        expect(fallbackOf(expr[5])).toBe("#cccccc");
    });

    it("uses MapLibre's spec default, not GeoLeaf's grey, for an absent key", () => {
        // `_getPaintDefault` would say #cccccc — that would paint a colour where the
        // layer asked for none.
        const { "circle-color": expr } = buildMarkerPaint(CONFIG, "pois", {});
        expect(fallbackOf(expr)).toBe("#000000");
    });

    it("refuses to rewrite an expression it did not build (expressionPaint)", () => {
        // A raw MapLibre expression merged in by `defaultStyle.expressionPaint`.
        const raw = ["interpolate", ["linear"], ["zoom"], 0, "#111", 10, "#222"];
        const paint = buildMarkerPaint(CONFIG, "pois", { "circle-color": raw });
        expect(paint["circle-color"]).toBeUndefined();
    });
});

describe("buildMarkerPaint — the expression itself", () => {
    it("case-folds the category column, like resolveCategoryKey does", () => {
        const { "circle-color": expr } = buildMarkerPaint(CONFIG, "pois", {});
        expect(expr[1]).toEqual(["downcase", ["to-string", ["get", "categoryId"]]]);
        // The config key is `CULTURES`; the branch label must be folded.
        expect(branch(expr, "cultures")).toBeDefined();
        expect(branch(expr, "CULTURES")).toBeUndefined();
    });

    it("nests by CATEGORY first, so colliding sub-category labels stay apart", () => {
        const { "circle-color": expr } = buildMarkerPaint(CONFIG, "pois", {});

        // Both categories have a sub-category folding to "parc" — they must not mix.
        const natureBranch = branch(expr, "nature");
        const envBranch = branch(expr, "environnement");

        expect(natureBranch[0]).toBe("match");
        expect(envBranch[0]).toBe("match");
        expect(branch(natureBranch, "parc")).toBe("#26a69a");
        expect(branch(envBranch, "parc")).toBe("#66bb6a");
    });

    it("a sub-category with no marker inherits its category's colour", () => {
        const { "circle-color": expr } = buildMarkerPaint(CONFIG, "pois", {});
        const cultures = branch(expr, "cultures");
        expect(branch(cultures, "musee")).toBe("#8e24aa"); // its own
        // "SITE ARCHEOLOGIQUE" declares none → not a branch; the inner fallback is
        // the category's own colour.
        expect(branch(cultures, "site archeologique")).toBeUndefined();
        expect(fallbackOf(cultures)).toBe("#6a1b9a");
    });

    it("a category that declares nothing falls through to the layer's default", () => {
        const { "circle-color": expr } = buildMarkerPaint(CONFIG, "pois", {
            "circle-color": "#layer",
        });
        expect(branch(expr, "plain")).toBeUndefined();
        expect(fallbackOf(expr)).toBe("#layer");
    });
});

describe("buildMarkerPaint — marker: false (a bare icon)", () => {
    it("hides the disc with circle-opacity 0 rather than a fake colour", () => {
        const { "circle-opacity": expr } = buildMarkerPaint(CONFIG, "pois", {});
        expect(branch(expr, "bare")).toBe(0);
        expect(fallbackOf(expr)).toBe(1); // MapLibre's spec default
    });

    it("also drops its border", () => {
        const { "circle-stroke-width": expr } = buildMarkerPaint(CONFIG, "pois", {});
        expect(branch(expr, "bare")).toBe(0);
    });

    it("lends no colour to circle-color — the disc is invisible anyway", () => {
        const { "circle-color": expr } = buildMarkerPaint(CONFIG, "pois", {});
        expect(branch(expr, "bare")).toBeUndefined();
    });

    it("emits no circle-opacity key when no category is bare", () => {
        const cfg = {
            enabled: true,
            taxonomies: {
                t: { categoryField: "c", categories: { a: { marker: { fill: "#f00" } } } },
            },
            layers: { pois: { use: "t" } },
        };
        expect(buildMarkerPaint(cfg, "pois", {})).not.toHaveProperty("circle-opacity");
    });
});

describe("buildMarkerPaint — falsy values are values", () => {
    it("preserves a declared strokeWidth of 0 (a disc with no border)", () => {
        const cfg = {
            enabled: true,
            taxonomies: {
                t: {
                    categoryField: "c",
                    categories: { a: { marker: { fill: "#f00", strokeWidth: 0 } } },
                },
            },
            layers: { pois: { use: "t" } },
        };
        const { "circle-stroke-width": expr } = buildMarkerPaint(cfg, "pois", {
            "circle-stroke-width": 3,
        });
        expect(branch(expr, "a")).toBe(0);
        expect(fallbackOf(expr)).toBe(3);
    });
});
