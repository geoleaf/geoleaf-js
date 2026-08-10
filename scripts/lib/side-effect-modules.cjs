#!/usr/bin/env node
/**
 * The derived truth about `@geoleaf/core`'s import-time side effects (S6).
 *
 * Shared by the two gates that need it:
 *   - `scripts/check-side-effects.cjs`    — is `package.json#sideEffects` still honest?
 *   - `scripts/check-consumer-bundle.cjs` — did the published package actually keep them?
 *
 * ## What counts, and why only this
 *
 * A module imported **by name** (`import { X } from "./x.js"`) is safe whatever a bundler thinks
 * of its purity: its export is consumed, so it stays. The modules that can vanish are the ones
 * reached **only by a bare import** (`import "./x.js";`) — the import exists *for the effect*, and
 * a bundler that believes the module is pure will delete it, silently.
 *
 * So the load-bearing set is exactly: **the transitive closure of bare imports, from the entry
 * points a consumer can reach.** That set is computable from the source, which is the whole point
 * — the previous hand-typed `sideEffects` list had rotted into two dead entries (`globals.poi.ts`,
 * deleted in S9; `modules/config/geoleaf-config/*.ts`, a path that never existed — the real one is
 * `kernel/config/…`), and nothing failed. A list nobody derives is a list nobody checks.
 *
 * ## What this deliberately does NOT try to detect
 *
 * Top-level writes to `globalThis.GeoLeaf` (there are ~25 of them). They are real side effects, but
 * every one of those modules is imported by name somewhere, so their exports keep them alive. A
 * heuristic AST scan for them would add false positives and a maintenance burden for zero
 * protection. If one ever becomes bare-import-only, it enters the closure below on its own.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
// T5.5 — par le registre voisin, qui jette. Ce module est la vérité partagée de 2 gates
// (`check-side-effects`, `check-consumer-bundle`) : un chemin muet ici les rendrait
// muettes toutes les deux, d'un seul coup et sans un mot.
const CORE = require("./packages.cjs").requireByDirName("core").absDir;
const SRC = path.join(CORE, "src");

/**
 * The entry points of the published package that carry side effects.
 *
 * Each is an `exports` subpath, so a consumer can import it — bare, for the effect. Anything they
 * bare-import, transitively, must survive tree-shaking in the consumer's bundler.
 */
const SIDE_EFFECT_ENTRIES = [
    "bundle-esm-entry.ts", // "."        — the shipped ESM entry
    "globals/globals.ts", // "./globals" — populates window.GeoLeaf.*
    "app/app-namespace.ts", // "./helpers" — wires GeoLeaf._app
];

/** Bare imports of a file: `import "./x.js";` — never `import { x } from …`. */
function bareImportsOf(absFile) {
    const src = fs.readFileSync(absFile, "utf8");
    const out = [];
    // Anchored at line start so a bare import inside a comment block or a string does not match.
    const re = /^[ \t]*import\s+["']([^"']+)["']\s*;?[ \t]*$/gm;
    let m;
    while ((m = re.exec(src)) !== null) out.push(m[1]);
    return out;
}

/**
 * Resolve a relative ESM specifier (`./x.js`, `../y/z.js`) written in a TS source back to the
 * `.ts` file it means. Returns null for bare package specifiers (none today, but do not assume).
 */
function resolveSpecifier(fromAbsFile, spec) {
    if (!spec.startsWith(".")) return null;
    const asTs = spec.replace(/\.js$/, ".ts");
    const abs = path.resolve(path.dirname(fromAbsFile), asTs);
    return fs.existsSync(abs) ? abs : null;
}

/**
 * The transitive closure of bare imports from a set of roots.
 *
 * @param {string[]} [rootsRel] paths relative to `packages/core/src`. Defaults to the package's
 *                              own side-effect entry points.
 * @returns {string[]} paths relative to `packages/core/src`, POSIX-separated, `.ts` extension,
 *                     sorted. e.g. `kernel/config/geoleaf-config/config-accessors.ts`
 */
function bareImportClosureFrom(rootsRel = SIDE_EFFECT_ENTRIES) {
    const seen = new Set();
    const queue = rootsRel.map((r) => path.join(SRC, r));

    for (const root of queue) {
        if (!fs.existsSync(root)) {
            throw new Error(
                `[side-effect-modules] Entrée à effet de bord introuvable : ${path.relative(ROOT, root)}. ` +
                    `Elle est déclarée comme racine et censée être exposée par package.json#exports — l'une des deux ment.`
            );
        }
    }

    while (queue.length > 0) {
        const file = queue.pop();
        const rel = path.relative(SRC, file).split(path.sep).join("/");
        if (seen.has(rel)) continue;
        seen.add(rel);

        for (const spec of bareImportsOf(file)) {
            const target = resolveSpecifier(file, spec);
            if (target !== null) queue.push(target);
        }
    }

    return [...seen].sort();
}

