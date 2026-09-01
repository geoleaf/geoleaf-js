#!/usr/bin/env node
/**
 * Enforces the `no-plugin-in-core` rule: `packages/core/src/` must stay
 * standalone and never reference a plugin package, so the core remains
 * autonomous and tree-shakeable. A consumer who installs only `@geoleaf/core`
 * must get an engine that boots, with nothing pulled in behind it. See CLAUDE.md.
 *
 * SYNC-01:  no plugin reference in packages/core/src (.ts .js .json) nor in
 *           packages/core/package.json.
 * SYNC-03:  no offline-ui cache UI selector in packages/core/src (.css).
 * SYNC-04:  no CacheSection remnant in packages/core/src (.ts .js .json).
 * SYNC-01b: same as SYNC-01 for the connector plugin (path resolved by the registry).
 * SYNC-02:  in packages/core/docs/, every import/require specifier naming a plugin
 *           must be one a reader can RESOLVE from an `npm install`.
 *
 * SYNC-02 was scoped to the sync-core-public.yml mirror, which is deleted
 * since; it was recorded that it would go with it. It is KEPT deliberately. Its
 * subject is publication hygiene of packages/core/docs/ — the docs shipped on
 * npm — and that concern outlives the mirror. It also grows once
 * the monorepo goes public: the check then applies to the repository itself
 * rather than to a copy of it.
 *
 * ⚠️ SYNC-02 CHANGED AXIS ON 2026-08-10. It used to forbid any import line citing
 * `@geoleaf-plugins/*` — but only when that line carried a `from` or a `require(`. The
 * CANONICAL loading form of a GeoLeaf plugin, the bare side-effect import
 * (`import "@geoleaf-plugins/cog";`), was invisible to it, and 9 lines of that form
 * already lived in `packages/core/docs/`. The `from`/bare split covered NO property
 * anyone sought to guard: it reddened
 * `import { createConnector } from "@geoleaf-plugins/connector"` and let
 * `import "@geoleaf-plugins/connector"` through — two spellings of the same
 * integrator move. It was a regex artifact, not a partition.
 *
 * **The underlying question, and the retained answer.** An import written in a core
 * `.md` is NEVER an import the core executes: it is the INTEGRATOR's. The rule can
 * thus read neither "the imports the core would execute" (it would be empty), nor
 * "any reference" (it would forbid a page teaching plugin loading from showing its
 * import — disarmed within a week). What remains to guard is that what the docs get
 * COPIED be resolvable by the tarball's reader:
 *
 *     the published specifier `@geoleaf-plugins/<name>` is ALLOWED in all its
 *     syntactic forms; what is FORBIDDEN is a specifier `npm install` does not
 *     provide — a monorepo-internal path, a deep path into a plugin, a plugin name
 *     the registry does not know.
 *
 * PROSE vs CODE BLOCK. It is the Markdown transposition of the exemption comment
 * lines already enjoy in SYNC-01/03/04: describing is allowed, making execute is
 * not. A fenced block is what a reader copies; prose describes the ecosystem, and
 * the docblock already admitted it. Measured consequence: the "plugin unknown to the
 * registry" weapon only applies TO CODE BLOCKS, because a CHANGELOG legitimately
 * names a package by the name it carried at its date (`CHANGELOG.md:443` cites
 * `@geoleaf-plugins/storage`, renamed `offline-ui` since — the statement is true at
 * its date). The two other weapons hold everywhere: a monorepo path was NEVER
 * resolvable for a tarball reader, at any date.
 *
 * 🖐 WHAT NO GATE CARRIES, and it must be said: that a core document really is a
 * document OF THE CORE. `CONNECTOR_GUIDE.md` — a plugin's guide housed in the core's
 * docs — was the only case SYNC-02 ever caught, and it caught it BY PROXY, on one of
 * its two lines, by regex accident. It is a PLACEMENT problem, not an import one: it
 * falls under the settled rule — "a package ships the documentation that describes
 * it" — and under human re-reading.
 *
 * ⚠️ Accepted limit: INDENTED code blocks (4 spaces) are not recognized as code. The
 * corpus is formatted by Prettier, which produces none; the day there were some,
 * they would be read as prose. Written here rather than discovered later.
 *
 * Usage: node scripts/verify-core-standalone.cjs (from repo root)
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const registry = require("./lib/packages.cjs");

// The connector lives under `packages/plugins/`; its paths therefore come from the
// registry, which THROWS if the package cannot be found. Without that, SYNC-01b would
// have silently stopped scanning the connector: `collectSources` exits on its
// `existsSync` and the gate announces "no leak" having read nothing.
//
// ⚠️ The CORE's paths had stayed literal, with the written justification that "the
// core stays". That is the argument that always precedes a move, and it protects from
// nothing: the gate does not go red when the path stops matching, it goes MUTE —
// `collectSources` exits on `existsSync`, exactly as for the connector. Both halves
// now go through the same registry, and this gate is the one the project instructions
// call non-negotiable.
const CORE_DIR = registry.requireByDirName("core").absDir;
const CORE_SRC = path.join(CORE_DIR, "src");
const CORE_PKG = path.join(CORE_DIR, "package.json");
const CONNECTOR_DIR = registry.requireByDirName("connector").absDir;
const CONNECTOR_SRC = path.join(CONNECTOR_DIR, "src");
const CONNECTOR_PKG = path.join(CONNECTOR_DIR, "package.json");
const DOCS_DIR = path.join(CORE_DIR, "docs");

// Patterns forbidden in core JS/TS sources and package.json.
// `@geoleaf-plugins` covers every published plugin at once (storage, editor,
// cog, editor, measure, print, table…) and is the canonical form of the
// violation; the three workspace paths cover relative/monorepo imports.
//
// ⚠️ 2026-07-24 — the directories lost their `plugin-` prefix
// (`packages/plugins/plugin-storage` → `packages/plugins/storage`). The three
// alternatives HAD to follow: left at `plugin-storage`, they would have stopped
// matching any path and this gate would have come out GREEN guarding nothing anymore
// — the `no-plugin-in-core` boundary is precisely what cannot be afforded to lose in
// silence. They are now `plugins/<name>`, which also covers the scoped specifier
// (`@geoleaf-plugins/offline-ui` contains `plugins/offline-ui`): redundant with the
// first alternative, and intended.
//
// ⚠️ 2026-07-26 — the SAME failure mode, a second time, nineteen months after the
// first: `packages/plugins/storage` became `packages/plugins/offline-ui`, and the
// alternative — then written `plugins/storage` — would have stopped matching WITHOUT
// reddening. It was seen red before the fix (an import planted in
// `packages/core/src/`), per "every guard must be SEEN reddening".
//
// ⚠️ And a third mode, specific to that rename pass: a renaming `sed` run over this
// file REWRITES these very comments, turning the historical record into a
// contradiction ("the first rename went to offline-ui" — false, it renamed to
// `storage`). Comments that date a rename must be re-read after any mechanical pass.
//
// Do NOT generalise to `plugins?/[a-z-]+`: `plugin-registry.ts` is a core file, and
// `connector` is a plugin the core does not depend on — both would be false
// positives.
const PLUGIN_REF_RE = /(@geoleaf-plugins|plugins\/offline-ui|plugins\/editor|plugins\/cog)/;

// SYNC-03: Patterns forbidden in core CSS (selectors used exclusively by the offline-ui cache UI)
const PLUGIN_CSS_RE =
    /\.(?:gl-cache-(?:modal|control|status|actions|progress|layers|btn|section|button)|geoleaf-ctrl-cache-button)\b/;

// SYNC-04: Patterns forbidden in core TS/JS (CacheSection remnants)
const CORE_CACHE_REMNANTS_RE =
    /\b(?:CacheSection|_LayerManagerCacheSection)\b|["'][^"']*cache-section[^"']*["']/;

// ─── SYNC-02 — l'outillage ────────────────────────────────────────────────────
//
// Extraction of the SPECIFIER from any import/require construct, whatever its
// syntactic form. The four alternatives cover the test bench's six forms:
// `from "…"` takes the named import and the re-export, `require(` and `import(` take
// CommonJS and dynamic, `import "…"` takes the bare side-effect import — the one the
// old pattern missed, and the canonical form.
//
// ⚠️ The pattern does NOT generalise to "any quoted string": an import construct is
// required. Without that, a CHANGELOG sentence citing a path in backticks would
// become a violation, and the gate would get disarmed on false positives — the very
// failure mode the axis change sought to avoid.
const DOCS_SPECIFIER_RE =
    /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;

// Opening/closing of a fenced Markdown block (``` or ~~~, 3 markers or more).
const DOCS_FENCE_RE = /^\s*(`{3,}|~{3,})/;

const PLUGIN_SCOPE = "@geoleaf-plugins";

// ⚠️ Derived from the registry, NEVER hand-written. `PLUGIN_REF_RE` above pins three
// directory names verbatim (`offline-ui`, `editor`, `cog`) and they had to be fixed
// TWICE — the two renames above — each time with the same risk of going green while
// guarding nothing anymore. SYNC-02 does not replay that game: it asks the registry,
// which THROWS if the workspace globs stop matching. The 12 plugins are covered, not
// 3, and a plugin added tomorrow is too without touching this file.
const KNOWN_PLUGIN_NAMES = new Set(registry.plugins().map((p) => p.pluginName));
const PLUGIN_DIR_ALTERNATIVES = registry
    .plugins()
    .map((p) => p.dirName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
const MONOREPO_PLUGIN_PATH_RE = new RegExp(`(?:^|/)plugins/(?:${PLUGIN_DIR_ALTERNATIVES})(?:$|/)`);

/**
 * SYNC-02 — is a `packages/core/docs/` specifier resolvable by the reader?
 *
 * See the head docblock for the partition's rationale. Three weapons, of which two
 * hold everywhere and one only inside a code block:
 *
 *   1. monorepo-internal path (`../../plugins/cog`, `packages/plugins/editor/…`)
 *      → never resolvable outside the repo, at any date. Holds in prose too.
 *   2. deep path into a plugin (`@geoleaf-plugins/editor/src/entry.ts`)
 *      → teaches a private path the package never promised. Holds in prose too.
 *   3. plugin unknown to the registry (`@geoleaf-plugins/storage`, renamed since)
 *      → CODE BLOCK ONLY: a CHANGELOG legitimately names a package by the name it
 *        carried at its date. What the docs get COPIED, however, must exist.
 *
 * ⚠️ Weapon 3 measures the plugin's existence IN THIS REPO, not on the npm registry.
 * The gap between the two is a distinct object, tracked separately, and it cannot be
 * verified offline — conflating the two would make this gate depend on the network.
 *
 * @param {string} spec - the extracted specifier, as written.
 * @param {boolean} inCode - true if the line is inside a fenced block.
 * @returns {string|null} the refusal reason, or null if the specifier resolves.
 */
