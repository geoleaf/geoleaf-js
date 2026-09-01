/**
 * Shared source inventory — the single walk of every package's `src/` (ARCHI S11).
 *
 * Two consumers read it and must never disagree about what a "documented file" is:
 *   • `generate-docs-tree.cjs` — renders the commented tree
 *   • `check-module-headers.cjs` — gates new files that arrive undocumented
 *
 * Written as one module for exactly that reason: when a generator and its gate each
 * carry their own copy of the rule, the gate ends up green on a file the generator
 * reports as missing (or the reverse), and neither is wrong on its own terms.
 *
 * ## What counts as documented — and why the bar is a BLOCK, not a TAG
 *
 * Measured at S11 across 808 source files: 66 carry `@module` + `@description`, 452
 * carry a real prose block with NO tag, 290 carry nothing. Requiring the tags would
 * have declared 452 documented files undocumented and produced a 452-file diff whose
 * only effect is cosmetic — this repo's TypeDoc is entry-point driven
 * (`entryPointStrategy: "resolve"`, 2 entry points), so it never reads a per-file
 * `@module` at all. The bar is therefore: a JSDoc block, after the license banner and
 * before the first statement, carrying real prose. Tags are honoured when present,
 * never required.
 */

"use strict";

const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const registry = require("./packages.cjs");
const ROOT = registry.ROOT;

/** Directories that never hold shipped source. */
const SKIP_DIRS = new Set([
    "node_modules",
    "dist",
    "coverage",
    "__tests__",
    "__mocks__",
    "test-utils",
]);

/** A file must clear this many non-whitespace prose characters to count as documented. */
const MIN_PROSE_CHARS = 40;

/**
 * @param {string} name Basename.
 * @param {string[]} extensions Accepted extensions, e.g. `[".ts"]` or `[".ts", ".css"]`.
 */
function isSourceFile(name, extensions = [".ts"]) {
    if (name.endsWith(".d.ts")) return false;
    if (name.includes(".test.") || name.includes(".spec.")) return false;
    return extensions.some((ext) => name.endsWith(ext));
}

// ─── Corpus from the INDEX ───────────────────────────────────────────
//
// ⚠️ WHY THIS SECOND PATH EXISTS, and why it is NOT the default.
//
// The `readdirSync` walk below reads the DISK. An artifact generated from it therefore
// reflects the worktree AT GENERATION TIME, uncommitted modifications included — and
// `generate-docs-tree.cjs --check` then compares the committed file **byte for byte**.
// On a repo with concurrent sessions, the artifact can then NEVER match a fresh clone of
// HEAD.
//
// Measured on 2026-08-01 by the second `ci:push` run: **+251 lines** of drift across
// 6 files, all modified by another session and uncommitted.
//
//     scripts/check-dead-links.cjs        429 → 559   (+130)
//     scripts/lib/tsdoc-examples.cjs      112 → 194   (+82)
//     …
//
// The INDEX is the right reference, not HEAD: it is exactly "what is about to be
// committed". Stage, regenerate, commit both — coherent. Against HEAD, one would have to
// regenerate AFTER committing, hence commit twice. It is also the doctrine
// `verify-ci-scripts-tracked.cjs` already applies, querying the index "precisely to see
// the defect BEFORE the push".
//
// ⚠️ BUT IT IS NOT THE DEFAULT, deliberately. Two GATES read this inventory
// (`check-module-headers.cjs`, `verify-repo-hygiene.cjs`) and must keep seeing a NEW,
// not-yet-staged file — switching them would blind them to what just arrived, which is
// exactly their reason to exist. Only the byte-compared artifact GENERATOR needs the
// index.

