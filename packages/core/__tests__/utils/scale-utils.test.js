/**
 * @fileoverview Tests for scale-utils — calculateMapScale, isScaleInRange
 * @phase Phase R0 — Branch recovery TS-04
 */

import {
    calculateMapScale,
    isScaleInRange,
    scaleToZoom,
    clearScaleCache,
} from "../../src/utils/general/scale-utils.js";

describe("scale-utils", () => {
    describe("calculateMapScale", () => {
        it("returns 0 when map is null", () => {
            expect(calculateMapScale(null)).toBe(0);
        });

        it("returns 0 when center or zoom is missing", () => {
            const map = { getCenter: () => null, getZoom: () => 12 };
            expect(calculateMapScale(map)).toBe(0);

            const map2 = { getCenter: () => ({ lat: 48.85 }), getZoom: () => null };
            expect(calculateMapScale(map2)).toBe(0);
        });

        it("calculates a positive scale for valid map", () => {
            const map = { getCenter: () => ({ lat: 48.85 }), getZoom: () => 12 };
            const scale = calculateMapScale(map);
            expect(scale).toBeGreaterThan(0);
        });

        it("returns cached scale on second identical call", () => {
            const map = { getCenter: () => ({ lat: 48.85 }), getZoom: () => 14 };
            const scale1 = calculateMapScale(map);
            const scale2 = calculateMapScale(map);
            expect(scale2).toBe(scale1);
        });
    });

    // scaleToZoom is what lets the ENGINE carry a constraint the profile expresses in the
    // user's unit (scale denominators). It must be the exact inverse of calculateMapScale:
    // if the two drift, layers hide at the wrong zoom — the N-1 failure mode all over again.
    describe("scaleToZoom", () => {
        beforeEach(() => clearScaleCache());

        it("inverts calculateMapScale (round-trip)", () => {
            // Tolérance 2 décimales, pas davantage : `calculateMapScale` ARRONDIT le
            // dénominateur (Math.round), et cet arrondi coûte d'autant plus de zoom que
            // l'échelle est petite (à zoom 20, 1:564,26 devient 1:564 → +0,0006 zoom).
            // La perte est intrinsèque à l'aller-retour, pas à la conversion — et 0,01
            // niveau de zoom est très en deçà du perceptible.
            for (const lat of [0, 4, 46.2, -40.4, 60]) {
                for (const zoom of [0, 5, 6, 10, 14, 18, 20]) {
                    const scale = calculateMapScale(
                        { getCenter: () => ({ lat }), getZoom: () => zoom },
                        { force: true }
                    );
                    expect(scaleToZoom(scale, lat)).toBeCloseTo(zoom, 2);
                }
            }
        });

        it("maps the real guyane bounds back to their intended zooms", () => {
            // profiles/guyane-biodiversite (lat ~4°N) — the values N-1 converted.
            expect(scaleToZoom(9222148, 4)).toBeCloseTo(6, 2);
            expect(scaleToZoom(2252, 4)).toBeCloseTo(18, 2);
            expect(scaleToZoom(18444296, 4)).toBeCloseTo(5, 2);
        });

        it("depends on latitude, not on zoom", () => {
            // Same denominator, different latitudes => different zooms. This is precisely
            // why a scale bound is not a fixed minzoom, and why the native handover has to
            // recompute on latitude changes only.
            const atEquator = scaleToZoom(1000000, 0);
            const atSixty = scaleToZoom(1000000, 60);
            expect(atEquator).toBeGreaterThan(atSixty);
            // cos(60°) = 0.5 => exactly one zoom level apart.
            expect(atEquator - atSixty).toBeCloseTo(1, 3);
        });

        it("preserves order: a larger denominator yields a lower zoom", () => {
            expect(scaleToZoom(9222148, 4)).toBeLessThan(scaleToZoom(2252, 4));
        });

        it("returns null for a disabled or invalid bound", () => {
            expect(scaleToZoom(null, 4)).toBeNull();
            expect(scaleToZoom(undefined, 4)).toBeNull();
            expect(scaleToZoom(0, 4)).toBeNull(); // convention "contrainte désactivée"
            expect(scaleToZoom(-100, 4)).toBeNull();
            expect(scaleToZoom(Number.NaN, 4)).toBeNull();
            expect(scaleToZoom(Number.POSITIVE_INFINITY, 4)).toBeNull();
            expect(scaleToZoom(1000, Number.NaN)).toBeNull();
        });

        it("returns null beyond Web Mercator's latitude limit", () => {
            // Math.cos(90°) vaut 6.1e-17, pas 0 : sans garde explicite sur la latitude, la
            // conversion rendrait un zoom clampé (0) au lieu de « pas de réponse ».
            expect(scaleToZoom(1000, 90)).toBeNull();
            expect(scaleToZoom(1000, -90)).toBeNull();
            expect(scaleToZoom(1000, 85.06)).toBeNull();
            expect(scaleToZoom(1000, 85)).not.toBeNull(); // juste en deçà : valide
        });

        it("clamps to MapLibre's [0 ; 24]", () => {
            // 1:6 would need zoom ~27 — the very value that hid 18 layers.
            expect(scaleToZoom(6, 4)).toBe(24);
            // A denominator larger than the whole world maps below zoom 0.
            expect(scaleToZoom(10_000_000_000, 4)).toBe(0);
        });
    });

    describe("isScaleInRange", () => {
        it("returns true when scale is within range", () => {
            expect(isScaleInRange(5000, 50000, 1000)).toBe(true);
        });

        it("returns false when scale exceeds minScale (too zoomed out)", () => {
            expect(isScaleInRange(100000, 50000, null)).toBe(false);
        });

        it("returns false when scale is below maxScale (too zoomed in)", () => {
            expect(isScaleInRange(500, 50000, 1000)).toBe(false);
        });

        it("logs debug messages when logger is provided", () => {
            const logger = { debug: vi.fn() };
            isScaleInRange(5000, 50000, 1000, logger);
            expect(logger.debug).toHaveBeenCalled();
        });

        it("logs out-of-range debug when exceeds minScale with logger", () => {
            const logger = { debug: vi.fn() };
            isScaleInRange(100000, 50000, null, logger);
            expect(logger.debug).toHaveBeenCalled();
        });

        it("logs out-of-range debug when below maxScale with logger", () => {
            const logger = { debug: vi.fn() };
            isScaleInRange(500, 50000, 1000, logger);
            expect(logger.debug).toHaveBeenCalled();
        });
    });
});
