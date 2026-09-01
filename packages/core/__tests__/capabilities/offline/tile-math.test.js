/**
 * Unit tests — tile-math (CAPACITÉS S1)
 *
 * Covers the pure tile arithmetic extracted from `calculator.ts` so that
 * `plugin-storage` can bundle it without dragging the core logger along.
 *
 * Two things are pinned here beyond plain arithmetic:
 *   1. `CacheCalculator.latLngToTile` still delegates faithfully, `defaults` mutation
 *      included — the extraction must not have changed the engine's behaviour.
 *   2. `estimateVectorZone` no longer under-reports past 30 000 tiles/zoom. That was a
 *      silent bug: the old implementation enumerated coordinates through
 *      `getTileCoordsForBounds`, which returns an EMPTY list past that safety cap, so
 *      the offending zoom contributed 0 to the estimate.
 */

import * as TileMath from "../../../src/capabilities/offline/cache/tile-math.js";
import { CacheCalculator } from "../../../src/capabilities/offline/cache/calculator.js";

describe("tile-math", () => {
    // ----- latLngToTile -----

    describe("latLngToTile()", () => {
        test("at zoom 0 the whole world is tile (0,0)", () => {
            expect(TileMath.latLngToTile(0, 0, 0)).toEqual({ x: 0, y: 0 });
        });

        test("returns integer coordinates", () => {
            const tile = TileMath.latLngToTile(48.8566, 2.3522, 12);
            expect(Number.isInteger(tile.x)).toBe(true);
            expect(Number.isInteger(tile.y)).toBe(true);
        });

        test("clamps latitude to the Web Mercator cutoff", () => {
            // Beyond the cutoff the projection diverges; both must land on the same tile.
            // The cutoff is read from CacheCalculator, which holds the mutable copy.
            expect(TileMath.latLngToTile(89.9, 0, 5)).toEqual(
                TileMath.latLngToTile(CacheCalculator.defaults.webMercatorMaxLat, 0, 5)
            );
        });

        test("clamps longitude to [-180, 180]", () => {
            expect(TileMath.latLngToTile(0, 250, 4)).toEqual(TileMath.latLngToTile(0, 180, 4));
        });

        test("honours an explicit maxLat argument", () => {
            const tight = TileMath.latLngToTile(80, 0, 6, 45);
            const clamped = TileMath.latLngToTile(45, 0, 6, 45);
            expect(tight).toEqual(clamped);
        });
    });

    // ----- Delegation from CacheCalculator (no behaviour change) -----

    describe("CacheCalculator.latLngToTile() delegation", () => {
        test("matches the pure helper on the default cutoff", () => {
            for (const [lat, lng, zoom] of [
                [48.8566, 2.3522, 10],
                [-33.8688, 151.2093, 14],
                [0, 0, 0],
            ]) {
                expect(CacheCalculator.latLngToTile(lat, lng, zoom)).toEqual(
                    TileMath.latLngToTile(lat, lng, zoom)
                );
            }
        });

        test("still honours a mutated defaults.webMercatorMaxLat", () => {
            const original = CacheCalculator.defaults.webMercatorMaxLat;
            try {
                CacheCalculator.defaults.webMercatorMaxLat = 45;
                // With the cutoff lowered, lat 80 must clamp down to 45.
                expect(CacheCalculator.latLngToTile(80, 0, 6)).toEqual(
                    TileMath.latLngToTile(45, 0, 6, 45)
                );
            } finally {
                CacheCalculator.defaults.webMercatorMaxLat = original;
            }
        });
    });

    // ----- countTilesForBounds -----

    // Public API review — the `tile counting` describe followed
    // `estimateVectorZone` to storage: it exercised `countTilesForBounds`
    // (private) THROUGH it. The core keeps what it really uses, `latLngToTile`.

    // ----- estimateVectorZone -----

    // Public API review — the `estimateVectorZone()` describe was MOVED to
    // `packages/plugins/offline-ui/src/__tests__/vector-zone-estimate.test.js`,
    // with the function. It was dead code here: zero core callers, pruned
    // from the published artefact.
});
