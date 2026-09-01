/**
 * graft-sites.cjs — the GRAFTS: root-level `X.member = …` where `X` is an IMPORT.
 *
 * 🛑 **The class, and the real regression that opened it.** Three files under
 * `kernel/themes/theme-applier/` — 812 lines — export nothing anyone consumes: they graft
 * 13 methods onto `ThemeApplierCore` **at import time**, and `core.ts` calls them without
 * defining them. They only entered the graph through a global key nobody read; removing
 * it took the patches out with it. **Three instruments said "dead" in unison and all were
 * wrong** — a side-effect module has no consumer, by definition. The test suite would have
 * stayed GREEN: everything touching themes mocks `ThemeApplierCore`. The only symptom was
 * a production `TypeError`, at the first theme change.
 *
 * ## Why this module exists, when the triage was already done once
 *
 * The 2026-08-18 triage returned **118 sites / 19 files**, and its instrument **no longer
 * exists**: it lived in an instruction, not in `scripts/`. A verdict that cannot be
 * replayed does not expire, it fossilizes. This module makes it re-derivable.
 *
 * ## The three buckets, and why the RAW census is unusable
 *
 * The raw pattern `^\s*X.y\s*=` returns **1,510** matches for **118** real sites — a
 * factor of 12. `X` must therefore be resolved:
 *
 * | Bucket      | `X` is…                                         | Verdict                          |
 * | ----------- | ----------------------------------------------- | -------------------------------- |
 * | `greffe`    | an IMPORT binding (direct, aliased, re-bound)   | **the targeted class**           |
 * | `local`     | declared in the file (const/let/class/fn)       | false positive — local object    |
 * | `autre`     | neither (parameter, global)                     | DISTINCT subclass, kept apart    |
 *
 * ⚠️ **The `autre` bucket does not blend into the pool**: those are grafts onto an object
 * received as a parameter (`gl.Branding`, `adapterOptions.cluster`). The module is not
 * modified at import there — the caller supplies the target, and the question is not the
 * same.
 *
 * ## 🛑 The instrument had to be fixed THREE TIMES, each version blind differently
 *
 * The counter-proof — "are the three known `theme-applier/` cases caught?" — answered NO
 * twice before YES:
 *
 * | Version | Recognized                   | Missed `theme-applier` because…                            |
 * | ------- | ---------------------------- | ---------------------------------------------------------- |
 * | ①       | direct imported names        | the import is **aliased** (`ThemeApplierCore as _TA`)       |
 * | ②       | ① + `const X = imported;`    | the re-binding carries a **type annotation**                |
 * | ③       | ② + annotation traversed     | ✅ passes                                                   |
 *
 * ⚠️ **Version ① returned 90 sites and looked credible** — it caught everything except
 * precisely the three files the founding regression names. A plausible number produced by
 * a wrong instrument goes unchallenged. That is why `resolveBase` traverses re-bindings
 * AND annotations, and why the witness is kept (`GRAFT-02`).
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const registry = require("./packages.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const IGNORE = new Set(["node_modules", "dist", "coverage", ".turbo", "__tests__", "__mocks__"]);

/** The declarative mark a graft file must carry. */
const MARQUE = "@sideEffectGraft";

function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (!IGNORE.has(e.name)) walk(p, out);
        } else if (/\.ts$/.test(p) && !/\.d\.ts$/.test(p) && !/\.(test|spec)\.ts$/.test(p)) {
            out.push(p);
        }
    }
    return out;
}

/** The `.ts` sources of the registry's packages, tests and declarations excluded. */
function sources() {
    const out = [];
    for (const p of registry.all()) walk(path.join(p.absDir, "src"), out);
    return out;
}

/**
 * Classifies a file's root-level `X.y = …` assignments.
 *
 * @param {string} code TypeScript content.
 * @returns {{ greffe: string[], local: string[], autre: string[] }} The `X` bases, per
 *          bucket, one entry per SITE (duplicates kept: these are sites, not names).
 */
