#!/usr/bin/env node
/**
 * Brings Turborepo's local cache under a size budget.
 *
 * ## Why a budget, and not an age
 *
 * 2026-07-25 measurement, before the first purge: **8,779 entries / 5.13 GiB /
 * 26,320 files**, never purged since 06-16 — **68 % of the working directory**.
 * Turbo 2 exposes no TTL nor local-cache GC (`turbo prune` extracts a monorepo
 * subset for Docker, it is no purger), and `turbo.json` declared neither `cacheDir`
 * nor a limit.
 *
 * Three policies were measured on this cache, and two are rejected by the numbers:
 *
 *   - **age alone**: 14 days would have kept **4.11 GiB of 5.13**. The 5 GB
 *     accumulated in three weeks — an age rule would not have avoided that work;
 *   - **entry count**: median entry size **0.07 MiB**, mean **0.60 MiB** — a factor
 *     of 8. "Keep N entries" is worth 10 MB or 2 GB depending on which tasks ran.
 *     Rejected on measurement, not principle;
 *   - **size budget**: the only one that really bounds. It is the PRIMARY criterion.
 *
 * Age stays **secondary**, as the quiet weeks' net: under budget, nothing evicts
 * anymore, while cold entries keep occupying the disk and referencing a vanished
 * tree. Witness: on a 418-manifest sample, **168 (40 %)** reference the old
 * `packages/plugin-storage/` layout (renamed on 07-20). The task hash includes the
 * package path: those entries can **never** hit again.
 *
 * ## What the policy is, and what it is not
 *
 * ⚠️ Turbo **does not refresh the `mtime` on a HIT**. The policy is therefore "keep
 * the most recently WRITTEN entries", and **not** an LRU: an entry touched daily but
 * written three weeks ago can be evicted. The cost is a task re-execution, which
 * rewrites it — self-repairing. Touching the `mtime`s ourselves would destroy the
 * only age signal available.
 *
 * ## Deliberately outside `ci:local`
 *
 * Three reasons, two of them categorical:
 *   1. the cache IS what makes `turbo run build`, `typecheck` and the 34 test tasks
 *      tenable. A purger at the head of the sequence guarantees a miss on what it
 *      just evicted: it would make the measurement pay twice and would assert
 *      nothing;
 *   2. category error — `ci:local` is a suite of gates rendering true/false on the
 *      CODE. A purge cannot fail usefully, and it would be the list's only step to
 *      MUTATE the developer machine's state;
 *   3. `ci-local.cjs` sets `ci:local ⊇ ci.yml` as its reason to exist, and `ci.yml`
 *      has no purge step.
 *
 * The cadence lives in `_docs_projet/HYGIENE_CHECKLIST.md`, at sprint end.
 *
 * Usage:
 *   node scripts/purge-turbo-cache.cjs                  # brings under budget
 *   node scripts/purge-turbo-cache.cjs --dry-run        # computes, deletes nothing
 *   node scripts/purge-turbo-cache.cjs --check          # verdict only, exit 1 if over
 *   node scripts/purge-turbo-cache.cjs --max-size 3     # budget in GiB (0 = wipe all)
 *   node scripts/purge-turbo-cache.cjs --max-age 30     # age in days
 *   node scripts/purge-turbo-cache.cjs --cache-dir <p>  # mirror of the turbo flag
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

// ─── Arguments ───────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const CHECK_ONLY = argv.includes("--check");

function flagValue(name) {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

function numericFlag(name, fallback) {
    const raw = flagValue(name);
    if (raw === null) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
        console.error(`✘ ${name} attend un nombre ≥ 0, reçu « ${raw} »`);
        process.exit(1);
    }
    return n;
}

/** PRIMARY budget, in GiB. `0` wipes everything — no extra `--reset` mode. */
const MAX_SIZE_GIB = numericFlag("--max-size", 2);
/** Filet SECONDAIRE, en jours. */
const MAX_AGE_DAYS = numericFlag("--max-age", 14);

// ─── Cache directory resolution ──────────────────────────────────────────────

/**
 * In turbo's own order, never hard-coded.
 *
 * `turbo.json#cacheDir` is absent today: reading it costs three lines and prevents
 * purging the wrong place the day someone adds it — exactly the "a hard-coded path
 * silently stops matching" class this repo hunts.
 */
