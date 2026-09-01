#!/usr/bin/env node
/**
 * GENERATED-ARTIFACT directories — one definition, three readers.
 *
 * Readers: `verify-repo-hygiene.cjs` (check 4, exemption from the 700-line limit;
 * check 5, indexing ban) and `check-package-files.cjs` (check 2, npm publication ban). A
 * second list would diverge — the very reason `lib/source-inventory.cjs` and
 * `lib/test-load-sites.cjs` were extracted.
 *
 * ## Why path SHAPES, and never locations
 *
 * `verify-repo-hygiene.cjs` already carried this list, under the name
 * `GENERATED_PATH_RE`. Measured before the extraction: it matched **zero files**. It was
 * only consulted by `collectSourceFiles`, whose perimeter is `<pkg>/src` — yet no
 * `docs/api`, `docs/public` nor `docs-dist` lives under a `src/`. The repo's list of
 * artifact paths was itself empty-green, while 90 generated TypeDoc files were tracked by
 * git and published to npm.
 *
 * Hence the design rule, which is the earlier audit's lesson applied literally: writing
 * `packages/core/docs/api` verbatim would reproduce the fault identically. The day the
 * core moves, or `docs-dist/` leaves `packages/`, an absolute shape stops matching — it
 * does not MISS violations, it goes **green while no longer looking at anything**. None of
 * the three shapes below names its parent: all survive moves.
 *
 * ## The indispensable complement: derivation from the producer
 *
 * A list of shapes, even relative ones, stays blind to a RENAME: if `typedoc.json`
 * switches to `"out": "docs/reference"`, no generated file falls in the perimeter anymore
 * and nothing turns red. `declaredOutputs()` reads the producer's declaration instead of
 * copying its path, which lets the gate SAY it has lost sight of an output — instead of
 * keeping quiet.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");

/**
 * The path shapes that designate a generated-artifact directory.
 *
 * ⚠️ Relative and parentless, deliberately — see this module's header.
 */
const GENERATED_DIR_FORMS = [
    { form: "docs/api", label: "sortie TypeDoc (typedoc.json → out)" },
    { form: "docs/public", label: "assets statiques VitePress (deploy-docs.cjs steps 2 + 2b)" },
    { form: "docs-dist", label: "build VitePress (.vitepress/config.ts → outDir)" },
];

/**
 * The artifact root containing `p`, or `null`.
 *
 * Comparison by SEGMENTS, never by substring: `docs/publicity/x.md` and
 * `packages/my-docs-dist-tool/a.js` are not artifacts, whereas a
 * `String.includes("docs/public")` or `includes("docs-dist")` would capture both. A false
 * positive here would redden a gate on hand-written source.
 *
 * Returning the ROOT (and not just `true`) is what allows grouping the report: 91 lines of
 * HTML are unreadable, 2 lines with counters read fine.
 *
 * @param {string} p Repo-relative path (`/` or `\` separators).
 * @returns {{root: string, form: string, label: string} | null}
 */
function generatedRootOf(p) {
    const parts = String(p).replaceAll("\\", "/").split("/");
    for (const { form, label } of GENERATED_DIR_FORMS) {
        const f = form.split("/");
        for (let i = 0; i + f.length <= parts.length; i++) {
            if (f.every((seg, k) => parts[i + k] === seg)) {
                return { root: parts.slice(0, i + f.length).join("/"), form, label };
            }
        }
    }
    return null;
}

/** Boolean shortcut of `generatedRootOf`. */
const isGeneratedPath = (p) => generatedRootOf(p) !== null;

/**
 * The outputs a producer DECLARES, read from its declaration.
 *
 * Today: the `out` of every `typedoc.json` in the registry. `docs/public` has no
 * declarative producer (those are JS constants in `deploy-docs.cjs`), and `docs-dist` is
 * declared in a `.ts` this module does not parse — both stay covered by
 * `GENERATED_DIR_FORMS`. The two halves compensate each other: this one is alive on a
 * fresh clone where nothing has been generated yet, that one covers what no JSON declares.
 *
 * @returns {Array<{producer: string, rel?: string, error?: string}>}
 */
function declaredOutputs() {
    const out = [];
    for (const pkg of require("./packages.cjs").all()) {
        const cfg = path.join(pkg.absDir, "typedoc.json");
        if (!fs.existsSync(cfg)) continue;
        let json;
        try {
            json = JSON.parse(fs.readFileSync(cfg, "utf8"));
        } catch (e) {
            out.push({
                producer: `${pkg.dir}/typedoc.json`,
                error: `JSON invalide — ${e.message}`,
            });
            continue;
        }
        // A missing `out` is not neutral: TypeDoc's default is `./docs`, i.e. the
        // HAND-WRITTEN tree. It would overwrite 62 .md files with generated HTML. Silent
        // would be worse than red.
        if (typeof json.out !== "string" || json.out.length === 0) {
            out.push({
                producer: `${pkg.dir}/typedoc.json`,
                error: 'pas de "out" — TypeDoc écrirait dans ./docs, soit l\'arbre rédigé',
            });
            continue;
        }
        out.push({
            producer: `${pkg.dir}/typedoc.json ("out")`,
            rel: `${pkg.dir}/${json.out.replace(/^\.\//, "").replace(/\/+$/, "")}`,
        });
    }
    return out;
}

/**
 * Asks git which of the given paths are ignored. One grouped call.
 *
 * `git check-ignore` exits 1 when nothing matches: that is a normal result here, and
 * emphatically not a failure.
 *
 * The trailing slash is LOAD-BEARING and must be preserved: `.gitignore` writes `dist/`,
 * and a trailing-slash pattern only matches a DIRECTORY. On a bare path
 * (`packages/x/dist`), git cannot know it is a directory if it does not exist on disk —
 * the pattern would not match and the entry would be reported missing. That is precisely
 * the fresh-clone case, before the first build.
 *
 * @param {string[]} queryPaths Repo-relative paths, trailing slash included.
 * @param {{noIndex?: boolean}} [opts] `noIndex` adds `--no-index`: the question becomes
 *   "does a RULE cover this path?" and not "is this path tracked?". Without it, git
 *   refuses to call ignored a path present in the index — which mutes any check run
 *   BEFORE an unindexing.
 * @returns {Set<string>} The ignored subset, as written on input.
 */
function gitIgnoredSet(queryPaths, opts = {}) {
    if (queryPaths.length === 0) return new Set();
    const args = ["check-ignore", "--stdin"];
    if (opts.noIndex) args.push("--no-index");
    const res = spawnSync("git", args, {
        cwd: ROOT,
        input: queryPaths.join("\n"),
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
    });
    if (res.error) return new Set(); // git unavailable → verify everything
    return new Set(
        (res.stdout || "")
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
    );
}

module.exports = {
    GENERATED_DIR_FORMS,
    generatedRootOf,
    isGeneratedPath,
    declaredOutputs,
    gitIgnoredSet,
};
