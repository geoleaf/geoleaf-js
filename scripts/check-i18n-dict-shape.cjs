#!/usr/bin/env node
/*!
 * GeoLeaf — i18n dictionary shape net (C-5)
 * © 2026 Mattieu Pottier — MIT
 *
 * The core's i18n table is FLAT: `getLabel` (utils/i18n/i18n.ts) indexes the
 * merged table directly (`_pluginActive[key]`) and NEVER splits on ".".
 * `registerDict` documents it ("Keys are namespaced (e.g.
 * \"print.toolbar.button\")"), and `_rebuildPluginFlat` settles for an
 * `Object.assign`.
 *
 * A NESTED dictionary (`{ geocoding: { toolbar: { button: "…" } } }`) thus
 * registers the key "geocoding" — whose value is an object — and lets
 * `getLabel("geocoding.toolbar.button")` fall through to the raw key. Nothing
 * fails: the translation is simply unreachable, and the plugin's hard-coded
 * French label in `t(key, fallback)` masks the outage in ALL locales.
 *
 * That is bug C-5: `plugin-geocoding` shipped a correct, complete `en`
 * dictionary, never read, inherited from `_plugin-template` at scaffolding.
 * Actually-suffered symptom: `geocoding.toolbar.button` has NO fallback
 * (`mobile-toolbar-pill.ts` calls `getLabel` bare) ⇒ the mobile button carried
 * `aria-label="geocoding.toolbar.button"`.
 *
 * The existing i18n net (`packages/core/__tests__/i18n/i18n.test.js`) only
 * sweeps the core's `src/lang/`: no plugin dictionary was verified. That is the
 * hole geocoding went through, and any scaffolded plugin would have gone through
 * again.
 *
 * This gate sweeps `packages/<pkg>/src/lang/lang-*.ts` of ALL workspaces (core,
 * plugins and template) and refuses any value that is not a string literal.
 *
 * Usage :
 *   node scripts/check-i18n-dict-shape.cjs           # gate
 *   node scripts/check-i18n-dict-shape.cjs --json     # + dump JSON
 * Exit codes : 0 vert · 1 dictionnaire non plat · 2 erreur d'outillage.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const PKG_DIR = path.join(ROOT, "packages");
const JSON_OUT = process.argv.includes("--json");

/** Relative path normalised to `/` — `path.relative` returns `\` on Windows. */
function normPath(p) {
    return path.relative(ROOT, p).split(path.sep).join("/");
}

/**
 * All the monorepo's `<package>/src/lang/lang-*.ts`.
 *
 * Packages come from the workspace registry, no longer a single-level
 * `readdirSync` on `packages/`. With the old form, the packages' move under
 * `packages/plugins/` would have returned no dictionary — and a shape check on
 * zero files passes green.
 */
function collectDictFiles() {
    const out = [];
    let pkgs;
    try {
        pkgs = require("./lib/packages.cjs").all();
    } catch (err) {
        console.error(`[i18n-shape] registre de packages illisible : ${err.message}`);
        process.exit(2);
    }
    for (const pkg of pkgs) {
        const langDir = path.join(pkg.absDir, "src", "lang");
        // Not every package has a dictionary — normal absence, not an anomaly.
        if (!fs.existsSync(langDir)) continue;
        for (const f of fs.readdirSync(langDir)) {
            if (/^lang-.*\.ts$/.test(f)) out.push(path.join(langDir, f));
        }
    }
    return out.sort();
}

/**
 * Collects the properties whose value is not a string literal.
 * A nested dictionary is exactly that case: the value is an object.
 */
function findNonFlatEntries(file) {
    const src = ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.ES2022,
        true
    );
    const violations = [];

    function walk(node) {
        if (ts.isObjectLiteralExpression(node)) {
            for (const prop of node.properties) {
                if (!ts.isPropertyAssignment(prop)) continue;
                const init = prop.initializer;
                const isFlat = ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init);
                if (isFlat) continue;
                const key = prop.name.getText(src);
                const line = src.getLineAndCharacterOfPosition(prop.getStart(src)).line + 1;
                violations.push({
                    file: normPath(file),
                    line,
                    key,
                    kind: ts.isObjectLiteralExpression(init)
                        ? "nested-object"
                        : ts.SyntaxKind[init.kind],
                });
            }
        }
        ts.forEachChild(node, walk);
    }
    walk(src);
    return violations;
}

function main() {
    const files = collectDictFiles();
    if (files.length === 0) {
        console.error("[i18n-shape] aucun dictionnaire trouvé — le gate ne garde rien.");
        process.exit(2);
    }

    const violations = files.flatMap(findNonFlatEntries);

    if (JSON_OUT) {
        console.log(JSON.stringify({ scanned: files.map(normPath), violations }, null, 2));
    }

    if (violations.length === 0) {
        console.log(`[i18n-shape] ✅ ${files.length} dictionnaires — tous plats.`);
        process.exit(0);
    }

    console.error(
        `[i18n-shape] ❌ ${violations.length} entrée(s) non plate(s) dans ${files.length} dictionnaires.\n` +
            `La table i18n du cœur est plate : getLabel n'éclate jamais les points.\n` +
            `Une valeur objet rend la clé INATTEIGNABLE — sans erreur (bug C-5).\n` +
            `Écrire les clés à plat : "<plugin>.section.item": "Libellé".\n`
    );
    for (const v of violations) {
        console.error(`  ${v.file}:${v.line} — ${v.key} → ${v.kind}`);
    }
    process.exit(1);
}

main();
