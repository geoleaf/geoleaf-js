/**
 * check-facade-purity.cjs — `api/geoleaf.*.ts` carries no logic.
 *
 * ## Why this exists
 *
 * The 29 `geoleaf.*.ts` files are the public surface: they expose `GeoLeaf.*` and they
 * delegate. The rule is written down (ARCHITECTURE.md §"Façades publiques", CDC §513)
 * and it has been broken twice — `geoleaf.config.ts` had drifted into self-registration
 * on top of being dead (removed in S2), and `geoleaf.storage.ts` had accumulated ~430
 * lines of Storage orchestration (extracted in S3). Both were found by a human reading
 * the directory, which is not a repeatable process.
 *
 * A conforming facade follows ONE of three documented patterns:
 *   A  pure re-export        `export { X } from "…"`
 *   B  buildPublicApi()      `export const X = someImportedFactory()`
 *   C  self-mount at import  `const _gl = ensureGeoLeaf(); _gl.X = X`
 *
 * ## The rule, and why it is phrased this way
 *
 * "No logic" is checked as: no control flow, no DOM/global access, and no call whose
 * target is not an imported symbol.
 *
 * That phrasing — rather than the tempting "no object literal with methods" — is what
 * separates `geoleaf.sync.ts` (conforming, pattern C) from the old `geoleaf.events.ts`
 * (not conforming). The two were structurally identical: an exported object literal
 * with three methods. They differ on three independent signals, any one of which is
 * enough: `Sync.registerHandler` is one statement forwarding to an imported contract;
 * `Events.on` had two statements, an `if`, and a `document` reference.
 *
 * ## Scope: this gate stops AT the facade — it does not follow imports
 *
 * `geoleaf.utils.ts` looks like a pure re-export but its global mount hides one level
 * down (`utils/general/utils-api.ts`), and `geoleaf.storage.ts` re-exports a module
 * that runs `StorageContract.init()` at top level. Both are conforming HERE. The
 * contract is "the facade is thin", not "everything it imports is pure" — following
 * imports would flag the S3 storage conformation itself, i.e. the gate would contradict
 * the architecture it defends.
 *
 * GREEN on wiring (S13.1 conformed `events` and `introspection`), so it ships with NO
 * baseline and NO allowlist: the grammar encodes the documented PATTERNS, not a list of
 * blessed files. An allowlist would have been shorter and would have said "sync is an
 * exception" — which the architecture document explicitly denies.
 *
 * Usage:  node scripts/check-facade-purity.cjs
 * Exit codes: 0 pure · 1 logic found in a facade · 2 tooling error.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
// T5.5 — par le registre. Un littéral périmé ne ferait pas rougir FP-01 : il lui ferait
// scanner zéro façade et annoncer que toutes sont pures.
const MODULES_DIR = path.join(
    require("./lib/packages.cjs").requireByDirName("core").absDir,
    "src",
    "api"
);
const FACADE_RE = /^geoleaf\..*\.ts$/;

/** Identifiers whose mere presence in a facade means it is doing work itself. */
const FORBIDDEN_GLOBALS = new Set([
    "document",
    "window",
    "globalThis",
    "navigator",
    "localStorage",
    "sessionStorage",
    "fetch",
]);

const C = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    dim: "\x1b[2m",
};

/** Relative path normalised to `/` — `path.relative` yields `\` on Windows. */
function normPath(p) {
    return p.split(path.sep).join("/");
}

/** Every identifier bound by an `import` — the only legal call targets in a facade. */
function collectImported(sf) {
    const names = new Set();
    for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st)) continue;
        const clause = st.importClause;
        if (!clause) continue; // bare `import "./x"` binds nothing
        if (clause.name) names.add(clause.name.text);
        const nb = clause.namedBindings;
        if (nb && ts.isNamedImports(nb)) {
            for (const el of nb.elements) names.add(el.name.text);
        } else if (nb && ts.isNamespaceImport(nb)) {
            names.add(nb.name.text);
        }
    }
    return names;
}

