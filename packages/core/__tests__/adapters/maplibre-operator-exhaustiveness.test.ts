/**
 * Exhaustiveness guard — every declared style operator must be translatable to MapLibre.
 *
 * ## The defect this exists to prevent, and why nothing else could
 *
 * Style conditions are evaluated on TWO paths: a JavaScript predicate table, which is the
 * single source of the operator vocabulary, and a MapLibre expression converter, which
 * re-enumerates that vocabulary in two `switch` statements. The converter returns `null` for
 * an operator it does not know, and the caller chains its two extractors with `??` — so an
 * unknown operator does not fail, it **degrades**. The same profile would then render one way
 * through the JS path and another through MapLibre, with nothing said.
 *
 * Measured when this guard was written: the converter handled 16 of 16 — no operator was
 * missing. **This is therefore not a repair, it is the thing that makes the current agreement
 * checkable.** A seventeenth operator added to the table would have made no test red.
 *
 * ## Why it drives the converter instead of reading its `case` labels
 *
 * Parsing `case "…"` would tie the guard to a spelling, not to a behaviour: a `case` that
 * falls through to a branch returning `null`, or an operator handled outside a `switch`, would
 * both be judged wrong. Calling the converter answers the only question that matters — does
 * this operator produce an expression?
 *
 * ⚠️ The sample values below are per-operator because some operators require a shape (a list, a
 * pair). They are values, never the LIST: the list is derived from the operator table, so a new
 * operator without a sample still gets tested — with a neutral value — instead of being
 * silently skipped. That asymmetry is deliberate: a guard whose corpus is hand-written stops
 * guarding the day someone forgets to extend it.
 */

import { describe, expect, it } from "vitest";

const { STYLE_OPERATORS } = await import("../../src/kernel/geojson/style-operators.ts");
const { conditionToExpression } =
    await import("../../src/adapters/maplibre/maplibre-style-converter.ts");

/** Value shapes a given operator needs; anything absent falls back to a scalar. */
const SAMPLE_VALUE: Record<string, unknown> = {
    in: ["a", "b"],
    notIn: ["a", "b"],
    between: [1, 10],
    contains: "ab",
    startsWith: "ab",
    endsWith: "ab",
};

describe("MapLibre converter — operator exhaustiveness", () => {
    it("declares at least the operators the guard was written against", () => {
        // Anti-vacuity: an emptied or renamed table would make every case below pass by
        // iterating over nothing. The guard refuses to conclude on a corpus it cannot see.
        expect(Object.keys(STYLE_OPERATORS).length).toBeGreaterThanOrEqual(16);
    });

    it.each(Object.keys(STYLE_OPERATORS))(
        "translates the %s operator to a MapLibre expression",
        (operator: string) => {
            const value = Object.hasOwn(SAMPLE_VALUE, operator) ? SAMPLE_VALUE[operator] : 1;
            const expr = conditionToExpression({ field: "properties.x", operator, value });
            expect(
                expr,
                `l'opérateur « ${operator} » est déclaré dans la table mais le convertisseur ` +
                    `MapLibre ne le traduit pas : il rendrait null, et l'appelant enchaîne ses ` +
                    `deux extracteurs par ?? — donc le style se dégraderait EN SILENCE, et le ` +
                    `même profil rendrait deux résultats différents selon le chemin emprunté.`
            ).not.toBeNull();
            expect(Array.isArray(expr)).toBe(true);
        }
    );
});