function resolveCacheDir() {
    const fromFlag = flagValue("--cache-dir");
    if (fromFlag) return { abs: path.resolve(ROOT, fromFlag), source: "--cache-dir" };
    if (process.env.TURBO_CACHE_DIR) {
        return { abs: path.resolve(ROOT, process.env.TURBO_CACHE_DIR), source: "TURBO_CACHE_DIR" };
    }
    const turboJson = path.join(ROOT, "turbo.json");
    if (fs.existsSync(turboJson)) {
        try {
            // turbo.json allows comments (JSONC) — we only parse for `cacheDir`, so a
            // targeted extraction beats a JSON.parse that would throw on it.
            const m = fs.readFileSync(turboJson, "utf8").match(/"cacheDir"\s*:\s*"([^"]+)"/);
            if (m) return { abs: path.resolve(ROOT, m[1]), source: "turbo.json#cacheDir" };
        } catch {
            /* unreadable → fall back to the default, which is announced */
        }
    }
    return { abs: path.join(ROOT, ".turbo", "cache"), source: "défaut turbo 2" };
}

const { abs: CACHE_DIR, source: CACHE_SOURCE } = resolveCacheDir();
const shownDir = path.relative(ROOT, CACHE_DIR) || CACHE_DIR;

// G1 — the target must be INSIDE the repo. A mass `rmSync` on a path resolved
// outside ROOT is precisely the documented risk on `deploy-docs.cjs` and its four
// hard-coded `..`. We fail rather than guess.
const rel = path.relative(ROOT, CACHE_DIR);
if (rel.startsWith("..") || path.isAbsolute(rel)) {
    console.error(
        `✘ purge-turbo-cache : « ${CACHE_DIR} » est hors du dépôt (source : ${CACHE_SOURCE}).`
    );
    console.error(
        "  Ce script supprime en masse : il refuse toute cible qu'il ne peut pas circonscrire."
    );
    process.exit(1);
}

if (!fs.existsSync(CACHE_DIR)) {
    // Never a mute exit 0: say WHAT was looked for and WHERE, otherwise "nothing to
    // purge" is indistinguishable from "I looked in the wrong place".
    console.log(`ℹ purge-turbo-cache — ${shownDir} n'existe pas (source : ${CACHE_SOURCE}).`);
    console.log("  Rien à purger. Si `cacheDir` est posé dans la config GLOBALE de turbo,");
    console.log("  passer explicitement --cache-dir <chemin>.");
    process.exit(0);
}

// ─── Inventaire ──────────────────────────────────────────────────────────────

/** `<hash>-manifest.json`, `<hash>-meta.json`, `<hash>.tar.zst` — turbo 2's schema. */
const ENTRY_RE = /^([0-9a-f]+)(-manifest\.json|-meta\.json|\.tar\.zst)$/;

/** Deletion order within a group: the payload first. */
const SUFFIX_ORDER = [".tar.zst", "-manifest.json", "-meta.json"];

const dirents = fs.readdirSync(CACHE_DIR, { withFileTypes: true });

// G2 — turbo's cache is FLAT (measured: 0 subdirectories for 26,320 files). A
// subdirectory means "this is not a turbo cache" — we stop touching nothing rather
// than descend into a tree whose nature we ignore.
const subdirs = dirents.filter((e) => e.isDirectory()).map((e) => e.name);
if (subdirs.length > 0) {
    console.error(
        `✘ purge-turbo-cache : ${shownDir} contient ${subdirs.length} sous-répertoire(s).`
    );
    console.error(`  Ex. : ${subdirs.slice(0, 3).join(", ")}`);
    console.error("  Le cache de turbo 2 est PLAT. Rien n'a été supprimé — vérifier --cache-dir.");
    process.exit(1);
}

/** @type {Map<string, {size: number, mtime: number, names: string[]}>} */
const groups = new Map();
/** G3 — never deleted: counted and named. */
const unknown = [];

for (const e of dirents) {
    if (!e.isFile()) continue;
    const m = e.name.match(ENTRY_RE);
    if (!m) {
        unknown.push(e.name);
        continue;
    }
    const st = fs.statSync(path.join(CACHE_DIR, e.name));
    const g = groups.get(m[1]) ?? { size: 0, mtime: 0, names: [] };
    g.size += st.size;
    g.mtime = Math.max(g.mtime, st.mtimeMs);
    g.names.push(e.name);
    groups.set(m[1], g);
}

// ─── Politique ───────────────────────────────────────────────────────────────

const NOW = Date.now();
const MAX_SIZE = MAX_SIZE_GIB * 1024 ** 3;
const MAX_AGE_MS = MAX_AGE_DAYS * 86400000;

