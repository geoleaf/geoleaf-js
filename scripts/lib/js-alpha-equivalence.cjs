#!/usr/bin/env node
/**
 * Are two JavaScript bundles the same program up to a renaming of their LOCAL bindings?
 *
 * ## Why this lib exists
 *
 * The published-parity gate (PUB-05) judges what a package delivers against what the registry
 * carries at an equal version. For a package that publishes its `src/`, the authored files are
 * judged by PUB-02 — but its bundle also inlines PRIVATE workspace libraries, and a change in
 * one of them reaches the published consumers with no authored change of their own.
 *
 * Bytes cannot judge that: a minifier hands local bindings out differently as soon as anything
 * inlined moves. Measured on 2026-09-10 on `@geoleaf-plugins/navigation@1.0.0`: its published
 * bundle differed from the repository's by forty-eight characters, every one of them a minified
 * identifier — the same program.
 *
 * ## What is numbered, and what is kept verbatim
 *
 * Only LOCAL BINDINGS are numbered, by order of first appearance: the names a minifier is free
 * to change. Everything a minifier must keep stays verbatim, so changing it is still seen:
 *
 *   - property names (`a.b`, `{ b: 1 }`, class members) — an external API;
 *   - import and export names, including the names an `export` declaration declares — the
 *     module's contract;
 *   - free identifiers (`globalThis`, `document`) — the host's names.
 *
 * 🛑 The first sketch numbered EVERY identifier, and would have called `GeoLeaf.I18n` and
 * `GeoLeaf.Lang` the same program. A rule that equates two programs which behave differently
 * is worse than one that reddens on noise: nothing says so.
 *
 * ⚠️ A binding is recognised by NAME across the whole bundle, not by scope: a free global that
 * some inner scope also declares is numbered everywhere. A minified bundle rarely shadows a
 * host global, and the approximation only widens what is renamed — it cannot make a changed
 * literal, operator or structure compare equal.
 */
"use strict";

const crypto = require("node:crypto");

const { parseAst } = require("rollup/parseAst");

/** Node keys that carry positions or syntax sugar, not meaning. */
const SKIP = new Set(["type", "start", "end", "loc", "range", "raw", "shorthand"]);

/**
 * Is the identifier under `parent[key]` a NAME rather than a binding?
 *
 * @param {any} parent The node holding the identifier.
 * @param {string | null} key The property of `parent` the identifier sits under.
 * @returns {boolean} `true` for a property, member, import or export name.
 */
function isNamePosition(parent, key) {
    switch (parent.type) {
        case "MemberExpression":
            return key === "property" && !parent.computed;
        case "Property":
        case "MethodDefinition":
        case "PropertyDefinition":
            return key === "key" && !parent.computed;
        case "ImportSpecifier":
            return key === "imported";
        case "ExportSpecifier":
        case "ExportAllDeclaration":
            return key === "exported";
        case "MetaProperty":
            return true;
        default:
            return false;
    }
}

/**
 * The names a binding pattern declares.
 *
 * @param {any} pattern An `Identifier`, or an object, array, rest or default pattern.
 * @param {string[]} into Receives the declared names.
 * @returns {string[]} `into`, for chaining.
 */
function patternNames(pattern, into) {
    if (!pattern) return into;
    switch (pattern.type) {
        case "Identifier":
            into.push(pattern.name);
            break;
        case "ObjectPattern":
            for (const p of pattern.properties) {
                patternNames(p.type === "RestElement" ? p.argument : p.value, into);
            }
            break;
        case "ArrayPattern":
            for (const e of pattern.elements) patternNames(e, into);
            break;
        case "RestElement":
            patternNames(pattern.argument, into);
            break;
        case "AssignmentPattern":
            patternNames(pattern.left, into);
            break;
    }
    return into;
}

/**
 * Every name the bundle DECLARES anywhere — variables, functions, classes, parameters, catch
 * parameters, import locals, labels: the names a minifier may hand out differently.
 *
 * @param {any} ast The program node.
 * @returns {Set<string>} The declared names.
 */
