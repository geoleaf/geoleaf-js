#!/usr/bin/env node
/**
 * @fileoverview EXACT-OPTIONAL-DEBT — le cliquet qui empêche `exactOptionalPropertyTypes`
 * d'être soldé par élargissement de type.
 *
 * ## Pourquoi cette gate existe
 *
 * Le sprint qualité Q4 a activé `exactOptionalPropertyTypes` et soldé **95 erreurs**. Chacune
 * pouvait se corriger de deux façons opposées :
 *
 *   1. **Élargir la cible** — `prop?: T` devient `prop?: T | undefined`. Une ligne, le
 *      compilateur se tait… et la propriété retrouve EXACTEMENT la sémantique qu'elle avait
 *      avant l'option. Zéro garantie achetée, deux jours dépensés.
 *   2. **Corriger le site** — insertion conditionnelle, ou défaut appliqué chez le producteur.
 *      La propriété est réellement absente quand elle est absente, donc un
 *      `{...defauts, ...profil}` cesse de pouvoir écraser un défaut avec `undefined`.
 *
 * Les 95 ont été soldées par (2), **sans un seul élargissement**. Rien, ensuite, ne
 * distingue un `?: T | undefined` légitime et commenté d'un `?: T | undefined` posé pour
 * faire taire `tsc` — c'est le mode d'échec n°5 de `CLAUDE.md` : « un chiffre qu'on ne peut
 * pas re-mesurer ne se périme pas, il se fossilise ». D'où ce cliquet, sur le modèle de
 * MH-02 (`check-module-headers.cjs`) et TSD-04 (`check-tsdoc-conformity.cjs`) : *sans quoi
 * une baseline est un permis, pas un registre de dette.*
 *
 * ## Les trois règles
 *
 *   EOD-01  Toute propriété optionnelle dont le type PROPRE contient `undefined`
 *           (`prop?: T | undefined`) doit figurer dans la baseline. Une nouvelle est une
 *           erreur : elle ne peut pas naître en dette.
 *   EOD-02  La baseline ne peut que RÉTRÉCIR. Une entrée dont la propriété a disparu, ou
 *           n'est plus élargie, est une erreur tant qu'elle n'est pas retirée.
 *   EOD-03  Le corpus ne peut pas être vide. Une gate qui sort verte en n'ayant rien
 *           scanné est le pire des résultats (même classe que les modes d'échec listés
 *           dans `typecheck-docs-examples.cjs`).
 *
 * ## Deux décisions de conception, chacune motivée par un défaut MESURÉ
 *
 * **AST, jamais grep.** Un `grep` sur `?:` + `| undefined` remonte **83 lignes** sur ce
 * dépôt ; la visite AST en trouve **0**. Les 83 sont des casts (`as {x?: T} | undefined`)
 * et des unions de PARAMÈTRES (`onToggle?: (id: string | undefined) => void`) — le `?` et
 * le `| undefined` y appartiennent à deux constructions différentes. Un plafond fondé sur
 * ce grep aurait autorisé 21 élargissements gratuits, plus que le sprint n'en produisait :
 * le contrôle aurait été inerte de bout en bout.
 * Second défaut, causé par le geste même qu'on surveille : `.prettierrc.json` porte
 * `printWidth: 100` et `lint-staged` lance `prettier --write` à chaque commit. Ajouter
 * ` | undefined` à une déclaration de 92 caractères la casse en multi-lignes — mesuré,
 * **212 propriétés** basculeraient. Un compteur ligne-à-ligne devient donc aveugle
 * exactement quand l'édition qu'il surveille est faite.
 *
 * **Périmètre dérivé du registre.** `scripts/lib/packages.cjs`, jamais un glob
 * `packages/<nom>` en dur. Le glob naïf `packages/*\/src` ne matche NI `packages/plugins/*`
 * NI `packages/libs/*` — 15 des 17 paquets, donc la totalité des plugins, seraient hors
 * compteur sans que rien ne rougisse. C'est la classe que `probe-gate-visibility.cjs`
 * surveille.
 *
 * ## Usage
 *
 *        node scripts/check-exact-optional-debt.cjs
 *        node scripts/check-exact-optional-debt.cjs --update-baseline
 *
 * ⚠️ `--update-baseline` se lance APRÈS avoir corrigé, jamais pour faire taire. Chaque
 * entrée ajoutée doit porter, dans le code, un commentaire nommant le consommateur
 * (`chemin:ligne`) pour lequel « absent » et « présent valant `undefined` » sont vraiment
 * équivalents.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const registry = require("./lib/packages.cjs");

const ROOT = path.resolve(__dirname, "..");
const BASELINE = path.join(ROOT, "scripts", ".baselines", "exact-optional-debt.json");
const UPDATE = process.argv.includes("--update-baseline");

const SKIP_DIRS = new Set(["__tests__", "node_modules", "dist", "coverage"]);

/**
 * Les répertoires `src/` de tous les paquets du registre, y compris ceux hors `workspaces`
 * (le scaffold `_plugin-template` hérite du même tsconfig de base, donc de l'option).
 *
 * @returns {string[]} chemins absolus existants
 */
function sourceRoots() {
    return registry
        .all()
        .map((pkg) => path.join(ROOT, pkg.dir, "src"))
        .filter((dir) => fs.existsSync(dir));
}

/**
 * @param {string} dir
 * @param {string[]} out
 * @returns {string[]} les `.ts` du sous-arbre, tests et artefacts exclus
 */
function collectTs(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            collectTs(full, out);
        } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
            out.push(full);
        }
    }
    return out;
}

