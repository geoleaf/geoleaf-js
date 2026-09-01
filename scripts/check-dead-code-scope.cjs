#!/usr/bin/env node
/**
 * check-dead-code-scope.cjs — DCS-01…04: the dead-code instruments' PERIMETER is
 * derived, non-empty, and it PRINTS.
 *
 * 🛑 **Why a gate for a perimeter, and not only for a verdict.** The repo carries
 * two dead-code instruments — `check-dead-code` (knip) and `check-orphan-exports` —
 * and **neither printed what it had scanned**. `✓ knip: no unused files` does not
 * say over how many packages; `✓ check-orphan-exports: aucun NOUVEL export
 * orphelin` does not say over how many files. A shrinking perimeter thus renders
 * **the same green** as an intact one.
 *
 * It is the named class: *"a hard-coded path does not break on a move, it silently
 * stops matching, and the affected gate goes green having scanned nothing"*. Here
 * both derivations are sound — both go through `lib/packages.cjs` — and this gate
 * exists so that stays verifiable rather than true by luck.
 *
 * ## The three named corpora, and why them
 *
 * The measurement showed the dead-code gates blind on three chains. The 2026-08-19
 * preflight named the cause, and it **is not the same** for the three:
 *
 * | Corpus                        | Covered by             | How                                        |
 * | ----------------------------- | ---------------------- | ------------------------------------------ |
 * | `plugins/editor/src`          | knip                   | workspace key **derived** from the registry |
 * | `capabilities/feature-info`   | check-orphan-exports   | under `CORE_SRC`                           |
 * | `kernel/ui`                   | check-orphan-exports   | under `CORE_SRC`                           |
 *
 * ⚠️ **Covered does not mean seen.** knip judges a FILE's reachability, never what
 * is dead **inside** a reachable file — and the measurement establishes that this
 * repo's dead code is precisely intra-file. This gate guards the perimeter; it does
 * not claim the perimeter suffices, and `DCS-04` prints that reservation at every
 * run rather than leaving it in a register nobody opens at the right time.
 *
 * Usage : `node scripts/check-dead-code-scope.cjs`
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const registry = require("./lib/packages.cjs");

const ROOT = path.resolve(__dirname, "..");
const C = { r: "\x1b[31m", g: "\x1b[32m", y: "\x1b[33m", d: "\x1b[2m", x: "\x1b[0m" };

/**
 * The three corpora, with the instrument covering each and the FLOOR under which we
 * refuse to conclude.
 *
 * The floors sit well below the day's reading (85 / 21 / 21): they catch "the
 * directory vanished or was emptied", not "it slimmed by three files".
 */
const CORPUS = [
    {
        chemin: "packages/plugins/editor/src",
        instrument: "knip",
        plancher: 30,
        comment: "clé d'espace de travail dérivée du registre",
    },
    {
        chemin: "packages/core/src/capabilities/feature-info",
        instrument: "check-orphan-exports",
        plancher: 8,
        comment: "sous CORE_SRC",
    },
    {
        chemin: "packages/core/src/kernel/ui",
        instrument: "check-orphan-exports",
        plancher: 8,
        comment: "sous CORE_SRC",
    },
];

/** Counts a directory's `.ts`, excluding declarations and tests. */
function countTs(dir) {
    let n = 0;
    const stack = [dir];
    while (stack.length > 0) {
        const d = stack.pop();
        if (!fs.existsSync(d)) return -1;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) {
                if (!["node_modules", "dist", "__tests__", "__mocks__"].includes(e.name))
                    stack.push(p);
            } else if (/\.ts$/.test(p) && !/\.d\.ts$/.test(p) && !/\.(test|spec)\.ts$/.test(p)) n++;
        }
    }
    return n;
}

const echecs = [];

// ─── DCS-03 — CORE_SRC's derivation is still the one we believe ───────────────
//
// Recounting here what `check-orphan-exports` computes would be a SECOND copy of
// the reader, and two copies drift. The derivation is therefore anchored to the
// script's text: if it stops going through the registry, this gate reddens instead
// of measuring something other than it.
const OE = path.join(ROOT, "scripts/check-orphan-exports.cjs");
const ANCRE_CORE_SRC = 'requireByDirName("core").absDir, "src"';
if (!fs.existsSync(OE)) {
    echecs.push(
        "[DCS-03] scripts/check-orphan-exports.cjs a disparu — le core n'a plus de filet d'exports."
    );
} else if (!fs.readFileSync(OE, "utf8").includes(ANCRE_CORE_SRC)) {
    echecs.push(
        `[DCS-03] check-orphan-exports ne dérive plus son CORE_SRC du registre (\`${ANCRE_CORE_SRC}\`).\n` +
            `      Le périmètre annoncé ci-dessous ne décrit alors plus ce que la gate scanne.`
    );
}

// ─── DCS-02 — does knip still see the biggest corpus's package? ───────────────
const editorPkg = registry.all().find((p) => p.name === "@geoleaf-plugins/editor");
if (!editorPkg) {
    echecs.push(
        "[DCS-02] `@geoleaf-plugins/editor` n'est pas dans le registre de paquets — ses clés knip\n" +
            "      étant DÉRIVÉES du registre, il sort du périmètre de knip sans qu'un mot soit dit.\n" +
            "      C'est les deux tiers du périmètre de cette ligne."
    );
}

// ─── DCS-01 — the corpora exist and are not empty ─────────────────────────────
const mesures = CORPUS.map((c) => ({ ...c, fichiers: countTs(path.join(ROOT, c.chemin)) }));
for (const m of mesures) {
    if (m.fichiers < 0) {
        echecs.push(
            `[DCS-01] ${m.chemin} n'existe plus — le périmètre a changé sans que rien ne le dise.`
        );
    } else if (m.fichiers < m.plancher) {
        echecs.push(
            `[DCS-01] ${m.chemin} : ${m.fichiers} fichier(s), plancher ${m.plancher}. ` +
                `Le corpus s'est effondré ; un vert de code mort ne voudrait plus rien dire dessus.`
        );
    }
}

// ─── DCS-04 — the perimeter PRINTS ───────────────────────────────────────────
console.log(`${C.d}── DEAD-CODE-SCOPE — ce que les instruments de code mort couvrent ──${C.x}`);
console.log(`  ${registry.all().length} paquet(s) au registre · clés knip dérivées de là`);
for (const m of mesures) {
    console.log(
        `  ${String(m.fichiers).padStart(3)} fichier(s) .ts  ${m.chemin.padEnd(46)} ` +
            `${C.d}← ${m.instrument} (${m.comment})${C.x}`
    );
}
console.log(
    `  ${C.y}⚠${C.x}  knip juge l'atteignabilité d'un FICHIER, jamais ce qui est mort à l'intérieur\n` +
        `     d'un fichier atteignable — et le mort de ce dépôt est intra-fichier. Couvert ≠ vu.`
);

if (echecs.length > 0) {
    console.error("");
    for (const e of echecs) console.error(`${C.r}✗${C.x} ${e}`);
    process.exit(1);
}
console.log(
    `${C.g}✓ DEAD-CODE-SCOPE${C.x} — les trois corpus sont couverts, et le périmètre est imprimé.`
);
