/*!
 * GeoLeaf — AST-based TypeScript declaration reading, shared between gates.
 * © 2026 Mattieu Pottier — MIT
 *
 * ## Why this module exists
 *
 * `verify-host-contract-sync.cjs` used to carry these two readers. Then
 * `check-namespace-typing-coverage.cjs` needed BOTH — the same `GeoLeafGlobal` interface,
 * the same `EXPECTED_FACADE_KEYS`. A second reader triggers the extraction: that is this
 * repo's rule, and it has a measured rationale (`source-inventory.cjs`,
 * `side-effect-modules.cjs`, `test-load-sites.cjs` were born of the same move). Two
 * copies of a reader drift, and the drift is invisible as long as both gates come out
 * green.
 *
 * ## What these functions REFUSE, and why that is the module's core
 *
 * None ever returns an empty result "by default". A gate comparing two empty sets agrees
 * perfectly with itself and proves nothing — the class `probe-gate-visibility.cjs`
 * hunts. Every read-failure cause therefore exits **2** (tooling error), never 0.
 *
 * `readExportedStringArray` replaces a regex that bounded a `[\s\S]*?` on `];`. The
 * array it read closes on `].sort();`: the match did not stop there, it ran to the
 * file's NEXT `];`. The gate read **104 keys for a 103-entry array**, and any string
 * written after the array — inside a comment included — became a valid key. The AST
 * makes that failure class structurally impossible, and additionally refuses three
 * shapes the regex swallowed in silence: a `...OTHERS` spread, a template literal, an
 * initializer that is not an array.
 *
 * ## The third reader: a table of defaults
 *
 * `readConstObjectLeaves` reads a root-level `const X = { … }` as a flat map of dotted
 * paths. It exists for the plugins' configuration defaults, which are the only statement of
 * a default a program can read: each plugin merges its profile block over one such table.
 * The tables are not bare literals — values carry `as` casts, a table may be typed or
 * `as const`, an array is the spread of a neighbouring constant, a value is a constant
 * imported from another module of the package. The reader follows those, and nothing else:
 * a value it cannot reduce to a literal comes back OPAQUE, by name, for the caller to judge.
 * It never guesses, and a table it cannot read WHOLE — a spread at its root, a shorthand, a
 * computed key — is a refusal: half a table agrees with any document.
 *
 * Usage : const { readInterfaceMembers, readExportedStringArray } = require("./lib/ts-decl-read.cjs");
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const registry = require("./packages.cjs");

const ROOT = registry.ROOT;

/**
 * Tooling exit — never 0, never 1: reading is a precondition, not a verdict.
 *
 * @param {string} tag
 * @param {string} message
 * @returns {never}
 */
function refuse(tag, message) {
    console.error(`ERROR [${tag}]: ${message}`);
    process.exit(2);
}

function parse(tag, file) {
    if (!fs.existsSync(file)) {
        refuse(tag, `fichier introuvable — ${path.relative(ROOT, file)}`);
    }
    return ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
}

/**
 * Reads an interface's NAMED property members. Index signatures
 * (`[key: string]: unknown`) are ignored by construction: they name nothing.
 *
 * ⚠️ An `extends` clause makes the read REFUSE, and that is not rigidity. This function
 * only iterates `node.members`: an inherited member is invisible to it. Without that
 * refusal, writing `interface GeoLeafGlobal extends GeoLeafTopLevelApi` would make
 * members vanish from the view of EVERY gate calling it, without a word — they would
 * report a narrower surface than reality and loosen by as much.
 *
 * @param {string} file - Absolute path of the `.ts`/`.d.ts` file.
 * @param {string} interfaceName - Name of the interface to read.
 * @param {{ tag?: string, withTypes?: boolean }} [opts] - `tag` prefixes the errors;
 *   `withTypes` returns a `Map<string, string>` (name → type text) instead of a `Set`.
 * @returns {Set<string>|Map<string, string>}
 */
