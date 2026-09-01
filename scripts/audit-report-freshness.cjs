#!/usr/bin/env node
/*!
 * GeoLeaf — Freshness of the `_docs_projet/travail/rapports/` reports (workshop)
 * © 2026 Mattieu Pottier — MIT
 *
 * Answers, for each item of a report, the only question that decides its
 * archiving: **is what the document asserts still true on HEAD?**
 *
 * ## Why a script and not a grep
 *
 * The corpus is ~1,200 sourced items (349 in the triage's 2 JSON annexes,
 * 86 config anomalies, 219 capability files, ~130 scattered `file:line`
 * refs). By hand, the verification would drift towards sampling — and
 * sampling is precisely what produced the false ✅ this repo has already
 * paid for (`rapport_backlog-code-mort-core.md` v3.0.0: 5 false active
 * instructions, including a "⛔ DO NOT PURGE" on a dissolved module).
 *
 * ## The three questions, and the order they are asked in
 *
 *   1. does the path still exist?
 *   2. if not, did the file simply MOVE (same basename elsewhere)?
 *   3. is the symbol still declared, and does it have a real consumer?
 *
 * ⚠️ **Question 2 is this script's reason for being.» Without it, an
 * absent path reads "purged", and that is false twice in this repo: a
 * reorganisation moved `packages/plugin-X/` → `packages/plugins/X/`, and
 * the kernel moved `app/modules/` → `app/boot-modules/`. An audit
 * concluding "purged" on a moved file produces a green report having
 * verified nothing — exactly the error class
 * `probe-gate-visibility.cjs` watches on the gates.
 *
 * ## What this script is NOT — and the exception, since 31/07/2026
 *
 * For the `s4-triage`, `s4-low`, `refs` and `files` sources: it is not a
 * gate, they are not wired into `ci:local`, and they must not be — they
 * measure the freshness of workshop DOCUMENTS, not the shipped code's
 * health. No regression exit code: 0 if the measure could be taken, 2
 * otherwise (empty corpus, unreadable source).
 *
 * ⚠️ **`--source tsdoc --gate` is the exception, and the distinction is
 * not cosmetic**: that source reads the TSDoc prose **of the sources**,
 * i.e. code published on npm — not a workshop report. It is wired into
 * `ci:local` under the name TSDOC-PATHS, with its own decreasing baseline
 * (`audit-tsdoc-paths.baseline.json`) and two failure axes. The flag is
 * **refused** on any other source rather than ignored: `--gate --source
 * refs` would exit 0, i.e. "green", having guarded nothing.
 *
 * Owned limit, inherited from `check-orphan-exports.cjs`: token search,
 * not TypeScript binding resolution. A generic name redeclared elsewhere
 * can produce a false "alive". The bias is deliberate and leans towards
 * PRUDENCE — better to keep one report too many than archive a still-open
 * backlog.
 *
 * ## Limites de l'extraction de chemins
 *
 * `sourceRefs()` extracts paths through an **extension alternation**
 * (`tsx|mjs|cjs|json|html|css|ts|js`). Two classes thus escape it by
 * construction, and this function's header announced "all the refs" until
 * 29/07/2026:
 *
 *   - **`.md` files** — `md` is not in the alternation. No script comment
 *     motivates that absence; it is observed, not justified here.
 *   - **directories** (`docs/specs/rfc/`) — they have no extension.
 *
 * Opposite, `check-dead-links.cjs` reads **only markdown links**. The
 * uncovered class is thus narrow and nameable: **an inline-code path
 * aiming at a `.md` or a directory**. It has already cost a real defect —
 * a roadmap cited a workshop path instead of `specs/rfc/`, fixed on
 * 29/07/2026.
 *
 * ⚠️ **Widening the alternation to `md` is NOT the fix, and it is
 * measured.» On one workshop document, a probe of that class returns 10
 * unresolved paths of which **8 are the exact usage**: they name the path
 * *because it is dead* ("deleted" / "regenerated" decision tables, false
 * statements cited as corrected, a `grep` run ON the vanished directory).
 * **Precision 2/10** — a guard on it would cry wolf 8 times out of 10,
 * and the first automatic correction would erase a register. The right
 * gesture is to READ: this script bounds where to look, it renders no
 * verdict (cf. §What this script is NOT). Full doctrine and the 10
 * verdicts: the original execution rule.
 *
 * Usage :
 *   node scripts/audit-report-freshness.cjs --source s4-triage
 *   node scripts/audit-report-freshness.cjs --source s4-low
 *   node scripts/audit-report-freshness.cjs --source refs --doc <chemin.md>
 *   node scripts/audit-report-freshness.cjs --source files --doc <chemin.md>
 *   node scripts/audit-report-freshness.cjs --source tsdoc [--gate] [--update-baseline]
 *   node scripts/audit-report-freshness.cjs --source comments [--gate] [--update-baseline]
 *   node scripts/audit-report-freshness.cjs --source specs [--gate] [--update-baseline]
 *   [--out <chemin.json>] [--quiet]
 *
 * ⚠️ **`--source specs` is the only one NOT depending on the internal
 * root**: its corpus is `docs/specs/`, public. The head skip explicitly
 * spares it — otherwise the gate guarding the 45 sheets would exit 0 in
 * the public repo, the only place where they count.
 *
 * Exit codes — **they differ by mode**, and this is the only place where that is true:
 *   · measure (default): 0 measured · 2 impossible to measure. Never 1.
 *   · `--gate`         : 0 green · 1 regression (TSDOC-PATHS-01/02) · 2 impossible to measure.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const registry = require("./lib/packages.cjs");
const docsPaths = require("./lib/docs-paths.cjs");
const partition = require("./lib/public-partition.cjs");
const ROOT = registry.ROOT;

// ⚠️ NAMED SKIP — this gate's corpus is the workshop, and the public repo
// does not carry it.
//
// `_docs_projet/` is removed from the public repo by decision, not by
// accident. Throwing here would teach nothing: it is not a lost root, it
// is a root that repo never had. Measured on 10/08/2026 — without this
// skip, this gate and `check-config-consumers` are the ONLY TWO of
// `ci:local` that cannot pass on the public clone, whatever is written there.
//
// 🛑 The skip is LOUD and refuses to read as a green —
// `CONSUMER-CONTRACT/CC-00`'s pattern. A gate going quiet exiting 0 is the
// failure mode this repo hunts; this one says what it did not read, and why.
//
// 🛑 **AND IT IS SOURCE-DEPENDENT since 11/08/2026 — otherwise it would
// have made SPECS-PATHS green and blind exactly in the repo it protects.**
// `--source specs` reads `docs/specs/`, which is PUBLIC: it needs neither
// `_docs_projet/` nor the workshop reports. An unconditional skip would
// have made the only gate guarding the 45 sheets exit 0, on the only clone
// where they count. The skip thus only holds for the sources that REALLY
// read the workshop; `tsdoc` and `specs` are not among them, but `tsdoc`
// keeps it because its corpus depends on `REPORTS_DIR` through
// `buildCorpus`/`probeItem` — measured, not assumed.
// `arg()` is a function declaration, hence hoisted: calling it here is licit.
// ⚠️ `core-docs` joins `specs` and `guides`: these three corpora are
// PUBLIC, they exist on the public clone, and excluding them from here is
// what keeps them from skipping silently over there.
// 🛑 Do not add a WORKSHOP source to this list "for uniformity" — that is
// what nearly made `SPECS-PATHS` green and blind (see `sourceVision`'s comment).
const NEEDS_INTERNAL_ROOT = !["specs", "guides", "core-docs", "comments"].includes(arg("source"));
if (NEEDS_INTERNAL_ROOT && !docsPaths.internalRootExists()) {
    console.log(
        "⏭️  [TSDOC-PATHS] SAUTÉ — la racine INTERNE est absente : " +
            docsPaths.rel(docsPaths.INTERNAL_ROOT)
    );
    console.log(
        "    Ce n'est pas un vert : aucun rapport d'atelier n'a été relu, donc aucun chemin\n" +
            "    cité par une prose de TSDoc n'a été confronté. Sur le dépôt public c'est le\n" +
            "    comportement attendu — `_docs_projet/` y est retiré par décision. Ailleurs,\n" +
            "    c'est un défaut : corriger le chemin, ou poser GEOLEAF_INTERNAL_DOCS_ROOT.\n" +
            "    ⚠️ `--source specs` ne passe PAS par ici : son corpus est `docs/specs/`, public."
    );
    process.exit(0);
}

/**
 * INTERNAL root of the workshop reports — **resolved at call, not at load**.
 *
 * `docsPaths.internal()` THROWS when the root is absent. As a module
 * constant, it made the file unloadable on the public repo, which forced
 * the skip above to be unconditional. Lazy, it lets `--source specs` load
 * and measure.
 *
 * @returns {string} chemin absolu de `_docs_projet/travail/rapports`.
 */
function reportsDir() {
    return docsPaths.internal("travail", "rapports");
}

// `.vitepress` is documentation tooling, not shipped code: finding an
// `index.ts` there teaches nothing about a core barrel's survival.
const EXCLUDED_DIRS = new Set([
    "node_modules",
    "dist",
    "coverage",
    ".turbo",
    "docs-dist",
    ".vitepress",
]);
const TEST_DIRS = new Set(["__tests__", "__mocks__", "test-utils", "e2e"]);
const IDENTIFIER_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;
const SOURCE_EXTS = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".css", ".json"];

// ─── CLI ──────────────────────────────────────────────────────────────────────

function arg(name, fallback = null) {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const QUIET = process.argv.includes("--quiet");

// `--gate` only makes sense with `--source tsdoc`: the only source
// measuring CODE (the sources' TSDoc prose) and not a workshop document's
// freshness. The others stay measuring instruments, without a regression
// exit code — see the header, §What this script is NOT, which stays true for them.
const GATE = process.argv.includes("--gate");
const UPDATE_BASELINE = process.argv.includes("--update-baseline");

function die(msg) {
    process.stderr.write(`audit-report-freshness: ${msg}\n`);
    process.exit(2);
}

/** Relative path normalised to `/` — `path.relative` returns `\` on Windows. */
function normPath(p) {
    return p.split(path.sep).join("/");
}

// ─── Corpus ───────────────────────────────────────────────────────────────────

function collectFiles(dir, acc) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return acc;
    }
    for (const e of entries) {
        if (EXCLUDED_DIRS.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) collectFiles(full, acc);
        else if (e.isFile() && SOURCE_EXTS.some((ext) => e.name.endsWith(ext))) acc.push(full);
    }
    return acc;
}

/**
 * The corpus comes from the workspace REGISTRY, never a hardcoded
 * `packages/<name>`. A hardcoded path does not break on a move: it silently
 * stops matching, and the audit exits green having scanned nothing. A
 * failing registry must therefore PROPAGATE, not fall back on an empty corpus.
 */