function docSpecifierVerdict(spec, inCode) {
    if (spec.startsWith(`${PLUGIN_SCOPE}/`)) {
        const [name, ...deep] = spec.slice(PLUGIN_SCOPE.length + 1).split("/");
        if (deep.length > 0) {
            return `chemin profond dans un plugin — "${PLUGIN_SCOPE}/${name}" est la seule forme publiée`;
        }
        if (inCode && !KNOWN_PLUGIN_NAMES.has(name)) {
            return `plugin inconnu du registre — aucun paquet "${PLUGIN_SCOPE}/${name}" dans ce dépôt`;
        }
        return null;
    }
    if (MONOREPO_PLUGIN_PATH_RE.test(spec)) {
        return "chemin interne au monorepo — irrésoluble pour un lecteur du tarball";
    }
    return null;
}

function isCommentOnly(line) {
    const t = line.trim();
    return (
        t.startsWith("//") ||
        t.startsWith("*") ||
        t.startsWith("/*") ||
        t.startsWith("*/") ||
        t === ""
    );
}

function scanDir(dir, results) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (!["node_modules", "dist", ".git"].includes(e.name)) {
                scanDir(full, results);
            }
        } else if (/\.(ts|js|json)$/.test(e.name)) {
            const content = fs.readFileSync(full, "utf8");
            const lines = content.split("\n");
            lines.forEach((line, i) => {
                if (PLUGIN_REF_RE.test(line) && !isCommentOnly(line)) {
                    results.push({
                        file: path.relative(ROOT, full),
                        line: i + 1,
                        content: line.trim(),
                    });
                }
                if (CORE_CACHE_REMNANTS_RE.test(line) && !isCommentOnly(line)) {
                    results.push({
                        kind: "SYNC-04",
                        file: path.relative(ROOT, full),
                        line: i + 1,
                        content: line.trim(),
                    });
                }
            });
        } else if (/\.css$/.test(e.name)) {
            const content = fs.readFileSync(full, "utf8");
            const lines = content.split("\n");
            let inBlockComment = false;
            lines.forEach((line, i) => {
                const trimmed = line.trim();
                // Track /* ... */ block comments (single-line or spanning)
                if (inBlockComment) {
                    if (trimmed.includes("*/")) inBlockComment = false;
                    return;
                }
                if (trimmed.startsWith("/*") && !trimmed.includes("*/")) {
                    inBlockComment = true;
                    return;
                }
                if (trimmed.startsWith("/*") || trimmed === "" || trimmed.startsWith("*")) return;
                if (PLUGIN_CSS_RE.test(line)) {
                    results.push({
                        kind: "SYNC-03",
                        file: path.relative(ROOT, full),
                        line: i + 1,
                        content: trimmed,
                    });
                }
            });
        }
    }
}

