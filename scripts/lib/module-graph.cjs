/**
 * module-graph.cjs — who references each module, and HOW.
 *
 * 🛑 **Why the question "does this module have an importer?" has no grep answer.** The
 * obvious route — forbidding a module without importers — would redden on **side-effect**
 * modules, whose very job is to have no named importer. This module renders the
 * distinction: it separates "nobody references it" from "referenced FOR ITS EFFECT".
 *
 * ## Three blindnesses of a textual census, measured before writing this one
 *
 * A first version looked for `^\s*import … from "…/<basename>"`:
 *
 * 1. **MULTI-LINE imports escape it** — `import {\n  X,\n} from "./m.js";` does not have
 *    its `from` on the `import` line. Prettier produces these as soon as the list exceeds
 *    the width.
 * 2. **RE-EXPORTS escape it** — `export { X } from "./m.js"` and `export * from "./m.js"`
 *    do not start with `import`. The core carries **76**, and they are what keeps the
 *    barrels alive.
 * 3. **The basename is ambiguous** — the repo carries several `facade.ts`, several
 *    `index.ts`; a `from "./facade.js"` counted for ALL of them. A blindness that inflates
 *    AND deflates depending on the case.
 *
 * ⚠️ The three partially compensate, which is the worst case: the census looks plausible.
 * That is why this module resolves specifiers **on disk**, through the TypeScript AST, and
 * never by file name.
 *
 * ## What it does NOT do
 *
 * It does not say whether a module is *useful* — only whether it is **reached**, and by
 * what kind of edge. A reached module whose entire content is dead looks alive to it: that
 * is the limit `check-dead-code-scope` prints at every run — covered is not seen.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const registry = require("./packages.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const SKIP = new Set(["node_modules", "dist", "coverage", ".turbo"]);

function walk(dir, filter, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (!SKIP.has(e.name)) walk(p, filter, out);
        } else if (filter(p)) out.push(p);
    }
    return out;
}

/**
 * ⚠️ `.js` included, and that is no detail: the repo carries **478 suites still in
 * JavaScript** (frozen debt). A version of this module looking only at `.ts` declared
 * `kernel/geojson/style-resolver.ts` ORPHANED while two `.js` suites import it. Fourth
 * blindness fixed on this instrument, and the fourth found through a known answer rather
 * than through re-reading.
 */
const isTest = (f) => /\.(test|spec)\.(ts|js)$/.test(f);
const isDecl = (f) => /\.d\.ts$/.test(f);
const isSource = (f) => /\.ts$/.test(f) && !isDecl(f) && !isTest(f);

/**
 * What can REFERENCE a module — sources, tests, and **declarations**.
 *
 * ⚠️ The `.d.ts` were forgotten from this corpus at first writing, and `global.d.ts` is
 * precisely the file that consumes the contracts: it carries
 * `import("./contracts/top-level-api.contract.js").GeoLeafTopLevelApi`. Without them, that
 * contract came out ORPHANED while it has a reader — a false positive on the very class
 * the instrument exists to measure.
 */
const isImporter = (f) => isSource(f) || isTest(f) || isDecl(f);

/** Resolves a relative specifier to a `.ts` file of the repo, or `null`. */
function resolve(fromFile, spec) {
    if (!spec.startsWith(".")) return null;
    const base = path.resolve(path.dirname(fromFile), spec);
    for (const cand of [
        base.replace(/\.js$/, ".ts"),
        base.replace(/\.mjs$/, ".mts"),
        `${base}.ts`,
        path.join(base, "index.ts"),
    ]) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
    }
    return null;
}

/**
 * A file's outgoing edges, by KIND.
 *
 * @param {string} file Absolute path.
 * @returns {Array<{ cible: string, sorte: "nommé"|"nu"|"ré-export"|"dynamique" }>}
 */
function edges(file) {
    const sf = ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.ES2022,
        true
    );
    const out = [];
    const push = (spec, sorte) => {
        const t = resolve(file, spec);
        if (t) out.push({ cible: t, sorte });
    };
    const visit = (n) => {
        if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
            push(n.moduleSpecifier.text, n.importClause ? "nommé" : "nu");
        } else if (
            ts.isExportDeclaration(n) &&
            n.moduleSpecifier &&
            ts.isStringLiteral(n.moduleSpecifier)
        ) {
            push(n.moduleSpecifier.text, "ré-export");
        } else if (
            ts.isImportTypeNode(n) &&
            ts.isLiteralTypeNode(n.argument) &&
            ts.isStringLiteral(n.argument.literal)
        ) {
            // `type T = import("./m.js").X` — a TYPE edge, in type position, not expression.
            // ⚠️ Forgotten at first writing, and it is how `global.d.ts` consumes the
            // contracts: without it, `contracts/top-level-api.contract.ts` came out
            // ORPHANED while it has a reader. A contract is consumed as a TYPE — missing
            // it means being blind on the very class this instrument measures.
            push(n.argument.literal.text, "type");
        } else if (
            ts.isCallExpression(n) &&
            n.expression.kind === ts.SyntaxKind.ImportKeyword &&
            n.arguments[0] &&
            ts.isStringLiteral(n.arguments[0])
        ) {
            push(n.arguments[0].text, "dynamique");
        }
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
}