/**
 * Une propriété est « élargie » quand elle porte À LA FOIS le `?` et un `undefined` dans son
 * PROPRE type. Le type d'un paramètre de callback ne compte pas : c'est un nœud différent.
 *
 * @param {import("typescript").Node} node
 * @returns {boolean}
 */
function isWidenedOptional(node) {
    if (!ts.isPropertySignature(node) && !ts.isPropertyDeclaration(node)) return false;
    if (!node.questionToken || !node.type) return false;
    if (!ts.isUnionTypeNode(node.type)) return false;
    return node.type.types.some((t) => t.kind === ts.SyntaxKind.UndefinedKeyword);
}

/**
 * Clé stable, SANS numéro de ligne — une insertion en amont ne doit pas périmer l'entrée.
 * Même raisonnement que `diagnosticKey()` dans `typecheck-docs-examples.cjs`.
 *
 * @param {string} rel
 * @param {string} owner conteneur (interface / classe / `<module>`)
 * @param {string} prop
 * @returns {string}
 */
const entryKey = (rel, owner, prop) => `${rel}::${owner}::${prop}`;

/** @returns {string[]} les sites élargis trouvés dans le corpus */
function scan() {
    const found = [];
    let scanned = 0;

    for (const root of sourceRoots()) {
        for (const file of collectTs(root)) {
            scanned++;
            const rel = path.relative(ROOT, file).split(path.sep).join("/");
            const sf = ts.createSourceFile(
                file,
                fs.readFileSync(file, "utf8"),
                ts.ScriptTarget.ES2022,
                true
            );

            const visit = (node) => {
                if (isWidenedOptional(node)) {
                    const owner =
                        node.parent && node.parent.name ? node.parent.name.getText() : "<module>";
                    found.push(entryKey(rel, owner, node.name.getText()));
                }
                ts.forEachChild(node, visit);
            };
            visit(sf);
        }
    }
    return { found: [...new Set(found)].sort(), scanned };
}

const { found, scanned } = scan();

// ── EOD-03 — une gate qui n'a rien scanné n'a rien prouvé ────────────────────────────────
if (scanned === 0) {
    console.error("ERROR [EXACT-OPTIONAL-DEBT/EOD-03]: corpus vide — 0 fichier scanné.");
    console.error("  Le registre de paquets ne résout aucun `src/`. La gate ne garde rien.");
    process.exit(2);
}

if (UPDATE) {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(
        BASELINE,
        // Indentation 4 : Prettier possède `scripts/**/*.json` en `tabWidth: 4` et
        // reformaterait tout le fichier au commit, rendant illisible le retrait d'une ligne.
        JSON.stringify(
            {
                _comment:
                    "EXACT-OPTIONAL-DEBT — propriétés élargies en `?: T | undefined`, gelées. " +
                    "Cette liste ne peut que RÉTRÉCIR (EOD-02). Régénérer avec --update-baseline " +
                    "UNIQUEMENT après avoir corrigé, jamais pour faire taire. Chaque entrée doit " +
                    "porter dans le code un commentaire nommant le consommateur pour lequel " +
                    "« absent » et « présent valant undefined » sont équivalents.",
                _generated: "node scripts/check-exact-optional-debt.cjs --update-baseline",
                count: found.length,
                entries: found,
            },
            null,
            4
        ) + "\n"
    );
    console.log(`✅ [EXACT-OPTIONAL-DEBT] baseline régénérée — ${found.length} entrée(s).`);
    process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
    // Une baseline absente n'est PAS une liste vide : ce serait déclarer propre toute la
    // surface. Même refus que `check-namespace-typing-coverage.cjs`.
    console.error("ERROR [EXACT-OPTIONAL-DEBT]: baseline absente.");
    console.error("  Run: node scripts/check-exact-optional-debt.cjs --update-baseline");
    process.exit(2);
}

const baseline = new Set(JSON.parse(fs.readFileSync(BASELINE, "utf8")).entries);
const seen = new Set(found);

const fresh = found.filter((k) => !baseline.has(k)); // EOD-01
const stale = [...baseline].filter((k) => !seen.has(k)).sort(); // EOD-02

const bar = "─".repeat(72);
console.log(bar);

if (fresh.length === 0 && stale.length === 0) {
    console.log(
        `✅ [EXACT-OPTIONAL-DEBT] ${found.length} élargissement(s) — baseline à jour ` +
            `(${scanned} fichiers, ${sourceRoots().length} paquets).`
    );
    console.log(bar);
    process.exit(0);
}

if (fresh.length > 0) {
    console.error(`❌ [EXACT-OPTIONAL-DEBT/EOD-01] ${fresh.length} élargissement(s) NOUVEAU(X) :`);
    for (const k of fresh) console.error(`     + ${k}`);
    console.error(
        "\n  `?: T | undefined` rend à la propriété la sémantique d'avant l'option : la clé peut\n" +
            "  redevenir présente valant `undefined`, donc écraser un défaut dans un merge par spread.\n" +
            "  Corriger le SITE (insertion conditionnelle, ou défaut appliqué chez le producteur)\n" +
            "  plutôt que la cible. Si l'élargissement est réellement justifié, commenter le site en\n" +
            "  nommant son consommateur, puis --update-baseline."
    );
}

if (stale.length > 0) {
    console.error(`\n❌ [EXACT-OPTIONAL-DEBT/EOD-02] ${stale.length} entrée(s) PÉRIMÉE(S) :`);
    for (const k of stale) console.error(`     - ${k}`);
    console.error("\n  Ces propriétés ne sont plus élargies (ou n'existent plus). Les retirer :");
    console.error("  node scripts/check-exact-optional-debt.cjs --update-baseline");
}

console.log(bar);
process.exit(1);
