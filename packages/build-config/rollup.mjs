/*!
 * GeoLeaf — fabrique de configuration Rollup partagée (ARCHI S9.2)
 * © 2026 Mattieu Pottier — MIT License
 */

/**
 * @description
 * Assemble la pile de plugins Rollup commune aux packages du monorepo.
 *
 * ## Ce que la fabrique absorbe — et ce qu'elle laisse délibérément aux feuilles
 *
 * Elle absorbe les imports, la lecture du `package.json` et l'assemblage ordonné
 * des plugins. Une config de plugin passe ainsi de ~45 à ~18 lignes.
 *
 * Elle ne touche PAS à `input`, `output` ni `external` : ces trois-là restent
 * écrits en littéral dans chaque feuille. **Ce n'est pas un choix esthétique.**
 * `scripts/verify-plugin-contract.cjs` vérifie le contrat en lisant le TEXTE de
 * `rollup.config.mjs` :
 *
 *   PC-12 → `content.includes("geoleaf-<nom>.plugin.js")` et `/format:\s*["']es["']/`
 *   PC-10 → `/maplibre-gl/` pour l'externalisation
 *   PC-13 → `/\binject\s*:\s*true\b/` (forme interdite)
 *
 * Une fabrique qui DÉRIVERAIT le nom de sortie ferait tomber PC-12 sur les 13
 * plugins d'un coup — et ce gate tourne en `--fail` en pre-commit, dans
 * `ci:local` ET dans `ci.yml`. Masquer `'maplibre-gl'` derrière un drapeau
 * désarmerait PC-10 en silence. La règle est donc : **tout ce qu'un gate lit au
 * texte reste dans la feuille.**
 *
 * ## Ordre des plugins
 *
 * `nodeResolve → commonjs? → json? → replace? → postcss? → typescript → minify?`
 *
 * Cet ordre n'est pas arbitraire : il est celui des 15 configs d'origine, vérifié
 * une par une avant l'extraction. Le modifier changerait les bundles.
 *
 * ## Périmètre
 *
 * 15 configs. `core` (543 l., 4 entrées, export tableau), `plugin-addpoi` (148 l.)
 * et `plugin-storage` (207 l.) portent des plugins Rollup maison qui indexent
 * `../core/src` : ils ne reçoivent que le changement d'import de `cspStyleInject`.
 *
 * ⚠️ Ces trois-là déclarent `@rollup/plugin-commonjs@^29.0.0`, alors que les 10
 * packages servis par cette fabrique sont sur `^28.0.3` (copies imbriquées en
 * 28.0.9, vérifiées sur disque). C'est pourquoi `build-config` déclare `^28.0.3`
 * et non la version de la racine : importer depuis ici résout depuis ICI, et
 * déclarer `^29` ferait basculer 10 bundles de version majeure sans un mot.
 */

import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import replace from "@rollup/plugin-replace";
import json from "@rollup/plugin-json";
import postcss from "rollup-plugin-postcss";
import { minify } from "rollup-plugin-esbuild";

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// La forme canonique du bandeau vit dans `scripts/lib/license-banner.cjs` — un seul endroit,
// lu par le générateur `--write`, par la gate LIC-HEADERS et par cette fabrique. Chargé par
// `createRequire` parce qu'il est CommonJS : le patron existe déjà dans ce paquet
// (`vitest/resolve-js-to-ts.mjs`). Le duplicater ici ferait diverger la bannière POSÉE de la
// bannière EXIGÉE, et le désaccord se lirait comme « la gate rougit sur un bundle qu'on vient
// de bannériser ».
const { bundleBanner } = createRequire(import.meta.url)("../../scripts/lib/license-banner.cjs");

// `core`, `plugin-addpoi` et `plugin-storage` sont hors périmètre de la fabrique et
// importent l'injecteur directement depuis `@geoleaf/build-config/csp-style-inject.mjs`.
// Pas de ré-export ici : il ne servirait personne.
import { cspStyleInject } from "./csp-style-inject.mjs";

