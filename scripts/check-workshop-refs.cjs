#!/usr/bin/env node
/**
 * WREF — no NEW workshop reference in anything the public repository ships.
 *
 * ## The defect this ratchets
 *
 * The public repo was born from a single commit on 12/08/2026 and never carries the
 * workshop files (`_docs_projet/`, `CLAUDE.md`, …). A comment that says "see B-nnn" points,
 * for the only reader that matters, at a document that DOES NOT EXIST — and never did:
 * these references were never stale, they were dead on arrival. No other gate can see
 * them because none crosses the public/workshop boundary with comment content.
 *
 * ## What it counts
 *
 * Workshop tokens in PUBLIC files (the boundary is DERIVED from `lib/public-partition.cjs`
 * — never a hand-written glob, the divergence would cost more than the glob):
 * backlog/debt ids (`B-nnn`, `D-nn`), sprint markers (`Sprint N`, `S4.3`), roadmap names
 * (`roadmap_*`), and workshop paths (`_docs_projet/`). Markdown counts too: `docs/` ships.
 *
 *   WREF-01  a file with MORE tokens than its frozen count (or absent from the baseline
 *            with tokens) → ERROR. The deposit must never grow.
 *   WREF-02  a file now BELOW its frozen count → ERROR until tightened (shrink-only).
 *   WREF-03  corpus floor: fewer than 2000 public files → refuse to conclude.
 *
 * The baseline maps file → count (no line numbers: lines drift without information). The
 * TRIAGE of frozen tokens follows — three buckets, three gestures, never
 * a sed: a token can be pure traceability (drop it), carry the motive (rewrite the
 * sentence), or be the sentence's only reason (drop or replace the sentence).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const partition = require("./lib/public-partition.cjs");

const ROOT = path.resolve(__dirname, "..");
const BASELINE_PATH = path.join(__dirname, ".baselines", "workshop-refs.json");
const UPDATE = process.argv.includes("--update-baseline");

// One pattern per token family. `S4.3`-style sprint-task markers require the dot so a
// lone `S3` (storage, AWS) never matches; `Sprint N` requires the capital word.
const TOKEN =
    /\bB-[0-9]{2,3}\b|\bD-[0-9]{2}\b|\bSprint [0-9]+\b|\bS[0-9]+\.[0-9]+\b|\broadmap_[a-z0-9-]+|_docs_projet\//g;

function trackedFiles() {
    return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
}

const { publicFiles } = partition.split(trackedFiles());
if (publicFiles.length < 2000) {
    console.error(
        `❌ [WREF-03] ${publicFiles.length} fichiers publics — sous le plancher de 2000 : ` +
            `partition cassée, refus de conclure.`
    );
    process.exit(1);
}

const TEXT_EXT = new Set([
    ".ts",
    ".js",
    ".cjs",
    ".mjs",
    ".tsx",
    ".md",
    ".json",
    ".html",
    ".css",
    ".yml",
    ".yaml",
]);
const observed = new Map(); // file -> count
let total = 0;
for (const rel of publicFiles) {
    if (!TEXT_EXT.has(path.extname(rel))) continue;
    let src;
    try {
        src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    } catch {
        continue;
    }
    const n = (src.match(TOKEN) ?? []).length;
    if (n > 0) {
        observed.set(rel, n);
        total += n;
    }
}

console.log(`\x1b[2m── WREF — aucun renvoi d'atelier neuf dans ce que le public reçoit ──\x1b[0m`);
console.log(
    `  ${publicFiles.length} fichiers publics · ${observed.size} porteurs · ${total} jeton(s)`
);

if (UPDATE) {
    fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
    const entries = Object.fromEntries(
        [...observed.entries()].sort(([a], [b]) => a.localeCompare(b))
    );
    fs.writeFileSync(
        BASELINE_PATH,
        JSON.stringify(
            {
                _comment:
                    "WREF-01/02 — jetons d'atelier (B-nnn, D-nn, Sprint N, Sx.y, roadmap_*, _docs_projet/) par fichier PUBLIC, gelés à la pose. DÉCROISSANT uniquement : trier un fichier (trois seaux — traçabilité pure : retirer le jeton ; le renvoi porte le motif : réécrire la phrase ; la phrase n'existe que pour le renvoi : la retirer), puis --update-baseline. Jamais de sed : la roadmap code-autonome porte l'avertissement mesuré.",
                _generated: "node scripts/check-workshop-refs.cjs --update-baseline",
                files: observed.size,
                tokens: total,
                entries,
            },
            null,
            4
        ) + "\n"
    );
    console.log(
        `\x1b[32m✓\x1b[0m baseline écrite — ${observed.size} fichier(s), ${total} jeton(s).`
    );
    process.exit(0);
}

if (!fs.existsSync(BASELINE_PATH)) {
    console.error(`❌ [WREF] baseline absente — première pose : --update-baseline`);
    process.exit(1);
}
const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")).entries;

let failed = false;
const grown = [];
for (const [file, n] of observed) {
    const frozen = baseline[file] ?? 0;
    if (n > frozen) grown.push(`${file} — ${frozen} → ${n}`);
}
if (grown.length) {
    failed = true;
    console.error(`❌ [WREF-01] ${grown.length} fichier(s) dont le compte de jetons AUGMENTE :`);
    for (const g of grown.slice(0, 15)) console.error(`   + ${g}`);
    console.error(
        `   Un renvoi d'atelier est mort pour le lecteur public — écrire le motif en clair.`
    );
}
const shrunk = Object.entries(baseline).filter(([f, n]) => (observed.get(f) ?? 0) < n);
if (shrunk.length) {
    failed = true;
    console.error(`❌ [WREF-02] ${shrunk.length} fichier(s) sous leur gel — resserrer :`);
    for (const [f, n] of shrunk.slice(0, 10))
        console.error(`   − ${f} (${n} → ${observed.get(f) ?? 0})`);
    console.error(`   \x1b[2mnode scripts/check-workshop-refs.cjs --update-baseline\x1b[0m`);
}
if (failed) process.exit(1);
console.log(
    `\x1b[32m✓ WREF\x1b[0m — aucun renvoi d'atelier neuf (${Object.keys(baseline).length} fichier(s) gelé(s)).`
);
