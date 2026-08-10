/**
 * Knip configuration — workspace keys DERIVED, per-package options declared.
 *
 * Replaces `knip.json` (ARCHI S9.4). The JSON form spelled out 19 workspace paths
 * by hand, and two of them — `packages/plugin-taxonomy` and
 * `packages/plugin-feature-info` — had pointed at directories deleted months
 * earlier (reclassified into `@geoleaf/core`, SR0). Knip silently ignores a
 * workspace key that matches nothing, so the rot was invisible: the config looked
 * maintained and audited two packages fewer than the repo contains.
 *
 * Two changes make that class of bug impossible rather than merely fixed:
 *
 *   1. **Keys are derived** from `package.json#workspaces` via
 *      `scripts/lib/packages.cjs`. They cannot name a package that is not there,
 *      and they follow ARCHI S10 moving plugins under `packages/plugins/` for free.
 *   2. **Options are keyed by npm NAME**, not by path — a name survives the move —
 *      and an option block naming an unknown package THROWS. A stale entry now
 *      fails the run instead of being ignored.
 *
 * The per-package options below are genuine configuration (differing entry points
 * and dependency exemptions), not duplication, so they stay written out.
 *
 * A third guard was added once the cost of NOT having it was measured — see
 * `assertNoShadowingConfig()` below.
 */

"use strict";

import fs from "node:fs";
import path from "node:path";

import registry from "./scripts/lib/packages.cjs";

/**
 * Options shared by every plugin that only exposes `src/entry.ts`.
 *
 * ⚠️ `ignoreDependencies: ["@geoleaf/core"]` ne vaut QUE pour les plugins qui déclarent le
 * core en dépendance sans rien en importer — ils l'atteignent par le global `window.GeoLeaf`,
 * que knip ne peut pas relier au paquet. Les 7 plugins qui importent désormais un type publié
 * (`GeoLeafRawEventMap`, API publique S3.3) n'en ont plus besoin et le retirent explicitement
 * ci-dessous : `check-dead-code.cjs` échoue sur une entrée de config qui ne matche plus rien,
 * précisément pour qu'une suppression ne survive pas à son motif.
 */
const PLUGIN_BASE = {
    // No `entry`. `src/entry.ts` was declared here until the knip 6 bump (26/07/2026),
    // which flagged it redundant for all 13 plugins at once: knip's own default entry
    // patterns already cover it. Declaring it again is the same class of lie this file
    // exists to prevent — a config entry that describes work knip does anyway.
    project: ["src/**/*.ts"],
    ignoreDependencies: ["@geoleaf/core"],
};

/**
 * Options shared by plugins that also expose a public API and i18n dictionaries.
 *
 * `src/entry.ts` is NOT listed — see `PLUGIN_BASE`. The other two are not covered by
 * knip's defaults and must stay: `public-api.ts` is a root nothing imports, and the
 * `lang/*.ts` dictionaries are reached by dynamic key.
 */
const PLUGIN_WITH_API = {
    entry: ["src/public-api.ts", "src/lang/*.ts"],
    project: ["src/**/*.ts"],
    ignoreDependencies: ["@geoleaf/core"],
};

/** Même base, pour les plugins qui importent réellement `@geoleaf/core` (S3.3). */
const PLUGIN_BASE_IMPORTS_CORE = { ...PLUGIN_BASE, ignoreDependencies: [] };
const PLUGIN_WITH_API_IMPORTS_CORE = { ...PLUGIN_WITH_API, ignoreDependencies: [] };

/**
 * Options shared by the internal libraries (no `register()`, plain index entry).
 *
 * No `entry`: knip already derives one from `package.json#main`, and for
 * `host-runtime` (`main: dist/index.js`) it resolves straight back to
 * `src/index.ts` — spelling it out was redundant, and knip said so.
 *
 * ⚠️ The exemption `field-renderer` used to carry here is GONE. This comment claimed it
 * needed `entry: ["src/index.ts"]` declared because its `main` is
 * `dist/geoleaf-field-renderer.js`, which maps to no source file by name. Under knip 6
 * (bump du 26/07/2026) that declaration is flagged redundant like all the others, so the
 * derivation evidently no longer depends on the `main` filename. Removed, and re-measured
 * rather than reasoned about — the whole point of the blocking hints.
 */