/** Root identifier of `a.b.c(...)` / `(x as T).y` — what a call really targets. */
function rootId(expr) {
    let e = expr;
    while (
        ts.isPropertyAccessExpression(e) ||
        ts.isElementAccessExpression(e) ||
        ts.isNonNullExpression(e) ||
        ts.isParenthesizedExpression(e) ||
        ts.isAsExpression(e)
    ) {
        e = e.expression;
    }
    return ts.isIdentifier(e) ? e.text : null;
}

/** @returns {string|null} why this subtree is logic, else null. */
function hasLogic(node) {
    let reason = null;
    (function walk(n) {
        if (reason) return;
        if (
            ts.isIfStatement(n) ||
            ts.isForStatement(n) ||
            ts.isForOfStatement(n) ||
            ts.isForInStatement(n) ||
            ts.isWhileStatement(n) ||
            ts.isDoStatement(n) ||
            ts.isSwitchStatement(n) ||
            ts.isTryStatement(n) ||
            ts.isConditionalExpression(n)
        ) {
            reason = "control flow";
            return;
        }
        if (
            ts.isBinaryExpression(n) &&
            (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
                n.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
                n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
        ) {
            reason = "logical/nullish operator";
            return;
        }
        if (ts.isIdentifier(n) && FORBIDDEN_GLOBALS.has(n.text)) {
            reason = `global/DOM access (${n.text})`;
            return;
        }
        ts.forEachChild(n, walk);
    })(node);
    return reason;
}

/**
 * Pattern C: one method = one delegating call to an imported symbol.
 * @returns {string|null} why this property is not a thin delegate, else null.
 */
function thinDelegate(prop, imported) {
    // `updateUndoRedoState,` and `setActiveTool: setEditorActiveTool` — the imported
    // function passed BY REFERENCE. Strictly thinner than the wrapper form it replaces
    // (`x: (a) => f(a)`), so rejecting it would push facades toward more code, not less.
    // Still bounded: the referenced identifier must be import-bound, exactly as for a
    // delegating call.
    if (ts.isShorthandPropertyAssignment(prop)) {
        return imported.has(prop.name.text)
            ? null
            : `\`${prop.name.text}\` is not an imported symbol`;
    }
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.initializer)) {
        return imported.has(prop.initializer.text)
            ? null
            : `\`${prop.initializer.text}\` is not an imported symbol`;
    }
    // A literal constant on the surface — `version: "__GEOLEAF_VERSION__"` (substituted at
    // build time). Data the facade DECLARES, not behaviour it implements.
    if (
        ts.isPropertyAssignment(prop) &&
        (ts.isStringLiteral(prop.initializer) ||
            ts.isNoSubstitutionTemplateLiteral(prop.initializer) ||
            ts.isNumericLiteral(prop.initializer) ||
            prop.initializer.kind === ts.SyntaxKind.TrueKeyword ||
            prop.initializer.kind === ts.SyntaxKind.FalseKeyword ||
            prop.initializer.kind === ts.SyntaxKind.NullKeyword)
    ) {
        return null;
    }
    const isFnProp =
        ts.isPropertyAssignment(prop) &&
        (ts.isArrowFunction(prop.initializer) || ts.isFunctionExpression(prop.initializer));
    // A `readonly` member of the API surface is exposed as a getter (`get state()`), and
    // one that forwards a single call is exactly as thin as a method that does — the
    // contract is "no logic here", not "no accessors". Its body is checked identically.
    const isGetter = ts.isGetAccessorDeclaration(prop) && prop.parameters.length === 0;
    if (!ts.isMethodDeclaration(prop) && !isFnProp && !isGetter) return "not a method";
    const fn = isFnProp ? prop.initializer : prop;
    if (!fn.body) return "no body";
    // `get: () => X.y` — a concise arrow body is a single expression by construction.
    const expr = ts.isBlock(fn.body)
        ? (() => {
              if (fn.body.statements.length !== 1) return null;
              const st = fn.body.statements[0];
              if (ts.isReturnStatement(st)) return st.expression;
              if (ts.isExpressionStatement(st)) return st.expression;
              return null;
          })()
        : fn.body;
    if (expr === null || expr === undefined) {
        const n = ts.isBlock(fn.body) ? fn.body.statements.length : 1;
        return `body has ${n} statements (a thin delegate has 1 forwarding call)`;
    }
    const logic = hasLogic(expr);
    if (logic) return logic;
    if (!ts.isCallExpression(expr)) return "not a single delegating call";
    const r = rootId(expr.expression);
    if (!r || !imported.has(r)) return `call target \`${r ?? "?"}\` is not an imported symbol`;
    return null;
}

