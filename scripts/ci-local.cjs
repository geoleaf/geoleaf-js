#!/usr/bin/env node
/**
 * Local CI runner — reproduces the `.github/workflows/ci.yml` gate sequence on
 * the developer machine. Useful when GitHub Actions is unavailable (frozen / no
 * runner tokens): one command validates the whole pipeline locally.
 *
 * Usage:
 *   node scripts/ci-local.cjs            # all gates except E2E (fast-ish)
 *   node scripts/ci-local.cjs --e2e      # also build deploy variants + Playwright
 *   node scripts/ci-local.cjs --bail     # stop at the first failing gate
 *
 * Exit code: 0 if every (required) gate passed, 1 otherwise. Each gate runs even
 * after a previous failure (unless --bail) so you get the full picture in one go.
 *
 * ## The property this script must hold: `ci:local ⊇ ci.yml`
 *
 * The push protocol makes this script the ONLY criterion before spending
 * GitHub Actions quota. "Local green → safe push" is only true if the local
 * perimeter covers the remote's — otherwise a local green says nothing
 * about the run to come.
 *
 * It is verified, not conventioned — on TWO axes, and both were needed:
 *
 *   • the TEST PERIMETER, by `scripts/lib/test-scope.cjs`, which throws if
 *     the local unit gate tested less than `ci.yml`'s;
 *   • the GATE LIST, by `scripts/verify-ci-parity.cjs` (the "CI parity"
 *     step), which classifies each `ci.yml` command as covered / under
 *     `--e2e` / exempted-with-witness, and turns red on any fourth category.
 *
 * ⚠️ This paragraph long announced the property as verified while citing
 * only the first axis. That was an OVER-CLAIM: the gate list rested on a
 * "Keep this list in sync with .github/workflows/ci.yml" comment, i.e. on a
 * manual gesture where the file announced a guard. Fixing that was the real
 * object of 30/07/2026 — not that day's red.
 *
 * ⚠️ Owned SHAPE divergence, on the unit gate: `ci.yml` runs
 * `npx vitest run` (`projects` mode, one process, 11 packages), this script
 * runs `npm test` (turbo fan-out, 17 packages). Same test files, different
 * schedulers. The inclusion's direction is what counts, and it points the
 * right way. This divergence is now an `EXEMPTIONS` entry of the parity
 * gate, with a witness that turns red if `test-scope.cjs` stopped carrying
 * the inclusion.
 *
 * ## What this script STILL does not cover, and SAYS
 *
 * Three things stay out of reach, and the end-of-run summary now names them
 * rather than silencing them: the 4 `E2E_STEPS` (opt-in, real cost),
 * `check-test-failures.cjs` (it parses a `test-results.json` only `ci.yml`'s
 * JSON reporter produces), and gitleaks' `pull_request` path (no PR event
 * exists on a workstation). Gitleaks' `push` path is replayed by
 * `npm run gitleaks:local`.
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { findDebris } = require("./lib/workspace-debris.cjs");

const ROOT = path.resolve(__dirname, "..");

// On Windows, `npm`/`npx` resolve to .cmd wrappers that Node refuses to spawn
// without a shell (CVE-2024-27980). On POSIX (the usual build env) shell:false.
const NPM_SHELL = process.platform === "win32";

const args = process.argv.slice(2);
const WITH_E2E = args.includes("--e2e");
const BAIL = args.includes("--bail");

// ⚠️ THIS BLOCK MUST STAY ABOVE THE `@type` ANNOTATION THAT FOLLOWS. Set
// between it and its declaration, it made it bear on THIS `const` —
// `TOOLING-TS` returned "Type 'number' is not assignable to type
// '{ name, run }[]'". An annotation only holds for the IMMEDIATELY
// following declaration, exactly like `eslint-disable-next-line`.
// Derived, never written: the number of packages carrying a `typecheck`
// script. `packages.cjs` throws if the registry is unreachable, so this
// count cannot become zero silently.
const TYPECHECK_PKGS = (() => {
    const registry = require("./lib/packages.cjs");
    const fsMod = require("node:fs");
    return registry
        .all()
        .filter((p) =>
            Boolean(
                JSON.parse(fsMod.readFileSync(`${p.dir}/package.json`, "utf8")).scripts?.typecheck
            )
        ).length;
})();

/** @type {{name: string, run: string[]}[]} */
const STEPS = [
    { name: "Build (turbo)", run: ["npx", "turbo", "run", "build"] },
    // 🛑 AFTER the full build, and that is the whole subject. The call lived
    // in the CORE's build, which turbo runs before that of the plugins
    // depending on it: the libs' and 6 plugins' `dist/types/` did not exist
    // yet, their 11 CSS imports never received a stub, and the script came
    // out green because the core, itself, was covered.
    // ⚠️ `ci:local` could NOT see the class: a workshop `dist/` keeps the
    // stubs of an earlier root `npm run build`. It took a fresh clone — 8
    // `TS2882` in CI on 18/08/2026. The runner's fifth bite on a green ci:local.
    { name: "Stubs de type CSS (.d.ts publiés)", run: ["node", "scripts/emit-css-type-stubs.cjs"] },
    {
        name: "Bundle exports validation",
        run: ["npm", "run", "test:bundle", "-w", "@geoleaf/core"],
    },
    // A plugin's bundle is asserted in the plugin's own package — that is where the artefact
    // ships. The core's rollup used to build a second, divergent copy of these two; it was
    // consumed by nobody, shipped ~660 KB of plugin code inside the public
    // @geoleaf/core npm package, and carried the CSP-violating styleInject. Deleted — the core's
    // own bundle gate now asserts that no geoleaf-*.plugin.js reappears in packages/core/dist/.
    {
        name: "Bundle validation — plugin Storage",
        run: ["npm", "run", "test:bundle", "-w", "@geoleaf-plugins/offline-ui"],
    },
    { name: "Tree-shaking proof (size:example)", run: ["npm", "run", "size:example"] },
    // S6 — the source graph tree-shaking (above) says nothing about the PUBLISHED package.
    // These two check the artifact an integrator actually downloads: the sideEffects field it
    // reads, and a witness bundle built through the real npm subpaths.
    { name: "sideEffects honesty (check:side-effects)", run: ["npm", "run", "check:side-effects"] },
    { name: "Published-package proof (size:consumer)", run: ["npm", "run", "size:consumer"] },
    { name: "Published recipe typechecks", run: ["npm", "run", "typecheck:consumer"] },
    // ARCHI S6 — the STRUCTURAL complement to the compile above. `typecheck:consumer`
    // proves the core's types are right; this proves every OTHER package's declarations
    // are reachable at all. 11 packages shipped .d.ts inside their tarball that no
    // consumer could resolve (TS7016) — invisible to a compiler that never imports them,
    // which is why `examples/consumer/published-types.ts` was added alongside this gate.
    // It also holds the "types first" convention, which is uniformity only: TypeScript
    // resolves the condition wherever it sits (measured at S6, both after `import` and
    // after `default`). Check 1 is the one with teeth.
    {
        name: "Published types are reachable (PUB-TYPES)",
        run: ["node", "scripts/verify-published-types.cjs"],
    },
    // API S2 — PUB-TYPES checks the `types` branch of `exports`; nothing checked the
    // runtime branch. The API audit (24/07) found `@geoleaf/core` advertising 13
    // `./facades/*` subpaths whose `.d.ts` resolved and whose `.js` did not: they
    // type-checked, then threw ERR_MODULE_NOT_FOUND. This gate resolves BOTH branches
    // of every target of every workspace, and fails on any asymmetry. It also fails if
    // it scanned nothing — its own prototype passed vacuously from the wrong cwd.
    {
        name: "Public subpaths resolve (SUBPATH-RESOLVE)",
        run: ["node", "scripts/check-subpath-resolve.cjs"],
    },
    // The third question neither of the two gates above asks. PUB-TYPES
    // verifies a declaration is REACHABLE, SUBPATH-RESOLVE that a subpath's
    // two branches RESOLVE — both inside the monorepo, where workspace
    // symlinks make `@geoleaf/host-runtime` perfectly resolvable while it is
    // `private` and 404 on the registry FOREVER. Six publishable `.d.ts`
    // imported packages absent from npm with no gate able to see it.
    // `typecheck:consumer` neither: it compiles from packages/core/examples/,
    // hence inside the monorepo. A defect that only exists at someone
    // else's does not compile here.
    {
        name: "Shipped specifiers resolve off-monorepo (SHIP-SPEC)",
        run: ["node", "scripts/check-shipped-specifiers.cjs"],
    },
    // Is the licence carried by what SHIPS? The root `LICENSE` requires the
    // notice to accompany "all copies or substantial portions"; the tarball
    // satisfies it via `files[]`, a `.js` served alone from a CDN does not.
    // Measured on 10/08/2026 BEFORE the fix: 405 shipped files out of 540
    // carried none, and the only package that DECLARED a banner did not
    // deliver it — `legalComments: "none"` removed it. LIC-05 also guards
    // the `license` field's VALUE, which PC-05 does not look at (it only
    // requires a non-empty string, so "UNLICENSED" came out green there).
    // ⚠️ Must run AFTER "Build (turbo)": LIC-04 reads `dist/`.
    {
        name: "License headers & notice (LIC-HEADERS)",
        run: ["node", "scripts/check-license-headers.cjs"],
    },
    { name: "Lint (0 errors, 0 warnings enforced)", run: ["npm", "run", "lint"] },
    // The `typecheck` task existed in turbo.json and the packages
    // implemented it, but NOTHING invoked it. Its first run surfaced 45
    // errors, 39 of them introduced the day before with nothing seeing
    // them: plugin-storage typechecks via `tsconfig.typecheck.json`, a
    // perimeter `tsc -p tsconfig.json` does not cover. The gate that makes
    // this script useful.
    //
    // 🛑 THE COUNT IS DERIVED, NO LONGER WRITTEN. This label said "18
    // packages"; there are **17** in the registry, **15** of which carry a
    // `typecheck` script. Two wrong figures in a single word, and the word
    // was the only place anyone could read it.
    //
    // ⚠️ The fix is NOT to write "15": a copied number expires at the next
    // package added or removed, exactly like this one — and it expires
    // SILENTLY, since a label is verified by nothing. It derives from
    // `packages.cjs`, the only place that knows how many there are.
    {
        name: `Typecheck (turbo, ${TYPECHECK_PKGS} packages)`,
        run: ["npx", "turbo", "run", "typecheck"],
    },
    // `scripts/`, `e2e/` and the root configs were covered by NO tsconfig.
    // Decreasing ratchet rather than green: the first run returns 301
    // errors, and requiring zero at once would amount to not laying the
    // coverage. Details in the script's header.
    {
        name: "Typecheck de l'outillage (TOOLING-TS, cliquet)",
        run: ["node", "scripts/check-tooling-typecheck.cjs"],
    },
    // The sweep had reached 100%, and the debt re-formed TWICE: nothing
    // required a new artefact to be born judged. This ratchet replaces the
    // list with a structure — it turns red the day an artefact arrives
    // without a verdict.
    {
        name: "Qualification de l'arborescence (TREE-QUAL, cliquet)",
        run: ["node", "scripts/check-tree-qualification.cjs"],
    },
    { name: "Security audit — prod deps (M7)", run: ["node", "scripts/audit-ci.cjs"] },
    {
        name: "Signatures registre npm (SIGN)",
        run: ["node", "scripts/verify-registry-signatures.cjs"],
    },
    {
        name: "Security audit — full tree (informational)",
        run: ["node", "scripts/audit-dev-report.cjs"],
    },
    // ci.yml's `Secret scan (gitleaks)` gate, replayed BEFORE the push. It
    // was the only substantive gate carried by a GitHub ACTION, hence the
    // only one this script could not run — and it bit twice in a row on
    // 29/07/2026, each discovery costing a run of a scarce quota. The
    // action is not reproducible; its binary is, at the exact version it
    // installs, over the same range (`origin/main..HEAD`).
    //
    // ⚠️ Does NOT turn red if Docker is absent: a missing environment
    // dependency is not a failing gate, and making ci:local red for that
    // would push people to bypass it. The script then announces it loudly.
    // It also refuses to conclude on an empty range, where gitleaks would
    // print "no leaks found" over zero bytes — f15b0575's exact defect.
    { name: "Secret scan (gitleaks, local)", run: ["node", "scripts/gitleaks-local.cjs"] },
    // ⚠️ These two steps are distinct and must stay so — same package
    // perimeter now, but not the same role, and confusing them has already cost:
    //   - `npm test`                  → `test` task          → no coverage, no thresholds
    //   - `npm run test:coverage:all` → `test:coverage` task → coverage AND thresholds
    // Both go through `scripts/run-tests.cjs` and cover the 17 packages (34
    // turbo tasks each, build included). Until 19/07/2026 `ci:local` only
    // launched the first, under the misleading name "Unit tests + coverage
    // gate" — while it measures no coverage. `ci.yml`'s coverage gate
    // ("Coverage gate", HARD gate, no continue-on-error) thus had no local
    // equivalent, and it stayed RED on `main` with nothing flagging it:
    // `plugin-runtime` (branches 61.11%) and `field-renderer` (59.68%)
    // failed while `ci:local` displayed 100% green. A push would have
    // burned quota on a red the CI already knew and local could not see.
    // 🛑 THE GUARDS, OUTSIDE THE CACHE — and this step exists because the
    // other one lied three times.
    //
    // A guard's subject is by nature outside its package (`_docs_projet/`,
    // `docs/specs/`, `profiles/`, `apps/`, a plugin's `entry.ts`), while the
    // `test` task's `inputs` are all package-relative. The guard's file
    // invalidates the cache; what it GUARDS does not. Measured on
    // 20/08/2026: 21 guards out of 24 are in this case, and
    // `journal-numbering.guard.test.ts` stayed GREEN over three consecutive
    // runs above its ceiling, until a `packages/core/src/` modification woke
    // the task.
    //
    // ⚠️ The error's direction is what makes the class dangerous: a gate
    // that does not run does not return "unknown", it returns GREEN — and
    // here that green is the oracle authorising the push. Editing a doc, a
    // profile or a plugin WITHOUT touching the core is a session's most
    // common case, and it was exactly the one that woke nothing.
    //
    // ⚠️ The remote does NOT have this hole: `ci.yml` restores no turbo
    // cache (neither `actions/cache` on `.turbo`, nor remote cache), so the
    // guards always run there. The net exists, it is merely unreachable —
    // the protocol wants a LOCAL green before spending a run.
    { name: "Gardes (hors cache turbo)", run: ["npx", "turbo", "run", "test:guards"] },
    // And the probe guarding the device above: a new guard whose subject is
    // outside the package, in a package not declaring the task, would
    // arrive ALREADY ASLEEP — and nothing would say so. It also verifies the
    // task stays `cache: false` and is invoked.
    {
        name: "Gardes réveillées par leur sujet (GUARD-CACHE)",
        run: ["node", "scripts/verify-guards-uncached.cjs"],
    },
    { name: "Unit tests (npm test)", run: ["npm", "test"] },
    // The `--concurrency=4` that lived HERE, hardcoded, and only for this
    // gate, moved into `scripts/run-tests.cjs` with the second factor it lacked.
    //
    // The diagnosis made then was right — N turbo tasks × their worker
    // pools oversubscribe the machine, and the time-constrained tests are
    // what gives, a different package each run — but the remedy only
    // covered half the product, and only this gate. The "Unit tests" step
    // just above never carried anything: `npm test` launched 12 packages at
    // once, each opening ~23 workers. Measured on 22/07/2026: **81 Node
    // processes, 11.3 GB RSS** for ~11 GB available. Hence a ci:local red
    // every other run — always on timeout, never on assertion, on untouched
    // packages green in isolation.
    //
    // Both gates now go through the same runner, which sets together the
    // turbo concurrency AND each vitest's worker cap.
    {
        name: "Coverage gate (turbo test:coverage)",
        run: ["npm", "run", "test:coverage:all"],
    },
    { name: "Smoke test", run: ["node", "scripts/smoke-test.cjs"] },
    // Replaces `benchmark.cjs --ci`, whose 3 assertions were inert
    // (baseline from 27/02, Leaflet era; the other 2 named an artefact
    // since deleted). This gate was a step nowhere: it was only reached
    // transitively through `build-deploy.cjs`, hence under `--e2e` only.
    // ci:local's default mode had no budget at all.
    // ⚠️ `--plugins` ADDED on 12/08/2026. Without it, this step only
    // weighed the CORE: the 12 budgets of `PLUGIN_BUDGETS_GZ_KB` — 20 boot
    // thresholds + total — were evaluated by NO gate, neither here nor in
    // `ci.yml`. They existed, they were maintained (a dead key there is
    // even detected by the visibility probe), and nothing read them: a
    // plugin could double in weight without a single line turning red.
    //
    // Found at preflight, which announced `editor` at 142.3 KB gz for a
    // ceiling of 122 — an overrun the repo would thus have carried unseen.
    // At the 12/08 measure it returns **95.7 / 122**, but that is a version
    // fact, not a protection.
    {
        name: "Bundle size (core + 12 plugins, budget dur)",
        run: ["npm", "run", "size", "--", "--plugins"],
    },
    // ── The APPLICATION's weight ───────────────────────────
    //
    // The gate just above measures the CORE's static import closure and
    // comes out green at ~183 / 300 KB gz. That is 12% of what a page
    // loads: the profile's data, the eager plugins, the CSS and the icons
    // were weighed by NOTHING. A 172.7 KB gz favicon — heavier than the
    // whole core bundle — lived on the critical path with no instrument
    // seeing it.
    //
    // ⚠️ These two steps are in the DEFAULT path, not under `--e2e`, and
    // that is the point. The gate needs a built `deploy/`; building it
    // costs **8 s** (measured), against a suite counted in minutes.
    // Reserving it for `--e2e` would have made it almost never run, i.e.
    // decorative — the very defect this wiring fixes. The duplication with
    // `E2E_STEPS` is owned: 8 s paid twice under `--e2e`, against a real
    // gate every other day.
    {
        name: "Build deploy variants (sujet du budget applicatif)",
        run: ["npm", "run", "build:deploy:all"],
    },
    {
        name: "App payload (première page par variante, budget dur)",
        run: ["npm", "run", "size:app"],
    },
    // ── No secret in what SHIPS ──────────────────────────────────────────────
    //
    // 🛑 THIS GATE FILLS A BLIND SPOT BETWEEN TWO NETS, not a negligence.
    // `gitleaks` scans COMMIT RANGES; `.gitignore` covers the git channel.
    // `deploy/` is git-ignored, hence invisible to both — while it is
    // exactly what leaves for a client or production. Measured on
    // 09/08/2026: an UNEXPIRED `geoleaf_editor` JWT, against a host
    // reachable from the Internet, lived at the root of `deploy-core` and
    // `deploy-full`, plus in their `.gz`/`.br`. Four gates looked at
    // `deploy/` — all weighed bytes, none read the content.
    //
    // ⚠️ Position coupled to the "Build deploy variants" step two notches
    // up: it scans THAT artefact. Moved before it, it would render a
    // verdict on a `deploy/` of unknown age — or on nothing, which DNS-04
    // turns red rather than letting through.
    {
        name: "Aucun secret dans les livrables (DEPLOY-SECRETS)",
        run: ["node", "scripts/verify-deploy-no-secrets.cjs"],
    },
    // The deliverable carries its server recipe (SC-01/02/03).
    //
    // 🛑 Same position, same motive as the gate above: it reads the
    // artefact the "Build deploy variants" step just produced. Moved before
    // it, it would render a verdict on a `deploy/` of unknown age — or on
    // nothing, which its SC-03 turns red.
    //
    // ⚠️ What it closes is NOT a knowledge hole. The fact — "without the
    // `.mjs` MIME type, nothing boots" — was already written in
    // `docker/nginx.dev.conf`, with the admission that nobody could verify
    // it at the integrator's. It was a DIFFUSION hole, and it cost a mute
    // production on 09/08/2026.
    {
        name: "Le livrable emporte son contrat serveur (DEPLOY-SERVER-CONTRACT)",
        run: ["node", "scripts/verify-deploy-server-contract.cjs"],
    },
    // DEPLOY determinism — placed HERE, and the position is the wiring's
    // reason for being.
    //
    // 🛑 This gate almost stayed out of the default path "because it costs
    // two builds". That was accepting a decorative gate: three sources of
    // non-determinism lived for months in this repo (`?v=<Date.now()>`, a
    // timestamped `CACHE_VERSION`, a pre-cached profile's `_generatedAt`),
    // and none ever turned anything red — they were paid in re-downloads by
    // every visitor, which nobody measures.
    //
    // The cost is brought down to **a single build (~50 s)** by
    // `--reuse-built`: the step just above has produced `deploy/`, which
    // serves as the first term. ⚠️ Moving this entry elsewhere in the list
    // breaks that coupling with no signal — it would compare a `deploy/` of
    // unknown age to a fresh build, and turn red while speaking of determinism.
    {
        name: "Déterminisme du déployé (BUILD-DET — deux builds, mêmes octets)",
        run: ["npm", "run", "check:determinism:deploy:ci"],
    },
    // Two dead-code gates, now DISJOINT — complementary, no overlap. knip
    // (next step) guards dead files, dependencies and blocking dead config;
    // its baseline has been 1 signal since 26/07/2026, because the
    // exports/types category is cut on `packages/core/src/**`
    // (`ignoreIssues` in knip.js): 157 of the 158 signals lived there, and
    // their one-by-one triage yielded 116 barrel false positives for 0
    // actionable. The B3 net searches by token across the whole repo,
    // including the literal VALUES of string consts, which no import graph
    // links to their consumer. It covered 51 of the 74 candidates alone
    // (25/07/2026 measure); it now covers all 74 — it is the ONLY gate on
    // the core's exports, not a duplicate. Each carries its class (A/C/D),
    // enforced by CLS-01/CLS-02.
    { name: "Dead code (knip)", run: ["npm", "run", "dead-code"] },
    {
        name: "Dead-code filet B3 (core orphan exports)",
        run: ["npm", "run", "check-orphan-exports"],
    },
    // A source module loaded through `require()` from a test gets its
    // coverage attributed to the WRONG lines and the WRONG functions.
    // Nothing fails: the suite is green and the report plausible, which let
    // the defect live a month. The baseline freezes the 357 known sites and
    // only blocks on a NEW site — it can only go down. Proof by mutation in
    // `probe-gate-visibility.cjs`, which plants a source `require()` in the
    // probe package and requires this gate to name it.
    {
        name: "Mode de chargement des tests (require → couverture fausse)",
        run: ["node", "scripts/verify-test-load-mode.cjs"],
    },
    // The ONLY gate that verifies the measuring device rather than the
    // code. A false coverage report is well formed and plausible: no test
    // can catch it, and that is how the defect lived a month. A 4-function
    // witness, a test calling only one, assertion that the lcov credits
    // that one and not the other three. The repo measures in istanbul
    // everywhere; the probe verifies attribution on a known-answer witness.
    // ~2 s. Bears on the `import` branch: the `require()` branch was
    // eliminated and frozen by `verify-test-load-mode.cjs`.
    {
        name: "Étalonnage de la couverture (attribution FNDA/DA)",
        run: ["node", "scripts/verify-coverage-attribution.cjs"],
    },
    // Socle S4 — contracts/ must stay a pure type surface (no runtime value export, no
    // non-type import, no top-level statement). Green at wiring (a sweep purified the 2
    // membranes) ⇒ no baseline. Keep in sync with ci.yml and .husky/pre-commit.
    {
        name: "Contracts purity (type-only)",
        run: ["npm", "run", "check:contracts-pure"],
    },
    // `api/geoleaf.*.ts` expose the API, they do not implement it. The rule
    // is documented (ARCHITECTURE.md) and was broken twice: geoleaf.config.ts had drifted
    // into self-registration (removed S2), geoleaf.storage.ts held ~430 L of orchestration
    // (extracted S3). Green at wiring (conformed events + introspection) ⇒ no
    // baseline. Keep in sync with ci.yml and .husky/pre-commit.
    {
        name: "Facade purity (geoleaf.*.ts)",
        run: ["npm", "run", "check:facade-purity"],
    },
    // PLATFORM-ISO — neighbour of the two above because it defends the same
    // species of property: an architecture boundary no test can render.
    // `@geoleaf-plugins/navigation`'s three adapters are the only point of
    // contact with the browser, and that property is what makes a later
    // native port possible.
    // ⚠️ The perimeter is SCOPED to the plugin, never the repo: the repo
    // carries seven legitimate `navigator.geolocation` outside any
    // `platform/` — the core's geolocation capability and `measure`'s GPS
    // tool. Swept repo-wide, it would be BORN RED on code it has no
    // business judging, and a gate born red gets disarmed.
    // 🛑 As long as the plugin does not exist, it returns a MOTIVATED SKIP
    // that SAYS it is not a green — deliberate: a "0 violations" over an
    // absent corpus is indistinguishable from conformity. Keep in sync with ci.yml.
    {
        name: "Platform isolation (PLATFORM-ISO)",
        run: ["node", "scripts/check-platform-isolation.cjs"],
    },
    // S14 — the npm script existed since the docs sweep but was wired into NOTHING:
    // absent from this list AND from every GitHub workflow. That is how three APIs
    // stayed documented on npm after being deleted from the runtime
    // (`Helpers.createElement`, `Utils.escapeHtml`, the whole `AbstractRenderer` page):
    // an unrun gate is indistinguishable from no gate.
    // ⚠️ It is a hand-maintained DENY-list of known-bad patterns, not a check derived
    // from the real surface — so it catches a documented ghost only once someone adds
    // the rule. Deriving it from the real surface is backlogged; the source to derive
    // FROM is the generated `dist/types/` + the boot golden-master (ARCHI S6 removed the
    // root `index.d.ts`, which this comment used to name — it was never published and had
    // drifted, so deriving a gate from it would have encoded the drift).
    {
        name: "Docs examples (phantom APIs, stale package names)",
        run: ["npm", "run", "check:docs-examples"],
    },
    // NPM-README (14/08/2026) — a package's npm page is its shopfront, and
    // nobody rereads it from this repo. `npmjs.com` does not render GitHub
    // alerts: `> [!WARNING]` displays as LITERAL TEXT, so the marker
    // becomes a noise line ABOVE the warning it was meant to underline.
    // Measured before the fix: 18 alerts across 6 of the 14 published
    // READMEs, 5 of them in `@geoleaf/core`.
    // 🛑 Placed right after `check:docs-examples` because both read THE
    // SAME files and share the subject: the one above guards the CODE of
    // fenced blocks, this one the PROSE around them. They still CANNOT
    // merge — `check:docs-examples`'s corpus is wider (repo root +
    // `docs/`), and the rule would be FALSE there: GitHub and VitePress do
    // render alerts. A gate turning red on the project's two most-read
    // surfaces would get disabled. Static, no build.
    {
        name: "Rendu npm des README publiés (NPM-README)",
        run: ["npm", "run", "check:npm-readme"],
    },
    // ARCHI S11 — the two halves of the commented tree, and they fail differently.
    // MOD-HEADERS gates the SOURCE (a new file may not arrive undocumented, and the
    // 318-file baseline may only shrink); DOCS-TREE gates the ARTEFACT (the committed
    // markdown must match what the generator produces right now). Without the second,
    // a generated file is just a hand-maintained file with extra steps: it drifts, and
    // the drift is invisible because nobody re-runs the generator to notice.
    {
        name: "Module headers (new files must be documented)",
        run: ["npm", "run", "check:module-headers"],
    },
    // EXACT-OPTIONAL-DEBT (31/07/2026) — `exactOptionalPropertyTypes` is
    // set, and its 95 errors were settled WITHOUT widening a single type.
    // Nothing, except this gate, then tells a justified `?: T | undefined`
    // from a `?: T | undefined` set to silence tsc — and the widening gives
    // the property back exactly its pre-option semantics. Baseline 0, AST
    // visit (a grep counts 83 false positives: casts and parameter unions),
    // perimeter derived from `lib/packages.cjs`. Seen red on both its rules
    // before being believed.
    {
        name: "Exact-optional debt (aucun type élargi pour faire taire tsc)",
        run: ["npm", "run", "check:exact-optional-debt"],
    },
    // NONNULL-ASSERTION-DEBT — the previous one's counterpart for
    // `noUncheckedIndexedAccess`. NNA-04 is the rule that counts: zero
    // `arr[i]!`, WITHOUT a baseline, because an asserted indexed read is a
    // silenced error of that tier — the sweep comes out green BECAUSE the
    // assertion is there. Measured at the start: the only zero-complexity
    // fix is precisely that one, and `complexity: 20` is a ratchet, so the
    // pressure structurally pushes towards the assertion. The 302 other
    // entries (`strictNullChecks` debt) are frozen and can only shrink.
    // Seen red on its THREE rules before being believed.
    {
        name: "Non-null assertion debt (aucune erreur Q5 soldée par un `!`)",
        run: ["npm", "run", "check:nonnull-debt"],
    },
    // JS-TEST-DEBT — the ratchet the debt register demanded by name since
    // 31/07/2026 ("the gesture that would flatten this cost is known […] It
    // has not been laid"). Without it, the debt measured the core at 431 on
    // 24/07, 447 on 31/07 and 457 on 05/08: the debt deepened while being
    // instructed.
    // 🛑 The rule that counts is NOT the counter, it is JTD-04 — zero
    // uncollected suite, no baseline. A ratchet on a NUMBER turns against
    // itself here: vitest's `include`s carry the extension in their pattern
    // (`core/vitest.config.ts`, `offline-ui/vitest.config.ts`), so
    // renaming a `.test.js` to `.test.ts` without widening the pattern
    // makes the file INVISIBLE to the runner — the suite stays green with
    // one test fewer, and the baseline SHRINKS applauding the loss. JTD-04
    // is evaluated BEFORE the baseline, precisely so that path is unreachable.
    // Seen red on its FOUR rules before being believed, and its first run
    // found a live defect: `maplibre-import-validation.test.ts` was
    // collected by no vitest (456 files listed, it absent) NOR compiled by
    // any tsconfig — it had asserted nothing since 21/03/2026.
    {
        name: "JS-test debt (dette `.js` gelée, et aucune suite invisible au runner)",
        run: ["npm", "run", "check:js-test-debt"],
    },
    // DIST-INTEGRITY — the deploy embarked TWO sets of chunks, and the
    // register only attributed that to the turbo cache. Measurement found
    // TWO causes:
    //   1. turbo restores its cache WITHOUT emptying `dist/` — proven by
    //      canary on turbo 2.9.18: a hand-placed file survives a
    //      `cache hit` / `>>> FULL TURBO`. The register's option (a)
    //      ("declare outputs") is thus ruled out: `outputs: ["dist/**"]` is
    //      already declared and does not suffice.
    //   2. 🛑 `build-deploy-coverage.cjs` called `npx rollup -c` DIRECTLY,
    //      at steps 1 and 4, short-circuiting the `rimraf dist &&` the
    //      core's `build` script carries. Rollup does not erase its output:
    //      each pass stacked its set of hashed chunks. Measured:
    //      `core/dist/chunks/` comes out CLEAN of a
    //      `turbo run build --force` and doubles again after this single
    //      script. That cause was written nowhere.
    // Fix measured: the deploy goes from 41,010 to 40,016 KB. And an orphan
    // chunk does not merely weigh — it would SHIP in the npm tarball
    // (3.5 MB on one package).
    // ⚠️ Seen red before being believed, and its FIRST run produced a FALSE
    // POSITIVE: `maplibre-layer-builders` / `maplibre-layer-registry`
    // rendered as two variants, because `builders` and `registry` are eight
    // characters like a rollup hash. Tightened twice (hash requiring
    // uppercase + digit, and perimeter limited to `chunks/` directories) —
    // a noisy gate learns to be ignored, which is worse than an absent one.
    {
        name: "Intégrité de dist/ (DIST-INTEGRITY — 0 chunk en double, 0 orphelin)",
        run: ["npm", "run", "check:dist-integrity"],
    },
    // ESM-PURITY — a BARE specifier in a `dist/` is unresolvable in a
    // browser: without an import map, `from 'gtfs-realtime-bindings'` has
    // no URL. The module loads at the integrator's, and it breaks. The
    // historical witness was real and copied into the 4 `deploy/` variants;
    // `purge-dist.cjs` has since taken it away, so the guard was
    // MANUFACTURED red by mutation, not found red.
    // ⚠️ The dividing line is `peerDependencies`, not `dependencies`:
    // `maplibre-gl` is a WANTED external (engine outside the bundle, also
    // declared in the rollup's `external:`), while the
    // `gtfs-realtime-bindings` witness was a leaking `dependencies`. The
    // allowlist derives from it, package by package — tolerating it
    // globally would make the declaration decorative.
    // ⚠️ And it scans with a SCANNER, not a grep: the repo carries two
    // false positives a `grep from ['"]` would flag — a TSDoc `@example` in
    // `legend.js` and an error string in `geoleaf-print.plugin.js`. They
    // live on disk, so a green crosses them: the neutraliser's permanent
    // non-regression.
    {
        name: "Pureté ESM de dist/ (ESM-PURITY — 0 spécificateur nu hors allowlist)",
        run: ["npm", "run", "check:esm-purity"],
    },
    // DOC-CONFIG-EXAMPLES — the two doc-example gates look at CODE:
    // `validate-docs-examples` hunts ghost APIs, `typecheck-docs-examples`
    // compiles TS blocks and `@example`s. A ```json block describing a
    // profile is neither — nobody read it. Yet the profile schemas are
    // `additionalProperties: false`: a key removed from a schema but left
    // in an example produces a COPY-PASTABLE extract that fails
    // `validate:profiles` at the integrator's.
    // 🛑 The EXACT shape of the hole closed on 31/07 (a copyable
    // `GeoLeaf.POI.add()` in the two most-read READMEs) — except here the
    // corpus was right and it is the BLOCK TYPE that stopped short.
    // Recorded at wiring: 169 invalid keys across 24 product documents, 46
    // of them at the FIRST LEVEL, 5 of them recent (fixed); the other 164
    // are older and frozen in a decreasing baseline. Seen red on its three
    // rules before being believed.
    {
        name: "Exemples de config JSON de la doc produit (DOC-CONFIG-EXAMPLES)",
        run: ["npm", "run", "check:doc-config-examples"],
    },
    // TSDOC-CONFORMITY (27/07/2026) — MOD-HEADERS' counterpart on the
    // block's CONTENT, not its presence. MH-01 guarantees a new file is
    // documented; this one guarantees the documentation describes the
    // signature it overlooks. 47 violations at wiring (15 ghost `@param`s,
    // 31 partial documentations, 1 `@throws` without a `throw`), frozen in
    // a decreasing baseline — 7 of them where the documented parameter
    // became `_`-prefixed, i.e. unused, with the sentence not saying so.
    {
        name: "TSDoc conformity (@param ↔ signature)",
        run: ["npm", "run", "check:tsdoc"],
    },
    // 31/07/2026 — the documentation rule's last hole: `@param`, `@throws`
    // and arity are guarded by TSDOC-CONFORMITY, `@example`s are compiled
    // by `typecheck-docs-examples`, but TSDoc PROSE was guarded by nothing.
    // A sentence pointing at `kernel/geojson/style-resolver.ts` stays
    // readable and convincing long after the file has moved.
    //
    // ⚠️ **The baseline of 84 is NOT a debt queue to drain, and that is
    // measured.** Three false-positive classes were closed before wiring
    // (absent 149 → 84: omitted segment / extra prefix, package specifier,
    // placeholder path) — but instructing the remainder showed that **the
    // majority of the 84 name a path BECAUSE it is dead**: "Reclassified
    // from …", "Absorbs the former …", "PROMOTED here from …". That is
    // legitimate provenance, not a defect, and no regex reliably tells them
    // apart — the same verdict the script's header had already rendered for
    // `.md` files (precision 2/10).
    //
    // What this gate guards is thus precise and narrow: **no NEW dead
    // citation can enter**. That is the real risk (someone moves a file and
    // leaves the reference), while a provenance note is written
    // deliberately and rarely. TSDOC-PATHS-02 moreover keeps the baseline
    // from fossilising. Seen red on BOTH axes before being believed.
    {
        name: "Chemins cités par la prose des TSDoc (TSDOC-PATHS)",
        run: ["npm", "run", "check:tsdoc-paths"],
    },
    // Same ratchet, another corpus — the references of the 45 `docs/specs/`
    // sheets, laid on 11/08/2026.
    //
    // 🛑 **The motive is a MEASURED HOLE, not a precaution.** By elimination
    // over the 78 gates of the time: `check-dead-links` only extracts
    // `[text](target)` — a backticked path is invisible to it; TSDOC-PATHS
    // stops at package `src/` and has no `md` in its alternation; the `.md`
    // corpora of `validate-docs-examples` / `typecheck-docs-examples` are
    // taken at depth 0 of the root, hence never `docs/`. **546 (sheet→path)
    // pairs were guarded by nothing**, and that is exactly what the plan
    // noted of that class: "it expires without ever turning red". The first
    // run found 115 dead paths and 6 moved ones.
    //
    // ⚠️ The baseline is the HOME of paths named because they are dead
    // ("this directory no longer exists", the CDCs consumed then deleted):
    // 15 out of 20 in the first class. Freezing them there avoids "fixing"
    // sentences that spoke true.
    {
        name: "Chemins cités par les fiches docs/specs (SPECS-PATHS)",
        run: ["npm", "run", "check:specs-paths"],
    },
    // The 3rd public sub-root. `SPECS-PATHS` only guarded `docs/specs/`,
    // while `guides/` and `reference/` ship in the SAME public repo and are
    // read by the same people. The hole was measured: `TESTING_GUIDE.md`
    // taught for months a `poi.test.js` suite gone with the POI module, and
    // no gate could see it — `check-dead-links` only extracts
    // `[text](target)`, never a backticked name.
    // Seen red on BOTH its axes before being believed (01 new path, 02 stale baseline).
    {
        name: "Chemins cités par docs/guides et docs/reference (GUIDES-PATHS)",
        run: ["npm", "run", "check:guides-paths"],
    },
    // The 3rd gate of the same family, on the WORKSHOP corpus that had
    // none. `_docs_projet/vision/` carries the SPECIFIED, NOT DEVELOPED
    // features: ~136 KB loaded at every "resume work", so its errors get
    // reread at every resumption. `check-dead-links` explicitly excludes it
    // from its perimeter, and SPECS/GUIDES-PATHS only read the public —
    // this corpus was the only one seen by nobody.
    // 🛑 Here the baseline is the NORMAL CASE, not an admission: a vision
    // sheet legitimately cites paths that do not exist yet. What the gate
    // catches is the other case — a path that existed and MOVED without the
    // sheet following.
    // ⚠️ It reads the workshop: on the public clone it SKIPS saying so
    // (NEEDS_INTERNAL_ROOT). Seen red on BOTH its axes before being
    // believed: 01 new dead path, 02 stale baseline.
    {
        name: "Chemins cités par _docs_projet/vision (VISION-PATHS)",
        run: ["npm", "run", "check:vision-paths"],
    },
    // The 5th source, and the repo's most NORMATIVE corpus:
    // `packages/core/docs/` ships in the npm tarball AND the public clone,
    // and `check-dead-links` counts it as its biggest scope (60 files). The
    // three previous gates guarded `docs/specs/`, `docs/guides/` +
    // `docs/reference/`, and the workshop — none read it.
    // 🛑 AND THE DIRECTORY ALREADY APPEARED IN THE GATE, which led to the
    // backwards conclusion: it is listed in `guidesBases()` as a resolution
    // DESTINATION, never as a scanned source. A grep on its name returned a
    // hit. The very title of the lesson — referenced ≠ read.
    // Deposit at laying: 485 citations, 385 live, 74 dead frozen, 26 moved.
    // Seen red on BOTH its axes before being believed (01 new path, 02 stale baseline).
    // ⚠️ PUBLIC corpus: unlike VISION-PATHS, it does NOT skip on the public clone.
    {
        name: "Chemins cités par packages/core/docs (CORE-DOCS-PATHS)",
        run: ["npm", "run", "check:core-docs-paths"],
    },
    // The 6th ratchet of the family, laid on 26/08/2026 by the code-autonomy
    // arbitration — and it closes the corpus, not a corner of it.
    //
    // 🛑 **The five above judge PROSE; none read a `//`.** TSDOC-PATHS stops
    // at the `/** … */` of the package `src/`; the four others read `.md`.
    // So `scripts/`, `e2e/`, the tests and the root configs — which carry the
    // majority of this repo's line comments — were in NO path gate's corpus.
    // Deposit at laying: 817 citations, 632 live, 144 dead frozen, 40 moved.
    //
    // ⚠️ Its corpus and TSDOC-PATHS' are COMPLEMENTARY, never overlapping:
    // `nonDocComments` excludes `/** … */` by construction. Two gates on the
    // same characters would diverge, and neither count would mean anything
    // on its own.
    //
    // 🛑 Seen red on BOTH axes before being believed — and the first mutation
    // EARNED its keep: it caught the gate coming out green while reading the
    // TSDoc blocks instead of the line comments. A gate never seen red is not
    // a gate; one seen red on the wrong corpus is worse.
    // ⚠️ PUBLIC corpus, like CORE-DOCS-PATHS: it does NOT skip on the public clone.
    {
        name: "Chemins cités par les commentaires non-TSDoc (COMMENT-PATHS)",
        run: ["npm", "run", "check:comment-paths"],
    },
    // Same corpus as SPECS-PATHS, another oracle, and that is the point:
    // this gate does not judge the PATHS a sheet cites but the FRESHNESS it
    // attests. Each `docs/specs/` sheet carries `verifie_contre: <sha>`;
    // nothing read it, so the field certified whatever it wanted — 36
    // sheets out of 36 were behind their subject at laying, one of which
    // had certified five false statements for ten days.
    // 🛑 An inert field costs nothing; a field attesting a freshness it
    // does not have is FALSE TESTIMONY. That is what ruled out simply
    // removing the field.
    // ⚠️ DECREASING freeze, like TSD-04: the 36 lags are frozen, only a NEW
    // staleness turns red, and a re-verified sheet must LEAVE the baseline.
    // A gate that turned red at once on the 36 would have been switched off
    // the day it was laid.
    // ⚠️ It SKIPS, saying so, where none of the cited commits exists — the
    // public clone is born from a single commit. Seen red on its SIX axes
    // before being believed (VC-00 collapsed corpus, VC-01 field removed,
    // VC-02 subject not found, VC-03 unknown commit, VC-04 new staleness,
    // VC-05 healed freeze entry), then restored to the byte.
    {
        name: "Fraîcheur attestée par les fiches docs/specs (SPECS-FRESH)",
        run: ["npm", "run", "check:specs-fresh"],
    },
    // A workshop document's `version:` must EQUAL the highest version of
    // its revision table. The closing protocol asks for TWO gestures (bump,
    // and lay the line) and nothing tied them: the second gets lost.
    // 🛑 This gate's deposit was MANUFACTURED BY THE CHAIN THAT WROTE IT —
    // the debt register and one roadmap, bumped without a line, found on
    // 17/08 by the gate itself, repaired retroactively. A two-gesture
    // protocol with only one guarded loses the second, including among
    // those who write it.
    // ⚠️ It reads the workshop: on the public clone it SKIPS saying so.
    // Seen red on its FOUR axes before being believed: `fm > max` (the 2
    // real cases), `fm < max` (witness restored to the byte), root outside
    // the repo, and empty corpus.
    {
        name: "Version d'un doc = sa dernière ligne de révision (DOC-VERSIONS)",
        run: ["node", "scripts/check-doc-versions.cjs"],
    },
    // 🛑 DOC-VERSIONS' REVERSE, and it was guarded by nothing: a closed
    // roadmap leaves the git index, so it EXITS the corpus of the gate
    // above — whose silence becomes indistinguishable from agreement.
    // Measured: over 25 removals, FIVE closures never entered a commit, one
    // of them the very day the gate was written. It cannot read the
    // archived copy (outside the repo); what it does is bring back into the
    // repo what git still knows. Seen red on its three axes: line removed,
    // marker removed, dead glob.
    {
        name: "Clôture des roadmaps retirées (ROADMAP-CLOSURES)",
        run: ["node", "scripts/check-roadmap-closures.cjs"],
    },
    // Same ratchet pattern as MOD-HEADERS, on another object: every
    // `geoleaf:*` name found in the sources must exist in `GeoLeafEventMap`
    // or `GeoLeafRawEventMap`, and the untyped baseline can only shrink.
    // Without this gate, the next untyped event arrives with nothing saying
    // so — which is exactly how `geoleaf:toolbar:action`, the canonical
    // extension seam, could stay untyped for the product's whole life.
    // ⚠️ This comment announced "23 typed out of 76 found; the remaining
    // 53" — wiring-day figures, never re-measured, and false since. The
    // gate prints its own at every run.
    {
        name: "Événements dispatchés typés (EVENT-MAP)",
        run: ["npm", "run", "check:event-map"],
    },
    // The two descriptions of the `GeoLeaf` namespace (`GeoLeafGlobal` on
    // the core side, `GeoLeafHost` on the host-runtime side) cannot be
    // linked by the compiler: host-runtime is bundled into each plugin and
    // imports nothing from the core, not even a type. They thus drifted
    // without a witness — `POI` stayed in the contract after the
    // subsystem's dissolution, and `GeoJSON`, the plugins' most-called
    // member, was described on neither side. This gate compares the NAMES
    // against the post-boot oracle; the SHAPES' conformity is enforced by
    // `typecheck:consumer` (extension-contract.ts).
    {
        name: "Contrats du namespace synchronisés (HOST-SYNC)",
        run: ["npm", "run", "check:host-sync"],
    },
    // HOST-SYNC above holds that every DECLARED member exists on the
    // namespace; this one holds the inverse: every namespace key is
    // declared. Without it, a new key falls into `GeoLeafGlobal`'s
    // `[key: string]: unknown` trail and reads `unknown` — the compiler has
    // nothing to verify on its assignment. The untyped list is nominative
    // and can only shrink; the percentage enforces nothing, it RISES when a
    // key is removed (one removal batch took it from 27 to 31% without
    // writing a line of type). ⚠️ HOST-06 refuses bare
    // `unknown`/`any`/`Record<string, unknown>`: without it, the baseline
    // would settle itself by declaring 62 empty members.
    {
        name: "Namespace GeoLeaf typé sous cliquet (NAMESPACE-TYPING)",
        run: ["npm", "run", "check:namespace-typing"],
    },
    // The invariant this repo did NOT have. The three gates above hold that
    // what we declare exists; this one holds that what downstream DEPENDS
    // on has not vanished. Nine keys left the namespace because no monorepo
    // reader read them, and no green from here could see it: the reader was
    // outside.
    // ⚠️ It SKIPS when `GEOLEAF_CONSUMERS` is not defined, which is the
    // default — the manifest lives at the consumer's and no default path is
    // written in `scripts/`, which ships entirely in the public clone. The
    // SKIP prints the path tried and its motive; it is never silent. What
    // keeps it from swallowing everything is `probe-gate-visibility.cjs`'s
    // `GATE-PROBE` assertion, which plants a FIXTURE manifest and requires
    // seeing the gate turn red on it — it does not prove the real manifest
    // is read, it proves the gate STILL BITES.
    {
        name: "Contrat inverse — ce dont l'aval dépend (CONSUMER-CONTRACT)",
        run: ["npm", "run", "check:consumer-contract"],
    },
    {
        name: "Qualified tree is up to date (docs:tree)",
        run: ["npm", "run", "docs:tree:check"],
    },
    // The derived API reference stops being a fossil. Its output dated
    // from 25/07, the core had moved until 26/07, and `docs:api` was wired
    // NOWHERE. Meanwhile `API_REFERENCE.md` was hand-edited: that is the
    // whole divergence between the repo's two references.
    // ⚠️ A MANIFEST is gated, not the render, and that is not a shortcut —
    // the render engraves `git rev-parse HEAD` (29 files out of 54
    // measured), so it has no fixed point: the gate would turn red at the
    // very commit that just regenerated. And it weighs 1,806 files / 24 MB
    // for the core alone, at one line of HTML per file. Same lesson as
    // `generate-docs-tree.cjs`, which wrote it: comparing the RENDER left
    // its `--check` green while 31 annotations out of 129 were dead.
    {
        name: "API surface manifest is up to date (gen:api-surface)",
        run: ["npm", "run", "gen:api-surface:check"],
    },
    // The 2nd generator. `PROFILE_JSON_REFERENCE.md` is hand-written and
    // published on npm; measured, it documents 128 parameters when the 12
    // schemas carry 381. It is thus not only exposed to drift, it is
    // INCOMPLETE, and nothing said so. This gate keeps the derived
    // reference fresh; `npm run gen:profile-schema:audit` prints the gap
    // with the written one in both directions.
    {
        // ⚠️ DERIVED view, not a competing file — what distinguishes this
        // report from the global `attributes.json` that was ruled out: a
        // view cannot point at a deleted layer, and it turns red if a
        // profile moves without it.
        name: "Attribute model report is up to date (gen:attributes-report)",
        run: ["npm", "run", "gen:attributes-report:check"],
    },
    {
        name: "Profile schema reference is up to date (gen:profile-schema)",
        run: ["npm", "run", "gen:profile-schema:check"],
    },
    // The config chain's SECOND link. `profiles/schemas/*.json` →
    // inventory → HTML: the first link is guarded both ways by
    // `check-config-coverage` (below), the second was NOT. An inventory
    // modified without regeneration left a stale, committed HTML, in exit 0.
    // ⚠️ The prerequisite was making the output DETERMINISTIC: it embarked
    // `new Date()`, so it diverged from itself every day and no comparison
    // was possible. The date now comes from the inventory's banner — same
    // regime as `docs:tree:check`.
    {
        name: "Config reference is up to date (gen:config-reference)",
        run: ["npm", "run", "gen:config-reference:check"],
    },
    // The COMPILED complement of the gate above. The deny-list only sees
    // what was written into it; it let through two examples of the same API
    // passing an options object as 3rd argument where the signature reads
    // `duration?: number`, and assigning a return declared `void`. No regex
    // described them — a compiler does not need them described. Compiles
    // the doc's ```ts blocks against the published `.d.ts`, hence its place
    // AFTER the build (like `typecheck:consumer`).
    // Baseline: only blocks on a NEW error.
    {
        name: "Docs examples typecheck (arité, exports fantômes)",
        run: ["npm", "run", "check:docs-typecheck"],
    },
    // 30/07/2026 — the VitePress site builds HERE, and not only on the
    // machine of whoever thinks of it. `ignoreDeadLinks: false` makes the
    // build FAIL on a dead link; that was the second net laid earlier, but
    // it only protected manual runs. Measured: the build failed for FIVE
    // DAYS (25 → 30/07, `NOTICE.md`) with nothing seeing it — the stale
    // `docs-dist/` still served, Vite refusing to empty an `outDir` outside
    // its root (`emptyOutDir` not configured).
    // ⚠️ Placed AFTER `check:docs-typecheck`: both read the same corpus,
    // and a dead link is less urgent than an example that does not compile.
    {
        name: "Docs site build (VitePress — liens morts)",
        run: ["npm", "run", "docs:build", "-w", "@geoleaf/core"],
    },
    // Every `X[k] = …` with a non-literal `k` either calls the canonical
    // blocklist (utils/general/object-path-guard), sits in the script's ALLOWLIST with
    // a justification, or is frozen in the baseline. Blocks only NEW unguarded sinks:
    // the original hole was a sink an earlier sweep had not reached, and nothing stopped
    // the next one appearing the same way. Keep in sync with ci.yml and .husky/pre-commit.
    {
        name: "Dynamic-key writes (prototype pollution)",
        run: ["npm", "run", "check:dynamic-key-writes"],
    },
    { name: "Duplicate code (jscpd)", run: ["npm", "run", "dup:check"] },
    // The core's i18n table is flat; a nested plugin dictionary makes its
    // keys unreachable WITHOUT breaking anything, and the hardcoded
    // fallback masks the outage. The existing i18n net only sweeps the
    // core's `src/lang/`: no plugin dictionary was verified. Green (50
    // dictionaries) at wiring ⇒ no baseline.
    { name: "i18n dict shape (flat keys)", run: ["npm", "run", "check-i18n-shape"] },
    // The gate had existed since March and was wired nowhere: the hole
    // through which MIGRATION_V1_V2.md left (b3d85253, 30/03), leaving 4
    // 404 links in production. Green (0/64) at wiring ⇒ no baseline, it
    // only bites on a new regression.
    { name: "Dead links (public docs)", run: ["npm", "run", "check:links"] },
    { name: "Dead CSS (purgecss)", run: ["npm", "run", "verify:purgecss"] },
    { name: "CSS token vars defined (plugins/libs)", run: ["npm", "run", "verify:css-tokens"] },
    { name: "No Leaflet references", run: ["node", "scripts/verify-no-leaflet.cjs"] },
    // Archi roadmap S0 — `packages/core/src/` must never import `@geoleaf-plugins/*`.
    // Architecture boundary (the core stays autonomous and tree-shakeable), NOT a
    // licence one: it survived the all-MIT switch untouched. Until S0 this gate ran
    // ONLY in sync-core-public.yml — the rule CLAUDE.md calls non-negotiable had
    // exactly one enforcement point, inside a mirror workflow. That workflow is gone;
    // this wiring is now the primary one. Keep in sync with ci.yml and
    // .husky/pre-commit.
    { name: "Core is standalone", run: ["node", "scripts/verify-core-standalone.cjs"] },
    // The previous one's SYMMETRIC boundary. `verify-core-standalone`
    // forbids core → plugins; this one frames plugins → core, which was
    // watched by nothing: addpoi embarked 404 KB of core copy, and four
    // paths read an instance the host never initialises.
    {
        name: "Plugin → core boundary",
        run: ["node", "scripts/verify-plugin-core-boundary.cjs"],
    },
    // The counterpart of the boundary above. That one FORBIDS importing
    // the core's sources; there remain, by necessity, deliberate COPIES
    // (pill-search, storage-contract, field-renderer/sanitize). A copy
    // nobody rereads drifts silently — exactly what happened to
    // `coreConfigGet`. This gate pins a normalised hash of each half and
    // forces a human re-confrontation as soon as one side changes.
    {
        name: "Seam drift (deliberate cross-boundary copies)",
        run: ["node", "scripts/verify-seam-drift.cjs"],
    },
    // The fourth guard of the same family, on an object none of the three
    // looks at: the MOMENT a lazy plugin subscribes to boot signals.
    // Subscribing at module body is laying a listener for an event perhaps
    // already past — and the symptom is entirely silent (available,
    // activated, no error, the feature absent).
    // ⚠️ The question is one of SCOPE, not text: the same call is correct
    // inside a function and broken at module body. The gate therefore reads
    // the AST. Measured at laying: the two plugins the instruction said "to
    // instruct" do NOT behave the same — one is outside the class by
    // construction, the other is in it and gets out through an immediate
    // fallback, which its exemption verifies STRUCTURALLY instead of
    // asserting it.
    // Seen red on its FOUR axes: exemption witness fallen, unexempted
    // subscription, renamed signal (refusal to conclude), subjectless
    // exemption. Keep in sync with ci.yml.
    {
        name: "Abonnement au boot à l'import (BOOT-SUB)",
        run: ["npm", "run", "check:boot-subscription"],
    },
    // The third boundary gate, locking the whole. core-boundary FORBIDS
    // importing the core's sources; seam-drift watches the deliberate
    // COPIES; this one forbids RE-DEFINING a utility that lives canonically
    // in @geoleaf/host-runtime instead of importing it — the regression
    // class through which `coreConfigGet` had drifted from its 9 copies.
    // Keep in phase with ci.yml and .husky/pre-commit.
    {
        name: "Plugin shared-util fork (host-runtime re-copies)",
        run: ["node", "scripts/verify-plugin-shared-fork.cjs"],
    },
    // The meta-gate: do the gates above still SEE what they are supposed
    // to scan? They enumerated `packages/` at a single level, so the
    // directory regrouping would have let them exit 0 having read nothing —
    // green and blind. A gate green for the right reason and a gate green
    // because it looked at nothing are indistinguishable from outside; this
    // one makes the difference, by planting a nested package carrying known
    // defects and verifying each reacts.
    // ~0.4 s, no `npm install` (the registry reads directories). Bilateral
    // proof done: restoring the old one-level `readdirSync` in
    // verify-no-leaflet turns the probe red, and restoring it back greens it.
    {
        name: "Gate visibility probe (nested package)",
        run: ["node", "scripts/probe-gate-visibility.cjs"],
    },
    // The 7 `globals.*.ts` escaped the facade-purity gate, and rightly so:
    // writing on the namespace IS their trade. The contract that fits them
    // is not purity but OWNERSHIP — this surface is the public contract the
    // plugins read.
    {
        name: "Globals ownership (namespace GeoLeaf)",
        run: ["node", "scripts/verify-globals-ownership.cjs"],
    },
    // Archi roadmap S1 — npm silently drops a files[] entry pointing at nothing, so a
    // package can declare it ships a LICENSE and publish without one for months. That
    // is what happened: 10 packages declared an absent LICENSE and addpoi listed
    // "LICENCE" (FR spelling), an entry that could never match. Build outputs are
    // exempt (git-ignored). Keep in sync with ci.yml and .husky/pre-commit.
    { name: "Package files[] exist", run: ["node", "scripts/check-package-files.cjs"] },
    { name: "Repo hygiene", run: ["node", "scripts/verify-repo-hygiene.cjs"] },
    // What the `pre-commit` hook REALLY plays. Its 19th command skips at
    // every commit on this workstation — `GEOLEAF_CONSUMERS` is not in the
    // hook's environment —, and it announces it, which is correct; but
    // nothing rendered the overview, and nothing kept a gate there from
    // exiting 0 WITHOUT A WORD. Static mode here (instant): list derived
    // from the hook, symmetry of its TWO branches, anchoring of the skip
    // vocabulary. The gate-by-gate classification is `--run`, the
    // on-demand oracle — it replays the 17 gates, which would duplicate the
    // rest of this file.
    {
        name: "Gates du hook pre-commit (HOOK-01…05)",
        run: ["node", "scripts/verify-hook-gates.cjs"],
    },
    // The missing link between TWO corpora. `extracted-features.guard`
    // proved `getIconsConfig`'s absence by scanning `src/` and SKIPPING
    // `__tests__` — while two suites wrote it there, for forty days. A
    // suite doubling a symbol no source carries attests a vanished API: its
    // oracle is its own fixture, and it stays green.
    // DECREASING ratchet (8 at laying, five of them real defects, frozen and named).
    {
        name: "Symboles morts doublés dans les tests (MDS)",
        run: ["node", "scripts/check-mocked-dead-symbols.cjs"],
    },
    // TTC — JS-TEST-DEBT imposes TypeScript on new tests; this is what
    // compiles it. Decreasing baseline (271 pairs frozen at laying), ~12 s.
    {
        name: "Suites TypeScript type-checkées (TTC, cliquet)",
        run: ["node", "scripts/check-test-typecheck.cjs"],
    },
    // SLOT — a slot declared twice (init.js + entry.ts) must be declared identically.
    {
        name: "Déclarations de créneaux alignées (SLOT)",
        run: ["node", "scripts/check-slot-declarations.cjs"],
    },
    // NF — a production fetch carries an abort path (ratchet, 12 frozen at laying).
    {
        name: "Fetch de production annulables (NF, cliquet)",
        run: ["node", "scripts/check-naked-fetch.cjs"],
    },
    // LI — every registry entry of the lock carries an integrity hash (ratchet, frozen at laying).
    {
        name: "Intégrité du lock (LI, cliquet)",
        run: ["node", "scripts/check-lock-integrity.cjs"],
    },
    // CCO — a cross-package CSS coupling (class written here, defined
    // elsewhere) is declared with its motive, or it does not exist; the 6
    // accidental ones are frozen, decreasing list.
    {
        name: "Couplages CSS inter-paquets déclarés (CCO)",
        run: ["node", "scripts/check-css-class-ownership.cjs"],
    },
    // WREF — no new workshop reference in anything the public repo ships (code-autonomy
    // roadmap; ratchet posed BEFORE the triage: 2725 tokens frozen, shrink-only).
    {
        name: "Renvois d'atelier gelés décroissants (WREF)",
        run: ["node", "scripts/check-workshop-refs.cjs"],
    },
    // WPATH — public PROSE must not point the reader into the workshop. Complements WREF,
    // which covers the workshop docs directory across all public text; this one takes the
    // harness apparatus, on hand-written `.md` only. No baseline: zero carriers at posing.
    {
        name: "Prose publique ne pointant pas dans l'atelier (WPATH)",
        run: ["node", "scripts/check-workshop-paths.cjs"],
    },
    // CLANG — no new French comment in shipped code (stop-word detection, never accents;
    // frozen census at posing, shrink-only).
    {
        name: "Commentaires de code en anglais (CLANG)",
        run: ["node", "scripts/check-comment-lang.cjs"],
    },
    // A side-effect module has NO consumer, by definition — three
    // instruments already declared one dead in concert and all three were
    // wrong, at the price of a production TypeError no test saw. GRAFT-03
    // guards what the register entry said nothing guarded: that the
    // module's BARE anchor still exists.
    {
        name: "Modules d'effet de bord et leur ancrage (GRAFT)",
        run: ["node", "scripts/check-graft-sites.cjs"],
    },
    // The two dead-code instruments did NOT print what they had scanned: a
    // shrinking perimeter returns the same green as an intact one. This
    // gate derives the perimeter independently of them — so it sees a
    // shrinkage their own green would mask.
    {
        name: "Périmètre des instruments de code mort (DCS)",
        run: ["node", "scripts/check-dead-code-scope.cjs"],
    },
    // "No importer" and "imported for its side effect" are two things, and
    // nothing told them apart — which is why the obvious route (forbidding
    // an importer-less module) would turn red on side-effect modules. MG-00
    // refuses to conclude when resolution breaks: this instrument returned
    // 914 orphans out of 929 before being right, and nothing would have said so.
    {
        name: "Graphe des modules — orphelins et effets de bord (MG)",
        run: ["node", "scripts/check-module-graph.cjs"],
    },
    // "Repo hygiene"'s counterpart. That one keeps an unDECLARED script
    // from entering; this one keeps a declared, invoked script from staying
    // unTRACKED, a state in which ci:local is green here and dead on a
    // fresh clone.
    {
        name: "CI scripts are tracked (CI-SCRIPTS-TRACKED)",
        run: ["node", "scripts/verify-ci-scripts-tracked.cjs"],
    },
    // The two gates guard the SAME property from both ends, hence their
    // neighbourhood: the one above verifies every script invoked here is
    // tracked, this one that every `ci.yml` gate is indeed invoked here —
    // or exempted with its motive AND its witness.
    //
    // This is what finally makes the property announced at the top of this
    // file true. It was verified on one axis (the test perimeter, by
    // `lib/test-scope.cjs`) and conventioned on the other: the gate list
    // rested on a "Keep this list in sync" comment, i.e. on a manual
    // gesture where the file announced a guard.
    {
        name: "CI parity (ci.yml ⊆ ci:local, ou exempté avec témoin)",
        run: ["node", "scripts/verify-ci-parity.cjs"],
    },
    // The application's contract (apps/geoleaf-app). Takes over the 2
    // assertions removed from `bundle.test.js`, and several of its
    // invariants bear on the shapes `build-deploy.cjs` patches by `/gm`
    // regex without `/s`: a line break inserted into the `Optional plugins`
    // comment or a gated plugin <script> made the patch miss, and the
    // deployment came out wrong in exit 0. Static, ~instant.
    // ⚠️ This comment wrote "adds 3 invariants" until 08/08/2026; there
    // were ten. The count is NOT copied here — it derives from the name
    // list on the script side and prints at end of run.
    {
        name: "App template contract (APP-TEMPLATE)",
        run: ["node", "scripts/verify-app-template.cjs"],
    },
    { name: "Plugin Contract v1", run: ["node", "scripts/verify-plugin-contract.cjs", "--fail"] },
    // The README of a published plugin is the integrator's only door, and
    // several gates already read that corpus — but every one of them checks
    // what is written is VALID, never that what is declared is written. A
    // configuration key could be added, shipped, read at runtime and never
    // documented, with all of them green. Measured before this gate existed:
    // 133 members across 11 plugins, ONE undocumented (`table.exportFormats`,
    // live at `panel.ts`). Documented first, gate written second — a gate born
    // red on a corpus it cannot fix gets disarmed within the week.
    {
        name: "Plugin README ↔ config déclarée (PRC)",
        run: ["node", "scripts/check-plugin-readme-config.cjs"],
    },
    // The template is the only package NONE of the gates above sees:
    // ESLint ignores it (its `__PLUGIN_NAME__` tokens are not valid TS) AND
    // it is outside the `workspaces` globs (`!packages/_*`), so
    // `registry.all()` never returns it. Two legitimate exclusions which,
    // together, leave readerless the file every future plugin is born from.
    // Cost measured twice: the `as any` accessor survived there until
    // 31/07/2026, and its `profileKey` violated INV-CONFIG — a FROZEN
    // invariant — until 08/08/2026. This gate scaffolds and exercises the
    // OUTPUT, the only channel through which a token file can be held to
    // the same bar as the code it begets. ⚠️ It requires the core's
    // `dist/types/`, hence its place AFTER the build.
    { name: "Plugin scaffold (SCAFFOLD)", run: ["node", "scripts/verify-plugin-scaffold.cjs"] },
    // A `waitForFunction` whose timeout goes in 2nd position LOSES it: it
    // becomes an argument of the page function, and the wait falls back on
    // `actionTimeout`. Measured: 41 sites, 28 of which asked 15 to 30 s and
    // only got 10. The repo knew the trap and had documented it ON ONE SPEC
    // — a gate is what generalises a lesson.
    {
        name: "E2E wait signature (E2E-WAIT-SIG)",
        run: ["node", "scripts/check-e2e-wait-signature.cjs"],
    },
    // S7 — these four run in ci.yml but were missing here, so `ci:local` could be green
    // while CI failed. That defeats the whole "ci:local green before push" protocol, whose
    // point is to never burn a run of a scarce free-tier quota: a mirror that omits gates
    // does not validate, it guesses.
    //
    // ⚠️ This line said "Keep this list in sync with .github/workflows/ci.yml".
    // It was the only thing holding the property, and it was a MANUAL
    // GESTURE — exactly what the paragraph at the top of this file
    // nonetheless announced as verified. The "CI parity" step now verifies
    // it: a gate added to `ci.yml` and absent from here turns `ci:local`
    // red instead of waiting for a remote run to discover it.
    {
        name: "Config coverage (schema ↔ inventory)",
        run: ["npm", "run", "verify:config-coverage"],
    },
    {
        name: "Config consumers (citations)",
        run: ["npm", "run", "verify:config-consumers"],
    },
    {
        // TPL-CFG — a layer produced by `layerTemplates` must not carry a
        // `_config.json`: its `inlineConfig` "skips the fetch entirely", so
        // the file is read by nobody but gets edited. 24 ghosts removed.
        name: "Template layer configs (TPL-CFG — aucune config fantôme)",
        run: ["npm", "run", "check:template-layer-configs"],
    },
    { name: "Profile contract (validate:profiles)", run: ["npm", "run", "validate:profiles"] },
    { name: "Version consistency", run: ["npm", "run", "versions:check"] },
    // `versions:check` never contacts the registry — all its invariants are
    // intra-repo. The doctrine names only the LOUD direction (a version bumped
    // without a publication); the silent one is the version staying put while
    // the publishable content moves, and nothing looked at it. Measured the
    // day this was wired: 13 published packages, 13 diverged, 264 source files.
    // Hence a ratchet on a baseline, not a red — and an explicit SKIP with no
    // registry access, so a network hiccup never reddens a local run.
    {
        name: "Parité dépôt ↔ registre npm (PUB)",
        run: ["node", "scripts/verify-published-parity.cjs"],
    },
    // IMPL — SHIP-SPEC's and knip's counterpart for the class neither can
    // see: a package the repo LOADS without IMPORTING it. `happy-dom` is
    // named by a string (`environment: "happy-dom"`), `tsx` is injected
    // into NODE_OPTIONS — neither is an edge of the module graph. Both hung
    // on an auto-installed optional peer that npm ≥ 11 does not carry over;
    // and only `publish.yml` goes up to npm ≥ 11, so neither this file nor
    // `ci.yml` could see it.
    // ⚠️ Neighbour of "Version consistency" on purpose: that one reads the
    // ranges BETWEEN internal packages, this one reads what is declared vs
    // what really executes.
    {
        name: "Implicit toolchain deps (IMPL — déclaré = exécuté)",
        run: ["node", "scripts/verify-implicit-deps.cjs"],
    },
];