/** A package's declared entry points — never imported, by construction. */
function entryPoints() {
    const out = new Set();
    for (const p of registry.all()) {
        const pj = JSON.parse(fs.readFileSync(path.join(p.absDir, "package.json"), "utf8"));
        const blob = JSON.stringify([pj.main, pj.module, pj.types, pj.exports, pj.bin]);
        for (const m of blob.match(/[\w./-]+\.(ts|js|mjs)/g) || []) {
            for (const cand of [
                m,
                m.replace(/\.js$/, ".ts"),
                m.replace(/^\.\/dist\//, "./src/").replace(/\.js$/, ".ts"),
            ]) {
                const abs = path.resolve(p.dir, cand);
                if (fs.existsSync(abs)) out.add(abs);
            }
        }
        // A package entry is also, by this repo's convention, `src/entry.ts`.
        const e = path.join(p.absDir, "src", "entry.ts");
        if (fs.existsSync(e)) out.add(e);
    }
    return out;
}

/**
 * Builds the reverse index and classifies each source.
 *
 * @returns {{ sources: number, importeurs: number,
 *             orphelins: string[],
 *             effetDeBord: Array<{ fichier: string, marque: boolean, parQui: string[] }>,
 *             entrees: number }}
 */
function scan() {
    const sources = [];
    const importeurs = [];
    for (const p of registry.all()) {
        walk(path.join(p.absDir, "src"), isSource, sources);
        walk(path.join(p.absDir, "src"), isImporter, importeurs);
        walk(path.join(p.absDir, "__tests__"), isImporter, importeurs);
    }
    const entrees = entryPoints();

    /**
     * TWO indexes, and the distinction decides the verdict.
     *
     * 🛑 Measured: without it, letting the 478 `.js` suites into the corpus drops the
     * side-effect modules from **17 to 4** — because a test imports them BY NAME to prove
     * them. A module bare-imported in production and named in a test would then look
     * alive, which it is not: production is what decides its nature.
     *
     * · `entrantProd` — edges from SOURCES alone → decides "side effect".
     * · `entrant` — all edges, tests and `.d.ts` included → decides "orphan".
     */
    const entrant = new Map();
    const entrantProd = new Map();
    /** target → Set of referring files (for the report) */
    const parQui = new Map();
    for (const f of importeurs) {
        for (const e of edges(f)) {
            if (!entrant.has(e.cible)) entrant.set(e.cible, new Set());
            if (!parQui.has(e.cible)) parQui.set(e.cible, new Set());
            entrant.get(e.cible).add(e.sorte);
            if (!isTest(f) && !isDecl(f)) {
                if (!entrantProd.has(e.cible)) entrantProd.set(e.cible, new Set());
                entrantProd.get(e.cible).add(e.sorte);
            }
            parQui.get(e.cible).add(path.relative(ROOT, f).replace(/\\/g, "/"));
        }
    }

    const orphelins = [];
    const effetDeBord = [];
    for (const f of sources) {
        if (entrees.has(f)) continue;
        const rel = path.relative(ROOT, f).replace(/\\/g, "/");
        const sortes = entrant.get(f);
        const prod = entrantProd.get(f);
        if (!sortes || sortes.size === 0) {
            orphelins.push(rel);
        } else if (prod && prod.size === 1 && prod.has("nu")) {
            effetDeBord.push({
                fichier: rel,
                marque: fs.readFileSync(f, "utf8").includes("@sideEffectGraft"),
                parQui: [...(parQui.get(f) || [])].sort(),
            });
        }
    }
    orphelins.sort();
    effetDeBord.sort((a, b) => a.fichier.localeCompare(b.fichier));
    return {
        sources: sources.length,
        importeurs: importeurs.length,
        orphelins,
        effetDeBord,
        entrees: entrees.size,
    };
}

module.exports = { edges, resolve, entryPoints, scan };
