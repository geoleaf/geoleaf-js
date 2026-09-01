#!/usr/bin/env node
"use strict";
/**
 * verify-ci-parity.cjs — every `ci.yml` gate is run by `ci:local`, or exempted with
 * its reason AND its witness.
 *
 * ## The blind spot this gate closes
 *
 * `ci-local.cjs` declares holding `ci:local ⊇ ci.yml`. That property was verified on
 * ONE axis (the unit-test perimeter, through `lib/test-scope.cjs`) and conventioned
 * on the other: the gate list rested on a comment line "Keep this list in sync with
 * .github/workflows/ci.yml". A manual gesture where the file announced a guarantee —
 * and the push protocol makes that local green the ONLY criterion before spending
 * GitHub Actions quota, which is scarce.
 *
 * ## What it checks, and in THIS order
 *
 *   PARITY-01  witness floors — below the floor, REFUSES TO CONCLUDE
 *   PARITY-07  parser / raw-count agreement — is the read perimeter really the file?
 *   PARITY-02  `npm run` defined nowhere — a broken ci.yml, not a parity defect
 *   PARITY-04  dead key in a table — a dispensation that dispenses nothing anymore
 *   PARITY-05  failing exemption witness — the dispensation's cause fell
 *   PARITY-06  unlisted external action — an action is no automatic exemption
 *   PARITY-08  gate slipped under `--e2e` without being declared
 *   PARITY-09  unregistered step `env:`
 *   PARITY-03  uncovered, unexplained leaf — this category must stay EMPTY
 *
 * ⚠️ The order is not cosmetic. On a collapsed corpus, "0 uncovered leaves" is true
 * BY ACCIDENT. The first two codes therefore suspend the classification report
 * instead of printing it: a reassuring tally on a corpus one has not read is worse
 * than no tally at all. Same arbitration as `verify-ci-scripts-tracked.cjs`.
 *
 * ## Seeing it red
 *
 * The `GEOLEAF_CI_WORKFLOW_DIR` hook exists for that, and nothing else: without it,
 * the only way to prove this gate would be to modify the real `ci.yml` — so it would
 * be done once, at landing, and never again. Three mutations, one per failure mode:
 *
 *   # the property
 *   mkdir -p /tmp/wf && cp .github/workflows/ci.yml /tmp/wf/
 *   printf '\n            - name: Sonde\n              run: node scripts/count-any.cjs\n' >> /tmp/wf/ci.yml
 *   GEOLEAF_CI_WORKFLOW_DIR=/tmp/wf node scripts/verify-ci-parity.cjs   # → PARITY-03
 *
 *   # the rot
 *   grep -v 'run: npm ci' .github/workflows/ci.yml > /tmp/wf/ci.yml
 *   GEOLEAF_CI_WORKFLOW_DIR=/tmp/wf node scripts/verify-ci-parity.cjs   # → PARITY-04
 *
 *   # blindness — keep the header, `jobs:` and THREE steps: a well-formed workflow
 *   # whose tallies fall under the floors. ⚠️ The recipe said `head -40` until
 *   # 2026-08-09; the header grew, `jobs:` moved to line 43, and the cut rendered
 *   # "unreadable corpus" — ANOTHER code. A hard-coded line rank in a recipe rots
 *   # without warning, and `probe-gate-visibility.cjs` now derives its own from the
 *   # file.
 *   awk '{print} /^ *steps:/{n=1} n && /^ +- /{c++} c>3{exit}' .github/workflows/ci.yml > /tmp/wf/ci.yml
 *   GEOLEAF_CI_WORKFLOW_DIR=/tmp/wf node scripts/verify-ci-parity.cjs   # → PARITY-01
 *
 * All three are frozen as `assertThat` in `probe-gate-visibility.cjs`, hence
 * replayed at every `ci:local`: a guard that can no longer be seen red has ceased to
 * be one.
 *
 * Usage: node scripts/verify-ci-parity.cjs [--verbose]
 * Exit: 0 if everything is classified and all witnesses hold, 1 otherwise.
 */

const parity = require("./lib/ci-parity.cjs");

const C = {
    r: "\x1b[31m",
    g: "\x1b[32m",
    y: "\x1b[33m",
    c: "\x1b[36m",
    d: "\x1b[2m",
    b: "\x1b[1m",
    x: "\x1b[0m",
};

/** Codes that invalidate the classification: reported ALONE, no reassuring tally. */
const BLINDING = new Set(["PARITY-01", "PARITY-07"]);

