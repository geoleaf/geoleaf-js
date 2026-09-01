#!/usr/bin/env node
/**
 * AMBIENT-TYPES: publishes the global `GeoLeaf` namespace with the package.
 *
 * ## The defect this script closes
 *
 * `@geoleaf/core` did **not publish its own global namespace**. An integrator
 * writing the form all the documentation teaches —
 *
 *     GeoLeaf.Core.setTheme("dark");
 *
 * — got **`TS2304: Cannot find name 'GeoLeaf'`** against `dist/types/`, the
 * package's declared `types`. Measured and proven by compilation on 2026-07-27.
 *
 * ## Why it was not a configuration oversight
 *
 * `tsconfig.declarations.json` does carry `"include": ["src/**\/*"]`, so
 * `src/global.d.ts` IS in the perimeter. But **TypeScript does not re-emit an
 * input `.d.ts`**: a declaration file is an *input*, not a *source*, and
 * `emitDeclarationOnly` skips it. The result was silent —
 * `find dist -name global.d.ts` returned 0, without the slightest compiler
 * warning. No amount of `tsconfig` tuning changes anything; the file must be
 * copied.
 *
 * ## What this script does, and why in this order
 *
 * 1. Copies `src/global.d.ts` → `dist/types/global.d.ts`. Its type references are
 *    **relative** `import("./api/geoleaf.*.js")`: they thus resolve to the `.d.ts`
 *    emitted alongside, without rewriting.
 * 2. Prefixes **every types entry declared by the `exports` map** with a
 *    `/// <reference path="<…>/global.d.ts" />`. That is what pulls the file into
 *    the consumer's program: `global.d.ts` is a **module** (`export {}`) carrying
 *    a `declare global`, so its augmentation only applies if it is included.
 *
 * ⚠️ **That this is a script and not a build option is the point.** A `tsconfig`
 * cannot express "copy this declaration"; writing it here makes it visible,
 * testable and dated, instead of a box ticked somewhere.
 *
 * ## 🛑 Why ALL entries, and not only `"."` (2026-08-12)
 *
 * This script prefixed only `bundle-esm-entry.d.ts` — the `"."` entry — until
 * 2026-08-12, and **the recipe this repo RECOMMENDS does not go through it**. An
 * integrator importing subpaths (`@geoleaf/core/kernel`,
 * `@geoleaf/core/capabilities/<id>/install.js`) — i.e. what tree-shaking requires
 * and what `examples/consumer/entry.ts` embodies — never loaded the ambient.
 *
 * Measured on tarballs packed into a pristine directory, `skipLibCheck` disabled:
 * **11 errors** — `GeoLeafGlobal` (9 sites), `GeoLeafUIFacade`,
 * `GeoLeafThemeSelector`. With `skipLibCheck: true`, the setting of nearly every
 * project, the same compilation returns **exit 0**.
 *
 * ⚠️ **And the monorepo could not see it.** The docblock here claimed the proof
 * lived in `examples/consumer/published-types.ts` — yet that file **imports the
 * `"."` entry**, which pulls the ambient and masks the defect for the WHOLE
 * program, including for `entry.ts` compiled beside it. The invoked proof was thus
 * precisely what prevented seeing. It is `entry.ts` ALONE, outside the monorepo,
 * that judges.
 *
 * ## What this script REFUSES to do
 *
 * It does not "silently skip" when the source or a target is missing: it exits 1
 * and says so. A mute post-build that finds nothing would reproduce exactly the
 * defect it fixes — an absent artifact nobody is warned about. Same posture as
 * `verify-repo-hygiene` and `probe-gate-visibility` on this class.
 *
 * It also refuses to run on **zero entries**: an `exports` map that stopped
 * declaring `types` conditions would render it green while prefixing nothing.
 *
 * Usage: node scripts/emit-ambient-types.cjs   (post-build of @geoleaf/core)
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const registry = require("./lib/packages.cjs");

const CORE = registry.requireByDirName("core");
const SRC = path.join(CORE.absDir, "src", "global.d.ts");
const OUT_DIR = path.join(CORE.absDir, "dist", "types");
const OUT = path.join(OUT_DIR, "global.d.ts");

function fail(msg) {
    console.error(`❌ [AMBIENT-TYPES] ${msg}`);
    process.exit(1);
}

/**
 * The entry `.d.ts` the `exports` map exposes, DERIVED from it and never listed here.
 *
 * A hand-written list would diverge at the first added subpath — and diverge in
 * silence, since nothing downstream compiles these entries separately. Globs
 * (`./capabilities/*`) are expanded on disk.
 *
 * @returns {string[]} Absolute paths, deduplicated, sorted.
 */