function buildCorpus() {
    const acc = [];
    for (const pkg of registry.all()) collectFiles(pkg.absDir, acc);
    for (const extra of ["examples", "profiles", "scripts", "e2e", "apps"]) {
        collectFiles(path.join(ROOT, extra), acc);
    }
    if (acc.length === 0) {
        die(
            "corpus vide — refus de conclure « purgé » depuis un corpus qui n'a pas pu être construit."
        );
    }

    const byBasename = new Map();
    const entries = [];
    for (const abs of acc) {
        const rel = normPath(path.relative(ROOT, abs));
        const isTest =
            rel.split("/").some((seg) => TEST_DIRS.has(seg)) || /\.(test|spec)\./.test(rel);
        const base = path.basename(abs);
        if (!byBasename.has(base)) byBasename.set(base, []);
        byBasename.get(base).push(rel);
        entries.push({ abs, rel, isTest });
    }

    // ── Known-answer witness ─────────────────────────────────────────────────
    // A freshness audit concluding "purged" from an amputated corpus is
    // worse than no audit: it is false AND looks complete. The corpus must
    // therefore see the repo's core BEFORE any question is asked of it.
    // Same spirit as `verify-coverage-attribution.cjs`.
    // The prefix comes from the registry, which throws. A witness whose
    // reference path is hand-written can fail FOR THE WRONG REASON: the
    // corpus would be intact and the witness red, which teaches the
    // opposite of what it measures.
    const coreSrcPrefix = `${registry.requireByDirName("core").dir}/src/`;
    const coreSrc = entries.filter((e) => e.rel.startsWith(coreSrcPrefix)).length;
    if (coreSrc < 400) {
        die(
            `témoin en échec — ${coreSrc} fichiers vus sous ${coreSrcPrefix} (attendu ≥ 400). ` +
                `Le corpus est amputé : refus de conclure quoi que ce soit sur la survie d'un symbole.`
        );
    }
    return { entries, byBasename, coreSrc };
}

let _tokenCache = null;
/** Tokenises the corpus once — 3,500+ files, reread per item otherwise. */
function tokenize(corpus) {
    if (_tokenCache) return _tokenCache;
    _tokenCache = [];
    for (const e of corpus.entries) {
        if (!/\.(ts|tsx|js|mjs|cjs)$/.test(e.rel)) continue;
        let raw;
        try {
            raw = fs.readFileSync(e.abs, "utf8");
        } catch {
            continue;
        }
        // Strip the comments: without that, a symbol merely CITED in JSDoc
        // passes for alive. The "referenced ≠ alive" trap.
        const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
        _tokenCache.push({
            rel: e.rel,
            isTest: e.isTest,
            tokens: new Set(stripped.match(IDENTIFIER_RE) || []),
        });
    }
    return _tokenCache;
}

// ─── The three questions ──────────────────────────────────────────────────────

/**
 * Basenames that canNOT be followed by their name.
 *
 * `index.ts` exists dozens of times in this repo. Following it by basename
 * made three **deleted** barrels (`layer-manager/index.ts`,
 * `utils/general/index.ts`, `filter/panel/index.ts`, since purged) pass
 * for files "moved to `docs/.vitepress/theme/index.ts`" — and the audit
 * then asked its questions of the wrong file. A file that cannot be
 * followed must be declared absent, not attached to a homonym.
 */
const UNTRACKABLE_BASENAMES = new Set([
    "index.ts",
    "index.js",
    "types.ts",
    "constants.ts",
    "utils.ts",
    "helpers.ts",
    "config.ts",
    "install.ts",
    "lifecycle.ts",
    "public-api.ts",
]);

/**
 * Q1/Q2 — the path exists, is cited in SHORTHAND, moved, or vanished.
 *
 * ⚠️ The "shorthand" step is not a comfort. The reports massively cite
 * relative fragments — `capabilities/route/apply.ts` for
 * `packages/core/src/capabilities/route/apply.ts`. Resolved from the root
 * alone, **51 perfectly alive files** came out "not found" in the dead-code
 * report alone. Concluding "the document cites dead paths" on that basis
 * would have been a false finding in support of an archiving.
 */
function locateFile(relPath, corpus) {
    if (!relPath) return { state: "no-path" };
    const clean = normPath(relPath).replace(/^\.\//, "");
    // 🛑 The TRACKED index, no longer the disk. A path present on this
    // workstation but untracked by git exists neither in the public clone
    // nor on the runner: judging it "present" here made the workshop's
    // verdict diverge from the only place the reader will read it. The
    // conversion was already half done — `suffixIndex()` below was built
    // from `git ls-files` and carried the full reasoning; only this first
    // test, which short-circuits all the others, had stayed on `fs.existsSync`.
    //
    // ⚠️ Disk fallback when the index is empty, and only there: outside a
    // git repo there is no index to consult, and refusing everything would
    // make a script return "everything is dead" — precisely its most
    // costly verdict to fabricate.
    const suivis = trackedPaths();
    const trouve =
        suivis.size > 0
            ? suivis.has(clean.replace(/\/+$/, ""))
            : fs.existsSync(path.join(ROOT, clean));
    if (trouve) return { state: "present", at: clean };

    // 🛑 A BUILD OUTPUT KEEPS THE DISK AS ORACLE, and it is the only exception.
    //
    // A path under `dist/` is git-tracked in no repo: judging it on the
    // index would declare it dead everywhere, including when it is
    // perfectly alive in the tarball the integrator downloads. Judging it
    // on the disk makes it measurable — after the build, which `ci:local`
    // and `ci.yml` both launch before these gates.
    //
    // ⚠️ **This block's first version removed them from judgement, and
    // that was FALSE** — measured, not assumed: the 11 baseline entries
    // the exclusion staled included `dist/maplibre-gl.js`, which MapLibre
    // v6 **no longer publishes** and any recipe citing it returns a 404.
    // Declaring the class "unjudgeable" would have blinded the gate to a
    // real, known defect documented elsewhere in this repo. An exclusion is
    // measured by what it makes DISAPPEAR, never by what it silences.
    //
    // ⚠️ What it costs, to know before relying on it: on a clone where
    // `dist/` was never built, every build-output citation comes out dead.
    // That is why these gates run AFTER the build on both sides, and why
    // this exception extends to nothing else.
    if (clean.split("/").includes("dist")) {
        return fs.existsSync(path.join(ROOT, clean))
            ? { state: "present", at: clean }
            : { state: "absent" };
    }

    // Shorthand: a single corpus file whose path ends with this fragment.
    // ⚠️ The corpus comes from a DISK WALK (`buildCorpus`), not the git
    // index — the right choice for probing symbols (content is read), and
    // the wrong one for deciding a path "exists". Without the filter below,
    // an untracked file resurrected through this shorthand what the first
    // test had just declared absent — measured by exercising the switch:
    // the untracked witness came out "present, viaSuffix".
    const estSuivi = (rel) => suivis.size === 0 || suivis.has(rel);
    if (clean.includes("/")) {
        const suffix = "/" + clean;
        const hits = corpus.entries
            .filter((e) => e.rel.endsWith(suffix) && estSuivi(e.rel))
            .map((e) => e.rel);
        if (hits.length === 1) return { state: "present", at: hits[0], viaSuffix: true };
        if (hits.length > 1) return { state: "present", at: hits[0], viaSuffix: true, all: hits };
    }

    const base = path.basename(clean);
    if (UNTRACKABLE_BASENAMES.has(base)) return { state: "absent", ambiguous: true };

    const candidates = (corpus.byBasename.get(base) || []).filter(estSuivi);
    if (candidates.length === 1) return { state: "moved", at: candidates[0], all: candidates };
    if (candidates.length > 1) return { state: "absent", ambiguous: true, all: candidates };
    return { state: "absent" };
}

/** Q3a — is the symbol still DECLARED in this file? */
function isDeclaredIn(relFile, symbol) {
    const abs = path.join(ROOT, relFile);
    let text;
    try {
        text = fs.readFileSync(abs, "utf8");
    } catch {
        return false;
    }
    if (!/\.(ts|tsx|js|mjs|cjs)$/.test(relFile)) {
        return new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text);
    }
    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true);
    let found = false;
    const visit = (node) => {
        if (found) return;
        if (
            (ts.isFunctionDeclaration(node) ||
                ts.isClassDeclaration(node) ||
                ts.isInterfaceDeclaration(node) ||
                ts.isTypeAliasDeclaration(node) ||
                ts.isEnumDeclaration(node) ||
                ts.isMethodDeclaration(node) ||
                ts.isPropertyDeclaration(node) ||
                ts.isPropertyAssignment(node)) &&
            node.name &&
            ts.isIdentifier(node.name) &&
            node.name.text === symbol
        ) {
            found = true;
            return;
        }
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === symbol
        ) {
            found = true;
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return found;
}

/**
 * Q3a-bis — is the symbol still EXPORTED?
 *
 * ⚠️ Cardinal distinction, and the only one making the triage readable:
 * its `dead-purge` gesture was most often "**de-export**", not "delete". A
 * type like `AnyFn` stays declared and locally used — its `export` is what
 * was dead, not it. Measuring the symbol's presence would answer "still
 * there" on a perfectly settled item, and reopen 75 lines that were never
 * opened.
 *
 * Same extraction as `check-orphan-exports.cjs` (TS compiler, module
 * statements) — deliberately, so the two cannot diverge on what an export is.
 */
function exportedNames(relFile) {
    const abs = path.join(ROOT, relFile);
    if (!/\.(ts|tsx)$/.test(relFile)) return null;
    let text;
    try {
        text = fs.readFileSync(abs, "utf8");
    } catch {
        return null;
    }
    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true);
    const names = new Set();
    for (const stmt of sf.statements) {
        const mods = ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) || [] : [];
        if (mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
            if (
                (ts.isFunctionDeclaration(stmt) ||
                    ts.isClassDeclaration(stmt) ||
                    ts.isInterfaceDeclaration(stmt) ||
                    ts.isTypeAliasDeclaration(stmt) ||
                    ts.isEnumDeclaration(stmt)) &&
                stmt.name
            ) {
                names.add(stmt.name.text);
            } else if (ts.isVariableStatement(stmt)) {
                for (const d of stmt.declarationList.declarations) {
                    if (ts.isIdentifier(d.name)) names.add(d.name.text);
                }
            }
        }
        if (ts.isExportDeclaration(stmt) && stmt.exportClause) {
            if (ts.isNamedExports(stmt.exportClause)) {
                for (const s of stmt.exportClause.elements) names.add(s.name.text);
            } else if (ts.isNamespaceExport(stmt.exportClause)) {
                names.add(stmt.exportClause.name.text);
            }
        }
    }
    return names;
}

/**
 * Q3c — usages IN its own file, declaration excluded.
 *
 * The other blind spot documented by `check-orphan-exports.baseline.json`:
 * a type consumed only by the module declaring it (`CirclePaint` as
 * `toCirclePaint`'s return type, `LayerRegistryEntry` in its own class's
 * `Map`). Without this count, they come out "no consumer left" — i.e. dead
 * — while they are the very definition of the false positive the triage
 * had set aside.
 */
function intraFileUses(relFile, symbol) {
    let text;
    try {
        text = fs.readFileSync(path.join(ROOT, relFile), "utf8");
    } catch {
        return 0;
    }
    const stripped = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const esc = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hits = stripped.match(new RegExp(`\\b${esc}\\b`, "g")) || [];
    return Math.max(0, hits.length - 1); // the declaration itself does not count
}

/**
 * Audit tooling is not a consumer — it is the inverse.
 *
 * `check-orphan-exports.cjs` NAMES symbols in its `ALLOWLIST` precisely to
 * declare that they have **no** consumer and that it is wanted. Counting
 * them as consumers inverts the measure's meaning: the gate certifying
 * "this export is intentionally orphan" would lead to concluding "it is alive".
 */
const TOOLING_FILES = new Set([
    "scripts/check-orphan-exports.cjs",
    "scripts/audit-report-freshness.cjs",
]);

