#!/usr/bin/env node
/**
 * typecheck-docs-examples.cjs
 *
 * Type-checks the TypeScript examples embedded in the core documentation against the
 * package's own `.d.ts`, so a documented call that could not compile fails the build.
 *
 * ## Why this exists, next to `validate-docs-examples.cjs`
 *
 * That gate is a hand-maintained DENY-list of known-bad patterns. It catches a phantom
 * API only once somebody writes the rule, and it cannot see anything about a call it
 * has no regex for. Two examples of the same defect shipped straight through it:
 * `Notifications.notify("…", "info", { persistent: true })` passed an options object as
 * the THIRD argument where the signature reads `duration?: number`, and assigned the
 * result of a call the facade declared `void`. Both were real, both were copy-pasteable,
 * neither matched any rule. A compiler does not need the rule to be written down.
 *
 * ## Scope — TWO corpora since 2026-07-27
 *
 * 1. The ts/typescript blocks of `packages/core/docs/` `.md` files.
 * 2. **The TSDoc `@example`s of all sources** (every `src/` of the package registry).
 *    The engine existed, it simply was not wired to them.
 *
 * ⚠️ **What corpus 2 does NOT cover, and why it is not a comfort choice.** Measured on
 * 2026-07-27: **101 `@example`s enter, 49 are compiled, 52 are set aside** — the latter
 * go through the ambient `GeoLeaf.*` namespace, which **the published package does not
 * declare**. `src/global.d.ts` is never emitted into `dist/types/` (TypeScript does not
 * re-emit an entry `.d.ts`: `emitDeclarationOnly` skips it), and no `declare global`
 * ships in the tarball. Proven by compiling against the published types:
 * `GeoLeaf.Core.setTheme("dark")` renders **TS2304 Cannot find name 'GeoLeaf'**.
 * Including them would mean scanning while seeing nothing — failure mode (1) below. The
 * counter shows them at every run rather than silencing them.
 *
 * Every ts/typescript block that PARSES. Of the 136 in the docs, 27 do not — they are
 * deliberate fragments (`…`), pseudo-code and partial objects, and they are skipped.
 *
 * Most of the rest never write an import: the docs show `Notifications.success(…)` and
 * let a sentence above name the module. Compiling those as-is yields nothing but
 * `TS2304: Cannot find name`, so this script reconstructs the missing prelude — every
 * referenced identifier that is a real export of `@geoleaf/core`, and is not declared
 * inside the block, gets imported. That is what puts the example the backlog entry cites
 * (`API_REFERENCE.md`, the `Notifications` block) in scope at all: without the prelude
 * it is invisible to the compiler, and the arity defect it carried would survive again.
 *
 * ## Which diagnostics count
 *
 * Only the ones that mean "this example cannot work": unknown export, unknown property,
 * wrong argument type, wrong ARITY, unresolvable `@geoleaf/*` subpath. See
 * {@link DEFECT_CODES}.
 *
 * Everything else is a documentation idiom, not a defect, and is ignored on purpose —
 * `Cannot find name 'map'` means the example elided its setup, `implicitly has an 'any'
 * type` means it omitted a type annotation for readability. Reporting those would bury
 * the eight real defects under seventy-five false ones, and a gate nobody can read is a
 * gate nobody keeps.
 *
 * ## ⚠️ Three failure modes this script refuses to have
 *
 * 1. **Green having scanned nothing.** `tsc` suppresses ALL semantic diagnostics
 *    program-wide as soon as ONE file in the program has a syntax error. Feed it the
 *    fragments and it exits 0 having type-checked nothing at all — the worst possible
 *    result. Hence the parse pre-filter; hence the counts printed on every run; hence
 *    the hard failure when the in-scope set is empty; and hence {@link assertNoSyntaxNoise},
 *    which fails the gate if a TS1xxx ever reaches the output, because that proves the
 *    pre-filter leaked and the semantic pass was silently disabled.
 * 2. **A silently-moved corpus.** The docs directory is derived from the package
 *    registry (`scripts/lib/packages.cjs`), never hard-coded: a hard-coded
 *    `packages/<name>` path does not break when the package moves, it stops matching
 *    and the gate goes green having scanned nothing. Same class as (1).
 * 3. **A prelude that hides the defect.** The injected imports name only symbols the
 *    package really exports, read from its own `.d.ts` — never a stub, never an `any`.
 *    A phantom API therefore stays phantom.
 *
 * ## Baseline
 *
 * The defects that exist today are FROZEN in `typecheck-docs-examples.baseline.json`;
 * this gate blocks only on a NEW one — the same convention as `check-orphan-exports`
 * and `check-dynamic-key-writes`. Fixing the frozen ones is documentation work with its
 * own review.
 *
 * ## Prerequisite
 *
 * Needs `dist/types/` (the published declarations), so it runs AFTER the build — like
 * `npm run typecheck:consumer`. A missing build is a hard error, never a silent skip.
 *
 * Exit code 0 — no NEW type error
 * Exit code 1 — at least one NEW type error (or nothing to scan / no build)
 *
 * Usage:
 *   node scripts/typecheck-docs-examples.cjs
 *   node scripts/typecheck-docs-examples.cjs --verbose
 *   node scripts/typecheck-docs-examples.cjs --update-baseline
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const registry = require("./lib/packages.cjs");
const { extractTsdocExamples, sourceFiles, productDocsFiles } = require("./lib/tsdoc-examples.cjs");

const ROOT = registry.ROOT;
const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose");
const UPDATE_BASELINE = args.includes("--update-baseline");

const BASELINE_PATH = path.join(__dirname, "typecheck-docs-examples.baseline.json");

// The corpus is derived, never hard-coded — see the header note on failure mode (2).
const CORE = registry.byName("@geoleaf/core");
if (!CORE) {
    console.error(
        "[typecheck-docs-examples] Package @geoleaf/core is absent from the workspace registry."
    );
    process.exit(1);
}
// 2026-07-31 — the `.md` perimeter goes from `packages/core/docs/` to the PRODUCT
// surfaces, and it is derived in `lib/tsdoc-examples.cjs` so `validate-docs-examples`
// reads exactly the same one. The rationale is written on `productDocsFiles`; the
// summary fits in one line: the rule forbidding a ghost API existed, its corpus is what
// stopped short of the project's two most-read READMEs. `DOCS_DIR` stays in use for
// relative output paths.
const DOCS_DIR = path.join(CORE.absDir, "docs");
const TYPES_DIR = path.join(CORE.absDir, "dist", "types");
const TMP_DIR = path.join(CORE.absDir, ".tmp-docs-typecheck");

// The scratch directory must not outlive the process, and a `finally` is not enough:
// every guard below reports through `process.exit()`, which skips `finally` entirely.
process.on("exit", () => fs.rmSync(TMP_DIR, { recursive: true, force: true }));

// The cast is what makes every `ts.is*` guard actually NARROW under checkJs: a dynamic
// `require(resolve(...))` types as `any`, an `any` predicate narrows nothing, and the
// JSDoc-typed `Node` parameters below then fail on every member access.
const ts = /** @type {typeof import("typescript")} */ (
    require(require.resolve("typescript", { paths: [ROOT] }))
);

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Walk a directory recursively and return every Markdown file.
 * @param {string} dir
 * @returns {string[]}
 */