/**
 * Rend déterministe le `augmentChunkHash` de `rollup-plugin-postcss`.
 *
 * ## Le défaut
 *
 * `rollup-plugin-postcss@4.0.2` (dernière publication en 2021, projet non
 * maintenu) implémente :
 *
 *     augmentChunkHash() {
 *         if (extracted.size === 0) return;
 *         const extractedValue = [...extracted].reduce(…);  // Map → objet
 *         return JSON.stringify(extractedValue);
 *     }
 *
 * `extracted` est une **Map**, remplie dans le hook `transform` — donc dans
 * l'ordre où Rollup transforme les modules CSS, qui n'est pas stable d'un run à
 * l'autre. La sérialisation dépend de cet ordre d'insertion : même contenu, chaîne
 * différente, **donc hash différent**.
 *
 * Rollup ajoute cette valeur au hash de CHAQUE chunk. Conséquence mesurée sur
 * `@geoleaf/core` : les 7 chunks changeaient de nom à chaque build alors que leur
 * contenu — `.js` ET `.js.map` — était byte-à-byte identique. Diagnostic confirmé
 * en instrumentant le hook : run A commençait par `feature-info-sidepanel.css`,
 * run B par `branding.css`.
 *
 * Coût réel : cache Turborepo invalidé à chaque build, `deploy/` qui diffère à
 * chaque génération sans changement de code, et cache navigateur cassé sur des
 * chunks identiques — l'inverse exact de ce que le hash de contenu sert à faire.
 *
 * ## Le correctif
 *
 * On ne corrige pas `node_modules` (écrasé au prochain `npm install`) et on ne
 * retire pas `[hash]` des noms de chunks (ce serait perdre le cache-busting pour
 * contourner un bug de tri). On réordonne : un plugin Rollup est un objet simple,
 * donc son hook se remplace. L'INTENTION du hook est conservée — si le CSS extrait
 * change, les hashes changent — seule la **sensibilité à l'ordre** disparaît.
 *
 * Sans effet sur les autres packages : la fabrique les configure en
 * `extract: false`, donc `extracted.size === 0` et le hook sort avant de sérialiser.
 *
 * @param {import('rollup').Plugin} plugin Instance de `postcss(...)` à assainir.
 * @returns {import('rollup').Plugin} La même instance, hook trié.
 */
export function withStableChunkHash(plugin) {
    const original = plugin.augmentChunkHash;
    if (typeof original !== "function") return plugin;

    plugin.augmentChunkHash = function stableAugmentChunkHash(chunk) {
        const value = original.call(this, chunk);
        if (typeof value !== "string") return value;
        try {
            const parsed = JSON.parse(value);
            // Rebuild key by key rather than using the replacer-array form of
            // JSON.stringify: the replacer applies to NESTED objects too and would
            // silently drop keys of the per-entry values.
            const sorted = {};
            for (const key of Object.keys(parsed).sort()) sorted[key] = parsed[key];
            return JSON.stringify(sorted);
        } catch {
            // Not the JSON shape we expect — leave it untouched rather than guess.
            return value;
        }
    };
    return plugin;
}

/**
 * Lit le `package.json` situé à côté du fichier de config appelant.
 *
 * Remplace le bloc `__dirname` + `readFileSync` recopié dans 16 configs. Prend
 * `import.meta.url` de l'appelant plutôt que `process.cwd()` : le résultat ne
 * dépend alors pas du répertoire depuis lequel Rollup est lancé.
 *
 * @param {string} importMetaUrl `import.meta.url` du `rollup.config.mjs` appelant.
 * @returns {{ name: string, version: string, [k: string]: unknown }}
 */
export function readPackageJson(importMetaUrl) {
    const dir = path.dirname(fileURLToPath(importMetaUrl));
    const file = path.join(dir, "package.json");
    if (!fs.existsSync(file)) {
        throw new Error(`build-config/rollup: no package.json next to ${importMetaUrl}`);
    }
    return JSON.parse(fs.readFileSync(file, "utf-8"));
}

