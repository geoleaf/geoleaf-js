#!/usr/bin/env node
/*!
 * GeoLeaf — Vérificateur de cohérence des versions inter-packages
 * © 2026 Mattieu Pottier — MIT
 *
 * Archi backlog B.1 — « clarifier la divergence de version monorepo 2.0.0 / core 3.0.0 ».
 *
 * POLITIQUE (cf. ARCHITECTURE.md §Versioning) : le versioning est INDÉPENDANT par
 * package publié (chaque `package.json` est sa propre source de vérité, injectée au
 * build via `__GEOLEAF_VERSION__`). La version de la racine du monorepo est
 * `private:true` — un simple identifiant d'orchestration, NON significatif et NON
 * publié. Il n'y a donc volontairement AUCUN alignement de version racine ↔ packages.
 *
 * Ce script ne change aucune version : il VÉRIFIE des invariants réels et signale les
 * incohérences (exit 1) :
 *   1. chaque `package.json` a une `version` semver valide ;
 *   2. la racine est bien `private:true` (orchestrateur — version hors-scope) ;
 *   3. toute dépendance interne (`@geoleaf/*` / `@geoleaf-plugins/*`) pointe vers un
 *      workspace existant ;
 *   4. un package interne NON publié (`private:true`, ex. `@geoleaf/http-helpers`)
 *      n'est jamais déclaré en `dependencies`/`peerDependencies` d'un autre package —
 *      uniquement en `devDependencies` (il est bundlé inline ; sinon `npm install`
 *      du consommateur publié casserait — piège S6) ;
 *   5. toute plage interne déclarée en position D'EXÉCUTION (`dependencies` /
 *      `peerDependencies`) est BORNÉE et SATISFAITE par la version du workspace cible.
 *
 * ## Pourquoi le check 5 existe, et pourquoi il ne regarde QUE l'exécution
 *
 * Dans le monorepo, npm résout `@geoleaf/core` par le workspace : n'importe quelle plage
 * « marche », y compris `"*"`. **Chez l'intégrateur, il n'y a pas de workspace** — la plage
 * part au registre, et `"*"` y désigne le `latest` publié. Mesuré le 09/08/2026 : `latest`
 * pour `@geoleaf/core` est **2.1.8**, soit un MAJEUR en arrière du 3.0.0 que les 12 plugins
 * exigent réellement. Les 12 tarballs auraient donc installé un core incompatible **sans
 * qu'aucune gate du dépôt ne puisse le voir**, puisque tout est vert en local.
 *
 * Le check est borné aux `dependencies`/`peerDependencies` parce que ce sont les seules que
 * `npm install` d'un consommateur reproduit. Les `devDependencies` internes (`build-config`,
 * `host-runtime`) restent en `"*"` **à dessein** : elles visent des workspaces `private`, ne
 * partent dans aucun tarball, et le check 4 leur interdit déjà la position d'exécution.
 *
 * 🔗 **Ce que le check 4 NE couvre PAS est écrit une seule fois**, dans l'en-tête de
 * `check-shipped-specifiers.cjs` (§ « Le recouvrement des gates du tarball », B-87/B-232) :
 * il lit des cartes de dépendances, **jamais les `.d.ts`**. Un vert d'ici ne dit rien de ce
 * que le code émis importe.
 *
 * ⚠️ Une plage dont la FORME n'est pas comprise est une ERREUR, jamais un passage silencieux
 * (même patron que `lib/packages.cjs`). Un vérificateur qui ignore ce qu'il ne sait pas lire
 * sort vert en n'ayant rien vérifié — c'est le mode d'échec que ce fichier existe pour tuer.
 *
 * Usage : node scripts/check-versions.cjs
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PKG_DIR = path.join(ROOT, "packages");

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const INTERNAL_SCOPES = ["@geoleaf/", "@geoleaf-plugins/"];

/** Plain `X.Y.Z`, optionally prefixed by one of the operators check 5 understands. */
const RANGE = /^(\^|~|>=|=)?(\d+)\.(\d+)\.(\d+)$/;