/** Paths tracked by git, filtered like the disk walk — same corpus, other source. */
function indexPaths(relDir, extensions) {
    const res = spawnSync("git", ["ls-files", "-z", "--", relDir], {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
    if (res.status !== 0) {
        throw new Error(`source-inventory: \`git ls-files ${relDir}\` a échoué — ${res.stderr}`);
    }
    return res.stdout
        .split("\0")
        .filter(Boolean)
        .filter((rel) => {
            const parts = rel.split("/");
            if (parts.some((p) => SKIP_DIRS.has(p))) return false;
            return isSourceFile(parts[parts.length - 1], extensions);
        })
        .sort();
}

/**
 * Content of several index blobs, in ONE process.
 *
 * ⚠️ `git cat-file --batch` announces sizes in BYTES. Reading is thus done on `Buffer`s
 * and slicing by byte offsets; decoding to UTF-8 before slicing would shift everything
 * from the first non-ASCII character on — and this repo is full of them.
 *
 * @param {string[]} rels Root-relative paths, `/` separator.
 * @returns {Map<string, string>} Path → decoded content.
 */
function readIndexBlobs(rels) {
    const out = new Map();
    if (!rels.length) return out;
    const res = spawnSync("git", ["cat-file", "--batch"], {
        cwd: ROOT,
        input: rels.map((r) => `:${r}`).join("\n") + "\n",
        maxBuffer: 512 * 1024 * 1024,
    });
    if (res.status !== 0) {
        throw new Error(`source-inventory: \`git cat-file --batch\` a échoué — ${res.stderr}`);
    }
    const buf = res.stdout;
    let off = 0;
    for (const rel of rels) {
        const nl = buf.indexOf(0x0a, off);
        if (nl === -1) throw new Error(`source-inventory: sortie tronquée à \`${rel}\``);
        const head = buf.toString("utf8", off, nl);
        // "<oid> missing": a path listed by ls-files yet absent from the index does not
        // happen, but silence on that case would shrink the corpus without saying so.
        if (/ missing$/.test(head)) {
            throw new Error(`source-inventory: \`${rel}\` est suivi mais absent de l'index`);
        }
        const size = Number(head.split(" ")[2]);
        const start = nl + 1;
        out.set(rel, buf.toString("utf8", start, start + size));
        off = start + size + 1; // the newline git appends after the blob
    }
    return out;
}

function walk(dir, acc, extensions = [".ts"]) {
    if (!fs.existsSync(dir)) return acc;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            walk(path.join(dir, entry.name), acc, extensions);
        } else if (isSourceFile(entry.name, extensions)) {
            acc.push(path.join(dir, entry.name));
        }
    }
    return acc;
}

/**
 * LICENSE lines of a `/*!` banner — removed before looking for prose in it.
 *
 * ⚠️ This list is the heart of the banner fix: without it, each file's copyright would
 * suffice to declare it documented, and the gate would become a universal green. With it,
 * only the prose ACTUALLY written under the banner counts.
 */
const BANNER_LICENSE_RE =
    /^(@geoleaf|©|\(c\)|Copyright|Released under|Licensed under|SPDX|https?:|GeoLeaf\s*$)/i;

