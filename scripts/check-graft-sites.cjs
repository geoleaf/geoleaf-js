#!/usr/bin/env node
/**
 * check-graft-sites.cjs — GRAFT-01…03: a SIDE-EFFECT module carries its mark, and
 * its anchoring still holds.
 *
 * 🛑 **The regression this gate would have prevented, and which happened.**
 * `kernel/themes/theme-applier/{deferred,ui-sync,visibility}.ts` — 812 lines —
 * graft 13 methods onto `ThemeApplierCore` at import, and `core.ts` calls them
 * **without defining them**. They only entered the graph through a global key
 * nobody read; removing it — rightly — took the patches out with it. **Three
 * instruments said "dead" in concert and all three were wrong**: a side-effect
 * module has no consumer, by definition. The test suite would have stayed GREEN
 * (everything touching themes mocks `ThemeApplierCore`); the only symptom was a
 * production `TypeError`, at the first theme change.
 *
 * The register entry concluded: *"No gate detects a side-effect module whose
 * anchoring disappears."* That sentence is what `GRAFT-03` removes.
 *
 * ## GRAFT-01 — the corpus is not empty, and the WITNESS is caught
 *
 * ⚠️ The witness is not decorative: the sorting instrument had to be fixed
 * **three times**, and versions ① and ② missed precisely the three
 * `theme-applier` files — the import there is **aliased**
 * (`ThemeApplierCore as _TA`) then **re-bound** with a **type annotation**.
 * Version ① rendered 90 sites and looked credible. **A plausible figure obtained
 * by a wrong instrument goes uncontested**: hence a known-answer witness,
 * guarded here.
 *
 * ## GRAFT-02 — each graft file carries the mark
 *
 * `@sideEffectGraft <anchor>` in its header. The mark is **declarative**: it
 * does not silence ESLint and does not claim to — the explicit anchoring
 * (`import "…";`) already suffices for it. What it brings is the distinction
 * nothing carried: "no importer" versus "imported FOR ITS EFFECT". It is what
 * the type witness's oracle expects.
 *
 * ## GRAFT-03 — the anchor still imports the file, as a BARE import
 *
 * A NAMED import does not count: it would keep the module through its exports,
 * yet these files have none that is consumed. Only `import "…";` says "I load
 * you for your effect".
 *
 * ## 🖐 What this gate does NOT say
 *
 * It does not judge whether the graft is **legitimate**. The register reserves
 * that question: for each family, is the graft an assumed module state, or a
 * side effect to convert? This gate makes the question posable and prevents the
 * regression; it does not settle.
 *
 * Usage : `node scripts/check-graft-sites.cjs`
 */

"use strict";

const lib = require("./lib/graft-sites.cjs");

const C = { r: "\x1b[31m", g: "\x1b[32m", d: "\x1b[2m", x: "\x1b[0m" };

/** Non-emptiness floor, well below the day's reading (920 sources). */
const PLANCHER_SOURCES = 500;

/**
 * Graft files exempt from the mark, with their motive.
 *
 * Empty at landing, and that is the right state: the survey's six files all
 * carry it. An exemption without a written motive is indistinguishable from an
 * oversight six months later.
 */
const EXEMPTES = new Map();

const echecs = [];
const r = lib.scan();

console.log(`${C.d}── GRAFT — modules d'effet de bord et leur ancrage ──${C.x}`);
console.log(
    `  ${r.fichiers} source(s) · ${r.sitesGreffe} site(s) de greffe sur ${r.greffes.length} fichier(s) · ` +
        `${r.sitesLocal} sur objet local (écartés) · ${r.sitesAutre} ni import ni local`
);

// ─── GRAFT-01 ─────────────────────────────────────────────────────────────────
if (r.fichiers < PLANCHER_SOURCES) {
    echecs.push(
        `[GRAFT-01] ${r.fichiers} sources scannées, plancher ${PLANCHER_SOURCES} — le corpus ne ` +
            `se dérive plus. Un instrument qui ne lit rien rend « aucune greffe » sur un dépôt malade.`
    );
}
const manquants = lib.TEMOIN.filter((t) => !r.greffes.some((g) => g.fichier === t));
if (manquants.length > 0) {
    echecs.push(
        `[GRAFT-01] le TÉMOIN n'est plus attrapé — ${manquants.join(", ")}.\n` +
            `      Ces fichiers aliasent leur import puis le re-lient avec une annotation de type ;\n` +
            `      c'est exactement ce que les versions ① et ② de l'instrument rataient, en rendant\n` +
            `      un chiffre crédible. Si ce témoin tombe, le relevé ci-dessus ne vaut rien.`
    );
}

// ─── GRAFT-02 & GRAFT-03 ──────────────────────────────────────────────────────
const sansMarque = r.greffes.filter((g) => !g.marque && !EXEMPTES.has(g.fichier));
if (sansMarque.length > 0) {
    echecs.push(
        `[GRAFT-02] ${sansMarque.length} module(s) greffent sur un import SANS porter la marque :\n` +
            sansMarque.map((g) => `      ${g.fichier} (${g.sites} site(s))`).join("\n") +
            `\n\n      Ajouter \`${lib.MARQUE} <chemin de l'ancre>\` à l'en-tête, avec ce que le module\n` +
            `      greffe et sur quoi. Un module d'effet de bord n'a pas de consommateur : sans cette\n` +
            `      marque, rien ne distingue « personne ne l'importe » de « importé pour son effet ».`
    );
}
const ancresMortes = r.greffes.filter((g) => g.marque && !g.ancreVivante);
if (ancresMortes.length > 0) {
    echecs.push(
        `[GRAFT-03] ${ancresMortes.length} module(s) déclarent une ancre qui ne les importe PLUS :\n` +
            ancresMortes
                .map((g) => `      ${g.fichier}\n         ancre déclarée : ${g.ancre}`)
                .join("\n") +
            `\n\n      C'est la régression de juillet 2026, à l'identique : le module sort du graphe en\n` +
            `      SILENCE, la suite de tests reste verte, et le symptôme est un TypeError en\n` +
            `      production. Rétablir l'import NU dans l'ancre, ou corriger l'ancre déclarée.`
    );
}

for (const g of r.greffes) {
    const m = g.marque ? `${C.g}✓${C.x}` : `${C.r}✗${C.x}`;
    const a = g.ancreVivante ? `${C.g}✓${C.x}` : `${C.r}✗${C.x}`;
    console.log(`  marque ${m}  ancre ${a}  ${C.d}${g.sites} site(s)${C.x}  ${g.fichier}`);
}

if (echecs.length > 0) {
    console.error("");
    for (const e of echecs) console.error(`${C.r}✗${C.x} ${e}`);
    process.exit(1);
}
console.log(
    `${C.g}✓ GRAFT${C.x} — ${r.greffes.length} module(s) d'effet de bord, tous marqués, tous ancrés ` +
        `(témoin tenu).`
);