/**
 * @returns {string|null} reason the statement carries logic, else null.
 * @param ctx `{ imported: Set<string>, locals: Set<string> }` — `locals` accumulates
 *   consts initialised from an imported factory, so pattern C's `_gl.X = X` can check
 *   that its assignment target is one of them rather than an arbitrary object.
 */
function violationOf(stmt, ctx) {
    // Directive prologue / stray `;` — no runtime value.
    if (ts.isExpressionStatement(stmt) && ts.isStringLiteral(stmt.expression)) return null;
    if (ts.isEmptyStatement(stmt)) return null;

    // Imports (type-only, named value, or bare side-effect — pattern C/api) and every
    // `export … from` form (pattern A, including renaming and `export type`).
    if (ts.isImportDeclaration(stmt)) return null;
    if (ts.isExportDeclaration(stmt)) return null;

    // Erased at emit — types are not logic.
    if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) return null;

    if (ts.isFunctionDeclaration(stmt)) {
        return "local function declaration (logic belongs in the implementation module)";
    }
    if (ts.isClassDeclaration(stmt)) return "class declaration";
    if (ts.isEnumDeclaration(stmt)) return "enum declaration";
    if (ts.isModuleDeclaration(stmt)) return "namespace with a runtime body";

    if (ts.isVariableStatement(stmt)) {
        const exported = (ts.getModifiers(stmt) || []).some(
            (m) => m.kind === ts.SyntaxKind.ExportKeyword
        );
        if (!(stmt.declarationList.flags & ts.NodeFlags.Const)) {
            return "non-const declaration (a facade holds no mutable state)";
        }
        for (const d of stmt.declarationList.declarations) {
            const init = d.initializer;
            if (!init) return "const without initializer";
            // Pattern B `export const X = buildPublicApi()`, and pattern C's seam
            // `const _gl = ensureGeoLeaf()`. Matched by SHAPE — never by factory name,
            // so `buildLayersPublicApi()` (geoleaf.layers.ts) passes like any other.
            if (ts.isCallExpression(init)) {
                const r = rootId(init.expression);
                if (!r || !ctx.imported.has(r)) {
                    return `call target \`${r ?? "?"}\` is not an imported symbol`;
                }
                const logic = hasLogic(init);
                if (logic) return logic;
                if (ts.isIdentifier(d.name)) ctx.locals.add(d.name.text);
                continue;
            }
            // Pattern C `export const Sync = { … }` — thin delegates only.
            if (exported && ts.isObjectLiteralExpression(init)) {
                for (const p of init.properties) {
                    const why = thinDelegate(p, ctx.imported);
                    if (why) {
                        const name = p.name ? p.name.getText() : "?";
                        return `inline logic in \`${name}\`: ${why}`;
                    }
                }
                continue;
            }
            return "initializer is neither a factory call nor a thin-delegate object";
        }
        return null;
    }

    // Pattern C self-mount: `_gl.Sync = Sync as unknown as typeof _gl.Sync;`
    if (
        ts.isExpressionStatement(stmt) &&
        ts.isBinaryExpression(stmt.expression) &&
        stmt.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
        const left = stmt.expression.left;
        if (!ts.isPropertyAccessExpression(left)) {
            return "top-level assignment to a non-property target";
        }
        const r = rootId(left);
        if (!r || !ctx.locals.has(r)) {
            return `self-mount target \`${r ?? "?"}\` is not a local const from an imported factory`;
        }
        const logic = hasLogic(stmt.expression.right);
        if (logic) return logic;
        return null;
    }

    return "top-level runtime statement";
}