function readInterfaceMembers(file, interfaceName, opts = {}) {
    const tag = opts.tag ?? "TS-DECL";
    const sf = parse(tag, file);

    let found = null;
    const visit = (node) => {
        if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
            if (node.heritageClauses && node.heritageClauses.length > 0) {
                refuse(
                    tag,
                    `l'interface \`${interfaceName}\` porte une clause \`extends\` ` +
                        `(${path.relative(ROOT, file)}). Ce lecteur n'itère que les membres ` +
                        "DÉCLARÉS : un membre hérité lui serait invisible, et la gate se " +
                        "desserrerait en silence. Déclarez les membres en ligne."
                );
            }
            found = new Map();
            for (const m of node.members) {
                if (!ts.isPropertySignature(m) || !m.name) continue;
                if (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) {
                    found.set(m.name.text, m.type ? m.type.getText(sf) : "");
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);

    if (found === null) {
        refuse(
            tag,
            `interface \`${interfaceName}\` introuvable dans ${path.relative(ROOT, file)} — ` +
                "la gate refuse de conclure."
        );
    }
    return opts.withTypes ? found : new Set(found.keys());
}

/**
 * Reads a root-level `export const X = ["a", "b", …]` and returns the set of its values.
 *
 * Five refusal causes, all exit 2 — the last three are the "silent shrinkage" half of
 * the regex bug described at the top of the file:
 *
 *   • file absent
 *   • symbol absent, renamed, or moved out of a root `export const`
 *   • symbol found but no longer exported
 *   • initializer that is not an array literal
 *   • element that is not a string literal (spread, template, reference)
 *
 * @param {string} file - Absolute path of the module.
 * @param {string} symbol - Name of the `export const`.
 * @param {{ tag?: string }} [opts]
 * @returns {Set<string>}
 */
function readExportedStringArray(file, symbol, opts = {}) {
    const tag = opts.tag ?? "TS-DECL";
    const sf = parse(tag, file);
    const rel = path.relative(ROOT, file);
    const no = (why) => refuse(tag, `\`${symbol}\` — ${why} (${rel}). La gate refuse de conclure.`);

    let init = null;
    for (const stmt of sf.statements) {
        if (!ts.isVariableStatement(stmt)) continue;
        const exported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        for (const d of stmt.declarationList.declarations) {
            if (ts.isIdentifier(d.name) && d.name.text === symbol) {
                if (!exported) no("trouvé, mais plus exporté");
                init = d.initializer ?? null;
            }
        }
    }
    if (init === null) no("non trouvé au niveau racine — renommé, déplacé ou supprimé ?");
    if (!ts.isArrayLiteralExpression(init)) no("son initialiseur n'est pas un tableau littéral");

    const values = new Set();
    for (const el of init.elements) {
        if (!ts.isStringLiteral(el)) {
            no(`contient un élément qui n'est pas une chaîne littérale (\`${el.getText(sf)}\`)`);
        }
        values.add(el.text);
    }
    return values;
}

/**
 * What a leaf of a table states.
 *
 * @typedef {{ kind: "lit", value: unknown } | { kind: "none" } | { kind: "opaque", text: string }} ConstLeaf
 * @typedef {{ file: string, sf: import("typescript").SourceFile }} ReadContext
 * @typedef {(message: string) => never} Fail
 */

/** How many constants a value may be followed through before the reader gives up. */
const MAX_HOPS = 8;

/**
 * Strips what changes a value's TYPE and never the value itself.
 *
 * @param {import("typescript").Expression} node
 * @returns {import("typescript").Expression}
 */
function unwrapValue(node) {
    let n = node;
    while (
        ts.isAsExpression(n) ||
        ts.isSatisfiesExpression(n) ||
        ts.isParenthesizedExpression(n) ||
        ts.isTypeAssertionExpression(n) ||
        ts.isNonNullExpression(n)
    ) {
        n = n.expression;
    }
    return n;
}

/**
 * The initializer of a root-level `const`, exported or not.
 *
 * @param {import("typescript").SourceFile} sf
 * @param {(name: string) => boolean} accepts
 * @returns {{ name: string, init: import("typescript").Expression }[]}
 */
function rootConsts(sf, accepts) {
    const found = [];
    for (const stmt of sf.statements) {
        if (!ts.isVariableStatement(stmt)) continue;
        for (const d of stmt.declarationList.declarations) {
            if (ts.isIdentifier(d.name) && d.initializer && accepts(d.name.text)) {
                found.push({ name: d.name.text, init: d.initializer });
            }
        }
    }
    return found;
}

/**
 * Where a name imported from a RELATIVE module is declared, or `null`. A bare specifier is
 * another package: its value is not this package's statement, and it is not followed.
 *
 * @param {ReadContext} ctx
 * @param {string} local
 * @returns {{ file: string, name: string } | null}
 */
function relativeImport(ctx, local) {
    for (const stmt of ctx.sf.statements) {
        if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
        const spec = stmt.moduleSpecifier.text;
        const named = stmt.importClause?.namedBindings;
        if (!spec.startsWith(".") || !named || !ts.isNamedImports(named)) continue;
        const hit = named.elements.find((el) => el.name.text === local);
        if (!hit) continue;
        // Sources import their siblings with the emitted extension.
        const base = path.resolve(path.dirname(ctx.file), spec.replace(/\.js$/, ""));
        const file = [`${base}.ts`, path.join(base, "index.ts")].find((f) => fs.existsSync(f));
        return file ? { file, name: (hit.propertyName ?? hit.name).text } : null;
    }
    return null;
}

/**
 * Reduces an expression to the literal it states, following constants.
 *
 * @param {import("typescript").Expression} node
 * @param {ReadContext} ctx
 * @param {number} hops
 * @returns {ConstLeaf}
 */
function evaluate(node, ctx, hops) {
    const n = unwrapValue(node);
    /** @returns {ConstLeaf} */
    const opaque = () => ({ kind: "opaque", text: n.getText(ctx.sf).replace(/\s+/g, " ") });

    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
        return { kind: "lit", value: n.text };
    }
    // The scanner already folded digit separators: `16_000_000` reads `16000000`.
    if (ts.isNumericLiteral(n)) return { kind: "lit", value: Number(n.text) };
    if (
        ts.isPrefixUnaryExpression(n) &&
        n.operator === ts.SyntaxKind.MinusToken &&
        ts.isNumericLiteral(n.operand)
    ) {
        return { kind: "lit", value: -Number(n.operand.text) };
    }
    if (n.kind === ts.SyntaxKind.TrueKeyword) return { kind: "lit", value: true };
    if (n.kind === ts.SyntaxKind.FalseKeyword) return { kind: "lit", value: false };
    if (n.kind === ts.SyntaxKind.NullKeyword) return { kind: "lit", value: null };

    if (ts.isArrayLiteralExpression(n)) {
        /** @type {unknown[]} */
        const items = [];
        for (const el of n.elements) {
            const spread = ts.isSpreadElement(el);
            const inner = evaluate(spread ? el.expression : el, ctx, hops);
            if (inner.kind !== "lit") return opaque();
            if (!spread) items.push(inner.value);
            else if (Array.isArray(inner.value)) items.push(...inner.value);
            else return opaque();
        }
        return { kind: "lit", value: items };
    }

    if (ts.isObjectLiteralExpression(n)) {
        /** @type {Record<string, unknown>} */
        const obj = {};
        for (const prop of n.properties) {
            const key = ts.isPropertyAssignment(prop) ? staticName(prop.name) : null;
            if (key === null || !ts.isPropertyAssignment(prop)) return opaque();
            const inner = evaluate(prop.initializer, ctx, hops);
            if (inner.kind === "opaque") return opaque();
            if (inner.kind === "lit") obj[key] = inner.value;
        }
        return { kind: "lit", value: obj };
    }

    if (ts.isIdentifier(n)) {
        if (n.text === "undefined") return { kind: "none" };
        if (hops >= MAX_HOPS) return opaque();
        const here = rootConsts(ctx.sf, (name) => name === n.text)[0];
        if (here) return evaluate(here.init, ctx, hops + 1);
        const away = relativeImport(ctx, n.text);
        if (!away) return opaque();
        const sf = ts.createSourceFile(
            away.file,
            fs.readFileSync(away.file, "utf8"),
            ts.ScriptTarget.ES2022,
            true
        );
        const there = rootConsts(sf, (name) => name === away.name)[0];
        return there ? evaluate(there.init, { file: away.file, sf }, hops + 1) : opaque();
    }
    return opaque();
}

/**
 * A property name that is written, not computed.
 *
 * @param {import("typescript").PropertyName} name
 * @returns {string | null}
 */
function staticName(name) {
    return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
        ? name.text
        : null;
}

/**
 * @param {{ tag?: string, throws?: boolean }} opts
 * @returns {Fail}
 */
function failWith(opts) {
    const tag = opts.tag ?? "TS-DECL";
    return (message) => {
        // A test runner must see a failed assertion, not a dead process.
        if (opts.throws) throw new Error(`[${tag}] ${message}`);
        return refuse(tag, message);
    };
}

/**
 * @param {string} file
 * @param {Fail} fail
 * @returns {ReadContext}
 */
function contextOf(file, fail) {
    if (!fs.existsSync(file)) fail(`fichier introuvable — ${path.relative(ROOT, file)}`);
    const sf = ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.ES2022,
        true
    );
    return { file, sf };
}