/**
 * `check-orphan-exports.cjs`'s `ALLOWLIST` is the **register of decisions
 * already made** on consumer-less exports: each entry carries its reason
 * (documented public surface, duck-typing contract, named type required
 * for declaration emission…). A report item appearing there was thus
 * **settled after** the report was written — it can no longer be "open".
 *
 * Textbook case met here: the triage classified `FetchHelperOptions` as
 * `dead-purge`, and the allowlist explains that de-exporting it **would
 * break `GeoLeaf.Utils`' declaration (TS4023)`. The report's verdict is
 * what is stale, not the code.
 */
let _allowlist = null;
function allowlistIndex() {
    if (_allowlist) return _allowlist;
    _allowlist = new Map();
    // ⚠️ TEXTUAL read, never `require()`. `check-orphan-exports.cjs` is a
    // gate: it calls `main()` at load and ends with `process.exit()`.
    // Requiring it would not import it, it would EXECUTE it — and kill this
    // audit mid-measure, displaying a whole other gate's report.
    try {
        const src = fs.readFileSync(path.join(__dirname, "check-orphan-exports.cjs"), "utf8");
        const block = src.slice(src.indexOf("const ALLOWLIST = {"));
        const re = /"([^"]+\.ts)":\s*(\*?"?\*"?|\[[^\]]*\])/g;
        let m;
        while ((m = re.exec(block)) !== null) {
            const rel = m[1];
            const raw = m[2];
            _allowlist.set(
                rel,
                raw.includes("[") ? (raw.match(/"([^"]+)"/g) || []).map((s) => s.slice(1, -1)) : "*"
            );
        }
    } catch {
        /* absent : l'audit reste valide, il perd juste ce signal */
    }
    return _allowlist;
}

/** Is the symbol declared "intentional orphan" by the gate? */
function isAllowlisted(relFile, symbol) {
    const idx = allowlistIndex();
    const key = relFile.replace(/^packages\/core\/src\//, "");
    const entry = idx.get(key);
    if (!entry) return false;
    return entry === "*" || entry.includes(symbol);
}

/** Q3b — does it have a consumer outside its own file? prod and test separate. */
function consumers(symbol, ownerRel, corpus) {
    let prod = 0;
    let test = 0;
    const sites = [];
    for (const e of tokenize(corpus)) {
        if (e.rel === ownerRel) continue;
        if (TOOLING_FILES.has(e.rel)) continue;
        if (!e.tokens.has(symbol)) continue;
        if (e.isTest) test++;
        else prod++;
        if (sites.length < 4) sites.push(e.rel);
    }
    return { prod, test, sites };
}

/**
 * An over-generic token proves nothing. `destroy`, `init`, `render` match
 * in dozens of files with no relation to the targeted symbol — the triage
 * precisely classified `BasemapSelector.destroy` as `uncertain`, and a
 * token measure would answer "71 prod consumers", which is a non-answer.
 */
const GENERIC_TOKENS = new Set([
    "init",
    "destroy",
    "render",
    "update",
    "reset",
    "start",
    "stop",
    "close",
    "open",
    "get",
    "set",
    "add",
    "remove",
    "clear",
    "load",
    "save",
    "show",
    "hide",
    "toggle",
    "config",
    "options",
    "state",
    "data",
    "value",
    "name",
    "type",
    "id",
    "apply",
]);

// ─── Verdicts ─────────────────────────────────────────────────────────────────

/**
 * Confronts what the report ASSERTS (`final`) with what HEAD shows.
 *
 * The two annexes' 11 classifications, and each one's expectation:
 *
 *   dead-purge            → ABSENT. If it survives: incomplete purge.
 *   false-positive-alive  → PRESENT and consumed. Absent: purged beyond the perimeter.
 *   public-api-breaking   → same — public API knowingly kept.
 *   test-only-keep        → PRESENT, consumed ONLY by tests.
 *   keep-documented       → PRESENT — kept and documented as such.
 *   route-S5              → ABSENT — the `route` capability was dissolved.
 *   closed-no-op          → the item was ALREADY resolved at triage time
 *                           (`already-done` nature): nothing was to do. Its
 *                           survival reopens nothing, but its return to life does.
 *   fix-in-4.3            → a fix was applied during that task — the code
 *                           must thus be PRESENT (a fix, not a purge).
 *   consign-only          → ⚠️ THE CASE THAT DECIDES THE ARCHIVING. Logged,
 *                           never treated. If it is still there, it is an
 *                           OPEN backlog line, to extract before freezing the document.
 *   uncertain             → undecided at triage; disappearance settles it, survival does not.
 */
const EXPECT_ABSENT = new Set(["dead-purge", "route-S5"]);
const EXPECT_PRESENT = new Set([
    "false-positive-alive",
    "public-api-breaking",
    "keep-documented",
    "fix-in-4.3",
]);

function judge(claim, obs) {
    if (obs.file === "no-path" && !obs.symbol) {
        return { verdict: "unverifiable", why: "l'item ne cite ni chemin ni symbole" };
    }
    if (obs.generic) {
        return {
            verdict: "unverifiable",
            why: "token trop générique — la mesure par nom ne décide rien",
        };
    }
    if (obs.allowlisted) {
        return {
            verdict: "closed",
            why: "tranché depuis par l'ALLOWLIST de check-orphan-exports (orphelin intentionnel, motif documenté)",
        };
    }
    const gone = obs.file === "absent" || (obs.file !== "no-path" && obs.declared === false);
    // A symbol lives if it is used — by another file OR by its own.
    const used = obs.prod > 0 || obs.test > 0 || obs.intra > 0;

    if (EXPECT_ABSENT.has(claim)) {
        if (gone) return { verdict: "closed", why: "supprimé comme annoncé" };
        // The expected gesture was most often de-exporting, not deleting.
        if (obs.exported === false) {
            return {
                verdict: "closed",
                why: `dé-exporté comme annoncé (déclaration conservée, ${obs.intra} usage(s) local)`,
            };
        }
        return { verdict: "open", why: "annoncé purgé, TOUJOURS EXPORTÉ" };
    }
    if (EXPECT_PRESENT.has(claim)) {
        if (gone) return { verdict: "closed", why: "conservé à l'époque, retiré depuis" };
        if (used) {
            const where =
                obs.prod > 0
                    ? `${obs.prod} consommateur(s) prod`
                    : `${obs.intra} usage(s) intra-fichier`;
            return { verdict: "confirmed", why: `vivant — ${where}` };
        }
        return { verdict: "drift", why: "conservé mais AUCUN usage, ni externe ni local" };
    }
    switch (claim) {
        case "test-only-keep":
            if (gone) return { verdict: "closed", why: "retiré depuis" };
            return obs.prod === 0
                ? {
                      verdict: "confirmed",
                      why: `test-only confirmé (${obs.test} test(s), ${obs.intra} local)`,
                  }
                : { verdict: "drift", why: `annoncé test-only, ${obs.prod} consommateur(s) prod` };
        case "closed-no-op":
            return gone
                ? { verdict: "closed", why: "déjà résolu au triage, toujours absent" }
                : { verdict: "confirmed", why: "déjà résolu au triage — rien n'était à faire" };
        case "consign-only":
            return gone
                ? { verdict: "closed", why: "consigné sans traitement, mais disparu depuis" }
                : { verdict: "open", why: "CONSIGNÉ, JAMAIS TRAITÉ — toujours présent" };
        case "unknown":
            return { verdict: "unverifiable", why: "l'item ne porte aucun classement" };
        case "uncertain":
            return gone
                ? { verdict: "closed", why: "indécis au triage, levé par disparition" }
                : { verdict: "open", why: "toujours indécis — la survie ne tranche rien" };
        default:
            return { verdict: "unmodelled", why: `classement « ${claim} » non modélisé` };
    }
}

function probeItem(item, corpus) {
    const loc = locateFile(item.file, corpus);
    const at = loc.at || null;
    const obs = {
        file: loc.state,
        at,
        symbol: Boolean(item.symbol),
        generic: Boolean(item.symbol) && GENERIC_TOKENS.has(item.symbol),
        allowlisted: false,
        declared: null,
        exported: null,
        intra: 0,
        prod: 0,
        test: 0,
        sites: [],
    };

    if (item.symbol && at) {
        obs.allowlisted = isAllowlisted(at, item.symbol);
        obs.declared = isDeclaredIn(at, item.symbol);
        const exp = exportedNames(at);
        obs.exported = exp ? exp.has(item.symbol) : null;
        obs.intra = intraFileUses(at, item.symbol);
        const c = consumers(item.symbol, at, corpus);
        obs.prod = c.prod;
        obs.test = c.test;
        obs.sites = c.sites;
    } else if (item.symbol && loc.state === "absent") {
        obs.declared = false;
        obs.exported = false;
        const c = consumers(item.symbol, "", corpus);
        obs.prod = c.prod;
        obs.test = c.test;
        obs.sites = c.sites;
    }

    const j = judge(item.final || item.proposed || "unknown", obs);
    return { ...item, observed: obs, ...j };
}

// ─── Sources ──────────────────────────────────────────────────────────────────

function readJson(rel) {
    const abs = path.join(reportsDir(), rel);
    try {
        return JSON.parse(fs.readFileSync(abs, "utf8"));
    } catch (e) {
        die(`source illisible ${rel} — ${e.message}`);
    }
}

function sourceS4Triage() {
    const d = readJson("annexe_s4-triage-detail.json");
    return [...d.voletA, ...d.voletB].map((it) => ({
        id: `${it.volet}:${it.zone}:${it.symbol}`,
        ...it,
    }));
}

function sourceS4Low() {
    const d = readJson("annexe_s4-3-backlog-low.json");
    return d.items.map((it) => ({ id: it.id, ...it }));
}

/**
 * A markdown's `path.ext[:line]` refs whose extension is in `re` below —
 * does the file still exist?
 *
 * ⚠️ **Not "all" the refs**, and the gap is named because it cost a real
 * defect: this extraction sees **neither `.md`** (absent from the
 * alternation below) **nor directories** (`docs/specs/rfc/`), which have
 * no extension. A doc path cited in inline code is thus invisible to it.
 * Motive and conduct: §Path-extraction limits, at the top of the module.
 */
function sourceRefs(docRel) {
    const abs = path.isAbsolute(docRel) ? docRel : path.join(ROOT, docRel);
    let text;
    try {
        text = fs.readFileSync(abs, "utf8");
    } catch (e) {
        die(`document illisible ${docRel} — ${e.message}`);
    }
    // ⚠️ LONGEST extensions first. In a regex alternation, `js` would match
    // before `json` and cut `package.json` into "package.js" — a path that
    // exists nowhere, hence an entirely fabricated "file not found".
    const re = /([A-Za-z0-9_@./-]+\.(?:tsx|mjs|cjs|json|html|css|ts|js))(?::(\d+))?/g;
    const seen = new Map();
    let m;
    while ((m = re.exec(text)) !== null) {
        const key = `${m[1]}:${m[2] || ""}`;
        if (!seen.has(key))
            seen.set(key, { id: key, file: m[1], line: m[2] ? Number(m[2]) : null });
    }
    return [...seen.values()];
}

/** Paths cited at table-row heads (the capability register, the inventory). */
function sourceFiles(docRel) {
    return sourceRefs(docRel).filter((r) => r.file.includes("/"));
}

/**
 * Paths cited in the PROSE of all sources' TSDoc blocks.
 *
 * The documentation rule's last coverage hole: `@param`, `@throws` and
 * arity are guarded by TSDOC-CONFORMITY, the `@example`s are compiled by
 * `typecheck-docs-examples` — but the PROSE was guarded by nothing. A
 * sentence pointing at `kernel/geojson/style-resolver.ts` stays readable
 * and convincing long after the file moved, and that is exactly the defect
 * class the documentation overhaul had to find by hand (7 times, 3 of them
 * APIs that no longer existed).
 *
 * ⚠️ **The `@example`s are EXCLUDED on purpose**: they are already
 * compiled against the published `.d.ts`, and an import path is verified
 * there far better than here. Including them would double two guards on
 * the same defect, and diverge the day one changed.
 *
 * ## ✅ WIRED into `ci:local` since 31/07/2026 — after closing 5 FP classes
 *
 * The condition this header set for being gated ("when its false-positive
 * rate has been measured and closed") is met. Measurement history:
 *
 * | Date | Items | Present | Moved | Not found |
 * | --- | --- | --- | --- | --- |
 * | 30/07/2026 (manual wiring) | 456 | 219 | 88 | **149** |
 * | 31/07/2026 (5 classes closed) | 443 | 332 | 27 | **84** |
 *
 * **The five false-positive classes, in the order found** — the first two
 * while writing, the next three while instructing the remainder:
 *
 *   1. judging the literal path from the root → **427 false dead out of 456**;
 *   2. ignoring the ESM `.js` ⇄ `.ts` convention → `app/boot.js` declared dead, `app/boot.ts` there;
 *   3. **the omitted segment / extra prefix** — `scale/lifecycle.ts` for
 *      `capabilities/scale/lifecycle.ts`. **73 occurrences**, resolved by
 *      an ambiguity-safe suffix index. ⚠️ This header announced those two
 *      as *distinct* gaps: they are the same 73;
 *   4. **the package specifier** — `@geoleaf/core/…`, `@core/…`: not paths, set aside;
 *   5. **the placeholder path** — `profiles/<id>/profile.json` captured as `/profile.json`.
 *
 * ⚠️ **What the baseline of 84 is, and what it is NOT.» It is **not** a
 * debt queue to drain. Instructing the remainder, the majority turned out
 * to be **deliberate provenance** — "Reclassified from
 * `modules/built-in/ui/…`", "Absorbs the former
 * `app/init-notifications.ts`", "PROMOTED here from …". These TSDoc name
 * the path **because it is dead**: it is the migration trace, and erasing
 * it would be a loss. No regex reliably tells them from a stale citation —
 * exactly the verdict the §Limits above already rendered for the `.md`
 * (precision 2/10).
 *
 * **What the gate guards is thus narrow and true: no NEW dead citation
 * can enter.» That is the real risk — someone moves a file and leaves the
 * reference —, while a provenance note is written deliberately and rarely.
 *
 * ⚠️ **Out of scope, owned**: the `/*!` file-head banners are not read
 * (only `/** … *\/` blocks are). Verified by laying the control mutation:
 * injected into the banner, the gate stays green; into a TSDoc block, it
 * turns red. Module headers have their own guard (`check-module-headers.cjs`).
 *
 *     node scripts/audit-report-freshness.cjs --source tsdoc            # mesure
 *     npm run check:tsdoc-paths                                         # gate
 *     npm run check:tsdoc-paths:update-baseline                         # après correction
 */
/**
 * Lazy "path suffix → repo files ending with it" index.
 *
 * Built once, from `git ls-files`: the list of TRACKED files, hence
 * neither `node_modules/`, nor `dist/`, nor the artefacts — an index built
 * by disk walk would resolve citations onto build outputs, and a `dist/`
 * path must precisely stay unresolved (it does not exist in a fresh clone).
 *
 * @param {string} tail - normalised path suffix, containing at least one `/`.
 * @returns {string[]} the repo paths ending with this suffix (0, 1 or several).
 */
/**
 * The GIT-TRACKED files, read once.
 *
 * Shared by `suffixIndex()` and `locateFile()` — the two places that
 * decide whether a cited path "exists", and they must decide with the same
 * corpus. They did not: one read the git index, the other the disk.
 *
 * @returns {string[]} Root-relative paths, or an empty array outside a git repo.
 */
let _tracked = null;
function trackedFiles() {
    if (_tracked === null) {
        try {
            _tracked = require("node:child_process")
                .execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1e9 })
                .split("\n")
                .filter(Boolean);
        } catch {
            // Outside a git repo: the index stays empty, the class is
            // simply not closed. No throw — this script measures, it does
            // not guard (cf. §What this script is NOT).
            _tracked = [];
        }
    }
    return _tracked;
}

