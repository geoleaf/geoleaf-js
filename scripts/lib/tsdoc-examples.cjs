/*!
 * TSDoc `@example` extraction — SHARED engine.
 *
 * Written in `typecheck-docs-examples.cjs`, extracted here on 2026-07-30 when
 * `validate-docs-examples.cjs` needed the same corpus. Copying it would have created two
 * extractors free to diverge — exactly the defect this overhaul fights, one storey down.
 *
 * ⚠️ **Two shapes coexist in this repo**, measured on 2026-07-27: **37 fenced blocks**
 * (a ` ```ts ` fence inside the TSDoc block) and **81 raw** (the code directly after the
 * tag). Both are handled; a fenced body keeps only the fence's inside, so the backticks
 * never reach the consumer.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Out-of-perimeter files: a test documents its intent, not an API.
 *
 * ⚠️ **`.d.ts` files are NO LONGER excluded since 2026-07-31.** They were, and it was
 * the last hole of the regime the V3 overhaul closed everywhere else: `global.d.ts`
 * carries `GeoLeafGlobal`, i.e. the `GeoLeaf.*` surface the integrator reads first, and
 * its `@example`s were **rendered by TypeDoc without ever being compiled**.
 *
 * The exclusion was justified by "a `.d.ts` has no body, including it would pull
 * declarations into the test program". **That is false, and verifiable**: this module
 * only READS the files to extract the `@example` text. In its consumer
 * `typecheck-docs-examples.cjs`, each example goes into its own temporary file under
 * `TMP_DIR`, and the generated tsconfig carries `include: ["*.ts"]` **relative to that
 * directory**. The source `.d.ts` thus never enters the verified program.
 */
const EXCLUDED = /(\/__tests__\/|\/__mocks__\/|\.test\.ts$|\.spec\.ts$)/;

/**
 * Extracts the `@example` bodies from a source file's TSDoc.
 *
 * @param {string} content - The file's text.
 * @returns {{ code: string, startLine: number }[]} one element per non-empty `@example`.
 */
