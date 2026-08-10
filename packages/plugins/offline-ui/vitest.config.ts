/**
 * Vitest configuration for @geoleaf-plugins/offline-ui
 *
 * Uses forks pool + tsx loader (mirrors packages/core/vitest.config.ts).
 * tsx registers require.extensions['.ts'] + Module._resolveFilename patch
 * so that CJS require('../src/foo.ts') correctly resolves to foo.ts.
 *
 * IMPORTANT — Istanbul coverage must be run via workspace mode:
 *   npm run test:vitest:coverage (from monorepo root)
 * Running standalone `npx vitest run --coverage` bypasses Vite's transform
 * pipeline (tsx intercepts first), and Istanbul cannot instrument sources.
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
const coreRoot = resolve(__dirname, "../../core");

export default defineConfig({
    root: __dirname,
    plugins: [resolveJsToTs],

    test: {
        name: "@geoleaf-plugins/offline-ui",
        // happy-dom (not jsdom): jsdom pulls whatwg-url → webidl-conversions@8 which
        // crashes under the tsx loader (TypeError "reading 'get'"). Mirrors plugin-addpoi.
        environment: "happy-dom",
        globals: true,

        // ⚠️ `.ts` AJOUTÉ le 07/08/2026 (B-152). Il ne l'était pas, et les deux règles du
        // dépôt se contredisaient sur ce paquet : JTD-01 refuse toute suite `.js` NEUVE
        // (« un test neuf s'écrit en TypeScript »), pendant que ce glob ne ramassait que
        // `.js` — un test neuf conforme à JTD-01 n'aurait donc jamais été EXÉCUTÉ, et une
        // garde qui ne tourne pas ne garde rien. Vu : le fichier de garde de B-152 sortait
        // « 0 test » avant ce changement.
        // Les 17 suites `.js` existantes restent en place — D-23 est gelée, pas rouverte ;
        // ce glob rend seulement possible d'écrire les NEUVES du bon côté.
        // ⚠️ DEUX motifs, pas une accolade `{js,ts}` : c'est la forme de
        // `packages/core/vitest.config.ts:51`, et **JTD-04 ne sait pas lire les accolades**.
        // Écrit d'abord en `{js,ts}`, il a fait rougir la gate sur les **22** suites du
        // paquet — « vitest NE COLLECTE PAS » — alors qu'elles tournaient toutes (359 tests).
        // Un faux positif, mais sur exactement la classe que JTD-04 existe pour attraper :
        // un `include` qui cesse de matcher rend des suites invisibles **en restant vert**.
        include: ["**/__tests__/**/*.test.js", "**/__tests__/**/*.test.ts"],
        exclude: [
            "**/node_modules/**",
            "**/dist/**",
            // bundle.test.js reads a pre-built dist/geoleaf-offline-ui.plugin.js — use vitest.bundle.config.ts
            "**/__tests__/bundle.test.js",
        ],

        setupFiles: [resolve(__dirname, "__tests__/setup.js")],

        // Vitest 4 removed `poolOptions`; forks execArgv is now top-level.
        pool: "forks",
        execArgv: ["--import", "tsx"],

        // B.48 — budget de processus, dérivé et IDENTIQUE dans les 18 configs (Vitest 4
        // abat le run `projects` si deux projets divergent sur `maxWorkers`).
        maxWorkers: maxWorkers(),
        vmMemoryLimit: vmMemoryLimit(),

        coverage: {
            // Provider istanbul, comme les 17 paquets. Les tests de ce paquet chargeaient jadis
            // leurs sources en `require()`, que `--import tsx` soustrayait à l'instrumentation
            // (0 % rapporté pendant que 90/90 tests passaient). La conversion S5 a supprimé
            // cette branche.
            provider: "istanbul",
            all: false,
            include: ["src/**/*.ts"],
            exclude: ["src/**/*.d.ts"],
            reporter: ["text", "lcov", "html"],
            reportsDirectory: "./coverage",
            // COUVERTURE S5 — aligné sur packages/core. Un seuil qui tombe ou un test qui
            // échoue ne doit PAS emporter le relevé : pendant une conversion require() →
            // import, des rouges sont ATTENDUS, et le lot qu'il faut justement diagnostiquer
            // serait précisément celui dont on perdrait la mesure.
            reportOnFailure: true,
            // Recalibré au S6 sur la mesure **istanbul, 4 runs** (22/07/2026). Le seuil S5
            // (19) était resté ROUGE en statements délibérément, en attendant cette
            // re-mesure sur les 4 paquets. Ces chiffres sont BAS et c'est l'état réel du
            // paquet : 90 tests en couvrent environ un cinquième (75 reste la CIBLE — backlog
            // B.13, à cliqueter vers le haut jamais vers le bas). La mesure est déterministe ;
            // les 4 runs rendent, à l'identique :
            //
            //   |            | ancien seuil | mesure vraie (istanbul, S6) | nouveau seuil |
            //   |------------|--------------|-----------------------------|---------------|
            //   | statements |      19      |            18,91           |      16       |
            //   | lines      |      19      |            19,34           |      17       |
            //   | functions  |      16      |            18,89           |      16       |
            //   | branches   |      10      |            10,10           |       8       |
            //
            // Seuils ~2 pts sous la mesure — marge contre la charge parallèle de turbo, non
            // contre le bruit (nul sous istanbul). Le rouge S5 (statements) est levé.
            //
            // ── Re-cliquetés au backlog résiduel R.1 (24/07/2026) ─────────────────────
            //
            // La cible 75 n'est PAS atteinte ici, et c'est arbitré : ce paquet pèse 5 654
            // lignes pour 8 fichiers de test, l'y amener est un chantier à part entière
            // (~10-14 h), ouvert en ligne dédiée. Ce sprint fait le premier palier.
            //
            //   |            | seuil S6 | mesure 24/07 avant R.1 | après R.1 | nouveau seuil |
            //   |------------|----------|------------------------|-----------|---------------|
            //   | statements |    16    |         21,07          |   38,45   |      36       |
            //   | lines      |    17    |         21,30          |   38,87   |      36       |
            //   | branches   |     8    |         12,75          |   23,75   |      21       |
            //   | functions  |    16    |         22,07          |   36,79   |      34       |
            //
            // Le gain vient d'un seul fichier — `src/__tests__/cache-control-view.test.js`,
            // portage du `ui/cache-button.test.js` du core (725 l., 30 tests, ZÉRO ligne de
            // production couverte : il redéfinissait dans le test la fonction qu'il
            // vérifiait). Rejoué contre le vrai code : `cache-control-dom` 0 → 100 % de
            // lignes, `cache-control-state` 0 → 87,80, `cache-control-events` 0 → 65,15,
            // `cache-control-zone` 0 → 50,80 par ricochet.
            //
            // ⚠️ **Cause racine du retard de ce paquet, à instruire avec la ligne dédiée** :
            // il est le seul EXCLU du run `projects` racine — `scripts/lib/test-scope.cjs`,
            // `EXCLUDED_FROM_ROOT_RUN` : « infrastructure de test à reprendre (mock
            // IndexedDB/IDBFactory) — exclusion héritée ». Il n'est mesuré que par turbo.
            //
            // ⚠️ Cliqueter vers le haut, JAMAIS vers le bas.
            //
            // ── Chantier R.31 : la CIBLE 75 est ATTEINTE (24/07/2026) ─────────────────
            //
            // 8 fichiers de test ajoutés, exerçant enfin les modules jusque-là à 0-40 % : le
            // cluster layer-selector (`populate` de bout en bout, ~1 380 l.), download-handler,
            // sync-manager, cache-control-zone, export-logic, cache-control (la FABRIQUE,
            // importée SANS extension pour contourner le stub cross-plugin), entry +
            // orchestrateur, modal-manager, button-control. Mesure istanbul, déterministe :
            //
            //   |            | seuil R.1 | mesure 24/07 après R.31 | nouveau seuil |
            //   |------------|-----------|-------------------------|---------------|
            //   | statements |    36     |          93,38          |      91       |
            //   | lines      |    36     |          94,03          |      92       |
            //   | branches   |    21     |          75,10          |      73       |
            //   | functions  |    34     |          81,38          |      79       |
            //
            // Les 4 métriques ≥ 75 : storage n'est plus le paquet retardataire. Seuils ~2 pts
            // sous la mesure (marge contre la charge parallèle turbo ; bruit nul sous istanbul).
            //
            // ⚠️ CLIQUETÉS le 04/08/2026 (tâche 4.11) — 73/79/92/91 → 74/80/93/92. Le retrait
            // de la chaîne de sauvegarde a fait monter les quatre métriques (mesuré après :
            // 74,58 / 80,00 / 93,58 / 92,94), parce qu'il emporte du code que la suite ne
            // couvrait pas. Un seuil qui ne suit pas une hausse cesse de garder quoi que ce
            // soit : il redevient franchissable par du code neuf non testé.
            // Cliquetés au Sprint 6 (S6c / B-140), ~2 pts sous la mesure comme le veut la
            // convention posée au cliquet du 04/08.
            //
            // 🛑 **B-140 : la marge sur les FONCTIONS était NULLE** — 80,00 % pour un seuil de
            // 80, alors que le commentaire qui surplombait ces seuils annonçait « ~2 pts sous
            // la mesure ». Ni abaissable (interdit) ni montable (elle aurait rougi) : la seule
            // sortie était de **couvrir une fonction de plus**, jamais de toucher au seuil.
            //
            // Fait : `cache-control-factory.test.js` exerce désormais les sept délégations de
            // handler de la fabrique (`_handleDownload`… `_toggleCollapsed`), qu'istanbul
            // comptait chacune comme une fonction non couverte. `cache/cache-control.ts` passe
            // de **52,38 à 80,95 %** de fonctions, et le paquet de **80,00 à 82,8**.
            //
            // Mesure du 06/08 : 93,36 stmts · 74,79 branches · 82,8 fonctions · 93,98 lignes.
            thresholds: {
                branches: 74,
                functions: 80,
                lines: 93,
                statements: 92,
            },
        },

        testTimeout: 10000,
        reporters: ["verbose"],
    },

    resolve: {
        alias: [
            // COUVERTURE S5 — le specifier que les sources importent réellement n'était routé
            // vers son mock que par `__tests__/setup.js`, jamais par Vite. Le mock fait
            // résoudre `confirmDialog` à `true` par défaut et s'override par test ; charger le
            // vrai paquet ouvrirait une vraie modale. ⚠️ `s1-fixes.test.js` importe déjà
            // `export-logic.js` en ESM et passe : cela prouve que le paquet réel se CHARGE, pas
            // que ce chemin se comporte pareil — il n'exerce aucun appel à `confirmDialog`.
            //
            // 🛑 **La cible a changé en S6b (B-144)** : W3 a déplacé `confirmDialog` et
            // `createFocusTrap` vers `@geoleaf/host-runtime`, donc c'est LUI qu'il faut router.
            // Laisser l'alias sur `field-renderer` l'aurait rendu inerte en silence — la suite
            // serait restée verte en ouvrant de vraies modales.
            // ⚠️ Le mock est désormais PARTIEL : `offline-ui` consomme neuf symboles de
            // `host-runtime` (`Log`, `tLabel`, `coreConfigGet`, `getGeoLeaf`,
            // `getUINotifications`, `fetchWithTimeout`…), pas trois. Il ré-exporte le module
            // réel et ne surcharge que les deux fonctions d'interface.
            {
                find: /^@geoleaf\/host-runtime$/,
                replacement: resolve(__dirname, "__mocks__/host-runtime.js"),
            },
            // @core/log → mock
            {
                find: /^@core\/log(\/index\.js)?$/,
                replacement: resolve(__dirname, "__mocks__/log.js"),
            },
            // @core/utils — specific mocks first, then core source fallback
            {
                find: /^@core\/utils\/general\/dom-helpers(\.js)?$/,
                replacement: resolve(__dirname, "__mocks__/dom-helpers.js"),
            },
            {
                // Pattern realigned on the real specifier, which carries a `general/` segment.
                // NOTE — like every alias here, this only governs TEST-file imports: source
                // files come in via `require()` + tsx, which resolves `@core/*` through
                // tsconfig paths to the real core source, bypassing Vite's aliases entirely.
                find: /^@core\/utils\/general\/event-listener-manager(\.js)?$/,
                replacement: resolve(__dirname, "__mocks__/event-listener-manager.js"),
            },
            {
                find: /^@core\/utils\/general\/dom-security(\.js)?$/,
                replacement: resolve(__dirname, "__mocks__/dom-security.js"),
            },
            // ARCHI S7 (7.3, geste 2) — `profile-layers` a quitté `capabilities/offline/`
            // pour le domaine profil/config. Il lui faut une entrée AVANT le catch-all
            // ci-dessous, sinon il serait routé vers le mock de `Config`, qui n'a rien à
            // voir. Mappé vers le source réel, comme `@core/shared/*`.
            {
                find: /^@core\/config\/profile-layers(\.js)?$/,
                replacement: `${coreRoot}/src/kernel/config/profile-layers.ts`,
            },
            // ─── API publique S4.4 — les sous-chemins PUBLIÉS du core ────────────────
            //
            // Les sources du plugin importent désormais `@geoleaf/core/kernel/config/…` et
            // `@geoleaf/core/capabilities/…` au lieu d'alias vers les sources du core : c'est
            // ce qui lui rend un `rootDir` et donc la publication de ses types. En TEST, Vite
            // doit résoudre ces specifiers vers les SOURCES (le `dist/` peut être absent ou
            // périmé pendant un run de test).
            //
            // ⚠️ Ce sont des fonctions PURES et sans import — leur embarquer une copie est
            // sans conséquence. Les singletons, eux, ne passent PAS par un import : ils sont
            // lus sur `globalThis.GeoLeaf`, sans quoi le plugin en obtient une seconde
            // instance jamais initialisée.
            {
                find: /^@geoleaf\/core\/kernel\/(.+)\.js$/,
                replacement: `${coreRoot}/src/kernel/$1.ts`,
            },
            {
                find: /^@geoleaf\/core\/capabilities\/(.+)\.js$/,
                replacement: `${coreRoot}/src/capabilities/$1.ts`,
            },
            // @core/config → mock
            { find: /^@core\/config\/.*$/, replacement: resolve(__dirname, "__mocks__/config.js") },
            // @core/shared → core source (canonical built-in/shared, matching tsconfig paths)
            {
                find: /^@core\/shared\/([^/]+)\.js$/,
                replacement: `${coreRoot}/src/kernel/shared/$1.ts`,
            },
            // @core-offline/* → in-core offline capability source (S14 Phase B — the UI
            // bundles the stateless CacheCalculator / resolveProfileLayers helpers).
            {
                find: /^@core-offline\/(.+)\.js$/,
                replacement: `${coreRoot}/src/capabilities/offline/$1.ts`,
            },
            // ─── Relative-path aliases — 6 REMOVED, backlog R.23 (24/07/2026) ────────
            //
            // Same class as the `@core/ui/notifications` removal noted further down
            // (PLUGINS S12): `.js`-only relative aliases that resolve nothing. Removed:
            //   ../indexeddb.js · ../core/indexeddb.js · (../)+log/index.js   [`core/` → `db/` au S8]
            //   ../../config/config-primitives.js
            //   ../../config/geoleaf-config/config-core.js · ../../utils/formatters.js
            //
            // Three converging proofs, measured rather than argued:
            //   1. No source or test here imports those specifiers (full sweep of `src/`).
            //   2. Mutation: neutralising all six left the suite at 162/162.
            //   3. Each mock keeps a canonical `@core/*` route (`@core/log` → log.js,
            //      `@core/config/*` → config.js, `@core/utils/general/formatters` →
            //      formatters.js). No mock lost its only path.
            //
            // `./indexeddb.js` and `./log/index.js` are DELIBERATELY kept: they were not
            // part of the mutation, so they are not part of the proof. An entry left in
            // by caution costs less than one removed on an assumption.
            {
                find: /^\.\/indexeddb\.js$/,
                replacement: resolve(__dirname, "__mocks__/indexeddb.js"),
            },
            // Cross-plugin / cascade-heavy deps stubbed out. Regex must match the WHOLE
            // specifier (anchored ^…$): a regex find does string.replace, so an un-anchored
            // suffix match would leave the "../../" prefix and produce a broken path. Any
            // relative depth + .js|.ts (resolveJsToTs rewrites .js→.ts).
            // ⚠️ STRUCT S8 — `sync/` → `cache/`. Cette entrée a été VUE MORTE avant d'être
            // corrigée : laissée périmée, 2 tests rougissent et le VRAI `cache-control.ts`
            // se charge à la place du stub. Elle garde donc quelque chose.
            {
                find: /^(\.\.\/)+cache\/cache-control\.(js|ts)$/,
                replacement: resolve(__dirname, "__mocks__/empty-module.js"),
            },
            { find: /^\.\/log\/index\.js$/, replacement: resolve(__dirname, "__mocks__/log.js") },
            // @core absolute aliases (used by plugin-storage src files)
            {
                find: /^@core\/utils\/general\/formatters(\.js)?$/,
                replacement: resolve(__dirname, "__mocks__/formatters.js"),
            },
            // PLUGINS S12 — l'alias `@core/ui/notifications` est retiré : plus AUCUNE
            // source du dépôt n'importe ce specifier. C'est le dernier reliquat du
            // doublon `ui/` (racine, mort) vs `src/ui/` (réel) : le répertoire est parti
            // à ARCHI S5.5/5.6, la paire alias + mock lui a survécu. Un alias qui ne
            // résout plus rien ne casse pas — il fait croire à un découplage entretenu.
        ],
    },
});