/**
 * Steps added by `--e2e`. Separate from STEPS, no longer pushed into it at load.
 *
 * The table must be READABLE without being executed:
 * `verify-ci-scripts-tracked.cjs` imports it to verify every script invoked
 * here is tracked by git. A `STEPS.push()` conditioned on `process.argv` at
 * module level would have given that reader a table different from the one
 * that runs — and it would have missed the 3 E2E steps, i.e. exactly
 * `build-deploy.cjs`, `build-deploy-coverage.cjs` and the Playwright suite.
 */
const E2E_STEPS = [
    // PREAMBLE, and it is first for cost as much as readability. Without a
    // browser, the suite takes 1.2 min to return ~215 IDENTICAL reds, which
    // look like a catastrophic product regression and not an absent
    // directory. This step refuses in 2 s, with the diagnosis and the
    // remedy command.
    // ⚠️ It exits 2, not 1: "can the suite be played" is a PREREQUISITE,
    // not a verdict. Placed before the builds, it also avoids paying 4
    // builds for nothing.
    {
        name: "Navigateurs Playwright présents (PW-BROWSERS)",
        run: ["node", "scripts/verify-playwright-browsers.cjs"],
    },
    // Second preamble, same family and same placement motive: `Timed out
    // waiting 60000ms from config.webServer` arrives AFTER the builds,
    // costs a minute, and names no port.
    // ⚠️ It verifies each port is FREE or ANSWERS — not that it is free:
    // the config sets `reuseExistingServer` locally, so a server already
    // there is deliberately reused.
    {
        name: "Ports du harnais E2E utilisables (E2E-PORTS)",
        run: ["node", "scripts/verify-e2e-ports.cjs"],
    },
    { name: "Build deploy variants", run: ["npm", "run", "build:deploy:all"] },
    // `build:coverage` renamed: it builds NO coverage report, it builds an
    // APPLICATION (deploy-core with Istanbul-instrumented bundles). The
    // name borrowed the "report" sense's vocabulary to designate the
    // "deployment variant" sense — two of the four senses the word carries here.
    { name: "Build deploy-coverage", run: ["npm", "run", "build:deploy-coverage"] },
    { name: "E2E Playwright", run: ["npm", "run", "test:e2e"] },
    // `.nyc_output/`'s only consumer was `report:e2e`, called by NOTHING
    // (neither ci.yml, nor here, nor the hook). The data was produced then
    // thrown away at every run.
    // ⚠️ Bare `report:e2e` is NOT called: `nyc report` exits GREEN on an
    // empty `.nyc_output/`, so the bare step would be green exactly when
    // the measurement fails. The wrapper first sets a witness floor. See
    // its header.
    {
        name: "Couverture du boot du bundle livré (plancher + seuils nyc)",
        run: ["node", "scripts/verify-e2e-coverage.cjs"],
    },
];

