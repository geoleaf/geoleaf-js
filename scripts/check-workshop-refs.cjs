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
 * ✅ **And, since 02/09/2026, the names of NEIGHBOURING REPOSITORIES and of the backend a
 * consumer happens to run.** This library is standalone and knows no backend: naming one
 * in a shipped file writes a dependency that does not exist, points a public reader at a
 * repository they cannot open, and quietly turns one integrator's stack into part of the
 * product's description.
 *
 * ⚠️ **The deposit was three files, and the third is the reason this family joined the
 * gate rather than a review habit.** `lib/consumer-manifest.cjs` explained, in prose, why
 * NO default path may be written — "it would write the name of a private repo into
 * `scripts/`" — and wrote that name in the example illustrating the rule. A rule broken by
 * its own statement is not a rule anyone can follow; only a counter can hold it.
 *
 * ⚠️ **The pattern is CASE-SENSITIVE and deliberately narrow.** `GeoLeaf_core_README.md` is
 * this repository's own file and must not match, which one careless `/i` would break —
 * measured before the pattern was written, on the whole tracked corpus.
 *
 *   WREF-01  a file with MORE tokens than its frozen count (or absent from the baseline
 *            with tokens) → ERROR. The deposit must never grow.
 *   WREF-02  a file now BELOW its frozen count → ERROR until tightened (shrink-only).
 *   WREF-03  corpus floor: fewer than 2000 public files → refuse to conclude.
 *   WREF-04  a business-DOMAIN framing term in a public file → ERROR. Zero tolerance.
 *   WREF-05  an exemption whose WITNESS no longer holds → ERROR.
 *
 * ## The second class, and why the counter could not hold it
 *
 * ⚠️ **Added 17/09/2026, on a measured miss.** The commit that rewrote the public showcase
 * asserted "no backend name, no consumer name (WREF green)" — and that was TRUE. The
 * showcase had nevertheless started to define the product by a business DOMAIN: 25
 * occurrences over 12 public files, the root README, the npm description and the
 * positioning page among them. The gate had no opinion, because the rule it enforced
 * named a PROPER NOUN and the rule that was broken framed a DOMAIN.
 *
 * ⚠️ **The header above had already described the defect it missed** — naming a backend
 * "quietly turns one integrator's stack into part of the product's description". That is
 * exactly what happened, by the domain instead of the name.
 *
 * 🛑 **This class is NOT baselined, and must not join `TOKEN`.** The baseline freezes one
 * count PER FILE, all families merged, and `WREF-01` only tests `n > frozen`: a file frozen
 * at N can SWAP a `B-nnn` for another token and stay silent. Merging the two classes would
 * also make all 36 frozen counts jump at once. Zero tolerance sidesteps both, and it is
 * affordable because the corpus was purged to zero carriers the day the class was added.
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
    /\bB-[0-9]{2,3}\b|\bD-[0-9]{2}\b|\bSprint [0-9]+\b|\bS[0-9]+\.[0-9]+\b|\broadmap_[a-z0-9-]+|_docs_projet\/|geoleaf-(?:maintenance|shared)|\bgeoleaf_(?:core|itinerary|realtime|contribution|review|website)\b|\b[Oo]doo\b|\bODOO\b/g;

/**
 * WREF-04 — the FRAMING, not the name.
 *
 * ⚠️ **Multi-word by necessity.** A bare `\basset\b` would bite `boot-assets.cjs`,
 * `assets/`, `assetsInclude` and "next to your assets" — measured over the whole tracked
 * corpus before the pattern was written. `GMAO` and `CMMS` bite nothing today and are
 * PREVENTIVE: a ratchet at zero debt is meant to stay silent.
 *
 * ⚠️ **Case-INSENSITIVE here**, unlike `TOKEN`. `TOKEN` must stay case-sensitive because
 * `GeoLeaf_core_README.md` is this repository's own file; no repository file is named after
 * a business domain, so the trap does not apply and `Patrimoine` must match `patrimoine`.
 */
const DOMAIN =
    /asset[ -]management|asset inventory|gestion d(?:e |')actifs?|inventaire d(?:e |')actifs?|\bpatrimoine\b|\bpatrimonial|\bGMAO\b|\bCMMS\b|\bERP\b/gi;

/**
 * This file itself — it carries the banned list by construction.
 *
 * ⚠️ Without this, the gate counts itself, which is the failure its own header narrates:
 * "a rule broken by its own statement is not a rule anyone can follow". It is a necessity,
 * not a hole: the banned terms MUST appear here for the rule to exist at all.
 */
const SELF = "scripts/check-workshop-refs.cjs";