const LIB_BASE = {
    project: ["src/**/*.ts"],
    ignoreDependencies: [],
};

/**
 * Per-package overrides, keyed by npm name.
 * A name absent from the workspace registry throws — see the assertion below.
 */
const BY_NAME = {
    "@geoleaf/core": {
        // API S2.4 — sans `entry`, knip retombait sur des défauts qui ne couvraient rien
        // d'utile ici. Ces six patrons sont les points d'entrée réels du paquet : l'entrée
        // livrée, la moitié kernel, les trois côtés à effet de bord du boot, et les
        // installeurs de capacité (chacun est une racine, aucun n'est importé par l'entrée).
        entry: [
            "src/bundle-esm-entry.ts",
            "src/kernel-exports.ts",
            "src/globals/globals.ts",
            "src/app/app-namespace.ts",
            "src/app/boot-install.ts",
            "src/capabilities/*/install.ts",
        ],
        project: ["src/**/*.ts"],
        ignoreDependencies: ["eslint", "eslint-plugin-security", "tsx"],
    },

    // Plugins — entry only.
    // ⚠️ API publique S4.4c — `paths` déclaré ICI, pour les TESTS seuls.
    //
    // Les alias `@core/*` et `@core-offline/*` vivaient dans le `paths` du tsconfig, d'où knip
    // les lisait. Ils en ont été retirés : le code LIVRÉ n'en a plus aucun, et les garder
    // aurait maintenu les sources du core dans le programme, donc interdit le `rootDir` que la
    // publication des types exige.
    //
    // Les fichiers de TEST en gardent 6 — ils sont résolus par les alias Vite de
    // `vitest.config.ts`, que knip ne lit pas. Sans cette déclaration il les signale
    // « unlisted », ce qui est exact et inutile : ils sont résolus, mais ailleurs.
    "@geoleaf-plugins/offline-ui": {
        ...PLUGIN_BASE_IMPORTS_CORE,
        paths: {
            "@core/*": ["../../core/src/kernel/*"],
            "@core-offline/*": ["../../core/src/capabilities/offline/*"],
        },
    },
    "@geoleaf-plugins/cog": PLUGIN_BASE,
    "@geoleaf-plugins/flatgeobuf": PLUGIN_BASE,
    "@geoleaf-plugins/file-import": {
        ...PLUGIN_BASE,
        ignoreDependencies: ["@geoleaf/core", "topojson-specification"],
    },
    "@geoleaf-plugins/geocoding": PLUGIN_BASE_IMPORTS_CORE,
    // `happy-dom` retiré au bump knip 6 : l'exemption ne matchait plus rien. Ironie utile —
    // c'est knip qui avait DÉTECTÉ cette dépendance non déclarée en premier lieu (cf. CHANGELOG
    // du 22/07), et c'est knip qui signale maintenant que l'exemption a fait son temps.
    "@geoleaf-plugins/connector": PLUGIN_BASE,

    // Plugins — entry + public API (+ i18n).
    "@geoleaf-plugins/table": { ...PLUGIN_WITH_API_IMPORTS_CORE, ignore: ["**/__tests__/**"] },
    // `ignore: __tests__` retiré au bump knip 6 : il ne matchait plus rien (hint bloquant).
    // Ses homonymes sur `addpoi`, `print` et `table` en matchent encore — donc ce n'est pas
    // un changement global de knip, c'est que le périmètre de test de measure a bougé.
    "@geoleaf-plugins/measure": PLUGIN_WITH_API_IMPORTS_CORE,
    "@geoleaf-plugins/print": {
        ...PLUGIN_WITH_API_IMPORTS_CORE,
        ignore: ["**/__tests__/**"],
    },
    // `ignoreDependencies: ["geojson"]` retiré le 10/08/2026 : il taisait un signal que
    // `@types/geojson` produisait tant qu'il n'était pas déclaré. B-212 l'a déclaré en
    // `dependencies` (six `.d.ts` publiés en dépendent), donc knip ne le signale plus, donc
    // le silencieux n'a plus rien à taire — et knip le dit lui-même (`knip-hint`). L'entrée
    // disparaît AVEC SON SUJET, comme l'exemption de SYNC-02 au Sprint 8.
    // ⚠️ Mesuré des deux côtés avant retrait : réintroduire `@types/geojson` sans cette ligne
    // → knip VERT ; la retirer du manifeste → knip vert aussi. Seule la combinaison
    // « déclaré + silencieux » est rouge. Le retrait RESSERRE la gate, il ne la relâche pas.
    "@geoleaf-plugins/editor": PLUGIN_WITH_API_IMPORTS_CORE,
    "@geoleaf-plugins/realtime-layer": {
        // `src/entry.ts` retiré au bump knip 6 — couvert par les patrons par défaut.
        entry: ["src/public-api.ts"],
        project: ["src/**/*.ts"],
        ignoreDependencies: ["@geoleaf/core"],
    },
    "@geoleaf-plugins/websocket": {
        // `src/entry.ts` retiré au bump knip 6 — couvert par les patrons par défaut.
        entry: ["src/public-api.ts"],
        project: ["src/**/*.ts"],
        ignoreDependencies: ["@geoleaf/core"],
    },

    // The deployable application (T2). Its files are loaded by `index.html` through
    // `<script type="module">`, so nothing in the JS graph ever imports them — without
    // a declared entry knip falls back on its defaults, finds no root, and reports them
    // as unused files. Measured after the move: 1 new signal, on
    // `connector.local.example.js`. It is a TEMPLATE (copied to the git-ignored
    // `connector.local.js`), so it can only ever be a declared root — never an
    // `ignore`, which would hide a genuinely dead file. `project: ["*.js"]` bounds the
    // scan to the workspace root: `src/assets/` holds nothing but PNGs.
    //
    // `init.js` is NOT listed: knip's default entry patterns already cover it, and
    // declaring it again earned a "redundant entry pattern" hint the moment T2 landed.
    "@geoleaf/app": {
        entry: ["connector.local.example.js"],
        project: ["*.js"],
    },

    // Internal libraries.
    "@geoleaf/field-renderer": LIB_BASE,
    "@geoleaf/host-runtime": LIB_BASE,
};

