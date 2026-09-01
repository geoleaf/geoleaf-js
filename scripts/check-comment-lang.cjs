#!/usr/bin/env node
/**
 * CLANG — no NEW French comment in shipped code, under a shrinking baseline.
 *
 * ## The convention this ratchets (written since the origin, never gated)
 *
 * "Docs, outputs, réponses en français ; commentaires de code en anglais." Markdown is
 * therefore OUT of scope here — French is CORRECT there — and only code files are judged:
 * `.ts/.tsx/.js/.cjs/.mjs` of the PUBLIC partition (derived from `lib/public-partition.cjs`).
 *
 * ## The detector — a LANGUAGE, never an accent (the roadmap's named trap)
 *
 * Detecting French by `[éèêàç]` misses every accentless French sentence and bites on
 * legitimate accented English (`naïve`, `café`). The roadmap's figure of 756 files came
 * from that crude motif and is a floor, not a measure. This detector extracts COMMENTS
 * (line and block, string-literals stripped first so a French UI string never counts) and
 * scores FRENCH STOP-WORDS — function words that do not exist in English: the
 * twenty-two words of the STOPWORDS set below, which is the single source of the
 * list. A comment is French when it carries >= 2 DISTINCT stop-words — one alone
 * can be a variable name quoted in prose.
 *
 *   CLANG-01  a file with MORE French comments than its frozen count → ERROR.
 *   CLANG-02  a file now BELOW its frozen count → ERROR until tightened (shrink-only).
 *   CLANG-03  corpus floor: fewer than 800 code files scanned → refuse to conclude.
 *
 * ⚠️ Translation is WRITING, not substitution: the comments of this repo carry measured
 * motives, dates and figures — several are longer than the function they document. The
 * gate only keeps the deposit from growing; the translation pass is the treatment.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const partition = require("./lib/public-partition.cjs");

const ROOT = path.resolve(__dirname, "..");
const BASELINE_PATH = path.join(__dirname, ".baselines", "comment-lang.json");
const UPDATE = process.argv.includes("--update-baseline");

const STOPWORDS = new Set([
    "le",
    "la",
    "les",
    "des",
    "une",
    "est",
    "pour",
    "avec",
    "dans",
    "pas",
    "sur",
    "qui",
    "que",
    "ne",
    "du",
    "cette",
    "sont",
    "mais",
    "donc",
    "déjà",
    "être",
    "même",
]);

/**
 * All comment texts of a JS/TS source — via a single-pass STATE LEXER, never a strip-then-
 * regex pipeline. The first version stripped string literals with a regex before scanning:
 * a FRENCH APOSTROPHE inside a comment (`l'`, `d'`, `qu'`) opened a phantom "literal" that
 * swallowed text up to the next apostrophe, splitting comments chaotically — the count
 * moved by +57 on a file where two lines had changed, and the gate's own ratchet is what
 * caught it. Quotes inside comments are prose; only a lexer that knows it is inside a
 * comment can ignore them.
 */
function commentsOf(src) {
    const out = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i];
        const d = src[i + 1];
        if (c === "/" && d === "/") {
            let j = i + 2;
            while (j < n && src[j] !== "\n") j++;
            out.push(src.slice(i + 2, j));
            i = j;
        } else if (c === "/" && d === "*") {
            let j = i + 2;
            while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
            out.push(src.slice(i + 2, j));
            i = j + 2;
        } else if (c === '"' || c === "'" || c === "`") {
            const q = c;
            let j = i + 1;
            while (j < n && src[j] !== q) {
                if (src[j] === "\\") j++;
                j++;
            }
            i = j + 1;
        } else {
            i++;
        }
    }
    return out;
}

/** True when the comment scores >= 2 distinct French stop-words. */
function isFrench(comment) {
    const words = comment.toLowerCase().match(/[a-zàâçéèêëîïôûùüÿœ]+/g) ?? [];
    const hits = new Set();
    for (const w of words) if (STOPWORDS.has(w)) hits.add(w);
    return hits.size >= 2;
}

function trackedFiles() {
    return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
}

const { publicFiles } = partition.split(trackedFiles());
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".cjs", ".mjs"]);
const observed = new Map(); // file -> count of French comments
let scanned = 0;
let totalFr = 0;
for (const rel of publicFiles) {
    if (!CODE_EXT.has(path.extname(rel))) continue;
    if (rel.includes("/dist/") || rel.includes("node_modules/")) continue;
    let src;
    try {
        src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    } catch {
        continue;
    }
    scanned++;
    const n = commentsOf(src).filter(isFrench).length;
    if (n > 0) {
        observed.set(rel, n);
        totalFr += n;
    }
}

console.log(`\x1b[2m── CLANG — aucun commentaire français neuf dans le code livré ──\x1b[0m`);
console.log(
    `  ${scanned} fichiers de code publics · ${observed.size} porteurs · ${totalFr} commentaire(s) français`
);

if (scanned < 800) {
    console.error(
        `❌ [CLANG-03] ${scanned} fichiers scannés — sous le plancher de 800 : corpus cassé.`
    );
    process.exit(1);
}

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
                    "CLANG-01/02 — commentaires FRANÇAIS par fichier de code PUBLIC (détection par stop-words, >= 2 distincts par commentaire — jamais par accent, le piège nommé de la roadmape), gelés à la pose. DÉCROISSANT : traduire un fichier (une traduction se RELIT, elle ne se substitue pas — les commentaires portent des motifs mesurés), puis --update-baseline.",
                _generated: "node scripts/check-comment-lang.cjs --update-baseline",
                files: observed.size,
                comments: totalFr,
                entries,
            },
            null,
            4
        ) + "\n"
    );
    console.log(
        `\x1b[32m✓\x1b[0m baseline écrite — ${observed.size} fichier(s), ${totalFr} commentaire(s).`
    );
    process.exit(0);
}

if (!fs.existsSync(BASELINE_PATH)) {
    console.error(`❌ [CLANG] baseline absente — première pose : --update-baseline`);
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
    console.error(
        `❌ [CLANG-01] ${grown.length} fichier(s) dont le compte de commentaires français AUGMENTE :`
    );
    for (const g of grown.slice(0, 15)) console.error(`   + ${g}`);
    console.error(`   La convention veut les commentaires de code en anglais — écrire en anglais.`);
}
const shrunk = Object.entries(baseline).filter(([f, n]) => (observed.get(f) ?? 0) < n);
if (shrunk.length) {
    failed = true;
    console.error(`❌ [CLANG-02] ${shrunk.length} fichier(s) sous leur gel — resserrer :`);
    for (const [f, n] of shrunk.slice(0, 10))
        console.error(`   − ${f} (${n} → ${observed.get(f) ?? 0})`);
    console.error(`   \x1b[2mnode scripts/check-comment-lang.cjs --update-baseline\x1b[0m`);
}
if (failed) process.exit(1);
console.log(
    `\x1b[32m✓ CLANG\x1b[0m — aucun commentaire français neuf (${Object.keys(baseline).length} fichier(s) gelé(s)).`
);
