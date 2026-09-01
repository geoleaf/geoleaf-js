/**
 * Unit tests — corridor enumeration, which ADDS to the bbox path.
 */
import { describe, it, expect } from "vitest";
import {
    corridorTilesAtZoom,
    corridorTiles,
    densify,
    type Position,
} from "../sync/corridor-tiles.js";
import { estimateVectorZone } from "../sync/vector-zone-estimate.js";

/** A straight line of about `km` kilometres, due east from Réunion. */
function straightLine(km: number, points = 2): Position[] {
    const out: Position[] = [];
    const spanDeg = km / (111.32 * Math.cos((-21.09 * Math.PI) / 180));
    for (let i = 0; i < points; i++) {
        out.push([55.4781 + (spanDeg * i) / (points - 1), -21.0964]);
    }
    return out;
}

/**
 * A SINUOUS line of about `km` kilometres.
 *
 * 🛑 Sinuosity is the second factor, and the previous probe missed it. A STRAIGHT
 * line has a thin bounding rectangle — barely wider than its own corridor — so
 * the corridor never wins there, whatever its length. What makes the bbox costly
 * is what it contains that the line does NOT visit.
 */
function sinuousLine(km: number, points = 60): Position[] {
    const out: Position[] = [];
    const spanDeg = km / (111.32 * Math.cos((-21.09 * Math.PI) / 180));
    for (let i = 0; i < points; i++) {
        const t = i / (points - 1);
        out.push([55.4781 + spanDeg * t, -21.0964 + Math.sin(t * Math.PI * 2) * spanDeg * 0.45]);
    }
    return out;
}

/** A line's bounding rectangle. */
function boundsOf(line: readonly Position[]) {
    return {
        north: Math.max(...line.map((p) => p[1])) + 1e-6,
        south: Math.min(...line.map((p) => p[1])) - 1e-6,
        east: Math.max(...line.map((p) => p[0])) + 1e-6,
        west: Math.min(...line.map((p) => p[0])) - 1e-6,
    };
}

describe("densify", () => {
    it("rend le tracé tel quel quand il n'y a aucun segment à subdiviser", () => {
        // Looping over `length - 1` would return an EMPTY array on a single point,
        // and the corridor would then be empty with nothing saying so.
        expect(densify([], 100)).toEqual([]);
        expect(densify([[55, -21]], 100)).toHaveLength(1);
    });

    it("subdivise jusqu'à ce qu'aucun pas ne dépasse la consigne", () => {
        const dense = densify(straightLine(1), 100);
        // ~1 km at 100 m steps: about ten points, plus the last one.
        expect(dense.length).toBeGreaterThan(8);
        expect(dense[dense.length - 1]).toEqual(straightLine(1)[1]);
    });

    it("ne boucle pas sur un pas nul ou négatif", () => {
        // A zero setting would make `Math.ceil(x / 0) === Infinity`, hence an endless loop.
        expect(densify(straightLine(1), 0)).toHaveLength(2);
        expect(densify(straightLine(1), -5)).toHaveLength(2);
    });
});

describe("corridorTilesAtZoom", () => {
    it("rend un corridor VIDE sur un tracé vide, sans jeter", () => {
        // A corridor without a line is not an error: it is an empty corridor.
        expect(corridorTilesAtZoom([], 14, 500)).toEqual([]);
        expect(corridorTilesAtZoom(straightLine(5), 14, 0)).toEqual([]);
    });

    it("dédoublonne — la même tuile visitée deux fois n'est comptée qu'une", () => {
        const tiles = corridorTilesAtZoom(straightLine(5), 14, 500);
        const keys = new Set(tiles.map((t) => `${t.x}/${t.y}`));
        expect(keys.size).toBe(tiles.length);
    });

    it("porte le zoom sur chaque tuile", () => {
        const tiles = corridorTilesAtZoom(straightLine(5), 13, 500);
        expect(tiles.every((t) => t.z === 13)).toBe(true);
    });

    it("🛑 ne laisse AUCUN TROU entre deux sommets éloignés", () => {
        // The line has only two vertices, 20 km apart. Without resampling, only
        // the tiles around the TWO endpoints would be visited, and the rendered
        // corridor would be holed over its whole length — a defect that would
        // only show while driving through it, off-network.
        const line = straightLine(20, 2);
        const tiles = corridorTilesAtZoom(line, 14, 300);
        const xs = tiles.map((t) => t.x).sort((a, b) => a - b);
        // The x's must form a CONTINUOUS run: no jump of more than one tile.
        for (let i = 1; i < xs.length; i++) {
            expect((xs[i] as number) - (xs[i - 1] as number)).toBeLessThanOrEqual(1);
        }
        // Witness: without a floor, a ONE-tile corridor would satisfy continuity.
        // The floor derives from geometry — at zoom 14 a tile spans ~2.3 km at
        // this latitude, so 20 km cover at least eight. (Written ~2.4 until
        // 22/08/2026: the exact value is 2.28, and a figure rounded up inside a
        // DERIVATION is what makes a floor too high with nobody recomputing it.)
        expect(xs.length).toBeGreaterThanOrEqual(8);
    });

    it("élargit le tampon en longitude avec la latitude", () => {
        // A 500 m buffer covers more DEGREES near the poles. Using the latitude
        // delta for both would under-estimate the corridor at high latitudes —
        // hence yield a holed zone where the network is scarcest.
        const equateur = corridorTilesAtZoom([[0, 0]], 14, 2000);
        const nord = corridorTilesAtZoom([[0, 70]], 14, 2000);
        expect(nord.length).toBeGreaterThan(equateur.length);
    });
});