const ALL_STEPS = WITH_E2E ? [...STEPS, ...E2E_STEPS] : STEPS;

function runStep(step, index) {
    const label = `[${index + 1}/${ALL_STEPS.length}] ${step.name}`;
    console.log(`\n\x1b[36m── ${label} ──\x1b[0m`);
    console.log(`   $ ${step.run.join(" ")}`);
    const start = process.hrtime.bigint();
    const res = spawnSync(step.run[0], step.run.slice(1), {
        cwd: ROOT,
        stdio: "inherit",
        shell: NPM_SHELL,
    });
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const ok = res.status === 0;
    return { name: step.name, ok, ms, code: res.status };
}

/**
 * Refuses to LAUNCH when a gate of this run could only skip, on a clone
 * that has what it takes to feed it.
 *
 * 🛑 The real risk is not that a gate skips — the skip is the wanted
 * behaviour on the public clone, with its motive written. The risk is that
 * a `ci:local` exits **green believing** it played it: the summary
 * announces 91/91, and one of the 91 read nothing. Measured: the inverse
 * contract is this runner's only gate whose subject lives OUTSIDE the
 * repo, hence the only one that can be silently empty with no repo file
 * showing it.
 *
 * ⚠️ The discriminant is the workshop root, not a variable: on the public
 * clone `_docs_projet/` is absent by decision, and requiring the export
 * there would be a permanent red. On a clone that carries it, the export's
 * absence is a workstation defect, not a repo property.
 *
 * ⚠️ And this refusal lives HERE, in the runner, **deliberately not in the
 * gate**: the same gate is launched by the `pre-commit` hook, where the
 * skip is still an open arbitration. Making it refusing at the source would
 * turn every commit red and settle that arbitration by side effect — which
 * the runner has no business doing.
 *
 * @returns {void} Exits 2 (tooling error, not verdict) when the condition is not held.
 */
