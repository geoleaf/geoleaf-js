/*!
 * GeoLeaf — top-level argument splitting for a JS call site, shared between gates.
 * © 2026 Mattieu Pottier — MIT
 *
 * ## Why this module exists
 *
 * `check-e2e-wait-signature.cjs` carried this splitter alone. `check-e2e-route-glob.cjs`
 * now needs the same one: both gates read a call site's arguments in E2E sources without
 * a parser.
 *
 * **A second reader triggers the extraction**: that is this repo's rule, and it has a
 * measured rationale — `ts-decl-read.cjs` phrases it as *"two copies of a reader drift,
 * and the drift is invisible as long as both gates come out green"*. `event-names.cjs`,
 * `source-inventory.cjs` and `test-load-sites.cjs` were born of the same move.
 *
 * ⚠️ **Zero-behaviour refactor.** `callArgs` is transported byte-for-byte from
 * `check-e2e-wait-signature.cjs`, comments included. E2E-WAIT-SIG must stay green AND
 * return the same numbers — that is the move's success criterion, not a hope.
 *
 * ## Why splitting, and not a regex
 *
 * E2E-WAIT-SIG's own docstring holds the measurement: its first census, by regex over
 * the next 500 characters, counted **49** trapped sites where there were **42**. Seven
 * false positives on a class of forty — a figure unusable for deciding. Following
 * parentheses, braces and strings is what makes the count trustworthy: a `{` inside a
 * string literal, or a nested brace, does not fool it.
 */

"use strict";

/**
 * Splits a call's top-level arguments, following the delimiters.
 *
 * @param {string} src Full source.
 * @param {number} open Index of the opening parenthesis.
 * @returns {string[]} The arguments, as-is.
 */
function callArgs(src, open) {
    let depth = 0;
    let quote = null;
    let start = open + 1;
    const out = [];
    for (let i = open; i < src.length; i++) {
        const c = src[i];
        if (quote) {
            if (c === quote && src[i - 1] !== "\\") quote = null;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") {
            quote = c;
            continue;
        }
        if ("([{".includes(c)) depth++;
        else if (")]}".includes(c)) {
            depth--;
            if (depth === 0) {
                out.push(src.slice(start, i));
                return out;
            }
        } else if (c === "," && depth === 1) {
            out.push(src.slice(start, i));
            start = i + 1;
        }
    }
    return out;
}

module.exports = { callArgs };
