/**
 * Tests for scale-format.ts — the settled formatting of a scale denominator.
 *
 * Origin: CAPACITÉS B.26 arbitrated the separator for the on-screen scale control and
 * explicitly left the two print sites out of scope; they kept `toLocaleString("fr-FR")`
 * until the orphan sweep. These tests pin the choice so a later "i18n cleanup" cannot
 * silently undo it.
 */
import { describe, it, expect } from "vitest";
import { formatScaleDenominator } from "../scale-format.js";

describe("formatScaleDenominator", () => {
    it.each([
        [0, "0"],
        [999, "999"],
        [1000, "1 000"],
        [25000, "25 000"],
        [250000, "250 000"],
        [1234567, "1 234 567"],
    ])("groups %s as %s", (input, expected) => {
        expect(formatScaleDenominator(input)).toBe(expected);
    });

    it("uses a plain ASCII space, not the U+202F that ICU emits for `fr`", () => {
        const out = formatScaleDenominator(250000);
        // The defect this replaces: `toLocaleString("fr-FR")` returns "250 000" with a
        // NARROW NO-BREAK SPACE. It looks identical and is a different character, so the
        // printed sheet silently disagreed with the on-screen scale control.
        expect(out).toBe("250 000");
        expect(out).toContain(" ");
        expect(out).not.toContain(" ");
        expect(out).toBe((250000).toLocaleString("fr-FR").replace(/\u202F/g, " "));
    });

    it("never groups a locale that would read as a decimal", () => {
        // `de`/`es`/`it`/`pt` render 250000 as "250.000" — a decimal for a denominator.
        expect(formatScaleDenominator(250000)).not.toContain(".");
        expect(formatScaleDenominator(250000)).not.toContain(",");
    });

    it("rounds a fractional denominator rather than emitting decimals", () => {
        expect(formatScaleDenominator(25000.4)).toBe("25 000");
    });
});
