/**
 * @geoleaf-plugins/routing — encoded-polyline codec
 *
 * The precision is the whole subject. Everything else in this file is there to make the
 * precision assertions credible.
 */
import { describe, it, expect } from "vitest";
import { decodePolyline, encodePolyline, reencodePolyline } from "../polyline.js";

/** A short line near Saint-Denis, Réunion — chosen far from the equator on purpose. */
const LINE: [number, number][] = [
    [55.4504, -20.8823],
    [55.4512, -20.8809],
    [55.4488, -20.8785],
];

describe("round trip", () => {
    it("returns the input at precision 5, within its own resolution", () => {
        const back = decodePolyline(encodePolyline(LINE, 5), 5);
        expect(back).toHaveLength(LINE.length);
        back.forEach(([lon, lat], i) => {
            expect(Math.abs(lon - LINE[i][0])).toBeLessThan(1e-5);
            expect(Math.abs(lat - LINE[i][1])).toBeLessThan(1e-5);
        });
    });

    it("returns the input at precision 6, within its own resolution", () => {
        const back = decodePolyline(encodePolyline(LINE, 6), 6);
        back.forEach(([lon, lat], i) => {
            expect(Math.abs(lon - LINE[i][0])).toBeLessThan(1e-6);
            expect(Math.abs(lat - LINE[i][1])).toBeLessThan(1e-6);
        });
    });
});

describe("the precision trap", () => {
    it("decoding a 1e6 polyline at 1e5 yields an IMPOSSIBLE latitude", () => {
        // 🛑 This is the defect the model exists to prevent, written as an assertion so that
        // anyone tempted to give `decodePolyline` a default precision sees the cost. −208 is
        // not a wrong place: no latitude exists beyond ±90.
        const wrong = decodePolyline(encodePolyline(LINE, 6), 5);
        expect(Math.abs(wrong[0][1])).toBeGreaterThan(90);
    });

    it("decoding a 1e5 polyline at 1e6 lands off the coast of Africa", () => {
        // The mirror error is quieter and therefore worse: the coordinates stay VALID, they are
        // simply somewhere else — here, a tenth of the way back towards [0, 0]. Nothing throws.
        const wrong = decodePolyline(encodePolyline(LINE, 5), 6);
        expect(Math.abs(wrong[0][1])).toBeLessThan(90);
        expect(Math.abs(wrong[0][1] - LINE[0][1])).toBeGreaterThan(10);
    });
});

describe("reencodePolyline", () => {
    it("is a no-op when the two precisions are equal", () => {
        const encoded = encodePolyline(LINE, 5);
        expect(reencodePolyline(encoded, 5, 5)).toBe(encoded);
    });

    it("converts 6 to 5 and lands back on the same place", () => {
        const at5 = reencodePolyline(encodePolyline(LINE, 6), 6, 5);
        const back = decodePolyline(at5, 5);
        back.forEach(([lon, lat], i) => {
            // ~1.1 m at this latitude — the documented, accepted loss of going down to 1e5, and
            // far below the accuracy of any fix this data is compared against.
            expect(Math.abs(lon - LINE[i][0])).toBeLessThan(1e-5);
            expect(Math.abs(lat - LINE[i][1])).toBeLessThan(1e-5);
        });
    });
});

describe("edges", () => {
    it("decodes an empty string to an empty list", () => {
        expect(decodePolyline("", 5)).toEqual([]);
    });

    it("encodes an empty list to an empty string", () => {
        expect(encodePolyline([], 5)).toBe("");
    });

    it("handles a southern, eastern point — the sign combination Réunion actually uses", () => {
        // Signs are where variable-length integer encodings go wrong, and the fixture corpus
        // sits at negative latitude AND positive longitude. A codec tested only near [0, 0] or
        // in the northern hemisphere passes while being wrong here.
        const one: [number, number][] = [[55.4504, -20.8823]];
        const [[lon, lat]] = decodePolyline(encodePolyline(one, 6), 6);
        expect(lon).toBeCloseTo(55.4504, 5);
        expect(lat).toBeCloseTo(-20.8823, 5);
    });
});