function walkMarkdown(dir) {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walkMarkdown(full));
        else if (full.endsWith(".md")) out.push(full);
    }
    return out;
}

/**
 * Extract fenced code blocks from Markdown content.
 * @param {string} content
 * @returns {{ lang: string; code: string; startLine: number }[]}
 */
function extractCodeBlocks(content) {
    const blocks = [];
    const lines = content.split("\n");
    let inBlock = false;
    let lang = "";
    let blockLines = [];
    let startLine = 0;

    for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        const fence = ln.match(/^```(\w*)/);
        if (!inBlock && fence) {
            inBlock = true;
            lang = fence[1].toLowerCase();
            blockLines = [];
            startLine = i + 1; // 1-based, pointing at the opening fence
            continue;
        }
        if (!inBlock) continue;
        if (/^```/.test(ln)) {
            blocks.push({ lang, code: blockLines.join("\n"), startLine });
            inBlock = false;
            lang = "";
            blockLines = [];
        } else {
            blockLines.push(ln);
        }
    }
    return blocks;
}

// The CORPUS comes from `lib/tsdoc-examples.cjs`, like the extractor.
//
// ⚠️ 2026-07-31 — this file kept its own `walkSources()` here, left private when
// `extractTsdocExamples` was pooled. The comment below claimed "one engine" since, but
// **only half of it was**: two walkers coexisted, and they had already diverged on a
// point that mattered — this one excluded the `.d.ts` through an explicit test, which
// made `check:docs-typecheck` blind to `global.d.ts`'s `@example`s.
//
// Pooling the walker closes the class rather than the case: there is now **only one
// place** to decide what enters the `@example` corpus (the lib's `EXCLUDED` constant),
// and `validate-docs-examples` reads exactly the same one.
const walkSources = sourceFiles;

