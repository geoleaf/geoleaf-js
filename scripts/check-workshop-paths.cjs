#!/usr/bin/env node
/*!
 * GeoLeaf — WPATH: does a public PROSE document point the reader into the workshop?
 * © 2026 Mattieu Pottier — MIT
 *
 * ## The defect this gate makes visible
 *
 * `docs/`, the package READMEs and the root markdown ship to `geoleaf/geoleaf-js`.
 * `CLAUDE.md` and `.claude/` never do — `public-partition.cjs` holds them back. A public
 * document that names one of them therefore sends its reader to a file that does not exist
 * on their side. The reference is **dead by construction**, and it was dead the day it was
 * written.
 *
 * 🛑 **And no local run can see it.** `SPECS-PATHS` and `GUIDES-PATHS` resolve the paths
 * they audit against the CURRENT repository: in the workshop the file is right there, so
 * they are green and always will be. Only the public clone judges the right corpus.
 * Measured twice on 2026-09-01, hours apart: `ci:local` **110/110** while the public run
 * reddened on the same commit — once on `docs/reference/ARCHITECTURE.md`, once on
 * `docs/specs/CDC_kernel.md`, the second time inside the revision entry that was
 * recounting a different rule broken an hour earlier. Writing the lesson down did not
 * prevent the repeat; that is the signature of a rule that needs a gate, not a reminder.
 *
 * ## Why a hard failure and no baseline
 *
 * The usual shape here is a shrinking baseline, because a gate born red gets switched off
 * within the week — this repo has measured that outcome more than once. It does not apply:
 * the corpus was **measured at zero carriers** before this gate was written. There is no
 * existing debt to freeze, so freezing machinery would only add a place for new debt to
 * hide. The rule is absolute until something legitimate needs an exemption, and that
 * exemption will then be named here rather than absorbed silently.
 *
 * ## Why it is NOT folded into WREF
 *
 * `check-workshop-refs.cjs` already chases the workshop docs directory, `B-nnn`,
 * `Sprint N` and friends across **every public text file**, code included. Widening its token to
 * `CLAUDE.md` / `.claude/` was measured first and rejected: it would add 96 mentions over
 * 30 files, and almost all of them are the instruments themselves — `public-partition.cjs`
 * naming the paths it partitions, `eslint.config.mjs` and `playwright.config.js` excluding
 * them from a glob. Those are operational mentions, not references, and they can never
 * leave. Freezing them would inflate a baseline built to shrink.
 *
 * The distinction this gate rests on is therefore **prose vs. apparatus**: a `.md` document
 * addresses a reader, a config addresses a tool. Only the first can send someone to a file
 * they do not have.
 *
 * ## The rules
 *
 *   WPATH-00  Anti-empty corpus: fewer public prose documents than the floor means a broken
 *             partition or a wrong working directory. Refuse to conclude rather than pass.
 *   WPATH-01  RED — a public prose document names a workshop path. Name the mechanism, not
 *             the file: "the workshop instructions" reads the same for both audiences.
 *   WPATH-02  RED — an exemption whose WITNESS no longer holds. Each exemption rests on a
 *             public file the prose quotes; when that file stops carrying the quoted
 *             string, the exemption has lost its reason and must not survive it.
 *   WPATH-03  RED — the split with WREF drifted: the partition no longer yields exactly one
 *             excluded pattern, so this gate no longer knows what it covers.
 *
 * ⚠️ All four were seen red by mutation before this gate was believed, and restored:
 * a citation injected into `ARCHITECTURE.md` (WPATH-01), the `testIgnore` glob removed
 * from `playwright.config.js` (WPATH-02), the floor raised above the real corpus
 * (WPATH-00), and a second `why` reworded to fall out of the split (WPATH-03).
 * A guard never seen red guards nothing.
 *
 * Usage:
 *   node scripts/check-workshop-paths.cjs
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const partition = require("./lib/public-partition.cjs");

const ROOT = path.resolve(__dirname, "..");
const TAG = "WPATH";
const C = { r: "\x1b[31m", g: "\x1b[32m", d: "\x1b[2m", x: "\x1b[0m" };

/**
 * Tokens, derived from the partition itself rather than restated.
 *
 * ⚠️ Deriving matters more than it looks: a hand-written list would keep passing after
 * someone adds a fifth internal pattern, and the gate would be green having never looked
 * at it. The workshop docs directory and the roadmap names are deliberately left to WREF,
 * which already covers them over a wider corpus — see the header.
 */
const TOKENS = partition.INTERNAL_PATTERNS.filter(({ why }) => !/atelier/i.test(why)).map(
    ({ pattern }) => pattern
);

// The split must remove exactly one pattern — the workshop docs directory, already covered
// by WREF over a wider corpus. Asserting the COUNT rather than the name keeps this file from
// citing the very token it exists to police, and makes any drift in the partition loud: a
// reworded `why` widens this gate instead of blinding it, and a second exclusion stops it.
if (TOKENS.length !== partition.INTERNAL_PATTERNS.length - 1) {
    console.error(
        `\n${C.r}✘ [${TAG}-03]${C.x} la partition en exclut ${partition.INTERNAL_PATTERNS.length - TOKENS.length} ` +
            `au lieu d'un seul — le partage avec WREF a dérivé, refus de conclure.\n`
    );
    process.exit(1);
}

/**
 * Generated artefacts of `docs/reference/`, out of corpus.
 *
 * They list the repository tree, so they name the workshop by construction and their count
 * moves with every workshop file. They are true by construction and already gated by their
 * own `--check`; judging them here would make this gate flap on changes it does not watch.
 */
