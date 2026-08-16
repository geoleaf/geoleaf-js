#!/usr/bin/env node
"use strict";
/**
 * verify-ci-parity.cjs — toute gate de `ci.yml` est lancée par `ci:local`, ou exemptée avec
 * son motif ET son témoin.
 *
 * ## L'angle mort que cette gate ferme
 *
 * `ci-local.cjs` déclare tenir `ci:local ⊇ ci.yml`. Cette propriété était vérifiée sur UN
 * axe (le périmètre des tests unitaires, par `lib/test-scope.cjs`) et conventionnée sur
 * l'autre : la liste des gates reposait sur une ligne de commentaire « Keep this list in sync
 * with .github/workflows/ci.yml ». Un geste manuel là où le fichier annonçait une garantie —
 * et le protocole de push de CLAUDE.md fait de ce vert local le SEUL critère avant de dépenser
 * du quota GitHub Actions, qui est rare.
 *
 * ## Ce qu'elle contrôle, et dans CET ordre
 *
 *   PARITY-01  planchers témoins — sous le plancher, REFUSE DE CONCLURE
 *   PARITY-07  accord parseur / comptage brut — le périmètre lu est-il bien le fichier ?
 *   PARITY-02  `npm run` défini nulle part — ci.yml cassé, pas un défaut de parité
 *   PARITY-04  clé morte dans une table — une dispense qui ne dispense plus de rien
 *   PARITY-05  témoin d'exemption en échec — la cause de la dispense est tombée
 *   PARITY-06  action externe non listée — une action n'est pas une exemption automatique
 *   PARITY-08  gate glissée sous `--e2e` sans être déclarée
 *   PARITY-09  `env:` d'étape non recensé
 *   PARITY-03  feuille non couverte et non expliquée — cette catégorie doit rester VIDE
 *
 * ⚠️ L'ordre n'est pas cosmétique. Sur un corpus effondré, « 0 feuille non couverte » est vrai
 * PAR ACCIDENT. Les deux premiers codes suspendent donc le rapport de classement au lieu de
 * l'imprimer : un décompte rassurant sur un corpus qu'on n'a pas lu est pire que pas de
 * décompte du tout. Même arbitrage que `verify-ci-scripts-tracked.cjs`.
 *
 * ## La voir rougir
 *
 * Le crochet `GEOLEAF_CI_WORKFLOW_DIR` existe pour ça, et pour rien d'autre : sans lui, la
 * seule façon de prouver cette gate serait de modifier le vrai `ci.yml` — donc on ne le
 * ferait qu'une fois, à la pose, et jamais plus. Trois mutations, une par mode d'échec :
 *
 *   # la propriété
 *   mkdir -p /tmp/wf && cp .github/workflows/ci.yml /tmp/wf/
 *   printf '\n            - name: Sonde\n              run: node scripts/count-any.cjs\n' >> /tmp/wf/ci.yml
 *   GEOLEAF_CI_WORKFLOW_DIR=/tmp/wf node scripts/verify-ci-parity.cjs   # → PARITY-03
 *
 *   # le pourrissement
 *   grep -v 'run: npm ci' .github/workflows/ci.yml > /tmp/wf/ci.yml
 *   GEOLEAF_CI_WORKFLOW_DIR=/tmp/wf node scripts/verify-ci-parity.cjs   # → PARITY-04
 *
 *   # la cécité — garder l'en-tête, `jobs:` et TROIS étapes : un workflow bien formé dont les
 *   # décomptes passent sous les planchers. ⚠️ La recette a dit `head -40` jusqu'au
 *   # 09/08/2026 ; l'en-tête a grandi, `jobs:` est passé ligne 43, et la coupe rendait
 *   # « corpus illisible » — un AUTRE code. Un rang de ligne en dur dans une recette pourrit
 *   # sans prévenir, et `probe-gate-visibility.cjs` dérive désormais la sienne du fichier.
 *   awk '{print} /^ *steps:/{n=1} n && /^ +- /{c++} c>3{exit}' .github/workflows/ci.yml > /tmp/wf/ci.yml
 *   GEOLEAF_CI_WORKFLOW_DIR=/tmp/wf node scripts/verify-ci-parity.cjs   # → PARITY-01
 *
 * Les trois sont figées en `assertThat` dans `probe-gate-visibility.cjs`, donc rejouées à
 * chaque `ci:local` : une garde qu'on ne peut plus voir rougir a cessé d'en être une.
 *
 * Usage : node scripts/verify-ci-parity.cjs [--verbose]
 * Sortie : 0 si tout est classé et tous les témoins tiennent, 1 sinon.
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

/** Codes qui invalident le classement : on les rapporte SEULS, sans décompte rassurant. */
const BLINDING = new Set(["PARITY-01", "PARITY-07"]);

function main() {
    const verbose = process.argv.includes("--verbose");
    console.log(`${C.b}── CI-PARITY ──${C.x}`);

    let result;
    try {
        result = parity.classify();
    } catch (err) {
        // Un corpus illisible n'est pas « 0 problème » : c'est l'absence de mesure.
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
    // ⚠️ Un workflow SORTI de la comparaison doit se voir. Sans cette ligne, « 2 workflow(s) »
    // au-dessus laisse croire que les deux sont comparés, et un classement erroné en livraison
    // — la seule erreur silencieuse de ce découpage — passerait inaperçu.
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

    // ── PARITY-13 — NOTÉE, jamais bloquante (B-83) ────────────────────────────────────
    //
    // 🛑 POURQUOI UNE NOTE ET NON UN ROUGE, et c'est un choix mesuré. Le sens inverse
    // (`ci:local ⊄ ci.yml`) n'avait jamais été instrumenté : rien ne disait qu'une gate ajoutée
    // en local restait absente du distant. Il l'est maintenant — mais le rendre BLOQUANT
    // rougirait sur 13 feuilles dès sa pose, donc en permanence, donc il serait désarmé le
    // jour même. C'est la même raison que CC-10 sur l'empreinte du manifeste aval.
    //
    // ⚠️ ET ELLE SUR-SIGNALE, DÉLIBÉRÉMENT NON CORRIGÉ ICI. Elle compare des FEUILLES DE
    // COMMANDE, pas des couvertures : `ci.yml` lance `npx vitest run` là où `ci:local` passe par
    // `scripts/run-tests.cjs` — même vérification, deux invocations. Une note qui sur-signale
    // reste lisible ; un rouge qui sur-signale se contourne. Le tri des 13, et la décision de
    // porter les vraies absences dans `ci.yml`, sont une DÉCISION à coût de CI — versée au
    // registre, pas prise ici.
    if (notes.length) {
        console.log(
            `\n${C.y}ℹ CI-PARITY — ${notes.length} feuille(s) locale(s) sans équivalent distant ` +
                `(PARITY-13, non bloquant)${C.x}`
        );
        for (const n of notes) console.log(`  ${C.d}· ${n.message}${C.x}`);
        console.log(
            `  ${C.d}Compare des COMMANDES, pas des couvertures — une même vérification lancée\n` +
                `  autrement des deux côtés apparaît ici. Tri et arbitrage : registre.${C.x}`
        );
    }

    // Rapport des problèmes — les codes aveuglants d'abord, seuls s'il y en a.
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
