#!/usr/bin/env node
/**
 * LI — every registry entry of `package-lock.json` carries an `integrity` hash, under a
 * shrinking baseline.
 *
 * ## The defect this holds
 *
 * A lock entry installed from the registry but WITHOUT an `integrity` field is fetched by
 * `name@version` and never checked against a hash pinned in the repo. `npm ci` installs it
 * and exits 0 with no warning (measured). The registry's own HTTPS response still carries an
 * integrity for the bytes it serves, so this is not a live RCE — but the repo-pinned
 * guarantee (byte-for-byte reproducibility, detection of a re-publish or a mirror swap at an
 * EQUAL version) is gone for those entries. This gate freezes the current gap and refuses any
 * NEW one, so the coverage can only grow.
 *
 * ## What is measured, and what it deliberately is NOT
 *
 * A `packages` entry is IN SCOPE when its key is a `node_modules/…` path (a hoisted or nested
 * install), it is not a workspace symlink (`link: true`), and it is not resolved from a local
 * or git source (`file:` / `git+…`, for which no registry integrity exists). An in-scope entry
 * is a GAP when it has no `integrity`. The key is the lock PATH — stable across a version bump
 * that keeps the path, so a routine patch of a dependency does not churn the baseline; a NEW
 * package appearing without integrity does.
 *
 * ⚠️ This gate does NOT claim the residual entries are fixable by a plain re-generation. On
 * this repo, measured 31/08/2026: `npm install` (npm 10.9.8), a clean `rm -rf node_modules &&
 * npm install`, and `npm@11.6.2 install --package-lock-only` ALL leave the exact same set
 * (mostly the `@algolia/*` → docsearch → vitepress DEV subtree). Populating them is a
 * deliberate maintainer step (a full install under the declared `packageManager`, or accepting
 * the dev-toolchain limitation) — this gate's job is to stop the gap GROWING, not to assert it
 * is trivially drainable.
 *
 *   LI-01  an in-scope entry absent from the baseline and lacking `integrity` → ERROR.
 *   LI-02  a baseline entry now carrying `integrity` (or whose path is gone) → ERROR until
 *          tightened (ratchet down via --update-baseline).
 *   LI-03  fewer than 500 in-scope entries found → refuse to conclude (broken/empty lock reads
 *          as a clean repository otherwise).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const LOCK_PATH = path.join(ROOT, "package-lock.json");
const BASELINE_PATH = path.join(__dirname, ".baselines", "lock-integrity.json");
const UPDATE = process.argv.includes("--update-baseline");
const FLOOR = 500;

/** True when the entry is installed from the registry and should therefore carry an integrity. */
function isRegistryEntry(key, meta) {
    if (key === "") return false; // the root project
    if (!key.includes("node_modules/")) return false; // a local workspace package
    if (meta.link === true) return false; // a symlink to a workspace
    if (typeof meta.version !== "string") return false; // not an installed package
    const resolved = meta.resolved;
    if (
        typeof resolved === "string" &&
        (resolved.startsWith("file:") || resolved.startsWith("git+"))
    ) {
        return false; // local or git source — no registry integrity exists for it
    }
    return true;
}

const lock = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
const pkgs = lock.packages || {};

let inScope = 0;
const gaps = [];
for (const [key, meta] of Object.entries(pkgs)) {
    if (!isRegistryEntry(key, meta)) continue;
    inScope++;
    if (!meta.integrity) gaps.push(key);
}
gaps.sort();

console.log(`\x1b[2m── LI — le lock pinne l'intégrité de chaque dépendance de registre ──\x1b[0m`);
console.log(
    `  ${inScope} entrée(s) de registre · ${gaps.length} SANS \`integrity\` (chemin du lock)`
);

if (inScope < FLOOR) {
    console.error(
        `❌ [LI-03] ${inScope} entrées de registre — sous le plancher de ${FLOOR} : lock cassé, refus de conclure.`
    );
    process.exit(1);
}

if (UPDATE) {
    fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
    fs.writeFileSync(
        BASELINE_PATH,
        JSON.stringify(
            {
                _comment:
                    "LI-01/02 — entrées de registre de package-lock.json SANS `integrity`, gelées à la pose. Liste DÉCROISSANTE : peupler l'intégrité (régénération délibérée du lock sous le packageManager déclaré) puis resserrer via --update-baseline. Clé = chemin du lock (stable au patch de version). Le gel ne prouve PAS que le reste est trivialement drainable — mesuré structurel (sous-arbre @algolia/*→docsearch→vitepress, DEV) le 31/08/2026 ; ce que la gate empêche, c'est la CROISSANCE de l'écart.",
                _generated: "node scripts/check-lock-integrity.cjs --update-baseline",
                count: gaps.length,
                entries: gaps,
            },
            null,
            4
        ) + "\n"
    );
    console.log(`\x1b[32m✓\x1b[0m baseline écrite — ${gaps.length} entrée(s).`);
    process.exit(0);
}

if (!fs.existsSync(BASELINE_PATH)) {
    console.error(`❌ [LI] baseline absente — première pose : --update-baseline`);
    process.exit(1);
}
const baseline = new Set(JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")).entries);
const observed = new Set(gaps);
const neuf = gaps.filter((k) => !baseline.has(k));
const gueris = [...baseline].filter((k) => !observed.has(k)).sort();

let failed = false;
if (neuf.length) {
    failed = true;
    console.error(`❌ [LI-01] ${neuf.length} entrée(s) SANS integrity nouvelle(s) :`);
    for (const k of neuf.slice(0, 20)) console.error(`   + ${k}`);
    console.error(`   Régénérer le lock pour pinner l'intégrité — ne pas élargir la baseline.`);
}
if (gueris.length) {
    failed = true;
    console.error(`❌ [LI-02] ${gueris.length} entrée(s) désormais couverte(s) — resserrer :`);
    for (const k of gueris.slice(0, 20)) console.error(`   − ${k}`);
    console.error(`   \x1b[2mnode scripts/check-lock-integrity.cjs --update-baseline\x1b[0m`);
}
if (failed) process.exit(1);
console.log(
    `\x1b[32m✓ LI\x1b[0m — aucune entrée sans integrity nouvelle (${baseline.size} gelée(s)).`
);
