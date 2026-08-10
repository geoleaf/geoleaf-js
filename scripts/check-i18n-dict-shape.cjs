#!/usr/bin/env node
/*!
 * GeoLeaf — Filet de forme des dictionnaires i18n (roadmap nettoyage, Sprint 8 / C-5)
 * © 2026 Mattieu Pottier — MIT
 *
 * La table i18n du cœur est PLATE : `getLabel` (utils/i18n/i18n.ts) indexe
 * directement la table fusionnée (`_pluginActive[key]`) et ne découpe JAMAIS sur ".".
 * `registerDict` le documente ("Keys are namespaced (e.g. \"print.toolbar.button\")"),
 * et `_rebuildPluginFlat` se contente d'un `Object.assign`.
 *
 * Un dictionnaire IMBRIQUÉ (`{ geocoding: { toolbar: { button: "…" } } }`) enregistre
 * donc la clé "geocoding" — dont la valeur est un objet — et laisse
 * `getLabel("geocoding.toolbar.button")` retomber jusqu'à la clé brute. Rien n'échoue :
 * la traduction est simplement inatteignable, et le libellé français en dur du
 * `t(key, fallback)` du plugin masque la panne dans TOUTES les locales.
 *
 * C'est le bug C-5 : `plugin-geocoding` livrait un dictionnaire `en` correct et complet,
 * jamais lu, hérité de `_plugin-template` au scaffolding. Symptôme réellement subi :
 * `geocoding.toolbar.button` n'a AUCUN fallback (`mobile-toolbar-pill.ts` appelle
 * `getLabel` nu) ⇒ le bouton mobile portait `aria-label="geocoding.toolbar.button"`.
 *
 * Le filet i18n existant (`packages/core/__tests__/i18n/i18n.test.js`) ne balaie que
 * `src/lang/` du cœur : aucun dictionnaire de plugin n'était vérifié. C'est le trou par
 * lequel geocoding est passé, et par lequel tout plugin scaffoldé serait repassé.
 *
 * Ce gate balaie `packages/<pkg>/src/lang/lang-*.ts` de TOUS les workspaces (cœur,
 * plugins et gabarit) et refuse toute valeur qui n'est pas un littéral chaîne.
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

/** Chemin relatif normalisé en `/` — `path.relative` rend `\` sous Windows. */
function normPath(p) {
    return path.relative(ROOT, p).split(path.sep).join("/");
}

/**
 * Tous les `<package>/src/lang/lang-*.ts` du monorepo.
 *
 * ARCHI S9.5 — packages issus du registre de workspaces, plus d'un `readdirSync`
 * à un seul niveau sur `packages/`. Avec l'ancienne forme, le déplacement des
 * packages sous `packages/plugins/` (ARCHI S10) n'aurait renvoyé aucun dictionnaire
 * — et un contrôle de forme sur zéro fichier passe au vert.
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
        // Tous les packages n'ont pas de dictionnaire — absence normale, pas une anomalie.
        if (!fs.existsSync(langDir)) continue;
        for (const f of fs.readdirSync(langDir)) {
            if (/^lang-.*\.ts$/.test(f)) out.push(path.join(langDir, f));
        }
    }
    return out.sort();
}

/**
 * Relève les propriétés dont la valeur n'est pas un littéral chaîne.
 * Un dictionnaire imbriqué est exactement ce cas : la valeur est un objet.
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
