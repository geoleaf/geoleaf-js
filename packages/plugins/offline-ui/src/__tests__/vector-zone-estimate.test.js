/**
 * Estimation d'une zone vecteur — déplacée du core à l'API publique S4.4.
 *
 * ⚠️ Elle vivait dans `packages/core/__tests__/capabilities/offline/tile-math.test.js`, mais
 * la fonction qu'elle couvre était du code MORT côté core : zéro appelant, et le build du core
 * l'élaguait de son propre artefact publié. Storage en était le seul consommateur — la
 * fonction et son test l'ont donc suivi.
 *
 * Ce qu'elle garde reste le même : `estimateVectorZone` ne doit pas SOUS-estimer au-delà de
 * 30 000 tuiles par zoom, défaut corrigé au CAPACITÉS S1 (l'ancienne voie énumérait les
 * coordonnées et rendait une liste vide passé son plafond de sécurité).
 */
"use strict";

import { describe, expect } from "vitest";
import { estimateVectorZone } from "../sync/vector-zone-estimate.js";
// Contre-épreuve : l'énumération du core, pour vérifier que le comptage arithmétique lui est
// fidèle SOUS son plafond de sécurité. Les deux implémentations vivent désormais dans deux
// paquets — c'est précisément ce que ce test croise, et il n'avait pas de raison de disparaître
// avec le déplacement.
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