/** Ranges that resolve to the registry's `latest` once outside the monorepo. */
const UNBOUNDED = new Set(["*", "x", "X", "", "latest", ">=0.0.0"]);

const errors = [];
const notes = [];

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
}

function isInternal(name) {
    return INTERNAL_SCOPES.some((s) => name.startsWith(s));
}

/**
 * Does `range` admit `version`? (Check 5 — internal runtime ranges only.)
 *
 * Deliberately implements only the four operators this monorepo declares — `^`, `~`, `>=`
 * and an exact pin — and reports anything else as UNSUPPORTED rather than guessing. The
 * repo has exactly three internal range shapes today (`*`, `^3.0.0`, `^1.0.0`), so a
 * hand-rolled comparison is both sufficient and auditable; pulling `semver` in would mean
 * depending on a package no manifest here declares, resolved only by hoisting — the very
 * "a chance, not a contract" shape this repo refuses elsewhere.
 *
 * @param {string} range Declared range, e.g. "^3.0.0".
 * @param {string} version Target workspace version, e.g. "3.0.0".
 * @returns {{ok: true} | {ok: false, why: string}} Verdict, with a reason when it fails.
 */
function rangeAdmits(range, version) {
    if (UNBOUNDED.has(range.trim())) {
        return {
            ok: false,
            why: "plage NON BORNÉE — hors monorepo elle vise le `latest` du registre",
        };
    }
    const m = RANGE.exec(range.trim());
    if (!m) {
        return {
            ok: false,
            why: "forme de plage NON SUPPORTÉE par le check 5 (^, ~, >=, ou pin exact)",
        };
    }
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
        return {
            ok: false,
            why: `version cible « ${version} » non comparable (préversion ou métadonnée)`,
        };
    }

    const [op = "=", rMaj, rMin, rPatch] = [m[1], +m[2], +m[3], +m[4]];
    const [vMaj, vMin, vPatch] = version.split(".").map(Number);

    const cmp = (a, b, c) => (vMaj - a) * 1e12 + (vMin - b) * 1e6 + (vPatch - c);
    const atLeast = cmp(rMaj, rMin, rPatch) >= 0;

    let ok;
    if (op === "=") ok = cmp(rMaj, rMin, rPatch) === 0;
    else if (op === ">=") ok = atLeast;
    else if (op === "~") ok = atLeast && vMaj === rMaj && vMin === rMin;
    else if (rMaj > 0)
        ok = atLeast && vMaj === rMaj; // ^3.0.0 → >=3.0.0 <4.0.0
    else if (rMin > 0)
        ok = atLeast && vMaj === 0 && vMin === rMin; // ^0.2.3 → <0.3.0
    else ok = cmp(rMaj, rMin, rPatch) === 0; // ^0.0.3 → exactly 0.0.3

    return ok
        ? { ok: true }
        : { ok: false, why: `la version cible ${version} ne la satisfait pas` };
}

// ─── Collect workspaces (root + packages/*, excluding _templates) ───────────────
const rootPkg = readJson(path.join(ROOT, "package.json"));

// ARCHI S9.5 — workspaces come from the registry, which reads the same globs npm
// obeys. The previous one-level `readdirSync(packages/)` would, after ARCHI S10
// nests packages, find no package.json at that level and compare ZERO versions —
// exiting 0 on an empty set rather than reporting the drift it exists to catch.
const workspaces = []; // { name, version, private, file, deps, devDeps, peerDeps }
for (const entry of require("./lib/packages.cjs").all()) {
    const file = path.join(entry.absDir, "package.json");
    const pkg = readJson(file);
    workspaces.push({
        name: pkg.name,
        version: pkg.version,
        private: pkg.private === true,
        file: path.relative(ROOT, file),
        deps: pkg.dependencies || {},
        devDeps: pkg.devDependencies || {},
        peerDeps: pkg.peerDependencies || {},
    });
}

const byName = new Map(workspaces.map((w) => [w.name, w]));

// ─── Check 1 — valid semver on every package ────────────────────────────────────
if (!SEMVER.test(rootPkg.version || "")) {
    errors.push(`Racine: version invalide « ${rootPkg.version} » (semver attendu).`);
}
for (const w of workspaces) {
    if (!SEMVER.test(w.version || "")) {
        errors.push(`${w.name}: version invalide « ${w.version} » (${w.file}).`);
    }
}

