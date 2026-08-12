#!/usr/bin/env node
/**
 * AMBIENT-TYPES: publie le namespace global `GeoLeaf` avec le paquet (backlog B-46).
 *
 * ## Le défaut que ce script ferme
 *
 * `@geoleaf/core` ne publiait **pas son propre namespace global**. Un intégrateur qui écrit
 * la forme que toute la documentation enseigne —
 *
 *     GeoLeaf.Core.setTheme("dark");
 *
 * — obtenait **`TS2304: Cannot find name 'GeoLeaf'`** contre `dist/types/`, le `types`
 * déclaré du paquet. Mesuré et prouvé par compilation le 27/07/2026.
 *
 * ## Pourquoi ce n'était pas un oubli de configuration
 *
 * `tsconfig.declarations.json` porte bien `"include": ["src/**\/*"]`, donc `src/global.d.ts`
 * EST dans le périmètre. Mais **TypeScript ne ré-émet pas un `.d.ts` d'entrée** : un fichier
 * de déclaration est une *entrée*, pas une *source*, et `emitDeclarationOnly` le saute. Le
 * résultat était silencieux — `find dist -name global.d.ts` rendait 0, sans le moindre
 * avertissement du compilateur. Aucune quantité de réglage de `tsconfig` n'y change quoi que
 * ce soit ; il faut copier le fichier.
 *
 * ## Ce que ce script fait, et pourquoi dans cet ordre
 *
 * 1. Copie `src/global.d.ts` → `dist/types/global.d.ts`. Ses références de type sont des
 *    `import("./api/geoleaf.*.js")` **relatives** : elles résolvent donc vers les `.d.ts`
 *    émis à côté, sans réécriture.
 * 2. Préfixe **chaque entrée de types déclarée par la carte `exports`** d'un
 *    `/// <reference path="<…>/global.d.ts" />`. C'est ce qui tire le fichier dans le
 *    programme du consommateur : `global.d.ts` est un **module** (`export {}`) portant un
 *    `declare global`, donc son augmentation ne s'applique que s'il est inclus.
 *
 * ⚠️ **Le fait que ce soit un script et non une option de build est le sujet.** Un
 * `tsconfig` ne sait pas exprimer « recopie cette déclaration » ; l'écrire ici le rend
 * visible, testable et daté, au lieu d'être une case cochée quelque part.
 *
 * ## 🛑 Pourquoi TOUTES les entrées, et pas seulement `"."` (B-231, 12/08/2026)
 *
 * Ce script n'a préfixé que `bundle-esm-entry.d.ts` — l'entrée `"."` — jusqu'au 12/08/2026,
 * et **la recette que ce dépôt RECOMMANDE ne passe pas par elle**. Un intégrateur qui importe
 * des sous-chemins (`@geoleaf/core/kernel`, `@geoleaf/core/capabilities/<id>/install.js`),
 * c'est-à-dire ce que le tree-shaking exige et ce qu'`examples/consumer/entry.ts` incarne, ne
 * chargeait jamais l'ambient.
 *
 * Mesuré par la tâche 10.8, sur tarballs packés dans un répertoire vierge, `skipLibCheck`
 * désactivé : **11 erreurs** — `GeoLeafGlobal` (9 sites), `GeoLeafUIFacade`,
 * `GeoLeafThemeSelector`. Avec `skipLibCheck: true`, le réglage de la quasi-totalité des
 * projets, la même compilation rend **exit 0**.
 *
 * ⚠️ **Et le monorepo ne pouvait pas le voir.** Le docblock affirmait ici que la preuve
 * vivait dans `examples/consumer/published-types.ts` — or ce fichier **importe l'entrée
 * `"."`**, ce qui tire l'ambient et masque le défaut pour TOUT le programme, y compris pour
 * `entry.ts` compilé à ses côtés. La preuve invoquée était donc précisément ce qui empêchait
 * de voir. C'est `entry.ts` SEUL, hors monorepo, qui juge.
 *
 * ## Ce que ce script REFUSE de faire
 *
 * Il ne « saute pas silencieusement » quand la source ou une cible manque : il sort en 1 et
 * le dit. Un post-build muet qui ne trouve rien reproduirait exactement le défaut qu'il
 * corrige — un artefact absent dont personne n'est prévenu. Même posture que
 * `verify-repo-hygiene` et `probe-gate-visibility` sur cette classe.
 *
 * Il refuse aussi de tourner sur **zéro entrée** : une carte `exports` qui cesserait de
 * déclarer des conditions `types` le rendrait vert en ne préfixant rien.
 *
 * Usage: node scripts/emit-ambient-types.cjs   (post-build de @geoleaf/core)
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const registry = require("./lib/packages.cjs");

const CORE = registry.requireByDirName("core");
const SRC = path.join(CORE.absDir, "src", "global.d.ts");
const OUT_DIR = path.join(CORE.absDir, "dist", "types");
const OUT = path.join(OUT_DIR, "global.d.ts");

function fail(msg) {
    console.error(`❌ [AMBIENT-TYPES] ${msg}`);
    process.exit(1);
}

/**
 * Les `.d.ts` d'entrée que la carte `exports` expose, DÉRIVÉS d'elle et jamais listés ici.
 *
 * Une liste écrite à la main divergerait au premier sous-chemin ajouté — et divergerait en
 * silence, puisque rien en aval ne compile ces entrées séparément. Les globs (`./capabilities/*`)
 * sont expansés sur le disque.
 *
 * @returns {string[]} Chemins absolus, dédoublonnés, triés.
 */
