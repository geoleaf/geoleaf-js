/**
 * Unit tests — a stop far from the route computed for it.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { describe, it, expect } from "vitest";
import { hasStopFarFromRoad } from "../stop-gap.js";

const LINE = [
    [55.45, -20.88],
    [55.46, -20.89],
] as const;

describe("hasStopFarFromRoad", () => {
    it("une étape au bord de la route ne dit rien", () => {
        expect(hasStopFarFromRoad([{ coordinates: [55.4502, -20.8801] }], LINE)).toBe(false);
    });

    it("🛑 une étape en mer le dit, quelle que soit la réussite du moteur", () => {
        expect(hasStopFarFromRoad([{ coordinates: [54.9, -21.0] }], LINE)).toBe(true);
    });

    it("une seule étape lointaine suffit", () => {
        const stops = [
            { coordinates: [55.45, -20.88] as const },
            { coordinates: [55.6, -20.88] as const },
        ];
        expect(hasStopFarFromRoad(stops, LINE)).toBe(true);
    });

    it("sans géométrie, rien n'est affirmé", () => {
        expect(hasStopFarFromRoad([{ coordinates: [54.9, -21.0] }], [])).toBe(false);
    });
});