function refuseIfConsumerHookMissing() {
    const internalRoot = path.join(ROOT, "_docs_projet");
    if (!fs.existsSync(internalRoot)) return; // public clone — the skip is wanted
    if (process.env.GEOLEAF_CONSUMERS) return;

    console.error(
        "\x1b[31m✗ REFUS DE LANCER\x1b[0m — `GEOLEAF_CONSUMERS` n'est pas défini, et ce clone\n" +
            "  porte `_docs_projet/` : c'est l'atelier, pas le clone public.\n\n" +
            "  Le contrat inverse SAUTERAIT en sortant 0, et le résumé annoncerait un vert\n" +
            "  complet sur une gate qui n'a lu aucun consommateur. Un vert qui compte une gate\n" +
            "  non jouée est pire qu'un rouge : il se cite.\n\n" +
            "    export GEOLEAF_CONSUMERS=~/dev/projects/geoleaf-maintenance-v2/ci\n\n" +
            "  ⚠️ Le hook `pre-commit` n'est PAS concerné : il lance la même gate et la laisse\n" +
            "  sauter, ce qui reste un arbitrage ouvert et non un oubli."
    );
    process.exit(2);
}

/**
 * Refuses to LAUNCH when a GHOST package survives a previous run.
 *
 * 🛑 Two scripts plant a real workspace under `packages/plugins/` and erase
 * it in a `finally`. A `finally` does NOT survive a SIGKILL — deadline
 * exceeded, workstation cut, a firm `Ctrl-C`, two concurrent `ci:local`s
 * one of which is killed. The directory stays, and it matches the
 * workspaces' `packages/plugins/*` glob: it becomes a repo package.
 *
 * ⚠️ **Measured on 19/08/2026: the next run returns 17 red gates, and NONE
 * names it.** `build:deploy`, knip, `docs:tree`, `purgecss`, TSDoc, the API
 * surface… all fail because a ghost package entered their corpus, and each
 * reports its own symptom. The diagnosis costs dear precisely because the
 * cause appears nowhere in the messages.
 *
 * 🛑 **And on 22/08/2026, the same thing with SIX reds — on the other
 * producer, which this refusal did not watch.» It filtered `zz-scaffold-`
 * hardcoded; `packages/plugins/__probe__`, left by
 * `probe-gate-visibility.cjs`, walked past a guard written for it. The
 * corpus now lives in `lib/workspace-debris.cjs`, derived and anchored to
 * its producers, with a guard test that turns red if a pattern stops biting.
 *
 * A named refusal beats seventeen symptoms.
 *
 * @returns {void} Exits 2 (tooling error) when a ghost package lingers.
 */