function declaredNames(ast) {
    /** @type {string[]} */
    const names = [];
    /** @param {any} node */
    const visit = (node) => {
        if (Array.isArray(node)) {
            for (const child of node) visit(child);
            return;
        }
        if (!node || typeof node !== "object") return;
        switch (node.type) {
            case "VariableDeclarator":
                patternNames(node.id, names);
                break;
            case "FunctionDeclaration":
            case "FunctionExpression":
            case "ArrowFunctionExpression":
                patternNames(node.id, names);
                for (const p of node.params) patternNames(p, names);
                break;
            case "ClassDeclaration":
            case "ClassExpression":
                patternNames(node.id, names);
                break;
            case "CatchClause":
                patternNames(node.param, names);
                break;
            case "ImportSpecifier":
            case "ImportDefaultSpecifier":
            case "ImportNamespaceSpecifier":
                patternNames(node.local, names);
                break;
            case "LabeledStatement":
                names.push(node.label.name);
                break;
        }
        for (const k of Object.keys(node)) if (!SKIP.has(k)) visit(node[k]);
    };
    visit(ast);
    return new Set(names);
}

/**
 * The names an `export` DECLARATION exports — they are the module's contract, not locals.
 *
 * @param {any} declaration The `declaration` of an `ExportNamedDeclaration`.
 * @returns {string[]} The exported names, in source order.
 */
function exportedDeclarationNames(declaration) {
    if (declaration.type === "VariableDeclaration") {
        /** @type {string[]} */
        const names = [];
        for (const d of declaration.declarations) patternNames(d.id, names);
        return names;
    }
    return declaration.id ? [declaration.id.name] : [];
}

/**
 * SHA-256 of `code` as a program, its local bindings numbered by first appearance.
 *
 * @param {string} code An ES module, as a bundler emits it.
 * @returns {string} Hex digest; two bundles are the same program up to a renaming of local
 *   bindings exactly when their digests are equal.
 * @throws {Error} When `code` does not parse. The caller must refuse to conclude — a parse
 *   failure is neither a divergence nor an agreement.
 * @example
 * alphaHash("const a=1;export{a as x}") === alphaHash("const b=1;export{b as x}"); // → true
 * alphaHash("const a=1;export{a as x}") === alphaHash("const a=1;export{a as y}"); // → false
 */
function alphaHash(code) {
    const ast = parseAst(code);
    const bound = declaredNames(ast);
    /** @type {Map<string, number>} */
    const index = new Map();
    const hash = crypto.createHash("sha256");
    /**
     * @param {any} node
     * @param {any} parent
     * @param {string | null} key
     */
    const walk = (node, parent, key) => {
        if (Array.isArray(node)) {
            hash.update("[");
            for (const child of node) walk(child, parent, key);
            hash.update("]");
            return;
        }
        if (typeof node === "bigint") {
            hash.update(`${node}n;`);
            return;
        }
        if (node === null || typeof node !== "object") {
            hash.update(`${JSON.stringify(node)};`);
            return;
        }
        if (node.type === "Identifier") {
            if ((parent && isNamePosition(parent, key)) || !bound.has(node.name)) {
                hash.update(`N${node.name};`);
            } else {
                if (!index.has(node.name)) index.set(node.name, index.size);
                hash.update(`B${index.get(node.name)};`);
            }
            return;
        }
        const isNode = typeof node.type === "string";
        hash.update(isNode ? `(${node.type}` : "{");
        if (node.type === "ExportNamedDeclaration" && node.declaration) {
            hash.update(`|exports:${exportedDeclarationNames(node.declaration).join(",")}`);
        }
        for (const k of Object.keys(node).sort()) {
            if (isNode && SKIP.has(k)) continue;
            hash.update(`|${k}:`);
            walk(node[k], isNode ? node : parent, k);
        }
        hash.update(isNode ? ")" : "}");
    };
    walk(ast, null, null);
    return hash.digest("hex");
}

module.exports = { alphaHash };
