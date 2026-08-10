/**
 * NYC Configuration — rapport de couverture du BOOT du bundle livré
 *
 * ⚠️ Ce fichier gouverne UN des six objets nommés « coverage » dans ce dépôt, qui
 * portent quatre sens distincts. La carte complète est dans
 * `docs/reference/ARCHITECTURE.md`, section « coverage — six objets, quatre sens ».
 * (Le renvoi disait `_docs_projet/ARCHITECTURE.md` : ce chemin était mort AVANT la
 * scission — le fichier a toujours vécu sous `reference/`.)
 * Ne jamais rapprocher ce chiffre de la couverture unitaire : autre code, autre chaîne.
 *
 * This configuration enables code coverage collection during E2E tests:
 * - Instruments source code for coverage tracking
 * - Generates reports in multiple formats
 * - Tracks real code execution in browser
 */

module.exports = {
    // No include filter — coverage data already only contains instrumented files
    // (rollup-plugin-istanbul include: ['src/modules/**', 'src/app/**'])

    // Files to exclude from coverage
    exclude: [
        "**/*.test.ts",
        "**/*.spec.ts",
        "__tests__/**",
        "tests/**",
        "coverage/**",
        "node_modules/**",
        "dist/**",
        "build/**",
    ],

    // Report formats
    reporter: [
        "text", // Console output
        "text-summary", // Brief summary
        "html", // HTML report in coverage-e2e/
        "lcov", // LCOV format for CI
        "json", // JSON for programmatic access
    ],

    // Output directory — T6.2. Valait `coverage-e2e` à la racine : déclaré depuis
    // toujours, JAMAIS créé sur le disque, faute de consommateur (`report:e2e` n'était
    // appelé par rien avant T6.1). Il existe enfin, autant qu'il naisse au bon endroit.
    reportDir: "artifacts/coverage-e2e",

    // Coverage thresholds (start conservative, increase over time)
    watermarks: {
        lines: [50, 80],
        functions: [50, 80],
        branches: [50, 80],
        statements: [50, 80],
    },

    // ── Seuils — recalibrés T6.1 (25/07/2026) ──────────────────────────────────
    //
    // ⚠️ CE QUE CES POURCENTAGES MESURENT, et les trois choses qu'ils NE sont PAS.
    //
    // Ils mesurent la couverture d'UN SEUL chargement de page, par UN SEUL spec
    // (`e2e/07-boot-sequence.spec.js`, seul appelant de `e2e/helpers/coverage.js` —
    // d'où le nom du fichier produit, `e2e-boot-sequence.json`), dans un vrai
    // Chromium, contre le BUNDLE LIVRÉ MINIFIÉ.
    //
    //   1. Ce n'est PAS « la couverture E2E ». La suite compte 36 specs. Trois autres
    //      visent la variante instrumentée (`20`, `21`, `22`) sans jamais dumper ; les
    //      32 restants tournent contre des deploys NON instrumentés, où
    //      `window.__coverage__` n'existe pas — ils ne peuvent pas contribuer.
    //   2. Ce n'est PAS la couverture unitaire de CLAUDE.md (92,07 % lignes). Celle-là
    //      mesure les SOURCES sous Node/jsdom, exercées par des suites écrites pour
    //      toucher chaque branche. Deux mesures de deux objets — jamais à réconcilier.
    //   3. Le dénominateur n'est PAS `core/src`. Seuls les 226 fichiers instrumentés
    //      par `packages/core/rollup.config.mjs:166` (`src/{api,globals,kernel,utils,
    //      app}`) y entrent. `src/capabilities/**` — 219 fichiers, 44 % de `core/src` —
    //      est absent du numérateur ET du dénominateur.
    //
    // Mesure du 25/07/2026, après remap source-map, sur 216 fichiers présents / 226 :
    //   lines 39,78 · statements 37,69 · functions 39,50 · branches 27,39
    // Seuils = mesure − ~10 % relatif, arrondis à l'entier inférieur. Cliquet VERS LE
    // HAUT uniquement, comme les seuils par paquet (CLAUDE.md).
    //
    // Les valeurs d'avant (8/10/8/8) étaient calibrées « ≤ baseline 8,8 % » AVANT R.9 :
    // le glob d'instrumentation valait alors `src/modules/**`, éclaté en quatre racines
    // et donc MORT — seul `app/` était instrumenté. Un seuil calibré sur une mesure
    // faussée n'attrape rien, même une fois câblé.
    //
    // ⚠️ Ces seuils ne suffisent pas à eux seuls : `nyc report` sort VERT sur un
    // `.nyc_output/` vide (`percent.js` renvoie 100 quand `total === 0`, `blankSummary()`
    // renvoie `pct: 'Unknown'`, et `'Unknown' < 35` vaut `false`). C'est
    // `scripts/verify-e2e-coverage.cjs` qui ferme ce trou, par un plancher de témoin.
    // Ne jamais câbler `report:e2e` nu comme étape de CI.
    checkCoverage: true,
    lines: 35,
    statements: 33,
    functions: 35,
    branches: 24,

    // Per-file coverage thresholds
    perFile: false,

    // Source maps
    sourceMap: true,
    produceSourceMap: true,

    // Instrumentation settings (false — already instrumented by rollup-plugin-istanbul)
    instrument: false,

    // All files mode — disabled for E2E (only report files that have coverage data)
    all: false,

    // File extensions to process
    extension: [".ts", ".js"],

    // Cache — DÉSACTIVÉ (T6.1). Il valait `.nyc_output`, c'est-à-dire EXACTEMENT le
    // `tempDir` ci-dessous. Or `nyc/index.js#coverageFileLoad` fait un `JSON.parse` sur
    // TOUT fichier du tempDir en avalant l'erreur (`return {}`) : un fichier de cache
    // déposé là aurait fait rétrécir la carte de couverture EN SILENCE, donc baisser le
    // chiffre sans que rien ne l'explique. `instrument: false` (le bundle arrive déjà
    // instrumenté par rollup-plugin-istanbul) rend ce cache inutile de toute façon.
    cacheDir: false,

    // Temp directory
    tempDir: ".nyc_output",

    // Clean output directory before tests
    clean: true,

    // Show process tree
    showProcessTree: false,

    // Skip coverage if no coverage data found
    skipFull: false,

    // Require additional modules
    require: [],

    // Exclude patterns (glob)
    excludeNodeModules: true,
};