function refuseIfWorkspaceDebris() {
    const debris = findDebris(ROOT);
    if (debris.length === 0) return;

    const byProducer = new Map();
    for (const d of debris) {
        if (!byProducer.has(d.producer)) byProducer.set(d.producer, { note: d.note, paths: [] });
        byProducer.get(d.producer).paths.push(d.path);
    }

    console.error(
        `\x1b[31m✗ REFUS DE LANCER\x1b[0m — ${debris.length} paquet(s) fantôme(s) survivent à un\n` +
            "  run précédent :\n\n" +
            [...byProducer]
                .map(
                    ([script, { note, paths }]) =>
                        paths.map((p) => `    ${p}`).join("\n") +
                        `\n      ↳ laissé par ${script} — ${note}`
                )
                .join("\n\n") +
            "\n\n  Ils matchent le glob `packages/plugins/*` des workspaces, donc ils sont devenus des\n" +
            "  paquets du dépôt. Lancer maintenant rendrait DIX-SEPT gates rouges — build du\n" +
            "  déployé, code mort, arbre, CSS, TSDoc, surface d'API — et aucune ne les nommerait.\n\n" +
            `    rm -rf ${debris.map((d) => d.path).join(" ")}\n\n` +
            "  ⚠️ Le nettoyage de ces scripts est dans un `finally`, qui ne survit pas à un SIGKILL :\n" +
            "  délai dépassé, coupure de poste, interruption. Ce n'est pas un défaut de ces gates."
    );
    process.exit(2);
}

