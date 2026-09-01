#!/usr/bin/env node
/**
 * PKG-FILES: every entry of a package's `files[]` must exist on disk.
 *
 * npm silently drops a `files[]` entry that points at nothing, so a package can
 * declare it ships a LICENSE and publish without one for months. That is exactly
 * what happened here: 10 packages declared a LICENSE that was not on disk, and
 * plugin-addpoi listed "LICENCE" (French spelling) — an entry that could never
 * have matched. This gate catches the class, not the ten instances.
 *
 * Build outputs are exempt: an entry that git ignores (typically "dist/") is an
 * artifact whose absence is normal on a fresh clone or before a build. Checking
 * it would make the gate fail in pre-commit for a reason that is not a defect.
 *
 * Usage: node scripts/check-package-files.cjs (from repo root)
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

// `gitIgnoredSet` used to live here. Moved into `lib/generated-artifacts.cjs` with its
// comment on the load-bearing trailing slash: `verify-repo-hygiene.cjs` needs it for
// the same use (check 5c), and two copies of 10 lines of code + 12 of comment are
// exactly what `ci:local`'s `dup:check` gate reports.
const {
    generatedRootOf,
    declaredOutputs,
    gitIgnoredSet,
} = require("./lib/generated-artifacts.cjs");

// From the workspace registry, not a one-level `readdirSync`. The
// registry already applies the root "!packages/_*" negation, so _plugin-template
// stays excluded for the same reason as before: it is a scaffold, never built and
// never published, and its files[] describes what a GENERATED plugin ships.
//
// The previous form enumerated direct children of packages/ only. After ARCHI S10
// moves packages under `packages/plugins/`, it would have found no package.json at
// that level and validated ZERO packages — green, and blind to every phantom
// files[] entry it exists to catch.
const registry = require("./lib/packages.cjs");
const packages = registry.all();

// Collect every (package, entry) pair first so ignore status is resolved in one call.
const candidates = [];
/** The `files[]` intact, in ORDER — check 2 depends on it (last matching rule wins). */
const filesByPkg = [];
for (const pkgEntry of packages) {
    const name = pkgEntry.dirName;
    const pkgPath = path.join(pkgEntry.absDir, "package.json");
    let pkg;
    try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    } catch (e) {
        console.error(
            `ERROR [PKG-FILES]: ${pkgEntry.dir}/package.json is not valid JSON — ${e.message}`
        );
        process.exit(1);
    }
    if (!Array.isArray(pkg.files)) continue;
    filesByPkg.push({ pkgEntry, files: pkg.files });
    for (const entry of pkg.files) {
        if (typeof entry !== "string" || entry.length === 0) continue;
        // A NEGATED entry is an exclusion, not a shipment. The reflex of skipping it
        // would be the very blindness this gate combats: a faulty `!docs/apis/`
        // (plural) removes NOTHING and npm publishes the artifact without a word. What
        // must exist — or be ignored — is its TARGET; we validate it like the others.
        const target = entry.startsWith("!") ? entry.slice(1) : entry;
        // A glob cannot be resolved by existence alone — npm expands it at pack time.
        if (/[*?[\]]/.test(target)) continue;
        const clean = target.replace(/\/+$/, "");
        candidates.push({
            pkg: name,
            entry,
            // Sent to git verbatim, trailing slash included (see gitIgnoredSet).
            // Built from the registry's repo-relative dir so it stays correct once
            // ARCHI S10 nests packages one level deeper.
            query: `${pkgEntry.dir}/${target}`,
            rel: `${pkgEntry.dir}/${clean}`,
            abs: path.join(pkgEntry.absDir, clean),
        });
    }
}

const ignored = gitIgnoredSet(candidates.map((c) => c.query));
const missing = candidates.filter((c) => !ignored.has(c.query) && !fs.existsSync(c.abs));

// ⚠️ Both checks report BEFORE exiting, and the script exits only once, at the very
// bottom. Check 1 used to `process.exit(1)` on the spot: check 2 was then UNREACHABLE
// as soon as one entry was missing — i.e. a faulty `files[]` masked an embarked
// artifact. Found while laying check 2 — `probe-gate-visibility` stayed red because
// the probe carries a check-1 defect by construction, and check 2 never got to speak.
if (missing.length > 0) {
    console.error("ERROR [PKG-FILES]: package.json declares files[] entries that do not exist:");
    for (const { entry, rel } of missing) {
        // `rel` already carries the registry's directory. The label, though, used to
        // hard-prefix `packages/` + dirName — hence `packages/storage/package.json` for
        // a package living at `packages/plugins/offline-ui/`. A wrong path, not
        // clickable, and invisible to the probe whose needle appears in both forms.
        console.error(
            `  ${path.posix.dirname(rel)}/package.json — files[] "${entry}" → ${rel} not found`
        );
    }
    console.error("");
    console.error("npm drops these silently: the package publishes without them.");
}

