/*!
 * GeoLeaf Storage Plugin — Rollup Config
 * © 2026 Mattieu Pottier — MIT License
 */
import { pluginStack, readPackageJson } from "@geoleaf/build-config/rollup.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = readPackageJson(import.meta.url);

// ── Bascule sur `pluginStack` — Sprint 6, S6a / 6.3′ (06/08/2026) ────────────────────────
//
// Ce fichier portait une pile ARTISANALE : le seul des quinze paquets à ne pas passer par la
// fabrique commune, et donc le seul à ne pouvoir recevoir `minify` par un drapeau. Il n'y
// avait aucun motif écrit à cette exception — juste l'histoire de ses réparations.
//
// La pile reconstruite est équivalente plugin pour plugin (`nodeResolve` → `commonjs` →
// `replace` → `postcss` → `typescript` → `minify`), à deux nuances documentées ci-dessous.
//
// ── Ce qui a été SUPPRIMÉ, et qui ne doit pas revenir ────────────────────────────────────
//
// `coreSourceRedirectPlugin` (API publique S4.4c) faisait deux choses, toutes deux devenues
// sans objet :
//
//   1. `resolveId` résolvait `@core-offline/*` vers les SOURCES du core. Le plugin n'a plus
//      aucun import `@core*` : les singletons passent par `globalThis.GeoLeaf`,
//      `resolveProfileLayers` par le sous-chemin publié, `estimateVectorZone` a été déplacée
//      ici. (Son `modulesRoot` pointait par ailleurs un répertoire disparu depuis longtemps.)
//
//   2. 🛑 `load()` transpilait TOUT `.ts` avec `ts.transpileModule`. C'est ce hook qui
//      EMPÊCHAIT l'émission des déclarations : en rendant lui-même le code transpilé, il
//      faisait que le plugin TypeScript ne voyait jamais les fichiers, donc n'émettait aucun
//      `.d.ts`. Mesuré : 0 fichier dans `dist/types/` tant qu'il était là. Il masquait de
//      surcroît un filtre `include` faux, puisque le filtre ne servait plus à rien.
//
// ⚠️ **Le patron ABSOLU de `include` est donc load-bearing, et il est conservé tel quel.** En
// relatif, le filtre ne matche pas `src/entry.ts` et rollup reçoit du TS brut
// (« Expected ',', got '{' »). Sans le hook `load()` pour le masquer, l'erreur est franche —
// c'est le bon mode d'échec, pas une raison de relâcher le patron.
export default {
    input: "src/entry.ts",
    plugins: pluginStack({
        resolve: { browser: true, extensions: [".ts", ".js"] },
        commonjs: true,
        version: pkg.version,
        pkg,
        css: true,
        typescript: {
            tsconfig: path.resolve(__dirname, "tsconfig.json"),
            include: [path.resolve(__dirname, "src/**/*.ts")],
        },
        minify: true,
    }),
    // ⚠️ API publique S4.4c — `@geoleaf/core` est external : FILET, pas mécanisme. Après le
    // découplage il ne reste que des imports de type (effacés) et le sous-chemin publié
    // `kernel/config/profile-layers.js`, qui reste bundlé — c'est une fonction PURE, sans
    // identité à partager, et le navigateur n'a pas d'import map pour résoudre un specifier nu.
    external: [/^@geoleaf\/core$/],
    treeshake: { moduleSideEffects: true },
    output: {
        file: "dist/geoleaf-offline-ui.plugin.js",
        format: "es",
        // 🛑 L'`output.banner` qui vivait ici est SUPPRIMÉE, pas déplacée — et son histoire vaut
        // d'être lue avant d'en réintroduire une. Elle était complète, correcte, et elle
        // n'arrivait JAMAIS dans le livrable : rollup préfixe la bannière avant les hooks
        // `renderChunk`, `minify()` en est un, et son `legalComments: "none"` la supprimait. Ce
        // bundle commençait par `var Xe=Object.defineProperty`. C'était le seul paquet du dépôt
        // à en déclarer une, donc le seul à donner l'illusion d'être couvert.
        // La bannière est désormais posée par `licenseBanner()` (npm S3), en `generateBundle`,
        // donc APRÈS le minifieur — et LIC-04 mesure qu'elle sort au lieu de croire qu'elle est
        // déclarée.
        sourcemap: true,
        // 2.10 bis — les sources voyagent déjà dans `src/` (files[]) :
        // les embarquer une SECONDE fois dans la carte est un doublon pur.
        sourcemapExcludeSources: true,
    },
};

// ── Les deux nuances de la bascule, écrites plutôt que subies ────────────────────────────
//
// 1. `postcss` passe de `sourceMap: true` à `sourceMap: false` — c'est le réglage de la
//    fabrique commune, partagé par les sept autres paquets à CSS. Le `sourcemap: true` de
//    l'`output` rollup, lui, est conservé : la carte du JS reste émise.
//
// 2. Le `onwarn` qui ne faisait que `warn(warning)` a été retiré : c'est le comportement par
//    défaut de rollup, donc une indirection sans effet. Son commentaire disait qu'il ne
//    fallait PAS y filtrer TS5096 (« le garder aurait avalé tout TS5096 futur ») — en le
//    supprimant, ce risque disparaît avec lui.
