#!/usr/bin/env node
"use strict";
/**
 * E2E-WAIT-SIG — a `waitForFunction` whose timeout goes in 2nd position is IGNORED.
 *
 * ## The class this gate closes, and why it was worth 41 sites
 *
 * The Playwright signature is `waitForFunction(pageFunction, arg, options)`.
 * There is NO two-argument overload where the second would be the options —
 * verified in `node_modules/playwright-core/types/types.d.ts`. Writing:
 *
 *     await page.waitForFunction(() => window.__x === true, { timeout: 30000 });
 *
 * thus passes `{ timeout: 30000 }` as an ARGUMENT of the page function. The
 * requested timeout is silently lost, and the wait falls back on `actionTimeout`
 * (`playwright.config.js` — this gate READS the value and prints it, it does not
 * copy it: it was 10 s until 2026-08-01, then 30 s, and the figure had already
 * diverged in nine comments of the repo the day it moved).
 *
 * ⚠️ THIS IS NOT COSMETIC — measured on 2026-08-01 over the repo's 41 sites,
 * **when `actionTimeout` was still 10 s** (figures frozen at that date, do not
 * refresh):
 *
 *     28 sites declared 15, 20, 25 or 30 s  →  they received 10 s
 *      6 sites declared 5 or 8 s            →  they received 10 s
 *      5 sites declared exactly 10 s        →  no effect
 *
 * Twenty-eight waits truncated to a third of what their author asked, on a suite
 * whose CI takes 1 h where this machine takes 12 min. A direct cause of remote
 * reds, and it was invisible: the code reads fine.
 *
 * ⚠️ AND THE REPO KNEW THE TRAP. `e2e/20-geocoding.spec.js` has long carried the
 * comment explaining it. The lesson had been learned ON ONE SPEC and never
 * generalised — that is exactly what a gate prevents, and what a comment cannot.
 *
 * ⚠️ Corollary to know before "repairing" an isolated site: restoring the
 * signature RESTORES the declared budget. On a site declaring LESS than
 * `actionTimeout`, this SHORTENS the effective budget and makes failure more
 * frequent. Signature and budget get fixed together.
 *
 * ## Why argument splitting and not a regex
 *
 * My first measurement, by regex over the next 500 characters, counted **49**
 * trapped sites where there were **42**. Seven false positives on a class of
 * forty: the figure was unusable for deciding. This gate thus splits TOP-LEVEL
 * arguments following parentheses, braces and strings — a `{` in a string
 * literal or a nested brace does not fool it.
 *
 * ## Seeing it red
 *
 *     printf '\nawait page.waitForFunction(() => true, { timeout: 5000 });\n' >> e2e/07-boot-sequence.spec.js
 *     node scripts/check-e2e-wait-signature.cjs   # → E2E-WAIT-SIG, exit 1
 *
 * Usage : node scripts/check-e2e-wait-signature.cjs
 * Exit : 0 if no trapped site, 1 otherwise.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIRS = ["e2e", "e2e/helpers"];

/**
 * ⚠️ Witness floor. A gate finding NO `waitForFunction` to inspect would go green
 * having read nothing — the failure mode this repo hunts everywhere. Deliberately
 * below the day's measurement (83 calls): it detects a corpus collapse, not a
 * unit.
 */
const MIN_CALLS = 40;

const C = { r: "\x1b[31m", g: "\x1b[32m", d: "\x1b[2m", b: "\x1b[1m", x: "\x1b[0m" };

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

/**
 * Reads `actionTimeout` in `playwright.config.js` — the budget a trapped site falls back on.
 *
 * ⚠️ Read, never copied. On 2026-08-01 this value went from 10 s to 30 s and
 * **nine** comments of the repo still claimed "10 s" — in a repo whose rule is
 * that a figure a command prints is not copied into prose. `//` lines are removed
 * before reading: the neighbouring docblock cites both values in text.
 *
 * @returns {number|null} The budget in ms, or `null` if the config cannot be read.
 */
function readActionTimeout() {
    try {
        const src = fs
            .readFileSync(path.join(ROOT, "playwright.config.js"), "utf8")
            .replace(/^\s*\/\/.*$/gm, "");
        const m = src.match(/actionTimeout:\s*([0-9]+)(?:\s*\*\s*([0-9]+))?/);
        if (!m) return null;
        return Number(m[1]) * (m[2] ? Number(m[2]) : 1);
    } catch {
        return null;
    }
}

function main() {
    const files = [];
    for (const d of DIRS) {
        const abs = path.join(ROOT, d);
        if (!fs.existsSync(abs)) continue;
        for (const f of fs.readdirSync(abs)) {
            if (/\.(js|cjs|ts)$/.test(f)) files.push(path.join(d, f));
        }
    }

    let calls = 0;
    const trapped = [];
    for (const rel of files) {
        const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
        let i = -1;
        while ((i = src.indexOf("waitForFunction(", i + 1)) !== -1) {
            calls++;
            const args = callArgs(src, i + "waitForFunction".length);
            if (args.length === 2 && /^\s*\{[\s\S]*timeout\s*:/.test(args[1])) {
                const line = src.slice(0, i).split("\n").length;
                const declared = (args[1].match(/timeout\s*:\s*([0-9_]+)/) || [, "?"])[1];
                trapped.push({ rel, line, declared: declared.replace(/_/g, "") });
            }
        }
    }

    const actionTimeout = readActionTimeout();
    const budget = actionTimeout === null ? "illisible" : `${actionTimeout} ms`;

    console.log(`${C.b}── E2E-WAIT-SIG ──${C.x}`);
    console.log(`  ${files.length} fichier(s), ${calls} appel(s) à waitForFunction inspectés`);
    console.log(`  ${C.d}actionTimeout lu dans playwright.config.js : ${budget}${C.x}`);

    if (calls < MIN_CALLS) {
        console.log(
            `\n${C.r}✗ E2E-WAIT-SIG — témoin en échec : ${calls} appels (plancher ${MIN_CALLS}).${C.x}`
        );
        console.log(
            `  ${C.d}REFUSE DE CONCLURE. Un « 0 site piégé » sur un corpus effondré serait vrai\n` +
                `  et vide de sens — le périmètre a dû changer, pas le code.${C.x}`
        );
        process.exit(1);
    }

    if (!trapped.length) {
        console.log(`\n${C.g}✓ E2E-WAIT-SIG — aucun timeout perdu en 2ᵉ position.${C.x}`);
        process.exit(0);
    }

    console.log(
        `\n${C.r}✗ E2E-WAIT-SIG — ${trapped.length} site(s) dont le timeout est IGNORÉ${C.x}\n`
    );
    for (const t of trapped) {
        const sens =
            actionTimeout !== null && Number(t.declared) < actionTimeout
                ? ` ${C.r}(RACCOURCIRA de ${actionTimeout} à ${t.declared} ms une fois réparé)${C.x}`
                : "";
        console.log(`  • ${t.rel}:${t.line} — déclare ${t.declared} ms, reçoit ${budget}${sens}`);
    }
    console.log(
        `\n  ${C.d}La signature est \`waitForFunction(pageFunction, arg, options)\`. Passer\n` +
            `  \`{ timeout }\` en 2ᵉ position en fait un ARGUMENT de la fonction de page.\n` +
            `  Correctif : \`, null, { timeout }\`.\n` +
            `  ⚠️ Sur un site qui déclare MOINS que actionTimeout (${budget}), rétablir la\n` +
            `  signature RACCOURCIT son budget effectif — relever la valeur dans le même geste.${C.x}`
    );
    process.exit(1);
}

if (require.main === module) {
    main();
}