// ─── PKG-FILES 2 — `files[]` ships no artifact directory ────
//
// npm DOES NOT APPLY the root `.gitignore` inside a directory listed in `files[]`.
// Traced in npm-packlist@8 → ignore-walk: each `files[]` entry becomes an inverted
// rule (`!docs`, `!docs/**`) injected under the name `package.json`, and the sets are
// evaluated in the order `[defaultRules, package.json, .npmignore, .gitignore]` with
// the LAST matching rule winning. The root `.gitignore` is indeed re-injected, but
// into `defaultRules` — hence BEFORE, hence overridden. (That is also why `dist/`,
// gitignored, does ship in the tarball.)
//
// Consequence: gitignoring an artifact does not remove it from the npm package. The
// only exclusion that works is a NEGATION in `files[]`, placed AFTER the entry that
// covers it. That is the invariant this check guards — statically, without `npm pack`,
// hence probeable without `npm install`.
//
// Perimeter = union of two halves that compensate each other:
//   • the outputs DECLARED by a producer (`typedoc.json` → `out`), alive even on a
//     fresh clone where nothing has been generated yet;
//   • the artifact roots present ON DISK, which cover what no JSON declares
//     (`docs/public` comes out of JS constants in `deploy-docs.cjs`).

/** A package's artifact roots: declared by a producer, or seen on disk. */
function artifactRootsOf(pkgEntry) {
    const roots = new Set();
    for (const d of declaredOutputs()) {
        if (d.rel && d.rel.startsWith(`${pkgEntry.dir}/`)) roots.add(d.rel);
    }
    const walk = (abs, rel, depth) => {
        if (depth > 4 || !fs.existsSync(abs)) return;
        for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
            if (!e.isDirectory() || e.name === "node_modules") continue;
            const childRel = `${rel}/${e.name}`;
            const hit = generatedRootOf(childRel);
            if (hit && hit.root === childRel) roots.add(childRel);
            else walk(path.join(abs, e.name), childRel, depth + 1);
        }
    };
    walk(pkgEntry.absDir, pkgEntry.dir, 0);
    return [...roots];
}

const shipped = [];
for (const { pkgEntry, files } of filesByPkg) {
    for (const root of artifactRootsOf(pkgEntry)) {
        // Last rule wins: we look for the index of the last entry that COVERS this
        // root, positive or negated. A negation placed before the entry it claims to
        // correct removes nothing — npm would publish anyway.
        let coveredBy = -1;
        let negated = false;
        files.forEach((entry, i) => {
            if (typeof entry !== "string" || entry.length === 0) return;
            const isNeg = entry.startsWith("!");
            const target = (isNeg ? entry.slice(1) : entry).replace(/\/+$/, "");
            const abs = `${pkgEntry.dir}/${target}`;
            if (root === abs || root.startsWith(`${abs}/`)) {
                coveredBy = i;
                negated = isNeg;
            }
        });
        if (coveredBy >= 0 && !negated) {
            shipped.push({ pkgEntry, entry: files[coveredBy], root });
        }
    }
}

if (shipped.length > 0) {
    console.error("ERROR [PKG-FILES]: files[] ships GENERATED artifact directories:");
    for (const { pkgEntry, entry, root } of shipped) {
        console.error(`  ${pkgEntry.dir}/package.json — files[] "${entry}" embarque ${root}`);
    }
    console.error("");
    console.error('Ajouter une négation APRÈS l\'entrée qui la couvre, ex. "!docs/api/".');
    console.error(
        "Gitignorer ne suffit PAS : npm ignore le .gitignore dans un répertoire de files[]."
    );
}

