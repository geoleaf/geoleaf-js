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
 * Usage : const { readInterfaceMembers, readExportedStringArray } = require("./lib/ts-decl-read.cjs");
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const registry = require("./packages.cjs");

const ROOT = registry.ROOT;

/** Tooling exit — never 0, never 1: reading is a precondition, not a verdict. */
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

module.exports = { readInterfaceMembers, readExportedStringArray, ROOT };