function collectMarkdown(dir, results) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            collectMarkdown(full, results);
        } else if (/\.md$/.test(e.name)) {
            results.push(full);
        }
    }
}

/**
 * Looks for a plugin reference in a `package.json`'s DEPENDENCIES, not in its raw
 * text.
 *
 * ⚠️ The previous version tested `PLUGIN_REF_RE` on the whole file's content. That
 * held while the connector was named `@geoleaf/connector`: as soon as it was renamed
 * `@geoleaf-plugins/connector`, the gate flagged a leak in its own `package.json` —
 * because it declares its NAME there. A package that names itself is not a package
 * that depends.
 *
 * The remaining pattern is correct for SOURCES (an import is an import); it was not
 * for a manifest, where the same word plays two roles. So we read the 4 dependency
 * maps, and nothing else.
 *
 * @param {string} pkgPath - path of the package.json.
 * @returns {string|null} the offending specifier, or null.
 */
function pluginDependency(pkgPath) {
    let json;
    try {
        json = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    } catch {
        // An unreadable manifest is not "clean": we refuse to conclude rather than
        // return null, otherwise the gate goes green on a file it could not read.
        console.error(`ERROR [SYNC-01]: ${path.relative(ROOT, pkgPath)} illisible.`);
        process.exit(2);
    }
    for (const champ of [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
    ]) {
        for (const nom of Object.keys(json[champ] ?? {})) {
            if (PLUGIN_REF_RE.test(nom)) return `${champ}.${nom}`;
        }
    }
    return null;
}

