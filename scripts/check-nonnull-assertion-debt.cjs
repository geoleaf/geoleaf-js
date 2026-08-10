#!/usr/bin/env node
/**
 * @fileoverview NONNULL-ASSERTION-DEBT — le cliquet qui empêche `noUncheckedIndexedAccess`
 * d'être soldé par des assertions de complaisance.
 *
 * ## Pourquoi cette gate existe
 *
 * Le sprint qualité Q5 a activé `noUncheckedIndexedAccess` et soldé **391 erreurs**. Le Lot 0
 * a mesuré, à la sonde (`eslint --stdin --rule '{"complexity":["warn",0]}'`), le coût en
 * complexité cyclomatique de chaque forme de correctif :
 *
 *        arr[i]!                        +0     ← INTERDIT
 *        garde `if`                     +1
 *        `??`                           +1
 *        `?.`                           +1
 *        ternaire                       +1
 *        déstructuration avec défaut    +1 par liaison
 *        `for..of` remplaçant une boucle indexée   0 net
 *
 * **Le seul correctif à coût nul est celui qu'il faut proscrire**, et `complexity:
 * ["error", 20]` (`eslint.config.mjs`) est un cliquet à sens unique : la pression pousse
 * structurellement vers l'assertion. Ce n'est pas une hypothèse — Q4 l'a vérifié sur pièce,
 * `offline/install.ts:72` a été corrigé une première fois par un `asObject(...)!`, retiré
 * avant commit. D'où ce cliquet, sur le modèle de EOD-02 (`check-exact-optional-debt.cjs`),
 * MH-02 et TSD-04 : *sans quoi une baseline est un permis, pas un registre de dette.*
 *
 * ## Les quatre règles
 *
 *   NNA-04  **Zéro `!` sur une lecture indexée** (`arr[i]!`, `obj[k]!`) — sans baseline et
 *           sans exception. Une lecture indexée assertée EST une erreur
 *           `noUncheckedIndexedAccess` qu'on a fait taire : le sweep sort vert parce que le
 *           `!` est là. C'est la règle qui rend le palier vrai, et la seule sans échappatoire.
 *   NNA-01  Toute AUTRE assertion `!` ou `as unknown` doit figurer dans la baseline. Une
 *           nouvelle est une erreur : elle ne peut pas naître en dette.
 *   NNA-02  La baseline ne peut que RÉTRÉCIR. Une entrée qui a disparu du code est une
 *           erreur tant qu'elle n'est pas retirée du fichier.
 *   NNA-03  Le corpus ne peut pas être vide. Une gate verte qui n'a rien scanné est le pire
 *           des résultats (même classe que EOD-03 et que les modes d'échec de
 *           `typecheck-docs-examples.cjs`).
 *
 * ## Trois décisions de conception, chacune motivée par un défaut MESURÉ
 *
 * **AST, jamais grep.** Le pré-vol de Q5.4 annonçait « 130 assertions `!` », mesurées par
 * une lecture de texte. La visite AST en trouve **192**, soit 47 % de plus — et surtout,
 * elle seule sait CLASSER : sur ces 192, exactement **10** portaient sur une lecture
 * indexée, les 182 autres échappant à `strictNullChecks` (palier Q3), pas à celui-ci. Un
 * compteur qui ne distingue pas les deux natures aurait fait passer une purge de dette Q3
 * pour un travail Q5, ou l'inverse.
 *
 * **La distinction se fait sur la FORME de l'expression assertée**, pas sur le fichier ni
 * sur un commentaire : `ts.isElementAccessExpression(node.expression)` sépare `arr[i]!` de
 * `o.p!`, `x!` et `map.get(k)!` sans qu'aucune convention humaine ait à être respectée.
 *
 * **Périmètre dérivé du registre.** `scripts/lib/packages.cjs`, jamais un glob
 * `packages/<nom>` en dur. Le glob naïf `packages/*​/src` ne matche NI `packages/plugins/*`
 * NI `packages/libs/*` — la totalité des plugins serait hors compteur sans que rien ne
 * rougisse. C'est la classe que `probe-gate-visibility.cjs` surveille.
 *
 * ## Ce que cette gate NE garde pas
 *
 * Les 180 assertions résiduelles sont de la dette **Q3** (`strictNullChecks`), gelée et
 * nommée dans `_docs_projet/registres/dette_technique.md`. Leur décrue est un sprint à
 * part : la mêler à Q5 ferait un diff où l'on ne distingue plus ce que le palier a prouvé
 * de ce qu'on a nettoyé au passage.
 *
 * ## Usage
 *
 *        node scripts/check-nonnull-assertion-debt.cjs
 *        node scripts/check-nonnull-assertion-debt.cjs --update-baseline
 *
 * ⚠️ `--update-baseline` se lance APRÈS avoir corrigé, jamais pour faire taire. Et il ne
 * peut RIEN faire pour NNA-04, qui n'a pas de baseline.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const registry = require("./lib/packages.cjs");

const ROOT = path.resolve(__dirname, "..");
const BASELINE = path.join(ROOT, "scripts", ".baselines", "nonnull-assertion-debt.json");
const UPDATE = process.argv.includes("--update-baseline");

const SKIP_DIRS = new Set(["__tests__", "__mocks__", "node_modules", "dist", "coverage"]);

/**
 * Les répertoires `src/` de tous les paquets du registre.
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
 * @returns {string[]} les `.ts` du sous-arbre, tests et déclarations exclus
 */
