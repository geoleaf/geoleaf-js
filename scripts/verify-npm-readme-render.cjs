#!/usr/bin/env node
"use strict";
/**
 * verify-npm-readme-render.cjs — the PUBLISHED READMEs render on npmjs.com.
 *
 * ## The hole this gate closes
 *
 * `npmjs.com` does NOT render GitHub alerts (`> [!NOTE]`, `> [!WARNING]`,
 * `> [!IMPORTANT]`, `> [!TIP]`, `> [!CAUTION]`): the syntax is a GitHub-specific
 * extension, and the registry's Markdown engine treats it as an ordinary quote.
 * The marker displays as LITERAL TEXT, without icon or colour — so the promised
 * callout becomes a noise line ABOVE the warning it was meant to underline.
 * Measured on 2026-08-14, before the fix: 18 alerts across 6 of the 14 published
 * READMEs, 5 of them in `@geoleaf/core`, the project's most-read npm page.
 *
 * The retained form is the one rendering identically on both sides:
 * `> **Warning** — …`.
 *
 * ⚠️ **No gate could see it, and two grazed it.** `check-dead-links` extracts only
 * links (`[text](target)`). `validate-docs-examples` DOES read these files — same
 * corpus, via `lib/tsdoc-examples.cjs#productDocsFiles` — but its subject is the
 * CODE of fenced blocks. The fault lives in the PROSE, on a surface whose
 * rendering cannot be observed from this repo: the definition of a blind spot. A
 * defect there stays invisible until a reader opens the registry page, which
 * nobody does in a development loop.
 *
 * ## Why the perimeter stops at PUBLISHED READMEs
 *
 * 🛑 The rule is INVERSE elsewhere, and widening it would make it FALSE:
 *   • root `README.md`    → GitHub showcase (`private` package), which renders
 *                           alerts. 7 live there, legitimately, and must stay.
 *   • `docs/`             → rendered by VitePress, which renders them too.
 *   • a package's `docs/` → sometimes ships in the tarball, but npmjs.com renders
 *                           ONLY the package's root `README.md`. Downloaded,
 *                           never rendered — out of scope.
 * A gate reddening on those three surfaces would redden on the legitimate, and a
 * gate reddening on the legitimate gets disabled. It thus needs its own perimeter.
 *
 * ## What is verified
 *
 *   NPMDOC-01  no GitHub alert in a published package's README, nor in the
 *              scaffold's — OUTSIDE fenced blocks: a code extract TEACHES the
 *              syntax, it does not render it. Case- and space-insensitive
 *              (`>[!Warning]` is just as broken on npm), and not anchored on the
 *              `>`: a fix's most probable fault is removing the chevron while
 *              leaving the marker, and a rule taking only the canonical form
 *              would let the badly-repaired form through.
 *   NPMDOC-02  each `registry.publishable()` package carries a README, and it was
 *              READ. A published package without a README shows "no README" on
 *              its page — a defect in itself; and a shrunken corpus (registry
 *              returning less, `private` set by mistake, file moved) is the
 *              failure mode through which this gate would go GREEN having read
 *              nothing. Exit 2: refusal to conclude, not a verdict.
 *   NPMDOC-03  the `_plugin-template/README.template.md` scaffold was read. It is
 *              the file's ONLY hard-coded path, for the reason already written in
 *              `lib/tsdoc-examples.cjs#productDocsFiles`: outside the
 *              `workspaces` globs (`!packages/_*`), hence invisible to the
 *              registry. `create-plugin.cjs` never emits it — it serves as a
 *              MODEL copied by hand, which makes it the contagion channel, not
 *              its absence. Exit 2 if it rotted.
 *
 * ⚠️ **The boundary is `private`, not a list.** The day a private package becomes
 * publishable, its README enters the perimeter the same day — wanted, and
 * `packages/libs/host-runtime/README.md` carries one today, out of perimeter. If
 * this gate suddenly reddens on lines no commit touched, look for a removed
 * `private` before suspecting the gate.
 *
 * 🛑 **Do NOT wire this gate into `probe-gate-visibility.cjs`.** The probe plants
 * its witness package with `private: true`: a `publishable()`-perimeter gate is
 * STRUCTURALLY invisible there, and the probe could only report a false "blind".
 * Making the witness publishable to satisfy it would pull it into the licence and
 * publication gates' perimeter — a remedy worse than the ill. The anti-blindness
 * thus lives HERE, in NPMDOC-02/03.
 *
 * Usage : node scripts/verify-npm-readme-render.cjs
 * Exit : 0 clean · 1 alert found · 2 perimeter inconclusive.
 */

const fs = require("node:fs");
const path = require("node:path");

const registry = require("./lib/packages.cjs");

const ROOT = path.resolve(__dirname, "..");
const C = { red: "\x1b[31m", green: "\x1b[32m", dim: "\x1b[2m", bold: "\x1b[1m", x: "\x1b[0m" };

/** See NPMDOC-03 for this literal's motive — the file's only one. */
const SCAFFOLD_README = path.join(ROOT, "packages", "_plugin-template", "README.template.md");