// ─── Guard: no other knip config may exist ────────────────────────────────────

/**
 * Config files knip looks for, in ITS resolution order
 * (`node_modules/knip/dist/constants.js#KNIP_CONFIG_LOCATIONS`).
 * Everything before `knip.js` wins over this file.
 */
const CONFIG_LOCATIONS = [
    "knip.json",
    "knip.jsonc",
    ".knip.json",
    ".knip.jsonc",
    "knip.ts",
    "knip.js",
    "knip.config.ts",
    "knip.config.js",
];

/**
 * Fail on any knip config other than this one.
 *
 * Two distinct failure modes, both silent, both observed in this repo:
 *
 *   1. **A root config of higher priority masks this file.** Knip loads exactly ONE
 *      config, the first match in `CONFIG_LOCATIONS` (`util/create-options.js`).
 *      Re-introducing `knip.json` at the root would therefore disable every rule
 *      below — no warning, no diff in the output shape, just a different answer.
 *   2. **A per-package config that nothing reads.** `findFile()` is `join` + `isFile`:
 *      it does NOT walk up. A `knip.json` inside a package is only ever read when knip
 *      runs with that package as cwd. `packages/core/knip.json` lived like that for
 *      months — 20 `ignoreIssues` rules and 10 `ignoreDependencies` that the CI gate
 *      never applied, while reading as maintained configuration.
 *
 * The tell is identical in both cases: the config looks authoritative and isn't. So
 * this throws, like the stale-override check below and like `packages.cjs` itself.
 */
