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
 * ## Scope — DEUX corpus depuis le 27/07/2026 (B-44)
 *
 * 1. Les blocs ts/typescript des `.md` de `packages/core/docs/`.
 * 2. **Les `@example` du TSDoc de toutes les sources** (tous les `src/` du registre de paquets). Le moteur
 *    existait, il n'était simplement pas branché dessus — c'était l'énoncé de B-44.
 *
 * ⚠️ **Ce que le corpus 2 NE couvre PAS, et pourquoi ce n'est pas un choix de confort.**
 * Mesuré le 27/07/2026 : **101 `@example` entrent, 49 sont compilés, 52 sont écartés** —
 * ces derniers passent par le namespace ambiant `GeoLeaf.*`, que **le paquet publié ne
 * déclare pas**. `src/global.d.ts` n'est jamais émis dans `dist/types/` (TypeScript ne
 * ré-émet pas un `.d.ts` d'entrée : `emitDeclarationOnly` le saute), et aucun
 * `declare global` ne part dans le tarball. Prouvé par compilation contre les types
 * publiés : `GeoLeaf.Core.setTheme("dark")` rend **TS2304 Cannot find name 'GeoLeaf'**.
 * Les inclure ferait scanner sans rien voir — le mode d'échec (1) ci-dessous. Le compteur
 * les affiche à chaque run plutôt que de les taire.
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
// 31/07/2026 — le périmètre `.md` passe de `packages/core/docs/` aux surfaces PRODUIT, et il
// est dérivé dans `lib/tsdoc-examples.cjs` pour que `validate-docs-examples` lise exactement le
// même. Le motif est écrit sur `productDocsFiles` ; le résumé tient en une ligne : la règle qui
// interdit une API fantôme existait, c'est son corpus qui s'arrêtait avant les deux README les
// plus lus du projet. `DOCS_DIR` reste utilisé pour les chemins de sortie relatifs.
const DOCS_DIR = path.join(CORE.absDir, "docs");
const TYPES_DIR = path.join(CORE.absDir, "dist", "types");
const TMP_DIR = path.join(CORE.absDir, ".tmp-docs-typecheck");

// The scratch directory must not outlive the process, and a `finally` is not enough:
// every guard below reports through `process.exit()`, which skips `finally` entirely.
process.on("exit", () => fs.rmSync(TMP_DIR, { recursive: true, force: true }));

const ts = require(require.resolve("typescript", { paths: [ROOT] }));

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

// Le CORPUS vient de `lib/tsdoc-examples.cjs`, comme l'extracteur.
//
// ⚠️ B-80 (31/07/2026) — ce fichier gardait ici son propre `walkSources()`, resté privé quand
// `extractTsdocExamples` a été mutualisé (B-75). Le commentaire ci-dessous revendiquait « un
// seul moteur » depuis, mais **seule la moitié l'était** : deux marcheurs coexistaient, et ils
// avaient déjà divergé sur un point qui comptait — celui-ci excluait les `.d.ts` par un test
// explicite, ce qui rendait `check:docs-typecheck` aveugle aux `@example` de `global.d.ts`.
//
// Mutualiser le marcheur ferme la classe plutôt que le cas : il n'y a désormais **qu'un seul
// endroit** où décider ce qui entre dans le corpus des `@example` (la constante `EXCLUDED` de
// la lib), et `validate-docs-examples` lit exactement le même.
const walkSources = sourceFiles;

/** Parses a snippet, or returns null when it has syntax errors. */
function parseSnippet(code) {
    const sf = ts.createSourceFile("x.ts", code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    return sf.parseDiagnostics.length === 0 ? sf : null;
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
    // qualite Q4.4 (31/07/2026) — les quatre codes d'`exactOptionalPropertyTypes`. Le
    // tsconfig temporaire de cette gate étend `packages/core/tsconfig.json`, donc il HÉRITE
    // de l'option depuis le Q4. Sans ces quatre entrées, un exemple documenté qui cesse de
    // compiler chez l'intégrateur passait en `ignoredIdioms` et la gate sortait VERTE :
    // sur les 95 erreurs du sprint, 94 portaient un code absent de cette liste (seule
    // TS2345 y figurait). C'est une cécité, pas un rouge — donc elle a été VUE, en plantant
    // un exemple témoin qui déclenche TS2379, avant d'être refermée.
    ["TS2375", "an optional property cannot receive an explicit `undefined`"],
    ["TS2379", "an argument passes `undefined` where the property must be absent"],
    ["TS2412", "assigning `undefined` to a property declared optional"],
    ["TS2769", "no overload accepts this argument shape"],
    // qualite Q5.4 (31/07/2026) — les codes de `noUncheckedIndexedAccess`, posée au même
    // endroit et donc héritée ici comme la précédente. Même cécité, même remède : sur les
    // 391 erreurs du sprint Q5, 199 — 52 % — portaient TS18048 ou TS2532, deux codes que
    // cette liste ne connaissait pas. Un exemple qui lit `arr[0].foo` compile chez nous et
    // PAS chez l'intégrateur dès que l'option est posée : c'est un défaut copiable-collable,
    // pas un idiome de documentation. Vue rougir avant d'être refermée.
    ["TS18048", "a value read from an index may be `undefined`"],
    ["TS2532", "the object read from an index may be `undefined`"],
    ["TS2538", "`undefined` cannot be used as an index"],
    ["TS2488", "the value is not iterable — it may be `undefined`"],
]);

