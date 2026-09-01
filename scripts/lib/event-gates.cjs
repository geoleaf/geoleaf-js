/*!
 * GeoLeaf — gate tooling
 * © 2026 Mattieu Pottier · MIT
 */

/**
 * @file event-gates.cjs
 * @description EM-03 — collects event literals that carry a domain WITHOUT the `geoleaf:`
 * prefix.
 *
 * ## 🛑 THE BLINDNESS THIS FILE CLOSES
 *
 * `EVENT_LITERAL_RE` (`lib/event-names.cjs`) is anchored on `^geoleaf:`. EM-01 can therefore
 * neither claim nor count an event that lacks the prefix: such a name appears in **no**
 * measurement — not as debt, not as a gap, not as an exemption. This is not a baseline
 * lacuna, it is a blind spot of the perimeter.
 *
 * 📌 And the fact that EM-01 claims these names **the instant they enter the domain**
 * PROVES the blindness rather than refuting it: the gate only sees what has already agreed
 * to be seen.
 *
 * ## WHY THE RULE HINGES ON THE COLON, AND NOT ON AN ALLOWLIST
 *
 * A gate cannot demand "no literal outside the prefix": the 2026-08-16 sweep found **22**,
 * of which **19 are perfectly legitimate FOREIGN events** — DOM natives (`click`,
 * `DOMContentLoaded`, `toggle`), Service Worker lifecycle (`install`, `activate`, `fetch`),
 * MapLibre (`moveend`, `zoomend`, `idle`, `styledata`, `style.load`), Terra Draw (`finish`,
 * `deselect`). Forbidding them would make no sense; allowlisting them would have created a
 * list that grows at every `addEventListener("click")` — a list nobody re-reads.
 *
 * ✅ **The measurement yielded a separator that asks for zero upkeep: NONE of the 19
 * foreigners contains a `:`, and ALL THREE domain names carried one.** A native event is
 * never namespaced; a domain event is, by convention. The rule is therefore:
 *
 *   > An event literal containing a `:` MUST start with `geoleaf:`.
 *
 * It makes the class **structurally impossible** instead of cataloguing it — which is what
 * the requirement explicitly asked for: "make an event outside the naming domain
 * impossible, rather than renaming the next one".
 *
 * ## ⚠️ WHAT THIS GATE DOES NOT SEE, WRITTEN RATHER THAN SILENT — the perimeter is part of
 * the verdict
 *
 * It inspects **call sites**, where EM-01 sweeps bare literals. That is necessary here — a
 * sweep of every string in the repo would flag every string containing a `:` —, but it
 * costs two blind spots, both real in this repo:
 *
 *   1. **A name composed at runtime** (`"geoleaf:" + kind`) is not a literal. That is
 *      exactly what `fireEvent` did before its removal; nothing guarantees the pattern
 *      will not return.
 *   2. **A local helper whose name is not in `EVENT_GATES`.** Four modules emit through a
 *      helper that takes the name as a parameter (the header of
 *      `check-event-map-coverage.cjs` enumerates them). The known ones are listed below; a
 *      fifth, written tomorrow under another name, would pass.
 *
 * The remedy is not an allowlist but the anti-empty-gate assertion: if the sweep stops
 * finding a single call site, the gate **refuses to conclude** instead of going green.
 */
"use strict";

const fs = require("node:fs");
const ts = require("typescript");

/**
 * The emit and subscribe gates actually used in this repo.
 *
 * ⚠️ The last five are **local helpers** that take the name as a parameter. Without them,
 * everything going through a helper would be invisible — and that is the majority pattern
 * of the `editor` and `websocket` plugins.
 */
const EVENT_GATES = new Set([
    "dispatchEvent",
    "dispatchGeoLeafEvent",
    "addEventListener",
    "removeEventListener",
    "fire",
    "on",
    "off",
    "once",
    // Local helpers that take the name as a parameter.
    "emit",
    "_emit",
    "_dispatch",
    "_dispatchCustomEvent",
    "_firePluginEvent",
]);

/** A "namespaced" event literal — the shape the rule governs. */
const NAMESPACED_RE = /:/;

/** The domain — the only one allowed for a namespaced event. */
const DOMAIN_PREFIX = "geoleaf:";

/**
 * NAMED escape hatch, empty on purpose.
 *
 * 🛑 It exists so that a legitimate case — a third-party library namespacing its events
 * with a `:` — has a place to be written down WITH ITS REASON, rather than getting the
 * rule disarmed. It is empty today because the measurement found no such case.
 *
 * ⚠️ Never put a GeoLeaf event here: the 2026-08-16 verdict is that no domain event lives
 * outside the prefix. Adding one of ours would reopen the rule under the guise of
 * exempting it.
 *
 * Shape: `"name:literal": "reason — who emits it, and why it cannot be prefixed"`.
 */
const FOREIGN_NAMESPACED = Object.freeze({});

/**
 * Collects call sites whose 1st argument is a namespaced event literal.
 *
 * @param {string[]} files - Corpus of shipped sources.
 * @returns {{violations: Array<{name: string, file: string, line: number, gate: string}>, callSites: number}}
 *   `callSites` is the non-emptiness measure: at zero, the instrument is broken, not the code.
 */
function collectNamespacedEventLiterals(files) {
    const violations = [];
    let callSites = 0;

    for (const file of files) {
        const text = fs.readFileSync(file, "utf8");
        const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

        const walk = (node) => {
            if (ts.isCallExpression(node)) {
                let fn = null;
                if (ts.isPropertyAccessExpression(node.expression)) fn = node.expression.name.text;
                else if (ts.isIdentifier(node.expression)) fn = node.expression.text;

                if (fn && EVENT_GATES.has(fn) && node.arguments.length > 0) {
                    const a0 = node.arguments[0];
                    // String literal only. A dynamic name is not the subject: the rule
                    // covers what is WRITTEN, and the blind spot is declared in the header.
                    if (ts.isStringLiteral(a0) || ts.isNoSubstitutionTemplateLiteral(a0)) {
                        callSites++;
                        const name = a0.text;
                        if (
                            NAMESPACED_RE.test(name) &&
                            !name.startsWith(DOMAIN_PREFIX) &&
                            !(name in FOREIGN_NAMESPACED)
                        ) {
                            const { line } = sf.getLineAndCharacterOfPosition(a0.getStart(sf));
                            violations.push({ name, file, line: line + 1, gate: fn });
                        }
                    }
                }
            }
            ts.forEachChild(node, walk);
        };
        walk(sf);
    }

    return { violations, callSites };
}

module.exports = {
    EVENT_GATES,
    DOMAIN_PREFIX,
    FOREIGN_NAMESPACED,
    collectNamespacedEventLiterals,
};