// ─── Plugin facades (`<pkg>/src/public-api.ts`) ───────────────────────────────
//
// Same invariant, different prescribed shape. A plugin does not self-mount onto the
// namespace from its facade — `entry.ts` does — so the two conforming patterns are:
//
//   A  pure re-export     export { addLayer } from "./cog-api.js";
//   B  factory            export function buildPublicApi() { return { …delegates }; }
//
// Pattern B is why the CORE grammar cannot be reused verbatim: it rejects every local
// function declaration, which would flag `buildPublicApi` itself — i.e. flag the three
// packages that already conform. The one added allowance is exactly that factory, and
// its body is still held to the thin-delegate rule, so the exemption cannot be used to
// smuggle logic in behind the prescribed name.

const registry = require("./lib/packages.cjs");

/** The prescribed factory name — the only local function a plugin facade may declare. */
const PLUGIN_FACTORY = "buildPublicApi";

/**
 * @returns {string|null} reason the statement violates the plugin facade contract.
 * Everything outside the factory allowance falls through to the shared core grammar.
 */
function pluginViolationOf(stmt, ctx) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.name.text === PLUGIN_FACTORY) {
        if (!stmt.body) return null; // overload signature — no runtime body
        const stmts = stmt.body.statements;
        if (stmts.length !== 1 || !ts.isReturnStatement(stmts[0])) {
            return `\`${PLUGIN_FACTORY}\` must be a single \`return { … }\` of thin delegates`;
        }
        const ret = stmts[0].expression;
        if (!ret || !ts.isObjectLiteralExpression(ret)) {
            return `\`${PLUGIN_FACTORY}\` must return an object literal of thin delegates`;
        }
        for (const p of ret.properties) {
            // A spread of an imported object is a delegation too (`...Table`).
            if (ts.isSpreadAssignment(p)) {
                const r = rootId(p.expression);
                if (!r || !ctx.imported.has(r)) return `spread of non-imported \`${r ?? "?"}\``;
                continue;
            }
            const why = thinDelegate(p, ctx.imported);
            if (why) return `inline logic in \`${p.name ? p.name.getText() : "?"}\`: ${why}`;
        }
        return null;
    }
    return violationOf(stmt, ctx);
}

/** Every workspace package that ships a `src/public-api.ts`, in registry order. */
function pluginFacadeFiles() {
    const out = [];
    for (const pkg of registry.all()) {
        const rel = `${pkg.dir}/src/public-api.ts`;
        if (fs.existsSync(path.join(ROOT, rel))) out.push({ pkg: pkg.name, rel });
    }
    return out;
}

function checkPluginFacadePurity() {
    const files = pluginFacadeFiles();
    // A registry that stops matching would make this gate pass by scanning nothing —
    // the failure mode `probe-gate-visibility.cjs` exists for. Assert it found some.
    if (files.length === 0) {
        console.error(
            `${C.red}✖${C.reset}  aucun \`src/public-api.ts\` trouvé — registre cassé ?`
        );
        return 2;
    }

    const leaks = [];
    for (const { pkg, rel } of files) {
        const full = path.join(ROOT, rel);
        const sf = ts.createSourceFile(
            full,
            fs.readFileSync(full, "utf8"),
            ts.ScriptTarget.ES2022,
            true
        );
        const ctx = { imported: collectImported(sf), locals: new Set() };
        for (const stmt of sf.statements) {
            const reason = pluginViolationOf(stmt, ctx);
            if (reason) {
                leaks.push({
                    pkg,
                    file: rel,
                    line: sf.getLineAndCharacterOfPosition(stmt.getStart()).line + 1,
                    reason,
                });
            }
        }
    }

    if (leaks.length === 0) {
        console.log(
            `${C.green}✓${C.reset}  ${files.length} façades plugin \`public-api.ts\` conformes ` +
                `(ré-export / buildPublicApi), 0 logique inline.`
        );
        return 0;
    }

    const pkgs = new Set(leaks.map((l) => l.pkg));
    console.error(
        `${C.red}✖${C.reset}  ${leaks.length} fuite(s) de logique dans ${pkgs.size} façade(s) plugin :\n`
    );
    for (const l of leaks) {
        console.error(`${C.dim}    ${l.file}:${l.line}  ${l.reason}${C.reset}`);
    }
    console.error(
        `\n  INV-FACADE vaut aussi pour les plugins : \`public-api.ts\` expose l'API, il ne\n` +
            `  la met pas en œuvre. Deux patrons sont conformes :\n` +
            `    A  ré-export pur   export { addLayer } from "./cog-api.js";\n` +
            `    B  fabrique        export function buildPublicApi() { return { … }; }\n\n` +
            `  Déplacer l'implémentation dans un module de domaine (\`<nom>-api.ts\`) et ne\n` +
            `  laisser ici que la délégation.\n`
    );
    return 1;
}