// ─── Check 2 — root is private orchestrator (version not significant) ────────────
if (rootPkg.private !== true) {
    errors.push("Racine: doit être `private:true` (orchestrateur monorepo non publié).");
} else {
    notes.push(
        `Racine ${rootPkg.version} — orchestrateur \`private\`, version NON significative ` +
            "(politique : versioning indépendant par package). Hors comparaison."
    );
}

// ─── Checks 3, 4 & 5 — internal deps resolve, private-never-runtime, range bounded ──
//
let runtimeRangesChecked = 0;
// ⚠️ La plage se lit sur `runtime[dep]`, PAS sur l'entrée de `all` : la fusion
// `{...deps, ...peerDeps, ...devDeps}` laisse gagner la devDependency quand un même
// paquet est déclaré des deux côtés, et le check 5 aurait alors jugé une plage de
// développement en croyant juger celle qui part dans le tarball.
for (const w of workspaces) {
    const runtime = { ...w.deps, ...w.peerDeps }; // published surface
    const all = { ...w.deps, ...w.peerDeps, ...w.devDeps };
    for (const dep of Object.keys(all)) {
        if (!isInternal(dep)) continue;
        const target = byName.get(dep);
        if (!target) {
            errors.push(
                `${w.name}: dépendance interne « ${dep} » → aucun workspace correspondant.`
            );
            continue;
        }
        // Check 4 — a private (unpublished) internal package must be a devDependency only.
        if (target.private && runtime[dep] !== undefined) {
            errors.push(
                `${w.name}: « ${dep} » est \`private\` (non publié) mais déclaré en ` +
                    "dependencies/peerDependencies — doit être en devDependencies (bundlé inline). " +
                    "Sinon `npm install` du consommateur publié échoue (piège S6)."
            );
        }
        // Check 5 — an internal range in RUNTIME position must be bounded and satisfied.
        const declared = runtime[dep];
        if (declared === undefined) continue; // devDependency only — hors périmètre, cf. docblock
        runtimeRangesChecked++;
        const verdict = rangeAdmits(String(declared), String(target.version));
        if (!verdict.ok) {
            errors.push(
                `${w.name}: « ${dep}: "${declared}" » en dependencies/peerDependencies — ` +
                    `${verdict.why}. Le workspace ${dep} est en ${target.version} ; ` +
                    "écrire une plage bornée qui le satisfait (ex. `^" +
                    `${target.version}\`). Hors monorepo, la plage part au registre.`
            );
        }
    }
}

// ─── Report ─────────────────────────────────────────────────────────────────────
console.log("── 🔖 Cohérence des versions (politique : indépendante par package) ──\n");
for (const w of [...workspaces].sort((a, b) => a.name.localeCompare(b.name))) {
    const tag = w.private ? " (private)" : "";
    console.log(`  ${w.name}@${w.version}${tag}`);
}
console.log("");
for (const n of notes) console.log(`ℹ  ${n}`);
console.log("");

// Assertion anti-gate-vide : un check 5 qui ne compare RIEN sortirait vert en n'ayant rien
// vérifié — le mode d'échec exact que `packages.cjs` documente. Les 12 plugins déclarent au
// moins `@geoleaf/core` en `dependencies`, donc le plancher ne peut pas être nul.
if (runtimeRangesChecked === 0) {
    errors.push(
        "Check 5: AUCUNE plage interne d'exécution n'a été comparée. Le monorepo en compte " +
            "au moins une par plugin publié — zéro signifie que le check ne voit plus son corpus, " +
            "pas que le corpus est propre."
    );
}

if (errors.length) {
    console.error(`✖ ${errors.length} incohérence(s) de version :`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
}
console.log(
    "✓ Versions cohérentes (semver valide, deps internes résolues, aucun piège private-dep, " +
        `${runtimeRangesChecked} plage(s) interne(s) d'exécution bornée(s) et satisfaite(s)).`
);
