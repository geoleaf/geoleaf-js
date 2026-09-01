/*!
 * GeoLeaf — gate tooling
 * © 2026 Mattieu Pottier · MIT
 */

/**
 * @file md-fences.cjs
 * @description State tracking for Markdown code blocks, CommonMark-conformant.
 *
 * ## 🛑 WHAT THE BLIND TOGGLE GOT WRONG
 *
 * `check-dead-links.cjs` carried, **in two places**, the same line:
 *
 * ```js
 * if (/^```/.test(ln.trim())) { inCodeBlock = !inCodeBlock; continue; }
 * ```
 *
 * It toggles on **any** line starting with three backticks — hence also on a **nested**
 * fence. CommonMark says the opposite: a block opened by N backticks only closes on a
 * marker of **at least N** backticks, and **with no info string**. That is precisely what
 * allows a Markdown example inside a Markdown block.
 *
 * ## ⚠️ THE POOL IS ZERO TODAY, AND THAT IS THE MEASUREMENT'S RESULT
 *
 * 2026-08-16 sweep over the **133 files** of the gated corpus, old classification against
 * new: **0 files change, 0 lines change**. No document exercises the defect to date.
 *
 * 🛑 **And one hypothesis was refuted along the way, which is worth writing down.**
 * `packages/core/docs/CORE_EXTENSION_GUIDE.md` does open a **four**-backtick block
 * containing a three-backtick pair — the textbook case. Yet it bites neither before nor
 * after: the nested fences there are **prefixed with ` * `**, being inside a TSDoc
 * comment, so neither pattern sees them. **An example that looks like the defect is not an
 * instance of the defect**; only the full sweep says so.
 *
 * ✅ **The fix remains right, and its value is double**: the toggle was wrong against
 * CommonMark — so the first document to nest a fence would produce a wrong verdict with
 * nothing linking cause to effect — and the pattern was **duplicated**, so fixing one site
 * would have left the other. Proven on a synthetic case: an opening ```` block, containing
 * a ```js and its closing ```, then content. The old one classifies that content as PROSE,
 * the new one as CODE.
 *
 * ## ⚠️ WHAT THIS MODULE DOES NOT DO
 *
 * It does not build a Markdown parser. It knows neither four-space **indented** blocks nor
 * fences inside a `>` quote. The corpus carries no measured case of either — and saying so
 * here beats letting full conformance be assumed.
 */
"use strict";

/** Fence opening: marker (≥3 backticks OR ≥3 tildes) + free info string. */
const FENCE_RE = /^(`{3,}|~{3,})(.*)$/;

/**
 * Code-block state tracker, to create once per file.
 *
 * @example
 * const fences = createFenceTracker();
 * for (const line of lines) {
 *     if (fences.consume(line)) continue; // marker line
 *     if (fences.inCode) continue;        // block content
 *     // … here, we are in PROSE
 * }
 *
 * @returns {{ inCode: boolean, consume(line: string): boolean }}
 */
function createFenceTracker() {
    /** Marker that opened the current block — `null` outside a block. */
    let openMarker = null;

    return {
        get inCode() {
            return openMarker !== null;
        },

        /**
         * Processes a line. Returns `true` if it is a MARKER line (for the caller to
         * skip), `false` if it is an ordinary line — whose `inCode` must then be read to
         * know whether it is code or prose.
         *
         * @param {string} line
         * @returns {boolean}
         */
        consume(line) {
            const m = FENCE_RE.exec(line.trim());
            if (!m) return false;

            const [, marker, info] = m;

            if (openMarker === null) {
                // Opening. The info string belongs to the opening only.
                openMarker = marker;
                return true;
            }

            // 🛑 CONDITIONAL CLOSING — this is the entire fix.
            // Same character, length AT LEAST equal, and no info string.
            // A ``` met inside a block opened by ```` is not a closing: it is content,
            // and treating it as a closing inverts the classification of everything that
            // follows up to the next marker.
            const sameKind = marker[0] === openMarker[0];
            if (sameKind && marker.length >= openMarker.length && info.trim() === "") {
                openMarker = null;
            }
            return true;
        },
    };
}

module.exports = { createFenceTracker, FENCE_RE };