// Newest to oldest: we keep from the head down to the budget.
const sorted = [...groups.entries()].sort((a, b) => b[1].mtime - a[1].mtime);

const doomed = [];
let kept = 0;
let keptSize = 0;
let oldestKeptDays = 0;
const byAge = { n: 0, size: 0 };
const byBudget = { n: 0, size: 0 };

for (const [hash, g] of sorted) {
    const tooOld = NOW - g.mtime > MAX_AGE_MS;
    const overBudget = keptSize + g.size > MAX_SIZE;
    if (tooOld || overBudget) {
        doomed.push({ hash, ...g });
        // Reason attribution: age is announced as secondary, so it wins in the
        // report when both apply — otherwise the budget would mask its usefulness.
        if (tooOld) {
            byAge.n++;
            byAge.size += g.size;
        } else {
            byBudget.n++;
            byBudget.size += g.size;
        }
    } else {
        kept++;
        keptSize += g.size;
        oldestKeptDays = (NOW - g.mtime) / 86400000;
    }
}

const totalSize = keptSize + doomed.reduce((a, d) => a + d.size, 0);
const freed = doomed.reduce((a, d) => a + d.size, 0);

// ─── Rapport ─────────────────────────────────────────────────────────────────

const gib = (b) => `${(b / 1024 ** 3).toFixed(2)} Gio`;
const n = (v) => v.toLocaleString("fr-FR");

console.log(`ℹ purge-turbo-cache — ${shownDir}  (source : ${CACHE_SOURCE})`);
console.log(
    `  avant      : ${n(groups.size)} entrées · ${gib(totalSize)}  ` +
        `(${n(dirents.length)} fichiers, ${unknown.length} non reconnu${unknown.length === 1 ? "" : "s"})`
);
console.log(
    `  politique  : budget ${MAX_SIZE_GIB.toFixed(2)} Gio (primaire) · âge > ${MAX_AGE_DAYS} j (secondaire)`
);
console.log();
console.log(`  par âge    : ${n(byAge.n)} entrées · ${gib(byAge.size)}   (> ${MAX_AGE_DAYS} j)`);
console.log(
    `  par budget : ${n(byBudget.n)} entrées · ${gib(byBudget.size)}   (au-delà des ${MAX_SIZE_GIB.toFixed(2)} Gio les plus récents)`
);
console.log("  " + "─".repeat(45));
console.log(
    `  ${CHECK_ONLY || DRY_RUN ? "à supprimer" : "supprimé  "} : ${n(doomed.length)} entrées · ${gib(freed)}   ← libéré`
);
console.log(
    `  restant    : ${n(kept)} entrées · ${gib(keptSize)}` +
        (kept > 0 ? `   (la plus ancienne : ${oldestKeptDays.toFixed(1)} j)` : "")
);

if (unknown.length > 0) {
    console.log();
    console.log(`  ⚠️ ${unknown.length} fichier(s) hors du schéma turbo — JAMAIS supprimés :`);
    for (const name of unknown.slice(0, 10)) console.log(`      ${name}`);
    if (unknown.length > 10) console.log(`      … et ${unknown.length - 10} autre(s)`);
    console.log(
        "      Si le format de cache de turbo a changé, c'est ce script qu'il faut relire."
    );
}

console.log();

if (CHECK_ONLY) {
    if (freed > 0) {
        console.log(`✘ hors budget de ${gib(freed)} — lancer : npm run cache:purge`);
        process.exit(1);
    }
    console.log("✅ cache sous budget.");
    process.exit(0);
}

if (DRY_RUN) {
    console.log("⚠️ dry-run — rien supprimé.");
    process.exit(0);
}

// ─── Suppression ─────────────────────────────────────────────────────────────

let removed = 0;
for (const d of doomed) {
    // The payload first: a torn state never presents a manifest promising a
    // vanished archive.
    const ordered = [...d.names].sort(
        (a, b) =>
            SUFFIX_ORDER.findIndex((s) => a.endsWith(s)) -
            SUFFIX_ORDER.findIndex((s) => b.endsWith(s))
    );
    for (const name of ordered) {
        try {
            fs.rmSync(path.join(CACHE_DIR, name), { force: true });
            removed++;
        } catch (err) {
            console.error(`  ⚠️ ${name} — ${err.message}`);
        }
    }
}

console.log(`✅ ${n(removed)} fichier(s) supprimé(s), ${gib(freed)} libéré(s).`);
console.log("   Le cache est régénérable par définition : le coût est une re-exécution de tâche.");
process.exit(0);
