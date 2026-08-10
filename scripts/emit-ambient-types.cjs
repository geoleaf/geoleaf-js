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
 * 2. Préfixe l'entrée de types (`dist/types/bundle-esm-entry.d.ts`) d'un
 *    `/// <reference path="./global.d.ts" />`. C'est ce qui tire le fichier dans le programme
 *    du consommateur : `global.d.ts` est un **module** (`export {}`) portant un
 *    `declare global`, donc son augmentation ne s'applique que s'il est inclus.
 *
 * ⚠️ **Le fait que ce soit un script et non une option de build est le sujet.** Un
 * `tsconfig` ne sait pas exprimer « recopie cette déclaration » ; l'écrire ici le rend
 * visible, testable et daté, au lieu d'être une case cochée quelque part.
 *
 * ## Ce que ce script REFUSE de faire
 *
 * Il ne « saute pas silencieusement » quand la source ou la cible manque : il sort en 1 et
 * le dit. Un post-build muet qui ne trouve rien reproduirait exactement le défaut qu'il
 * corrige — un artefact absent dont personne n'est prévenu. Même posture que
 * `verify-repo-hygiene` et `probe-gate-visibility` sur cette classe.
 *
 * La preuve que ça marche n'est pas ici : c'est
 * `packages/core/examples/consumer/published-types.ts`, qui résout le paquet **par sa map
 * `exports`**, comme un intégrateur, et que `verify-published-types.cjs` compile.
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
const ENTRY = path.join(OUT_DIR, "bundle-esm-entry.d.ts");
const REFERENCE = '/// <reference path="./global.d.ts" />';

function fail(msg) {
    console.error(`❌ [AMBIENT-TYPES] ${msg}`);
    process.exit(1);
}

if (!fs.existsSync(SRC)) {
    fail(`source absente : ${path.relative(registry.ROOT, SRC)}`);
}
if (!fs.existsSync(ENTRY)) {
    fail(
        `entrée de types absente : ${path.relative(registry.ROOT, ENTRY)}\n` +
            `   Ce script tourne APRÈS \`tsc -p tsconfig.declarations.json\`. Lancer \`npm run build\`.`
    );
}

fs.copyFileSync(SRC, OUT);

const entryText = fs.readFileSync(ENTRY, "utf8");
if (!entryText.includes(REFERENCE)) {
    fs.writeFileSync(ENTRY, `${REFERENCE}\n${entryText}`);
}

// Le contrôle qui compte : la déclaration est-elle réellement là, et atteignable ?
const emitted = fs.existsSync(OUT) && /declare global/.test(fs.readFileSync(OUT, "utf8"));
const referenced = fs.readFileSync(ENTRY, "utf8").includes(REFERENCE);
if (!emitted || !referenced) {
    fail(
        `état incohérent après écriture — émis: ${emitted}, référencé: ${referenced}.\n` +
            `   Ne pas ignorer : c'est exactement le défaut que B-46 a fermé.`
    );
}

console.log(
    `✅ [AMBIENT-TYPES] namespace global publié — dist/types/global.d.ts + référence dans l'entrée.`
);
