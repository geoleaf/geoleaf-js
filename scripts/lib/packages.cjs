#!/usr/bin/env node
/**
 * The derived truth about which packages this monorepo contains.
 *
 * Shared by every gate and tool that needs to enumerate packages:
 *   - `scripts/verify-plugin-contract.cjs`  — was a hand-typed 13-entry PLUGINS list
 *   - `scripts/check-bundle-size.cjs`       — was a hand-typed 13-name list
 *   - `scripts/publish-plugins.cjs`         — was 2 hard-coded workspace paths
 *   - `scripts/build-deploy.cjs`            — was 13 hard-coded DIST_* constants
 *   - the 8 gates that used to call `readdirSync(packages)` at one level
 *
 * ## Why derive instead of listing
 *
 * The same list was written down in **seven** places, and they had already drifted
 * apart: `knip.json` still declared `packages/plugin-taxonomy` and
 * `packages/plugin-feature-info`, deleted months earlier; the root `test` script and
 * `vitest.config.ts#projects` disagreed on nine packages. Nobody noticed, because a
 * list that nobody derives is a list that nobody checks — the same lesson
 * `side-effect-modules.cjs` records for `package.json#sideEffects`.
 *
 * ## Why `package.json#workspaces` is the source, and not a directory walk
 *
 * A walk that hard-codes "look one or two levels under packages/" would be a SECOND
 * encoding of the tree, free to drift from the first — precisely the class of bug
 * this module exists to kill. The workspaces globs are already the authority npm
 * itself obeys, so deriving from them means the registry cannot disagree with npm.
 *
 * It also makes ARCHI S10 (moving 13 plugins to `packages/plugins/` and 3 libs to
 * `packages/libs/`) a one-line change: edit the globs, and every consumer follows.
 *
 * ## Failure is loud, by construction
 *
 * Every gate this replaces shared one shape:
 *
 *     for (const dir of readdirSync(PACKAGES_DIR))
 *         if (!existsSync(join(dir, "src"))) continue;   // ← silent
 *
 * After S10 that `continue` would skip `packages/plugins/` and `packages/libs/`,
 * and the gate would report 0 violations across 16 packages while scanning none of
 * them: exit 0, green, blind. So this module throws rather than skips — on an
 * unreadable manifest, on a duplicate package name, and on a glob shape it cannot
 * expand. A registry that silently returns fewer packages than it should is worse
 * than no registry.
 *
 * Usage:
 *   const registry = require("./lib/packages.cjs");
 *   registry.all();          // every workspace package
 *   registry.plugins();      // those that ship a geoleaf-<name>.plugin.js bundle
 *   registry.publishable();  // those npm would actually publish (private !== true)
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

/**
 * Expand one workspace glob into absolute directory paths.
 *
 * Deliberately supports only the two shapes this repo uses — a literal path
 * (`packages/core`) and a single trailing wildcard segment (`packages/plugins/*`).
 * Anything else throws instead of being approximated: a glob quietly expanding to
 * the wrong set is the failure mode this whole module exists to prevent.
 *
 * Note the wildcard is matched against directory entries only, so a stray file
 * under `packages/` can never be mistaken for a package.
 *
 * @param {string} pattern Workspace glob, repo-relative, POSIX separators.
 * @returns {string[]} Absolute paths to candidate directories.
 */
function expandGlob(pattern) {
    const starCount = (pattern.match(/\*/g) || []).length;

    if (starCount === 0) {
        const abs = path.join(ROOT, pattern);
        return fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? [abs] : [];
    }

    // Only `<prefix>/*` is supported — one star, and it must be the last segment.
    const segments = pattern.split("/");
    const starIndex = segments.findIndex((s) => s.includes("*"));
    if (starCount > 1 || starIndex !== segments.length - 1 || segments[starIndex] !== "*") {
        throw new Error(
            `packages.cjs: unsupported workspace glob "${pattern}". ` +
                `Only a literal path or a single trailing "/*" is supported — ` +
                `add explicit globs to package.json#workspaces rather than a deeper wildcard.`
        );
    }

    const parentAbs = path.join(ROOT, ...segments.slice(0, -1));
    if (!fs.existsSync(parentAbs)) return [];

    return fs
        .readdirSync(parentAbs, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(parentAbs, e.name));
}

/**
 * Does `dirAbs` match the negative pattern `pattern` (leading "!" already stripped)?
 * Same two supported shapes as {@link expandGlob}.
 *
 * @param {string} dirAbs Absolute directory path.
 * @param {string} pattern Negative glob without its leading "!".
 * @returns {boolean}
 */
function matchesNegation(dirAbs, pattern) {
    const rel = path.relative(ROOT, dirAbs).split(path.sep).join("/");
    const relSegs = rel.split("/");
    const patSegs = pattern.split("/");
    if (relSegs.length !== patSegs.length) return false;

    return patSegs.every((pat, i) => {
        if (!pat.includes("*")) return pat === relSegs[i];
        // Only the `prefix*` / `*` shapes occur here (e.g. "_*" for scaffolds).
        const re = new RegExp("^" + pat.split("*").map(escapeRegExp).join(".*") + "$");
        return re.test(relSegs[i]);
    });
}

/** @param {string} s @returns {string} */
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** @type {ReturnType<typeof build> | null} */
let cache = null;

/**
 * Read every workspace manifest once and index it.
 * @returns {{packages: object[], byName: Map<string, object>}}
 */
