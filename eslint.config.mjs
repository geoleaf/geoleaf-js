// @ts-check
import js from "@eslint/js";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import security from "eslint-plugin-security";
import { createRequire } from "node:module";

// The workspace registry is CJS (it is shared with ~10 `.cjs` gates), so it is
// loaded through createRequire rather than converted — see scripts/lib/packages.cjs.
const registry = createRequire(import.meta.url)("./scripts/lib/packages.cjs");

// ── Type-hardening ratchet (roadmap_typage-strict.md) ───────────────────────
// Globs where `@typescript-eslint/no-explicit-any` is elevated to "error".
// EXTEND at the end of each sprint once a directory is cleaned AND green.
// NEVER remove an entry — this is a one-way ratchet (no regression).
const ANY_HARDENED = [
    // `app/lazy-module-loader.ts` (S0 baseline) dropped in S5 — the FILE is gone with the
    // lazy machinery, not the rule. Removing a ratchet entry whose target no longer exists
    // does not loosen enforcement on any line of code; do not read it as a precedent.
    "packages/core/src/app/module-registry.ts", // pre-existing (S0 baseline)
    // ↓ add cleaned directories here as each sprint clears them (one-way ratchet).
    "packages/core/src/kernel/ui/**/*.ts", // S2.1 — 0 any, tsc+tests green
    "packages/core/src/kernel/themes/**/*.ts", // S2.2 — 0 any, tsc+tests green
    "packages/core/src/kernel/map/**/*.ts", // S2.3 — 0 any, tsc+tests green
    "packages/core/src/kernel/geojson/**/*.ts", // S3.1 — 0 any, tsc+tests green
    "packages/core/src/kernel/layer-manager/**/*.ts", // S3.2 — 0 any, tsc+tests green
    "packages/core/src/utils/loaders/**/*.ts", // S3.2 — 0 any, tsc+tests green
    // CAPACITÉS S10 — 4 entries removed here, under the precedent recorded above:
    // `utils/renderers/**` (S2.3), `built-in/poi/**` (S4.1), `built-in/filters/**` (S4.2)
    // and `modules/optional/**` (S5). Their directories were emptied by later sprints and
    // the globs had been matching ZERO files since — dead weight, not enforcement. Removing
    // a ratchet entry whose target no longer exists does not loosen enforcement on any line
    // of code; the S6 catch-all below covers every file they ever did. This is the same
    // reading as the `app/lazy-module-loader.ts` note above, and it is not a precedent for
    // removing an entry that still matches something.
    //
    // They went unnoticed because `probe-gate-visibility.cjs` only armed the PLUGIN ratchet;
    // its family B now reads BOTH lists straight out of this file, so the next dead glob
    // fails the probe instead of accumulating.
    "packages/core/src/**/*.ts", // S6 — whole core hardened (basemaps/api/permalink/data/contracts/app/adapters/globals + tail); __tests__ excluded by block ignores. 2 documented irreducibles (storage-contract DB, notifications overload). Covers capabilities/taxonomy + capabilities/feature-info (reclassified in-core, SR0).
];

// ── Type-hardening ratchet — PLUGINS (roadmap_typage-plugins.md) ────────────
// Globs where `@typescript-eslint/no-explicit-any` is elevated to "error", for
// the PLUGIN packages. Deliberately a SEPARATE constant + block (6quater below)
// from the core ANY_HARDENED: each list lives in its own file zone so parallel
// branches (e.g. feature/capacites-extraction, which also extends the core
// ratchet) never share a git hunk with this one. Same one-way rule: never remove.
// ARCHI S9.5 — the ratchet now names PACKAGES and derives their globs, instead of
// writing 14 `packages/<dir>/src/**/*.ts` paths by hand.
//
// This entry was in no task of ARCHI S9 or S10, and it is the most dangerous
// instance of the class both sprints target. A hard-coded glob does not fail when
// its path stops existing — it silently matches nothing. So once ARCHI S10 moves
// these packages under `packages/plugins/` and `packages/libs/`, all 14 globs would
// have matched zero files and `no-explicit-any` would have quietly dropped back to
// "warn" across every plugin. A one-way ratchet would have been released, with a
// green lint run and no diff to point at.
//
// Which packages are hardened stays an explicit, hand-maintained list: it is a
// policy (a package earns its lock by reaching 0 `any`), not a fact that can be
// read off the repo. Deriving it would auto-enroll any new package and break the
// build on its first `any`. Only the PATHS are derived — and an unknown name now
// throws, so a rename surfaces here instead of silently unlocking a package.
const ANY_HARDENED_PLUGIN_PACKAGES = [
    // S0 — free locks: plugin packages already at 0 explicit `any` (count-any.cjs).
    "@geoleaf-plugins/offline-ui",
    "@geoleaf-plugins/cog",
    "@geoleaf-plugins/connector",
    "@geoleaf-plugins/file-import",
    "@geoleaf-plugins/realtime-layer",
    "@geoleaf-plugins/websocket",
    "@geoleaf-plugins/geocoding",
    "@geoleaf-plugins/table",
    "@geoleaf-plugins/measure", // S1 — 57 any → 0 (MapLibre frontier typed via MeasureMap; namespace via getGeoLeaf)
    "@geoleaf-plugins/print", // S2 — 29 any → 0 (native map + offscreen typed via maplibre-gl type-only)
    "@geoleaf-plugins/editor", // S2 — 15 any → 0 (EditorMap frontier; terra-draw generic adapter)
    "@geoleaf-plugins/flatgeobuf", // S3a — 4 any → 0 (namespace + FGB iterator header via structural casts)
    "@geoleaf/field-renderer", // S3a — 2 any → 0 (globalThis structural cast for I18n)
    // PLUGINS S11.2 — free lock (0 any, 8/8 files). Locks the utilities consolidated into
    // host-runtime at S1 (css-adopt/touch-drag/notify-seam/host). A lib in a
    // `*_PLUGIN_PACKAGES` list is already established — `@geoleaf/field-renderer` above is
    // one; the constant is effectively "hardened non-core packages". pkgGlob() resolves the
    // path by NAME and throws on an unknown one, so a rename surfaces here.
    "@geoleaf/host-runtime",
];

/**
 * Repo-relative path inside a workspace package, resolved by npm NAME.
 *
 * ARCHI S10.1 — every `files:`/`ignores:` glob naming a package must go through
 * here. A glob that stops matching does NOT fail: it silently changes which rules
 * apply to a file. The move proved both directions of that — the two exemption
 * blocks below detached and lint suddenly reported complexity errors (visible),
 * while a *restriction* block detaching would have dropped rules with nothing to
 * show for it (invisible, and far worse).
 *
 * An unknown name throws, so a rename surfaces here instead of silently changing
 * the linted surface.
 *
 * @param {string} name npm package name, e.g. "@geoleaf-plugins/offline-ui"
 * @param {string} rest glob suffix, e.g. "src/**"
 */
function pkgGlob(name, rest) {
    const pkg = registry.byName(name);
    if (!pkg) {
        throw new Error(
            `eslint.config.mjs: "${name}" is referenced by a lint rule but is not a workspace ` +
                `package. A glob that matches nothing changes the applied rules in silence — fix ` +
                `the name rather than dropping the entry.`
        );
    }
    return `${pkg.dir}/${rest}`;
}

const ANY_HARDENED_PLUGINS = ANY_HARDENED_PLUGIN_PACKAGES.map((name) =>
    pkgGlob(name, "src/**/*.ts")
);

// KERNEL S14 — layering boundary: `modules/` (implementation) must not import
// `app/` (boot orchestration). The dependency runs one way: app/ composes modules,
// never the reverse. KERNEL S13 studied this and found 27 imports in the right
// direction and exactly 2 inverse edges, both on the SAME symbol
// (`CapabilityRegistry`) — a misplaced symbol, not a porous boundary. S14 moved it
// to `kernel/api/`, which is what makes this rule postable without an
// exception. Do not add an allowlist here: an exception would re-open the hole the
// move just closed.
//
// ⚠️ Spread into EVERY block that sets `no-restricted-imports` on files under
// `modules/`. ESLint flat config OVERRIDES (does not merge) a rule when a later
// block matches the same file — so the `ui/mobile` and `ui/desktop` blocks below,
// which live under `modules/`, would silently drop this boundary if they set the
// rule without re-including it.
const KERNEL_APP_BOUNDARY = {
    group: ["**/app/*", "**/app/**"],
    message:
        "kernel layer must not import app/ — the dependency runs app/ → (api|globals|kernel|utils), never the reverse (KERNEL S13 study, S14 move; the four roots replaced modules/ at R.9). Put the shared symbol in kernel/ instead.",
};