/** The alert marker, in every form npm renders as literal text. */
const ALERT_RE = /\[!\s*(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\s*\]/i;

/** Fenced-block open/close (CommonMark: at most 3 spaces of indentation). */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/** @param {string} abs @returns {string} root-relative path, POSIX separators */
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join("/");

/**
 * Collects a `.md`'s GitHub alerts, skipping fenced blocks.
 * A closing marker must be the same character and at least as long as the opener.
 *
 * @param {string} abs Absolute file path.
 * @returns {{ line: number, type: string, text: string }[]}
 */
function scanReadme(abs) {
    const found = [];
    let fence = null;

    fs.readFileSync(abs, "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
            const f = FENCE_RE.exec(line);
            if (f) {
                if (fence === null) {
                    fence = f[1];
                    return;
                }
                if (f[1][0] === fence[0] && f[1].length >= fence.length) {
                    fence = null;
                    return;
                }
            }
            if (fence !== null) return;

            const hit = ALERT_RE.exec(line);
            if (hit) found.push({ line: i + 1, type: hit[1].toUpperCase(), text: line.trim() });
        });

    return found;
}

// ── The corpus ───────────────────────────────────────────────────────────────

/** @type {string[]} NPMDOC-02 / NPMDOC-03 — refusal to conclude. */
const blind = [];
/** @type {{ abs: string, rel: string, owner: string }[]} */
const corpus = [];

const publishable = registry.publishable();

for (const pkg of publishable) {
    const abs = path.join(pkg.absDir, "README.md");
    if (!fs.existsSync(abs)) {
        blind.push(
            `NPMDOC-02 ${pkg.dir}/README.md — ABSENT alors que ${pkg.name} est publiable.\n` +
                `        ${C.dim}Sa page npm afficherait « no README ». Écrire le README, ` +
                `ou passer le paquet en \`private: true\` s'il n'a rien à faire au registre.${C.x}`
        );
        continue;
    }
    corpus.push({ abs, rel: rel(abs), owner: pkg.name });
}

if (!fs.existsSync(SCAFFOLD_README)) {
    blind.push(
        `NPMDOC-03 ${rel(SCAFFOLD_README)} — INTROUVABLE.\n` +
            `        ${C.dim}C'est le seul chemin en dur de cette gate (le scaffold est hors ` +
            `des globs workspaces). S'il a déménagé, mettre CE chemin à jour — ne pas retirer ` +
            `la règle : le modèle recopié à la main dans chaque nouveau plugin cesserait ` +
            `d'être lu.${C.x}`
    );
} else {
    corpus.push({
        abs: SCAFFOLD_README,
        rel: rel(SCAFFOLD_README),
        owner: "scaffold (_plugin-template)",
    });
}

// ── NPMDOC-02 — the scan is not empty ────────────────────────────────────────
//
// 🛑 WITHOUT THIS BLOCK, THIS GATE IS DECORATIVE. A registry returning fewer
// packages, a moved README, a `private` set by mistake: in all three cases, zero
// alerts found, and a green. A guard never seen red guards nothing; one that
// CANNOT redden neither.
if (publishable.length === 0) {
    blind.push(
        `NPMDOC-02 — \`registry.publishable()\` n'a rendu AUCUN paquet. Le registre ne voit ` +
            `plus rien, ou tout le dépôt est passé \`private\`. Le scan n'a rien couvert.`
    );
}
if (corpus.length === 0) {
    blind.push(`NPMDOC-02 — corpus VIDE. Un verdict sur zéro fichier n'est pas un verdict.`);
}

if (blind.length) {
    console.error(`\n${C.red}${C.bold}✖ NPM-README — périmètre non concluant${C.x}\n`);
    for (const b of blind) console.error(`  ${C.red}•${C.x} ${b}`);
    console.error("");
    process.exit(2);
}

// ── NPMDOC-01 — aucune alerte GitHub ─────────────────────────────────────────

const errors = [];

for (const file of corpus) {
    for (const hit of scanReadme(file.abs)) {
        const label = hit.type[0] + hit.type.slice(1).toLowerCase();
        errors.push(
            `NPMDOC-01 ${file.rel}:${hit.line} — alerte GitHub \`[!${hit.type}]\`.\n` +
                `        ${C.dim}${hit.text}${C.x}\n` +
                `        ${C.dim}npmjs.com ne rend pas cette syntaxe : le marqueur s'affiche ` +
                `en texte littéral sur la page du paquet. Écrire \`> **${label}** — …\`.${C.x}`
        );
    }
}

// ── Verdict — DERIVED tallies, never copied into prose ───────────────────────

const scanned = `${corpus.length} README (${publishable.length} paquets publiés + le scaffold)`;

if (errors.length) {
    console.error(`\n${C.red}${C.bold}✖ NPM-README — ${errors.length} alerte(s) GitHub${C.x}\n`);
    for (const e of errors) console.error(`  ${C.red}•${C.x} ${e}`);
    console.error(`\n  ${C.dim}Scanné : ${scanned}${C.x}\n`);
    process.exit(1);
}

console.log(
    `${C.green}✔ NPM-README${C.x} : aucune alerte GitHub dans les README publiés — ` +
        `3 invariants tenus (alertes, README de chaque paquet publiable, scaffold lu).\n` +
        `  ${C.dim}Scanné : ${scanned}${C.x}`
);