/**
 * La bannière de licence du bundle — posée APRÈS le minifieur, et c'est tout le sujet.
 *
 * ## Pourquoi pas `output.banner`
 *
 * Parce qu'elle ne sort pas. Mesuré : `plugins/offline-ui/rollup.config.mjs` DÉCLARAIT une
 * `output.banner` complète, et son bundle livré commençait par `var Xe=Object.defineProperty`.
 * Rollup préfixe la bannière avant les hooks `renderChunk`, `minify()` de
 * `rollup-plugin-esbuild` EST un `renderChunk`, et son `legalComments: "none"` supprime tout
 * `/*!`. Déclarer ne suffit donc pas — il faut mesurer que ça sort (tâche 3.3).
 *
 * ## Pourquoi pas `legalComments: "inline"` non plus
 *
 * Ce serait l'autre correctif possible, et il coûte cher pour rien : `"inline"` conserve TOUS
 * les commentaires légaux de l'entrée, donc les ~650 bandeaux `/*!` des sources remonteraient
 * dans chaque bundle minifié. On veut UNE notice en tête du fichier livré, pas six cents
 * dispersées dedans.
 *
 * ## Pourquoi `generateBundle` et pas `renderChunk`
 *
 * `generateBundle` passe après tous les `renderChunk`, donc après le minifieur, sans dépendre
 * de l'ordre du tableau de plugins. Et surtout, la sourcemap y est déjà produite : préfixer N
 * lignes de code revient EXACTEMENT à préfixer N `;` aux `mappings`, ce qui décale chaque
 * entrée d'autant de lignes sans en perdre une seule. Un `renderChunk` qui rendrait la chaîne
 * seule ferait glisser toute la carte de N lignes en silence — et cette carte est lue par
 * `verify-e2e-coverage.cjs` et par `npm run size` pour attribuer les octets aux sources.
 *
 * 🛑 **La carte ÉCRITE n'est PAS `chunk.map`** — et le croire a produit un décalage de six
 * lignes qui sortait vert. Rollup sérialise la carte en **ASSET** du bundle (`<fichier>.map`,
 * `type: "asset"`) AVANT d'appeler `generateBundle` ; `chunk.map` n'est qu'une vue en mémoire
 * que plus personne ne relit. Mesuré à la sonde : muter `chunk.map.mappings` se voit dans
 * `bundle.generate()` et **disparaît** dans `bundle.write()`. C'est donc la `source` de
 * l'asset qu'il faut reprendre — et les deux sont mises à jour, pour qu'un consommateur de
 * `generate()` ne lise pas une carte incohérente avec celle du disque.
 *
 * ## Les chunks 100 % tiers sont SAUTÉS
 *
 * Écrire « © 2026 Mattieu Pottier — Released under the MIT License » en tête de
 * `geoleaf-print.jspdf-*.js` serait une fausse attribution : ce fichier est du jsPDF. La
 * décision se dérive du graphe (`chunk.modules` tous sous `node_modules/`), jamais d'une liste
 * de noms — et la gate LIC-04 applique la MÊME dérivation sur la sourcemap, en imprimant les
 * exemptés à chaque run.
 *
 * @param {{name: string, version: string}} pkg Le manifeste du paquet, via `readPackageJson`.
 * @returns {import('rollup').Plugin}
 */
export function licenseBanner(pkg) {
    const banner = bundleBanner(pkg.name, pkg.version);
    const addedLines = banner.split("\n").length;
    return {
        name: "geoleaf-license-banner",
        generateBundle(_options, bundle) {
            const shift = ";".repeat(addedLines);
            for (const file of Object.values(bundle)) {
                if (file.type !== "chunk") continue;
                const ids = Object.keys(file.modules || {});
                if (ids.length > 0 && ids.every((id) => id.includes("node_modules"))) continue;
                if (file.code.startsWith("/*!")) continue;
                file.code = `${banner}\n${file.code}`;

                // La vue en mémoire…
                if (file.map) file.map.mappings = shift + file.map.mappings;
                // …ET l'asset, qui est ce qui atterrit sur le disque.
                const asset = bundle[`${file.fileName}.map`];
                if (asset && asset.type === "asset" && typeof asset.source === "string") {
                    const map = JSON.parse(asset.source);
                    map.mappings = shift + map.mappings;
                    asset.source = JSON.stringify(map);
                }
            }
        },
    };
}