/**
 * Reads a root-level `const` whose initializer is an object literal, as a flat map of
 * dotted paths: `{ margins: { top: 10 } }` yields `margins.top`. An EMPTY object is a leaf
 * of its own, since that is the default it states.
 *
 * Four refusal causes — the table is read whole or not at all:
 *
 *   • file absent
 *   • no root-level `const` whose name matches, or several
 *   • initializer that is not an object literal
 *   • a member the reader cannot name: spread, shorthand, method, accessor, computed key
 *
 * A VALUE it cannot reduce to a literal is not a refusal: the leaf comes back `opaque`
 * with its source text, and the caller decides what an unreadable default is worth.
 *
 * @param {string} file - Absolute path of the module.
 * @param {RegExp} namePattern - Which root-level `const` is the table.
 * @param {{ tag?: string, throws?: boolean }} [opts] - `throws` raises instead of exiting 2.
 * @returns {{ name: string, leaves: Map<string, ConstLeaf> }}
 */
function readConstObjectLeaves(file, namePattern, opts = {}) {
    const fail = failWith(opts);
    const ctx = contextOf(file, fail);
    const rel = path.relative(ROOT, file);

    const tables = rootConsts(ctx.sf, (name) => namePattern.test(name));
    if (tables.length !== 1) {
        fail(
            `${tables.length} constante(s) racine dont le nom satisfait ${namePattern} dans ${rel}` +
                (tables.length ? ` (${tables.map((t) => t.name).join(", ")})` : "") +
                " — il en faut exactement une."
        );
    }
    const table = tables[0];
    const root = unwrapValue(table.init);
    if (!ts.isObjectLiteralExpression(root)) {
        fail(`\`${table.name}\` n'est pas un objet littéral (${rel}).`);
    }

    /** @type {Map<string, ConstLeaf>} */
    const leaves = new Map();
    /**
     * @param {import("typescript").ObjectLiteralExpression} obj
     * @param {string} prefix
     */
    const flatten = (obj, prefix) => {
        for (const prop of obj.properties) {
            const key = ts.isPropertyAssignment(prop) ? staticName(prop.name) : null;
            if (key === null || !ts.isPropertyAssignment(prop)) {
                fail(
                    `\`${table.name}\` porte un membre que le lecteur ne sait pas nommer — ` +
                        `\`${prop.getText(ctx.sf).split("\n")[0]}\` (${rel}). ` +
                        "Une table lue à moitié concorde avec n'importe quel document."
                );
                continue;
            }
            const value = unwrapValue(prop.initializer);
            if (ts.isObjectLiteralExpression(value) && value.properties.length > 0) {
                flatten(value, `${prefix}${key}.`);
            } else {
                leaves.set(`${prefix}${key}`, evaluate(prop.initializer, ctx, 0));
            }
        }
    };
    flatten(/** @type {import("typescript").ObjectLiteralExpression} */ (root), "");
    return { name: table.name, leaves };
}

