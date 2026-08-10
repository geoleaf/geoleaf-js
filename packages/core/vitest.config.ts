/**
 * Vitest configuration for @geoleaf/core
 *
 * Replaces the dual Jest config (jest.config.cjs + jest.esm.config.cjs)
 * and the custom jest-esm-transform.cjs transformer.
 *
 * Key design decisions:
 * - pool: 'forks' — each test runs in an isolated forked Node.js process.
 *   tsx is loaded via execArgv (--import tsx) so the forked workers can require
 *   TypeScript source and redirect .js → .ts imports (CJS-compatible loading).
 * - resolveJsToTs plugin — intercepts .js imports in source files, resolves
 *   to .ts counterparts using existsSync (reliable filesystem lookup). Combined
 *   with resolve.extensionAlias { .js: ['.ts', '.js'] } so Vite's resolver also
 *   tries the .ts sibling for the ESM `import './foo.js'` convention.
 * - globals: true — vi.* available without explicit import in test files
 */
// Side effect: ensure `--import tsx` in NODE_OPTIONS before workers spawn (Vitest 4
// no longer loads tsx reliably via poolOptions.forks.execArgv). MUST be first.
import "@geoleaf/build-config/vitest/ensure-tsx-node-options.mjs";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { resolveJsToTs } from "@geoleaf/build-config/vitest/resolve-js-to-ts.mjs";
import { maxWorkers, vmMemoryLimit } from "@geoleaf/build-config/vitest/worker-budget.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
    root: __dirname,
    plugins: [resolveJsToTs],

    test: {
        name: "@geoleaf/core",
        environment: "happy-dom",
        globals: true,
        setupFiles: [resolve(__dirname, "__tests__/setup.js")],

        // ⚠️ Les DEUX extensions, et l'ordre des raisons compte. La fabrique commune
        // (`build-config/vitest/base.mjs`) déclare `.test.ts` : c'est la cible. Ce paquet
        // l'écrasait en `.test.js` SEUL pour garder visibles les suites de la dette gelée
        // D-23/D-24 — mais l'écrasement rendait aussi tout test NEUF écrit en TypeScript
        // invisible au runner, en sortant vert. C'est le piège que `check-js-test-debt`
        // (JTD-02) nomme explicitement, et il s'est refermé à la tâche 7.2 sur
        // `write-capture-parity.guard.test.ts`. Accepter les deux laisse la dette tourner
        // sans interdire d'écrire neuf dans la bonne extension.
        // 🛑 DEUX motifs, pas une accolade `{js,ts}`. Vitest comprend les deux formes ; le
        // matcher de `check-js-test-debt` ne développe PAS l'accolade, et la version
        // condensée lui faisait déclarer les 456 suites `.js` du paquet « non collectées ».
        // Le geste censé rendre la gate juste l'avait rendue aveugle — vu, puis corrigé.
        include: ["**/__tests__/**/*.test.js", "**/__tests__/**/*.test.ts"],
        exclude: [
            "**/node_modules/**",
            "**/dist/**",
            "**/e2e/**",
            // Les suites `bundle-*` évaluent le `dist/` BÂTI — elles vivent sous
            // `vitest.bundle.config.ts`, qui les globe précisément par ce motif.
            //
            // 🛑 Cette ligne a nommé le seul `bundle.test.js` jusqu'au 07/08/2026, alors que la
            // config dédiée globe `bundle-*.test.js` depuis l'ajout de `bundle-boot-contract`.
            // Le fichier était donc collecté DEUX FOIS : par sa config, qui bâtit ce qu'elle
            // évalue, et par ce run-ci, qui ne le bâtit pas. Son échec ici n'apprenait rien sur
            // le code et faisait tomber `Unit tests` et `Coverage gate` par ricochet — deux des
            // trois gates rouges de B.12 n'avaient pas d'autre cause que cette exclusion trop
            // étroite. ⚠️ Le motif suit désormais celui de `vitest.bundle.config.ts` : les deux
            // se lisent ensemble, ou le prochain fichier `bundle-*` rouvrira le même trou.
            "**/__tests__/bundle.test.js",
            "**/__tests__/bundle-*.test.js",
            "**/__tests__/bundle-*.test.ts",
        ],

        // forks pool: each test runs in an isolated forked Node.js process.
        // --import tsx registers BOTH:
        //   - require.extensions['.ts'] handler (TypeScript CJS loading)
        //   - Module._resolveFilename patch (.js → .ts redirect for CJS requires)
        // Vitest 4 removed `poolOptions`; forks settings are now top-level (isolate
        // defaults to true → former `singleFork: false`).
        pool: "forks",
        execArgv: ["--import", "tsx"],

        // B.48 — ce commentaire disait jusqu'ici que le cap de workers « vit dans la
        // config racine ». C'était vrai en mode `projects`, et FAUX partout ailleurs :
        // sous `turbo run test`, chaque package est un `vitest run` autonome qui ne
        // charge jamais la config racine, et retombait donc sur le défaut de Vitest —
        // 23 workers sur 24 cœurs, par package, simultanément. Mesuré : 81 processus et
        // 11,3 Go de RSS pour ~11 Go disponibles.
        // Ce que Vitest 4 refuse n'est pas le cap par projet, c'est la DIVERGENCE entre
        // projets d'un même `sequence.groupOrder` — d'où une valeur unique et dérivée.
        maxWorkers: maxWorkers(),
        vmMemoryLimit: vmMemoryLimit(),

        coverage: {
            // Provider : **istanbul**, comme les 17 paquets du dépôt. `all:false` — la
            // couverture ne compte que les fichiers atteints par les tests.
            //
            // La classe de défauts qui a jadis faussé cette mesure — un module chargé par
            // `require()` que l'instrumentation ne voit pas sous `--import tsx` — a été
            // éliminée aux sprints 2 à 5 (baseline `require()` 357 → 2) et est désormais gardée
            // à la source par `verify-test-load-mode.cjs` (elle ne peut que descendre).
            // `verify-coverage-attribution.cjs` vérifie en plus, à chaque `ci:local`, que
            // l'attribution est juste, sur un témoin à réponse connue.
            provider: "istanbul",
            all: false,
            reportOnFailure: true,
            include: ["src/**/*.ts"],
            exclude: ["src/**/*.d.ts"],
            thresholds: {
                // Recalibré au S6 sur la mesure istanbul (déterministe, amplitude 0,00 sur
                // 4 runs), puis **cliqueté vers le haut** après le backlog B.2 : les tests des
                // 5 modules du gisement (cache-manager, storage/facade, feature-interaction,
                // branding/lifecycle, init-reveal) ont porté le core de 90,71 à **92,07 %**
                // de lignes (90,36 stmts / 90,77 fns / 81,42 branches).
                //
                // ⚠️ Cliqueter vers le haut, JAMAIS vers le bas.
                //
                // ── Remontée du 25/07/2026 (API publique S4) : 90/88/88/79 → 92/90/90/81 ──
                //
                // Mesure du jour, prise sous la commande EXACTE du gate
                // (`turbo run test:coverage --filter=@geoleaf/core`, et non un `vitest` nu —
                // l'agrégat `projects` des 17 paquets est un autre objet, cf. CLAUDE.md) :
                //
                //   lignes 92,77 · statements 91,02 · fonctions 91,36 · branches 81,97
                //
                // Les marges tombent de ~2 pts à **0,77 / 1,02 / 1,36 / 0,97**, et c'est un
                // choix, pas un oubli. La marge précédente était justifiée comme protection
                // contre « la charge parallèle de turbo » — or ce que la charge produit, ce
                // sont des dépassements de `hookTimeout`, qui font ÉCHOUER le test, pas
                // baisser silencieusement la couverture. Sous istanbul l'amplitude mesurée
                // reste 0,00. Une marge de 2 points laissait surtout de la place pour
                // régresser sans que rien ne le dise.
                //
                // Si un run rougit ici sans qu'un test ait été supprimé, la cause à chercher
                // en premier est un fichier ENTRÉ dans le périmètre sans tests — pas du bruit.
                branches: 81,
                functions: 90,
                lines: 92,
                statements: 90,
            },
            reporter: ["text", "lcov", "html", "json"],
            reportsDirectory: "./coverage",
        },

        testTimeout: 10000,
        // Hooks that import core module graphs under tsx + istanbul can exceed the
        // default 10 s when the full `npm test` (turbo) runs all workspaces in parallel
        // (CPU contention). Give setup hooks headroom to avoid flaky timeouts.
        hookTimeout: 30000,
        reporters: ["verbose"],
    },

    resolve: {
        // extensionAlias: when Vite resolves a .js import and the .js file doesn't
        // exist, try .ts first. This handles the ESM convention used throughout the
        // codebase: source files import ./foo.js but the actual files are ./foo.ts.
        // Used by Vite's ssrLoadModule for all transitive imports in source files.
        extensionAlias: {
            ".js": [".ts", ".js"],
        },

        alias: [
            // Workspace package: resolve field-renderer from source (no CJS "require" export in dist).
            {
                find: "@geoleaf/field-renderer",
                replacement: resolve(__dirname, "../libs/field-renderer/src/index.ts"),
            },
            // Entry-point side-effect stub. `bundle-esm-entry.ts:35,37` are the only
            // specifiers this matches (`import "./app/app-namespace.js"` / `"./app/boot.js"`).
            // ⚠️ STRUCT S7 — five sibling entries were removed here: they targeted
            // `./lazy/*` and `./modules/*`, and BOTH directories were deleted (ARCHI
            // S10.1 / STRUCT S5). They matched zero specifiers in the repo and had been
            // resolving nothing for months. A vitest alias whose `find` matches nothing
            // is silent by construction — it is not a config error, it is dead weight
            // that reads as coverage. Kept this one because a test importing
            // `bundle-esm-entry.ts` is a legitimate thing to write, and it costs a line.
            {
                find: /^\.\/app\/.+\.js$/,
                replacement: resolve(__dirname, "__tests__/__mocks__/empty-module.js"),
            },
            // S14 Phase B (B3): stub the in-core offline engine's IndexedDB layer in unit
            // tests (the real IDB layer opens a database — not available under happy-dom).
            // Mirrors the former plugin-storage vitest aliases now that the engine is in-core.
            // ⚠️ `(js|ts)` — SANS `ts`, ces deux entrées étaient MORTES pour les sources.
            // `resolveJsToTs.transform` réécrit `.js` → `.ts` À L'INTÉRIEUR des fichiers
            // source (il saute explicitement `__tests__/`), si bien que `storage.ts` demande
            // `../db/indexeddb.ts` — que `/\.js$/` ne matchait pas. Le VRAI `indexeddb.ts`
            // (591 l.) était donc chargé malgré l'alias, et ses gardes `_ensureModule`
            // jetaient « Preferences module not available ». C'est ce qui faisait passer les
            // 2 derniers sites du core pour des « mocks incomplets » (B.10) : le mock n'était
            // jamais servi. Même piège que `image-upload.(js|ts)` côté plugin-addpoi (S5).
            {
                // ⚠️ STRUCT S8 : `core/` → `db/`. Cette entrée a été VUE MORTE avant d'être
                // corrigée — 13 tests rouges sur 4 fichiers, tous « Preferences module not
                // available » depuis le VRAI `indexeddb.ts`. L'alias garde donc bien quelque
                // chose ; il n'est pas décoratif.
                find: /^\.\.\/db\/indexeddb\.(js|ts)$/,
                replacement: resolve(__dirname, "__tests__/__mocks__/indexeddb.js"),
            },
            {
                find: /^\.\/indexeddb\.(js|ts)$/,
                replacement: resolve(__dirname, "__tests__/__mocks__/indexeddb.js"),
            },
        ],
    },
});
