#!/usr/bin/env node
/*!
 * GeoLeaf — Inter-package version coherence checker
 * © 2026 Mattieu Pottier — MIT
 *
 * Clarifies the monorepo-2.0.0 / core-3.0.0 version divergence.
 *
 * POLICY (cf. ARCHITECTURE.md §Versioning): versioning is INDEPENDENT per published
 * package (each `package.json` is its own source of truth, injected at build
 * through `__GEOLEAF_VERSION__`). The monorepo root's version is `private:true` —
 * a mere orchestration identifier, NOT significant and NOT published. There is
 * thus deliberately NO root ↔ packages version alignment.
 *
 * This script changes no version: it VERIFIES real invariants and flags
 * incoherences (exit 1):
 *   1. every `package.json` has a valid semver `version`;
 *   2. the root really is `private:true` (orchestrator — version out of scope);
 *   3. every internal dependency (`@geoleaf/*` / `@geoleaf-plugins/*`) points at an
 *      existing workspace;
 *   4. an UNPUBLISHED internal package (`private:true`, e.g.
 *      `@geoleaf/http-helpers`) is never declared in
 *      `dependencies`/`peerDependencies` of another package — only in
 *      `devDependencies` (it is bundled inline; otherwise the published
 *      consumer's `npm install` would break);
 *   5. every internal range declared in an EXECUTION position (`dependencies` /
 *      `peerDependencies`) is BOUNDED and SATISFIED by the target workspace's
 *      version.
 *
 * ## Why check 5 exists, and why it only looks at execution
 *
 * In the monorepo, npm resolves `@geoleaf/core` by the workspace: any range
 * "works", `"*"` included. **At the integrator's, there is no workspace** — the
 * range goes to the registry, and `"*"` there designates the published `latest`.
 * Measured on 2026-08-09: `latest` for `@geoleaf/core` is **2.1.8**, one MAJOR
 * behind the 3.0.0 the 12 plugins really require. The 12 tarballs would thus have
 * installed an incompatible core **without any gate of the repo able to see it**,
 * since everything is green locally.
 *
 * The check is bounded to `dependencies`/`peerDependencies` because those are the
 * only ones a consumer's `npm install` reproduces. Internal `devDependencies`
 * (`build-config`, `host-runtime`) stay at `"*"` **on purpose**: they target
 * `private` workspaces, ship in no tarball, and check 4 already forbids them the
 * execution position.
 *
 * 🔗 **What check 4 does NOT cover is written once**, in the header of
 * `check-shipped-specifiers.cjs` — gate **`SHIP-SPEC`** (§ "THE TARBALL GATES'
 * OVERLAP"): it reads dependency maps, **never the `.d.ts`**. A green
 * here says nothing of what the emitted code imports.
 *
 * 📌 **The `SHIP-SPEC` code is named here ON PURPOSE, in addition to the file
 * name.** The pointer already existed and said the right split, but it cited only
 * the *file*: a reader — or a `grep` — starting from the **gate code** did not
 * find it. ⚠️ That was the half really missing, and its closure criterion
 * (`grep -c 'SHIP-SPEC'` → 0) measured it without saying so: it returned `0` on a
 * coverage **already written**. A criterion searching for a pattern other than the
 * one set renders "absent" what is only named differently.
 *
 * ⚠️ A range whose FORM is not understood is an ERROR, never a silent pass (same
 * pattern as `lib/packages.cjs`). A checker that ignores what it cannot read goes
 * green having verified nothing — the failure mode this file exists to kill.
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

// Workspaces come from the registry, which reads the same globs npm
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
// ⚠️ The range is read on `runtime[dep]`, NOT on the `all` entry: the
// `{...deps, ...peerDeps, ...devDeps}` merge lets the devDependency win when one
// package is declared on both sides, and check 5 would then have judged a
// development range believing it judged the one shipping in the tarball.
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
        if (declared === undefined) continue; // devDependency only — out of scope, cf. docblock
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

// Anti-empty-gate assertion: a check 5 that compares NOTHING would go green having
// verified nothing — the exact failure mode `packages.cjs` documents. Every published
// plugin declares `@geoleaf/core` in `peerDependencies` (moved from `dependencies` on 25/08/2026 so
// that a version conflict fails loudly at install instead of silently installing two copies
// of the core), so the floor cannot be zero.
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