function classify(code) {
    const sf = ts.createSourceFile("x.ts", code, ts.ScriptTarget.ES2022, true);

    /** Names bound by an import — directly or through an alias. */
    const imported = new Set();
    /** Locally declared names, with the initializer to traverse re-bindings. */
    const locals = new Map();

    for (const st of sf.statements) {
        if (ts.isImportDeclaration(st) && st.importClause) {
            const c = st.importClause;
            if (c.name) imported.add(c.name.text);
            const b = c.namedBindings;
            if (b) {
                if (ts.isNamespaceImport(b)) imported.add(b.name.text);
                else for (const el of b.elements) imported.add(el.name.text);
            }
        } else if (ts.isVariableStatement(st)) {
            for (const d of st.declarationList.declarations) {
                if (ts.isIdentifier(d.name)) locals.set(d.name.text, d.initializer);
            }
        } else if ((ts.isClassDeclaration(st) || ts.isFunctionDeclaration(st)) && st.name) {
            locals.set(st.name.text, null);
        }
    }

    /**
     * Does `name` designate, directly or through re-bindings, an import binding?
     *
     * ⚠️ The traversal is what separates version ③ from the previous two: `theme-applier`
     * does `import { ThemeApplierCore as _TA }` then `const TA: ThemeApplierModule = _TA;`.
     * A version looking only at `imported` misses the second name; one refusing the type
     * annotation misses the re-binding. Both looked credible.
     */
    function resolveBase(nom, vus = new Set()) {
        if (imported.has(nom)) return "greffe";
        if (vus.has(nom)) return "local";
        vus.add(nom);
        if (!locals.has(nom)) return "autre";
        const init = locals.get(nom);
        if (init && ts.isIdentifier(init)) return resolveBase(init.text, vus);
        // `const X = <expr> as T` / `<T>expr` — the annotation sits on the DECLARATION,
        // not on the initializer; it is thus already traversed. Assertions remain.
        if (init && (ts.isAsExpression(init) || ts.isTypeAssertionExpression(init))) {
            const inner = init.expression;
            if (ts.isIdentifier(inner)) return resolveBase(inner.text, vus);
        }
        return "local";
    }

    const out = { greffe: [], local: [], autre: [] };
    for (const st of sf.statements) {
        if (!ts.isExpressionStatement(st)) continue;
        const e = st.expression;
        if (!ts.isBinaryExpression(e) || e.operatorToken.kind !== ts.SyntaxKind.EqualsToken)
            continue;
        if (!ts.isPropertyAccessExpression(e.left)) continue;
        const base = e.left.expression;
        if (!ts.isIdentifier(base)) continue;
        out[resolveBase(base.text)].push(base.text);
    }
    return out;
}

/**
 * The ANCHOR declared by the mark: the file whose BARE import keeps this one in the graph.
 *
 * 🛑 This is the load-bearing fact, and the only one nothing guarded. The July 2026
 * regression did not come from an error in the grafted module: it came from the REMOVAL of
 * its anchoring, rightly so — the global key that pulled it in had no reader. The module
 * left the graph with it, in silence. Declaring the anchor lets `GRAFT-03` verify that it
 * still imports.
 *
 * @param {string} code Content of the grafted file.
 * @returns {string|null} Repo-relative path, or `null` if the file does not carry the mark.
 */
function anchorOf(code) {
    const m = new RegExp(`\\${MARQUE}\\s+(\\S+)`).exec(code);
    return m ? m[1] : null;
}

/**
 * Does the anchor still import this file, through a BARE import?
 *
 * ⚠️ A NAMED import does not count: it would keep the module through its exports, yet
 * these files have none anyone consumes. Only `import "…";` says "I load you for your
 * effect".
 *
 * @param {string} ancreRel Path of the anchor, repo-relative.
 * @param {string} cibleRel Path of the grafted file, repo-relative.
 * @returns {boolean}
 */
function anchorStillImports(ancreRel, cibleRel) {
    const abs = path.join(ROOT, ancreRel);
    if (!fs.existsSync(abs)) return false;
    const code = fs.readFileSync(abs, "utf8");
    const base = path.basename(cibleRel).replace(/\.ts$/, ".js");
    // `import "<any path ending with the file name>";` — no clause.
    return new RegExp(`^\\s*import\\s+"[^"]*\\/${base.replace(/\./g, "\\.")}"\\s*;`, "m").test(
        code
    );
}

/**
 * Sweeps the repo.
 *
 * @returns {{ fichiers: number,
 *             greffes: Array<{ fichier: string, sites: number, marque: boolean,
 *                              ancre: (string|null), ancreVivante: boolean }>,
 *             sitesGreffe: number, sitesLocal: number, sitesAutre: number, fichiersAutre: number }}
 */
function scan() {
    const files = sources();
    const greffes = [];
    let sitesGreffe = 0;
    let sitesLocal = 0;
    let sitesAutre = 0;
    const filesAutre = new Set();

    for (const f of files) {
        const code = fs.readFileSync(f, "utf8");
        if (!/^\s*_?[A-Z][\w$]*\.[\w$]+\s*=/m.test(code)) continue; // cheap pre-filter
        const c = classify(code);
        sitesGreffe += c.greffe.length;
        sitesLocal += c.local.length;
        sitesAutre += c.autre.length;
        const rel = path.relative(ROOT, f).replace(/\\/g, "/");
        if (c.autre.length > 0) filesAutre.add(rel);
        if (c.greffe.length > 0) {
            const ancre = anchorOf(code);
            greffes.push({
                fichier: rel,
                sites: c.greffe.length,
                marque: code.includes(MARQUE),
                ancre,
                ancreVivante: ancre ? anchorStillImports(ancre, rel) : false,
            });
        }
    }
    greffes.sort((a, b) => a.fichier.localeCompare(b.fichier));
    return {
        fichiers: files.length,
        greffes,
        sitesGreffe,
        sitesLocal,
        sitesAutre,
        fichiersAutre: filesAutre.size,
    };
}

/** The known-answer witness: the three files the July regression produced. */
const TEMOIN = [
    "packages/core/src/kernel/themes/theme-applier/deferred.ts",
    "packages/core/src/kernel/themes/theme-applier/ui-sync.ts",
    "packages/core/src/kernel/themes/theme-applier/visibility.ts",
];

module.exports = { MARQUE, TEMOIN, sources, classify, anchorOf, anchorStillImports, scan };