// ─── SYNC-01: Scan core sources ───────────────────────────────────────────────
const leaks = [];
scanDir(CORE_SRC, leaks);

if (fs.existsSync(CORE_PKG)) {
    const dep = pluginDependency(CORE_PKG);
    if (dep) leaks.push({ file: "packages/core/package.json", line: null, content: dep });
}

const sync01 = leaks.filter((l) => !l.kind);
const sync03 = leaks.filter((l) => l.kind === "SYNC-03");
const sync04 = leaks.filter((l) => l.kind === "SYNC-04");

if (sync01.length > 0) {
    console.error("ERROR [SYNC-01]: Plugin import or dependency detected in packages/core:");
    sync01.forEach(({ file, line, content }) => {
        console.error(`  ${file}${line != null ? `:${line}` : ""} — ${content}`);
    });
    process.exit(1);
}

console.log("✅ [SYNC-01] No plugin imports in core.");

if (sync03.length > 0) {
    console.error("ERROR [SYNC-03]: Plugin cache CSS selector leaked into core CSS:");
    sync03.forEach(({ file, line, content }) => {
        console.error(`  ${file}:${line} — ${content}`);
    });
    process.exit(1);
}

console.log("✅ [SYNC-03] No plugin cache CSS selectors in core CSS.");

if (sync04.length > 0) {
    console.error("ERROR [SYNC-04]: CacheSection remnant reintroduced in core TS/JS:");
    sync04.forEach(({ file, line, content }) => {
        console.error(`  ${file}:${line} — ${content}`);
    });
    process.exit(1);
}

console.log("✅ [SYNC-04] No CacheSection remnants in core TS/JS.");

// ─── SYNC-01b: Scan connector sources ─────────────────────────────────────────
const connectorLeaks = [];
scanDir(CONNECTOR_SRC, connectorLeaks);

if (fs.existsSync(CONNECTOR_PKG)) {
    const dep = pluginDependency(CONNECTOR_PKG);
    if (dep) {
        connectorLeaks.push({
            file: path.relative(ROOT, CONNECTOR_PKG),
            line: null,
            content: dep,
        });
    }
}

if (connectorLeaks.length > 0) {
    console.error(
        `ERROR [SYNC-01b]: Plugin import or dependency detected in ${path.relative(ROOT, CONNECTOR_DIR)}:`
    );
    connectorLeaks.forEach(({ file, line, content }) => {
        console.error(`  ${file}${line != null ? `:${line}` : ""} — ${content}`);
    });
    process.exit(1);
}

console.log("✅ [SYNC-01b] No plugin imports in connector.");