function assertNoShadowingConfig() {
    /** @type {string[]} */
    const offenders = [];

    for (const name of CONFIG_LOCATIONS) {
        if (name === "knip.js") continue; // this file
        if (fs.existsSync(path.join(registry.ROOT, name))) offenders.push(name);
    }

    for (const pkg of registry.all()) {
        for (const name of CONFIG_LOCATIONS) {
            if (fs.existsSync(path.join(pkg.absDir, name))) offenders.push(`${pkg.dir}/${name}`);
        }
    }

    if (offenders.length > 0) {
        throw new Error(
            `knip.js: ${offenders.length} competing knip config file(s) — ${offenders.join(", ")}. ` +
                `Knip loads a single config from its cwd and never walks up, so each of these ` +
                `either masks knip.js (root, higher priority) or is dead weight nothing reads ` +
                `(per-package). Delete them; this file is the only configuration.`
        );
    }
}

assertNoShadowingConfig();

// ─── Derive the workspace map ─────────────────────────────────────────────────

const packages = registry.all();
const known = new Set(packages.map((p) => p.name));

// A stale override is now a hard failure. This is exactly what the two dead
// `plugin-taxonomy` / `plugin-feature-info` keys did NOT do for months.
for (const name of Object.keys(BY_NAME)) {
    if (!known.has(name)) {
        throw new Error(
            `knip.js: options declared for "${name}", which is not a workspace package. ` +
                `Known: ${[...known].sort().join(", ")}`
        );
    }
}

/** @type {Record<string, object>} */
const workspaces = {
    ".": {
        // `"knip.js"` retiré au bump knip 6 : couvert par les patrons par défaut (hint
        // bloquant). Sa présence était de toute façon inerte — CHANGELOG du 25/07 :
        // un fichier de config racine est structurellement insignalable, puisque
        // `*.config.{cjs,mjs,js,ts}` en fait déjà un point d'entrée.
        entry: ["scripts/**/*.{cjs,mjs,js}", "e2e/**/*.{js,cjs,mjs}", "*.config.{cjs,mjs,js,ts}"],
        project: ["scripts/**/*.{cjs,mjs,js}", "e2e/**/*.{js,cjs,mjs}"],
        ignoreDependencies: [
            "gtfs-realtime-bindings",
            "axe-core",
            "minimatch",
            "glob",
            "ajv",
            "ajv-formats",
            "flatbuffers",
            "flatgeobuf",
            "geojson-vt",
            "vt-pbf",
            "geotiff",
            "fflate",
            "http-server",
            // `lint-staged` retiré au bump knip 6 : l'exemption ne matchait plus rien.
            "madge",
            "serve",
            // ⚠️ `sharp` est le seul de cette liste à être `unlisted` et non `unused` :
            // `generate-pwa-icons.cjs` le `require()` alors que RIEN ne le déclare, et c'est
            // voulu. Sorti des devDependencies le 09/08/2026 parce qu'il faisait échouer
            // `npm ci` sur TOUTE PR Dependabot (son `@img/sharp-wasm32` tire `@emnapi/*`, que
            // la régénération de lockfile ne hisse pas — cf. B-192), et qu'il portait un avis
            // HIGH (`<0.35.0`) pour un script câblé dans aucune gate. Le `require` est derrière
            // un `try/catch` qui imprime la commande d'installation à la demande.
            // 🛑 Retirer cette ligne ne « nettoie » rien : elle rendrait la gate rouge, ou
            // pousserait à re-déclarer `sharp` — ce qui rouvrirait les deux défauts d'un coup.
            "sharp",
            // ⚠️ CES CINQ-LÀ NE SONT IMPORTÉES PAR RIEN, ET C'EST TOUT LEUR OBJET (09/08/2026).
            //
            // Elles sont déclarées en devDependencies UNIQUEMENT pour créer une arête NON
            // OPTIONNELLE depuis la racine. Sans elle, elles n'existent dans l'arbre que par
            // des chaînes `optional: true` (les bindings `@oxc-*/binding-wasm32-wasi` et
            // `@napi-rs/wasm-runtime` pour `@emnapi/*` ; `@asamuzakjp/css-color` via happy-dom
            // pour les `@csstools/*`), et la régénération de lockfile de Dependabot les
            // RE-HISSE ailleurs — mesuré : `@emnapi/*` déplacés sous
            // `packages/build-config/node_modules/`. `npm ci` ne les retrouve alors plus depuis
            // la racine et meurt en EUSAGE avant toute gate. C'est ce qui rendait TOUTE PR
            // Dependabot rouge, y compris celles qui ne montent qu'un seul paquet (cf. B-192).
            //
            // ⚠️ CORRECTIF EMPIRIQUE, et il faut le dire : **112 entrées racine sont
            // `optional: true` et seules CES CINQ échouent**. La classe n'est donc PAS
            // « entrée racine optionnelle » — `dompurify`, `jsdom`, `undici` le sont aussi et
            // traversent sans rien casser. Ce qui les distingue n'est pas caractérisé. On
            // traite les cinq mesurées, on ne prétend pas avoir fermé le mécanisme.
            //
            // 🛑 Leur retrait ne se décide pas au vu de « personne ne les importe » — c'est
            // vrai et hors sujet. Il se décide en observant la couleur d'une PR Dependabot.
            "@csstools/css-parser-algorithms",
            "@csstools/css-tokenizer",
            "@emnapi/core",
            "@emnapi/runtime",
            "@emnapi/wasi-threads",
        ],
    },
};

