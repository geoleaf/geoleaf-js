/**
 * @fileoverview Tests for scale-utils — calculateMapScale, isScaleInRange
 * @phase Phase R0 — Branch recovery TS-04
 */

import {
    calculateMapScale,
    isScaleInRange,
    scaleToZoom,
    scaleAtZoom,
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
    // The scale displayed must be the scale DRAWN. Judged against MapLibre's own definition of a
    // pixel's ground size — 512-px tiles: circumference × cos(lat) / 2^(zoom + 9) — never against
    // this module's formula, which is the thing under test. Until 3.20.5 the module used the
    // 256-px convention: every denominator was twice the truth (ratio 2.00 measured in a browser
    // at six zooms, by unprojecting two screen points), and these cases are red on that code.
    describe("scaleAtZoom — the scale actually drawn by MapLibre", () => {
        const CIRCUMFERENCE = 40075016.686;
        const drawn = (zoom, lat) =>
            ((CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) / 2 ** (zoom + 9)) * (96 / 0.0254);

        it("ratio displayed / drawn is 1.00 at the six zooms of the recipe", () => {
            for (const lat of [0, -32.95, 46.2]) {
                for (const zoom of [0, 5, 10, 14, 17, 22]) {
                    const ratio = scaleAtZoom(zoom, lat) / drawn(zoom, lat);
                    expect(ratio).toBeGreaterThan(0.99);
                    expect(ratio).toBeLessThan(1.01);
                }
            }
        });
    });

    describe("scaleToZoom", () => {
        beforeEach(() => clearScaleCache());

        it("inverts calculateMapScale (round-trip)", () => {
            // 2-decimal tolerance, no more: `calculateMapScale` ROUNDS the
            // denominator (Math.round), and that rounding costs the more
            // zoom the smaller the scale (at zoom 20, 1:564.26 becomes
            // 1:564 → +0.0006 zoom). The loss is intrinsic to the round
            // trip, not the conversion — and 0.01 zoom level is well below
            // the perceptible.
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
            // Denominators of the TRUE scale (MapLibre zooms follow 512-px tiles). Until 3.20.5 the
            // scale math used the 256-px convention and doubled every denominator: the same intended
            // zooms (6 → 18, 5) were then written 9222148 / 2252 / 18444296.
            expect(scaleToZoom(4611074, 4)).toBeCloseTo(6, 2);
            expect(scaleToZoom(1126, 4)).toBeCloseTo(18, 2);
            expect(scaleToZoom(9222148, 4)).toBeCloseTo(5, 2);
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
            expect(scaleToZoom(4611074, 4)).toBeLessThan(scaleToZoom(1126, 4));
        });

        it("returns null for a disabled or invalid bound", () => {
            expect(scaleToZoom(null, 4)).toBeNull();
            expect(scaleToZoom(undefined, 4)).toBeNull();
            expect(scaleToZoom(0, 4)).toBeNull(); // "constraint disabled" convention
            expect(scaleToZoom(-100, 4)).toBeNull();
            expect(scaleToZoom(Number.NaN, 4)).toBeNull();
            expect(scaleToZoom(Number.POSITIVE_INFINITY, 4)).toBeNull();
            expect(scaleToZoom(1000, Number.NaN)).toBeNull();
        });

        it("returns null beyond Web Mercator's latitude limit", () => {
            // Math.cos(90°) is 6.1e-17, not 0: without an explicit latitude
            // guard, the conversion would return a clamped zoom (0) instead
            // of "no answer".
            expect(scaleToZoom(1000, 90)).toBeNull();
            expect(scaleToZoom(1000, -90)).toBeNull();
            expect(scaleToZoom(1000, 85.06)).toBeNull();
            expect(scaleToZoom(1000, 85)).not.toBeNull(); // just below: valid
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
