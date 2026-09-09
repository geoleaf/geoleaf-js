#!/usr/bin/env node
"use strict";
/**
 * E2E-ROUTE-GLOB — a route glob anchored on a filename STOPS BITING the day the URL
 * gains a query string, and it stops in SILENCE.
 *
 * ## The class this gate closes
 *
 * Playwright compiles a string glob into an ANCHORED regexp — it appends `$`
 * (`playwright-core`, `globToRegexPattern`). So:
 *
 *     page.route("**\/tourism/profile-bundle.json", handler)
 *     → /^(.*\/)tourism\/profile-bundle\.json$/
 *
 * matches `.../profile-bundle.json` and NOT `.../profile-bundle.json?t=a1b2c3d`.
 * The handler is then never invoked. Nothing throws, nothing warns: the real
 * resource is served, and the test goes on measuring something else.
 *
 * ⚠️ THIS IS NOT THEORETICAL, AND THE SYMPTOM DOES NOT NAME ITS CAUSE. Measured on
 * the public repo's nightly cron, runs 34202626883 and 34327527370:
 * `e2e/08-realtime.spec.js` asserted `getStatus().source === "sse"` and received
 * `"polling"` — three attempts, three times. `"polling"` is the profile's OWN value:
 * the SSE block the test believed it had injected had never reached the bundle,
 * because `profile-loader.ts` had started requesting `profile-bundle.json?t=<print>`
 * the day before (2026-09-07). The spec was green on the 07/09 cron and red on every
 * one after. Reading the failure requires walking from a realtime plugin to a cache
 * token in the kernel — three files and a commit message away from the assertion.
 *
 * ## Why the rule hinges on the trailing wildcard, and not on an allowlist
 *
 * A glob ending in `*` or `**` absorbs whatever follows, query string included. A
 * glob ending on a file EXTENSION is anchored on the byte after it. The rule is
 * therefore about the glob's SHAPE, not about which file it names: it needs no list
 * of "files that may carry a token", a list that would be wrong the day a new one
 * does.
 *
 * ⚠️ The repo already knew, ON ONE SITE. `e2e/32-routing-plugin.spec.js` writes
 * `"**\/geoleaf-routing.plugin.js*"` — trailing star, deliberate. Two other specs
 * route the bundle as `"**\/profiles/tourism/profile-bundle.json**"`. The lesson had
 * been learned three times and never generalised: that is exactly what a gate
 * prevents and what a comment cannot.
 *
 * ## What a function predicate does, and why it is not flagged
 *
 * `page.route((u) => u.href.includes("/profiles/tourism/profile-bundle.json"), …)`
 * is immune by construction — `routeGtfsFixture` in that very same spec uses it,
 * which is why ITS tests kept passing while the one below it fell. This gate reads
 * the first argument and only judges STRING LITERALS; a predicate is not its
 * business.
 *
 * ## Seeing it red
 *
 *     printf '\nawait page.route("**\/some-fixture.json", (r) => r.abort());\n' >> e2e/07-boot-sequence.spec.js
 *     node scripts/check-e2e-route-glob.cjs   # → E2E-ROUTE-GLOB, exit 1
 *
 * Usage : node scripts/check-e2e-route-glob.cjs
 * Exit : 0 if every literal glob absorbs a query string, 1 otherwise.
 */

const fs = require("node:fs");
const path = require("node:path");
const { callArgs } = require("./lib/js-call-args.cjs");

const ROOT = path.resolve(__dirname, "..");
const DIRS = ["e2e", "e2e/helpers"];

/**
 * ⚠️ Witness floor, on the same pattern as E2E-WAIT-SIG. A gate finding NO literal
 * glob to inspect would come out green having read nothing — the failure mode this
 * repo hunts everywhere. Deliberately below the day's measurement (14 literals on
 * 2026-09-09): it detects a corpus collapse, not a unit.
 */
const MIN_LITERALS = 8;

/**
 * A glob is anchored when it ends on a file extension: `.` then 1 to 6 alphanumerics,
 * and nothing after. `*`, `**` and `?` at the end all absorb what follows.
 */
const ANCHORED_ON_FILE = /\.[A-Za-z0-9]{1,6}$/;

const C = { r: "\x1b[31m", g: "\x1b[32m", d: "\x1b[2m", b: "\x1b[1m", x: "\x1b[0m" };

/** Reads the leading string literal of an argument, or `null` when it is not one. */
function literalOf(arg) {
    const m = arg.match(/^\s*(["'])((?:\\.|(?!\1)[^\\])*)\1\s*$/);
    return m ? m[2] : null;
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
    let literals = 0;
    const trapped = [];
    for (const rel of files) {
        const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
        let i = -1;
        while ((i = src.indexOf(".route(", i + 1)) !== -1) {
            calls++;
            const args = callArgs(src, i + ".route".length);
            if (!args.length) continue;
            const glob = literalOf(args[0]);
            if (glob === null) continue; // function predicate or regexp — immune
            literals++;
            if (ANCHORED_ON_FILE.test(glob)) {
                trapped.push({ rel, line: src.slice(0, i).split("\n").length, glob });
            }
        }
    }

    console.log(`${C.b}── E2E-ROUTE-GLOB ──${C.x}`);
    console.log(
        `  ${files.length} fichier(s), ${calls} appel(s) à .route() dont ${literals} glob(s) littéral(aux)`
    );

    if (literals < MIN_LITERALS) {
        console.log(
            `\n${C.r}✗ E2E-ROUTE-GLOB — témoin en échec : ${literals} glob(s) littéral(aux) (plancher ${MIN_LITERALS}).${C.x}`
        );
        console.log(
            `  ${C.d}REFUSE DE CONCLURE. Un « 0 glob ancré » sur un corpus effondré serait vrai\n` +
                `  et vide de sens — le périmètre a dû changer, pas le code.${C.x}`
        );
        process.exit(1);
    }

    if (!trapped.length) {
        console.log(`\n${C.g}✓ E2E-ROUTE-GLOB — aucun glob ancré sur un nom de fichier.${C.x}`);
        process.exit(0);
    }

    console.log(
        `\n${C.r}✗ E2E-ROUTE-GLOB — ${trapped.length} glob(s) qu'une query string ferait taire${C.x}\n`
    );
    for (const t of trapped) {
        console.log(`  • ${t.rel}:${t.line} — "${t.glob}"`);
    }
    console.log(
        `\n  ${C.d}Playwright ancre un glob de chaîne : il lui ajoute « $ ». Le jour où l'URL\n` +
            `  gagne « ?t=… », l'interception cesse de mordre — SANS erreur ni avertissement,\n` +
            `  et le test continue en mesurant autre chose.\n` +
            `  Correctif : suffixer « * », ou passer au prédicat « (u) => u.href.includes(…) ».${C.x}`
    );
    process.exit(1);
}

if (require.main === module) {
    main();
}