// A package with no declared options is not an error — it takes knip's defaults.
// A package that disappears from the registry simply stops being configured, which
// is correct: it no longer exists.
for (const pkg of packages) {
    const options = BY_NAME[pkg.name];
    if (options) workspaces[pkg.dir] = options;
}

// ─── Issue types: exports/types are OFF on the core, and only there ───────────

/**
 * Suppress the `exports` and `types` issue types under `packages/core/src/**`.
 *
 * ## Why, measured
 *
 * When the core entered knip's field of view at API S2.4b, it produced 160 signals in
 * one go. They were triaged one by one against the whole monorepo (API S2.4c):
 *
 *   | verdict                                        | count |
 *   | consumed by shipped code — knip false positive |  116  |
 *   | used inside its own file                       |   39  |
 *   | consumed by tests only                         |    3  |
 *   | already exempt with a written motive           |    1  |
 *   | **actionable dead code**                       |  **0** |
 *
 * The 116 are barrel semantics, not debt: a symbol re-exported through an `index.ts`
 * is reported twice — once at the barrel because consumers import the deep path, once
 * at the deep path because they import the barrel. 14 symbols accounted for 30 of the
 * baseline rows on their own (`ValidateUrlOptions` alone appeared 4 times).
 *
 * So this category cost 157 frozen baseline rows for zero findings, at a ~73 % false
 * positive rate — which is also the odds that any FUTURE alarm here would be wrong.
 * A tripwire that cries wolf three times out of four is not a tripwire.
 *
 * ## Why `ignoreIssues` and not `exclude`
 *
 * Root-level `exclude: ["exports","types"]` was measured too, and rejected: it blinds
 * the 13 plugins and 2 libs as well. They report nothing today because they are clean
 * — silent is not the same as absent, and the API S2.4 probes proved knip DOES see a
 * dead export in `packages/plugins/table` and `packages/libs/field-renderer`. Scoping
 * by path keeps that watch alive. It also leaves the `__tests__` ignore entries of
 * `measure`/`print`/`table` doing real work; under `exclude` all three went dead and
 * raised blocking config hints.
 *
 * (⚠️ Do not spell a `slash-star-star` glob inside this comment — the sequence closes
 * the block and the remainder parses as code. That is how the first draft of this
 * header failed, with `ERROR: __tests__ is not defined`.)
 *
 * ## What still covers the core's exports
 *
 * `scripts/check-orphan-exports.cjs`, and now alone. Its 74 baseline candidates were
 * measured on 25/07/2026 as 51 invisible to knip and 23 overlapping; after this scope
 * the overlap is 0 and it is the sole gate on that angle. It searches by token across
 * the whole repo — including the literal VALUES of string consts, registry keys and
 * event names — which is precisely the class an import graph cannot reach.
 *
 * ⚠️ Only `exports` and `types` are listed. `nsExports`, `nsTypes`, `enumMembers` and
 * `classMembers` produce no signal in this repo, so listing them would raise a config
 * hint. ⚠️ `files` is deliberately absent: the one real find of the whole exercise —
 * `packages/core/src/contracts/sidepanel-renderer.contract.ts`, backlog **B-22** — is a
 * file-level signal and must keep being reported. Removing `files` too would turn this
 * gate into a dependency checker and drop the only genuine finding it ever made.
 *
 * ## The gate was SEEN red on this scope — 26/07/2026, re-run under knip 6.29.0
 *
 * A narrowed guard nobody watched fail guards nothing. Each probe was injected, the exit
 * code checked, then removed. Every row was re-run after the 6.29.0 bump, because the
 * bump changed the config materially and probes from the previous version prove nothing
 * about this one:
 *
 *   | probe                                                | `dead-code` | verdict |
 *   | orphan `src/__probe_dead_file.ts` in plugins/table   | exit 1      | `file` reported |
 *   | dead exported CONST in plugins/table/src/sort.ts     | exit 1      | `exports` reported — **plugins still watched** |
 *   | dead exported INTERFACE in the same file             | exit 1      | `types` reported — see below |
 *   | dead export in core/src/utils/general-utils.ts       | exit 0      | **silent — scope is bounded** |
 *   | `probe-dead-config-entry` in ignoreDependencies      | exit 1      | blocking hint, not baselineable |
 *   | dep `probe-unused-dep` in plugins/table/package.json | exit 1      | `dependencies` reported |
 *
 * Rows 2 and 4 are the pair that justifies `ignoreIssues` over `exclude`: the same dead
 * export is caught in a plugin and ignored in the core, which is exactly the asymmetry
 * intended. Row 3 is the control on `ignoreExportsUsedInFile` below — it proves that
 * setting suppresses types referenced INSIDE their own file, not types referenced
 * nowhere. Without that row, `interface: true` could have been silently disabling the
 * whole `types` category. To re-run, re-inject any row and check the exit code flips.
 */
