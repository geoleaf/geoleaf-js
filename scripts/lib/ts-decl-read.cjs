/*!
 * GeoLeaf — lecture de déclarations TypeScript sur AST, partagée entre gates.
 * © 2026 Mattieu Pottier — MIT
 *
 * ## Pourquoi ce module existe
 *
 * `verify-host-contract-sync.cjs` (API publique S3.5) portait ces deux lecteurs. À l'API
 * publique S4.2, `check-namespace-typing-coverage.cjs` a eu besoin des DEUX — la même interface
 * `GeoLeafGlobal`, le même `EXPECTED_FACADE_KEYS`. Un second lecteur déclenche l'extraction :
 * c'est la règle du dépôt, et elle a un motif mesuré (`source-inventory.cjs`,
 * `side-effect-modules.cjs`, `test-load-sites.cjs` sont nés du même geste). Deux copies d'un
 * lecteur dérivent, et la dérive est invisible tant que les deux gates sortent vertes.
 *
 * ## Ce que ces fonctions REFUSENT, et pourquoi c'est le cœur du module
 *
 * Aucune ne rend jamais un résultat vide « par défaut ». Une gate qui compare deux ensembles
 * vides s'accorde parfaitement avec elle-même et ne prouve rien — c'est la classe que
 * `probe-gate-visibility.cjs` traque. Chaque cause d'échec de lecture sort donc en **exit 2**
 * (erreur d'outillage), jamais en 0.
 *
 * `readExportedStringArray` remplace une regex qui, jusqu'à l'API S4 C0, bornait un
 * `[\s\S]*?` sur `];`. Le tableau qu'elle lisait se ferme sur `].sort();` : le match ne
 * s'arrêtait pas là, il courait jusqu'au `];` SUIVANT du fichier. La gate lisait **104 clés
 * pour un tableau de 103**, et toute chaîne écrite après le tableau — dans un commentaire
 * compris — devenait une clé valide. L'AST rend cette classe de panne structurellement
 * impossible, et refuse en plus sur trois formes que la regex avalait en silence : un spread
 * `...AUTRES`, un littéral gabarit, un initialiseur qui n'est pas un tableau.
 *
 * Usage : const { readInterfaceMembers, readExportedStringArray } = require("./lib/ts-decl-read.cjs");
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const registry = require("./packages.cjs");

const ROOT = registry.ROOT;

/** Sortie d'outillage — jamais 0, jamais 1 : lire est un préalable, pas un verdict. */
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
 * Lit les membres de propriété NOMMÉS d'une interface. Les signatures d'index
 * (`[key: string]: unknown`) sont ignorées par construction : elles ne nomment rien.
 *
 * ⚠️ Une clause `extends` fait REFUSER la lecture, et ce n'est pas de la rigidité. Cette
 * fonction n'itère que `node.members` : un membre hérité lui est invisible. Sans ce refus,
 * écrire `interface GeoLeafGlobal extends GeoLeafTopLevelApi` ferait disparaître des membres
 * de la vue de TOUTES les gates qui l'appellent, sans un mot — elles rapporteraient une
 * surface plus étroite que la réalité et se desserreraient d'autant.
 *
 * @param {string} file - Chemin absolu du fichier `.ts`/`.d.ts`.
 * @param {string} interfaceName - Nom de l'interface à lire.
 * @param {{ tag?: string, withTypes?: boolean }} [opts] - `tag` préfixe les erreurs ;
 *   `withTypes` rend une `Map<string, string>` (nom → texte du type) au lieu d'un `Set`.
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
 * Lit un `export const X = ["a", "b", …]` de niveau racine et rend l'ensemble de ses valeurs.
 *
 * Cinq causes de refus, toutes en exit 2 — les trois dernières sont la moitié « rétrécissement
 * silencieux » du bug de regex décrit en tête de fichier :
 *
 *   • fichier absent
 *   • symbole absent, renommé ou déplacé hors d'un `export const` racine
 *   • symbole trouvé mais plus exporté
 *   • initialiseur qui n'est pas un tableau littéral
 *   • élément qui n'est pas une chaîne littérale (spread, gabarit, référence)
 *
 * @param {string} file - Chemin absolu du module.
 * @param {string} symbol - Nom du `export const`.
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
