#!/usr/bin/env node
/**
 * Ramène le cache local de Turborepo sous un budget de taille (T4.5).
 *
 * ## Pourquoi un budget, et pas un âge
 *
 * Mesure du 25/07/2026, avant la première purge : **8 779 entrées / 5,13 Gio / 26 320
 * fichiers**, jamais purgées depuis le 16/06 — **68 % du répertoire de travail**. Turbo 2
 * n'expose aucun TTL ni GC de cache local (`turbo prune` extrait un sous-ensemble du
 * monorepo pour Docker, ce n'est pas un purgeur), et `turbo.json` ne déclarait ni
 * `cacheDir` ni limite.
 *
 * Trois politiques ont été mesurées sur ce cache, et deux sont rejetées par les chiffres :
 *
 *   - **âge seul** : 14 jours auraient gardé **4,11 Gio sur 5,13**. Les 5 Go se sont
 *     accumulés en trois semaines — une règle d'âge n'aurait pas évité ce sprint ;
 *   - **nombre d'entrées** : taille médiane d'une entrée **0,07 Mio**, moyenne **0,60 Mio**
 *     — un facteur 8. « Garder N entrées » vaut 10 Mo ou 2 Go selon les tâches qui ont
 *     tourné. Rejeté sur mesure, pas par principe ;
 *   - **budget de taille** : le seul qui borne réellement. C'est le critère PRIMAIRE.
 *
 * L'âge reste **secondaire**, comme filet des semaines calmes : sous budget, plus rien ne
 * s'évince, alors que des entrées froides continuent d'occuper le disque et de référencer
 * un arbre disparu. Témoin : sur un échantillon de 418 manifestes, **168 (40 %)**
 * référencent l'ancien layout `packages/plugin-storage/` (renommé par ARCHI S10 le 20/07).
 * Le hash de tâche inclut le chemin du paquet : ces entrées ne peuvent plus **jamais**
 * faire hit.
 *
 * ## Ce que la politique est, et ce qu'elle n'est pas
 *
 * ⚠️ Turbo **ne rafraîchit pas le `mtime` sur un HIT**. La politique est donc « garder les
 * entrées les plus récemment ÉCRITES », et **pas** un LRU : une entrée touchée tous les
 * jours mais écrite il y a trois semaines peut être évincée. Le coût est une
 * re-exécution de tâche, qui la réécrit — c'est auto-réparant. Toucher les `mtime`
 * nous-mêmes détruirait le seul signal d'âge disponible.
 *
 * ## Délibérément hors de `ci:local`
 *
 * Trois raisons, dont deux catégoriques :
 *   1. le cache EST ce qui rend tenables `turbo run build`, `typecheck` et les 34 tâches
 *      de test. Un purgeur en tête de séquence garantit le miss sur ce qu'il vient
 *      d'évincer : il ferait payer deux fois la mesure et n'assérerait rien ;
 *   2. erreur de catégorie — `ci:local` est une suite de gates qui rendent vrai/faux sur
 *      le CODE. Une purge ne peut pas échouer utilement, et ce serait la seule étape de
 *      la liste à MUTER l'état de la machine du développeur ;
 *   3. `ci-local.cjs` pose `ci:local ⊇ ci.yml` comme raison d'être, et `ci.yml` n'a
 *      aucune étape de purge.
 *
 * La cadence vit dans `_docs_projet/HYGIENE_CHECKLIST.md`, en fin de sprint.
 *
 * Usage :
 *   node scripts/purge-turbo-cache.cjs                  # ramène sous le budget
 *   node scripts/purge-turbo-cache.cjs --dry-run        # calcule, ne supprime rien
 *   node scripts/purge-turbo-cache.cjs --check          # verdict seul, exit 1 si hors budget
 *   node scripts/purge-turbo-cache.cjs --max-size 3     # budget en Gio (0 = tout vider)
 *   node scripts/purge-turbo-cache.cjs --max-age 30     # âge en jours
 *   node scripts/purge-turbo-cache.cjs --cache-dir <p>  # miroir du flag turbo
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

/** Budget PRIMAIRE, en Gio. `0` vide tout — pas de mode `--reset` de plus. */
const MAX_SIZE_GIB = numericFlag("--max-size", 2);
/** Filet SECONDAIRE, en jours. */
const MAX_AGE_DAYS = numericFlag("--max-age", 14);

