#!/usr/bin/env node
/**
 * test-load-sites.cjs — the inventory of source-loading `require()`s in the tests.
 *
 * ## Why this module exists
 *
 * `verify-test-load-mode.cjs` (the original gate) and `audit-test-load-conversion.cjs`
 * (the conversion instrument) ask the SAME question — which tests load a source through
 * `require()` — and each carried its own answer. They diverged: the classifier that files
 * a test as "mechanical" had to be fixed **in both scripts** (`vi.isolateModules` counted
 * as mechanical although it reloads a module).
 *
 * A second divergence of that kind is not hypothetical, it already happened. The
 * definition therefore lives here, in one place.
 *
 * ## What counts as a site, and what does not
 *
 * A site is a `require()` whose specifier resolves to a **real `.ts` source module**. A
 * `require()` of a fixture, a mock or an npm package loads no measured source: it cannot
 * skew coverage attribution, and it is reported separately.
 *
 * Two specifier shapes:
 *   - **relative** (`./x.js`, `../x.ts`) — resolved from the file carrying it;
 *   - **bare** (`@core/…`, `@core-offline/…`) — resolved through the package tsconfig's
 *     `paths`.
 *
 * ⚠️ **The bare shape was invisible to both scripts for a long while.** Measured on
 * 07-22: 22 bare sites in `plugin-addpoi` and `plugin-storage`, of which **7 load real
 * core source** — hence 7 misattribution sites the baseline did not count, and one whole
 * test file (`cache-workflow-cross.integration.test.js`) absent from the inventory
 * because it uses ONLY bare specifiers.
 *
 * ## Accepted limit
 *
 * Detection is **syntactic**. A `require()` whose specifier is built at runtime
 * (`require(base + name)`), as well as `createRequire()` and `module.require()`, escape
 * it. No site of that shape is known; a register line tracks verifying it repo-wide. A
 * written limit beats an asserted exhaustiveness.
 *
 * Nor does it distinguish a code `require()` from a `require()` quoted **in a comment**
 * — `storage-helper-validation.test.js` contains one. Behaviour carried over verbatim
 * from the original gate, whose count it reproduces to the unit (276 relative sites):
 * fixing it would move the baseline, which is a decision, not an implementation detail.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

/**
 * A test file, in the sense of the repo's Vitest configs.
 *
 * ⚠️ `setup.js` and the helpers are NOT: Vitest does not collect them as suites, and
 * counting them would mix two distinct questions (coverage attribution, and the
 * "pure ESM" rule of the project instructions).
 */
const TEST_FILE_RE = /\.test\.(js|ts)$/;

/** Directories never walked. */
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage"]);

/**
 * Every test file of a directory, recursively.
 *
 * @param {string} dir Starting directory.
 * @param {string[]} [out] Accumulator.
 * @returns {string[]} Chemins absolus.
 */
function walkTests(dir, out = []) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (SKIP_DIRS.has(e.name)) continue;
            walkTests(full, out);
        } else if (TEST_FILE_RE.test(e.name)) {
            out.push(full);
        }
    }
    return out;
}

/**
 * Reads a `tsconfig.json` tolerant of comments, BOM and trailing commas.
 *
 * ⚠️ The repo's tsconfigs are NOT strict JSON: they carry comments (and
 * `plugin-addpoi/tsconfig.json` a 20-line `_comment` array). A direct `require()` breaks
 * on them. The stripping ignores what sits inside a string, otherwise a path containing
 * `//` would be mangled.
 *
 * @param {string} file Absolute path of the tsconfig.
 * @returns {object} The parsed tsconfig.
 */
function readJsonc(file) {
    const raw = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
    let out = "";
    let inStr = false;
    let quote = "";
    for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        const next = raw[i + 1];
        if (inStr) {
            out += c;
            if (c === "\\") {
                out += next ?? "";
                i++;
            } else if (c === quote) {
                inStr = false;
            }
            continue;
        }
        if (c === '"' || c === "'") {
            inStr = true;
            quote = c;
            out += c;
            continue;
        }
        if (c === "/" && next === "/") {
            while (i < raw.length && raw[i] !== "\n") i++;
            out += "\n";
            continue;
        }
        if (c === "/" && next === "*") {
            i += 2;
            while (i < raw.length && !(raw[i] === "*" && raw[i + 1] === "/")) i++;
            i++;
            continue;
        }
        out += c;
    }
    // Trailing commas: legal in tsconfig, refused by JSON.parse.
    out = out.replace(/,(\s*[}\]])/g, "$1");
    try {
        return JSON.parse(out);
    } catch (err) {
        throw new Error(`test-load-sites: ${path.relative(ROOT, file)} illisible — ${err.message}`);
    }
}

/** Per-package memoization of `paths`: the tsconfig does not move during a run. */
const pathsCache = new Map();