/**
 * The paths a fresh clone contains: the tracked files, AND their ancestor directories.
 *
 * 🛑 The ancestors are not a refinement, they are what makes the switch
 * possible. The documents massively cite DIRECTORIES —
 * `packages/core/src/capabilities/taxonomy/` is the normal shape of a
 * sheet's reference —, and `git ls-files` only lists files. A set without
 * the ancestors would make every directory citation come out "not found",
 * i.e. produce hundreds of false dead on a healthy repo.
 *
 * @returns {Set<string>} Chemins suivis, sans barre oblique finale.
 */
let _trackedSet = null;
function trackedPaths() {
    if (_trackedSet === null) {
        _trackedSet = new Set();
        for (const f of trackedFiles()) {
            const norm = normPath(f);
            _trackedSet.add(norm);
            const segs = norm.split("/");
            for (let i = segs.length - 1; i > 0; i--) _trackedSet.add(segs.slice(0, i).join("/"));
        }
    }
    return _trackedSet;
}

let _suffixMap = null;
function suffixIndex(tail) {
    if (_suffixMap === null) {
        _suffixMap = new Map();
        const tracked = trackedFiles();
        for (const p of tracked) {
            const segs = normPath(p).split("/");
            // Only index suffixes of 2 segments and more: a lone basename
            // is too ambiguous to settle, and `sourceTsdoc` already sets
            // aside citations without a `/`.
            for (let i = segs.length - 2; i >= 0; i--) {
                const key = segs.slice(i).join("/");
                let bucket = _suffixMap.get(key);
                if (!bucket) _suffixMap.set(key, (bucket = []));
                bucket.push(p);
            }
        }
    }
    return _suffixMap.get(tail) || [];
}

/**
 * The shared harvest — one extraction, two complementary corpora.
 *
 * `sourceTsdoc` reads the `/** … *\/` blocks, `sourceComments` reads
 * everything else (`//` lines, `/* … *\/` non-doc blocks). **The two never
 * see the same character**, which is what lets their baselines be counted
 * apart without one covering the other's blindness.
 *
 * @param {{ files: string[], marker: string | null, blocksOf: (t: string) => string[] }} opts
 *   `files` absolute; `marker` a cheap pre-filter skipping a file that cannot
 *   contain the sought form (`null` = read everything); `blocksOf` the prose
 *   fragments to scan.
 */
function harvestCitedPaths({ files, marker, blocksOf }) {
    const refRe = /([A-Za-z0-9_@./-]+\.(?:tsx|mjs|cjs|json|html|css|ts|js))(?::(\d+))?/g;
    const seen = new Map();

    for (const abs of files) {
        if (!/\.(ts|tsx|js|mjs|cjs)$/.test(abs)) continue;
        const rel = normPath(path.relative(ROOT, abs));
        let text;
        try {
            text = fs.readFileSync(abs, "utf8");
        } catch {
            continue;
        }
        if (marker && !text.includes(marker)) continue;

        // ⚠️ The resolution bases, and the ORDER counts. A TSDoc almost
        // always cites relatively — to its own directory
        // (`./utils/general/dom-helpers.ts`, `../kernel/map/facade.ts`) or
        // to its package's `src/` root (`kernel/events/facade.ts`). Judging
        // the LITERAL path from the repo root would declare 427 paths out
        // of 456 dead, nearly all alive: that was this source's first
        // version, and sampling caught it out before it served. Measure,
        // then look at what was measured.
        const pkgSrc = (() => {
            const i = rel.indexOf("/src/");
            return i === -1 ? null : rel.slice(0, i + 5);
        })();
        const bases = [normPath(path.dirname(rel)) + "/", pkgSrc, ""].filter((b) => b !== null);

        for (const prose of blocksOf(text)) {
            let m;
            while ((m = refRe.exec(prose)) !== null) {
                const cited = m[1];

                // 6th false-positive class, closed on 26/08/2026 — THE URL.
                //
                // `https://unpkg.com/@geoleaf/core/dist/x.js`: the regex
                // class holds neither `:` nor the scheme, so it restarts
                // after `://` and captures `unpkg.com/@geoleaf/core/dist/x.js`
                // — a path no base can resolve and no gesture could fix.
                //
                // ⚠️ Only REACHABLE since the corpus took in the `//`
                // comments: TSDoc prose cites few URLs, line comments cite
                // many. A class can lie dormant in one corpus and dominate
                // the next — which is why widening a corpus is never just
                // widening a corpus.
                if (/:\/\/$/.test(prose.slice(0, m.index))) continue;

                // 4th false-positive class, closed on 31/07/2026 — THE PACKAGE SPECIFIER.
                //
                // `@geoleaf/core/capabilities/offline/cache/tile-math.js`,
                // `@core/utils/…`: not filesystem paths, but specifiers
                // resolved by the package's `exports` map or a build alias.
                // Judging them as paths amounts to declaring them dead
                // **always** — the regex captured them, no base could
                // resolve them, and they inflated the "not found" count
                // with no gesture able to fix them.
                //
                // ⚠️ This class was missing from this function's header,
                // which only announced two. It is set aside rather than
                // resolved: verifying a specifier requires unrolling the
                // `exports` map, which `check-subpath-resolve.cjs` already
                // does, and better (on `dist/`, after build). Two guards on
                // the same defect would diverge — the motive that already
                // excluded the `@example` from here.
                if (cited.startsWith("@")) continue;

                // 5th false-positive class, closed on 31/07/2026 — THE PLACEHOLDER PATH.
                //
                // A TSDoc very often describes a FAMILY of files, not a
                // file: `profiles/<id>/profile.json`,
                // `capabilities/<nom>/install.ts`, `${baseUrl}/profile.json`.
                // The characters `<`, `>`, `$`, `{` are not in the regex's
                // class, which thus restarts at the next `/` and captures
                // `/profile.json` — a path **absolute from the system
                // root**, which obviously can never exist.
                //
                // The rule is safe because it is asymmetric: no TSDoc in
                // this repo legitimately cites an absolute path from `/`. A
                // `cited` starting with `/` is thus always a cutting
                // remnant, never a target.
                //
                // ⚠️ Found by INSTRUCTING the remainder, not assuming it:
                // the first 4 "not found" examined by hand (`/install.ts`,
                // `/profile.json`, `/basemaps.json`,
                // `/config-primitives.js`) were the four of the
                // placeholders. Extrapolating would have given "39 real
                // dead"; measuring gives fewer. The "extrapolating is not
                // preflighting" corollary.
                if (cited.startsWith("/")) continue;

                // A path without `/` is a mere file name — too ambiguous to
                // judge, and `locateFile` would resolve it by basename at
                // the repo's whim.
                if (!cited.includes("/")) continue;

                // Resolve against each base; the first that exists wins. If
                // none gives a real file, the form normalised from the
                // package's `src/` is passed on — the one that makes the
                // report human-readable.
                // ⚠️ `.js` → `.ts`: in ESM, a `.ts` source imports as
                // `.js`, and TSDoc cite the import form. Without this
                // variant, `app/boot.js` is declared dead while
                // `app/boot.ts` is there — 2nd false-positive class found
                // at sampling, after the relative paths one.
                const forms = [cited];
                if (/\.js$/.test(cited)) forms.push(cited.replace(/\.js$/, ".ts"));
                if (/\.mjs$/.test(cited)) forms.push(cited.replace(/\.mjs$/, ".mts"));

                let resolved = null;
                // 🛑 The oracle is the TRACKED INDEX, no longer the disk. A
                // path present on this workstation but untracked exists
                // neither in the public clone nor on the runner: resolving
                // it here made the gate green on the workshop and false
                // everywhere else. Sole exception, the build outputs
                // (`dist/`): git tracks them in no repo, the disk — after
                // the build, which both CIs do — is their only possible
                // oracle, and the index would declare them dead even alive.
                const tracked = trackedPaths();
                const resolvable = (cand) =>
                    cand.split("/").includes("dist")
                        ? fs.existsSync(path.join(ROOT, cand))
                        : tracked.size > 0
                          ? tracked.has(cand.replace(/\/+$/, ""))
                          : fs.existsSync(path.join(ROOT, cand));
                outer: for (const form of forms) {
                    for (const b of bases) {
                        const cand = normPath(path.normalize(path.join(b, form)));
                        if (resolvable(cand)) {
                            resolved = cand;
                            break outer;
                        }
                    }
                }

                // 3rd false-positive class, closed on 31/07/2026 — THE OMITTED SEGMENT.
                //
                // A TSDoc very often cites a shortened form complete from
                // none of the three bases above: `scale/lifecycle.ts` for
                // `capabilities/scale/lifecycle.ts`, `geojson/core.ts` for
                // `kernel/geojson/core.ts`, or conversely an extra `src/`.
                // The citation designates a WELL-ALIVE file; only the path
                // is abbreviated.
                //
                // ⚠️ **Measured before being coded, and that decided the
                // shape**: of the 149 "not found" of 30/07, **73
                // occurrences** resolve by simple suffix. Declaring them
                // dead amounted to over-counting by a factor of ~2 — and
                // this function's header announced "at least two known
                // gaps" describing precisely those two (`src/` prefix,
                // omitted segment): they are the SAME 73, not two distinct
                // deposits.
                //
                // The suffix resolution is deliberately AMBIGUITY-SAFE: if
                // two repo files end with the same suffix, we refuse to
                // settle and the path stays unresolved. A silent false
                // "alive" would be worse than the false "dead" being
                // corrected — the prudence bias the script's header claims.
                //
                // ⚠️ A citation resolved HERE is one homonym away from breaking, and that is
                // measured rather than feared: `hits.length === 1` is the whole condition, so
                // a NEW file anywhere in the repo whose path ends with these same segments
                // flips it to `length === 2`, the citation falls through unresolved, and it is
                // reported dead. **The author of the new file is the one who breaks it, and
                // nothing told them** — the message named neither file until 26/08/2026, in
                // either direction: not the citation's own file, not the homonym that made it
                // ambiguous. The defect was invisible to the only person who could act on it.
                //
                // Two markers leave this loop for that reason. `viaSuffix` counts the EXPOSED
                // citations, printed at end of run so the surface stops being invisible.
                // `ambiguousWith` carries the candidates when the suffix ALREADY matches
                // several, so the report can name them instead of saying "the path is dead".
                let viaSuffix = false;
                let ambiguousWith = null;
                if (!resolved) {
                    for (const form of forms) {
                        const tail = form.replace(/^(\.\.?\/)+/, "").replace(/^\/+/, "");
                        if (!tail.includes("/")) continue;
                        const hits = suffixIndex(tail);
                        if (hits.length === 1) {
                            resolved = hits[0];
                            viaSuffix = true;
                            break;
                        }
                        if (hits.length > 1 && ambiguousWith === null) ambiguousWith = hits;
                    }
                }
                // 7th false-positive class, same date — THE DEPENDENCY.
                //
                // `istanbul-lib-coverage/lib/percent.js`, `geotiff/dist/…`:
                // REAL files, in `node_modules/`, tracked by no repo. The
                // index would call them dead for ever, and "correcting" them
                // would delete a true statement.
                //
                // 🛑 Tested AFTER resolution, never before: a repo directory
                // could share a name with an installed package, and an early
                // skip would blind the gate on it. Only what no base could
                // resolve is offered to this test.
                if (!resolved && isDependencyPath(cited)) continue;

                const file = resolved ?? normPath(path.normalize(path.join(pkgSrc || "", cited)));

                const key = `${rel}→${cited}`;
                if (!seen.has(key)) {
                    seen.set(key, {
                        id: key,
                        file,
                        viaSuffix,
                        ambiguousWith,
                        line: m[2] ? Number(m[2]) : null,
                        citedIn: rel,
                        cited,
                    });
                }
            }
        }
    }
    return [...seen.values()];
}