function main() {
    refuseIfConsumerHookMissing();
    refuseIfWorkspaceDebris();

    console.log(
        `\x1b[1mLocal CI runner\x1b[0m — ${ALL_STEPS.length} gates${WITH_E2E ? " (incl. E2E)" : ""}` +
            `${BAIL ? ", bail on first failure" : ""}`
    );

    const results = [];
    for (let i = 0; i < ALL_STEPS.length; i++) {
        const r = runStep(ALL_STEPS[i], i);
        results.push(r);
        if (!r.ok && BAIL) break;
    }

    // ── Summary ──────────────────────────────────────────────────────────────
    console.log(`\n\x1b[1m── Résumé CI local ──\x1b[0m`);
    for (const r of results) {
        const tag = r.ok ? "\x1b[32m✓ PASS\x1b[0m" : "\x1b[31m✗ FAIL\x1b[0m";
        const secs = (r.ms / 1000).toFixed(1).padStart(6);
        console.log(`  ${tag}  ${secs}s  ${r.name}`);
    }

    const failed = results.filter((r) => !r.ok);
    const skipped = ALL_STEPS.length - results.length;
    if (skipped > 0) console.log(`  \x1b[33m… ${skipped} gate(s) non exécuté(s) (--bail)\x1b[0m`);

    // ── What the CI will run that did NOT run here ───────────────────────────
    //
    // NARRATION, never VERDICT. The verdict belongs to the "CI parity" gate
    // above: two paths able to fail the same property is one path too many,
    // and it is the one people forget to prove. Here the green is only made
    // HONEST — a green that knows itself partial beats a green that
    // promises too much.
    //
    // Position: the summary's ONLY neutral point. The two terminal branches
    // below call `process.exit` immediately, so this is the only place that
    // displays in success AS in failure.
    //
    // Computed from `ci.yml` + the tables, and NOT from `results`: it thus
    // stays true under `--bail`, where the parity gate may never have run —
    // precisely the run where this line counts most.
    //
    // ⚠️ The try/catch is mandatory and touches NO exit code. An unreadable
    // `ci.yml` already turns the parity gate red; letting an exception
    // climb here would replace the summary just gained with a stack trace,
    // four lines from the end.
    try {
        for (const line of require("./lib/ci-parity.cjs").formatRemoteOnly({ withE2E: WITH_E2E })) {
            console.log(line);
        }
    } catch (err) {
        console.log(`  \x1b[33m⚠ énonciation de parité indisponible : ${err.message}\x1b[0m`);
        console.log(
            `  \x1b[2m    (le verdict est porté par la gate « CI parity » ci-dessus)\x1b[0m`
        );
    }

    if (failed.length > 0) {
        console.log(
            `\n\x1b[31m✗ ${failed.length}/${results.length} gate(s) en échec :\x1b[0m ` +
                failed.map((r) => r.name).join(", ")
        );
        process.exit(1);
    }

    console.log(
        `\n\x1b[32m✓ Toutes les gates passent (${results.length}/${results.length}).\x1b[0m`
    );
    process.exit(0);
}

