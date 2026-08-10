#!/usr/bin/env node
/**
 * Gate: is `@geoleaf/core`'s `package.json#sideEffects` still honest? (S6)
 *
 * ## Why this exists
 *
 * `sideEffects` is a promise made to *someone else's* bundler. Webpack, Vite and
 * `@rollup/plugin-node-resolve` all read it, and — this is the part that bites — node-resolve
 * returns it from its `resolveId` hook, where it **overrides** the consumer's own
 * `treeshake.moduleSideEffects`. So a wrong entry here is not a hint that gets ignored: it is an
 * instruction to delete code, and it is obeyed.
 *
 * Before S6 the field listed 14 globs, all of them under `src/**\/*.ts` — a directory `files`
 * never publishes. From a consumer's point of view **every module in the package was declared
 * side-effect-free**. Two of the globs were dead on top of that (`globals.poi.ts`, deleted in S9;
 * `modules/config/geoleaf-config/*.ts`, a path that never existed — the real one is
 * `kernel/config/…`). Nothing failed, because nothing checked.
 *
 * ## What it checks
 *
 *   1. **COVERAGE** — every module in the derived bare-import closure (see
 *      `lib/side-effect-modules.cjs`) is matched by at least one glob. A miss here means a
 *      consumer's bundler is licensed to delete a module that exists purely for its effect.
 *   2. **NO DEAD GLOBS** — every glob matches at least one file that is actually published. A glob
 *      that matches nothing is worse than absent: it reads as protection and provides none.
 *   3. **PUBLISHED PATHS** — no glob points inside `src/`, which `files` does not ship.
 *
 * The *runtime* proof that the promise is kept — that the modules really survive a third-party
 * bundler — is `scripts/check-consumer-bundle.cjs`. This gate checks the declaration; that one
 * checks the deed.
 *
 * Usage:  node scripts/check-side-effects.cjs
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { CORE, requiredSideEffectPaths } = require("./lib/side-effect-modules.cjs");

const C = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    dim: "\x1b[2m",
};

/**
 * webpack / node-resolve `sideEffects` glob semantics:
 *   - a pattern with no `/` is implicitly prefixed with `**\/`
 *   - `*`  matches anything but `/`
 *   - `**` matches anything, `/` included
 */
function globToRegExp(glob) {
    const pattern = glob.includes("/") ? glob : `**/${glob}`;
    let re = "";
    for (let i = 0; i < pattern.length; i++) {
        const c = pattern[i];
        if (c === "*") {
            if (pattern[i + 1] === "*") {
                re += ".*";
                i++;
                if (pattern[i + 1] === "/") i++; // `**/` also matches zero directories
            } else {
                re += "[^/]*";
            }
        } else if (c === "?") {
            re += "[^/]";
        } else {
            re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
        }
    }
    return new RegExp(`^${re}$`);
}

/** Every file the package actually publishes, package-relative and POSIX-separated. */
function publishedFiles() {
    const out = [];
    const walk = (abs) => {
        for (const d of fs.readdirSync(abs, { withFileTypes: true })) {
            const child = path.join(abs, d.name);
            if (d.isDirectory()) walk(child);
            else out.push(path.relative(CORE, child).split(path.sep).join("/"));
        }
    };
    walk(path.join(CORE, "dist"));
    return out;
}

function checkSideEffects() {
    const ok = (m) => console.log(`${C.green}✓${C.reset}  ${m}`);
    const err = (m) => console.error(`${C.red}✗${C.reset}  ${m}`);
    const dim = (m) => console.log(`${C.dim}   ${m}${C.reset}`);

    const distDir = path.join(CORE, "dist");
    if (!fs.existsSync(distDir)) {
        err(
            "`packages/core/dist/` absent — lancer `npm run build` d'abord. Un gate qui se désarme quand l'artefact manque ne garde rien : ÉCHEC."
        );
        return false;
    }

    const pkg = JSON.parse(fs.readFileSync(path.join(CORE, "package.json"), "utf8"));
    const globs = pkg.sideEffects;
    if (!Array.isArray(globs) || globs.length === 0) {
        err("`sideEffects` absent ou vide dans packages/core/package.json.");
        return false;
    }

    const files = publishedFiles();
    const required = requiredSideEffectPaths();
    const matchers = globs.map((g) => ({ glob: g, re: globToRegExp(g) }));

    let allOk = true;

    // ── 1. COVERAGE ──
    const uncovered = required.filter((p) => !matchers.some((m) => m.re.test(p)));
    if (uncovered.length === 0) {
        ok(
            `Couverture : les ${required.length} modules à effet de bord (clôture des imports NUS, dérivée du code) sont couverts.`
        );
    } else {
        allOk = false;
        err(
            `Couverture : ${uncovered.length} module(s) à effet de bord ne sont couverts par AUCUN glob :`
        );
        for (const p of uncovered) dim(p);
        err(
            "Un bundler tiers (webpack/Vite/node-resolve) est autorisé à les SUPPRIMER — ils n'existent que pour leur effet, aucun export ne les retient."
        );
    }

    // ── 2. NO DEAD GLOBS ──
    const dead = matchers.filter((m) => !files.some((f) => m.re.test(f)));
    if (dead.length === 0) {
        ok(`Aucun glob mort : les ${globs.length} entrées matchent au moins un fichier publié.`);
    } else {
        allOk = false;
        err(`${dead.length} glob(s) ne matchent AUCUN fichier publié :`);
        for (const m of dead) dim(`"${m.glob}"`);
        err(
            "Une entrée qui ne matche rien se lit comme une protection et n'en est pas une — c'est exactement comme ça que `globals.poi.ts` (supprimé) et `modules/config/geoleaf-config/*.ts` (chemin inexistant) ont survécu à deux refactos."
        );
    }

    // ── 3. PUBLISHED PATHS ──
    const inSrc = globs.filter((g) => g.startsWith("src/"));
    if (inSrc.length > 0) {
        allOk = false;
        err(
            `${inSrc.length} glob(s) visent \`src/\`, que \`files\` ne publie PAS — ils ne peuvent rien matcher chez un consommateur :`
        );
        for (const g of inSrc) dim(`"${g}"`);
    }

    console.log("");
    if (allOk) ok("`sideEffects` dit la vérité — dérivée du code, pas recopiée.");
    else err("`sideEffects` ment. Un bundler tiers élaguera du code vivant.");
    console.log("");
    return allOk;
}

if (require.main === module) {
    console.log(`\n${C.cyan}── 🧨 Effets de bord déclarés vs réels ──${C.reset}\n`);
    process.exitCode = checkSideEffects() ? 0 : 1;
}

module.exports = { checkSideEffects, globToRegExp };