/**
 * B-202 (09/08/2026) — LES CODES DE L'APPEL SUR `unknown`, ET POURQUOI ILS NE SONT PAS
 * DANS {@link DEFECT_CODES}.
 *
 * Ce commentaire existe parce que l'ajout a été tenté, mesuré, et retiré sur la mesure.
 * Sans lui, il sera retenté.
 *
 * **Le défaut qui motivait l'ajout.** `GeoLeaf.UI.toggleFilterPanel(true)` était enseigné
 * par l'`@example` de `api/geoleaf.ui.ts` alors que cet identifiant n'a JAMAIS existé dans
 * le dépôt. Il ne rendait pas TS2339 (« no such property », qui EST dans la liste) mais
 * TS18046 (« is of type 'unknown' »), qui n'y était pas : la traîne `[key: string]:
 * unknown` de `GeoLeafUIFacade` absorbait le membre inventé.
 *
 * **La mesure qui a fait retirer l'ajout.** Avec `TS18046`/`TS2571`/`TS2722`/`TS2349`
 * ajoutés, la gate rend **152 nouvelles erreurs**, dont :
 *
 * | Sujet du TS18046                                    | Nombre | Nature                    |
 * | --------------------------------------------------- | ------ | ------------------------- |
 * | un membre `GeoLeaf.*` RÉEL absorbé par une traîne   | 109    | gisement B-13, pas un défaut |
 * | une variable de `catch` (`error`, `err`)            | 4      | idiome de documentation   |
 * | **le fantôme `toggleFilterPanel`**                  | **1**  | **le défaut cherché**     |
 *
 * ⚠️ **Le compilateur ne peut PAS distinguer `GeoLeaf.Core.init` (réel, non typé) de
 * `GeoLeaf.UI.toggleFilterPanel` (fantôme) — précisément parce que la traîne absorbe les
 * deux.** Aucun réglage de cette liste ne les sépare. Geler les 152 en baseline y ferait
 * entrer le fantôme avec les 151 autres : ce serait re-creuser le trou qu'on vient de
 * fermer, en le signant.
 *
 * **Le seul levier qui discrimine est le RETRAIT DE LA TRAÎNE.** Traîne ôtée, le membre
 * réel est typé (vert) et le fantôme redevient TS2339 (rouge, déjà couvert). C'est
 * exactement la conclusion que B-80 avait écrite le 31/07/2026 sans pouvoir l'appliquer :
 * « le bénéfice réel de B-80 croît avec B-13, et pas autrement ».
 *
 * **Condition de réouverture** : quand les traînes de façade auront disparu (B-13 — il
 * restait `GeoLeafThemeSelector` au 09/08/2026), re-mesurer. Si le lot résiduel est petit,
 * ajouter `TS18046` **restreint aux sujets `GeoLeaf.*`** — jamais nu : les 4 variables de
 * `catch` ci-dessus sont des idiomes, et le § « Which diagnostics count » les exclut.
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

    // ── Second corpus (B-44) : les `@example` du TSDoc ───────────────────────────────
    //
    // Le moteur existait, il n'était simplement pas branché dessus. Même prélude, même
    // filtre de diagnostics, même baseline — un seul moteur, deux corpus.
    //
    // ⚠️ **Les exemples qui passent par le namespace ambiant `GeoLeaf.*` sont ÉCARTÉS, et
    // c'est une mesure, pas une commodité.** Contre les types publiés, `GeoLeaf` n'existe
    // pas : `src/global.d.ts` n'est **jamais émis** dans `dist/types/` (TypeScript ne
    // ré-émet pas un `.d.ts` d'entrée, donc `emitDeclarationOnly` le saute), et aucun
    // `declare global` ne part dans le tarball. Vérifié par compilation : un consommateur
    // qui écrit `GeoLeaf.Core.setTheme("dark")` obtient **TS2304 Cannot find name**.
    // Les compiler ici les ferait tous échouer sur un code déjà ignoré comme idiome
    // (`Cannot find name`), c'est-à-dire scanner sans rien voir — le mode d'échec (1) que
    // l'en-tête de ce script refuse d'avoir. Ils sont donc COMPTÉS et affichés, pas noyés.
    // Suivi au backlog ; le préalable est de publier l'ambiant, pas de tordre cette gate.
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
            // B-46 (27/07/2026) — les exemples `GeoLeaf.*` ne sont PLUS écartés : le paquet
            // publie désormais son namespace ambiant (`dist/types/global.d.ts`, référencé
            // depuis l'entrée), donc ils sont réellement compilables. Le prélude importe le
            // paquet pour tirer la référence dans le programme.
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
     * How many times each ignored code was seen. B-202 (09/08/2026) — le total nu ne
     * suffisait pas : il chiffrait l'angle mort sans le NOMMER, et un `TS18046` fantôme a
     * pu s'y cacher des mois. Un histogramme rend visible le code qui monte.
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
        // ⚠️ 31/07/2026 — le motif portait `@geoleaf/` seul, et le `/` juste après `geoleaf`
        // excluait **`@geoleaf-plugins/*`, c'est-à-dire les 13 paquets publiés sur 15**. Sans
        // conséquence tant que le corpus s'arrêtait à `packages/core/docs/` ; en l'élargissant
        // aux README de plugins, la première mesure a trouvé
        // `@geoleaf-plugins/websocket/test-utils` — un sous-chemin livré dans `files[]` mais
        // **absent de la carte `exports`**, donc `ERR_PACKAGE_PATH_NOT_EXPORTED` chez
        // l'intégrateur (vérifié par `require.resolve`, pas déduit). `check:subpath-resolve`
        // ne pouvait pas le voir : il vérifie que les `exports` DÉCLARÉS résolvent, jamais
        // qu'un sous-chemin documenté est déclaré — l'asymétrie inverse, même forme que B-83.
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

    // B-78 (30/07/2026) — CLIQUET ANTI-PÉRIMÉ, sur le modèle de TSD-04.
    // Jusqu'ici cette baseline ne pouvait que se taire : une entrée dont le diagnostic avait
    // disparu y restait indéfiniment, et rien ne le disait. Mesuré le jour où le cliquet a
    // été posé : sur 9 entrées, **2 étaient déjà mortes** — deux imports `POI` corrigés lors
    // d'une passe antérieure, dont la ligne dormait là depuis. Une baseline qui ne rougit pas
    // sur ses entrées périmées n'est plus un registre de dette, c'est un cimetière : elle
    // grossit du travail déjà fait et masque ce qu'il reste vraiment.
    const seen = new Set(diagnostics.map((d) => diagnosticKey(d)));
    const stale = [...baseline].filter((k) => !seen.has(k));

    // ⚠️ B-202 (09/08/2026) — VENTILATION, et pas seulement un total. Le compteur nu disait
    // « 594 non-defect diagnostic(s) ignored » : vrai, et inexploitable. Il ne pouvait pas
    // dire qu'un `TS18046` s'y cachait — celui d'une API fantôme enseignée par un `@example`,
    // restée invisible des mois. Un total ne se lit pas ; un code qui monte dans un
    // classement, si. Les codes différés (cf. {@link DEFERRED_UNKNOWN_CODES}) sont marqués
    // d'un ⌛ : ils sont ignorés PAR DÉCISION DATÉE, pas par oubli, et la distinction doit
    // se voir à chaque run.
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
        // ⚠️ Ce compteur n'est PAS décoratif : il chiffre ce que la gate NE voit pas, et
        // pourquoi. Une gate qui tait son angle mort se lit « tout est vérifié ».
        (histogram ? `\n    ↳ ignorés par code : ${histogram}` : "") +
        (stats.tsdocAmbient
            ? `\n    ℹ  ${stats.tsdocAmbient} @example passent par le namespace ambiant \`GeoLeaf.*\` — compilés ` +
              `depuis que le paquet le publie (B-46).`
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