/**
 * The non-TSDoc comments of a source — `//` lines and `/* … *\/` blocks.
 *
 * 🛑 A LEXER, not a regex, and the motive is measured: `https://x/y.js`
 * inside a string would be read as a comment start by a naive `//` match.
 * The states are the four that can swallow a `/`: line comment, block
 * comment, quoted string, template literal.
 *
 * ⚠️ `/** … *\/` is EXCLUDED here — it is `TSDOC-PATHS`' corpus. Two gates
 * on the same characters would diverge, and their two counts would stop
 * meaning anything separately.
 */
function nonDocComments(text) {
    const out = [];
    const n = text.length;
    let i = 0;
    while (i < n) {
        const c = text[i];
        const two = text.slice(i, i + 2);
        if (two === "//") {
            let j = text.indexOf("\n", i);
            if (j === -1) j = n;
            out.push(text.slice(i, j));
            i = j;
        } else if (two === "/*") {
            let j = text.indexOf("*/", i + 2);
            j = j === -1 ? n : j + 2;
            if (text.slice(i, i + 3) !== "/**") out.push(text.slice(i, j));
            i = j;
        } else if (c === '"' || c === "'") {
            const q = c;
            let j = i + 1;
            while (j < n) {
                if (text[j] === "\\") {
                    j += 2;
                    continue;
                }
                if (text[j] === q || text[j] === "\n") {
                    j += 1;
                    break;
                }
                j += 1;
            }
            i = j;
        } else if (c === "`") {
            let j = i + 1;
            while (j < n) {
                if (text[j] === "\\") {
                    j += 2;
                    continue;
                }
                if (text[j] === "`") {
                    j += 1;
                    break;
                }
                j += 1;
            }
            i = j;
        } else {
            i += 1;
        }
    }
    return out;
}

/**
 * Is this citation rooted in a DECLARED dependency?
 *
 * 🛑 The oracle is the `package.json` files, NOT `node_modules/` — and it is
 * the same arbitration this script already made for paths ("the oracle is the
 * TRACKED INDEX, no longer the disk"). Reading the installed tree would tie
 * the verdict to the INSTALL STATE: the same commit would be green after
 * `npm ci` and red before, and the gate would say something about the
 * workstation rather than about the repo.
 *
 * ⚠️ Owned consequence: a TRANSITIVE dependency, declared nowhere, is not
 * recognised — its citations land in the baseline like any other unresolvable
 * path. That is the right way round: frozen and visible beats skipped and
 * invisible.
 */
let _depRoots = null;
function isDependencyPath(cited) {
    if (_depRoots === null) {
        _depRoots = new Set();
        const manifests = [path.join(ROOT, "package.json")];
        for (const pkg of registry.all()) manifests.push(path.join(pkg.absDir, "package.json"));
        for (const abs of manifests) {
            let json;
            try {
                json = JSON.parse(fs.readFileSync(abs, "utf8"));
            } catch {
                continue;
            }
            for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
                for (const name of Object.keys(json[field] || {})) _depRoots.add(name);
            }
        }
    }
    // ⚠️ Peeled by hand, NOT by `/^(\.\.?\/)+/`: that shape is a nested
    // quantifier, which `security/detect-unsafe-regex` rightly flags. The rule
    // stays at `error` on `scripts/` by a written decision, and its 18 legacy
    // hits live as SUPPRESSIONS — a debt that can only shrink. Adding a 19th
    // would have grown it to lay a helper, which no convenience justifies.
    let first = cited;
    while (first.startsWith("./") || first.startsWith("../")) {
        first = first.slice(first.startsWith("../") ? 3 : 2);
    }
    return _depRoots.has(first.split("/")[0]);
}