function extractTsdocExamples(content) {
    const out = [];
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
        if (!/^\s*\*\s*@example\b/.test(lines[i])) continue;
        const body = [];
        let j = i + 1;
        let inFence = false;
        let sawFence = false;
        for (; j < lines.length; j++) {
            const raw = lines[j];
            if (/^\s*\*\//.test(raw)) break; // end of the TSDoc block
            const stripped = raw.replace(/^\s*\*\s?/, "");
            if (/^\s*```/.test(stripped)) {
                if (inFence) {
                    inFence = false;
                    break;
                }
                inFence = true;
                sawFence = true;
                continue;
            }
            if (/^\s*@\w+/.test(stripped) && !inFence) break; // tag suivant
            if (!sawFence || inFence) body.push(stripped);
        }
        const code = body.join("\n").trim();
        if (code) out.push({ code, startLine: i + 1 });
        i = j;
    }
    return out;
}

/** Recursive walk, `.ts` only. */
function walk(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, out);
        else if (e.name.endsWith(".ts")) out.push(full);
    }
    return out;
}

/**
 * The source files of every registry package, tests excluded.
 *
 * ⚠️ The perimeter comes from the REGISTRY, never from a hard-coded `packages/<name>`: a
 * hard-coded path does not break on a move, it silently stops matching, and the consumer
 * would go green having scanned nothing.
 *
 * @returns {string[]} absolute paths, sorted — sorting keeps any derived output stable.
 * @throws {Error} if the registry yields no source file.
 */
function sourceFiles() {
    const registry = require("./packages.cjs");
    const out = [];
    for (const pkg of registry.all()) {
        const src = path.join(pkg.absDir, "src");
        if (fs.existsSync(src)) walk(src, out);
    }
    const kept = out.filter((f) => !EXCLUDED.test(f.replace(/\\/g, "/"))).sort();
    if (kept.length === 0) {
        throw new Error(
            "[tsdoc-examples] le registre ne rend aucun fichier source — le corpus des " +
                "`@example` serait vide, et son consommateur sortirait vert sans rien avoir lu."
        );
    }
    return kept;
}

/** Recursive walk, `.md` only, `node_modules/` skipped. `maxDepth` 0 = this directory only. */
function walkMd(dir, out, maxDepth = Infinity) {
    if (!fs.existsSync(dir)) return out;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules") continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (maxDepth > 0) walkMd(full, out, maxDepth - 1);
        } else if (e.name.endsWith(".md")) out.push(full);
    }
    return out;
}

/**
 * The markdown of the PRODUCT SURFACES — shared corpus of the two example gates.
 *
 * ## Why it lives here and not in each gate (2026-07-31)
 *
 * `validate-docs-examples` and `typecheck-docs-examples` each read `packages/core/docs`
 * through their own `path.join`. As long as the perimeter was one directory, the
 * duplication cost nothing; widening it in two files would have made two perimeters free
 * to diverge. **That failure is already proven one storey down**: the `.d.ts` exclusion
 * lived in two places, only one was fixed, and a gate stayed blind. Same cause, same
 * remedy as for `sourceFiles()` — one corpus, two consumers.
 *
 * ## What "product surface" means, and what it excludes
 *
 * What the corpus contains is what a reader can **copy-paste from npm or GitHub**: the
 * repo root, each package root (the npm storefronts), the package `docs/`, the PUBLIC
 * documentation root `docs/`, and the scaffold. That is the hole measured on 07-31: the
 * project's two most-read documents — `README.md` and `packages/core/README.md` — each
 * carried a copy-pastable `GeoLeaf.POI.add()` on a dissolved API, while a
 * `validate-docs-examples` rule has forbidden it **since item 4 of the V3 overhaul**.
 * The rule was good; its corpus stopped at `packages/core/docs/`.
 *
 * ## 2026-08-11 — `docs/` enters the corpus, and it was the last hole of the same kind
 *
 * ⚠️ **The paragraph above describes the corpus predating the 08-10 documentation
 * split.** On that date `docs/` did not exist as a public root: this module took the
 * repo root at **depth 0**, so it did not descend into it — and nobody noticed because
 * there was nothing to descend into.
 *
 * 🛑 **The cost, measured by elimination over the 79 gates**: `SPECS-PATHS` (landed the
 * day before) guards the PATHS cited by `docs/specs/`, `check-dead-links` guards the
 * `[text](target)` LINKS of the three sub-roots, and the 3 guards guard named TABLES.
 * **None looked at the CODE of the fenced blocks.** A copy-pastable `GeoLeaf.POI.*` was
 * thus as invisible there as it had been in `README.md` before 07-31 — same defect, same
 * cause, one directory further. Verified by running the gate on the three sub-roots
 * before touching this function: `--dir docs/specs` **0**, `--dir docs/reference` **0**,
 * `--dir docs/guides` **3 real violations** (`TESTING_GUIDE.md` taught
 * `GeoLeaf.POI.addPoi()` under a `// CORRECT`).
 *
 * 📌 **One recursive walk over `DOCS_ROOT`, not three over the sub-roots.** Naming
 * `specs`/`reference`/`guides` here would have left any future fourth sub-root out of
 * the scan **in silence** — the failure this function exists to make impossible. The
 * three floors below are the anti-blindness, not the perimeter.
 *
 * Out of perimeter, deliberately:
 *   `_docs_projet/`        internal docs, not a published surface; its classes are
 *                          guarded by `doc-capability-config` and `doc-plugin-manifest`
 *   `.github/`, `e2e/`     0 measured code blocks for the former, contributor-facing for
 *                          the latter — both stay gated for LINKS by `check-dead-links`
 *   `archives/`            records: they cite the code of their date
 *
 * @returns {string[]} absolute paths, sorted.
 * @throws {Error} if the corpus is empty, if a `README.md` present on disk is missing
 *   from it, or if one of the three `docs/` sub-roots is represented by no file.
 */
function productDocsFiles() {
    const registry = require("./packages.cjs");
    const docsPaths = require("./docs-paths.cjs");
    const repoRoot = path.resolve(__dirname, "..", "..");
    const out = [];

    walkMd(repoRoot, out, 0); // repo root — README, CONTRIBUTING, CHANGELOG, CLAUDE
    for (const pkg of registry.all()) {
        walkMd(pkg.absDir, out, 0); // the package's npm storefront
        walkMd(path.join(pkg.absDir, "docs"), out); // its embedded docs
    }
    // The PUBLIC documentation root, walked in full (see the header, 2026-08-11).
    // Resolved through `docs-paths.cjs` and never through `path.join(repoRoot, "docs")`:
    // the root is overridable via `GEOLEAF_DOCS_ROOT`, and a hard-coded path would
    // silently stop matching instead of breaking.
    walkMd(docsPaths.docs(), out);
    // Outside `workspaces` (`!packages/_*`), hence invisible to the registry. Named
    // verbatim for that precise reason: it is the SCAFFOLD, and a defect it carries is
    // re-sown into every plugin created after it.
    walkMd(path.join(repoRoot, "packages", "_plugin-template"), out);

    const kept = [...new Set(out)].sort();
    if (kept.length === 0) {
        throw new Error(
            "[tsdoc-examples] corpus de doc produit vide — le consommateur sortirait vert " +
                "sans avoir lu un seul document."
        );
    }
    // Anti-blindness: the oracle is the disk, the thing under test is the corpus
    // construction. A wrong `path.join` leaves the file in place and out of the scan,
    // and the gate goes green.
    const missing = registry
        .all()
        .map((p) => path.join(p.absDir, "README.md"))
        .filter((f) => fs.existsSync(f) && !kept.includes(f));
    if (missing.length > 0) {
        throw new Error(
            `[tsdoc-examples] ${missing.length} README.md sur le disque hors du corpus : ` +
                missing.map((f) => path.relative(repoRoot, f)).join(", ")
        );
    }
    // Same anti-blindness, applied to the three `docs/` sub-roots — the regime
    // `check-dead-links` already gives them (`mustNotBeEmpty`), for the reason written
    // in its header: a scope that loses its target does not redden, it GOES QUIET. A
    // rename of `docs/specs/` would here drop the corpus from ~148 to ~103 while
    // exiting 0.
    const emptyRoots = ["specs", "reference", "guides"].filter(
        (name) => !kept.some((f) => f.startsWith(docsPaths.docs(name) + path.sep))
    );
    if (emptyRoots.length > 0) {
        throw new Error(
            `[tsdoc-examples] ${emptyRoots.length} sous-racine(s) de ${docsPaths.rel(docsPaths.docs())}/ ` +
                `sans aucun .md dans le corpus : ${emptyRoots.join(", ")} — le consommateur ` +
                "sortirait vert en ayant lu beaucoup moins."
        );
    }
    return kept;
}

module.exports = { extractTsdocExamples, sourceFiles, productDocsFiles, EXCLUDED };