function build() {
    const rootManifestPath = path.join(ROOT, "package.json");
    const rootManifest = JSON.parse(fs.readFileSync(rootManifestPath, "utf8"));
    const globs = rootManifest.workspaces;

    if (!Array.isArray(globs) || globs.length === 0) {
        throw new Error("packages.cjs: package.json#workspaces is missing or not an array.");
    }

    const positives = globs.filter((g) => !g.startsWith("!"));
    const negatives = globs.filter((g) => g.startsWith("!")).map((g) => g.slice(1));

    /** @type {Set<string>} */
    const dirs = new Set();
    for (const g of positives) for (const d of expandGlob(g)) dirs.add(d);

    /** @type {object[]} */
    const packages = [];
    /** @type {Map<string, object>} */
    const byName = new Map();

    for (const dirAbs of [...dirs].sort()) {
        if (negatives.some((n) => matchesNegation(dirAbs, n))) continue;

        const manifestPath = path.join(dirAbs, "package.json");
        // A directory matched by a workspace glob but carrying no manifest is not an
        // error: npm ignores it, and `packages/*` legitimately matches containers
        // such as `packages/plugins/` once S10 lands. What WOULD be an error is a
        // manifest we cannot read — that is a package silently dropping out.
        if (!fs.existsSync(manifestPath)) continue;

        let manifest;
        try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        } catch (err) {
            throw new Error(
                `packages.cjs: cannot parse ${path.relative(ROOT, manifestPath)} — ${err.message}`
            );
        }

        if (!manifest.name) {
            throw new Error(
                `packages.cjs: ${path.relative(ROOT, manifestPath)} has no "name" field.`
            );
        }

        const relDir = path.relative(ROOT, dirAbs).split(path.sep).join("/");
        const entry = {
            /** Package name as declared in its manifest, e.g. "@geoleaf-plugins/table". */
            name: manifest.name,
            /** Repo-relative directory, POSIX separators, e.g. "packages/plugin-table". */
            dir: relDir,
            /** Absolute directory path. */
            absDir: dirAbs,
            /** Directory basename, e.g. "plugin-table". */
            dirName: path.basename(dirAbs),
            /** True when npm would refuse to publish it. */
            private: manifest.private === true,
            /** The parsed manifest, for consumers needing more than the above. */
            manifest,
        };

        if (byName.has(entry.name)) {
            const first = byName.get(entry.name);
            throw new Error(
                `packages.cjs: duplicate package name "${entry.name}" — ` +
                    `${first.dir} and ${entry.dir}. npm cannot resolve this; fix one manifest.`
            );
        }

        byName.set(entry.name, entry);
        packages.push(entry);
    }

    if (packages.length === 0) {
        throw new Error(
            "packages.cjs: no workspace package found. The workspaces globs in package.json " +
                "no longer match anything — this is the silent-blindness failure this registry exists to prevent."
        );
    }

    return { packages, byName };
}

/** @returns {{packages: object[], byName: Map<string, object>}} */
function loaded() {
    if (cache === null) cache = build();
    return cache;
}

/**
 * Every workspace package, sorted by directory.
 * @returns {object[]}
 */
function all() {
    return loaded().packages.slice();
}

/**
 * Look a package up by its manifest name.
 * @param {string} name e.g. "@geoleaf/core"
 * @returns {object|undefined}
 */
function byName(name) {
    return loaded().byName.get(name);
}

/**
 * The packages that ship a runtime plugin bundle.
 *
 * A plugin is identified by its published scope: `@geoleaf-plugins/*`. No exception.
 *
 * ⚠️ There was one, and its disappearance is the rename's real gain: the connector
 * predated the scope and kept `@geoleaf/connector`, which forced this rule to be written
 * on two branches. A two-branch membership rule copies badly — the root `package.json`
 * filtered `build:plugins` on `--filter=@geoleaf-plugins/*`, hence WITHOUT the connector,
 * and nobody had noticed. One branch, and the question can no longer arise.
 *
 * Shared internal libraries (`field-renderer`, `http-helpers`, the host runtime) are NOT
 * plugins: they never call `register()` and never enrich `GeoLeaf.*` — cf. Plugin
 * Contract spec §0.
 *
 * Each entry gains `pluginName` (registry id, e.g. "table") and `bundleFile`
 * (e.g. "geoleaf-table.plugin.js").
 *
 * @returns {object[]}
 */
function plugins() {
    return loaded()
        .packages.filter((p) => p.name.startsWith("@geoleaf-plugins/"))
        .map((p) => {
            const pluginName = p.name.split("/")[1];
            return { ...p, pluginName, bundleFile: `geoleaf-${pluginName}.plugin.js` };
        });
}

/**
 * The packages npm would actually publish.
 *
 * NOTE: this is a capability, not a policy. `publish-plugins.cjs` deliberately
 * publishes a narrower, explicit set — do not widen a publication surface just
 * because a package stopped being private.
 *
 * @returns {object[]}
 */
function publishable() {
    return loaded().packages.filter((p) => !p.private);
}

/**
 * Resolve a package by directory basename, throwing when absent.
 *
 * This is the loud replacement for `if (!existsSync(dir)) continue;`. Callers that
 * expect a specific package must fail when it moves, not skip it.
 *
 * @param {string} dirName e.g. "offline-ui"
 * @returns {object}
 */
function requireByDirName(dirName) {
    const found = loaded().packages.find((p) => p.dirName === dirName);
    if (!found) {
        const known = loaded()
            .packages.map((p) => p.dirName)
            .join(", ");
        throw new Error(
            `packages.cjs: no workspace package in a directory named "${dirName}". Known: ${known}`
        );
    }
    return found;
}

/** Drop the memoised manifests. Only tests should need this. */
function reset() {
    cache = null;
}

module.exports = { all, byName, plugins, publishable, requireByDirName, reset, ROOT };
