/**
 * The adapter seam that splices the taxonomy marker into a point layer's paint.
 *
 * Two things are load-bearing here.
 *
 * 1. **No seam → no-op.** The Lite bundle and most adapter tests run without
 *    `GeoLeaf.Taxonomy`. Their circle paint must come out byte-identical, or a
 *    dozen unrelated tests go red and the Lite build starts painting discs it was
 *    never given.
 *
 * 2. **Order vs. the pending-sync badge.** `applyPendingBadgePaint` WRAPS
 *    `circle-stroke-*` in `["case", SYNC_PENDING, …, existing]`, taking whatever is
 *    there as its fallback. Taxonomy must run FIRST, so its expression ends up
 *    nested inside the sync case and both features survive. Reverse them and the
 *    offline sync badge is silently overwritten.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
    applyTaxonomyMarkerPaint,
    resolveIconSize,
} from "../../src/adapters/maplibre/maplibre-taxonomy-paint.ts";
import { applyPendingBadgePaint } from "../../src/adapters/maplibre/maplibre-sync-badge.ts";

/** Mounts a minimal `GeoLeaf.Taxonomy` seam. */
function mountSeam(seam) {
    globalThis.GeoLeaf = { ...(globalThis.GeoLeaf ?? {}), Taxonomy: seam };
}

afterEach(() => {
    if (globalThis.GeoLeaf) delete globalThis.GeoLeaf.Taxonomy;
});

describe("no seam, no change", () => {
    it("leaves the paint untouched when GeoLeaf.Taxonomy is absent", () => {
        const paint = { "circle-color": "#f00", "circle-radius": 6 };
        applyTaxonomyMarkerPaint(paint, "pois");
        expect(paint).toEqual({ "circle-color": "#f00", "circle-radius": 6 });
    });

    it("leaves it untouched when the seam has no resolveMarkerPaint", () => {
        mountSeam({});
        const paint = { "circle-color": "#f00" };
        applyTaxonomyMarkerPaint(paint, "pois");
        expect(paint).toEqual({ "circle-color": "#f00" });
    });

    it("leaves it untouched when taxonomy declines (unbound layer)", () => {
        mountSeam({ resolveMarkerPaint: () => null });
        const paint = { "circle-color": "#f00" };
        applyTaxonomyMarkerPaint(paint, "pois");
        expect(paint).toEqual({ "circle-color": "#f00" });
    });
});

describe("applying the overrides", () => {
    it("writes back only the keys taxonomy returned", () => {
        mountSeam({
            resolveMarkerPaint: () => ({ "circle-color": ["match", "…"] }),
        });
        const paint = { "circle-color": "#f00", "circle-radius": 9 };
        applyTaxonomyMarkerPaint(paint, "pois");

        expect(paint["circle-color"]).toEqual(["match", "…"]);
        expect(paint["circle-radius"]).toBe(9); // untouched — size belongs to the layer
    });

    it("hands taxonomy the CURRENT paint, so it can reuse it as its fallback", () => {
        let seen = null;
        mountSeam({
            resolveMarkerPaint: (_layerId, existing) => {
                seen = existing;
                return null;
            },
        });
        const paint = { "circle-color": ["case", ["==", 1, 1], "#a", "#default"] };
        applyTaxonomyMarkerPaint(paint, "pois");
        expect(seen).toBe(paint);
    });
});

describe("order vs. the pending-sync badge (the one that must not be swapped)", () => {
    const TAX_STROKE = ["match", ["get", "categoryId"], "culture", "#38006b", "#000"];

    /** Reproduces `_addPointSubLayers`: taxonomy first, sync badge second. */
    function buildPaint() {
        const paint = { "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5 };
        mountSeam({
            resolveMarkerPaint: () => ({
                "circle-stroke-color": TAX_STROKE,
                "circle-stroke-width": 2,
            }),
        });
        applyTaxonomyMarkerPaint(paint, "pois");
        applyPendingBadgePaint(paint);
        return paint;
    }

    it("leaves the sync case on the outside", () => {
        const paint = buildPaint();
        expect(paint["circle-stroke-color"][0]).toBe("case");
        // Position 2 is the pending-sync colour — the badge still works.
        expect(paint["circle-stroke-color"][2]).toBe("#ff9800");
    });

    it("nests the taxonomy expression inside it, as the fallback", () => {
        const paint = buildPaint();
        const expr = paint["circle-stroke-color"];
        expect(expr[expr.length - 1]).toEqual(TAX_STROKE);
    });

    it("does the same for the stroke width", () => {
        const paint = buildPaint();
        const expr = paint["circle-stroke-width"];
        expect(expr[0]).toBe("case");
        expect(expr[expr.length - 1]).toBe(2);
    });
});

describe("resolveIconSize", () => {
    it("falls back to the historical 0.5 with no seam", () => {
        expect(resolveIconSize()).toBe(0.5);
    });

    it("falls back to 0.5 when the profile sets no iconSize", () => {
        mountSeam({ getIcons: () => ({ spriteUrl: "s.svg" }) });
        expect(resolveIconSize()).toBe(0.5);
    });

    it("honours a profile's iconSize", () => {
        mountSeam({ getIcons: () => ({ iconSize: 0.8 }) });
        expect(resolveIconSize()).toBe(0.8);
    });

    it("ignores a nonsensical value rather than shrinking every icon to nothing", () => {
        mountSeam({ getIcons: () => ({ iconSize: 0 }) });
        expect(resolveIconSize()).toBe(0.5);
    });
});