function checkFacadePurity() {
    if (!fs.existsSync(MODULES_DIR)) {
        console.error(`${C.red}✖${C.reset}  répertoire introuvable : ${normPath(MODULES_DIR)}`);
        return 2;
    }
    const files = fs
        .readdirSync(MODULES_DIR)
        .filter((f) => FACADE_RE.test(f))
        .sort();

    if (files.length === 0) {
        console.error(`${C.red}✖${C.reset}  aucune façade trouvée — glob cassé ?`);
        return 2;
    }

    const leaks = [];
    for (const name of files) {
        const full = path.join(MODULES_DIR, name);
        const sf = ts.createSourceFile(
            full,
            fs.readFileSync(full, "utf8"),
            ts.ScriptTarget.ES2022,
            true
        );
        const ctx = { imported: collectImported(sf), locals: new Set() };
        for (const stmt of sf.statements) {
            const reason = violationOf(stmt, ctx);
            if (reason) {
                leaks.push({
                    file: `modules/${name}`,
                    line: sf.getLineAndCharacterOfPosition(stmt.getStart()).line + 1,
                    reason,
                });
            }
        }
    }

    if (leaks.length === 0) {
        console.log(
            `${C.green}✓${C.reset}  ${files.length} façades \`geoleaf.*.ts\` conformes ` +
                `(re-export / buildPublicApi / self-mount), 0 logique inline.`
        );
        return 0;
    }

    console.error(
        `${C.red}✖${C.reset}  ${leaks.length} fuite(s) de logique dans les façades publiques :\n`
    );
    for (const l of leaks) {
        console.error(`${C.dim}    ${l.file}:${l.line}  ${l.reason}${C.reset}`);
    }
    console.error(
        `\n  Une façade \`geoleaf.*.ts\` expose l'API, elle ne la met pas en œuvre. Trois\n` +
            `  patrons sont conformes (ARCHITECTURE.md §Façades publiques) :\n` +
            `    A  ré-export pur        export { X } from "./built-in/…/facade.js";\n` +
            `    B  fabrique importée    export const X = buildPublicApi();\n` +
            `    C  self-mount           const _gl = ensureGeoLeaf(); _gl.X = X;\n\n` +
            `  Déplacer la logique vers \`built-in/<domaine>/facade.ts\` et ne laisser ici que\n` +
            `  le ré-export — c'est la conformation qu'ont reçue \`storage\` (S3) puis\n` +
            `  \`events\` et \`introspection\` (S13.1).\n`
    );
    return 1;
}

if (require.main === module) {
    console.log(`\n${C.cyan}── 🪞 Pureté des façades publiques ──${C.reset}\n`);
    try {
        const core = checkFacadePurity();
        const plugins = checkPluginFacadePurity();
        // Run BOTH before exiting: reporting only the first failure would hide the other
        // half of the invariant, and the two are conformed by different sprints.
        process.exitCode = core || plugins;
    } catch (err) {
        console.error(`${C.red}✖${C.reset}  erreur d'outillage : ${err.message}`);
        process.exitCode = 2;
    }
    console.log("");
}

module.exports = { checkFacadePurity, checkPluginFacadePurity, violationOf, pluginViolationOf };