/** @type {import("eslint").Linter.Config[]} */
export default [
    // ── 1. Global ignores ──────────────────────────────────────────────────────
    {
        ignores: [
            "node_modules/",
            "**/node_modules/",
            "**/dist/",
            "**/coverage/",
            // Q1.7 — `"**/*.min.js"` retiré : 0 fichier dans le dépôt (mesuré
            // `git ls-files | grep '\.min\.js$'`). Le projet ne minifie que dans `dist/`
            // et `deploy/`, tous deux déjà ignorés ci-dessus et au-dessous, et sans
            // suffixe `.min`. Une exemption qui ne matche rien est bénigne dans CE sens
            // (elle rend la règle plus stricte, pas moins) mais elle se lit comme une
            // contrainte réelle, et personne ne saurait plus dire ce qu'elle protège.
            // Hand-authored toolchain config files (build / test-runner / coverage).
            // Out of runtime scope and infra-only; some are CommonJS (nyc.config.cjs)
            // which the module-mode base block cannot parse. Audited & kept ignored (S3.5).
            // NB: jest.config.js was removed here — the project runs on Vitest, no Jest config exists.
            "**/rollup.config.mjs",
            "**/postcss.config.mjs",
            "eslint.config.mjs",
            "vitest.config.ts",
            "playwright.config.js",
            "nyc.config.cjs",
            // Generated artifact directories — never lint
            "deploy/",
            // T6.2 — le répertoire unique des rapports de run. Il porte du JS de
            // FOURNISSEUR : `prettify.js`, `sorter.js`, `block-navigation.js` (rapport
            // HTML istanbul), qu'aucun autre `ignores` ne couvre — `**/coverage/` ne
            // matche pas le composant `coverage-e2e`, et rien ne couvre
            // `artifacts/playwright/report`.
            //
            // ⚠️ Entrée DÉFENSIVE, pas load-bearing — et c'est une mesure, pas une
            // supposition. Le plan de sprint l'annonçait « obligatoire, sans quoi
            // `npm run lint` passe au rouge au premier rapport istanbul ». Vérifié :
            // la retirer laisse `npx eslint .` en exit 0, ces fichiers-là ne déclenchant
            // aucune règle de ce config. En revanche ESLint les LINTE bien — témoin
            // synthétique `var x = 1; y = 2;` déposé sous `artifacts/`, ignore retiré :
            // 2 erreurs. La ligne protège donc d'un futur JS de rapport moins docile,
            // pas d'un rouge actuel. Le flat config ne saute pas un répertoire gitignoré.
            "artifacts/",
            // T4.4 — sorti de `packages/`. ⚠️ Édition OBLIGATOIRE et non évidente : ce
            // répertoire porte 129 fichiers `.js` (chunks VitePress hashés) qu'aucun autre
            // `ignores` ne couvre — `**/dist/` ne matche pas le composant `docs-dist`, et
            // les chunks ne s'appellent pas `*.min.js`. Sans cette ligne, `npm run lint`
            // (gate `ci:local` + étape `ci.yml`) passe au rouge au premier `docs:build`.
            "docs-dist/",
            // T4.1 — l'entrée était `packages/core/docs/` EN ENTIER, ce qui silençait
            // trois SOURCES rédigées : `.vitepress/config.ts` (179 L), `theme/index.ts`
            // et `theme/custom.css`. Seuls les deux arbres générés sont des artefacts.
            // Alignement dans le bon sens : on RESTREINT l'ignore ESLint, on n'élargit
            // pas `.gitignore` — sinon on gitignorerait du TypeScript écrit à la main.
            // Même liste de formes que `scripts/lib/generated-artifacts.cjs`.
            "packages/core/docs/api/",
            "packages/core/docs/public/",
            // Plugin scaffold template — placeholder __PLUGIN_*__ tokens are not
            // valid TS/identifiers; consumed by scripts/create-plugin.cjs, never built.
            "packages/_plugin-template/",
            // Local archive — git-untracked one-shot scripts (py/cjs), experimental
            // churn. Confirmed out of scope (S3.5).
            "_archive_local/",
            // Agent worktrees — full copies of the repo at some past commit. They are
            // git-excluded (.git/info/exclude) but that says nothing to ESLint, so a stale
            // copy was being linted as if it were source: ~2700 files scanned, about half
            // of them duplicates, contributing 428 phantom `any` errors from code that
            // predates the ratchet. Their paths also dodge the ANY_HARDENED globs (anchored
            // at the repo root), so a worktree can never be hardened — only ignored. (S7)
            ".claude/",
            // Operator-run build/CI/deploy scripts (CommonJS, ~24.5k LOC over 75 files —
            // mesuré au Q1.7 ; le commentaire annonçait « ~5.6k LOC », sous-estimé d'un
            // facteur 4,4, et la ligne B.1 du backlog dit 20 206 / 66, à recaler aussi).
            // Out of runtime
            // scope, not attacker-reachable: console.* output is their contract, and fs/regex
            // paths derive from __dirname literals + operator CLI args, so eslint-plugin-security
            // would only emit noise. Linting them needs a dedicated sourceType:"commonjs" +
            // heavily-relaxed override yielding ~0 real findings. Kept ignored (S3.5) — re-evaluate
            // only if a script ever handles untrusted input.
            //
            // T3.5 — le glob était `**/scripts/**/*.{cjs,js}`, et son commentaire nommait
            // « the stray plain-CJS .js maintenance scripts under packages/core/scripts/ ».
            // Le T3.2 a supprimé ce répertoire — le SEUL `scripts/` de package du dépôt —,
            // donc la moitié « package » du glob ne matchait plus rien et le commentaire
            // était devenu faux. Réduit à la racine.
            //
            // Q1.7 — le doublon `"scripts/**/*.{cjs,js}"` est retiré à son tour. Le T3.5
            // l'avait gardé « pour les fichiers », en supposant que `"scripts/"` ne couvrait
            // que les répertoires. MESURÉ : `npx eslint scripts/ci-local.cjs` → « File ignored
            // because of a matching ignore pattern » avec la seule entrée `"scripts/"`.
            // Le second motif ne changeait donc rien, et sa justification décrivait un
            // comportement d'ESLint qui n'est pas le sien.
            // Demo extensions — explicitly non-production code
            // ("must NOT be deployed" / "browser-side scratch, NOT a production module").
            // Confirmed out of scope (S3.5).
            //
            // Q1.7 — `"**/poc/"` retiré du même geste : 0 répertoire `poc/` dans le dépôt.
            // Le commentaire couvrait les deux motifs, ce qui rendait le mort indiscernable
            // du vivant — `**/demo/` matche bien, lui (`packages/plugins/connector/demo`).
            "**/demo/",
            // Q1.3 — `**/sw-core.js` RETIRÉ d'ici. Le motif datait d'une époque à deux
            // copies trackées, dont une supprimée au T2.8 (`1502ea18`) après mesure :
            // elle était byte-identique à `dist/`. Il n'en reste qu'UNE, la source
            // `packages/core/src/kernel/storage/sw-core.js` (662 l.), livrée en
            // production (cache offline, IndexedDB, Background Sync) et jusqu'ici hors
            // d'ESLint, hors de `tsc` (`allowJs: false`) ET hors de `count-any`
            // (`count-any.cjs:27` ne collecte que des `.ts`) — trois filets, aucun ne
            // la couvrait.
            //
            // Mesuré avant de lever l'ignore : 0 erreur, 0 warning, 11 suppressions.
            // Les globals `browser` + `node` du bloc 2 suffisent (`no-undef` = 0) ;
            // `globals.serviceworker` est inutile.
            //
            // ⚠️ Son `/* eslint-disable no-console */` de tête N'EST PAS une directive
            // morte à purger : c'est lui qui supprime les 11 hits. Il était inerte
            // faute d'être lu, il devient porteur. `reportUnusedDisableDirectives`
            // (bloc 9) le voit désormais, et le voit UTILISÉ.
            //
            // Les 5 copies d'artefact (`dist/`, les 4 `deploy/*/`) restent couvertes
            // par `**/dist/` et `deploy/` ci-dessus — rien à ré-ancrer.
            // Vitest/Jest mock files — intentionally loose
            "**/__mocks__/**",
        ],
    },

    // ── 1bis. ESLint core recommended — its OWN config object (Q1.1) ───────────
    // It used to be spread INSIDE block 2, on the same object literal as a `rules:`
    // key. `js.configs.recommended` is `{ name, rules }` and nothing else, so that
    // `rules:` key overwrote it whole: 63 of its 64 rules never reached the resolved
    // config. Measured before the fix with `--print-config`: 29 rules resolved on a
    // core `.ts` where spread ∪ block 2 should give 82. `no-unreachable`,
    // `no-dupe-keys`, `no-fallthrough`, `no-debugger`, `no-constant-binary-expression`,
    // `use-isnan`, `valid-typeof`, `no-unsafe-optional-chaining` were ABSENT — not
    // `off`, absent. Restoring it surfaced 26 real defects, 18 of them in shipped code.
    //
    // ⚠️ It must stay a SEPARATE object placed BEFORE block 2, and block 2 must keep
    // its own `rules:`. Merging the two back — for any reason — silently re-creates
    // the exact bug: later keys win per-object, and `recommended` carries only rules.
    //
    // Two of its rules are re-pointed downstream rather than kept as-is:
    //   • `no-undef` — off for `**/*.ts` (block 3, TypeScript already checks it);
    //     for `.js` it needs the runner globals declared in block 3quater.
    //   • `no-redeclare` — off for `**/*.ts`, substituted by the TS-aware version
    //     (block 3), which understands overload sets.
    { files: ["**/*.{js,mjs,cjs,ts}"], ...js.configs.recommended },

    // ── 2. Base JS config (all JS/TS files) ────────────────────────────────────
    {
        files: ["**/*.{js,mjs,cjs,ts}"],
        plugins: {
            security,
        },
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: {
                ...globals.browser,
                ...globals.es2021,
                ...globals.node,
                L: "readonly",
                GeoLeaf: "writable",
                vi: "readonly",
                // Page global published by the MapLibre GL UMD bundle. Same class as
                // `L` and `GeoLeaf` above: read inside `page.evaluate()` bodies, which
                // execute in the browser, not in Node. Needed since Q1.1 restored
                // `no-undef` for `.js` (it is `off` for `.ts`, block 3).
                maplibregl: "readonly",
            },
        },
        rules: {
            "no-var": "error",
            "prefer-const": "error",
            "no-eval": "error",
            "no-implied-eval": "error",
            "no-new-func": "error",
            "no-script-url": "error",
            "security/detect-object-injection": "off",
            "security/detect-non-literal-regexp": "warn",
            "security/detect-unsafe-regex": "error",
            "security/detect-buffer-noassert": "error",
            "security/detect-eval-with-expression": "error",
            "security/detect-no-csrf-before-method-override": "error",
            "security/detect-possible-timing-attacks": "warn",
            "no-console": ["warn", { allow: ["warn", "error", "info"] }],
            "no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                },
            ],
            // Hard ceiling — S7 gate. B.6 resolved every function > 20 (max = 20),
            // so this is enforceable as an error and protects that invariant in CI
            // (`npm run lint` runs in 0-error mode). The informational warn-at-10 layer
            // is dropped; functions at 11–20 (backlog B.2) are tracked via the audit,
            // not the CI gate. The two logic-dense plugins (`offline-ui`, `addpoi`)
            // and the test files keep `complexity: off`.
            complexity: ["error", 20],
            // 4 → 5: depth-5 is acceptable for the data-processing code (offline
            // manifest enumeration, storage cleanup, geometry conversion). The one
            // egregious outlier (depth 8, cache/calculator) was flattened in code.
            "max-depth": ["warn", 5],
            // Soft target raised 50 → 100: 50 was too strict for this codebase's
            // style (setup/registration functions, linear DOM builders). Functions
            // above 100 (genuinely oversized) are still flagged and refactored.
            "max-lines-per-function": [
                "warn",
                { max: 100, skipBlankLines: true, skipComments: true },
            ],
            // `skipComments` aligné sur `max-lines-per-function` ci-dessus (30/07/2026).
            // La limite borne la COMPLEXITÉ du code, pas le volume de documentation — or la
            // règle ⛔ de CLAUDE.md IMPOSE le TSDoc, et sans ce drapeau la seule façon de
            // satisfaire les deux règles à la fois était de scinder un fichier dont le code
            // fait 240 lignes. Mesuré au moment du changement : 1 seul fichier du dépôt
            // dépassait 700 lignes brutes, et 0 fichier ne dépasse 700 lignes de code réel —
            // la garde garde donc exactement ce qu'elle gardait, et rien de moins.
            "max-lines": ["error", { max: 700, skipComments: true, skipBlankLines: true }],
        },
    },

    // ── 3. TypeScript override ─────────────────────────────────────────────────
    {
        files: ["**/*.ts"],
        plugins: {
            "@typescript-eslint": tsPlugin,
        },
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 2022,
                sourceType: "module",
            },
        },
        rules: {
            "no-unused-vars": "off",
            "no-undef": "off",
            // Q1.1 — `no-redeclare` arrives with the restored `js.configs.recommended`
            // spread (block 2). Its BASE version counts a TypeScript overload set as a
            // redeclaration: `domCreate` in `utils/general/dom-helpers.ts` has two
            // signatures + one implementation and scores 2 false positives. The
            // TS-aware version understands overloads. Substitute, never just disable —
            // the rule still catches genuine redeclarations.
            "no-redeclare": "off",
            "@typescript-eslint/no-redeclare": "error",
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                },
            ],
            // S7 (roadmap nettoyage) — `error` by DEFAULT, no longer "off".
            // The old comment claimed "2595 pre-existing instances": that number died with
            // the typage roadmaps. `npm run count:any` reports ONE `any` left in production
            // code (storage-contract DB, an eslint-disabled documented irreducible), and zero
            // across all 14 plugins. So this flip fixes no debt — production was already
            // clean, hardened glob by glob (blocks 6 / 6quater).
            //
            // What it actually buys: ANY_HARDENED and ANY_HARDENED_PLUGINS are HAND-MAINTAINED
            // lists, and `create:plugin` does not append to them. A new package therefore
            // landed OUTSIDE the ratchet and could reintroduce `any` silently. Defaulting to
            // error closes that hole: new code is hardened unless someone opts out on purpose.
            // Tests keep their exemption (block 4bis) — a deliberate, documented decision
            // (roadmap_typage-strict.md), not an oversight.
            "@typescript-eslint/no-explicit-any": "error",
        },
    },

    // ── 3bis. Type declaration files — lint for dead declarations only ──────────
    // Placed AFTER block 3 so its relaxations win (block 3's `**/*.ts` glob also
    // matches `*.d.ts`). Covers the 11 hand-written declarations left in the tree:
    // `core/src/global.d.ts` (the ambient `window.GeoLeaf` view) and 10 `css.d.ts`
    // module shims. ⚠️ It no longer covers a *published* surface: the root
    // `index.d.ts` was removed at ARCHI S6 — the published type contract is the
    // GENERATED `dist/types/`, which is not linted (it is an artifact) but IS
    // compiled by `typecheck:consumer` and checked by `verify-published-types.cjs`.
    // Audited & brought into scope (S3.5): guards the type surface against orphan
    // declarations at near-zero noise. Size/complexity limits are meaningless for
    // declarations; unused-vars stays at warn (declared-but-unused ambient names are
    // expected) and honours the `^_` convention.
    {
        files: ["**/*.d.ts"],
        plugins: {
            "@typescript-eslint": tsPlugin,
        },
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 2022,
                sourceType: "module",
            },
        },
        rules: {
            "max-lines": "off",
            "max-lines-per-function": "off",
            complexity: "off",
            "no-unused-vars": "off",
            "no-undef": "off",
            // Ambient `var` is the only way to declare a mutable global binding in a
            // declaration file (e.g. `declare global { var GeoLeaf: … }`). Standard
            // for .d.ts — TypeScript's own ambient decls use `var`.
            "no-var": "off",
            "@typescript-eslint/no-unused-vars": [
                "warn",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                },
            ],
        },
    },

    // ── 3ter. Web Worker source — provide worker globals ───────────────────────
    // Replaces the removed `/* eslint-env worker */` directive (unsupported in
    // flat config; reported as an error in ESLint 10). Merges worker globals
    // (self, postMessage, importScripts…) on top of blocks 2 & 3 — flat config
    // merges `languageOptions.globals` cumulatively across matching blocks.
    {
        files: ["**/geojson-worker.ts"],
        languageOptions: {
            globals: {
                ...globals.worker,
            },
        },
    },

    // ── 3ter bis. `sw-core.js` — le SEUL fichier du dépôt qui ne PEUT PAS être scindé ──
    //
    // 🛑 CE N'EST PAS UN ASSOUPLISSEMENT DE CONFORT, ET LE MOTIF EST VÉRIFIABLE. Le Service
    // Worker n'est pas bundlé : `packages/core/rollup.config.mjs` (`swCoreVersionPlugin`) le
    // lit en `readFileSync`, y remplace trois jetons, et l'émet en ASSET. Aucun import n'y est
    // résolu, ni au build ni au runtime — un `import` dans ce fichier serait servi tel quel au
    // navigateur, dans un contexte sans résolution de spécificateur nu. La seule façon de
    // respecter `max-lines: 700` y serait donc de SUPPRIMER du comportement, pas de le ranger
    // ailleurs. C'est exactement le cas que la limite n'est pas faite pour arbitrer.
    //
    // Le plafond est RELEVÉ, pas retiré : la pression reste, et elle rougira de nouveau. Passé
    // à 800 le 07/08/2026 (tâche 1.2, bornage du cache de tuiles) — mesuré à 701 lignes de code
    // réel juste après, donc ~99 lignes de marge et une prochaine conversation garantie.
    //
    // ⏳ CE QUI LÈVERAIT CETTE EXEMPTION : donner au worker une vraie étape de bundling (un
    // second point d'entrée Rollup plutôt qu'un `emitFile` d'asset). Ce jour-là, les littéraux
    // partagés — `DATA_ORIGINS_KEY`, `TILE_BUDGET_KEY`, le plafond de tuiles — cessent d'être
    // écrits deux fois, et leurs gardes de source deviennent sans objet avec cette ligne.
    {
        files: ["packages/core/src/kernel/storage/sw-core.js"],
        rules: {
            "max-lines": ["error", { max: 800, skipComments: true, skipBlankLines: true }],
        },
    },

    // ── 3quater. Vitest globals for JS test files (Q1.1) ───────────────────────
    // Same mechanic as 3ter: `languageOptions.globals` merges cumulatively across
    // matching blocks. Required by the restored `no-undef` — the suites run under
    // `globals: true` (packages/core/vitest.config.ts:36), so `describe`/`it`/
    // `expect`/`beforeEach`… are ambient and would otherwise score 22 348 hits.
    // Block 2 declared `vi` by hand; `globals.vitest` supersedes that entry.
    //
    // ⚠️ Deliberately NOT applied to `e2e/**/*.js`, although block 4 below covers
    // both. Playwright specs IMPORT `test`/`expect` from `@playwright/test`;
    // declaring them ambient there would mask a real `no-undef` in e2e — which is
    // where the one genuine hit lives (`maplibregl`, 06-performance-baseline).
    //
    // `jest` is not a Vitest global. It is ambient only because two setup files alias
    // it (`packages/core/__tests__/setup.js:21-22` and
    // `packages/plugins/offline-ui/__tests__/setup.js:36` do `globalThis.jest = vi`).
    // The call sites and `__mocks__` depend on that shim, so the global is declared
    // here to match reality. Removing the shim is a separate chantier (backlog).
    // ⚠️ Ce commentaire citait un troisième site, `addpoi/__tests__/setup.js`, et le
    // contre-exemple d'un mock qui donnait la MAUVAISE raison du shim. Les deux sont
    // partis avec le paquet fusionné (5.1-f) — le motif de la règle, lui, tient.
    {
        files: ["packages/**/__tests__/**/*.js", "packages/**/src/__tests__/**/*.js"],
        languageOptions: {
            globals: {
                ...globals.vitest,
                jest: "readonly",
            },
        },
    },

    // ── 4. Test files (JS) override ────────────────────────────────────────────
    {
        files: [
            // Q1.7 — `"__tests__/**/*.js"` (racine) retiré : STRUCT S7 a descendu tous les
            // répertoires de tests sous `packages/`, il n'existe plus aucun `__tests__/` à
            // la racine du dépôt. Un glob `files:` mort est plus dangereux qu'un `ignores:`
            // mort — il cesse d'appliquer des règles au lieu d'en appliquer trop.
            "packages/**/__tests__/**/*.js",
            // Canonical test location (Plugin Contract v1 PC-09): tests under src/__tests__/.
            "packages/**/src/__tests__/**/*.js",
            "e2e/**/*.js",
        ],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
        },
        rules: {
            "no-eval": "off",
            "no-script-url": "off",
            "security/detect-eval-with-expression": "off",
            // Test fixtures/helpers use validation regexes on controlled inputs
            "security/detect-unsafe-regex": "off",
            // Dynamic RegExp built from controlled test/fixture strings — not attacker-reachable.
            "security/detect-non-literal-regexp": "off",
            // Tests & e2e legitimately log diagnostics and perf metrics.
            "no-console": "off",
            "no-unused-vars": "warn",
            "max-lines-per-function": "off",
            "max-lines": "off",
            "max-depth": "off",
            complexity: "off",
        },
    },

    // ── 4bis. Test files (TS) override ─────────────────────────────────────────
    // Same relaxation of size/complexity limits for `.ts` test files (long setup +
    // assertion blocks are expected). The base `no-unused-vars` stays OFF here
    // (kept off by block 3): it false-positives on identifiers in type positions
    // such as `(e: unknown) => void`. `@typescript-eslint/no-unused-vars` (block 3,
    // error) still flags genuinely dead test imports and variables.
    {
        // Q1.7 — `"e2e/**/*.ts"` retiré : `e2e/` porte 46 `.js` et 0 `.ts`.
        // ⚠️ `**/*.spec.ts` reste ABSENT de ce glob alors que les blocs 6/6bis/6quater/
        // 6quinquies l'excluent explicitement — asymétrie réelle mais inerte (0 `.spec.ts`
        // dans le dépôt). C'est la ligne B.6 du backlog, laissée en place à dessein : la
        // corriger sans fichier témoin poserait un glob invérifiable, exactement le défaut
        // que ce nettoyage solde.
        files: ["**/__tests__/**/*.ts", "**/*.test.ts"],
        rules: {
            "no-eval": "off",
            "no-script-url": "off",
            "security/detect-eval-with-expression": "off",
            // Test fixtures/helpers use validation regexes on controlled inputs
            "security/detect-unsafe-regex": "off",
            "security/detect-non-literal-regexp": "off",
            "no-console": "off",
            "max-lines-per-function": "off",
            "max-lines": "off",
            "max-depth": "off",
            complexity: "off",
            // Tests stay outside the hardened zone (roadmap_typage-strict.md). Blocks 6 and
            // 6quater already ignore them; since S7 made block 3 default to "error", the
            // exemption has to be restated HERE — this block runs after block 3, so it wins.
            // Test doubles legitimately type mock objects as `any`; forcing them into the
            // ratchet would mean ~291 rewrites and would reverse a decision already taken.
            "@typescript-eslint/no-explicit-any": "off",
        },
    },

    // ── 5. (supprimé — CAPACITÉS S10) ──────────────────────────────────────────
    // Bloc `max-lines: "off"` retiré : ses 5 entrées étaient TOUTES périmées.
    //   - `app/init.ts`, `geojson/popup-tooltip.ts` : n'existent plus (init scindé en
    //     init-deferred-ui / init-feature-modules / init-reveal) ;
    //   - `built-in/permalink/permalink-manager.ts` : déplacé en `capabilities/permalink/`
    //     par le S13 — le glob ne matchait donc plus rien, et le fichier fait 362 l. ;
    //   - `geojson/core.ts` (413 l.) et `**/security/index.ts` (72 l.) : très en dessous
    //     de la limite, l'exemption ne les protégeait de rien.
    // Aucun fichier de `packages/core/src` n'atteint 700 lignes — la CONCLUSION tient,
    // les deux termes qui la portaient étaient faux : le max mesuré au Q1.7 est **673**
    // (`capabilities/toast-renderer/notifications.ts`), et le fichier cité ci-dessous en
    // fait **665**. Ancienne rédaction : (max 667,
    // `adapters/maplibre/maplibre-style-converter.ts`). Supprimer ce bloc RESSERRE donc la
    // limite dure du bloc 2 au lieu de la relâcher : plus aucun fichier n'y échappe.
    //
    // Même classe que les 4 globs de cliquet purgés en tête de fichier, mais bénigne dans
    // ce sens-ci : une exemption qui cesse de matcher rend la règle PLUS stricte. C'est
    // l'inverse — une RESTRICTION qui cesse de matcher — qui est dangereuse, et c'est
    // pourquoi `probe-gate-visibility.cjs` existe.

    // ── 6. Type-hardening ratchet — no-explicit-any elevated to error ─────────
    // Driven by ANY_HARDENED (top of file). MUST come after block 3 so it wins
    // over block 3's global "off" for no-explicit-any. The S7 type-aware block
    // (6bis) that follows only ADDS the no-unsafe-* family — it never touches
    // no-explicit-any, so this block stays authoritative for it.
    // See roadmap_typage-strict.md.
    {
        files: ANY_HARDENED,
        // Tests stay out of the hardened zone (roadmap_typage-strict.md). Core tests
        // live under packages/core/__tests__/ (outside src/), so these globs already
        // miss them; the ignores are a defensive guard for any future co-located test.
        ignores: ["**/__tests__/**", "**/*.test.ts", "**/*.spec.ts"],
        rules: {
            "@typescript-eslint/no-explicit-any": "error",
        },
    },

    // ── 6bis. Type-aware gate — no-unsafe-* on core/src (S7) ──────────────────
    // Catches "de-facto any": values typed `any`/`error` at runtime and
    // propagated by `as unknown as X`, JSON.parse / res.json(), or loose
    // namespace members (`getGeoLeaf()?.X`) — which `no-explicit-any` cannot
    // see. These rules are TYPE-AWARE, so this block opts into the TS project
    // service. Scoped to `packages/core/src` ONLY (tests + `.d.ts` excluded) so
    // the type-checking cost stays confined and plugins/tests remain
    // non-type-aware. Placed after block 6: it only adds the no-unsafe-* family,
    // never altering no-explicit-any. Ratchet phase (warn → error) tracked in
    // roadmap_typage-strict.md S7.
    {
        files: ["packages/core/src/**/*.ts"],
        ignores: ["**/__tests__/**", "**/*.test.ts", "**/*.spec.ts", "**/*.d.ts"],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            "@typescript-eslint/no-unsafe-assignment": "error",
            "@typescript-eslint/no-unsafe-member-access": "error",
            "@typescript-eslint/no-unsafe-call": "error",
            "@typescript-eslint/no-unsafe-argument": "error",
            "@typescript-eslint/no-unsafe-return": "error",
            // Q1.4 — promise family. Same type-aware perimeter, no extra infrastructure:
            // `projectService` is already on above. On a stack with an ORDERED boot
            // sequence (B1→B11), tile loading, IndexedDB and a Service Worker, an
            // un-awaited promise swallows its rejection and desynchronises init — the
            // failure mode is silent, which is exactly why a rule is worth more than a
            // review here. Measured on the day it was posed: 23 floating + 6 misused in
            // core, 0 await-thenable.
            "@typescript-eslint/no-floating-promises": "error",
            "@typescript-eslint/no-misused-promises": "error",
            "@typescript-eslint/await-thenable": "error",
        },
    },

    // ── 6ter (a). Kernel layering boundary — modules/ ⊄ app/ (KERNEL S14) ─────
    // See KERNEL_APP_BOUNDARY above for the rationale and the flat-config caveat.
    {
        files: [
            // ⚠️ R.9 (24/07/2026) — `modules/**` a été éclaté en quatre racines.
            // Laissé tel quel, ce glob aurait couvert **zéro fichier** et la frontière
            // serait tombée EN SILENCE, sans qu'aucune gate ne rougisse.
            "packages/core/src/api/**/*.ts",
            "packages/core/src/globals/**/*.ts",
            "packages/core/src/kernel/**/*.ts",
            "packages/core/src/utils/**/*.ts",
        ],
        rules: {
            "no-restricted-imports": ["error", { patterns: [KERNEL_APP_BOUNDARY] }],
        },
    },

    // ── 6ter. UI mobile/desktop boundary (archi backlog B.4) ─────────────────
    // The mobile toolbar (ui/mobile/) and the desktop panel (ui/desktop/) are
    // independent surfaces that must NOT import each other — shared logic belongs
    // in ui/ root (filter-panel, content-builder, notifications, theme…). Any
    // cross-platform wiring (e.g. the theme toggle injected into the mobile DOM)
    // is done via shared helpers + DOM, never a direct mobile↔desktop import.
    {
        files: ["packages/core/src/kernel/ui/mobile/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["**/ui/desktop/**", "**/desktop/desktop-panel*"],
                            message:
                                "ui/mobile must not import ui/desktop — put shared logic in ui/ root (archi B.4 boundary).",
                        },
                        // Re-included: this block lives under modules/ and would otherwise
                        // override block 6ter (a). See KERNEL_APP_BOUNDARY.
                        KERNEL_APP_BOUNDARY,
                    ],
                },
            ],
        },
    },
    {
        files: ["packages/core/src/kernel/ui/desktop/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["**/ui/mobile/**", "**/mobile/mobile-toolbar*"],
                            message:
                                "ui/desktop must not import ui/mobile — put shared logic in ui/ root (archi B.4 boundary).",
                        },
                        // Re-included: this block lives under modules/ and would otherwise
                        // override block 6ter (a). See KERNEL_APP_BOUNDARY.
                        KERNEL_APP_BOUNDARY,
                    ],
                },
            ],
        },
    },

    // ── 6ter bis. Engine boundary — no VALUE import of maplibre-gl (socle S4) ─
    // The MapLibre engine is reached only through the adapter (adapters/maplibre/)
    // and the injected `maplibregl` global (global.d.ts). A *value* import of
    // "maplibre-gl" anywhere else would pull the engine into the CDN bundle and
    // bypass IMapAdapter. Type-only imports are erased (harmless) and stay allowed
    // everywhere — see basemaps-types.ts, which re-exports MaplibreMap type-only.
    // Uses the @typescript-eslint extension for its `allowTypeImports` option; the
    // base no-restricted-imports rule is also posed in blocks 6ter (a) and 6ter ter,
    // on unrelated specifiers, so there is no conflict / double-report.
    // (Q1.7 — la rédaction disait « ONLY active in block 6ter » : faux, elle est posée
    // à trois endroits. La conclusion — pas de double-report — tient, elle repose sur
    // le fait que les specifiers sont disjoints, pas sur l'unicité du bloc.)
    {
        files: ["packages/core/src/**/*.ts"],
        ignores: ["packages/core/src/adapters/maplibre/**"],
        rules: {
            "@typescript-eslint/no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["maplibre-gl", "maplibre-gl/*"],
                            allowTypeImports: true,
                            message:
                                "Only adapters/maplibre/** may value-import the engine. Elsewhere use IMapAdapter or the injected `maplibregl` global; type-only imports (`import type`) are allowed.",
                        },
                    ],
                },
            ],
        },
    },

    // ── 6ter ter. Capability → adapter boundary (socle B.1) ──────────────────
    // Capabilities describe WHAT to render; the MapLibre adapter decides HOW. A
    // capability importing adapters/maplibre/* couples an optional feature to the concrete
    // engine — a non-MapLibre engine would then require touching capabilities, not just the
    // adapter. Everything a capability needs is on IMapAdapter (contracts/map-adapter.contract)
    // or a neutral util. Uses the BASE rule (blocks value AND type imports) — a different rule
    // name from the @typescript-eslint one in "6ter bis", so both coexist on capability files.
    // 0 violations after the vector-tiles decouple + sprite/const relocation.
    {
        files: ["packages/core/src/capabilities/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["**/adapters/maplibre/**"],
                            message:
                                "capabilities/ must not import adapters/maplibre/* — go through IMapAdapter (contracts/map-adapter.contract) or a neutral util. The engine boundary is one-way (socle B.1).",
                        },
                        // ── ARCHI S5 (5.1) — miroir de KERNEL_APP_BOUNDARY ──────────────
                        // `modules/ ⊄ app/` est gardé depuis le S14 ; `capabilities/ ⊄ app/`
                        // ne l'était pas. La dépendance court app/ → capabilities/, jamais
                        // l'inverse.
                        //
                        // ⚠️ Cette règle est AJOUTÉE AU BLOC EXISTANT, pas posée dans un
                        // nouveau bloc `capabilities/**`. En flat config, un second bloc
                        // portant `no-restricted-imports` sur les mêmes fichiers ÉCRASE le
                        // premier au lieu de fusionner (piège vérifié au S14 kernel, cf.
                        // l.55-68) : la frontière moteur ci-dessus aurait disparu en silence.
                        //
                        // ✅ **L'exception a été soldée au backlog R.10 (24/07/2026).** Elle
                        // couvrait 13 `install.ts` de capacité qui importaient leur wrapper de
                        // boot depuis `app/boot-modules/`. Les 13 wrappers ont été déplacés dans
                        // leur capacité (`capabilities/<id>/module.ts`), donc l'exception est
                        // tombée **par construction** — c'est exactement ce que l'arbitrage 5.2
                        // avait écarté au profit du gate, et le critère de complétude qu'il
                        // s'était fixé. Il ne reste dans `app/boot-modules/` que les **6 wrappers
                        // kernel** (config, core-map, geojson, shared, theme-engine, ui), qu'aucune
                        // capacité n'importe. **Zéro `eslint-disable` sur cette règle.**
                        //
                        // ⚠️ Ne pas ré-ouvrir d'exception ici : une capacité qui a besoin d'un
                        // cycle de vie `ICoreModule` le pose chez elle, pas dans `app/`.
                        {
                            group: ["**/app/**"],
                            message:
                                "capabilities/ must not import app/ — the dependency runs app/ → capabilities/, never the reverse. Since R.10 there is NO exception: a capability that needs an ICoreModule lifecycle declares it in its own directory (capabilities/<id>/module.ts). Anything else must move to modules/ or go through a seam.",
                        },
                        // ── Backlog résiduel R.8 — `capabilities/ → built-in/` médiatisée ──
                        // 55 arêtes mesurées le 24/07. L'énoncé d'origine disait « 55 contournent
                        // tout baril, 0 passe par une façade » : faux pour 17 d'entre elles, qui
                        // passaient déjà par `config/config-primitives.js`, un ré-export de 15
                        // lignes dont le TSDoc dit `RECOMMENDED USAGE`. Le gisement réel était de
                        // 38, dont 25 imports de valeur — désormais routés par baril.
                        //
                        // ⚠️ Ce groupe est AJOUTÉ AU BLOC EXISTANT, comme la frontière `app/`
                        // ci-dessus et pour la même raison : en flat config, un second bloc
                        // portant `no-restricted-imports` sur les mêmes fichiers ÉCRASE le
                        // premier au lieu de fusionner. Les trois frontières (moteur, app,
                        // built-in) doivent tenir dans ce bloc unique.
                        //
                        // Trois routes restent ouvertes, toutes des catégories DÉJÀ nommées par
                        // l'architecture — aucune n'est une échappatoire inventée pour ce gate :
                        //   • `*/index.js`           — les barils (patron `security/index.ts`)
                        //   • `*-types.js`           — les hubs de types (ARCHITECTURE.md §Hubs)
                        //   • `*-seam.js`            — les seams (item-controls, desktop-tabs)
                        //   • `config-primitives.js` — le médiateur historique, 17 arêtes
                        //
                        // ⚠️ Écrit en `regex` et NON en `group` de globs — ce n'est pas une
                        // préférence de style, c'est une correction. Mesuré le 24/07 : dans un
                        // `group`, une négation à segment simple mord
                        // (`!**/kernel/*/index.js`) mais la même à profondeur 2 NON
                        // (`!**/kernel/*/*/*-types.js`). Le gate sortait rouge sur 8
                        // imports parfaitement légitimes — les 3 hubs et seams imbriqués d'un
                        // cran (`config/geoleaf-config/config-types.js`,
                        // `geojson/loader/loader-types.js`, `ui/desktop/desktop-tabs-seam.js`).
                        // Un glob qui ne mord pas où on le croit est exactement la classe de
                        // panne que ces roadmaps ont documentée : la règle a l'air posée, et elle
                        // ne garde pas ce qu'elle annonce.
                        {
                            regex: String.raw`kernel/[^/]+/(?!index\.js$)(?!.*-types\.js$)(?!.*-seam\.js$)(?!config-primitives\.js$).+`,
                            message:
                                "capabilities/ must not reach deep into kernel/ — import the sub-directory barrel (e.g. kernel/geojson/index.js) instead. Type hubs (*-types.js), seams (*-seam.js) and config-primitives.js stay directly importable. If the symbol you need is not on the barrel, adding it there is the decision to make — widening the barrel is explicit, bypassing it is not (backlog R.8).",
                        },
                    ],
                },
            ],
        },
    },

    // ── 6ter quater. Constantes physiques possédées par le kernel (CAPACITÉS S10.2) ──
    // Trois capacités ont été re-routées vers une primitive du kernel plutôt que de
    // réimplémenter sa formule — legend → `taxonomy/resolver` (S4), scale → `scale-utils`
    // (S6), vector-tiles → l'adaptateur (socle B.1) — et une quatrième au S10 (proximity →
    // `utils/geo/haversine`). Rien ne les tenait : `check-orphan-exports` et knip cherchent
    // un export SANS consommateur, or `scaleAtZoom` et `resolveCategoryKey` ont aussi des
    // appelants internes à leur propre module. Un re-fork les laisserait verts.
    //
    // Le vrai garde-fou est le jeu de tests `__tests__/capabilities/kernel-reuse.test.js`,
    // qui calcule chaque attendu AVEC la primitive du kernel : il attrape toute dérive
    // numérique, quelle que soit la façon dont elle est écrite. Ce bloc-ci ne couvre que le
    // cas grossier — le copier-coller littéral de la constante — mais il le signale AU
    // MOMENT de l'écrire, avec le nom du symbole à importer, ce qu'un test ne fait pas.
    //
    // Précédent qui justifie de le poser : `print` PORTAIT quatre copies de la constante
    // Web Mercator, sous sa forme ARRONDIE `156543.04` — celle dont le core s'est
    // débarrassé au S6. ⚠️ Ce n'est plus vrai (mesuré au STRUCT S4) : elles sont
    // consolidées en un export unique, `page-format.ts:32 METERS_PER_PIXEL_AT_ZOOM_0`,
    // et les `file:ligne` cités ici étaient périmés d'un facteur 1,3 (`modal-renderer.ts`
    // n'a jamais eu 548 lignes). Le précédent reste valide comme HISTOIRE — le re-fork
    // s'est produit — mais il ne décrit plus l'état du dépôt. Le bloc reste scopé au CORE.
    //
    // ⚠️ Bloc SÉPARÉ, et c'est délibéré : il ne porte que `no-restricted-syntax`, une clé de
    // règle qu'aucun autre bloc n'utilise. Le piège flat-config documenté en 6ter ter joue
    // PAR CLÉ DE RÈGLE, pas par bloc — vérifié à `--print-config`, où `no-restricted-imports`
    // (6ter ter) et `@typescript-eslint/no-restricted-imports` (6ter bis) coexistent déjà sur
    // le même fichier. Poser ces sélecteurs DANS 6ter ter serait le vrai risque : on y
    // toucherait aux frontières d'import pour une raison sans rapport.
    {
        files: ["packages/core/src/**/*.ts"],
        ignores: [
            // Les deux propriétaires légitimes — c'est ici que les constantes vivent.
            "packages/core/src/utils/general/scale-utils.ts",
            "packages/core/src/utils/geo/haversine.ts",
        ],
        rules: {
            "no-restricted-syntax": [
                "error",
                {
                    selector: "Literal[value=156543.03392]",
                    message:
                        "Constante Web Mercator (m/px au zoom 0) : importer `scaleAtZoom`/`zoomAtScale` depuis utils/general/scale-utils.js. La formule a UNE source de vérité depuis le S6.",
                },
                {
                    selector: "Literal[value=156543.04]",
                    message:
                        "Valeur ARRONDIE de la constante Web Mercator — c'est la copie dont le core s'est débarrassé au S6 (elle dérivait de l'exacte). Importer `scaleAtZoom`/`zoomAtScale` depuis utils/general/scale-utils.js.",
                },
                {
                    selector: "Literal[value=6371000]",
                    message:
                        "Rayon terrestre en mètres : importer `EARTH_RADIUS_M` depuis utils/geo/haversine.js — sans quoi le rendu et le prédicat qui filtre ne tiennent plus sur la même Terre (S10).",
                },
                {
                    selector: "Literal[value=6371008.8]",
                    message:
                        "Rayon terrestre IUGG : le kernel utilise la moyenne WGS-84 (`EARTH_RADIUS_M`, utils/geo/haversine.js). Deux rayons = deux frontières pour un même cercle (S10).",
                },
            ],
        },
    },

    // ── 6quater. Type-hardening ratchet — PLUGINS (no-explicit-any) ──────────
    // Driven by ANY_HARDENED_PLUGINS (top of file). Twin of block 6, scoped to
    // plugin packages, kept as a SEPARATE block + constant so it never shares a
    // git hunk with the core ratchet (blocks 6 / 6bis) — parallel branches extend
    // each list independently. Must come after block 3 (global no-explicit-any
    // "off") to win, and before block 7 (which only relaxes stylistic rules, never
    // no-explicit-any). Type-aware no-unsafe-* for plugins is deferred to S4.
    // See roadmap_typage-plugins.md.
    {
        files: ANY_HARDENED_PLUGINS,
        ignores: ["**/__tests__/**", "**/*.test.ts", "**/*.spec.ts"],
        rules: {
            "@typescript-eslint/no-explicit-any": "error",
        },
    },

    // ── 6quinquies. Type-aware gate — no-unsafe-* on hardened PLUGINS (S4) ────
    // Twin of block 6bis (core), scoped to ANY_HARDENED_PLUGINS. Catches the
    // "de-facto any" that no-explicit-any cannot see (values typed any at runtime
    // and propagated via `as unknown as X`, JSON.parse / res.json(), loose
    // namespace members). TYPE-AWARE → opts into the TS project service
    // (projectService resolves each plugin's own tsconfig.json — resolution
    // validated in S0, including the two logic-dense plugins whose sources carry
    // the most state and branches: `offline-ui` and `addpoi`). Kept as a
    // SEPARATE block + the shared ANY_HARDENED_PLUGINS constant (same zone rule as
    // 6quater) so it never shares a git hunk with the core gate. Phase: `error` for
    // EVERY hardened plugin, sans exception.
    //
    // ⚠️ Q1.7 — cette phrase annonçait « EXCEPT plugin-storage, whose 68-violation
    // residual is deferred to roadmap_capacites-extraction S14 (see the 6sexies
    // carve-out just below) ». TROIS énoncés faux dans une seule phrase :
    //   1. le bloc « 6sexies » n'a jamais existé (grep `no-unsafe` → 6bis et
    //      6quinquies, et rien d'autre) ;
    //   2. `plugin-storage` n'existe plus non plus — renommé `offline-ui` au STRUCT S3 ;
    //   3. les 68 violations sont soldées : `--print-config` sur
    //      `plugins/offline-ui/src/entry.ts` résout les 5 `no-unsafe-*` à `error`, et
    //      le lint est vert.
    // La dette a été payée, le commentaire qui la portait est resté — et il décrivait
    // une exemption que le config n'accordait plus. See roadmap_typage-plugins.md S4.
    {
        files: ANY_HARDENED_PLUGINS,
        ignores: ["**/__tests__/**", "**/*.test.ts", "**/*.spec.ts", "**/*.d.ts"],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            "@typescript-eslint/no-unsafe-assignment": "error",
            "@typescript-eslint/no-unsafe-member-access": "error",
            "@typescript-eslint/no-unsafe-call": "error",
            "@typescript-eslint/no-unsafe-argument": "error",
            "@typescript-eslint/no-unsafe-return": "error",
            // Q1.4 — promise family, twin of the core entry in block 6bis. Measured
            // when posed: 14 floating + 18 misused across the hardened plugins,
            // 0 await-thenable. Concentrated in `offline-ui` (cache UI + sync), which
            // is precisely the async-heaviest surface of the tree.
            "@typescript-eslint/no-floating-promises": "error",
            "@typescript-eslint/no-misused-promises": "error",
            "@typescript-eslint/await-thenable": "error",
        },
    },

    // ── 7. Offline UI / AddPOI — relax stylistic rules (accepted patterns) ────
    // L'exemption tient à la DENSITÉ de la logique métier de ces deux paquets, et à
    // rien d'autre : elle ne les distingue pas des 11 autres plugins par nature, elle
    // constate qu'ils portent plus d'état et plus de branches. Deux garde-fous à
    // garder en tête avant de l'élargir : elle est nominative (elle ne suit pas un
    // paquet qui grossit), et elle est stylistique (aucune règle de correction n'y
    // est désactivée).
    {
        files: [pkgGlob("@geoleaf-plugins/offline-ui", "src/**")],
        rules: {
            // Complex business logic in this plugin — accepted as-is
            complexity: "off",
            "max-lines-per-function": "off",
            "max-depth": "off",
            "no-console": "off",
            // Q1.7 — le motif cité désignait un `sync-handler.ts` de « 900 lignes » qui
            // n'existait pas ; le seul du dépôt en faisait 444, et il est parti avec
            // `addpoi` (5.1-f). ⚠️ **L'exemption reste, et son PÉRIMÈTRE A RÉTRÉCI** : elle
            // ne couvre plus qu'`offline-ui`, dont `cache/` et `sync-manager.ts` la
            // motivent seuls désormais. À re-mesurer avant de la reconduire.
            "max-lines": "off",
        },
    },

    // ── 8. View-construction functions — max-lines-per-function relaxed ─────────
    // Field-type renderers and modal/control factories build a cohesive DOM
    // subtree together with their private event handlers inline. Their length
    // reflects thorough encapsulation (many small private closures over shared
    // mutable state), not a function doing too much — splitting them into
    // state-objects/classes would add ceremony without improving clarity. Only
    // genuinely oversized *sequential* functions are refactored elsewhere; these
    // cohesive factories are kept intact (hybrid decision: refactor only where
    // splitting actually helps).
    {
        files: [
            pkgGlob("@geoleaf/field-renderer", "src/types/**/*.ts"),
            pkgGlob("@geoleaf/field-renderer", "src/ui/responsive-modal.ts"),
            pkgGlob("@geoleaf-plugins/connector", "src/login-ui.ts"),
            pkgGlob("@geoleaf-plugins/geocoding", "src/control.ts"),
            pkgGlob("@geoleaf-plugins/print", "src/emprise-selector.ts"),
            // `print/src/modal-renderer.ts` retiré au STRUCT S4 : le fichier est renommé
            // `modal-open.ts`, mais l'exemption était DÉJÀ inerte — `openModal` fait 75
            // lignes pour un plafond de 100. La re-cibler aurait figé un glob qui ne
            // désarme rien ; un glob `files` qui ne matche plus rien ne fait d'ailleurs
            // rougir aucune gate (ESLint n'avertit pas dessus).
        ],
        rules: {
            "max-lines-per-function": "off",
        },
    },

    // ── 9. Orphan disable directives are an error (kernel S13.3) ───────────────
    // Renumbered 7 → 9 (CAPACITÉS B.31): this block shipped as a second "7",
    // straddling block 8, and the file is navigated by these ordinals. Blocks 7
    // (storage/addpoi relaxations) and 8 (view-construction) keep their numbers —
    // both are referenced as such from CHANGELOG.md and roadmap_typage-plugins.md.
    // A `eslint-disable` whose rule no longer fires is worse than noise: it reads as
    // "this code needs an exemption" long after it stopped being true, and the next
    // reader either trusts it or has to re-derive why it is there. The S13.3 audit
    // found 0 orphans across the 15 disables of packages/core/src — this pins that.
    //
    // ESLint 9+/10 already defaults this to "warn" in flat config, which is why the
    // audit came back clean; making it explicit and blocking costs nothing today and
    // means a disable that outlives its rule fails the build instead of accumulating.
    //
    // Chosen over `eslint-plugin-eslint-comments`' `require-description`: that would
    // add a dependency AND fail immediately on the sites this sprint justified in
    // prose rather than in the `--` suffix. This rule needs neither.
    {
        linterOptions: {
            reportUnusedDisableDirectives: "error",
        },
    },

    // ── 10. `"use strict"` is dead weight in an ESM module (backlog B.4) ───────
    // Every workspace package declares `"type": "module"`, and an ES module is strict
    // by specification — the directive changes nothing at runtime. It is a leftover
    // from the pre-ESM sources, and 29 files under `src/` still carried one.
    //
    // A rule rather than a one-off purge, because a manual sweep only removes the
    // occurrences that exist today: the next file copied from an old one brings the
    // directive back and nothing objects. `strict: "never"` is auto-fixable, so the
    // purge IS the rule being applied once.
    //
    // Scope derived from the registry — never a hard-coded `packages/plugins/*` glob.
    // A path written by hand does not break when a package moves, it silently stops
    // matching, and the rule reports success having scanned nothing (the failure mode
    // `probe-gate-visibility.cjs` exists to catch).
    //
    // 🛑 **B-95 — LE CORE ÉTAIT EXCLU, ET C'EST CE QUI A FAIT MONTER LE GISEMENT À 301.**
    // Le filtre disait `.filter((p) => p.name !== "@geoleaf/core")`, **sans motif écrit**.
    // La règle purgeait donc 16 paquets sur 17, en épargnant précisément celui qui porte le
    // plus de fichiers. Résultat mesuré au 16/08 : **301** `"use strict"` sous
    // `packages/core/src`, contre une poignée ailleurs.
    //
    // ⚠️ Et le mécanisme s'auto-entretenait : **tout fichier neuf du core héritait de la
    // directive par imitation de ses voisins**, y compris écrit le matin même en soldant une
    // autre ligne (`kernel/storage/eviction-notice.ts`, R9). Un gisement qui croît par simple
    // conformité au voisinage ne se réduit pas en attendant — il monte à chaque lot.
    //
    // Le glob ne vise que `**/*.ts` : `kernel/storage/sw-core.js`, copié tel quel dans les
    // variantes de déploiement et donc PAS un module ES, garde légitimement la sienne.
    //
    // 🛑 **ET `geojson-worker.ts` EST LE MÊME CAS, malgré son extension.** Il est `.ts`, donc
    // le glob l'attrapait — mais il n'est jamais consommé comme module : `rollup.config.mjs`
    // l'émet en SCRIPT CLASSIQUE pour un Web Worker. Sa directive n'est pas du poids mort,
    // elle est porteuse.
    //
    // ⚠️ **Le retrait est sorti VERT au lint, au typecheck et sur 10 854 tests** — c'est
    // `LIC-HEADERS/LIC-04` qui l'a attrapé, et par un symptôme sans rapport apparent : privé
    // de la directive du source, le transpileur en réinjecte une **avant** la bannière de
    // licence, qui cesse d'être en tête du fichier expédié. Un fichier dont la nature diffère
    // de son extension ne se voit ni au type, ni au test — seulement à ce qu'il devient une
    // fois construit.
    {
        files: registry.all().map((p) => `${p.dir}/src/**/*.ts`),
        ignores: ["**/geojson-worker.ts"],
        rules: {
            strict: ["error", "never"],
        },
    },
    // ── Outillage CommonJS de `scripts/` — B-88 ────────────────────────────────
    //
    // 🛑 CE RÉPERTOIRE N'A JAMAIS ÉTÉ LINTÉ. `"scripts/"` figurait dans les `ignores`
    // globaux : `isPathIgnored()` rendait `true` pour les 134 fichiers, soit ~50 000 LOC —
    // dont TOUTES LES GATES DU DÉPÔT. L'outillage qui garde le code était le seul corpus
    // que rien ne gardait.
    //
    // ⚠️ Placé EN FIN DE TABLEAU, et ce n'est pas cosmétique : en flat config, le dernier
    // bloc qui matche l'emporte. Posé plus haut, ses assouplissements étaient écrasés par
    // le bloc de base — mesuré, 836 avertissements `no-console` de pur bruit.
    //
    // Les assouplissements, et leur motif — chacun mesuré, aucun de précaution :
    //   · `no-console` — la sortie console EST le contrat de ces scripts, pas un oubli ;
    //   · les limites de TAILLE (`max-lines`, `complexity`, `max-depth`,
    //     `max-lines-per-function`) — une gate est un balayage linéaire avec ses
    //     branches ; les fragmenter pour satisfaire un seuil rendrait le périmètre plus
    //     dur à lire, ce qui est précisément le défaut que ces gates existent pour trouver ;
    //   · `security/detect-non-literal-fs-filename` et `detect-non-literal-regexp` — leurs
    //     chemins dérivent de littéraux `__dirname` et d'arguments CLI d'opérateur, jamais
    //     d'une entrée non fiable.
    //
    // 🛑 CE QUI N'EST PAS ASSOUPLI, DÉLIBÉRÉMENT : `no-eval`, `no-implied-eval`,
    // `no-new-func`, `no-script-url` et `security/detect-unsafe-regex` restent en `error`.
    // `CLAUDE.md` interdit de les abaisser sans motif écrit à côté de la règle.
    //
    // ⚠️ Le premier run en a trouvé **19** (18 `detect-unsafe-regex`, 1 `no-new-func`), et la
    // tentation était de les faire taire ici — le commentaire d'exclusion d'origine plaidait
    // déjà que ces scripts « ne sont pas atteignables par un attaquant ». **C'est vrai
    // aujourd'hui et ce n'est pas une propriété stable** : leurs regex mordent sur des noms de
    // fichiers du dépôt, et le dépôt est public depuis le 12/08 — une PR suffit à en proposer
    // un. Les 18 partent donc en SUPPRESSIONS, qui est une dette qui ne peut que rétrécir,
    // et non en `off`, qui serait une permission permanente. Le seul `no-new-func` est traité
    // par une dérogation LOCALE avec son motif écrit (`probe-boot-contract.mjs`).
    // ⚠️ DEUX blocs et non un : `scripts/` porte 119 fichiers CommonJS et 15 ESM
    // (`.mjs`, l'outillage récent). Un `sourceType` unique ferait échouer le parseur sur
    // l'une des deux moitiés — et un fichier qui ne parse pas n'est pas linté, il est
    // SAUTÉ. Les assouplissements sont identiques ; seul le mode de module change.
    {
        files: ["scripts/**/*.{cjs,js}"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "commonjs",
            globals: { ...globals.node },
        },
        rules: {
            "no-console": "off",
            "max-lines": "off",
            "max-lines-per-function": "off",
            "max-depth": "off",
            complexity: "off",
            "security/detect-non-literal-fs-filename": "off",
            "security/detect-non-literal-regexp": "off",
            "security/detect-object-injection": "off",
        },
    },
    {
        files: ["scripts/**/*.mjs"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: { ...globals.node },
        },
        rules: {
            "no-console": "off",
            "max-lines": "off",
            "max-lines-per-function": "off",
            "max-depth": "off",
            complexity: "off",
            "security/detect-non-literal-fs-filename": "off",
            "security/detect-non-literal-regexp": "off",
            "security/detect-object-injection": "off",
        },
    },
];