// ─── SYNC-02: Scan packages/core/docs ─────────────────────────────────────────
// No whitelist needed: packages/core/docs/ documents the core only, by construction.
const allDocFiles = [];
collectMarkdown(DOCS_DIR, allDocFiles);
const docLeaks = [];
/**
 * SYNC-02 exemptions — relative path → reason. Every entry must carry its reason: a
 * mute exemption is indistinguishable from a case someone stopped pursuing.
 *
 * ✅ **EMPTY since 2026-08-10, and the subject left, not the rule.** The single entry
 * exempted `packages/core/docs/CONNECTOR_GUIDE.md` — a plugin's guide, shipped in the
 * core's tarball. The underlying question, open and explicitly provisional, was
 * settled: the guide moved to `packages/plugins/connector/docs/`, the package it
 * documents. The exemption thus disappears **with its subject**, not through
 * loosening.
 *
 * 🛑 Two measures were taken so this is not a mute weakening:
 *   1. after the single `git mv`, this gate exited **2** on "stale exemption" — that
 *      is the control loop below, and it did exactly its job;
 *   2. the Map once emptied, a plugin import reintroduced into `packages/core/docs/`
 *      was **seen making SYNC-02 go red**. The rule still bites; only its one
 *      derogation no longer exists.
 *
 * ⚠️ The Map stays in place, empty, rather than deleted: the next exemption case must
 * find here the obligation to write its reason AND the loop that expires dead
 * exemptions. That is the machinery that made this move visible.
 */
const DOCS_EXEMPT = new Map([]);

/**
 * Collects a `.md` file's SYNC-02 violations, distinguishing PROSE and CODE BLOCK.
 *
 * The fence state is tracked line by line: the opening line carries the info string
 * (` ```js `), not code, so it is not inspected; nor is the closing line. A longer
 * marker closes a shorter one, never the reverse — the CommonMark rule, and what
 * allows a block to contain another.
 *
 * @param {string} abs - absolute path of the file.
 * @param {string} rel - repo-relative path, POSIX separators.
 * @returns {{file: string, line: number, content: string, why: string}[]}
 */
function scanDocFile(abs, rel) {
    const found = [];
    let fence = null;
    fs.readFileSync(abs, "utf8")
        .split("\n")
        .forEach((line, i) => {
            const m = DOCS_FENCE_RE.exec(line);
            if (m) {
                if (fence === null) {
                    fence = m[1];
                    return;
                }
                if (m[1][0] === fence[0] && m[1].length >= fence.length) {
                    fence = null;
                    return;
                }
            }
            DOCS_SPECIFIER_RE.lastIndex = 0;
            let hit;
            while ((hit = DOCS_SPECIFIER_RE.exec(line)) !== null) {
                const why = docSpecifierVerdict(hit[1], fence !== null);
                if (why) found.push({ file: rel, line: i + 1, content: line.trim(), why });
            }
        });
    return found;
}

// ⚠️ Anti-empty-gate assertion. `collectMarkdown` exits silently on an absent
// directory: if `packages/core/docs/` moved, SYNC-02 announced "no reference" having
// read NO file — exit 0, green, blind. The class `probe-gate-visibility.cjs`
// watches, and this gate was not immune to it.
if (allDocFiles.length === 0) {
    console.error(
        `ERROR [SYNC-02]: aucun .md trouvé sous ${path.relative(ROOT, DOCS_DIR)} — ` +
            `le répertoire a bougé ou est vide. La gate refuse de conclure sur un corpus nul.`
    );
    process.exit(2);
}

for (const filePath of allDocFiles) {
    const rel = path.relative(ROOT, filePath).split(path.sep).join("/");
    if (DOCS_EXEMPT.has(rel)) continue;
    docLeaks.push(...scanDocFile(filePath, rel));
}

// An exemption that no longer targets anything is a silent lie: if the file vanishes,
// or stops containing what is exempted, the gate must say so rather than ignore it.
for (const [rel, motif] of DOCS_EXEMPT) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
        console.error(`ERROR [SYNC-02]: exemption périmée — ${rel} n'existe plus (${motif}).`);
        process.exit(2);
    }
    if (scanDocFile(abs, rel).length === 0) {
        console.error(
            `ERROR [SYNC-02]: exemption périmée — ${rel} ne contient plus de référence à ` +
                `exempter. Retirez-la de DOCS_EXEMPT (${motif}).`
        );
        process.exit(2);
    }
}

if (docLeaks.length > 0) {
    console.error("ERROR [SYNC-02]: specifier de plugin irrésoluble dans packages/core/docs:");
    docLeaks.forEach(({ file, line, content, why }) => {
        console.error(`  ${file}:${line} — ${why}`);
        console.error(`      ${content}`);
    });
    process.exit(1);
}

// The perimeter prints at the end of the run — a number one can re-read beats a claim
// one must believe. The plugin count comes from the registry: if it drops to 0,
// `packages.cjs` throws before reaching here.
console.log(
    `✅ [SYNC-02] Tout specifier de plugin est résoluble dans les docs du core ` +
        `(${allDocFiles.length} .md scannés, ${KNOWN_PLUGIN_NAMES.size} plugins au registre).`
);

process.exit(0);
