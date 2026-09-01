/**
 * Vector zone estimation — moved from the core during the public-API review.
 *
 * ⚠️ It lived in `packages/core/__tests__/capabilities/offline/tile-math.test.js`,
 * but the function it covers was DEAD code on the core side: zero callers, and
 * the core's build pruned it from its own published artifact. Storage was its
 * only consumer — the function and its test therefore followed.
 *
 * What it guards stays the same: `estimateVectorZone` must not UNDER-estimate
 * beyond 30,000 tiles per zoom, a fixed defect (the old path enumerated the
 * coordinates and returned an empty list past its safety cap).
 */
"use strict";

import { describe, expect } from "vitest";
import { estimateVectorZone } from "../sync/vector-zone-estimate.js";
// Counter-proof: the core's enumeration, to verify the arithmetic count stays
// faithful to it UNDER its safety cap. The two implementations now live in two
// packages — precisely what this test crosses, and it had no reason to
// disappear with the move.
import { CacheCalculator } from "@core-offline/cache/calculator.js";

/**
 * Tile count for one zoom, through the public surface.
 *
 * `countTilesForBounds` is module-private (nothing outside consumes it, and the
 * orphan-export gate rightly flags a symbol exported only to be tested), so it is
 * exercised via a single-zoom `estimateVectorZone` — which is exactly one call to it.
 */
const countAt = (bounds, zoom) =>
    estimateVectorZone({ bounds, cacheMinZoom: zoom, cacheMaxZoom: zoom }).tiles;

describe("tile counting", () => {
    const bounds = { north: 49, south: 48, east: 3, west: 2 };

    test("counts a single tile at zoom 0", () => {
        expect(countAt(bounds, 0)).toBe(1);
    });

    test("agrees with the enumerated count below the safety cap", () => {
        // Same area, same zoom: the arithmetic count must match what the engine's
        // enumerator actually produces, or the estimate would lie about the download.
        for (const zoom of [5, 8, 10]) {
            expect(countAt(bounds, zoom)).toBe(
                CacheCalculator.getTileCoordsForBounds(bounds, zoom).length
            );
        }
    });

    test("approaches a fourfold growth per zoom level", () => {
        // Only asymptotically: at low zooms the +1 on each axis dominates (a 2×2 area
        // becomes 3×3, not 4×4), so this is asserted where the boundary term is small.
        const atZ12 = countAt(bounds, 12);
        const atZ13 = countAt(bounds, 13);
        expect(atZ13).toBeGreaterThan(atZ12 * 3);
        expect(atZ13).toBeLessThan(atZ12 * 5);
    });

    test("counts nothing on missing bounds", () => {
        expect(countAt(null, 10)).toBe(0);
        expect(countAt(undefined, 10)).toBe(0);
    });

    test("counts nothing on inverted bounds", () => {
        expect(countAt({ north: 48, south: 49, east: 3, west: 2 }, 10)).toBe(0);
        expect(countAt({ north: 49, south: 48, east: 2, west: 3 }, 10)).toBe(0);
    });
});

describe("estimateVectorZone()", () => {
    test("sums the tiles across the zoom range", () => {
        const zone = {
            bounds: { north: 49, south: 48, east: 3, west: 2 },
            cacheMinZoom: 5,
            cacheMaxZoom: 8,
        };
        let expected = 0;
        for (let z = 5; z <= 8; z++) expected += countAt(zone.bounds, z);
        expect(estimateVectorZone(zone).tiles).toBe(expected);
    });

    test("bytes = tiles × 30 KB + a flat 800 KB glyph/sprite allowance", () => {
        const zone = {
            bounds: { north: 49, south: 48, east: 3, west: 2 },
            cacheMinZoom: 5,
            cacheMaxZoom: 6,
        };
        const { tiles, bytes } = estimateVectorZone(zone);
        expect(bytes).toBe(tiles * 30 * 1024 + 800 * 1024);
    });

    test("an empty zoom range yields only the flat allowance", () => {
        const { tiles, bytes } = estimateVectorZone({
            bounds: { north: 49, south: 48, east: 3, west: 2 },
            cacheMinZoom: 8,
            cacheMaxZoom: 7, // max < min → no iteration
        });
        expect(tiles).toBe(0);
        expect(bytes).toBe(800 * 1024);
    });

    test("unusable bounds yield no tiles", () => {
        expect(
            estimateVectorZone({
                bounds: null,
                cacheMinZoom: 5,
                cacheMaxZoom: 10,
            }).tiles
        ).toBe(0);
    });

    // ── The regression this extraction fixed ──
    test("does NOT drop a zoom that exceeds 30 000 tiles (S1 fix)", () => {
        // A 2°×2° zone at zoom 15 sits past the old enumerator's per-zoom cap.
        const bounds = { north: 50, south: 48, east: 4, west: 2 };
        const count = countAt(bounds, 15);
        expect(count).toBeGreaterThan(30000);

        // The old path returned [] here, so the zoom contributed 0 to the estimate.
        expect(CacheCalculator.getTileCoordsForBounds(bounds, 15)).toEqual([]);

        // The estimate now reports those tiles instead of silently ignoring them.
        const { tiles } = estimateVectorZone({
            bounds,
            cacheMinZoom: 15,
            cacheMaxZoom: 15,
        });
        expect(tiles).toBe(count);
    });
});