// ─── PKG-FILES 3 (10/08/2026) — a GLOBBED NEGATION must remove ──
//
// Check 1 deliberately skips every globbed entry (`:74`): a glob is not validated by
// existence, npm expands it at pack time. Correct for a POSITIVE entry — a
// `dist/**/*.js` matching nothing only ships less. Wrong for a NEGATED entry, and that
// is the asymmetry this check closes.
//
// A globbed negation that stops matching **says nothing and removes nothing**: the file
// it was meant to exclude returns to the tarball, the gate stays green, and one only
// learns of it by unpacking. It is word for word the class the project instructions
// describe for hard-coded paths — "it silently stops matching, and the gate goes green
// having scanned nothing". The repo had no globbed negation before 2026-08-10; the
// first (`!dist/**\/*.js.map` of the core, removing 6 maps of 872 KB) arrived into a
// blind spot, not into a net.
//
// ⚠️ The converter only covers a SUBSET of the syntax, and it REFUSES the rest rather
// than letting it through. Silently accepting a class (`[abc]`, `{a,b}`) it cannot
// translate would produce exactly the green-without-measurement it exists to prevent.
//
// 🛑 WHAT IT DOES NOT GUARD, measured the day it landed and written here so it is not
// credited with it. Seen red on three mutations (wrong extension, moved directory,
// unsupported syntax) and GREEN on the one that matters most: **removing the negation
// entirely**. It judges the negations PRESENT, never the absence of an expected
// negation — it cannot, without hard-coding each package's shipping policy. A deleted
// `!…` thus puts 872 KB of maps back into the core's tarball without a word from here;
// what does see it is `npm pack --dry-run`, left as a named follow-up. A guard seen
// red on one mutation can stay hollow for another: this one is, and the limit is
// named.
const GLOB_SUPPORTED = /^[A-Za-z0-9_./*?-]+$/;

/**
 * A `files[]` glob as an anchored RegExp, over the supported subset.
 * @param {string} glob Package-relative pattern, POSIX separators, no leading `!`.
 * @returns {RegExp} Expression anchored on a package-relative path.
 */
function globToRegExp(glob) {
    let re = "";
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === "*") {
            if (glob[i + 1] === "*") {
                // `**/` crosses zero or more segments; `**` alone, the rest of the path.
                if (glob[i + 2] === "/") {
                    re += "(?:[^/]+/)*";
                    i += 2;
                } else {
                    re += ".*";
                    i += 1;
                }
            } else {
                re += "[^/]*";
            }
        } else if (c === "?") re += "[^/]";
        else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`^${re}$`);
}

/** Every file of a package, relative to its root, `node_modules/` excluded. */
function filesUnder(absDir) {
    /** @type {string[]} */
    const out = [];
    const walk = (dir, rel) => {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (_e) {
            return;
        }
        for (const e of entries) {
            if (e.name === "node_modules" || e.name === ".git") continue;
            const next = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) walk(path.join(dir, e.name), next);
            else out.push(next);
        }
    };
    walk(absDir, "");
    return out;
}

/** @type {{pkg: string, entry: string, why: string}[]} */
const inertNegations = [];
let negatedGlobsChecked = 0;
let negatedGlobHits = 0;

for (const { pkgEntry, files } of filesByPkg) {
    /** @type {string[]|null} */
    let corpus = null;
    for (const entry of files) {
        if (typeof entry !== "string" || !entry.startsWith("!")) continue;
        const target = entry.slice(1);
        if (!/[*?[\]{}]/.test(target)) continue; // not globbed — check 1 handles it
        negatedGlobsChecked += 1;
        if (!GLOB_SUPPORTED.test(target)) {
            inertNegations.push({
                pkg: pkgEntry.dir,
                entry,
                why: "syntaxe hors du sous-ensemble supporté — ce check REFUSE de conclure plutôt que de sortir vert sans avoir mesuré",
            });
            continue;
        }
        if (corpus == null) corpus = filesUnder(pkgEntry.absDir);
        const re = globToRegExp(target);
        const hits = corpus.filter((f) => re.test(f));
        negatedGlobHits += hits.length;
        if (hits.length === 0) {
            inertNegations.push({
                pkg: pkgEntry.dir,
                entry,
                why: "ne matche AUCUN fichier sur le disque — l'exclusion est inerte, le tarball emporte ce qu'elle prétend retirer",
            });
        }
    }
}

if (inertNegations.length > 0) {
    console.error("ERROR [PKG-FILES]: négation globée qui ne retire rien :");
    for (const { pkg, entry, why } of inertNegations) {
        console.error(`  ${pkg}/package.json — files[] "${entry}" : ${why}`);
    }
    console.error("");
    console.error("Une négation qui ne matche rien est indiscernable d'une négation absente.");
    console.error("Vérifier par `npm pack --dry-run -w <paquet>` ce que le tarball emporte.");
}

if (missing.length > 0 || shipped.length > 0 || inertNegations.length > 0) {
    process.exit(1);
}

const checked = candidates.length - ignored.size;
console.log(
    `✅ [PKG-FILES] ${checked} files[] entries exist across ${packages.length} packages ` +
        `(${ignored.size} build outputs skipped), 0 generated artifact shipped, ` +
        `${negatedGlobsChecked} négation(s) globée(s) retirant ${negatedGlobHits} fichier(s).`
);
process.exit(0);