function sourceTsdoc() {
    const files = [];
    for (const pkg of registry.all()) {
        const src = path.join(pkg.absDir, "src");
        if (fs.existsSync(src)) collectFiles(src, files);
    }

    // Same extensions as the rest of the script, but LONGEST first — see
    // the detailed motive on `sourceRefs`: in alternation, `js` would cut `package.json`.
    return harvestCitedPaths({
        files,
        marker: "/**",
        blocksOf: (text) =>
            (text.match(/\/\*\*[\s\S]*?\*\//g) || []).map((block) =>
                // Strip the `@example`: their content is CODE, verified
                // elsewhere, and its import paths are resolved there by `tsc`
                // rather than guessed by a regex.
                block.replace(/@example[\s\S]*?(?=\n\s*\*\s*@|\*\/$)/g, "")
            ),
    });
}

/**
 * Paths cited by the NON-TSDoc comments of the tracked code (COMMENT-PATHS).
 *
 * The 6th source, posed on 26/08/2026, on a decision whose motive is written
 * here rather than referenced: a citation that cannot be resolved is dead for
 * its reader, and a line number is dead as soon as a line is inserted above
 * it. `TSDOC-PATHS` guarded the published prose against the first half; this
 * one guards everything the repo says to itself — and that corpus is public
 * too, since the whole repo ships.
 *
 * 🛑 **The corpus is the TRACKED INDEX, not `packages/*\/src`.** `sourceTsdoc`
 * only walks the packages' `src/`: `scripts/`, `e2e/`, the tests and the root
 * configs were outside ANY path gate. They carry the majority of the repo's
 * `//` comments — measured, ~2 585 path citations of which 2 121 already
 * resolve.
 */
function sourceComments() {
    // 🛑 The boundary is DERIVED from `lib/public-partition.cjs`, never spelled
    // out here — the same authority `check-workshop-refs.cjs` reads. Two reasons,
    // and the second is the one that bites: the workshop root is overridable by
    // environment (`docs-paths.cjs`), so a literal would be wrong the day it
    // moves; and a boundary written twice is a boundary that will diverge once.
    const { publicFiles } = partition.split(trackedFiles());
    const files = publicFiles
        .map((f) => normPath(f))
        .filter((f) => /\.(ts|tsx|js|mjs|cjs)$/.test(f))
        .map((f) => path.join(ROOT, f));

    // Anti-empty-gate: a gate that scanned nothing must not read as green.
    if (files.length === 0) {
        die(
            "[COMMENT-PATHS] corpus vide — aucun fichier de code suivi par git. " +
                "Refus de conclure : ce serait un vert qui n'a rien lu."
        );
    }
    return harvestCitedPaths({ files, marker: null, blocksOf: nonDocComments });
}

/** Paths cited by the 45 `docs/specs/` sheets (SPECS-PATHS). */
function sourceSpecs() {
    const files = [];
    collectMd(docsPaths.specs(), files);
    if (files.length === 0) {
        die(
            "corpus `docs/specs/` vide — refus de conclure. Une gate qui ne lit rien sort verte " +
                "en n'ayant rien gardé ; c'est le mode d'échec que ce script existe pour éviter."
        );
    }
    return collectCitedPaths(files, specsBases);
}

/**
 * Paths cited by `docs/guides/` and `docs/reference/` — the 3rd public sub-root.
 *
 * `SPECS-PATHS` guarded `docs/specs/` **and nothing else**, while the two
 * others ship in the same public repo and are read by the same people. The
 * cost was measured, not assumed: `TESTING_GUIDE.md` enumerated for months
 * a `poi.test.js` suite gone with the POI module's dissolution, and **no
 * gate could see it** — `check-dead-links` only extracts the markdown
 * `[text](target)` form, never a backticked file name.
 *
 * @returns {object[]} items, same shape and contract as `sourceSpecs()`.
 */
/**
 * Paths cited by the `_docs_projet/vision/` sheets (VISION-PATHS).
 *
 * 🛑 **The corpus no gate read, and the most exposed to rot.» These sheets
 * describe **specified, not developed** features: they cite paths that do
 * not exist yet, beside paths that existed and moved — and nothing told
 * the two apart. They are loaded at every "resume work" (~136 KB), so
 * their errors get reread at every resumption. `check-dead-links`
 * explicitly removes them from its perimeter, and
 * `SPECS-PATHS`/`GUIDES-PATHS` only read the public.
 *
 * ⚠️ **The baseline is the legitimate home of paths TO COME.» A path cited
 * by a vision sheet can be dead *because the feature is not written* —
 * freezing it says "known, expected", and that is exactly what the gate
 * must allow. What it catches is the OTHER case: a path that existed and
 * moved without the sheet following.
 *
 * 🛑 **This source READS THE WORKSHOP**, so it falls under
 * `NEEDS_INTERNAL_ROOT`: on the public clone, `_docs_projet/` does not
 * exist and the gate SKIPS saying so. Do not remove it from that list "for
 * uniformity" — that is what nearly made `SPECS-PATHS` green and blind.
 */
function sourceVision() {
    const files = [];
    collectMd(docsPaths.internal("vision"), files);
    if (files.length === 0) {
        die(
            "corpus `_docs_projet/vision/` vide — refus de conclure. Une gate qui ne lit rien " +
                "sort verte en n'ayant rien gardé."
        );
    }
    return collectCitedPaths(files, visionBases);
}

/**
 * Resolution bases specific to `vision/`.
 *
 * 🛑 **Without the first two, the instrument would carry the blindness it
 * measures.» These sheets refer to their workshop neighbours by BARE NAME
 * — `ETAT.md`, `JOURNAL.md`, `CDC_plugin-navigation_technique.md`.
 * Resolved on `guidesBases`, which ignores `_docs_projet/`, they were all
 * counted DEAD while they exist: the first measure returned 46 absent of
 * which several alive, and freezing that count would have frozen falsehood
 * into a baseline supposed to hold only the known.
 *
 * ⚠️ The corollary applies word for word here — "the preflight can carry
 * the blindness it measures". Verify the base BEFORE believing the count.
 */
function visionBases(rel) {
    return [
        normPath(path.dirname(rel)) + "/",
        docsPaths.rel(docsPaths.INTERNAL_ROOT) + "/",
        docsPaths.rel(docsPaths.INTERNAL_ROOT) + "/vision/",
        docsPaths.rel(docsPaths.INTERNAL_ROOT) + "/registres/",
        "packages/core/src/",
        "packages/core/",
        "docs/",
        "docs/specs/",
        "docs/reference/",
        "profiles/_reference/",
        "",
    ];
}

function sourceGuides() {
    const files = [];
    collectMd(docsPaths.guides(), files);
    collectMd(docsPaths.reference(), files);
    const kept = files.filter((f) => !GUIDES_GENERATED.has(normPath(path.relative(ROOT, f))));
    if (kept.length === 0) {
        die(
            "corpus `docs/guides/` + `docs/reference/` vide — refus de conclure. Une gate qui ne " +
                "lit rien sort verte en n'ayant rien gardé."
        );
    }
    return collectCitedPaths(kept, guidesBases);
}

/**
 * Paths cited by `packages/core/docs/` — the 5th source, and the repo's
 * most NORMATIVE corpus.
 *
 * 🛑 **The hole was measured, and it was the costliest of the four.»
 * `SPECS-PATHS` guards `docs/specs/`, `GUIDES-PATHS` guards
 * `docs/guides/` + `docs/reference/`, `VISION-PATHS` guards the workshop —
 * **none** read `packages/core/docs/`, which nonetheless ships in the npm
 * tarball AND the public repo, and which `check-dead-links` counts as its
 * biggest scope (60 files).
 *
 * ⚠️ **And the directory ALREADY appeared in the gate, which led to the
 * backwards conclusion.» It is listed in `guidesBases()` — but as a
 * **resolution destination**, never a **scanned source**. A `grep` on its
 * name in this file returns a hit and lets it be believed guarded. The
 * failure mode that lesson carries as its title: _referenced ≠ read_.
 *
 * **Why `guidesBases` and not its own base**: these documents refer to
 * each other by bare name (`ARCHITECTURE_GUIDE.md`,
 * `GeoLeaf_core_README.md`) and cite the core's code by paths relative to
 * `packages/core/src/` — exactly the bases `guidesBases()` already
 * carries, whose 4th entry is precisely `packages/core/docs/`. Giving it a
 * new base would duplicate a list already corrected once for blindness.
 *
 * @returns {object[]} items, same shape and contract as `sourceGuides()`.
 */
function sourceCoreDocs() {
    const files = [];
    // Derived from the registry, never hardcoded: `packages/core` can move.
    collectMd(path.join(require("./lib/packages.cjs").byName("@geoleaf/core").dir, "docs"), files);
    if (files.length === 0) {
        die(
            "corpus `packages/core/docs/` vide — refus de conclure. Une gate qui ne lit rien " +
                "sort verte en n'ayant rien gardé."
        );
    }
    return collectCitedPaths(files, guidesBases);
}

/**
 * Resolution roots of a `docs/specs/` sheet, most specific first.
 *
 * ⚠️ **This function IS the 4th base, and without it the source measures
 * nothing useful.» A capability sheet cites `lifecycle.ts`, `config.ts`,
 * `public-api.ts` — the module contract's names, carried identically by
 * the 21 capabilities and the 12 plugins. Resolved globally they are
 * ambiguous at 20-30 candidates and `suffixIndex` refuses to settle
 * (rightly); resolved from the sheet's SUBJECT directory, they are exact.
 * Measured on 11/08/2026: the subject root alone resolves **51.4%** of the
 * 1,592 unrooted paths, the common bases bring the total to **73.5%**.
 *
 * 🛑 **What these bases do NOT do**: they do not lift the ambiguity for
 * the READER. A `config.ts` cited in a sheet it is not the subject of
 * stays unreadable even if the gate resolves it. Editorial rooting is a
 * distinct gesture, and this gate does not claim to carry it — it guards a
 * narrow property: no NEW dead path.
 *
 * @param {string} rel - the sheet's path, relative to the repo root.
 * @returns {string[]} prefixes to try in order, `/`-terminated (except the root, `""`).
 */
function specsBases(rel) {
    const bases = [];
    let m;
    if ((m = rel.match(/\/capacites\/(.+)\.md$/))) {
        bases.push(`packages/core/src/capabilities/${m[1]}/`);
    } else if ((m = rel.match(/\/plugins\/CDC_(.+)\.md$/))) {
        bases.push(`packages/plugins/${m[1]}/src/`, `packages/plugins/${m[1]}/`);
    } else if ((m = rel.match(/\/libs\/(.+)\.md$/))) {
        bases.push(`packages/libs/${m[1]}/src/`, `packages/libs/${m[1]}/`);
    }
    // Common bases: the core is cited by ALL the sheets (kernel, contracts,
    // RFC included), then the documentation roots — a `CDC_kernel.md`
    // reference from `capacites/` only resolves through `docs/specs/`. The
    // repo root comes last: it accepts already repo-rooted paths, the
    // target form.
    bases.push(
        "packages/core/src/",
        "packages/core/",
        normPath(path.dirname(rel)) + "/",
        "docs/specs/",
        "docs/reference/",
        ""
    );
    return bases;
}

/**
 * Paths cited by the 45 `docs/specs/` sheets — the corpus NO gate read.
 *
 * ⚠️ **Finding that motivates this source, measured on 11/08/2026 by
 * elimination over `ci:local`'s 78 gates**: `check-dead-links` only
 * extracts `[text](target)` (`:321`), TSDOC-PATHS stops at the packages'
 * `src/` and has no `md` in its alternation, the `.md` corpora of
 * `validate-docs-examples`/`typecheck-docs-examples` are taken at depth 0
 * of the root (`lib/tsdoc-examples.cjs`, hence never `docs/`), and the
 * 3 guards only check named tables. **546 (sheet→path) pairs were guarded
 * by nothing** — hence the class that "expires without ever turning red".
 * Not a fatality, a tooling hole.
 *
 * Three owned divergences from `sourceTsdoc`, each measured:
 *
 *   1. **`md` enters the alternation.» The sheets cite one another —
 *      `CDC_kernel.md` 35 times, `ARBORESCENCE_QUALIFIEE.md` 35 times.
 *      Placed LAST: the alternation reads in order, and a short extension
 *      placed too early cuts the long ones.
 *   2. **A bare name is accepted if `.md`, refused otherwise.»
 *      `CDC_kernel.md` designates a real document and resolves through the
 *      documentation roots; `config.ts` without a directory is carried by
 *      28 files and cannot be settled — the editorial gesture, not a resolver's.
 *   3. **URLs are removed BEFORE the regex.» `https://geoleaf.dev/x.json`
 *      would capture `geoleaf.dev/x.json`, eternally dead and
 *      unfixable — `sourceTsdoc`'s 4th false-positive class (the package
 *      specifier) under another name.
 *
 * @returns {object[]} items `{ id, file, line, citedIn, cited }`, deduplicated per pair.
 */
/**
 * Extraction engine SHARED by `--source specs` and `--source guides`.
 *
 * ⚠️ **Extracted from `sourceSpecs()` on 11/08/2026, and not for love of
 * the common factor.» The 3rd source needed the same loop to a few lines;
 * copying it would have created **two extractors free to diverge** on a
 * repo that has already paid that defect twice (a duplicated exclusion
 * fixed on one side only, a gate left blind). One engine, two corpora, two
 * baselines.
 *
 * @param {string[]} files - documents to read, absolute paths.
 * @param {(rel: string) => string[]} basesFor - resolution roots, per document.
 * @returns {object[]} items `{ id, file, line, citedIn, cited }`, deduplicated per pair.
 */
function collectCitedPaths(files, basesFor) {
    const refRe =
        /([A-Za-z0-9_@./-]+\.(?:tsx|mjs|cjs|json|html|yaml|css|yml|ts|js|md))(?::(\d+))?/g;
    const seen = new Map();

    for (const abs of files.sort()) {
        const rel = normPath(path.relative(ROOT, abs));
        let text;
        try {
            text = fs.readFileSync(abs, "utf8");
        } catch {
            continue;
        }
        const bases = basesFor(rel);

        // Fenced blocks carry example CODE, not references: their import
        // paths are verified by `typecheck-docs-examples` on its own
        // corpus, and judging them here would produce two diverging guards
        // on the same defect — the motive that already excluded the
        // `@example` from `sourceTsdoc`.
        //
        // 🛑 **IT IS ALSO THIS SOURCE'S BLIND SPOT, and it has a measured
        // cost.» The 11/08/2026 rereading found
        // `"addpoi": "config/plugins/addpoi.json"` in TWO copy-pastable
        // ```json examples (`CDC_kernel.md` §The `Files` manifest,
        // `PROFILE_CONTRACT_SPEC.md` §3 and §4) — a plugin since merged
        // into `editor`. Invisible here because fenced, and invisible to
        // the profile guards because they validate the SHAPE against
        // `profile.schema.json`, where `Files.modules` has dynamic keys.
        // Two green gates, one dead example. **Do not "fix" by lifting
        // this exclusion**: it would avoid this case at the price of
        // judging all the code examples' import paths, which
        // `typecheck-docs-examples` already does, and better. The hole is
        // real, it is named, and it closes by rereading — not by this regex.
        let inFence = false;
        for (const raw of text.split("\n")) {
            if (/^\s*(```|~~~)/.test(raw)) {
                inFence = !inFence;
                continue;
            }
            if (inFence) continue;

            const line = raw.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, " ");
            let m;
            refRe.lastIndex = 0;
            while ((m = refRe.exec(line)) !== null) {
                const cited = m[1];
                if (cited.startsWith("@")) continue;
                if (cited.startsWith("/")) continue;
                if (!cited.includes("/") && !cited.endsWith(".md")) continue;

                const forms = [cited];
                if (/\.js$/.test(cited)) forms.push(cited.replace(/\.js$/, ".ts"));
                if (/\.mjs$/.test(cited)) forms.push(cited.replace(/\.mjs$/, ".mts"));

                let resolved = null;
                outer: for (const form of forms) {
                    for (const b of bases) {
                        const cand = normPath(path.normalize(path.join(b, form)));
                        if (cand.startsWith("..")) continue;
                        if (fs.existsSync(path.join(ROOT, cand))) {
                            resolved = cand;
                            break outer;
                        }
                    }
                }
                // Same exposure as in `harvestCitedPaths` — see the reasoning there. The two
                // loops are deliberately kept side by side rather than factored: they read
                // different corpora with different bases, and a shared helper would have to
                // take both, which is how one of them would quietly stop being exercised.
                let viaSuffix = false;
                let ambiguousWith = null;
                if (!resolved) {
                    for (const form of forms) {
                        const tail = form.replace(/^(\.\.?\/)+/, "").replace(/^\/+/, "");
                        if (!tail.includes("/")) continue;
                        const hits = suffixIndex(tail);
                        if (hits.length === 1) {
                            resolved = hits[0];
                            viaSuffix = true;
                            break;
                        }
                        if (hits.length > 1 && ambiguousWith === null) ambiguousWith = hits;
                    }
                }
                const file = resolved ?? normPath(path.normalize(path.join(bases[0], cited)));

                const key = `${rel}→${cited}`;
                if (!seen.has(key)) {
                    seen.set(key, {
                        id: key,
                        file,
                        viaSuffix,
                        ambiguousWith,
                        line: m[2] ? Number(m[2]) : null,
                        citedIn: rel,
                        cited,
                    });
                }
            }
        }
    }
    return [...seen.values()];
}

/** Recursive `.md` collection — `collectFiles` filters on `SOURCE_EXTS`, which lacks `md`. */
/**
 * Resolution roots of a `docs/guides/` or `docs/reference/` document.
 *
 * ⚠️ **Deliberately different from `specsBases()`**: those are cut for the
 * `capacites/` · `plugins/` · `libs/` structure, where the file's name
 * designates the subject and thus gives a root (`capabilities/<id>/`). A
 * guide has no subject deducible from its name: it cites code from
 * anywhere. Its bases are thus generic, ordered most specific to widest.
 *
 * @param {string} rel - the document's path, relative to the repo root.
 * @returns {string[]} prefixes to try in order.
 */
function guidesBases(rel) {
    return [
        normPath(path.dirname(rel)) + "/",
        "packages/core/src/",
        "packages/core/",
        // The site's doc: these documents refer to each other by BARE NAME
        // (`ARCHITECTURE_GUIDE.md`, `GeoLeaf_core_README.md`). Without this
        // base, 4 LIVE references were counted dead — the instrument would
        // have carried the blindness it measures, and the baseline would
        // have frozen falsehood.
        "packages/core/docs/",
        // The `config/core/*.json` and `layers/<id>/…` paths are relative
        // to a PROFILE, not the repo. `_reference` is the canonical
        // profile, the one whose structure is authoritative.
        "profiles/_reference/",
        "docs/",
        "docs/reference/",
        "docs/specs/",
        "",
    ];
}

/**
 * The GENERATED artefacts of `docs/reference/`, out of corpus — and the
 * motive is not comfort.
 *
 * They are **true by construction**: `generate-docs-tree.cjs`,
 * `gen-attributes-report.cjs` and `gen-profile-schema-reference.cjs`
 * derive them from the disk and the schemas, and each already carries its
 * `--check` gate in `ci:local`. Including them here would bring the tree's
 * ~1,900 lines — i.e. **one path per repo file** — into a baseline nobody
 * could read any more, to guard a property already guarded elsewhere, and
 * better.
 *
 * 🛑 Do not add a HAND-WRITTEN file to it: that would subtract it from the
 * only gate that looks at it. The list justifies itself file by file,
 * never by a glob.
 */
const GUIDES_GENERATED = new Set([
    "docs/reference/ARBORESCENCE_QUALIFIEE.md",
    "docs/reference/MODELE_ATTRIBUTAIRE.md",
    "docs/reference/PROFILE_SCHEMA_REFERENCE.md",
]);

function collectMd(dir, acc) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return acc;
    }
    for (const e of entries) {
        if (EXCLUDED_DIRS.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) collectMd(full, acc);
        else if (e.isFile() && e.name.endsWith(".md")) acc.push(full);
    }
    return acc;
}

// ─── Run ──────────────────────────────────────────────────────────────────────

function main() {
    const source = arg("source");
    if (!source)
        die(
            "--source requis (s4-triage | s4-low | refs | files | tsdoc | comments | specs | guides | vision)"
        );

    const corpus = buildCorpus();
    let items;
    let label = source;

    if (source === "s4-triage") items = sourceS4Triage();
    else if (source === "s4-low") items = sourceS4Low();
    else if (source === "tsdoc") items = sourceTsdoc();
    else if (source === "specs") items = sourceSpecs();
    else if (source === "guides") items = sourceGuides();
    else if (source === "vision") items = sourceVision();
    else if (source === "core-docs") items = sourceCoreDocs();
    else if (source === "comments") items = sourceComments();
    else if (source === "refs" || source === "files") {
        const doc = arg("doc");
        if (!doc) die("--doc requis avec --source refs|files");
        label = `${source}:${path.basename(doc)}`;
        items = source === "refs" ? sourceRefs(doc) : sourceFiles(doc);
    } else die(`source inconnue « ${source} »`);

    // Refuse explicitly rather than ignore the flag: `--gate --source refs`
    // would exit 0 silently, i.e. "green" — exactly the false-green class
    // this script exists to avoid. The gated sources are those measuring
    // the REPO (the TSDoc prose, the sheets' references) and not a workshop
    // document's freshness.
    if (GATE && !GATES[source]) {
        die(`--gate n'est disponible qu'avec --source ${Object.keys(GATES).join(" | ")}`);
    }

    const results = items.map((it) => probeItem(it, corpus));

    const tally = {};
    for (const r of results) tally[r.verdict] = (tally[r.verdict] || 0) + 1;
    const fileTally = {};
    for (const r of results) fileTally[r.observed.file] = (fileTally[r.observed.file] || 0) + 1;

    const report = {
        source: label,
        measuredAt: "HEAD",
        corpusFiles: corpus.entries.length,
        itemCount: results.length,
        tally,
        fileTally,
        results,
    };

    const out = arg("out");
    if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");

    if (!QUIET) {
        process.stdout.write(
            `\n── ${label} — ${results.length} items · corpus ${corpus.entries.length} fichiers\n`
        );
        process.stdout.write(`   chemins : ${JSON.stringify(fileTally)}\n`);
        process.stdout.write(`   verdicts: ${JSON.stringify(tally)}\n`);
        const notable = results.filter((r) => r.verdict === "open" || r.verdict === "drift");
        if (notable.length) {
            process.stdout.write(`\n   ⚠️  ${notable.length} item(s) à instruire :\n`);
            for (const r of notable.slice(0, 60)) {
                process.stdout.write(
                    `   · [${r.verdict}] ${r.id || r.file} — ${r.why}` +
                        (r.observed.at && r.observed.file === "moved"
                            ? ` (déménagé → ${r.observed.at})`
                            : "") +
                        `\n`
                );
            }
            if (notable.length > 60)
                process.stdout.write(`   … +${notable.length - 60} autres (voir --out)\n`);
        }
        if (out) process.stdout.write(`\n   → ${out}\n`);
    }

    if (GATE) process.exit(runGate(results, GATES[source]));
    process.exit(0);
}

// ─── Mode gate — `--source tsdoc|specs --gate` ────────────────────────────────

/**
 * The FOUR ratchets, one per gated source — `tsdoc`, `specs`, `guides`,
 * `vision`. Same mechanics and contract, different corpora:
 *
 * ⚠️ This line said "the TWO ratchets" until 17/08/2026, while
 * `GUIDES-PATHS` exists since 11/08 and `VISION-PATHS` since 17/08. The
 * count derives rather than copies: `grep -n 'check:.*-paths' package.json`.
 * `tsdoc` measures the TSDoc prose of the package `src/`, `specs` the
 * references of the 45 `docs/specs/` sheets. Separating the baselines is
 * deliberate — a single baseline would mix two deposits whose correction
 * gestures have nothing in common, and its count would stop meaning anything.
 */
const GATES = {
    tsdoc: {
        code: "TSDOC-PATHS",
        baseline: path.join(__dirname, "audit-tsdoc-paths.baseline.json"),
        what: "dans la prose des blocs TSDoc",
        cmd: "--source tsdoc --gate",
        hint:
            "    Un TSDoc qui renvoie à un fichier absent reste lisible et convaincant\n" +
            "    longtemps après que le fichier a bougé. Corriger la citation.\n" +
            "    ⚠️ MAIS LIRE LA PHRASE D'ABORD. Une part de cette baseline nomme un\n" +
            "    chemin PARCE QU'IL EST MORT (« reclassified from… », « the former… »,\n" +
            "    « extracted from… ») : ces citations-là sont JUSTES et ne se réécrivent pas.\n" +
            "    Les corriger effacerait l'histoire que la phrase raconte.\n" +
            "    Mesuré le 16/08/2026 : entre 25 et 44 des 76 entrées selon le motif de\n" +
            "    reconnaissance — l'écart de 19 vient de l'INSTRUMENT, pas du corpus, et c'est\n" +
            "    pourquoi aucune partition automatique n'est figée ici.\n",
    },
    specs: {
        code: "SPECS-PATHS",
        baseline: path.join(__dirname, "audit-specs-paths.baseline.json"),
        what: "dans les renvois des fiches `docs/specs/`",
        cmd: "--source specs --gate",
        hint:
            "    Ces 45 fiches partent dans le dépôt public et les tarballs npm sont immuables :\n" +
            "    un renvoi faux y devient définitif. ⚠️ Avant de « corriger », LIRE LA PHRASE —\n" +
            "    une fiche nomme souvent un chemin PARCE QU'IL EST MORT (« ce répertoire n'existe\n" +
            "    plus », « supprimé depuis »). Ceux-là entrent en baseline, ils ne se\n" +
            "    réécrivent pas : mesuré 15 sur 20 à la classe A de la tâche 6.11.\n",
    },
    guides: {
        code: "GUIDES-PATHS",
        baseline: path.join(__dirname, "audit-guides-paths.baseline.json"),
        what: "dans les renvois de `docs/guides/` et `docs/reference/`",
        cmd: "--source guides --gate",
        hint:
            "    La 3ᵉ sous-racine publique, restée SANS gate jusqu'au 11/08/2026 —\n" +
            "    `SPECS-PATHS` ne gardait que `docs/specs/`. Ce trou a laissé `TESTING_GUIDE.md`\n" +
            "    enseigner une suite `poi.test.js` disparue avec le module POI.\n" +
            "    ⚠️ Même précaution qu'en `specs` : LIRE LA PHRASE avant de corriger — un guide\n" +
            "    nomme souvent un chemin PARCE QU'IL A DISPARU. Ceux-là entrent en baseline.\n" +
            "    Les artefacts GÉNÉRÉS de `docs/reference/` sont hors corpus (voir\n" +
            "    `GUIDES_GENERATED`) : vrais par construction, et déjà gatés par leur `--check`.\n",
    },
    "core-docs": {
        code: "CORE-DOCS-PATHS",
        baseline: path.join(__dirname, "audit-core-docs-paths.baseline.json"),
        what: "dans les renvois de `packages/core/docs/`",
        cmd: "--source core-docs --gate",
        hint:
            "    La 5ᵉ source, posée le 17/08/2026 sur le corpus le plus\n" +
            "    NORMATIF du dépôt : il part dans le tarball npm ET dans le clone public.\n" +
            "    🛑 Le répertoire figurait DÉJÀ dans ce fichier — comme destination de\n" +
            "    résolution (`guidesBases()`), jamais comme source scannée. Un grep sur son nom\n" +
            "    rendait un résultat et faisait conclure qu'il était gardé : référencé ≠ lu.\n" +
            "    ⚠️ Même précaution qu'en `specs` et `guides` : LIRE LA PHRASE avant de\n" +
            "    corriger — un document nomme souvent un chemin PARCE QU'IL A DISPARU.\n" +
            "    Ce corpus est PUBLIC : la gate ne saute pas sur le clone public, et c'est\n" +
            "    voulu — c'est là que ses renvois sont lus par des tiers.\n",
    },
    comments: {
        code: "COMMENT-PATHS",
        baseline: path.join(__dirname, "audit-comment-paths.baseline.json"),
        what: "dans les commentaires NON-TSDoc du code suivi",
        cmd: "--source comments --gate",
        hint:
            "    La 6ᵉ source, posée le 26/08/2026. `TSDOC-PATHS` gardait la prose\n" +
            "    PUBLIÉE ; celle-ci garde ce que\n" +
            "    le dépôt se dit à lui-même — et ce corpus part au public lui aussi.\n" +
            "    🛑 ELLE COUVRE CE QU'AUCUNE AUTRE NE VOYAIT : `scripts/`, `e2e/`, les tests et\n" +
            "    les configs racine n'étaient dans le corpus d'AUCUNE gate de chemins, alors\n" +
            "    qu'ils portent la majorité des `//` du dépôt.\n" +
            "    ⚠️ LIRE LA PHRASE AVANT DE CORRIGER, et ici plus qu'ailleurs : l'arbitrage a\n" +
            "    déclaré LÉGITIME la citation dont le POINT est que la chose a disparu\n" +
            "    (`maplibre-gl-csp.js` « plus publié en v6 », `deploy-addpoi` retiré). Ces\n" +
            "    citations-là entrent en baseline et ne se réécrivent pas : les corriger\n" +
            "    détruirait le motif que la phrase porte.\n",
    },
    vision: {
        code: "VISION-PATHS",
        baseline: path.join(__dirname, "audit-vision-paths.baseline.json"),
        what: "dans les renvois de `_docs_projet/vision/`",
        cmd: "--source vision --gate",
        hint:
            "    Le corpus des features SPÉCIFIÉES ET NON DÉVELOPPÉES, resté sans gate jusqu'au\n" +
            "    17/08/2026 (R5 2.1). Il est chargé à chaque « reprends le travail », donc ses\n" +
            "    erreurs se relisent à chaque reprise — et `check-dead-links` l'exclut de son\n" +
            "    périmètre.\n" +
            "    🛑 ICI LA BASELINE N'EST PAS UN AVEU, C'EST LE CAS NORMAL : une fiche de vision\n" +
            "    cite légitimement des chemins QUI N'EXISTENT PAS ENCORE — c'est ce qu'elle\n" +
            "    décrit. Les geler dit « attendu, pas oublié ». Ce que la gate attrape est\n" +
            "    l'AUTRE cas : un chemin qui existait et qui a BOUGÉ sans que la fiche suive.\n" +
            "    ⚠️ Ne pas « corriger » un absent sans lire la phrase : la distinction entre\n" +
            "    « à venir » et « périmé » ne se voit que là.\n" +
            "    Cette source lit l'ATELIER : sur le clone public elle saute, en le disant.\n",
    },
};

/**
 * DECREASING ratchet on the dead paths cited in the TSDoc prose.
 *
 * On the pattern of TSD-04 (`check-tsdoc-conformity`) and the
 * already-proven decreasing ratchet: the baseline can only **shrink**. Two
 * failures, not one:
 *
 *   - **TSDOC-PATHS-01** — a NEW dead path, absent from the baseline. The normal defect.
 *   - **TSDOC-PATHS-02** — a baseline entry matching nothing any more
 *     (path repaired, or TSDoc deleted) and not removed. Without this
 *     second axis, a baseline fossilises: it ends up describing a repo
 *     that no longer exists, and nobody notices since it exits green. The
 *     fossilising failure mode.
 *
 * ⚠️ **Why a baseline rather than an immediate zero.» The 84 occurrences
 * remaining at wiring are real dead paths, but their correction touches
 * ~40 files and belongs to
 * distinct gestures (the dissolved `modules/` directory, pre-migration
 * test headers, `dist/` citations). Freezing them keeps the gain — **no
 * NEW dead citation can enter any more** — and makes the debt visible and
 * decreasing, instead of blocking on a work stream unrelated to the next
 * commit.
 *
 * @param {object[]} results - the measured items.
 * @param {object} cfg - the `GATES` entry for the source (code, baseline, hint…).
 * @returns {number} exit code (0 green, 1 red).
 */
function runGate(results, cfg) {
    const { code, baseline: BASELINE, what, cmd, hint } = cfg;
    const dead = results
        .filter((r) => r.observed.file === "absent")
        .map((r) => r.id)
        .sort();
    // Printed at every run, never copied: build-output citations are the
    // only ones the tracked index cannot settle, hence the only ones whose
    // verdict still depends on a build. The count stays VISIBLE so that
    // dependency is not forgotten.
    const sorties = results.filter(
        (r) => r.observed.at && String(r.observed.at).split("/").includes("dist")
    ).length;

    // EXPOSURE — citations alive only because their suffix matches exactly ONE tracked file.
    //
    // ⚠️ This is not decoration, it is the number that was missing. Each of these is one
    // homonym away from being reported dead, and the homonym can arrive in ANOTHER package
    // entirely — adding a second `lifecycle.ts` two directories away breaks a citation nobody
    // touched, in a package its author never opened. The count prints at every run so the
    // surface is a known quantity rather than a surprise, and it is never copied into prose —
    // it moves with every file added to the repo.
    const exposees = results.filter((r) => r.viaSuffix).length;

    // Citations whose suffix ALREADY matches several files. They come out "dead" here, which
    // is the true verdict but the wrong DIAGNOSIS: the path is not gone, it stopped being
    // decidable. Naming the candidates turns an opaque red into an actionable one.
    const ambigus = new Map(
        results
            .filter((r) => r.ambiguousWith && r.ambiguousWith.length > 1)
            .map((r) => [r.id, r.ambiguousWith])
    );

    if (UPDATE_BASELINE) {
        fs.writeFileSync(
            BASELINE,
            JSON.stringify(
                {
                    _comment:
                        `Chemins morts CONNUS ${what}, figés par ` +
                        `\`audit-report-freshness.cjs ${cmd}\`. Clé = ` +
                        "`<fichier citant>→<chemin cité>`. Le gate rougit sur une entrée ABSENTE " +
                        `d'ici (${code}-01) ET sur une entrée d'ici qui n'existe plus ` +
                        `(${code}-02) : la baseline ne peut que RÉTRÉCIR. Régénérer via ` +
                        "`--update-baseline` après avoir corrigé un lot.",
                    generatedCount: dead.length,
                    paths: dead,
                },
                null,
                4
            ) + "\n"
        );
        process.stdout.write(
            `\n✓ ${code}: baseline régénérée (${dead.length} chemin(s) figé(s)).\n`
        );
        return 0;
    }

    let baseline = [];
    if (fs.existsSync(BASELINE)) {
        baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8")).paths || [];
    }
    const known = new Set(baseline);
    const current = new Set(dead);

    const fresh = dead.filter((k) => !known.has(k));
    const stale = baseline.filter((k) => !current.has(k));

    // A gate scanning nothing must shout, not pass.
    if (results.length === 0) {
        process.stderr.write(
            `\n❌  ${code} — 0 item mesuré. Le corpus a bougé ou l'extracteur est cassé ;\n` +
                `    une sortie verte ici signifierait « rien à vérifier », pas « tout est bon ».\n`
        );
        return 1;
    }

    if (fresh.length === 0 && stale.length === 0) {
        process.stdout.write(
            `\n✓ ${code} — aucun chemin mort neuf ; baseline ${baseline.length} ` +
                `(ne peut que rétrécir)` +
                (sorties > 0 ? ` · ${sorties} citation(s) de sortie de build, hors jugement` : "") +
                (exposees > 0
                    ? ` · ${exposees} citation(s) résolue(s) par SUFFIXE UNIQUE — un homonyme ` +
                      `neuf ailleurs dans le dépôt les rendrait ambiguës`
                    : "") +
                `.\n`
        );
        return 0;
    }

    if (fresh.length) {
        process.stderr.write(`\n❌  ${code}-01 — ${fresh.length} chemin(s) mort(s) NEUF(S) :\n`);
        for (const k of fresh.slice(0, 40)) {
            process.stderr.write(`      ${k}\n`);
            // 🛑 The candidates, when there are any, because "dead path" is the wrong reading
            // here and it sends the reader to fix a citation that is CORRECT. What happened is
            // that a file was added elsewhere whose path ends the same way, so the suffix
            // stopped designating one file. Fixing the citation would break an exact quote;
            // freezing it in the baseline would record a non-defect. Neither is the gesture:
            // the citation needs one more segment of prefix, or the new file another name.
            const cands = ambigus.get(k);
            if (cands) {
                process.stderr.write(
                    `        ↳ AMBIGU, pas absent — ${cands.length} fichiers finissent ainsi :\n`
                );
                for (const c of cands.slice(0, 6)) process.stderr.write(`            ${c}\n`);
                if (cands.length > 6) process.stderr.write(`            … +${cands.length - 6}\n`);
            }
        }
        if (fresh.length > 40) process.stderr.write(`      … +${fresh.length - 40}\n`);
        process.stderr.write(`\n${hint}`);
    }
    if (stale.length) {
        process.stderr.write(
            `\n❌  ${code}-02 — ${stale.length} entrée(s) PÉRIMÉE(S) dans la baseline :\n`
        );
        for (const k of stale.slice(0, 40)) process.stderr.write(`      ${k}\n`);
        if (stale.length > 40) process.stderr.write(`      … +${stale.length - 40}\n`);
        process.stderr.write(
            `\n    Ces chemins ne sont plus morts — c'est une bonne nouvelle, et elle doit être\n` +
                `    ACTÉE : régénérer via --update-baseline, pour que le cliquet descende.\n`
        );
    }
    return 1;
}

main();
