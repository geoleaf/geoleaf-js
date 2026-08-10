/**
 * @description
 * Fabrique de configuration Vitest partagée — ARCHI S9.3.
 *
 * Remplace les **25 imports relatifs** `../core/vitest-plugins/…` répartis sur 17
 * packages. C'était le couplage le plus dense du dépôt : l'infrastructure de test
 * de 17 packages vivait dans un 18ᵉ, si bien que déplacer `packages/core` cassait
 * les tests de tous les autres.
 *
 * ## Deux règles de conception, toutes deux apprises à la dure
 *
 * **1. Tout est `.mjs` ici, jamais `.ts`** — par robustesse, et non parce qu'un
 * `.ts` serait impossible. Vérifié : un `.ts` de ce package, importé par specifier
 * npm depuis un `vitest.config.ts`, se charge très bien, même `NODE_OPTIONS` vidé.
 * Le motif réel est de ne dépendre d'aucun transpileur pour lire des modules dont
 * l'un installe précisément ce transpileur. Détail dans `ensure-tsx-node-options.mjs`.
 *
 * **2. `resolve.alias` n'est JAMAIS fusionné ni réordonné.** L'ordre des alias
 * Vitest est significatif : dans `plugin-storage`, `@core/config/profile-layers`
 * doit précéder le catch-all `@core/config/*`, sinon le second capture le premier.
 * La fabrique reçoit donc le tableau du package et le place **tel quel**, après ses
 * propres entrées (elle n'en a aucune aujourd'hui) et sans le trier.
 *
 * Corollaire à connaître avant de toucher aux alias : ils ne gouvernent **que les
 * fichiers de test**. Les sources passent par tsx et les `paths` du tsconfig vers
 * la vraie source du core. Ce double chemin de résolution est documenté dans
 * `plugin-storage/vitest.config.ts` et `plugin-addpoi/vitest.config.ts` ; la
 * fabrique le préserve en ne touchant à aucun des deux.
 *
 * ## Ce qui est mutualisé
 *
 * Les champs identiques dans les 18 configs : `globals`, `include`, `exclude`,
 * `maxWorkers`, `vmMemoryLimit`, `coverage.provider`/`reporter`/`reportsDirectory`,
 * `testTimeout`, `reporters`, le bloc `__dirname` et le plugin `resolveJsToTs`.
 *
 * ⚠️ `maxWorkers` et `vmMemoryLimit` ne sont pas mutualisés par confort : Vitest 4 refuse
 * des `maxWorkers` **divergents** entre projets d'un même `sequence.groupOrder` et abat le
 * run avant tout test. Ils viennent donc tous deux de `worker-budget.mjs`, y compris dans
 * les 3 configs sur mesure (core, addpoi, storage) qui n'utilisent pas cette fabrique.
 *
 * Ce qui diverge réellement reste paramétré : `name`, `environment` (happy-dom ×16,
 * node ×2), `pool` (vmForks ×15, forks ×3), la couverture (`include`/`exclude` et
 * des seuils allant de **19** pour `plugin-storage` à **85** pour `field-renderer`),
 * `setupFiles` et `alias`.
 */

// Side effect — MUST be evaluated before Vitest spawns any worker. A static ESM
// import is fully evaluated before the importing module's body, so importing it
// here (rather than in each of the 18 leaves) both preserves the ordering and
// removes the trap of a leaf placing another import above it.
import "./ensure-tsx-node-options.mjs";

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// Le budget de processus du run — B.48. Voir ce module pour les invariants ; retenir ici
// que la valeur DOIT être la même dans les 18 configs, sans quoi Vitest 4 abat le run
// `projects` avant tout test.
import { maxWorkers, vmMemoryLimit } from "./worker-budget.mjs";

// `core`, `plugin-addpoi` et `plugin-storage` gardent une configuration sur mesure
// (alias, pool forks, setup) et importent le plugin directement depuis
// `@geoleaf/build-config/vitest/resolve-js-to-ts.mjs`. Pas de ré-export ici.
import { resolveJsToTs } from "./resolve-js-to-ts.mjs";

/** Seuils de couverture par défaut — la cible projet (≥ 75 %). */
const DEFAULT_THRESHOLDS = { branches: 75, functions: 75, lines: 75, statements: 75 };

/**
 * Construit la configuration Vitest d'un package.
 *
 * @param {object} options
 * @param {string} options.configUrl `import.meta.url` du `vitest.config.ts` appelant —
 *   sert à calculer `root`. Passer l'URL plutôt qu'un chemin évite de dépendre du
 *   répertoire depuis lequel Vitest est lancé.
 * @param {string} options.name Nom du projet Vitest (= nom npm du package).
 * @param {"happy-dom"|"node"} [options.environment] Défaut `happy-dom`.
 * @param {"vmForks"|"forks"|"threads"} [options.pool] Défaut `vmForks`.
 * @param {string[]} [options.coverageInclude] Défaut `["src/**\/*.ts"]`.
 * @param {string[]} [options.coverageExclude] Défaut `[]`.
 * @param {object} [options.thresholds] Seuils de couverture. Défaut 75 partout.
 * @param {string[]} [options.setupFiles] Fichiers de setup, tels quels.
 * @param {unknown[]} [options.alias] `resolve.alias` du package — **repris verbatim**,
 *   jamais fusionné ni trié (l'ordre est significatif).
 * @param {unknown[]} [options.plugins] Plugins supplémentaires, ajoutés APRÈS `resolveJsToTs`.
 * @param {object} [options.test] Champs `test` supplémentaires, fusionnés en dernier.
 * @returns {import('vitest/config').UserConfig}
 */
export function packageConfig({
    configUrl,
    name,
    environment = "happy-dom",
    pool = "vmForks",
    coverageInclude = ["src/**/*.ts"],
    coverageExclude = [],
    thresholds = DEFAULT_THRESHOLDS,
    setupFiles,
    alias,
    plugins = [],
    test = {},
}) {
    if (!configUrl) throw new Error("vitest/base: `configUrl` is required (pass import.meta.url).");
    if (!name) throw new Error("vitest/base: `name` is required.");

    const root = dirname(fileURLToPath(configUrl));

    return defineConfig({
        root,
        plugins: [resolveJsToTs, ...plugins],
        // Passed through untouched — see the ordering note in this module's header.
        ...(alias ? { resolve: { alias } } : {}),

        test: {
            name,
            environment,
            globals: true,

            include: ["**/__tests__/**/*.test.ts"],
            exclude: ["**/node_modules/**", "**/dist/**"],

            pool,

            // B.48 — le plafond de workers et le seuil de recyclage mémoire, dérivés d'une
            // source unique. Ils remplacent un `memoryLimit: "1/2"` qui était doublement
            // faux : la clé lue par Vitest 4 est `vmMemoryLimit` (celle-ci ne l'était pas),
            // et `"1/2"` s'y serait de toute façon parsé en **1**, soit 100 % de la RAM.
            maxWorkers: maxWorkers(),
            vmMemoryLimit: vmMemoryLimit(),

            ...(setupFiles ? { setupFiles } : {}),

            coverage: {
                provider: "istanbul",
                include: coverageInclude,
                exclude: coverageExclude,
                reporter: ["text", "lcov", "html"],
                reportsDirectory: "./coverage",
                thresholds,
            },

            testTimeout: 10_000,
            reporters: ["verbose"],

            ...test,
        },
    });
}