// ─── Résolution du répertoire de cache ───────────────────────────────────────

/**
 * Dans l'ordre de turbo lui-même, jamais en dur.
 *
 * `turbo.json#cacheDir` est absent aujourd'hui : le lire coûte trois lignes et empêche de
 * purger le mauvais endroit le jour où quelqu'un l'ajoute — c'est exactement la classe
 * « un chemin en dur cesse silencieusement de matcher » que ce dépôt traque.
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
            // turbo.json autorise les commentaires (JSONC) — on ne parse que pour `cacheDir`,
            // donc une extraction ciblée vaut mieux qu'un JSON.parse qui jetterait dessus.
            const m = fs.readFileSync(turboJson, "utf8").match(/"cacheDir"\s*:\s*"([^"]+)"/);
            if (m) return { abs: path.resolve(ROOT, m[1]), source: "turbo.json#cacheDir" };
        } catch {
            /* illisible → on retombe sur le défaut, qui est annoncé */
        }
    }
    return { abs: path.join(ROOT, ".turbo", "cache"), source: "défaut turbo 2" };
}

const { abs: CACHE_DIR, source: CACHE_SOURCE } = resolveCacheDir();
const shownDir = path.relative(ROOT, CACHE_DIR) || CACHE_DIR;

// G1 — la cible doit être DANS le dépôt. Un `rmSync` de masse sur un chemin résolu hors
// ROOT est précisément le risque que T5.1 documente sur `deploy-docs.cjs` et ses quatre
// `..` en dur. On échoue plutôt que de deviner.
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
    // Jamais un exit 0 muet : dire QUOI a été cherché et OÙ, sinon « rien à purger » est
    // indiscernable de « j'ai regardé au mauvais endroit ».
    console.log(`ℹ purge-turbo-cache — ${shownDir} n'existe pas (source : ${CACHE_SOURCE}).`);
    console.log("  Rien à purger. Si `cacheDir` est posé dans la config GLOBALE de turbo,");
    console.log("  passer explicitement --cache-dir <chemin>.");
    process.exit(0);
}

// ─── Inventaire ──────────────────────────────────────────────────────────────

/** `<hash>-manifest.json`, `<hash>-meta.json`, `<hash>.tar.zst` — le schéma de turbo 2. */
const ENTRY_RE = /^([0-9a-f]+)(-manifest\.json|-meta\.json|\.tar\.zst)$/;

/** Ordre de suppression dans un groupe : la charge d'abord. */
const SUFFIX_ORDER = [".tar.zst", "-manifest.json", "-meta.json"];

const dirents = fs.readdirSync(CACHE_DIR, { withFileTypes: true });

// G2 — le cache de turbo est PLAT (mesuré : 0 sous-répertoire pour 26 320 fichiers). Un
// sous-répertoire signifie « ce n'est pas un cache turbo » — on s'arrête sans rien toucher
// plutôt que de descendre dans un arbre dont on ignore la nature.
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
/** G3 — jamais supprimés : comptés et nommés. */
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

// Du plus récent au plus ancien : on garde par la tête jusqu'au budget.
const sorted = [...groups.entries()].sort((a, b) => b[1].mtime - a[1].mtime);

const doomed = [];
let kept = 0;
let keptSize = 0;
let oldestKeptDays = 0;
let byAge = { n: 0, size: 0 };
let byBudget = { n: 0, size: 0 };

for (const [hash, g] of sorted) {
    const tooOld = NOW - g.mtime > MAX_AGE_MS;
    const overBudget = keptSize + g.size > MAX_SIZE;
    if (tooOld || overBudget) {
        doomed.push({ hash, ...g });
        // Attribution du motif : l'âge est annoncé comme secondaire, donc il prime dans le
        // rapport quand les deux s'appliquent — sinon le budget masquerait son utilité.
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
    // La charge d'abord : un état déchiré ne présente jamais un manifeste qui promet une
    // archive disparue.
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