function entryDeclarationFiles() {
    const exportsMap = CORE.manifest.exports;
    if (!exportsMap || typeof exportsMap !== "object") {
        fail("`exports` absent ou non-objet dans packages/core/package.json.");
    }

    /** @type {Set<string>} */
    const found = new Set();
    for (const conditions of Object.values(exportsMap)) {
        const types = typeof conditions === "object" && conditions ? conditions.types : null;
        if (typeof types !== "string") continue;

        // `./dist/types/x.d.ts` → absolu ; un `*` est expansé sur le disque.
        const rel = types.replace(/^\.\//, "");
        if (!rel.includes("*")) {
            found.add(path.join(CORE.absDir, rel));
            continue;
        }
        const [prefix, suffix] = rel.split("*");
        const dir = path.join(CORE.absDir, path.dirname(prefix));
        if (!fs.existsSync(dir)) continue;
        for (const name of fs.readdirSync(dir)) {
            const abs = path.join(dir, name);
            if (abs.endsWith(suffix) && fs.statSync(abs).isFile()) found.add(abs);
        }
    }
    return [...found].sort();
}

/**
 * La directive à poser en tête de `file`, avec le chemin RELATIF vers `global.d.ts`.
 *
 * ⚠️ Le chemin dépend de la profondeur : `./global.d.ts` pour une entrée à la racine de
 * `dist/types/`, `../global.d.ts` pour `dist/types/api/…`. Un chemin figé casserait toutes
 * les entrées sauf celles d'un seul niveau — et casserait en silence, `tsc` ignorant une
 * `/// <reference>` dont la cible est introuvable.
 *
 * @param {string} file Chemin absolu du `.d.ts` d'entrée.
 * @returns {string}
 */
function referenceFor(file) {
    let rel = path.relative(path.dirname(file), OUT).split(path.sep).join("/");
    if (!rel.startsWith(".")) rel = `./${rel}`;
    return `/// <reference path="${rel}" />`;
}

if (!fs.existsSync(SRC)) {
    fail(`source absente : ${path.relative(registry.ROOT, SRC)}`);
}

fs.copyFileSync(SRC, OUT);

const entries = entryDeclarationFiles();
// Anti-gate-vide : zéro entrée signifie une carte `exports` qui a cessé de déclarer ses
// conditions `types`. Préfixer zéro fichier « réussirait » en ne faisant rien.
if (entries.length === 0) {
    fail(
        "aucune entrée de types dérivée de la carte `exports`.\n" +
            "   Ce script tourne APRÈS `tsc -p tsconfig.declarations.json`. Lancer `npm run build`."
    );
}

let prefixed = 0;
let already = 0;
const missing = [];

for (const file of entries) {
    if (file === OUT) continue; // `global.d.ts` ne se référence pas lui-même
    if (!fs.existsSync(file)) {
        missing.push(path.relative(CORE.absDir, file));
        continue;
    }
    const reference = referenceFor(file);
    const text = fs.readFileSync(file, "utf8");
    if (text.includes(reference)) {
        already++;
        continue;
    }
    fs.writeFileSync(file, `${reference}\n${text}`);
    prefixed++;
}

if (missing.length > 0) {
    fail(
        `${missing.length} entrée(s) de types déclarée(s) dans \`exports\` mais ABSENTE(S) du build :\n` +
            missing.map((m) => `     ${m}`).join("\n") +
            `\n   Une entrée déclarée et non émise est un sous-chemin qui ne résout pas chez l'intégrateur.`
    );
}

// Le contrôle qui compte : la déclaration est là, et CHAQUE entrée la tire.
const emitted = fs.existsSync(OUT) && /declare global/.test(fs.readFileSync(OUT, "utf8"));
const unreferenced = entries.filter(
    (f) => f !== OUT && !fs.readFileSync(f, "utf8").includes(referenceFor(f))
);
if (!emitted || unreferenced.length > 0) {
    fail(
        `état incohérent après écriture — émis: ${emitted}, ` +
            `${unreferenced.length} entrée(s) sans référence.\n` +
            `   Ne pas ignorer : c'est exactement le défaut que B-46 a fermé, et B-231 élargi.`
    );
}

console.log(
    `✅ [AMBIENT-TYPES] namespace global publié — dist/types/global.d.ts, ` +
        `référencé par ${entries.length - 1} entrée(s) de la carte \`exports\` ` +
        `(${prefixed} posée(s), ${already} déjà en place).`
);
