/*!
 * @geoleaf-plugins/print — scale denominator formatting
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Groups a scale denominator with a plain ASCII space every three digits.
 *
 * ## Why not `toLocaleString()`
 *
 * This is the SETTLED CHOICE of CAPACITÉS B.26, applied here to the two print sites that
 * the arbitration explicitly left out of its scope. Two reasons, in order:
 *
 *  1. The space is the ISO 31-0 / SI thousands separator, unambiguous everywhere. Four of
 *     the six supported languages (`de`, `es`, `it`, `pt`) group with `"."`, and
 *     `1:250.000` reads as a DECIMAL when the number is a scale denominator. Localising
 *     would trade a neutral separator for an ambiguous one — on this field, a regression.
 *  2. The printed sheet must match the on-screen scale control, which formats exactly this
 *     way (`capabilities/scale/scale-control.ts:_formatNumber`). A printed plan whose
 *     cartouche disagrees with the map it was captured from is worse than either style.
 *
 * ⚠️ The previous code called `toLocaleString("fr-FR")`, which is NOT equivalent: ICU emits
 * U+202F (narrow no-break space) for `fr`, so the print output and the scale control
 * already differed by an invisible character — and a German user got French grouping.
 *
 * ⚠️ SETTLED CHOICE, do not "fix" it into `toLocaleString()`. A DATA cell is the opposite
 * call (see `plugin-table/table-renderer-utils.ts`, which localises on purpose).
 *
 * Deliberate re-implementation, not an import: `verify-plugin-core-boundary.cjs` forbids a
 * plugin from importing core sources (INV-NS). Pinned on both sides by tests.
 */

export function formatScaleDenominator(num: number): string {
    const digits = Math.round(num).toString();
    let out = "";
    for (let i = 0; i < digits.length; i++) {
        // Insert before every digit whose distance to the end is a non-zero multiple of
        // 3 — i.e. at each group boundary, never in leading position.
        const fromEnd = digits.length - i;
        if (i > 0 && fromEnd % 3 === 0) out += " ";
        out += digits[i];
    }
    return out;
}
