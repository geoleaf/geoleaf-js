#!/usr/bin/env node
"use strict";
/**
 * E2E-WAIT-SIG — un `waitForFunction` dont le timeout part en 2ᵉ position est IGNORÉ.
 *
 * ## La classe que cette gate ferme, et pourquoi elle valait 41 sites
 *
 * La signature Playwright est `waitForFunction(pageFunction, arg, options)`. Il n'existe
 * AUCUNE surcharge à deux arguments où le second serait les options — vérifié dans
 * `node_modules/playwright-core/types/types.d.ts`. Écrire :
 *
 *     await page.waitForFunction(() => window.__x === true, { timeout: 30000 });
 *
 * passe donc `{ timeout: 30000 }` comme ARGUMENT de la fonction de page. Le timeout demandé
 * est silencieusement perdu, et l'attente retombe sur `actionTimeout`
 * (`playwright.config.js` — cette gate LIT la valeur et l'imprime, elle ne la recopie pas :
 * elle a valu 10 s jusqu'au 01/08/2026, puis 30 s, et le chiffre avait déjà divergé
 * dans neuf commentaires du dépôt le jour où il a bougé).
 *
 * ⚠️ CE N'EST PAS COSMÉTIQUE — mesuré le 01/08/2026 sur les 41 sites du dépôt, **quand
 * `actionTimeout` valait encore 10 s** (chiffres figés à cette date, ne pas réactualiser) :
 *
 *     28 sites déclaraient 15, 20, 25 ou 30 s  →  ils recevaient 10 s
 *      6 sites déclaraient 5 ou 8 s            →  ils recevaient 10 s
 *      5 sites déclaraient exactement 10 s     →  sans effet
 *
 * Vingt-huit attentes tronquées à un tiers de ce que leur auteur avait demandé, sur une
 * suite dont la CI met 1 h là où ce poste met 12 min. C'est une cause directe de rouges
 * distants, et elle était invisible : le code se lit juste.
 *
 * ⚠️ ET LE DÉPÔT CONNAISSAIT LE PIÈGE. `e2e/20-geocoding.spec.js` porte depuis longtemps le
 * commentaire qui l'explique. La leçon avait été apprise SUR UNE SPEC et jamais généralisée —
 * c'est très exactement ce qu'une gate empêche, et ce qu'un commentaire ne peut pas.
 *
 * ⚠️ Corollaire à connaître avant de « réparer » un site isolé : rétablir la signature
 * REND le budget déclaré. Sur un site qui déclarait MOINS que `actionTimeout`, cela
 * RACCOURCIT le budget effectif et rend l'échec plus fréquent. Signature et budget se
 * corrigent ensemble (voir B-99 / B-100).
 *
 * ## Pourquoi un découpage d'arguments et pas une regex
 *
 * Ma première mesure, par regex sur les 500 caractères suivants, a compté **49** sites
 * piégés là où il y en avait **42**. Sept faux positifs sur une classe de quarante : le
 * chiffre était inutilisable pour décider. Cette gate découpe donc les arguments de PREMIER
 * NIVEAU en suivant les parenthèses, accolades et chaînes — un `{` dans un littéral de
 * chaîne ou une accolade imbriquée ne la trompe pas.
 *
 * ## La voir rougir
 *
 *     printf '\nawait page.waitForFunction(() => true, { timeout: 5000 });\n' >> e2e/07-boot-sequence.spec.js
 *     node scripts/check-e2e-wait-signature.cjs   # → E2E-WAIT-SIG, exit 1
 *
 * Usage : node scripts/check-e2e-wait-signature.cjs
 * Sortie : 0 si aucun site piégé, 1 sinon.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIRS = ["e2e", "e2e/helpers"];

/**
 * ⚠️ Plancher témoin. Une gate qui ne trouve AUCUN `waitForFunction` à inspecter sortirait
 * verte en n'ayant rien lu — le mode d'échec que ce dépôt traque partout. Délibérément sous
 * la mesure du jour (83 appels) : il détecte un effondrement du corpus, pas une unité.
 */
const MIN_CALLS = 40;

const C = { r: "\x1b[31m", g: "\x1b[32m", d: "\x1b[2m", b: "\x1b[1m", x: "\x1b[0m" };

/**
 * Découpe les arguments de premier niveau d'un appel, en suivant les délimiteurs.
 *
 * @param {string} src Source complète.
 * @param {number} open Index de la parenthèse ouvrante.
 * @returns {string[]} Les arguments, tels quels.
 */