/**
 * Reads the literal a root-level `const` states, following constants as
 * `readConstObjectLeaves` does.
 *
 * @param {string} file - Absolute path of the module.
 * @param {string} name - Name of the `const`.
 * @param {{ tag?: string, throws?: boolean }} [opts]
 * @returns {ConstLeaf}
 */
function readConstLiteral(file, name, opts = {}) {
    const fail = failWith(opts);
    const ctx = contextOf(file, fail);
    const decl = rootConsts(ctx.sf, (n) => n === name)[0];
    if (!decl) fail(`constante \`${name}\` absente de ${path.relative(ROOT, file)}.`);
    return evaluate(decl.init, ctx, 0);
}

/**
 * The string literals passed FIRST to every call of a function, anywhere in a module.
 * Serves to learn which configuration namespace a module reads, from the read itself.
 *
 * @param {string} file - Absolute path of the module.
 * @param {string} callee - Name the function is called by.
 * @param {{ tag?: string, throws?: boolean }} [opts]
 * @returns {string[]}
 */
function readCallFirstStringArgs(file, callee, opts = {}) {
    const ctx = contextOf(file, failWith(opts));
    /** @type {string[]} */
    const args = [];
    /** @param {import("typescript").Node} node */
    const visit = (node) => {
        if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === callee &&
            node.arguments.length > 0 &&
            ts.isStringLiteral(node.arguments[0])
        ) {
            args.push(node.arguments[0].text);
        }
        ts.forEachChild(node, visit);
    };
    visit(ctx.sf);
    return args;
}

module.exports = {
    readInterfaceMembers,
    readExportedStringArray,
    readConstObjectLeaves,
    readConstLiteral,
    readCallFirstStringArgs,
    ROOT,
};
