#!/usr/bin/env node
/*!
 * GeoLeaf — Gate: contracts/ is a PURE type surface
 * © 2026 Mattieu Pottier — MIT
 *
 * ## Why this exists
 *
 * `packages/core/src/contracts/*.contract.ts` declares the seams between core and its
 * modules/plugins. The directory's promise is "pure type/interface surface": every file
 * is erased at build time — no runtime value, no side effect. The wiring had to *undo* two
 * breaches of that promise: `LegendContract` and `POIAddFormContract`, singletons doing
 * globalThis lookups, had drifted into contracts/. They were moved to capabilities/ and
 * modules/. This gate stops the drift from recurring — it fails if any contract file gains
 * a runtime value export, a non-type import, or an executable statement.
 *
 * A contract file may contain ONLY:
 *   - `import type ...`                                       (type-only imports)
 *   - `export interface ...` / `export type ...`
 *   - `export type { ... }` / `export { type X }` / `export {}`   (type-only / marker re-exports)
 *   - ambient `declare` statements                           (no runtime emit)
 *   - comments
 *
 * Anything else — `export const/function/class/enum`, `export default`, a value import,
 * a bare `import "./x"`, a top-level statement — is a runtime leak and fails the gate.
 *
 * GREEN on wiring (contracts/ was purified at wiring), so it ships with NO baseline: the
 * repo's "no permanently-red gate" rule holds — a green gate needs no baseline
 * (cf. check-orphan-exports.cjs).
 *
 * Usage:  node scripts/check-contracts-pure.cjs
 * Exit codes: 0 pure · 1 runtime leak found · 2 tooling error.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
// Through the registry, which throws. This gate already has its "no .ts in
// contracts → broken path?" guard (below): registry resolution makes it
// unreachable for the cause it suspected, which is the goal.
const CONTRACTS_DIR = path.join(
    require("./lib/packages.cjs").requireByDirName("core").absDir,
    "src",
    "contracts"
);

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

function modifiersOf(node) {
    return ts.canHaveModifiers(node) ? ts.getModifiers(node) || [] : [];
}
function hasMod(node, kind) {
    return modifiersOf(node).some((m) => m.kind === kind);
}
const isDeclare = (n) => hasMod(n, ts.SyntaxKind.DeclareKeyword);

/**
 * `import { type A, type B }` — the clause's `isTypeOnly` is false, but every named
 * binding is a type. Pure. A default/namespace binding, or any non-type element, or a
 * bare side-effect import, makes it a value import.
 */
function isPureImport(stmt) {
    const clause = stmt.importClause;
    if (!clause) return false; // bare `import "./x"` — side effect
    if (clause.isTypeOnly) return true; // `import type ...`
    if (clause.name) return false; // default value binding
    const nb = clause.namedBindings;
    if (nb && ts.isNamedImports(nb)) {
        return nb.elements.length > 0 && nb.elements.every((e) => e.isTypeOnly);
    }
    return false; // namespace import, or nothing usable
}

/** `export type { A }` / `export { type A }` / `export {}` — pure; `export *` / value re-export — not. */
function isPureExportDecl(stmt) {
    if (stmt.isTypeOnly) return true;
    const clause = stmt.exportClause;
    if (clause && ts.isNamedExports(clause)) {
        // `export {}` (module marker → empty) or all-type-only elements → pure.
        return clause.elements.every((e) => e.isTypeOnly);
    }
    return false; // `export * from ...` or namespace re-export
}

/** @returns {string|null} reason if the statement is a runtime leak, else null. */
function violationOf(stmt) {
    if (ts.isInterfaceDeclaration(stmt)) return null;
    if (ts.isTypeAliasDeclaration(stmt)) return null;
    if (ts.isImportDeclaration(stmt)) {
        return isPureImport(stmt) ? null : "non-type import (use `import type`)";
    }
    if (ts.isExportDeclaration(stmt)) {
        return isPureExportDecl(stmt) ? null : "value re-export (use `export type`)";
    }
    if (ts.isImportEqualsDeclaration(stmt)) {
        return stmt.isTypeOnly ? null : "import = require(...) (runtime)";
    }
    // Ambient declarations emit no runtime — allowed.
    if (isDeclare(stmt)) return null;
    if (ts.isVariableStatement(stmt)) return "value declaration (const/let/var)";
    if (ts.isFunctionDeclaration(stmt)) return "function declaration (runtime)";
    if (ts.isClassDeclaration(stmt)) return "class declaration (runtime)";
    if (ts.isEnumDeclaration(stmt)) return "enum (emits runtime — use a union type)";
    if (ts.isModuleDeclaration(stmt)) return "namespace/module with runtime body";
    if (ts.isExportAssignment(stmt)) return "export default/assignment (runtime)";
    // Directive prologues ("use strict") and stray `;` emit no runtime value — benign.
    if (ts.isExpressionStatement(stmt) && ts.isStringLiteral(stmt.expression)) return null;
    if (ts.isEmptyStatement(stmt)) return null;
    return "top-level runtime statement";
}

function listContractFiles() {
    return fs
        .readdirSync(CONTRACTS_DIR, { withFileTypes: true })
        .filter((d) => d.isFile() && d.name.endsWith(".ts") && !d.name.endsWith(".d.ts"))
        .map((d) => path.join(CONTRACTS_DIR, d.name));
}

function checkContractsPure() {
    const ok = (m) => console.log(`${C.green}✓${C.reset}  ${m}`);
    const err = (m) => console.error(`${C.red}✗${C.reset}  ${m}`);
    const dim = (m) => console.error(`${C.dim}   ${m}${C.reset}`);

    let files;
    try {
        files = listContractFiles();
    } catch (e) {
        err(`packages/core/src/contracts introuvable — ${e.message}`);
        return 2;
    }
    if (files.length === 0) {
        err("aucun fichier .ts dans packages/core/src/contracts — chemin cassé ?");
        return 2;
    }

    const leaks = [];
    for (const file of files) {
        let sf;
        try {
            const text = fs.readFileSync(file, "utf8");
            sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
        } catch (e) {
            err(`échec de parsing sur ${normPath(path.relative(ROOT, file))} — ${e.message}`);
            return 2;
        }
        for (const stmt of sf.statements) {
            const reason = violationOf(stmt);
            if (reason) {
                const line = sf.getLineAndCharacterOfPosition(stmt.getStart()).line + 1;
                leaks.push({ file: normPath(path.relative(ROOT, file)), line, reason });
            }
        }
    }

    if (leaks.length === 0) {
        ok(`contracts/ est une surface de types pure (${files.length} fichiers, 0 fuite runtime).`);
        return 0;
    }

    err(
        `${leaks.length} fuite(s) runtime dans contracts/ — un contrat ne doit exporter que des types :`
    );
    for (const l of leaks) dim(`${l.file}:${l.line}  ${l.reason}`);
    console.error(
        "\nUn contrat qui porte de la logique runtime est une « membrane » (cf. les deux purifiées :\n" +
            "LegendContract / POIAddFormContract déplacés hors de contracts/). Déplacer l'impl\n" +
            "vers capabilities/ ou modules/, ne laisser ici que les interfaces et les types."
    );
    return 1;
}

if (require.main === module) {
    console.log(`\n${C.cyan}── 🧬 Pureté des contrats (type-only) ──${C.reset}\n`);
    process.exitCode = checkContractsPure();
    console.log("");
}

module.exports = { checkContractsPure, violationOf };