/**
 * Demonstration profiles — data and configuration, never their prose.
 *
 * `profiles/` is a SHOWCASE: a tourism profile legitimately carries a `patrimoine` tag and a
 * lighting profile legitimately carries `candelabres`. Judging those occurrences would gate
 * the showcase instead of the mechanism, and a gate that reddens on legitimate content gets
 * disarmed within the week. ⚠️ `.md` under `profiles/` STAYS in scope — a profile README is
 * prose about the product, and `profiles/README.md` is already exemplary ("Un profil = un
 * métier ou un client, avec ses données").
 */
const isDemoData = (rel) => rel.startsWith("profiles/") && path.extname(rel) !== ".md";

/**
 * Named exemptions for WREF-04, each with a WITNESS.
 *
 * Same regime as `WPATH`: an exemption without a witness is a hole that outlives its reason.
 * Empty today — `SELF` and `isDemoData` are structural, not exemptions — and kept so the
 * first real case has a shape to follow rather than inventing one under pressure.
 *
 * @type {{file: string, token: string, witness: string, needle: string, why: string}[]}
 */
const DOMAIN_EXEMPTIONS = [];

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
/** @type {{rel: string, line: number, token: string}[]} */
let domainHits = [];
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
    // WREF-04 keeps LINE NUMBERS where WREF-01/02 keep a count: with zero tolerance there
    // is no baseline to drift against, so the precise site is free and worth printing.
    if (rel === SELF || isDemoData(rel)) continue;
    src.split("\n").forEach((line, i) => {
        for (const m of line.matchAll(DOMAIN)) domainHits.push({ rel, line: i + 1, token: m[0] });
    });
}

console.log(`\x1b[2m── WREF — aucun renvoi d'atelier neuf dans ce que le public reçoit ──\x1b[0m`);
console.log(
    `  ${publicFiles.length} fichiers publics · ${observed.size} porteurs · ${total} jeton(s)`
);

// ── WREF-05 — an exemption whose witness has fallen ──────────────────────────────────
const staleDomain = DOMAIN_EXEMPTIONS.filter((e) => {
    let w;
    try {
        w = fs.readFileSync(path.join(ROOT, e.witness), "utf8");
    } catch {
        return true;
    }
    return !w.includes(e.needle);
});
if (staleDomain.length > 0) {
    console.error(`❌ [WREF-05] ${staleDomain.length} exemption(s) dont le TÉMOIN est tombé :`);
    for (const e of staleDomain)
        console.error(
            `   ${e.file} → \`${e.token}\` · témoin \`${e.witness}\` ne porte plus \`${e.needle}\``
        );
    console.error(
        `   Le motif est tombé : soit la prose se reformule, soit l'exemption se retire.`
    );
    process.exit(1);
}
const domainExempt = new Set(DOMAIN_EXEMPTIONS.map((e) => `${e.file} ${e.token}`));
domainHits = domainHits.filter((h) => !domainExempt.has(`${h.rel} ${h.token.toLowerCase()}`));

// ── WREF-04 — business-domain framing, tolérance zéro ────────────────────────────────
if (domainHits.length > 0) {
    const byFile = new Map();
    for (const h of domainHits) {
        if (!byFile.has(h.rel)) byFile.set(h.rel, []);
        byFile.get(h.rel).push(`${h.line}:${h.token}`);
    }
    console.error(
        `❌ [WREF-04] ${domainHits.length} terme(s) de CADRAGE métier dans ` +
            `${byFile.size} fichier(s) public(s) :`
    );
    for (const [f, hits] of [...byFile.entries()].sort())
        console.error(`   ${f} — ${hits.join(", ")}`);
    console.error(
        `   Cette bibliothèque est agnostique de tout backend ET de tout métier : un profil\n` +
            `   JSON décide de quoi l'application parle, jamais le code. Nommer un domaine dans\n` +
            `   ce que le public reçoit fait d'un usage particulier la DÉFINITION du produit.\n` +
            `   • Dire le MÉCANISME — « des données », « le serveur », « une entité ».\n` +
            `   • Décrire un profil de DÉMONSTRATION reste permis : c'est son contenu, pas le\n` +
            `     produit. La faute est de s'en servir pour définir ce que GeoLeaf EST.\n` +
            `   ⚠️ Tolérance zéro, sans gel : le corpus a été purgé à zéro porteur le 17/09/2026.`
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
        `   Deux familles, deux gestes — le jeton fautif est imprimé ci-dessus.\n` +
            `   • Renvoi d'ATELIER : mort pour le lecteur public, qui n'a pas le document.\n` +
            `     Écrire le motif en clair à sa place.\n` +
            `   • NOM d'un dépôt voisin ou d'un backend : inscrit une dépendance qui n'existe\n` +
            `     pas. Cette bibliothèque est autonome et ne connaît aucun backend — nommer le\n` +
            `     mécanisme, « le consommateur », « son dépôt », jamais le produit.\n` +
            `   ⚠️ Ce message ne cite AUCUN exemple nommé, à dessein : il se compterait lui-même.`
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
