#!/usr/bin/env node
/**
 * GUARD-CACHE — a guard whose SUBJECT is outside its package must run UNCACHED.
 *
 * 🛑 THE CLASS, AND WHY IT IS SILENT. The `test` task's `inputs` (turbo.json) are
 * all package-relative: `src/**`, `__tests__/**`, `vitest.config.ts`… Yet a
 * guard's subject is by nature ELSEWHERE — it reads `_docs_projet/`,
 * `docs/specs/`, `profiles/`, `apps/geoleaf-app/`, a plugin's `entry.ts`. The
 * guard's file thus invalidates the cache; WHAT IT GUARDS does not.
 *
 * ⚠️ The error's direction is what makes the class costly: a task that does not
 * run does not render "unknown", it renders **GREEN**. And on this repo, that
 * green is the oracle that authorises a push. Measured on 2026-08-20:
 * `journal-numbering.guard.test.ts` stayed green over THREE consecutive
 * `ci:local` while the JOURNAL sat at 16 entries for a ceiling of 15 — it only
 * reddened at the fourth run, the one where `packages/core/src/` had moved.
 * Editing a doc, a profile or a plugin without touching the core is a session's
 * most common case, and it was exactly the one that woke nothing.
 *
 * ## What this probe verifies
 *
 *   GC-01  Every guard whose subject is outside the package belongs to a package
 *          declaring `test:guards` — the uncached task that runs it at every run.
 *   GC-02  `test:guards` carries `cache: false` in `turbo.json`. Without that the
 *          remedy is silently undone, and the class returns with no line moving.
 *   GC-03  `ci:local` really launches the task. A correct task nobody calls
 *          guards nothing.
 *
 * ⚠️ It does NOT judge guards whose subject is inside the package: their cache is
 * correct, and running them uncached would cost without buying. The distinction is
 * measured, not assumed — hence the pattern below, taken from the original
 * measurement.
 *
 * 📌 The deposit measured on 2026-08-20 was 21 guards of 24 in
 * `packages/core/__tests__/guards/`. Instrumenting it, the real count proved
 * wider: **26 of 35** repo-wide — five guards live outside that directory, two of
 * them in plugins. The first reading had looked at a single folder.
 *
 * Usage: node scripts/verify-guards-uncached.cjs
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const registry = require("./lib/packages.cjs");

const ROOT = path.resolve(__dirname, "..");

/**
 * A path cited by a guard that leaves its package. Taken word for word from the
 * original re-measurement, so this probe's count and the register's stay
 * comparable.
 */
const OUT_OF_PACKAGE =
    /_docs_projet|\bdocs\/|\bprofiles\/|\bscripts\/|\bapps\/|packages\/(plugins|libs)|\.\.\/\.\.\/\.\.\/\.\.|repoRoot/;

/** Anti-empty-gate floor: this repo carries dozens, zero means a broken scan. */
const FLOOR = 20;

const errors = [];
const notes = [];

/** All of a directory's `*.guard.test.*`, recursively. */
function collectGuards(dir, out) {
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === "node_modules" || e.name === "dist") continue;
            collectGuards(p, out);
        } else if (/\.guard\.test\.[cm]?[jt]s$/.test(e.name)) {
            out.push(p);
        }
    }
    return out;
}

// ── The corpus: every guard of every package ─────────────────────────────────────────────────

const packages = registry.all();
const guards = [];
for (const pkg of packages) {
    for (const sub of ["__tests__", "src/__tests__"]) {
        collectGuards(path.join(pkg.absDir, sub), guards);
    }
}

if (guards.length < FLOOR) {
    console.error(
        `\n❌ [GUARD-CACHE] ${guards.length} garde(s) trouvée(s) pour un plancher de ${FLOOR}.\n` +
            `   Le scan est cassé ou le corpus a bougé : une sonde qui ne lit rien sort VERTE\n` +
            `   en n'ayant rien gardé, ce qui est précisément le défaut qu'elle instruit.\n`
    );
    process.exit(1);
}

// ── GC-01 — every EXTERNAL-subject guard is in a package declaring `test:guards` ─────────────

/** `true` when the package declares the script running its guards uncached. */
const declaresTask = new Map(
    packages.map((p) => {
        const manifest = JSON.parse(fs.readFileSync(path.join(p.absDir, "package.json"), "utf8"));
        return [p.absDir, typeof manifest.scripts?.["test:guards"] === "string"];
    })
);

let external = 0;
for (const g of guards) {
    const body = fs.readFileSync(g, "utf8");
    if (!OUT_OF_PACKAGE.test(body)) continue;
    external++;

    const owner = packages.find((p) => g.startsWith(p.absDir + path.sep));
    const rel = path.relative(ROOT, g).split(path.sep).join("/");
    if (!owner) {
        errors.push(`GC-01 ${rel} — hors de tout paquet du registre, donc jouée par personne.`);
        continue;
    }
    if (!declaresTask.get(owner.absDir)) {
        errors.push(
            `GC-01 ${rel}\n` +
                `      son sujet est HORS du paquet, mais ${owner.name} ne déclare pas ` +
                `\`test:guards\`.\n` +
                `      Elle ne tourne donc que si le cache de \`test\` est froid — c'est-à-dire ` +
                `pas quand on\n` +
                `      touche à ce qu'elle garde. Ajouter "test:guards": "vitest run guard.test" ` +
                `à son package.json.`
        );
    }
}

notes.push(
    `${external} garde(s) à sujet externe sur ${guards.length} scannée(s), ` +
        `${[...declaresTask.values()].filter(Boolean).length} paquet(s) déclarant la tâche`
);

// ── GC-02 — the task really is UNCACHED ─────────────────────────────────────────────────────

const turboRaw = fs.readFileSync(path.join(ROOT, "turbo.json"), "utf8");
// `turbo.json` carries comments: the declaration is read by pattern, not JSON parser.
const taskBlock = /"test:guards"\s*:\s*\{([^}]*)\}/.exec(turboRaw);
if (!taskBlock) {
    errors.push(
        `GC-02 turbo.json — aucune tâche \`test:guards\`. Le remède de la classe a disparu ; ` +
            `les gardes\n      sont retombées sous le cache de \`test\`.`
    );
} else if (!/"cache"\s*:\s*false/.test(taskBlock[1])) {
    errors.push(
        `GC-02 turbo.json — \`test:guards\` ne porte pas \`"cache": false\`.\n` +
            `      Une tâche cachée rejoue le même défaut : elle ne tourne pas quand son sujet ` +
            `change, et sort VERTE.`
    );
}

// ── GC-03 — `ci:local` really calls it ──────────────────────────────────────────────────────

const ciLocal = fs.readFileSync(path.join(ROOT, "scripts", "ci-local.cjs"), "utf8");
if (!/["']test:guards["']/.test(ciLocal)) {
    errors.push(
        `GC-03 scripts/ci-local.cjs — la tâche n'est jamais lancée.\n` +
            `      Une tâche correcte que personne n'appelle ne garde rien.`
    );
}

// ── Verdict ─────────────────────────────────────────────────────────────────────────────────

if (errors.length > 0) {
    console.error(`\n❌ [GUARD-CACHE] ${errors.length} défaut(s) :\n`);
    for (const e of errors) console.error(`  • ${e}\n`);
    process.exit(1);
}

console.log(`✅ [GUARD-CACHE] ${notes.join(" · ")} — GC-01/02/03 tenus.`);