const IGNORE_ISSUES = {
    "packages/core/src/**": ["exports", "types"],
};

/**
 * An exported `interface` or `type` referenced inside its own file is not dead.
 *
 * Added at the knip 6 bump (26/07/2026), which surfaced 18 unused exported types in the
 * PLUGINS that knip 5.85 did not report. Pre-flighted one by one before believing them,
 * and they are a single structural class — the declaration and its only reference sit in
 * the same file:
 *
 *   - `TableLayerConfig`  declared `table-types.ts:87`      → used `table-types.ts:100`
 *   - `HeartbeatConfig`   declared `config-schema.ts:23`    → used `config-schema.ts:50`
 *   - `JwtAuth`           declared `i-ws-transport.ts:46`   → used `i-ws-transport.ts:40`
 *
 * These are each plugin's published type surface: an integrator consumes them through the
 * shipped `.d.ts`, which no module graph can see. `JwtAuth` is worse still — the one
 * cross-file consumer, `config-schema.ts:45`, reaches it by inline
 * `import("./transports/i-ws-transport.js").JwtAuth`, a dynamic type import knip does not
 * resolve to a named import.
 *
 * This is the same bucket as the 39 "used inside its own file" verdicts of the core triage
 * (API S2.4c), so it gets the same answer — a stated rule about a structural property,
 * NOT 18 frozen baseline rows. A rule can be argued and re-measured; a baseline of
 * structural false positives just accumulates.
 *
 * ⚠️ Scoped to `interface` and `type` on purpose. Values (`function`, `class`, `enum`,
 * `member`) keep being reported: a dead exported FUNCTION referenced only by itself is a
 * genuine finding, and this repo has no measurement saying otherwise.
 */
const IGNORE_EXPORTS_USED_IN_FILE = {
    interface: true,
    type: true,
};

export default {
    workspaces,
    ignoreIssues: IGNORE_ISSUES,
    ignoreExportsUsedInFile: IGNORE_EXPORTS_USED_IN_FILE,
};