const GENERATED = new Set([
    "docs/reference/ARBORESCENCE_QUALIFIEE.md",
    "docs/reference/ARBORESCENCE_QUALIFIEE.html",
    "docs/reference/MODELE_ATTRIBUTAIRE.md",
    "docs/reference/PROFILE_SCHEMA_REFERENCE.md",
    "docs/reference/inventaire_config_parametres.md",
]);

/** Plausibility floor — measured at 165 prose documents on 2026-09-01. */
const MIN_PROSE = 100;

/**
 * Named exemptions, each with a WITNESS.
 *
 * An exemption without a witness is a hole that outlives its reason: the day the motive
 * falls, nothing says so and the gate keeps waving the citation through. Here the witness
 * is the public file the prose is quoting — as long as it carries the token, the mention
 * is a quotation a public reader can go and check, not a pointer into a place they lack.
 * `WPATH-02` reddens when a witness stops holding, so a stale exemption cannot rot in
 * silence.
 */
const EXEMPTIONS = [
    {
        file: "e2e/README.md",
        token: ".claude/",
        witness: "playwright.config.js",
        needle: "**/.claude/**",
        why: "quotes the `testIgnore` glob of a PUBLIC config — a project-level `testIgnore` overrides the config-level one instead of adding to it, so the glob is repeated per project and the README explains why. The reader can open the quoted file.",
    },
];

function trackedFiles() {
    return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
}

/** A token match that is a real citation, not a substring of a longer word. */
function matchesIn(line, token) {
    const out = [];
    let from = 0;
    for (;;) {
        const i = line.indexOf(token, from);
        if (i < 0) return out;
        const before = i === 0 ? "" : line[i - 1];
        // `.claude/` inside `~/.claude/` is still a citation; inside `x.claude/` it is not.
        const glued = /[\w.]/.test(before) && before !== "/" && before !== "~";
        if (!glued) out.push(i + 1);
        from = i + token.length;
    }
}

const { publicFiles } = partition.split(trackedFiles());
const prose = publicFiles.filter((rel) => path.extname(rel) === ".md" && !GENERATED.has(rel));

if (prose.length < MIN_PROSE) {
    console.error(
        `\n${C.r}✘ [${TAG}-00]${C.x} ${prose.length} document(s) de prose publique — sous le ` +
            `plancher de ${MIN_PROSE}. Partition cassée ou mauvais répertoire courant : ` +
            `refus de conclure plutôt qu'un vert qui n'a rien lu.\n`
    );
    process.exit(1);
}

let hits = [];
for (const rel of prose) {
    let src;
    try {
        src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    } catch {
        continue;
    }
    src.split("\n").forEach((line, i) => {
        for (const token of TOKENS) {
            for (const col of matchesIn(line, token)) {
                hits.push({ rel, line: i + 1, col, token });
            }
        }
    });
}

console.log(`── ${TAG} — la prose publique ne pointe pas dans l'atelier ──`);
console.log(
    `  ${prose.length} document(s) de prose · ${TOKENS.length} jeton(s) surveillé(s) : ` +
        `${TOKENS.join(", ")}`
);

// ── WPATH-02 — a witness that no longer holds ────────────────────────────────────────
const stale = EXEMPTIONS.filter((e) => {
    let src;
    try {
        src = fs.readFileSync(path.join(ROOT, e.witness), "utf8");
    } catch {
        return true;
    }
    return !src.includes(e.needle);
});
if (stale.length > 0) {
    console.error(
        `\n${C.r}✘ [${TAG}-02]${C.x} ${stale.length} exemption(s) dont le TÉMOIN est tombé :`
    );
    for (const e of stale) {
        console.error(
            `   ${e.file} → \`${e.token}\` · témoin \`${e.witness}\` ne porte plus \`${e.needle}\``
        );
    }
    console.error(
        `\n  L'exemption reposait sur une citation vérifiable par le lecteur public. Son\n` +
            `  motif est tombé : soit la prose se reformule, soit l'exemption se retire.\n`
    );
    process.exit(1);
}

const exempted = new Set(EXEMPTIONS.map((e) => `${e.file} ${e.token}`));
const excused = hits.filter((h) => exempted.has(`${h.rel} ${h.token}`));
hits = hits.filter((h) => !exempted.has(`${h.rel} ${h.token}`));
if (excused.length > 0) {
    console.log(
        `  ${excused.length} mention(s) exemptée(s), témoin vérifié : ` +
            EXEMPTIONS.map((e) => `${e.file} → \`${e.token}\``).join(", ")
    );
}

if (hits.length > 0) {
    console.error(
        `\n${C.r}✘ [${TAG}-01]${C.x} ${hits.length} renvoi(s) vers l'atelier dans un document PUBLIC :`
    );
    for (const h of hits) {
        console.error(`   ${h.rel}:${h.line} — \`${h.token}\``);
    }
    console.error(
        `\n  Ces fichiers ne partent JAMAIS au dépôt public : le renvoi y pointe vers un\n` +
            `  document introuvable, et il l'était le jour où il a été écrit.\n` +
            `  ${C.d}Geste : nommer le MÉCANISME, pas le fichier — « la consigne d'atelier »,\n` +
            `  « la gate EVENT-MAP » — une formulation qui se lit pareil des deux côtés.${C.x}\n`
    );
    process.exit(1);
}

console.log(`${C.g}✓ ${TAG}${C.x} — aucun renvoi vers l'atelier dans la prose publique.`);