function callArgs(src, open) {
    let depth = 0;
    let quote = null;
    let start = open + 1;
    const out = [];
    for (let i = open; i < src.length; i++) {
        const c = src[i];
        if (quote) {
            if (c === quote && src[i - 1] !== "\\") quote = null;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") {
            quote = c;
            continue;
        }
        if ("([{".includes(c)) depth++;
        else if (")]}".includes(c)) {
            depth--;
            if (depth === 0) {
                out.push(src.slice(start, i));
                return out;
            }
        } else if (c === "," && depth === 1) {
            out.push(src.slice(start, i));
            start = i + 1;
        }
    }
    return out;
}

/**
 * Lit `actionTimeout` dans `playwright.config.js` — le budget sur lequel retombe un site piégé.
 *
 * ⚠️ Lu, jamais recopié. Le 01/08/2026 cette valeur est passée de 10 s à 30 s et **neuf**
 * commentaires du dépôt affirmaient encore « 10 s » — dans un dépôt dont la règle est qu'un
 * chiffre qu'une commande imprime ne se recopie pas en prose. Les lignes `//` sont retirées
 * avant lecture : le docblock voisin cite les deux valeurs en texte.
 *
 * @returns {number|null} Le budget en ms, ou `null` si la config ne se lit pas.
 */
function readActionTimeout() {
    try {
        const src = fs
            .readFileSync(path.join(ROOT, "playwright.config.js"), "utf8")
            .replace(/^\s*\/\/.*$/gm, "");
        const m = src.match(/actionTimeout:\s*([0-9]+)(?:\s*\*\s*([0-9]+))?/);
        if (!m) return null;
        return Number(m[1]) * (m[2] ? Number(m[2]) : 1);
    } catch {
        return null;
    }
}

function main() {
    const files = [];
    for (const d of DIRS) {
        const abs = path.join(ROOT, d);
        if (!fs.existsSync(abs)) continue;
        for (const f of fs.readdirSync(abs)) {
            if (/\.(js|cjs|ts)$/.test(f)) files.push(path.join(d, f));
        }
    }

    let calls = 0;
    const trapped = [];
    for (const rel of files) {
        const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
        let i = -1;
        while ((i = src.indexOf("waitForFunction(", i + 1)) !== -1) {
            calls++;
            const args = callArgs(src, i + "waitForFunction".length);
            if (args.length === 2 && /^\s*\{[\s\S]*timeout\s*:/.test(args[1])) {
                const line = src.slice(0, i).split("\n").length;
                const declared = (args[1].match(/timeout\s*:\s*([0-9_]+)/) || [, "?"])[1];
                trapped.push({ rel, line, declared: declared.replace(/_/g, "") });
            }
        }
    }

    const actionTimeout = readActionTimeout();
    const budget = actionTimeout === null ? "illisible" : `${actionTimeout} ms`;

    console.log(`${C.b}── E2E-WAIT-SIG ──${C.x}`);
    console.log(`  ${files.length} fichier(s), ${calls} appel(s) à waitForFunction inspectés`);
    console.log(`  ${C.d}actionTimeout lu dans playwright.config.js : ${budget}${C.x}`);

    if (calls < MIN_CALLS) {
        console.log(
            `\n${C.r}✗ E2E-WAIT-SIG — témoin en échec : ${calls} appels (plancher ${MIN_CALLS}).${C.x}`
        );
        console.log(
            `  ${C.d}REFUSE DE CONCLURE. Un « 0 site piégé » sur un corpus effondré serait vrai\n` +
                `  et vide de sens — le périmètre a dû changer, pas le code.${C.x}`
        );
        process.exit(1);
    }

    if (!trapped.length) {
        console.log(`\n${C.g}✓ E2E-WAIT-SIG — aucun timeout perdu en 2ᵉ position.${C.x}`);
        process.exit(0);
    }

    console.log(
        `\n${C.r}✗ E2E-WAIT-SIG — ${trapped.length} site(s) dont le timeout est IGNORÉ${C.x}\n`
    );
    for (const t of trapped) {
        const sens =
            actionTimeout !== null && Number(t.declared) < actionTimeout
                ? ` ${C.r}(RACCOURCIRA de ${actionTimeout} à ${t.declared} ms une fois réparé)${C.x}`
                : "";
        console.log(`  • ${t.rel}:${t.line} — déclare ${t.declared} ms, reçoit ${budget}${sens}`);
    }
    console.log(
        `\n  ${C.d}La signature est \`waitForFunction(pageFunction, arg, options)\`. Passer\n` +
            `  \`{ timeout }\` en 2ᵉ position en fait un ARGUMENT de la fonction de page.\n` +
            `  Correctif : \`, null, { timeout }\`.\n` +
            `  ⚠️ Sur un site qui déclare MOINS que actionTimeout (${budget}), rétablir la\n` +
            `  signature RACCOURCIT son budget effectif — relever la valeur dans le même geste.${C.x}`
    );
    process.exit(1);
}

if (require.main === module) {
    main();
}