/**
 * A package's `compilerOptions.paths`, flattened into prefix → directories pairs.
 *
 * Inheritance (`extends`) is followed, because the `paths` can come from
 * `@geoleaf/build-config/tsconfig.base.json`. An unresolved `extends` is not an error: it
 * only means there is nothing more to inherit.
 *
 * @param {object} pkg Registry entry (`lib/packages.cjs`).
 * @returns {{prefix: string, targets: string[], wildcard: boolean}[]} Rules, most specific first.
 */
function tsconfigPaths(pkg) {
    if (pathsCache.has(pkg.absDir)) return pathsCache.get(pkg.absDir);

    /** @type {Map<string, {targets: string[], base: string}>} */
    const merged = new Map();

    let file = path.join(pkg.absDir, "tsconfig.json");
    const seen = new Set();
    while (file && fs.existsSync(file) && !seen.has(file)) {
        seen.add(file);
        const cfg = readJsonc(file);
        const dir = path.dirname(file);
        for (const [k, v] of Object.entries(cfg.compilerOptions?.paths ?? {})) {
            // Closest wins: a parent does not rewrite an already-set rule.
            if (!merged.has(k)) merged.set(k, { targets: v, base: dir });
        }
        const ext = cfg.extends;
        if (!ext) break;
        try {
            file = ext.startsWith(".")
                ? path.resolve(dir, ext)
                : require.resolve(ext, { paths: [dir] });
        } catch {
            break;
        }
    }

    const rules = [...merged.entries()]
        .map(([prefix, { targets, base }]) => ({
            prefix,
            wildcard: prefix.includes("*"),
            targets: targets.map((t) => path.resolve(base, t)),
        }))
        // Longest prefix first: `@core/utils/general/*` must beat `@core/utils/*`.
        .sort((a, b) => b.prefix.replace("*", "").length - a.prefix.replace("*", "").length);

    pathsCache.set(pkg.absDir, rules);
    return rules;
}

/**
 * Does a candidate path designate a real `.ts` source module?
 *
 * ⚠️ **`.ts` only.** A `.js` in a `src/` (one exists: `sw-core.js`) is not instrumented
 * as TypeScript source and does not fall under the attribution defect. Including it would
 * inflate the debt with a site no conversion would repair.
 *
 * @param {string} base Absolute path with no guaranteed extension.
 * @returns {string|null}
 */