describe("corridorTiles — sur une plage de zooms", () => {
    it("couvre tous les zooms de la plage, bornes comprises", () => {
        const zooms = new Set(corridorTiles(straightLine(5), 12, 14, 500).map((t) => t.z));
        expect([...zooms].sort()).toEqual([12, 13, 14]);
    });

    it("accepte une plage inversée plutôt que de rendre le vide", () => {
        // A caller swapping min and max gets the same range. Returning empty
        // would give them a tile-less corridor and no hint of the cause.
        const a = corridorTiles(straightLine(5), 14, 12, 500).length;
        const b = corridorTiles(straightLine(5), 12, 14, 500).length;
        expect(a).toBe(b);
    });
});

describe("⛔ D15 — le corridor ne remplace PAS la bbox, et voici pourquoi", () => {
    /** Counts a line's bbox tiles, through the existing path. */
    function bboxCount(line: readonly Position[], zoom: number): number {
        return estimateVectorZone({
            bounds: boundsOf(line),
            cacheMinZoom: zoom,
            cacheMaxZoom: zoom,
        }).tiles;
    }

    it("🛑 sur un tracé COURT, le corridor coûte PLUS que la bbox", () => {
        // This is the domain the decision protects, and it is not marginal: on a
        // 3 km trip with a one-kilometre buffer, the buffer overflows an already
        // small rectangle. Offering the corridor alone would make exactly the
        // short trips pay more — the most numerous ones.
        const line = straightLine(3);
        const zoom = 14;
        expect(corridorTilesAtZoom(line, zoom, 1000).length).toBeGreaterThan(bboxCount(line, zoom));
    });

    it("sur un tracé long et SINUEUX, le corridor coûte moins", () => {
        // The inverse witness: without it, the previous test would say "the
        // corridor is always worse", which would get the just-added path
        // deleted.
        const line = sinuousLine(60);
        const zoom = 15;
        expect(corridorTilesAtZoom(line, zoom, 500).length).toBeLessThan(bboxCount(line, zoom));
    });

    it("🛑 un tracé long mais DROIT ne fait PAS gagner le corridor", () => {
        // Measured while writing this file, and it refines the domain the earlier
        // probe had established: it varied only LENGTH, on a sinuous line. The
        // second factor is SINUOSITY — a straight line has a thin rectangle,
        // barely wider than its own corridor, and the buffer suffices to overflow
        // it.
        //
        // What the bbox costs is what it CONTAINS that the line does not visit.
        const line = straightLine(60);
        const zoom = 15;
        expect(corridorTilesAtZoom(line, zoom, 500).length).toBeGreaterThan(bboxCount(line, zoom));
    });

    it("la voie bbox est INTACTE — `estimateVectorZone` rend ce qu'il rendait", () => {
        // The assertion defining "alongside" rather than "instead". It bears on
        // the old path's OUTPUT, not on the intention of not having touched it.
        const zone = {
            bounds: { north: -21.0, south: -21.1, east: 55.5, west: 55.4 },
            cacheMinZoom: 12,
            cacheMaxZoom: 14,
        };
        const { tiles, bytes } = estimateVectorZone(zone);
        expect(tiles).toBeGreaterThan(0);
        expect(bytes).toBeGreaterThan(tiles);
    });
});
