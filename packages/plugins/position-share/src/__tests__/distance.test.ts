/**
 * @geoleaf-plugins/position-share — distance guard
 */
import { describe, it, expect } from "vitest";

import { distanceMetres, hasMovedEnough } from "../distance.js";

describe("distanceMetres", () => {
    it("is zero for a point against itself", () => {
        expect(distanceMetres({ lat: 48.85, lng: 2.35 }, { lat: 48.85, lng: 2.35 })).toBe(0);
    });

    it("matches the known length of one degree of latitude", () => {
        // ~111.2 km per degree of latitude, anywhere on the globe.
        const d = distanceMetres({ lat: 48, lng: 2.35 }, { lat: 49, lng: 2.35 });
        expect(d).toBeGreaterThan(111000);
        expect(d).toBeLessThan(111400);
    });

    it("is symmetric", () => {
        const a = { lat: -21.11, lng: 55.53 };
        const b = { lat: -20.88, lng: 55.45 };
        expect(distanceMetres(a, b)).toBeCloseTo(distanceMetres(b, a), 6);
    });
});

describe("hasMovedEnough", () => {
    const here = { lat: 48.85, lng: 2.35 };

    // The first fix of a session must always go out: "not moving" is not the same fact as
    // "not there".
    it("always accepts the first fix", () => {
        expect(hasMovedEnough(null, here, 500)).toBe(true);
    });

    it("rejects a fix that has not moved far enough", () => {
        expect(hasMovedEnough(here, { lat: 48.850005, lng: 2.35 }, 50)).toBe(false);
    });

    it("accepts a fix beyond the threshold", () => {
        expect(hasMovedEnough(here, { lat: 48.86, lng: 2.35 }, 50)).toBe(true);
    });

    it("accepts everything when the threshold is zero or negative", () => {
        expect(hasMovedEnough(here, here, 0)).toBe(true);
        expect(hasMovedEnough(here, here, -1)).toBe(true);
    });
});