/** Parses a snippet, or returns null when it has syntax errors. */
function parseSnippet(code) {
    const sf = ts.createSourceFile("x.ts", code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    // `parseDiagnostics` is real but not in the public .d.ts — the cast names the internal
    // field instead of widening `sf` to `any`, so every other member stays checked.
    const withDiags =
        /** @type {import("typescript").SourceFile & { parseDiagnostics: readonly unknown[] }} */ (
            sf
        );
    return withDiags.parseDiagnostics.length === 0 ? sf : null;
}

/**
 * TS error codes that mean "this documented example cannot work".
 *
 * Deliberately a small ALLOW-list rather than a deny-list of noise: a new TypeScript
 * version inventing a new diagnostic must not be able to turn this gate red on an
 * idiom, and the cost of missing one code is a defect we already miss today.
 */
const DEFECT_CODES = new Map([
    ["TS2305", "the module has no such export"],
    ["TS2307", "the module path does not resolve"],
    ["TS2339", "no such property on the type"],
    ["TS2345", "argument type does not match the signature"],
    ["TS2551", "no such property on the type"],
    ["TS2554", "wrong number of arguments"],
    ["TS2555", "wrong number of arguments"],
    ["TS2559", "type has nothing in common with the expected one"],
    ["TS2614", "the module has no such named export"],
    ["TS2739", "required properties are missing"],
    ["TS2741", "a required property is missing"],
    // 2026-07-31 — the four `exactOptionalPropertyTypes` codes. This gate's temporary
    // tsconfig extends `packages/core/tsconfig.json`, so it INHERITS the option since
    // it was enabled there. Without these four entries, a documented example that
    // stops compiling on the integrator's side passed into `ignoredIdioms` and the
    // gate came out GREEN: of the 95 errors of that pass, 94 carried a code absent
    // from this list (only TS2345 was in it). It is a blindness, not a red — so it was
    // SEEN, by planting a witness example that triggers TS2379, before being closed.
    ["TS2375", "an optional property cannot receive an explicit `undefined`"],
    ["TS2379", "an argument passes `undefined` where the property must be absent"],
    ["TS2412", "assigning `undefined` to a property declared optional"],
    ["TS2769", "no overload accepts this argument shape"],
    // 2026-07-31 — the `noUncheckedIndexedAccess` codes, enabled at the same place
    // and hence inherited here like the previous one. Same blindness, same remedy: of
    // the 391 errors of that pass, 199 — 52 % — carried TS18048 or TS2532, two codes
    // this list did not know. An example reading `arr[0].foo` compiles on our side and
    // NOT on the integrator's once the option is set: a copy-pastable defect, not a
    // documentation idiom. Seen reddening before being closed.
    ["TS18048", "a value read from an index may be `undefined`"],
    ["TS2532", "the object read from an index may be `undefined`"],
    ["TS2538", "`undefined` cannot be used as an index"],
    ["TS2488", "the value is not iterable — it may be `undefined`"],
]);

/**
 * 2026-08-09 — THE CALL-ON-`unknown` CODES, AND WHY THEY ARE NOT IN
 * {@link DEFECT_CODES}.
 *
 * This comment exists because the addition was tried, measured, and removed on the
 * measurement. Without it, it will be retried.
 *
 * **The defect motivating the addition.** `GeoLeaf.UI.toggleFilterPanel(true)` was
 * taught by the `@example` of `api/geoleaf.ui.ts` while that identifier NEVER existed
 * in the repo. It did not render TS2339 ("no such property", which IS in the list) but
 * TS18046 ("is of type 'unknown'"), which was not: the `[key: string]: unknown` tail
 * of `GeoLeafUIFacade` absorbed the invented member.
 *
 * **The measurement that had the addition removed.** With
 * `TS18046`/`TS2571`/`TS2722`/`TS2349` added, the gate renders **152 new errors**,
 * including:
 *
 * | TS18046 subject                                     | Count  | Nature                    |
 * | --------------------------------------------------- | ------ | ------------------------- |
 * | a REAL `GeoLeaf.*` member absorbed by a tail        | 109    | the tails' pool, not a defect |
 * | a `catch` variable (`error`, `err`)                 | 4      | documentation idiom       |
 * | **the `toggleFilterPanel` ghost**                   | **1**  | **the defect sought**     |
 *
 * ⚠️ **The compiler CANNOT tell `GeoLeaf.Core.init` (real, untyped) from
 * `GeoLeaf.UI.toggleFilterPanel` (ghost) — precisely because the tail absorbs both.**
 * No tuning of this list separates them. Freezing the 152 into the baseline would let
 * the ghost in with the 151 others: re-digging the hole just closed, and signing it.
 *
 * **The only lever that discriminates is REMOVING THE TAIL.** Tail gone, the real
 * member is typed (green) and the ghost becomes TS2339 again (red, already covered).
 * That is exactly the conclusion written on 2026-07-31 without being applicable then:
 * "the real benefit grows with the typing of the tails, and not otherwise".
 *
 * **Reopening condition**: when the facade tails are gone (`GeoLeafThemeSelector`
 * remained as of 2026-08-09), re-measure. If the residual batch is small, add
 * `TS18046` **restricted to `GeoLeaf.*` subjects** — never bare: the 4 `catch`
 * variables above are idioms, and the "Which diagnostics count" § excludes them.
 */
const DEFERRED_UNKNOWN_CODES = Object.freeze(["TS18046", "TS2571", "TS2722", "TS2349"]);

/**
 * The names `@geoleaf/core` really exports, read from the declarations it publishes.
 * Used to rebuild the prelude the documentation omits — and only ever with real
 * symbols, so an example naming an API that does not exist still fails.
 * @returns {Set<string>}
 */
/**
 * @returns {{ names: Set<string>, typeOnly: Set<string> }} `names` is every published export;
 *   `typeOnly` is the subset with no value meaning (interfaces, type aliases) — a symbol whose
 *   flags carry `Type` but not `Value`. Classes and functions carry `Value` (even though a
 *   class also declares a type) and so are NOT in `typeOnly`: `import { MyClass }` is both
 *   the value and type import for them, exactly what a real consumer would write.
 */
function publishedExportNames() {
    const entry = path.join(TYPES_DIR, "bundle-esm-entry.d.ts");
    if (!fs.existsSync(entry)) return { names: new Set(), typeOnly: new Set() };
    const program = ts.createProgram([entry], {
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        target: ts.ScriptTarget.ES2022,
        skipLibCheck: true,
    });
    const sf = program.getSourceFile(entry);
    const checker = program.getTypeChecker();
    const moduleSymbol = sf && checker.getSymbolAtLocation(sf);
    if (!moduleSymbol) return { names: new Set(), typeOnly: new Set() };
    const exportSymbols = checker
        .getExportsOfModule(moduleSymbol)
        .filter((s) => s.getName() !== "default");
    const names = new Set(exportSymbols.map((s) => s.getName()));
    // Every export from a re-export barrel (`export { X } from "./y.js"`, which is what
    // `bundle-esm-entry.d.ts` is built from) is itself an ALIAS symbol — its own flags carry
    // only `SymbolFlags.Alias`, never `Value`/`Type`. Resolve to the aliased declaration first,
    // or every export would be misclassified as type-only (measured: 100% of them).
    const typeOnly = new Set(
        exportSymbols
            .filter((s) => {
                const resolved =
                    (s.getFlags() & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(s) : s;
                return (resolved.getFlags() & ts.SymbolFlags.Value) === 0;
            })
            .map((s) => s.getName())
    );
    return { names, typeOnly };
}

/**
 * Identifiers a snippet references without declaring or importing them.
 * @param {import("typescript").SourceFile} sf
 * @returns {Set<string>}
 */
function freeIdentifiers(sf) {
    const declared = new Set();
    const referenced = new Set();

    /** @param {import("typescript").Node} node */
    function visit(node) {
        // Names the snippet binds itself — never re-import those.
        if (
            (ts.isVariableDeclaration(node) ||
                ts.isFunctionDeclaration(node) ||
                ts.isClassDeclaration(node) ||
                ts.isInterfaceDeclaration(node) ||
                ts.isTypeAliasDeclaration(node) ||
                ts.isEnumDeclaration(node) ||
                ts.isParameter(node) ||
                ts.isImportSpecifier(node) ||
                ts.isImportClause(node) ||
                ts.isNamespaceImport(node)) &&
            node.name &&
            ts.isIdentifier(node.name)
        ) {
            declared.add(node.name.text);
        }
        if (ts.isIdentifier(node)) {
            const p = node.parent;
            const isMemberName = ts.isPropertyAccessExpression(p) && p.name === node;
            const isPropertyKey = ts.isPropertyAssignment(p) && p.name === node;
            if (!isMemberName && !isPropertyKey) referenced.add(node.text);
        }
        ts.forEachChild(node, visit);
    }
    visit(sf);

    for (const d of declared) referenced.delete(d);
    return referenced;
}

/**
 * Fails the run when `tsc` reported a SYNTAX diagnostic. That must be impossible — the
 * corpus is pre-filtered to snippets that parse — and if it ever happens it means the
 * whole semantic pass was suppressed and the gate checked nothing.
 * @param {string} output
 */
function assertNoSyntaxNoise(output) {
    const syntax = output.split("\n").filter((l) => /error TS1\d{3}:/.test(l));
    if (syntax.length === 0) return;
    console.error(sep);
    console.error(`❌  typecheck-docs-examples — ${syntax.length} SYNTAX diagnostic(s) leaked.`);
    console.error(`    tsc suppresses every semantic diagnostic program-wide when this happens,`);
    console.error(`    so this run type-checked NOTHING. The parse pre-filter is broken.`);
    for (const l of syntax.slice(0, 5)) console.error(`      ${l.trim()}`);
    console.error(sep);
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

/**
 * Stable identity for a diagnostic: file + TS code + message, WITHOUT the line number.
 * Line numbers shift whenever a paragraph is edited above the block; keying on them
 * would turn every unrelated doc edit into a false failure.
 * @param {{ file: string; code: string; message: string }} d
 */
function diagnosticKey(d) {
    const message = d.message.replace(/\s+/g, " ").trim().slice(0, 160);
    return `${d.file.split(path.sep).join("/")}::${d.code}::${message}`;
}

/** @returns {Set<string>} */
function loadBaseline() {
    if (!fs.existsSync(BASELINE_PATH)) return new Set();
    const raw = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
    return new Set(raw.diagnostics || []);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const sep = "─".repeat(72);

if (!fs.existsSync(TYPES_DIR)) {
    console.error(sep);
    console.error(
        `❌  typecheck-docs-examples — declarations missing: ${path.relative(ROOT, TYPES_DIR)}`
    );
    console.error(
        `    This gate compiles against the PUBLISHED types, so it runs after the build.`
    );
    console.error(`    Run \`npm run build\` (ci:local does this first) and retry.`);
    console.error(sep);
    process.exit(1);
}

const mdFiles = productDocsFiles();
if (mdFiles.length === 0) {
    console.error(`[typecheck-docs-examples] No .md files found across the product surfaces.`);
    process.exit(1);
}

const { names: EXPORTS, typeOnly: TYPE_ONLY_EXPORTS } = publishedExportNames();
if (EXPORTS.size === 0) {
    console.error(`[typecheck-docs-examples] Could not read the exports of @geoleaf/core.`);
    process.exit(1);
}

const stats = { total: 0, noParse: 0, withPrelude: 0, tsdoc: 0, tsdocAmbient: 0 };
/** @type {{ file: string; startLine: number; name: string; preludeLines: number }[]} */
const scoped = [];

fs.rmSync(TMP_DIR, { recursive: true, force: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

try {
    let n = 0;
    for (const mdFile of mdFiles) {
        const relFile = path.relative(ROOT, mdFile);
        for (const block of extractCodeBlocks(fs.readFileSync(mdFile, "utf8"))) {
            if (block.lang !== "ts" && block.lang !== "typescript") continue;
            stats.total++;

            // `export {}` forces module scope: without it every block shares one global
            // scope and collides on trivially-repeated identifiers.
            const body = `${block.code}\nexport {};\n`;
            const sf = parseSnippet(body);
            if (!sf) {
                stats.noParse++;
                continue;
            }

            // Rebuild the import the prose stated in words. Only real exports, and only
            // names the block does not bind itself.
            const missing = [...freeIdentifiers(sf)].filter((id) => EXPORTS.has(id)).sort();
            let prelude = "";
            if (missing.length > 0) {
                // qualite Q3.4 (26/07/2026) — the core's own tsconfig now enforces
                // `verbatimModuleSyntax` (inherited from the shared base), so a synthesized
                // import of an interface/type-alias-only export (no value meaning) must use
                // the inline `type` modifier, exactly what a real consumer would now have to
                // write against the published types.
                const specifiers = missing.map((id) =>
                    TYPE_ONLY_EXPORTS.has(id) ? `type ${id}` : id
                );
                prelude = `import { ${specifiers.join(", ")} } from "@geoleaf/core";\n`;
                stats.withPrelude++;
            }

            n++;
            const name = `b${String(n).padStart(3, "0")}.ts`;
            fs.writeFileSync(path.join(TMP_DIR, name), prelude + body);
            scoped.push({
                file: relFile,
                startLine: block.startLine,
                name,
                preludeLines: prelude ? 1 : 0,
            });
        }
    }

    // ── Second corpus: the TSDoc `@example`s ─────────────────────────────────
    //
    // The engine existed, it simply was not wired to them. Same prelude, same
    // diagnostics filter, same baseline — one engine, two corpora.
    //
    // ⚠️ **Examples going through the ambient `GeoLeaf.*` namespace are SET ASIDE, and
    // that is a measurement, not a convenience.** Against the published types,
    // `GeoLeaf` does not exist: `src/global.d.ts` is **never emitted** into
    // `dist/types/` (TypeScript does not re-emit an entry `.d.ts`, so
    // `emitDeclarationOnly` skips it), and no `declare global` ships in the tarball.
    // Verified by compilation: a consumer writing `GeoLeaf.Core.setTheme("dark")` gets
    // **TS2304 Cannot find name**. Compiling them here would fail them all on a code
    // already ignored as an idiom (`Cannot find name`), i.e. scanning while seeing
    // nothing — failure mode (1) this script's header refuses to have. They are thus
    // COUNTED and shown, not drowned. The prerequisite is publishing the ambient
    // namespace, not bending this gate.
    for (const srcFile of walkSources()) {
        const relSrc = path.relative(ROOT, srcFile);
        for (const ex of extractTsdocExamples(fs.readFileSync(srcFile, "utf8"))) {
            stats.total++;
            stats.tsdoc++;
            const body = `${ex.code}\nexport {};\n`;
            const sf = parseSnippet(body);
            if (!sf) {
                stats.noParse++;
                continue;
            }
            const free = freeIdentifiers(sf);
            const missing = [...free].filter((id) => EXPORTS.has(id)).sort();
            // 2026-07-27 — `GeoLeaf.*` examples are NO LONGER set aside: the package
            // now publishes its ambient namespace (`dist/types/global.d.ts`,
            // referenced from the entry), so they are genuinely compilable. The
            // prelude imports the package to pull the reference into the program.
            if (free.has("GeoLeaf")) stats.tsdocAmbient++;
            let prelude = free.has("GeoLeaf") ? 'import "@geoleaf/core";\n' : "";
            if (missing.length > 0) {
                const specifiers = missing.map((id) =>
                    TYPE_ONLY_EXPORTS.has(id) ? `type ${id}` : id
                );
                prelude += `import { ${specifiers.join(", ")} } from "@geoleaf/core";\n`;
                stats.withPrelude++;
            }
            n++;
            const name = `b${String(n).padStart(3, "0")}.ts`;
            fs.writeFileSync(path.join(TMP_DIR, name), prelude + body);
            scoped.push({
                file: relSrc,
                startLine: ex.startLine,
                name,
                preludeLines: prelude ? 1 : 0,
            });
        }
    }

    // A gate that scans nothing must shout, not pass.
    if (scoped.length === 0) {
        console.error(sep);
        console.error(
            `❌  typecheck-docs-examples — 0 example in scope out of ${stats.total} ts block(s).`
        );
        console.error(
            `    Nothing was type-checked. Either the corpus moved or the scope filter broke.`
        );
        console.error(sep);
        process.exit(1);
    }

    fs.writeFileSync(
        path.join(TMP_DIR, "tsconfig.json"),
        JSON.stringify(
            {
                extends: "../tsconfig.json",
                compilerOptions: {
                    noEmit: true,
                    declaration: false,
                    declarationDir: null,
                    // Required: without it tsc cannot disambiguate the project root when
                    // resolving the `exports` map of the package it lives inside.
                    rootDir: ".",
                    types: ["geojson", "node"],
                },
                include: ["*.ts"],
                exclude: [],
            },
            null,
            2
        )
    );

    let tscOutput = "";
    try {
        execFileSync("npx", ["tsc", "-p", path.join(TMP_DIR, "tsconfig.json"), "--noEmit"], {
            encoding: "utf8",
            cwd: ROOT,
        });
    } catch (err) {
        tscOutput = `${err.stdout || ""}${err.stderr || ""}`;
    }

    assertNoSyntaxNoise(tscOutput);

    /** @type {{ file: string; startLine: number; code: string; message: string }[]} */
    const diagnostics = [];
    let ignoredIdioms = 0;
    /**
     * How many times each ignored code was seen. 2026-08-09 — the bare total was not
     * enough: it quantified the blind spot without NAMING it, and a ghost `TS18046`
     * could hide there for months. A histogram makes the rising code visible.
     * @type {Map<string, number>}
     */
    const ignoredByCode = new Map();
    const ignore = (/** @type {string} */ code) => {
        ignoredIdioms++;
        ignoredByCode.set(code, (ignoredByCode.get(code) || 0) + 1);
    };
    for (const line of tscOutput.split("\n")) {
        const m = line.match(/(b\d{3}\.ts)\((\d+),(\d+)\): error (TS\d+): (.*)$/);
        if (!m) continue;
        const block = scoped.find((b) => b.name === m[1]);
        if (!block) continue;
        const [, , , , code, message] = m;
        if (!DEFECT_CODES.has(code)) {
            ignore(code);
            continue;
        }
        // A relative import that does not resolve is a contributor-guide example showing
        // code inside the source tree, not a broken public path. Only the specifiers this
        // monorepo PUBLISHES are a promise it has to keep.
        //
        // ⚠️ 2026-07-31 — the pattern carried `@geoleaf/` alone, and the `/` right
        // after `geoleaf` excluded **`@geoleaf-plugins/*`, i.e. 13 of the 15
        // published packages**. Without consequence while the corpus stopped at
        // `packages/core/docs/`; widening it to the plugin READMEs, the first
        // measurement found `@geoleaf-plugins/websocket/test-utils` — a subpath
        // shipped in `files[]` but **absent from the `exports` map**, hence
        // `ERR_PACKAGE_PATH_NOT_EXPORTED` on the integrator's side (verified by
        // `require.resolve`, not deduced). `check:subpath-resolve` could not see it:
        // it verifies that DECLARED `exports` resolve, never that a documented
        // subpath is declared — the inverse asymmetry, same known shape.
        if (code === "TS2307" && !/Cannot find module '@geoleaf(-plugins)?\//.test(message)) {
            ignore(code);
            continue;
        }
        diagnostics.push({
            file: block.file,
            startLine: block.startLine,
            code,
            message,
        });
    }

    if (UPDATE_BASELINE) {
        const keys = [...new Set(diagnostics.map(diagnosticKey))].sort();
        fs.writeFileSync(
            BASELINE_PATH,
            `${JSON.stringify(
                {
                    _comment:
                        "Erreurs de type CONNUES dans les exemples ts/typescript de la doc PRODUIT (lib/tsdoc-examples.cjs::productDocsFiles), figées par scripts/typecheck-docs-examples.cjs. Le gate ne bloque que sur une erreur ABSENTE d'ici. Clé = fichier::codeTS::message (sans numéro de ligne, qui bouge à chaque édition du texte autour du bloc). Régénérer via `--update-baseline` après avoir corrigé un lot. ⚠️ La quasi-totalité des entrées est TS18048 « 'GeoLeaf…' is possibly 'undefined' » : ce n'est PAS un défaut par exemple, c'est une propriété de l'ambiant publié, qui déclare `var GeoLeaf: GeoLeafGlobal | undefined` (global.d.ts:915). Tout exemple qui écrit `GeoLeaf.X` la déclenche. La corriger exemple par exemple enseignerait un idiome (`GeoLeaf!.X`) que le reste de la doc n'emploie pas ; elle se corrige à la source, dans la déclaration, ou pas du tout — suivi au backlog.",
                    generatedCount: keys.length,
                    diagnostics: keys,
                },
                null,
                4
            )}\n`
        );
        console.log(
            `✓ typecheck-docs-examples: baseline régénérée (${keys.length} diagnostic(s) figé(s)).`
        );
        process.exit(0);
    }

    const baseline = loadBaseline();
    const fresh = diagnostics.filter((d) => !baseline.has(diagnosticKey(d)));
    const known = diagnostics.filter((d) => baseline.has(diagnosticKey(d)));

    // 2026-07-30 — ANTI-STALE RATCHET, on the TSD-04 model.
    // Until now this baseline could only stay silent: an entry whose diagnostic had
    // vanished stayed there indefinitely, and nothing said so. Measured the day the
    // ratchet was laid: of 9 entries, **2 were already dead** — two `POI` imports
    // fixed in an earlier pass, whose line had been sleeping there since. A baseline
    // that does not redden on its stale entries is no longer a debt register, it is a
    // graveyard: it grows with work already done and masks what genuinely remains.
    const seen = new Set(diagnostics.map((d) => diagnosticKey(d)));
    const stale = [...baseline].filter((k) => !seen.has(k));

    // ⚠️ 2026-08-09 — BREAKDOWN, and not only a total. The bare counter said
    // "594 non-defect diagnostic(s) ignored": true, and unusable. It could not say a
    // `TS18046` was hiding there — the one of a ghost API taught by an `@example`,
    // invisible for months. A total does not read; a code climbing a ranking does.
    // Deferred codes (cf. {@link DEFERRED_UNKNOWN_CODES}) are marked with a ⌛: they
    // are ignored BY DATED DECISION, not by oversight, and the distinction must show
    // at every run.
    const histogram = [...ignoredByCode.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([code, n]) => `${DEFERRED_UNKNOWN_CODES.includes(code) ? "⌛" : ""}${code}×${n}`)
        .join(", ");

    const scannedLine =
        `    Scanned ${mdFiles.length} .md + les sources, ${stats.total} bloc(s) ` +
        `(${stats.total - stats.tsdoc} .md + ${stats.tsdoc} @example TSDoc) → ` +
        `${scoped.length} type-checked (${stats.withPrelude} with a rebuilt import), ` +
        `${stats.noParse} skipped as unparseable fragments; ` +
        `${ignoredIdioms} non-defect diagnostic(s) ignored` +
        // ⚠️ This counter is NOT decorative: it quantifies what the gate does NOT
        // see, and why. A gate that silences its blind spot reads "everything is
        // verified".
        (histogram ? `\n    ↳ ignorés par code : ${histogram}` : "") +
        (stats.tsdocAmbient
            ? `\n    ℹ  ${stats.tsdocAmbient} @example passent par le namespace ambiant \`GeoLeaf.*\` — compilés ` +
              `depuis que le paquet le publie.`
            : "");

    if (fresh.length === 0 && stale.length === 0) {
        console.log(sep);
        console.log(`✅  typecheck-docs-examples — 0 new type error`);
        console.log(scannedLine);
        if (known.length > 0) {
            console.log(`    ℹ  ${known.length} known diagnostic(s) frozen in the baseline`);
        }
        console.log(sep);
        if (VERBOSE) {
            for (const b of scoped) console.log(`    · ${b.file}:${b.startLine}`);
        }
        process.exit(0);
    }

    console.log(sep);

    if (stale.length > 0) {
        console.log(
            `❌  [DOCS-TYPECHECK/STALE] ${stale.length} entrée(s) de baseline sans diagnostic —\n` +
                `    le défaut a été corrigé, la baseline doit suivre. Retirer ces lignes\n` +
                `    (ou \`--update-baseline\`) :\n`
        );
        for (const k of stale.slice(0, 20)) console.log(`  ${k}`);
        if (stale.length > 20) console.log(`  … et ${stale.length - 20} de plus`);
        console.log("");
    }

    if (fresh.length === 0) {
        console.log(scannedLine);
        console.log(sep);
        process.exit(1);
    }

    console.log(`❌  typecheck-docs-examples — ${fresh.length} NEW type error(s)\n`);
    console.log(scannedLine);
    console.log("");
    for (const d of fresh) {
        console.log(`  ❌  ${d.file}:${d.startLine} — ${d.code}`);
        console.log(`      ${d.message}`);
    }
    console.log("");
    console.log(`    A documented example that does not compile cannot be copy-pasted.`);
    console.log(`    Fix the example, or freeze it with --update-baseline if intentional.`);
    console.log(sep);
    process.exit(1);
} finally {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
}