// ── Execution vs reading ─────────────────────────────────────────────────────
//
// This file used to execute at import. It is now also a DATA SOURCE:
// `verify-ci-scripts-tracked.cjs` imports both tables to verify every
// script invoked here is tracked by git — the symmetric blind spot of the
// one closed earlier.
//
// ⚠️ That gate reads the REAL table rather than parsing this file with a
// regex. A textual parser that stops matching after a STEPS refactor does
// not turn red: it finds zero scripts, declares them all tracked, and
// exits green — the very defect the repo has been hunting. A `require`
// cannot return an empty table silently.
// ⚠️ THE EXPORT COMES BEFORE THE EXECUTION, and the order is a fix, not a style.
//
// `main()` loads `lib/ci-parity.cjs` for its end-of-run statement, and that
// module re-`require`s THIS file to read the two tables — a cycle. With
// `module.exports` placed after the call, the cycle closes on a still
// EMPTY `exports`: `STEPS` and `E2E_STEPS` arrived `undefined`, and the
// statement died on "Cannot read properties of undefined".
//
// Measured on 30/07/2026, and it is `main()`'s try/catch that made it
// visible without costing the summary — it printed the motive in place of
// the statement, exactly what it is there for. Exporting first closes the
// cycle on complete tables.
module.exports = { STEPS, E2E_STEPS };

if (require.main === module) {
    main();
}