function asSourceTs(base) {
    for (const c of [
        base,
        base.replace(/\.js$/, ".ts"),
        `${base}.ts`,
        path.join(base, "index.ts"),
    ]) {
        if (c.endsWith(".ts") && fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    }
    return null;
}

/**
 * Resolves a test specifier to a real `.ts` source module.
 *
 * @param {string} fromFile File carrying the specifier (absolute).
 * @param {string} spec Specifier, as written.
 * @param {object} [pkg] Owning package — required to resolve a BARE specifier.
 * @returns {{abs: string, kind: "relative"|"bare"}|null} `null` if it is not a source.
 */
function resolveSource(fromFile, spec, pkg) {
    if (spec.startsWith(".")) {
        const abs = asSourceTs(path.resolve(path.dirname(fromFile), spec));
        return abs ? { abs, kind: "relative" } : null;
    }
    if (!pkg) return null;

    for (const rule of tsconfigPaths(pkg)) {
        if (rule.wildcard) {
            const [head, tail = ""] = rule.prefix.split("*");
            if (!spec.startsWith(head) || !spec.endsWith(tail)) continue;
            const middle = spec.slice(head.length, spec.length - tail.length);
            for (const t of rule.targets) {
                const abs = asSourceTs(t.replace("*", middle));
                if (abs) return { abs, kind: "bare" };
            }
        } else if (spec === rule.prefix) {
            for (const t of rule.targets) {
                const abs = asSourceTs(t);
                if (abs) return { abs, kind: "bare" };
            }
        }
    }
    return null;
}

/**
 * Neutralizes the `vi.mock("…")` calls before analysis.
 *
 * **Declaring a mock does not load the real module.** Forgetting that detail is what once
 * made a census announce "139 modules" where there are 79: the count included the
 * `vi.mock()` targets.
 *
 * @param {string} src Source of the test file.
 * @returns {string}
 */
function scrubMocks(src) {
    return src.replace(/vi\.mock\(\s*(['"])[^'"]*\1/g, "vi.mock(MOCKED");
}

/**
 * Removes comments and string contents, by scanning rather than regexing.
 *
 * A regex cannot tell `// comment` from `"https://…"`, nor a `/*` quoted in a string
 * from a real block. The scanner follows the source's state (single / double / template
 * string / comment) and returns a text of the **same length**, neutralized zones
 * replaced with spaces — line numbers and offsets stay valid.
 *
 * @param {string} src
 * @returns {string}
 */
function stripComments(src) {
    const out = src.split("");
    const blank = (from, to) => {
        for (let k = from; k < to; k += 1) if (out[k] !== "\n") out[k] = " ";
    };
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        const d = src[i + 1];
        if (c === "/" && d === "/") {
            const end = src.indexOf("\n", i);
            blank(i, end === -1 ? src.length : end);
            i = end === -1 ? src.length : end;
        } else if (c === "/" && d === "*") {
            const end = src.indexOf("*/", i + 2);
            const stop = end === -1 ? src.length : end + 2;
            blank(i, stop);
            i = stop;
        } else if (c === '"' || c === "'" || c === "`") {
            const quote = c;
            let j = i + 1;
            while (j < src.length) {
                if (src[j] === "\\") j += 2;
                else if (src[j] === quote) break;
                else j += 1;
            }
            blank(i + 1, Math.min(j, src.length));
            i = Math.min(j + 1, src.length);
        } else {
            i += 1;
        }
    }
    return out.join("");
}

/**
 * A test file's conversion family — this is what files a test under one conversion
 * batch rather than another, and it must stay ONE single definition.
 *
 * ⚠️ `vi.isolateModules` counts with `resetModules`: same move, reload into a fresh
 * registry. Filing them as "mechanical" was an error of the original gate, later fixed —
 * in two scripts at once, which this module exists to prevent.
 *
 * ⚠️ **Classification runs on the source WITHOUT comments**, a later correction.
 * `app/helpers.test.js` carried "Re-require in each describe via vi.isolateModules()" in
 * a comment, without a single call: it was filed "reload", counted into a conversion
 * batch, and the `--prove-reload` harness built it a probe that neutralized nothing.
 * Removing that comment while converting made the check go red — on a perfectly
 * converted file. Three files of the repo change family once comments are stripped.
 *
 * ⚠️ The limit written at the top of the module — "it does not distinguish a `require()`
 * quoted in a comment" — stays true for {@link collectSites}, and **on purpose**: fixing
 * it would move the original baseline, which is a decision and not a detail. Here, the
 * classification feeds no baseline: it only decides ownership.
 *
 * @param {string} src Source of the test file.
 * @returns {"reload"|"mock"|"mechanical"}
 */
function classify(src) {
    const code = stripComments(src);
    if (/resetModules|isolateModules/.test(code)) return "reload";
    if (/vi\.mock\(/.test(code)) return "mock";
    return "mechanical";
}

/** Captures a `require("…")` and its specifier, whatever its shape. */
const REQUIRE_RE = /require\(\s*(['"])([^'"]+)\1\s*\)/;

/**
 * Captures a `require(`…${x}…`)` — a specifier BUILT at runtime.
 *
 * ⚠️ This shape was declared "known limit, no site observed". **That was false**:
 * `geojson/geojson-core.test.js` loops over 9 core source modules through
 * `` require(`../../src/kernel/${subModule}`) ``. Nine misattribution sites no inventory
 * counted — neither the baseline nor the triage.
 *
 * We do NOT try to resolve them: that would mean evaluating the loop. We make them
 * **visible**, so they stop being outside every count and a new site of this shape does
 * not slip by. Their conversion belongs to the reload-conversion batches.
 */
const REQUIRE_TEMPLATE_RE = /require\(\s*`([^`]*)`\s*\)/;

/** Node core modules: never sources of the repo. */
const NODE_BUILTINS = /^(node:)?(module|fs|path|url|util|os|crypto|child_process|assert)$/;

/**
 * Every `require()` site of a package's tests.
 *
 * @param {object} pkg Registry entry.
 * @returns {{file: string, spec: string, mod: string|null, kind: string, line: number,
 *            deferred: boolean, family: string}[]}
 */
function collectSites(pkg) {
    const sites = [];
    for (const tf of walkTests(pkg.absDir)) {
        const raw = fs.readFileSync(tf, "utf8");
        const family = classify(raw);
        scrubMocks(raw)
            .split("\n")
            .forEach((line, i) => {
                const tpl = line.match(REQUIRE_TEMPLATE_RE);
                if (tpl) {
                    sites.push({
                        file: path.relative(ROOT, tf).split(path.sep).join("/"),
                        spec: "`" + tpl[1] + "`",
                        mod: null,
                        kind: "dynamic",
                        line: i + 1,
                        deferred: /^\s/.test(line),
                        family,
                    });
                    return;
                }
                const m = line.match(REQUIRE_RE);
                if (!m) return;
                const spec = m[2];
                if (NODE_BUILTINS.test(spec)) return;
                const hit = resolveSource(tf, spec, pkg);
                sites.push({
                    file: path.relative(ROOT, tf).split(path.sep).join("/"),
                    spec,
                    mod: hit ? path.relative(ROOT, hit.abs).split(path.sep).join("/") : null,
                    kind: hit ? hit.kind : spec.startsWith(".") ? "relative" : "bare",
                    line: i + 1,
                    // Indentation = the `require` sits in a hook, a `describe` or an
                    // `it`, hence DEFERRED. A heuristic, but derived from the source and
                    // not from a reading.
                    deferred: /^\s/.test(line),
                    family,
                });
            });
    }
    return sites;
}

module.exports = {
    ROOT,
    walkTests,
    readJsonc,
    tsconfigPaths,
    resolveSource,
    scrubMocks,
    stripComments,
    classify,
    collectSites,
    REQUIRE_RE,
    REQUIRE_TEMPLATE_RE,
};