function entryDeclarationFiles() {
    const exportsMap = CORE.manifest.exports;
    if (!exportsMap || typeof exportsMap !== "object") {
        fail("`exports` absent ou non-objet dans packages/core/package.json.");
    }

    /** @type {Set<string>} */
    const found = new Set();
    for (const conditions of Object.values(exportsMap)) {
        const types = typeof conditions === "object" && conditions ? conditions.types : null;
        if (typeof types !== "string") continue;

        // `./dist/types/x.d.ts` → absolute; a `*` is expanded on disk.
        const rel = types.replace(/^\.\//, "");
        if (!rel.includes("*")) {
            found.add(path.join(CORE.absDir, rel));
            continue;
        }
        const [prefix, suffix] = rel.split("*");
        const dir = path.join(CORE.absDir, path.dirname(prefix));
        if (!fs.existsSync(dir)) continue;
        for (const name of fs.readdirSync(dir)) {
            const abs = path.join(dir, name);
            if (abs.endsWith(suffix) && fs.statSync(abs).isFile()) found.add(abs);
        }
    }
    return [...found].sort();
}

/**
 * The directive to set at the head of `file`, with the RELATIVE path to `global.d.ts`.
 *
 * ⚠️ The path depends on depth: `./global.d.ts` for an entry at the root of
 * `dist/types/`, `../global.d.ts` for `dist/types/api/…`. A fixed path would break
 * every entry but one level's — and break silently, `tsc` ignoring a
 * `/// <reference>` whose target cannot be found.
 *
 * @param {string} file Absolute path of the entry `.d.ts`.
 * @returns {string}
 */
function referenceFor(file) {
    let rel = path.relative(path.dirname(file), OUT).split(path.sep).join("/");
    if (!rel.startsWith(".")) rel = `./${rel}`;
    return `/// <reference path="${rel}" />`;
}

if (!fs.existsSync(SRC)) {
    fail(`source absente : ${path.relative(registry.ROOT, SRC)}`);
}

fs.copyFileSync(SRC, OUT);

const entries = entryDeclarationFiles();
// Anti-empty-gate: zero entries means an `exports` map that stopped declaring its
// `types` conditions. Prefixing zero files would "succeed" doing nothing.
if (entries.length === 0) {
    fail(
        "aucune entrée de types dérivée de la carte `exports`.\n" +
            "   Ce script tourne APRÈS `tsc -p tsconfig.declarations.json`. Lancer `npm run build`."
    );
}

let prefixed = 0;
let already = 0;
const missing = [];

for (const file of entries) {
    if (file === OUT) continue; // `global.d.ts` does not reference itself
    if (!fs.existsSync(file)) {
        missing.push(path.relative(CORE.absDir, file));
        continue;
    }
    const reference = referenceFor(file);
    const text = fs.readFileSync(file, "utf8");
    if (text.includes(reference)) {
        already++;
        continue;
    }
    fs.writeFileSync(file, `${reference}\n${text}`);
    prefixed++;
}

if (missing.length > 0) {
    fail(
        `${missing.length} entrée(s) de types déclarée(s) dans \`exports\` mais ABSENTE(S) du build :\n` +
            missing.map((m) => `     ${m}`).join("\n") +
            `\n   Une entrée déclarée et non émise est un sous-chemin qui ne résout pas chez l'intégrateur.`
    );
}

// The check that counts: the declaration is there, and EVERY entry pulls it.
const emitted = fs.existsSync(OUT) && /declare global/.test(fs.readFileSync(OUT, "utf8"));
const unreferenced = entries.filter(
    (f) => f !== OUT && !fs.readFileSync(f, "utf8").includes(referenceFor(f))
);
if (!emitted || unreferenced.length > 0) {
    fail(
        `état incohérent après écriture — émis: ${emitted}, ` +
            `${unreferenced.length} entrée(s) sans référence.\n` +
            `   Ne pas ignorer : c'est exactement le défaut que ce script ferme.`
    );
}

console.log(
    `✅ [AMBIENT-TYPES] namespace global publié — dist/types/global.d.ts, ` +
        `référencé par ${entries.length - 1} entrée(s) de la carte \`exports\` ` +
        `(${prefixed} posée(s), ${already} déjà en place).`
);