/** A comment block's prose: decorations removed, tags and license set aside. */
function _proseOf(raw) {
    return raw
        .split("\n")
        .map((l) => l.replace(/^\s*\*\s?/, "").trim())
        .filter((l) => l && !l.startsWith("@") && !BANNER_LICENSE_RE.test(l))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Pulls the module description out of a source file.
 *
 * Order of operations matters: the `/*!` license banner is stripped FIRST, otherwise
 * every file in the repo would appear documented by its copyright header.
 *
 * @returns {{ description: string|null, module: string|null, hasBlock: boolean }}
 */
function extractHeader(source) {
    const bannerMatch = source.match(/^\s*\/\*!([\s\S]*?)\*\//);
    const withoutBanner = source.replace(/^\s*\/\*![\s\S]*?\*\//, "");
    const match = withoutBanner.match(/^\s*\/\*\*([\s\S]*?)\*\//);

    // 🛑 SECOND SHAPE — THE DOC WRITTEN INSIDE THE BANNER WAS THROWN AWAY WITH IT.
    //
    // Stripping the `/*!` block is necessary: without it, EVERY file in the repo would
    // pass for documented through its copyright line — that is what the comment above
    // says, and it is right. But the strip was TOTAL, while 161 files write their
    // description **inside** that banner, under the license lines (measured on
    // 2026-08-16 over the baseline's 273 entries: **59 % were wrong**).
    //
    // ✅ The banner is therefore no longer thrown away wholesale: its LICENSE lines are
    // removed, and what remains is prose like any other. That is the distinction the
    // total strip did not draw — "a banner" and "what was written inside it" are not the
    // same thing.
    if (!match && bannerMatch) {
        const bannerProse = _proseOf(bannerMatch[1]);
        if (bannerProse.replace(/\s/g, "").length >= MIN_PROSE_CHARS) {
            return { description: bannerProse, module: null, hasBlock: true };
        }
    }

    if (!match) return { description: null, module: null, hasBlock: false };

    const raw = match[1];
    const moduleTag = raw.match(/@module\s+(\S+)/);

    // Body = the block minus its tag lines. `@description` is honoured as a section
    // header (its content is the description) rather than as a required marker.
    let body = raw;
    const descTag = raw.match(/@description\s*([\s\S]*?)(?=\n\s*\*\s*@|\s*$)/);
    if (descTag) body = descTag[1];

    const prose = body
        .split("\n")
        .map((l) =>
            l
                .replace(/^\s*\*ic?\s?/, "")
                .replace(/^\s*\*\s?/, "")
                .trim()
        )
        .filter((l) => l && !l.startsWith("@"))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

    if (prose.replace(/\s/g, "").length < MIN_PROSE_CHARS) {
        return { description: null, module: moduleTag ? moduleTag[1] : null, hasBlock: false };
    }
    return { description: prose, module: moduleTag ? moduleTag[1] : null, hasBlock: true };
}

/** First sentence of a description, capped — for the one-line table cell. */
function firstSentence(text, max = 240) {
    if (!text) return null;
    const cut = text.match(/^(.{20,}?[.!?])(\s|$)/);
    let out = cut ? cut[1] : text;
    if (out.length > max) out = out.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
    return out;
}

/**
 * Named exports of a file, read from the source text.
 *
 * Deliberately NOT a TypeScript-compiler pass: this runs on every `ci:local` and the
 * inventory is 800+ files. The forms below cover what this codebase actually writes
 * (verified against the facade//barrel conventions the purity gates already enforce);
 * an export shape that slips through shows up as an empty cell, never as a wrong one.
 */
function extractExports(source) {
    const names = new Set();
    const push = (n) => n && names.add(n.trim());

    // export const/let/function/class/type/interface/enum X
    for (const m of source.matchAll(
        /^export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm
    )) {
        push(m[1]);
    }
    // export { a, b as c }
    for (const m of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
        for (const part of m[1].split(",")) {
            const alias = part.split(/\sas\s/);
            const name = (alias[1] || alias[0] || "").replace(/\btype\b/, "").trim();
            if (name && name !== "default") push(name);
        }
    }
    if (/^export\s+default\b/m.test(source)) push("default");
    if (/^export\s+\*/m.test(source)) push("*");
    return [...names].sort();
}

/**
 * Leading block comment of a non-TypeScript file (`.css`, `.cjs`), as prose.
 *
 * `extractHeader` is deliberately TS-shaped: it strips the `/*!` banner then demands a
 * `/**` block. A stylesheet opens with a single-star `/* … *\/`, so it would always read
 * as undocumented. This is the lighter equivalent — and it feeds the description column
 * only, never the `documented` statistic the module-header gate is built on.
 *
 * @param {string} source
 * @returns {string|null}
 */
function leadingComment(source) {
    const m = source.match(/^\s*\/\*\*?([\s\S]*?)\*\//);
    if (!m) return null;
    const prose = m[1]
        .split("\n")
        .map((l) => l.replace(/^\s*\*\s?/, "").trim())
        .filter((l) => l && !l.startsWith("@"))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    return prose.length >= 20 ? prose : null;
}

/**
 * Walks every workspace package and returns one record per source file.
 *
 * ## Options are OPT-IN, and that is the contract
 *
 * `collect()` with no argument must keep returning exactly what it returned before this
 * parameter existed: `.ts` only, packages only. `check-module-headers.cjs` consumes it to
 * decide which files owe a JSDoc header — widening the default to `.css` would silently
 * demand a module header in 44 stylesheets and turn a green gate red for no reason.
 * The qualified-tree generator asks for the wider set explicitly.
 *
 * @param {{extensions?: string[], includeScripts?: boolean}} [options]
 * @returns {{files: Array<object>, dirs: Set<string>}}
 */
function collect(options = {}) {
    const extensions = options.extensions || [".ts"];
    const includeScripts = options.includeScripts === true;
    // See the "Corpus from the INDEX" banner above. An option, never the default.
    const fromIndex = options.fromIndex === true;
    const files = [];
    const dirs = new Set();
    /** Index contents, preloaded in a single `git cat-file` when `fromIndex`. */
    let indexBlobs = null;

    /** @param {string} abs @param {string} pkgName @param {string} pkgDir @param {string} baseAbs */
    function record(abs, pkgName, pkgDir, baseAbs) {
        const rel0 = path.relative(ROOT, abs).split(path.sep).join("/");
        const source = fromIndex ? indexBlobs.get(rel0) : fs.readFileSync(abs, "utf8");
        if (source === undefined) {
            throw new Error(`source-inventory: aucun contenu d'index pour \`${rel0}\``);
        }
        const rel = path.relative(ROOT, abs).split(path.sep).join("/");
        const isTs = abs.endsWith(".ts");
        const header = isTs
            ? extractHeader(source)
            : { description: leadingComment(source), module: null, hasBlock: false };
        files.push({
            package: pkgName,
            packageDir: pkgDir,
            rel,
            relToPackage: path.relative(baseAbs, abs).split(path.sep).join("/"),
            dir: path.dirname(rel),
            name: path.basename(abs),
            kind: isTs ? "ts" : abs.endsWith(".css") ? "css" : "script",
            loc: source.split("\n").length,
            documented: header.hasBlock,
            description: header.description,
            summary: firstSentence(header.description),
            moduleTag: header.module,
            // Computed on the RAW source, deliberately NOT from `header.module` (MH-03).
            // `extractHeader` only sees the block that leads the file after the license
            // banner, so it is blind to two shapes measured at STRUCT S5: a tag behind a
            // statement (19 files had `"use strict";` before their block, including the 15
            // public facades `core/src/api/geoleaf.*.ts`) and a tag inside the `/*!` banner
            // itself, which `:77` strips before matching (15 files, all host-runtime + i18n).
            // A gate keyed on `moduleTag` would have sorted GREEN over those 34 tags.
            hasModuleTag: /^[ \t]*(?:\*|\/\/)[ \t]*@module[ \t]/m.test(source),
            exports: isTs ? extractExports(source) : [],
        });
        dirs.add(path.dirname(rel));
    }

    // The corpus, in both regimes: same filters, different source.
    /** @type {Array<{abs: string, pkgName: string, pkgDir: string, baseAbs: string}>} */
    const corpus = [];
    for (const pkg of registry.all()) {
        const srcDir = path.join(pkg.absDir, "src");
        const pkgDir = pkg.dir.split(path.sep).join("/");
        if (fromIndex) {
            const relSrc = `${pkgDir}/src`;
            for (const rel of indexPaths(relSrc, extensions)) {
                corpus.push({
                    abs: path.join(ROOT, rel),
                    pkgName: pkg.name,
                    pkgDir,
                    baseAbs: pkg.absDir,
                });
            }
        } else {
            if (!fs.existsSync(srcDir)) continue;
            for (const abs of walk(srcDir, [], extensions).sort()) {
                corpus.push({ abs, pkgName: pkg.name, pkgDir, baseAbs: pkg.absDir });
            }
        }
    }

    if (includeScripts) {
        const scriptsDir = path.join(ROOT, "scripts");
        const scriptExt = [".cjs", ".mjs", ".js"];
        if (fromIndex) {
            for (const rel of indexPaths("scripts", scriptExt)) {
                corpus.push({
                    abs: path.join(ROOT, rel),
                    pkgName: "(scripts)",
                    pkgDir: "scripts",
                    baseAbs: scriptsDir,
                });
            }
        } else {
            for (const abs of walk(scriptsDir, [], scriptExt).sort()) {
                corpus.push({ abs, pkgName: "(scripts)", pkgDir: "scripts", baseAbs: scriptsDir });
            }
        }
    }

    if (fromIndex) {
        indexBlobs = readIndexBlobs(
            corpus.map((c) => path.relative(ROOT, c.abs).split(path.sep).join("/"))
        );
    }
    for (const c of corpus) record(c.abs, c.pkgName, c.pkgDir, c.baseAbs);

    return { files, dirs };
}

module.exports = {
    collect,
    extractHeader,
    extractExports,
    firstSentence,
    leadingComment,
    ROOT,
    MIN_PROSE_CHARS,
};