function collectTs(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            collectTs(full, out);
        } else if (
            (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
            !entry.name.endsWith(".d.ts") &&
            !/\.(test|spec)\./.test(entry.name)
        ) {
            out.push(full);
        }
    }
    return out;
}

/**
 * Nom de la fonction ou du membre englobant — sert de coordonnée stable dans la clé, à la
 * place du numéro de ligne, qu'une insertion en amont périmerait.
 *
 * @param {import("typescript").Node} node
 * @param {import("typescript").SourceFile} sf
 * @returns {string}
 */
function enclosingName(node, sf) {
    for (let cur = node.parent; cur; cur = cur.parent) {
        if (
            (ts.isFunctionDeclaration(cur) ||
                ts.isMethodDeclaration(cur) ||
                ts.isPropertyDeclaration(cur) ||
                ts.isVariableDeclaration(cur) ||
                ts.isGetAccessor(cur) ||
                ts.isSetAccessor(cur)) &&
            cur.name
        ) {
            return cur.name.getText(sf);
        }
        if (ts.isConstructorDeclaration(cur)) return "constructor";
    }
    return "<module>";
}

/**
 * Clé stable, SANS numéro de ligne. Même raisonnement que `entryKey()` dans
 * `check-exact-optional-debt.cjs` et `diagnosticKey()` dans `typecheck-docs-examples.cjs`.
 *
 * @param {string} rel
 * @param {string} owner
 * @param {string} kind `!` ou `as-unknown`
 * @param {string} text expression assertée, tronquée
 * @returns {string}
 */
const entryKey = (rel, owner, kind, text) => `${rel}::${owner}::${kind}::${text}`;

/**
 * @returns {{ debt: string[], indexed: string[], scanned: number }} `debt` = les assertions
 *   gelables (NNA-01/02) ; `indexed` = les `arr[i]!`, qui n'ont pas de baseline (NNA-04)
 */
function scan() {
    const debt = [];
    const indexed = [];
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
                if (ts.isNonNullExpression(node)) {
                    const owner = enclosingName(node, sf);
                    const text = node.expression.getText(sf).replace(/\s+/g, " ").slice(0, 60);
                    if (ts.isElementAccessExpression(node.expression)) {
                        // NNA-04 : la ligne EST utile ici, l'entrée n'est jamais gelée.
                        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
                        indexed.push(`${rel}:${line} — ${text}!`);
                    } else {
                        debt.push(entryKey(rel, owner, "!", text));
                    }
                }
                if (ts.isAsExpression(node) && node.type.kind === ts.SyntaxKind.UnknownKeyword) {
                    const owner = enclosingName(node, sf);
                    const text = node.expression.getText(sf).replace(/\s+/g, " ").slice(0, 60);
                    debt.push(entryKey(rel, owner, "as-unknown", text));
                }
                ts.forEachChild(node, visit);
            };
            visit(sf);
        }
    }
    return { debt: [...new Set(debt)].sort(), indexed: indexed.sort(), scanned };
}

const { debt, indexed, scanned } = scan();
const bar = "─".repeat(72);