const bareImportClosure = () => bareImportClosureFrom();

/**
 * Resolve a published subpath (`@geoleaf/core/globals`) back to the source file it maps to
 * (`globals/globals.ts`), THROUGH `package.json#exports` — the same map a consumer's resolver
 * reads. Returns null for anything that is not a `@geoleaf/core` subpath.
 *
 * Doing it this way rather than by convention is deliberate: it means the consumer gate cannot
 * assert anything about a subpath the `exports` map does not actually expose.
 */
function resolveSubpathToSrc(specifier) {
    if (!specifier.startsWith("@geoleaf/core")) return null;

    const pkg = JSON.parse(fs.readFileSync(path.join(CORE, "package.json"), "utf8"));
    const subpath =
        specifier === "@geoleaf/core" ? "." : `.${specifier.slice("@geoleaf/core".length)}`;

    /** `{ import: "./dist/esm/x.js" }` | `"./dist/x"` → the import target, or null. */
    const targetOf = (entry) =>
        typeof entry === "string" ? entry : (entry?.import ?? entry?.default ?? null);

    let target = null;
    if (Object.prototype.hasOwnProperty.call(pkg.exports, subpath)) {
        target = targetOf(pkg.exports[subpath]);
    } else {
        // Wildcard patterns. Node picks the longest static prefix; replicate that, not the
        // object's key order — key order is not part of the resolution algorithm.
        const candidates = Object.keys(pkg.exports)
            .filter((k) => k.includes("*"))
            .map((k) => {
                const [prefix, suffix = ""] = k.split("*");
                return { k, prefix, suffix };
            })
            .filter((c) => subpath.startsWith(c.prefix) && subpath.endsWith(c.suffix))
            .sort((a, b) => b.prefix.length - a.prefix.length || b.suffix.length - a.suffix.length);

        if (candidates.length > 0) {
            const c = candidates[0];
            const star = subpath.slice(c.prefix.length, subpath.length - c.suffix.length);
            const t = targetOf(pkg.exports[c.k]);
            target = t === null ? null : t.replace("*", star);
        }
    }
    if (target === null) return null;

    // "./dist/esm/globals/globals.js" → "globals/globals.ts"
    const m = /^\.\/dist\/esm\/(.+)\.js$/.exec(target);
    if (m === null) return null;
    const srcRel = `${m[1]}.ts`;
    return fs.existsSync(path.join(SRC, srcRel)) ? srcRel : null;
}

/** `globals/globals.config.ts` → `dist/esm/globals/globals.config.js` (package-relative, POSIX). */
function toPublishedPath(srcRel) {
    return `dist/esm/${srcRel.replace(/\.ts$/, ".js")}`;
}

/**
 * The full set of package-relative paths that `package.json#sideEffects` MUST keep alive.
 *
 * `dist/geoleaf.esm.js` is in here and is easy to forget: it is the target of `main` / `module` /
 * `unpkg`, it mutates `window.GeoLeaf`, and a bundler that reads it as side-effect-free deletes a
 * bare `import "@geoleaf/core"` outright.
 */
function requiredSideEffectPaths() {
    return ["dist/geoleaf.esm.js", ...bareImportClosure().map(toPublishedPath)].sort();
}

/**
 * Normalise any sourcemap source — `../../src/globals/globals.config.ts`,
 * `../../../dist/esm/globals/globals.config.js` — down to the module identity they share:
 * `globals/globals.config`.
 *
 * The shipped bundle's maps point at `src/`, the consumer witness's at `dist/esm/`. Comparing
 * them is the only way to ask "is this module observable in a sourcemap at all?", which matters
 * because a module that emits no code (a pure bare-import orchestrator like `globals/globals.ts`,
 * whose entire job is to import its six siblings) can never appear in one. Requiring its presence
 * would be a permanently-red check that proves nothing — its six children landing is the proof.
 */
function moduleIdentity(source) {
    const norm = source.split(path.sep).join("/");
    const m = /(?:^|\/)(?:src|dist\/esm)\/(.+?)\.[cm]?[jt]s$/.exec(norm);
    return m === null ? null : m[1];
}

module.exports = {
    CORE,
    SRC,
    SIDE_EFFECT_ENTRIES,
    bareImportsOf,
    bareImportClosure,
    bareImportClosureFrom,
    resolveSubpathToSrc,
    moduleIdentity,
    toPublishedPath,
    requiredSideEffectPaths,
};