/**
 * Construit la pile de plugins d'un package.
 *
 * Chaque option correspond à un plugin réellement utilisé par au moins un
 * package ; aucune n'a été inventée « au cas où ». La répartition mesurée sur les
 * 15 configs d'origine : nodeResolve 15/15, replace 13/15, commonjs 10/15,
 * postcss 7/15, json 4/15, minify 1/15.
 *
 * @param {object}  [options]
 * @param {object}  [options.resolve]   Options de `nodeResolve`. `{}` ⇒ appel nu.
 *                                      Valeur usuelle : `{ preferBuiltins: false }`.
 * @param {boolean} [options.commonjs]  Ajoute `@rollup/plugin-commonjs`.
 * @param {boolean} [options.json]      Ajoute `@rollup/plugin-json` (après commonjs).
 * @param {string}  [options.version]   Si fourni, injecte `__GEOLEAF_VERSION__` via
 *                                      `@rollup/plugin-replace`. Valeur NUE, jamais
 *                                      `JSON.stringify` : le jeton apparaît déjà à
 *                                      l'intérieur d'un littéral de chaîne dans
 *                                      `entry.ts` (`_VERSION = "__GEOLEAF_VERSION__"`),
 *                                      donc ajouter des guillemets produirait `""1.2.3""`.
 * @param {boolean} [options.css]       Ajoute `rollup-plugin-postcss` avec l'injecteur
 *                                      CSP (`cspStyleInject`). Jamais `inject: true`,
 *                                      forme interdite par PC-13.
 * @param {object}  [options.typescript] Options fusionnées dans `@rollup/plugin-typescript`
 *                                      (le `tsconfig` local est toujours conservé).
 * @param {boolean} [options.minify]    Ajoute `minify()` de `rollup-plugin-esbuild`.
 * @param {{name: string, version: string}} [options.pkg] Le manifeste, pour la bannière de
 *                                      licence (npm S3). Son ABSENCE ne casse rien ici — c'est
 *                                      LIC-04 qui rougit sur le bundle non bannérisé, et c'est
 *                                      le bon endroit : la fabrique pose, la gate juge.
 * @returns {import('rollup').Plugin[]}
 */
export function pluginStack({
    resolve = { preferBuiltins: false },
    commonjs: useCommonjs = false,
    json: useJson = false,
    version,
    css = false,
    typescript: tsOptions = {},
    minify: useMinify = false,
    pkg,
} = {}) {
    const plugins = [nodeResolve(resolve)];

    if (useCommonjs) plugins.push(commonjs());
    if (useJson) plugins.push(json());

    if (version !== undefined) {
        plugins.push(replace({ preventAssignment: true, values: { __GEOLEAF_VERSION__: version } }));
    }

    if (css) {
        plugins.push(
            postcss({ inject: cspStyleInject, minimize: true, extract: false, sourceMap: false })
        );
    }

    plugins.push(typescript({ tsconfig: "./tsconfig.json", ...tsOptions }));

    // Même moteur et même cible que @geoleaf/core, pour que le bundle publié tienne
    // le budget du CDC. Le `src/` granulaire reste publié non minifié.
    if (useMinify) plugins.push(minify({ target: "es2015", legalComments: "none" }));

    // Dernier de la pile, et son hook `generateBundle` passe de toute façon après tous les
    // `renderChunk` : la bannière survit au minifieur par construction, pas par convention
    // d'ordre. `legalComments` reste `"none"` — voir le commentaire de `licenseBanner`.
    if (pkg) plugins.push(licenseBanner(pkg));

    return plugins;
}
