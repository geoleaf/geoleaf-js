/**
 * Unit tests — capabilities/filter/units.ts
 *
 * The proximity radius crosses a km/metre boundary on seven call sites. These helpers
 * exist because the direction, left implicit as a bare `* 1000`, once got inverted
 * silently (KERNEL S11). The round-trip case below is the guard against that.
 */
import { describe, expect, it } from "vitest";

const { kmToMetres, metresToKm } = await import("../../../src/capabilities/filter/units.ts");

describe("filter/units — radius conversions", () => {
    it("converts kilometres to metres", () => {
        expect(kmToMetres(10)).toBe(10000);
        expect(kmToMetres(0.5)).toBe(500);
        expect(kmToMetres(0)).toBe(0);
    });

    it("converts metres to kilometres", () => {
        expect(metresToKm(10000)).toBe(10);
        expect(metresToKm(500)).toBe(0.5);
        expect(metresToKm(0)).toBe(0);
    });

    it("round-trips, so a serialize/deserialize cycle cannot drift the radius", () => {
        for (const km of [1, 7.5, 10, 42.25]) {
            expect(metresToKm(kmToMetres(km))).toBe(km);
        }
    });

    it("keeps the two directions distinct (an inverted call is not a no-op)", () => {
        // Guards the failure mode that motivated the module: swapping the two helpers
        // must change the result, never silently pass through.
        expect(kmToMetres(10)).not.toBe(metresToKm(10));
    });
});