function main() {
    const verbose = process.argv.includes("--verbose");
    console.log(`${C.b}── CI-PARITY ──${C.x}`);

    let result;
    try {
        result = parity.classify();
    } catch (err) {
        // An unreadable corpus is not "0 problems": it is the absence of measurement.
        console.log(`\n${C.r}✗ CI-PARITY — corpus illisible, REFUSE DE CONCLURE${C.x}`);
        console.log(`  ${err.message}`);
        process.exit(1);
    }

    const { corpus, entries, problems, notes = [], actions } = result;
    const count = (cat) => entries.filter((e) => e.category === cat).length;

    console.log(
        `  ${corpus.workflows} workflow(s), ${corpus.jobs} job(s), ${corpus.steps} étapes ` +
            `(${corpus.runKeys} run: / ${corpus.usesKeys} uses:), ${corpus.ciLeaves} feuilles CI`
    );
    // ⚠️ A workflow TAKEN OUT of the comparison must be seen. Without this line,
    // "2 workflow(s)" above suggests both are compared, and a wrong
    // delivery classification — this partition's only silent error — would go
    // unnoticed.
    if (corpus.deliveryWorkflows?.length) {
        console.log(
            `  ${C.d}hors comparaison (livraison, déclenchés sur tag) : ` +
                `${corpus.deliveryWorkflows.join(", ")} — la propriété « ci:local ⊇ CI » ` +
                `vaut pour ce qui vérifie, pas pour ce qui livre${C.x}`
        );
    }
    console.log(
        `  accord parseur/grep : ${corpus.runKeys}/${corpus.rawRunKeys} run:, ` +
            `${corpus.usesKeys}/${corpus.rawUsesKeys} uses:  ` +
            (corpus.runKeys === corpus.rawRunKeys && corpus.usesKeys === corpus.rawUsesKeys
                ? `${C.g}✓${C.x}`
                : `${C.r}✗${C.x}`)
    );

    const blinding = problems.filter((p) => BLINDING.has(p.code));
    if (blinding.length === 0) {
        console.log(
            `  ${count("COVERED")} couvertes · ${count("E2E")} sous --e2e · ${actions.length} actions · ` +
                `${count("EXEMPT")} exemptées · ${count("ORPHAN")} NON EXPLIQUÉE(S)`
        );
    } else {
        console.log(`  ${C.y}classement suspendu — le corpus lu n'est pas fiable${C.x}`);
    }

    if (verbose) {
        console.log(`\n${C.d}── Actions externes ──${C.x}`);
        for (const a of actions) {
            const tag = a.gateReelle ? `${C.y}gate RÉELLE${C.x}` : `${C.d}inerte${C.x}`;
            console.log(
                `  ${a.ref.padEnd(28)} ${a.sha.slice(0, 12).padEnd(13)} ${tag}  ${C.d}${a.step}${C.x}`
            );
        }
        console.log(`\n${C.d}── Exemptions ──${C.x}`);
        for (const e of entries.filter((x) => x.category === "EXEMPT")) {
            const tag = e.alive ? `${C.g}témoin OK${C.x}` : `${C.r}témoin KO${C.x}`;
            console.log(`  ${tag}  ${C.d}[${e.classe}]${C.x} ${e.leaf}`);
        }
    }

    // ── PARITY-13 — NOTED, never blocking ──────────────────────────────────────
    //
    // 🛑 WHY A NOTE AND NOT A RED, and it is a measured choice. The reverse direction
    // (`ci:local ⊄ ci.yml`) had never been instrumented: nothing said a gate added
    // locally stayed absent remotely. It is now — but making it BLOCKING would
    // redden on 13 leaves the day it lands, hence permanently, hence it would be
    // disarmed the same day. Same reason as CC-10 on the downstream manifest's
    // fingerprint.
    //
    // ⚠️ AND IT OVER-SIGNALS, DELIBERATELY NOT FIXED HERE. It compares COMMAND
    // LEAVES, not coverages: `ci.yml` runs `npx vitest run` where `ci:local` goes
    // through `scripts/run-tests.cjs` — same verification, two invocations. A note
    // that over-signals stays readable; a red that over-signals gets bypassed.
    // Triaging the 13, and the decision to port the real absences into `ci.yml`, are
    // a DECISION with CI cost — recorded, not taken here.
    if (notes.length) {
        console.log(
            `\n${C.y}ℹ CI-PARITY — ${notes.length} feuille(s) locale(s) sans équivalent distant ` +
                `(PARITY-13, non bloquant)${C.x}`
        );
        for (const n of notes) console.log(`  ${C.d}· ${n.message}${C.x}`);
        console.log(
            `  ${C.d}Compare des COMMANDES, pas des couvertures — une même vérification lancée\n` +
                `  autrement des deux côtés apparaît ici. Deux réponses possibles : la porter\n` +
                `  dans \`ci.yml\`, ou la déclarer dans \`LOCAL_ONLY\` / \`COVERED_REMOTELY\`\n` +
                `  (\`lib/ci-parity.cjs\`, avec son motif et son témoin). Une note qui reste est\n` +
                `  une décision de coût — son motif s'écrit à côté des tables.${C.x}`
        );
    }

    // Problem report — the blinding codes first, alone if there are any.
    const shown = blinding.length ? blinding : problems;
    if (shown.length === 0) {
        console.log(
            `\n${C.g}✓ CI-PARITY — toute gate de ci.yml est lancée ou exemptée avec son témoin.${C.x}`
        );
        process.exit(0);
    }

    console.log(`\n${C.r}✗ CI-PARITY — ${shown.length} problème(s)${C.x}\n`);
    for (const p of shown) console.log(`  • ${C.b}${p.code}${C.x}  ${p.message}\n`);
    if (blinding.length) {
        console.log(
            `  ${C.d}Les autres contrôles ne sont pas rapportés : ils porteraient sur un corpus\n` +
                `  dont on vient d'établir qu'il n'est pas celui qu'on croit lire.${C.x}`
        );
    }
    process.exit(1);
}

if (require.main === module) {
    main();
}