// ── NNA-03 — une gate qui n'a rien scanné n'a rien prouvé ────────────────────────────────
if (scanned === 0) {
    console.error("ERROR [NONNULL-ASSERTION-DEBT/NNA-03]: corpus vide — 0 fichier scanné.");
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
                    "NONNULL-ASSERTION-DEBT — assertions `!` et `as unknown` gelées. Cette " +
                    "liste ne peut que RÉTRÉCIR (NNA-02). Elle NE contient PAS les `arr[i]!` : " +
                    "ceux-là sont interdits sans exception (NNA-04), parce qu'une lecture " +
                    "indexée assertée est une erreur `noUncheckedIndexedAccess` qu'on a tue. " +
                    "Le reste est de la dette `strictNullChecks` (palier Q3), instruite dans " +
                    "_docs_projet/registres/dette_technique.md. Régénérer avec " +
                    "--update-baseline UNIQUEMENT après avoir corrigé, jamais pour faire taire.",
                _generated: "node scripts/check-nonnull-assertion-debt.cjs --update-baseline",
                count: debt.length,
                entries: debt,
            },
            null,
            4
        ) + "\n"
    );
    console.log(`✅ [NONNULL-ASSERTION-DEBT] baseline régénérée — ${debt.length} entrée(s).`);
    process.exit(0);
}

// ── NNA-04 — pas de baseline, pas d'exception ────────────────────────────────────────────
if (indexed.length > 0) {
    console.log(bar);
    console.error(
        `❌ [NONNULL-ASSERTION-DEBT/NNA-04] ${indexed.length} lecture(s) indexée(s) assertée(s) :`
    );
    for (const site of indexed) console.error(`     ${site}`);
    console.error(
        "\n  Un `arr[i]!` fait taire une erreur `noUncheckedIndexedAccess` : le sweep sort\n" +
            "  vert PARCE QUE l'assertion est là. Corriger le site — `for..of` ou `.entries()`\n" +
            "  quand la lecture est dans une boucle (coût nul), une garde qui narrow un local\n" +
            "  relu sinon. Cette règle n'a pas de baseline, par construction."
    );
    console.log(bar);
    process.exit(1);
}

if (!fs.existsSync(BASELINE)) {
    // Une baseline absente n'est PAS une liste vide : ce serait déclarer propre toute la
    // surface. Même refus que `check-exact-optional-debt.cjs`.
    console.error("ERROR [NONNULL-ASSERTION-DEBT]: baseline absente.");
    console.error("  Run: node scripts/check-nonnull-assertion-debt.cjs --update-baseline");
    process.exit(2);
}

const baseline = new Set(JSON.parse(fs.readFileSync(BASELINE, "utf8")).entries);
const seen = new Set(debt);

const fresh = debt.filter((k) => !baseline.has(k)); // NNA-01
const stale = [...baseline].filter((k) => !seen.has(k)).sort(); // NNA-02

console.log(bar);

if (fresh.length === 0 && stale.length === 0) {
    console.log(
        `✅ [NONNULL-ASSERTION-DEBT] 0 \`arr[i]!\` (NNA-04) · ${debt.length} assertion(s) gelée(s) ` +
            `— baseline à jour (${scanned} fichiers, ${sourceRoots().length} paquets).`
    );
    console.log(bar);
    process.exit(0);
}

if (fresh.length > 0) {
    console.error(`❌ [NONNULL-ASSERTION-DEBT/NNA-01] ${fresh.length} assertion(s) NOUVELLE(S) :`);
    for (const k of fresh) console.error(`     + ${k}`);
    console.error(
        "\n  Une assertion ne peut pas NAÎTRE en dette. Corriger le site, ou — si le contrat\n" +
            "  la justifie vraiment — la geler explicitement avec --update-baseline, en\n" +
            "  motivant sur place."
    );
}

if (stale.length > 0) {
    console.error(
        `\n❌ [NONNULL-ASSERTION-DEBT/NNA-02] ${stale.length} entrée(s) de baseline sans site :`
    );
    for (const k of stale) console.error(`     - ${k}`);
    console.error(
        "\n  Ces assertions ont disparu du code — c'est une bonne nouvelle, mais la baseline\n" +
            "  doit l'enregistrer : `--update-baseline`. Une baseline qui garde des entrées\n" +
            "  mortes cesse de mesurer la dette réelle."
    );
}

console.log(bar);
process.exit(1);
