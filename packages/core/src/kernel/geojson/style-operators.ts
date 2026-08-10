/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Comparison operators available to conditional style rules (`styleRules[].when.operator`).
 *
 * **Single declaration** (S5 backlog B.2). This table used to exist twice — once as
 * `GeoJSONShared.STYLE_OPERATORS` (shared.ts) and once as a module-local
 * `DEFAULT_STYLE_OPERATORS` in style-resolver.ts, described there as a "fallback when
 * GeoJSONShared is not yet loaded". The two were byte-for-byte equivalent across all 16
 * operators, and the duplication was a real hazard: adding an operator to one silently
 * gave different behaviour depending on which one a call site resolved.
 *
 * The fallback itself is kept — `style-resolver.ts` still reads
 * `GeoJSONShared?.STYLE_OPERATORS ?? STYLE_OPERATORS` — but both branches now point at
 * THIS object. The optional chain guards against a test that mocks `GeoJSONShared` with a
 * partial object, not against a load-order problem (style-resolver.ts imports shared.ts
 * statically, so it is always evaluated first).
 *
 * This module deliberately imports nothing: it is depended on by both sides, so any import
 * here could reintroduce a cycle.
 */
export const STYLE_OPERATORS: Record<string, (a: unknown, b: unknown) => boolean> = {
    ">": (a, b) => Number(a) > Number(b),
    ">=": (a, b) => Number(a) >= Number(b),
    "<": (a, b) => Number(a) < Number(b),
    "<=": (a, b) => Number(a) <= Number(b),
    "==": (a, b) => a == b,
    "===": (a, b) => a === b,
    eq: (a, b) => a == b,
    "!=": (a, b) => a != b,
    "!==": (a, b) => a !== b,
    neq: (a, b) => a != b,
    contains: (a, b) => String(a).toLowerCase().includes(String(b).toLowerCase()),
    startsWith: (a, b) => String(a).toLowerCase().startsWith(String(b).toLowerCase()),
    endsWith: (a, b) => String(a).toLowerCase().endsWith(String(b).toLowerCase()),
    in: (a, b) => Array.isArray(b) && b.includes(a),
    notIn: (a, b) => Array.isArray(b) && !b.includes(a),
    between: (a, b) => {
        if (!Array.isArray(b) || b.length !== 2) return false;
        const num = Number(a);
        return num >= Number(b[0]) && num <= Number(b[1]);
    },
};
