#!/usr/bin/env node
/**
 * Verify that no throwaway scripts, build artifacts, or oversized source files
 * have been accidentally committed to the repository.
 *
 * Categories checked:
 *   1. Throwaway scripts tracked in git (fix_*.py, tmp_*, analyze_*.py, etc.), and
 *      any `.cjs`/`.mjs` in root `scripts/` absent from SCRIPTS_ALLOWLIST.
 *   1b. `.cjs`/`.mjs` files OUTSIDE root `scripts/` with no declared owner (T3.5).
 *      Corpus is the index AND the untracked worktree — see getGitVisibleFiles().
 *   2. Build/test artifacts tracked in git (coverage*.txt, *_cov_run.txt, coverage-e2e/)
 *   3. Python bytecode tracked in git (__pycache__/, *.pyc)
 *   4. SOURCE files (.ts/.js/.css) exceeding 700 lines, across all 18 packages.
 *      Tests are OUT OF SCOPE — the limit constrains shipped code, not test suites
 *      (settled 24/07/2026). WARNING, non-blocking.
 *   5. GENERATED artifacts under git control (T4.1) — three assertions:
 *      5a. no artifact path in the INDEX          → the T4 exit criterion
 *      5b. no artifact path untracked AND unignored → blocks the reconstitution
 *      5c. every DECLARED producer output is covered by a known form, and ignored
 *      Forms come from `lib/generated-artifacts.cjs`. Corpus is the index AND the
 *      untracked worktree — see getGitVisibleFiles().
 *
 * Usage: node scripts/verify-repo-hygiene.cjs (from repo root)
 * Exit code 0 = clean, 1 = violations found.
 */

"use strict";

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

// ─── Allowlist — scripts/ files that are legitimate tooling ──────────────────
//
// Renamed from CJS_ALLOWLIST when `.mjs` entered the register: new root tooling is
// written in ESM (`knip-hints-reporter.mjs` was added the day before this rename),
// so a set named "CJS" holding `.mjs` would have been a lying name. The register is
// what makes `scripts/` self-regulating — one register, both extensions.

const SCRIPTS_ALLOWLIST = new Set([
    "audit-ci.cjs",
    // SIGN — installed dependency tree carries valid registry signatures (npm audit signatures).
    "verify-registry-signatures.cjs",
    "audit-cleanup.cjs",
    "audit-dev-report.cjs", // non-blocking audit-dev gate — CI + ci-local
    "audit-innerhtml.cjs",
    // Freshness of `_docs_projet/travail/rapports/` reports: verifies each
    // sourced item is still true on HEAD before archiving (workshop, outside ci:local).
    "audit-report-freshness.cjs",
    // Instrument of the coverage conversion (`--triage` / `--prove-mocks`).
    // DELIBERATELY outside ci:local: it relaunches two coverage passes,
    // which the plan argues against running permanently. The durable
    // property is `verify-test-load-mode.cjs`'s decreasing baseline; this
    // one proves, batch by batch, that the conversion really changed the
    // ATTRIBUTION — which a green suite cannot show.
    //
    // ⚠️ This comment announced `--snapshot` and `--compare`: BOTH were
    // deleted at commit 3285f48e (provider unified on istanbul), and
    // `--snapshot` is what wrote the 117.6 MiB of `run-*` since purged. A
    // comment documenting dead subcommands sends people looking for a
    // nonexistent capability.
    "audit-test-load-conversion.cjs",
    "benchmark.cjs",
    "build-deploy-coverage.cjs",
    "build-deploy.cjs",
    "bundle-profiles.cjs",
    "check-bundle-size.cjs",
    // APP-PAYLOAD — weighs what a USER downloads opening the page (derived
    // shell + first-screen data), where `check-bundle-size.cjs` weighs what
    // an INTEGRATOR embarks. Distinct objects, never compared. CI + ci-local.
    "check-app-payload.cjs",
    // ROUTE-FIXTURES — captures `@geoleaf-plugins/routing`'s corpus at
    // Valhalla and OSRM.
    // 🛑 DELIBERATELY outside `ci:local` AND `ci.yml`, and it is the ONLY
    // repo code that touches the network. A test calling a public instance
    // is subject to a fair-use quota and makes the run non-reproducible:
    // its red would say "the internet moved", which nobody can act on. Run
    // by hand, once; the corpus is versioned, and `.prettierignore`
    // protects it so a re-capture yields a readable diff.
    "capture-route-fixtures.cjs",
    // REGISTRY-CROSSREFS — detector of dead `B-nnn`/`D-nn` references,
    // shared with `packages/core/__tests__/guards/registry-crossrefs.guard.test.ts`.
    // In `ci:local` through `test:guards`, hence OUTSIDE THE CACHE: its
    // subject — the two registers and `CLAUDE.md` — lives outside the
    // package, and a guard whose subject is outside the turbo `inputs`
    // comes out green having read nothing.
    // ⚠️ This entry was missing when the gate was laid, and the green
    // `ci:local` accompanying it could not see it: this check reads
    // `git ls-files`, and the file was still UNTRACKED at run time. A green
    // obtained before `git add` says nothing about new files — same class
    // as "a closing verdict measures the state from before it".
    "registry-crossrefs.cjs",
    // The `pre-commit` hook's oracle: for each command, played / skipped
    // with motive / SKIPPED SILENTLY. Wired in static mode in `ci:local`
    // AND `ci.yml`; `--run` plays the gates and classifies them — the
    // re-measure command recorded in the register.
    "verify-hook-gates.cjs",
    // MDS — a suite does not double a symbol no source carries any more.
    // Links the two corpora `extracted-features.guard` left disjoint: it
    // proved an absence by scanning `src/` and SKIPPING `__tests__`, where
    // the name still lived.
    "check-mocked-dead-symbols.cjs",
    // TTC — compiles the .ts suites JS-TEST-DEBT imposes, decreasing baseline.
    "check-test-typecheck.cjs",
    // SLOT — a toolbar slot's two declarations stay identical.
    "check-slot-declarations.cjs",
    // NF — production fetches carry an abort path (decreasing ratchet).
    "check-naked-fetch.cjs",
    // LI — registry entries of package-lock.json carry an integrity hash (decreasing ratchet).
    "check-lock-integrity.cjs",
    // CCO — cross-package CSS couplings are declared (ownership convention).
    "check-css-class-ownership.cjs",
    // WREF — no new workshop reference in the public corpus (code-autonomy roadmap, S0).
    "check-workshop-refs.cjs",
    // WPATH — public PROSE must not point the reader into the workshop. Complements WREF:
    // `CLAUDE.md` / `.claude/` on hand-written `.md` only. No baseline — zero at posing.
    "check-workshop-paths.cjs",
    // CLANG — no new French code comment (stop-words, never accents).
    "check-comment-lang.cjs",
    // lib/ — the MDS detector, two-stage, with its known-answer witnesses.
    // Extracted at the second reader (the gate and its historical witness),
    // as the rule requires.
    "mocked-symbols.cjs",
    // GRAFT — un module d'effet de bord porte sa marque et son ancrage NU tient encore.
    "check-graft-sites.cjs",
    // lib/ — the graft triage, with its witness. The previous instrument
    // had to be corrected THREE times and lived in an instruction, not in
    // `scripts/`: its verdict was no longer replayable. Extracted here to
    // be so, and shared with the gate.
    "graft-sites.cjs",
    // DCS — the two dead-code instruments' perimeter, derived and PRINTED.
    // Neither said what it had scanned: a shrunk perimeter returned the
    // same green as an intact one.
    "check-dead-code-scope.cjs",
    // MG — "no importer" versus "imported for its side effect". The obvious
    // route (forbidding an importer-less module) would turn red on the
    // latter; this one separates them.
    "check-module-graph.cjs",
    // lib/ — the module graph, resolved through the TypeScript AST. Four
    // blindnesses fixed, three of which returned CREDIBLE lists; each one's
    // witness is written in the header.
    "module-graph.cjs",
    "check-config-consumers.cjs",
    "check-config-coverage.cjs",
    "check-contracts-pure.cjs", // contracts/ type-only purity gate — CI + ci-local + pre-commit
    "check-doc-versions.cjs", // DOC-VERSIONS — a workshop doc's `version:` = max of its revision table; ci-local
    "check-roadmap-closures.cjs", // ROADMAP-CLOSURES — DOC-VERSIONS' reverse: what git still knows of a REMOVED roadmap; ci-local
    // PRC — the README of a published plugin is the integrator's only door, and no gate
    // checked that what a plugin DECLARES as configuration is written there. ci:local + ci.yml.
    "check-plugin-readme-config.cjs",
    "check-specs-verified-against.cjs", // SPECS-FRESH — a docs/specs/ sheet's `verifie_contre:` against its subject's last commit; CI + ci-local
    "discover-plugins.cjs", // plugin fleet discovery from package.json#geoleaf — build-deploy + APP-12 parity read it
    "check-facade-purity.cjs", // geoleaf.*.ts must stay a thin public surface — CI + ci-local + pre-commit
    "check-dynamic-key-writes.cjs", // prototype-pollution ratchet on dynamic-key writes — CI + ci-local + pre-commit
    "check-exact-optional-debt.cjs", // EXACT-OPTIONAL-DEBT (qualite Q4.5) — cliquet, CI + ci-local
    "check-nonnull-assertion-debt.cjs", // NONNULL-ASSERTION-DEBT — ratchet, CI + ci-local
    "check-js-test-debt.cjs", // JS-TEST-DEBT — `.js` test-debt ratchet, CI + ci-local
    "check-doc-config-examples.cjs", // DOC-CONFIG-EXAMPLES — ratchet, CI + ci-local
    "check-dist-integrity.cjs", // DIST-INTEGRITY — 0 duplicate chunks, 0 orphans; CI + ci-local
    "purge-dist.cjs", // preventive side of stacked chunks — wired at the head of `npm run build`
    "check-build-determinism.cjs", // build determinism — costly (2 builds), outside pre-commit
    "check-dead-code.cjs",
    "check-dead-links.cjs",
    "check-e2e-wait-signature.cjs", // E2E-WAIT-SIG — timeout lost in 2nd position
    "check-i18n-dict-shape.cjs", // i18n dictionary shape net — CI + ci-local
    "check-orphan-exports.cjs", // the core's anti-dead-code net (B3) — CI + ci-local + pre-commit
    // PLATFORM-ISO — `@geoleaf-plugins/navigation`'s three adapters are the
    // only point of contact with the browser. Perimeter SCOPED to the
    // plugin and never the repo: the repo carries seven legitimate
    // `navigator.geolocation` outside any `platform/` (the geolocation
    // capability and `measure`'s GPS tool), so repo-wide the gate would be
    // BORN RED — and a gate born red gets disarmed. As long as the plugin
    // does not exist, it returns a MOTIVATED SKIP saying it is not a green.
    // CI + ci-local.
    "check-platform-isolation.cjs",
    "check-consumer-bundle.cjs", // published-package gate (S6) — CI + ci-local + build-deploy
    "check-example-bundle.cjs", // tree-shaking gate (S5) — CI + ci-local + build-deploy
    "check-side-effects.cjs", // sideEffects honesty gate — CI + ci-local
    // SHIP-SPEC — a tarball specifier must resolve OUTSIDE the monorepo.
    // Workspace symlinks mask the class: `@geoleaf/host-runtime` is
    // `private` and 404 on npm, and it resolved green here. CI + ci-local + pre-commit.
    "check-shipped-specifiers.cjs",
    // LIC-HEADERS — the licence notice, on the sources AND the shipped
    // files. The root `LICENSE` requires it to accompany "all copies or
    // substantial portions"; 405 of the tarball's 540 `.js` carried none.
    // LIC-05 also guards the `license` field's VALUE, which PC-05 does not
    // look at. CI + ci-local.
    // ⚠️ Deliberately OUTSIDE pre-commit — same motive as
    // `check-subpath-resolve.cjs`: LIC-04 reads `dist/`, and `lint-staged`
    // reformats the sources mid-flight.
    "check-license-headers.cjs",
    "check-test-failures.cjs",
    "check-versions.cjs",
    "ci-local.cjs",
    // The clean room: ci:local replayed on a detached worktree + npm ci,
    // with CI=true. THAT green is what authorises a push, not ci-local's.
    "ci-push.cjs",
    "count-any.cjs",
    "create-plugin.cjs",
    "deploy-docs.cjs",
    // Generates `docs/reference/API_SURFACE.txt`, the manifest of the
    // TypeDoc-derived surface over the 14 packages, and gates it on
    // freshness (`--check`). It gates the MODEL and not the render: the
    // latter engraves HEAD's SHA (29 files out of 54 measured), so it has
    // no fixed point, and weighs 1,806 files / 24 MB for the core alone.
    // Wired in ci:local + ci.yml. Declared in the commit that creates it.
    // The 2nd generator: `profiles/schemas/*.json` →
    // `docs/reference/PROFILE_SCHEMA_REFERENCE.md`, freshness-gated
    // (`--check`) with an `--audit` mode comparing to the hand-written
    // 128 parameters. Wired in ci:local and ci.yml, declared in the commit
    // that creates it.
    "gen-attributes-report.cjs",
    "gen-profile-schema-reference.cjs",
    "gen-api-surface.cjs",
    "gen-config-reference.cjs",
    // Composes an entry from a capability list, DERIVING the five things a
    // hand-written entry copies (installer const, `FULL` order, import
    // paths, re-exportable facades, dependencies). Not wired in `ci:local`:
    // its guard is carried by
    // `packages/core/__tests__/guards/generated-entries.guard.test.ts`,
    // which the existing suite collects — see that guard's header for the
    // motive (PARITY-11).
    "gen-entry.cjs",
    "generate-pwa-icons.cjs",
    "generate-vector-tiles.cjs",
    "golden-master.cjs",
    // Measures the surface TypeDoc would render if widened
    // (`expand` + `packages`). DELIBERATELY outside ci:local: it guards
    // nothing, it measures. It is versioned because the plan carries ITS
    // figures, and a figure without a command that reprints it fossilises —
    // one pass removed three figures from the plan for that very motive; it
    // cannot write four new ones under the same regime. Writes nothing into
    // the repo.
    "probe-typedoc-surface.mjs",
    // Publishes ONE named workspace, skipping what the registry already
    // carries (15/08/2026).
    // ⚠️ Exists because `publish.yml`'s `@geoleaf/core` and
    // `@geoleaf/field-renderer` steps were BARE `npm publish`: on an
    // already-published version npm returns `E403` and the workflow died
    // BEFORE reaching the 12 plugins. DELIBERATELY outside ci:local — it
    // talks to the registry and publishes, which no gate must do.
    "publish-one.cjs",
    "publish-plugins.cjs",
    // Ports the workshop to the public repo `geoleaf/geoleaf-js`.
    // DELIBERATELY outside ci:local: it talks to the network and writes to
    // a remote repo, which no gate must do. Its default `--dry-run`
    // measures without writing.
    //
    // ⚠️ It replaces a hand `cp` that had left the public repo **15 commits
    // behind**, seven of them on public doc, with nothing flagging it: the
    // public clone is ephemeral (created, pushed, deleted), so there
    // existed no place to compare the two repos, nor to find the exclusion
    // list again.
    "port-to-public.cjs",
    // scripts/lib/ — the workshop/public boundary, and the only home of its
    // four patterns. They lived outside the repo (`~/.claude/geoleaf-nuit/`),
    // hence on a single workstation: a port that did not find them
    // reintroduced 39 workshop files while exiting green. Guarded by
    // `public-partition.guard.test.ts`, seen red on two mutations.
    "public-partition.cjs",
    // Brings `.turbo/cache` back under a size budget. DELIBERATELY outside
    // ci:local: the cache is what makes the sequence tenable, a purger at
    // the head would guarantee the miss on what it just evicted (the full
    // argument is in its header). The cadence lives in
    // `_docs_projet/HYGIENE_CHECKLIST.md`, at end of sprint.
    "purge-turbo-cache.cjs",
    "purgecss-config.cjs", // scripts/lib/ — shared purgecss config (audit + CI gate)
    "side-effect-modules.cjs", // scripts/lib/ — derived side-effect truth (S6), shared by 2 gates
    "packages.cjs", // scripts/lib/ — derived package registry, shared by the gates that enumerate packages
    // scripts/lib/ — "is this package@version ALREADY on the registry?",
    // in one place for its two callers (`publish-plugins.cjs`,
    // `publish-one.cjs`). ⚠️ Copying it would let two definitions of
    // "already published" diverge inside an irreversible gesture.
    "npm-registry.cjs",
    // lib/ — THE canonical shape of the licence banner, and its single
    // home: the `--write` generator, the LIC-01/02/04 gate and the bundles'
    // output banner (`build-config/rollup.mjs`) all three read it here. A
    // gate and its generator each carrying their copy of the rule diverge,
    // and the disagreement reads as "the gate turns red on a bundle just bannered".
    "license-banner.cjs",
    // lib/ — the generated-artefact directory FORMS, plus the derivation
    // from the producers. Three readers (checks 4 and 5 here, check 2 of
    // check-package-files.cjs). Declared in the commit that creates it —
    // the repo missed that gesture three times (see verify-seam-drift.cjs,
    // test-load-sites.cjs and the .mjs).
    "generated-artifacts.cjs",
    // lib/ — THIS file's 3 pattern tables, plus their known-answer
    // witnesses. Second reader: `probe-gate-visibility.cjs`, which could
    // not query them while they lived here (this script executes at
    // import). Declared in the commit that creates it — fourth occasion not
    // to miss that gesture.
    "hygiene-patterns.cjs",
    // THIS file's counterpart. It verifies a script invoked by `ci:local`
    // is TRACKED by git; here we verify a `scripts/` script is DECLARED.
    // Both halves are necessary: an untracked file is invisible to check
    // 1's corpus, and an allowlist entry without a file is not an error.
    "verify-ci-scripts-tracked.cjs",
    // The other half of the same property: `verify-ci-scripts-tracked`
    // guarantees every script invoked by `ci:local` is TRACKED, this one
    // that every `ci.yml` gate is INVOKED — or exempted with its motive and
    // its witness. The gate list rested until then on a "Keep this list in
    // sync" comment, i.e. on nothing.
    "verify-ci-parity.cjs",
    "ci-parity.cjs", // scripts/lib/ — ci.yml parser + leaf resolver, also read by ci-local.cjs
    // ci.yml's gitleaks gate replayed locally through its BINARY (the
    // action itself is not reproducible). Pinned to the exact version the
    // action installs.
    "gitleaks-local.cjs",
    // Coverage gate of the shipped bundle's BOOT (not "E2E coverage": a
    // single spec out of 36 produces it). Wraps `report:e2e` with a witness
    // floor, because `nyc report` is green on empty data. Declared in the
    // commit that creates it.
    "verify-e2e-coverage.cjs",
    // `--e2e` preamble: are Playwright's browsers really there? A
    // DELIBERATE version bump changes the required revision, and nothing
    // local reinstalls them (`ci.yml` does, before each run). Without this
    // preamble the suite takes 1.2 min to return ~215 identical reds,
    // indistinguishable from a product regression.
    "verify-playwright-browsers.cjs",
    // `--e2e`'s second preamble: a HELD but MUTE port makes Playwright wait
    // 60 s then return a message naming no port. Frequent cause: a killed
    // run leaves its `http-server`s orphaned. Reads the URLs from
    // `playwright.config.js`, never a separate list.
    "verify-e2e-ports.cjs",
    "simplify-geojson.cjs",
    "smoke-test.cjs",
    "validate-docs-examples.cjs",
    "typecheck-docs-examples.cjs", // compiles the doc's ts examples (arity, ghost exports)
    // NPM-README — npmjs.com does not render GitHub alerts: `> [!WARNING]`
    // displays as literal text on the package page. Perimeter
    // `registry.publishable()` + the scaffold; the rule is INVERSE on the
    // root README and `docs/`, which GitHub and VitePress render. CI + ci-local.
    "verify-npm-readme-render.cjs",
    "validate-profiles.cjs",
    // TPL-CFG — refuses a `_config.json` for a layer produced by
    // `layerTemplates`: its `inlineConfig` "skips the fetch entirely", so
    // the file is read by nobody but gets edited. 24 ghosts removed. CI + ci-local.
    "check-template-layer-configs.cjs",
    "check-package-files.cjs",
    // ESM-PURITY — no BARE specifier in a published `dist/`, outside the
    // allowlist derived from `peerDependencies`. CI + ci-local.
    // ⚠️ Inscribed here the moment `git add` made the script TRACKED: this
    // gate only sees tracked files, so it could not turn red while the
    // script sat on disk unindexed. The entry thus precedes its commit.
    "verify-esm-purity.cjs",
    // IMPL — SHIP-SPEC's and knip's complement: both start from an IMPORT,
    // this one covers what the repo loads WITHOUT importing (`happy-dom`
    // named by a config string, `tsx` injected into NODE_OPTIONS). Also
    // verifies "declared = executed".
    "verify-implicit-deps.cjs",
    "verify-core-standalone.cjs",
    // Symmetric boundary: plugins → core.
    "verify-plugin-core-boundary.cjs",
    // The deliberate COPIES on either side of this boundary, frozen by hash.
    // ⚠️ Declared late only: it had been turning this gate red since its
    // own commit, exactly like `test-load-sites.cjs` below. Laying a gate
    // without inscribing it here makes it look like a throwaway script —
    // the reflex is to make both gestures in the same commit.
    "verify-seam-drift.cjs",
    "verify-boot-subscription.cjs",
    // Every referenced `var(--gl-*)` must be defined, or set at runtime (allowlist).
    "verify-css-tokens.cjs",
    // The 3rd boundary: local re-definition of a canonical
    // `@geoleaf/host-runtime` utility instead of importing it.
    "verify-plugin-shared-fork.cjs",
    // 09/08/2026 — no secret in a SHIPPABLE `deploy/` variant. Fills the
    // blind spot between `gitleaks` (which scans COMMIT ranges) and
    // `.gitignore` (which covers the git channel): `deploy/` is
    // git-ignored, hence invisible to both, while being what leaves for a
    // client. An unexpired `geoleaf_editor` JWT lived there until that date.
    "verify-deploy-no-secrets.cjs",
    // 09/08/2026 — what SHIPS says what it requires of its server
    // (SC-01/02/03). Sister of the gate above, and same original blind
    // spot: the fact "without the `.mjs` MIME type, nothing boots" was
    // written in `docker/nginx.dev.conf`, i.e. in a DEV file that does not
    // leave with the folder — its own comment admitted it. A `deploy-full`
    // copied onto an nginx production did not boot that day.
    "verify-deploy-server-contract.cjs",
    // lib/ — the server contract itself: the 3 files emitted into each
    // deliverable, plus the `declaresMjsType()` predicate saying what
    // "declaring the type" means. One corpus, two readers (build-deploy +
    // the gate) — `boot-assets.cjs`'s pattern.
    "server-contract.cjs",
    // lib/ — removal of the PROOF-backend bindings (`qgis.geoleaf.dev`)
    // from shippable variants, guarded by DNS-05. ⚠️ Names the dev hosts,
    // NEVER a supplier allowlist: that would silently remove a client
    // profile's production backend.
    "dev-backend.cjs",
    // Ownership of the GeoLeaf namespace.
    "verify-globals-ownership.cjs",
    "verify-no-leaflet.cjs",
    "probe-gate-visibility.cjs", // meta-gate: do the gates see a nested package?
    // PUB — the only instrument that confronts a published tarball with this repo at an
    // EQUAL version. Skips explicitly without registry access. ci:local + ci.yml.
    "verify-published-parity.cjs",
    "verify-plugin-contract.cjs",
    // 08/08/2026 — the plugin template is the only package no gate reads:
    // ESLint ignores it (its `__PLUGIN_NAME__` tokens are not valid TS) AND
    // it is outside the `workspaces` globs (`!packages/_*`). This gate
    // scaffolds two shapes and exercises the OUTPUT, which is valid TS —
    // the only channel through which a token file can be held to the bar of
    // the code it begets.
    "verify-plugin-scaffold.cjs",
    "verify-purgecss.cjs",
    // The HTML/JS contract of the application extracted to
    // apps/geoleaf-app/. Collects the 2 assertions that lived in
    // `bundle.test.js` (a LIBRARY test reading an APP file) and adds 3
    // invariants nothing guarded: the icon path the deployment rewrite
    // depends on, and the SINGLE-LINE shape of the `Optional plugins`
    // comment and the gated plugin <script>s — all patched by `/gm` regexes
    // without the `/s` flag, so a mere line break made them miss silently.
    "verify-app-template.cjs",
    "verify-repo-hygiene.cjs", // this file
    // Published declarations must be REACHABLE (`types` condition).
    "verify-published-types.cjs",
    // SUBPATH-RESOLVE: resolves BOTH branches (`types` and runtime) of
    // each `exports` target. PUB-TYPES only saw the first, hence 13
    // `./facades/*` subpaths that typechecked then threw
    // ERR_MODULE_NOT_FOUND.
    // ⚠️ Absent from this list for a simple reason: the file was not
    // TRACKED BY GIT while ci-local.cjs invoked it — so hygiene did not see
    // it, and a fresh clone failed at launch.
    "check-subpath-resolve.cjs",
    // The commented tree and its gate. `lib/source-inventory.cjs` carries
    // the "documented or not" rule shared by both: one definition, two readers.
    "generate-docs-tree.cjs",
    "check-module-headers.cjs",
    "check-tsdoc-conformity.cjs", // TSDOC-01/02/03 — @param ↔ signature, gate `check:tsdoc`
    "emit-ambient-types.cjs", // publishes the global namespace with the package (post-build core)
    "emit-css-type-stubs.cjs", // `<name>.css.d.ts` stubs for the published `.d.ts` CSS imports (post-build core AND root)
    "source-inventory.cjs",
    // 30/07/2026 — SHARED engine extracting the TSDoc `@example`s. Written
    // for `typecheck-docs-examples.cjs`, extracted when
    // `validate-docs-examples.cjs` needed the same corpus: one definition,
    // two readers, like `source-inventory.cjs` above. Copying it would have
    // created two extractors bound to diverge.
    "tsdoc-examples.cjs",
    // lib/ — SAME motive as `tsdoc-examples.cjs` just above, and it is not
    // a coincidence: the "what the first load requests" derivation lived in
    // `build-deploy.cjs`, which INJECTS it, and the payload gate needed to
    // WEIGH it. Two extractors would have diverged, and whichever of the
    // two goes unmaintained would have come out green measuring something
    // else. One definition, two readers.
    "boot-assets.cjs",
    // lib/ — GeoJSON slimming at deployment (coordinate rounding, and a
    // DISARMED Douglas-Peucker whose record is written in place). Separate
    // from `build-deploy.cjs` because its settings are FIGURES one wants to
    // re-exercise without rebuilding a whole deploy — and that is exactly
    // what allowed measuring that DP only returned 10% of the gain, then
    // removing it.
    "geojson-slim.cjs",
    // Ratchet on untyped events (EM-01/EM-02).
    "check-event-map-coverage.cjs",
    // `GeoLeafHost` ⊆ `GeoLeafGlobal` ⊆ oracle post-boot (HOST-01/02/03).
    "verify-host-contract-sync.cjs",
    // Bounded test tooling.
    "run-tests.cjs", // unit-test launcher: bounds the turbo fan-out × vitest workers
    "test-scope.cjs", // lib/ — the 2 test perimeters + the `ci:local ⊇ ci.yml` invariant
    // lib/ — single definition of "what is a require() site in a test",
    // shared by the `verify-test-load-mode.cjs` gate and the
    // `audit-test-load-conversion.cjs` instrument. Both carried a copy and
    // they had already diverged. When extracted, it had not been declared
    // here: the hygiene gate saw it as a throwaway script and turned red,
    // while `verify-test-load-mode.cjs` DEPENDS on it.
    "test-load-sites.cjs",
    // The guardrail and the measure's calibration.
    "verify-test-load-mode.cjs", // source-`require()` baseline, can only go down
    "verify-coverage-attribution.cjs", // the gate that verifies the measuring DEVICE, not the code
    // ── The .mjs of scripts/ ────────────────────────────────────────────────────
    //
    // Declared when check 1 was extended to `.mjs`. They were tracked,
    // invoked and NEVER controlled: the check only tested `.cjs`.
    // `knip-hints-reporter.mjs` is the witness — created and wired into
    // `check-dead-code.cjs` the day before, declared in ARCHITECTURE.md and
    // the qualified tree, but in no hygiene register, for want of a rule to
    // violate. Third occurrence of the same failure after
    // `verify-seam-drift.cjs` and `test-load-sites.cjs` (see their comments
    // above): the register disciplined 64 `.cjs` and disciplined 0 `.mjs`,
    // while new tooling is written in ESM.
    "check-fgb-index.mjs", // manual FlatGeobuf data-preparation tool (CDC_plugin-flatgeobuf §187)
    "probe-boot-contract.mjs", // manual Chromium probe — sole oracle of the boot marks' ORDER
    // Manual Chromium probe — `position-share`'s two transports, in a real
    // browser against the shipped bundle. The package's 78 tests run under
    // happy-dom against mocked seams; this one is the sole oracle of the
    // REAL GPS watch feeding the emitter, and of the fact `Ws.init()` is
    // never called on the nominal path.
    "probe-position-share.mjs",
    // Static probe — does a guard whose subject is outside its package run
    // uncached? The `test` task's `inputs` are package-relative, so a
    // guard's file invalidates the cache but WHAT IT GUARDS does not: the
    // JOURNAL guard stayed green over three runs above its ceiling. This is
    // the probe that keeps the next one from arriving already asleep.
    "verify-guards-uncached.cjs",
    // Manual Chromium probe — is a toolbar slot DRAWN on the eager path and
    // skipped on the lazy one. The unit tests assert the DECISION against a
    // mocked registry; only this one sees the render, and the eager path
    // (`geocoding`, preloaded by `beforeBoot`) was exercised by nothing —
    // that hole is what made deleting the registration tempting instead of
    // conditioning it.
    "probe-slot-timing.mjs",
    // Manual Chromium probe — does the cache-eviction notice reach the
    // screen, and on WHICH variant? Sole oracle of the eviction wiring:
    // `eviction-notice.ts`'s 10 unit tests exercise the listener's logic,
    // none says it is WIRED into the shipped bundle — and that is exactly
    // the original defect, seen from the other end (a correct, tested
    // listener, in a plugin absent from `deploy-core`). It targets BOTH
    // variants, because a plugin/core duplicate on `deploy-full` would be
    // the symmetric regression.
    // ⚠️ It also carries its own two lies, documented in place: a wrong
    // selector (`.geoleaf-toast`) turned it red everywhere INCLUDING on the
    // witness, and a total-toast-count oracle turned it red on a perfect
    // notice — the page carries boot notices.
    "probe-eviction-notice.mjs",
    // Manual Chromium probe — is the SW observable under Playwright? It
    // CARRIES the trap that costs a day to rediscover: `ignoreHTTPSErrors`
    // is a CONTEXT flag and does not cover the Service Worker SCRIPT's
    // fetch, while `isSecureContext` still returns `true`. Consumed by the
    // `e2e/helpers/{offline,idb}.js` helpers, which take up its answers
    // (traffic seen at CONTEXT level, cut request that still counts).
    "probe-sw-observability.mjs",
    // Manual Chromium probe — WHICH of the TWO tile branches really
    // serves? It exists because that question does not preflight by symbol
    // grep: a non-zero count does not prove life, a zero count does not
    // prove death. It carries the record that REQUALIFIED the arbitration
    // (03/08/2026): the Cache API carries 24 tiles and SERVES them
    // offline, while `cacheProfile()` writes 0 to IndexedDB.
    "probe-tile-cache-arbitration.mjs",
    // Manual Chromium probe — does the tile-cache trim REALLY EXECUTE?
    // (07/08/2026). VERSIONED because its verification section states the
    // condition in full: "an eviction never seen executing bounds nothing".
    // The unit suites run the worker against a SIMULATED Cache API — they
    // say nothing of the insertion order a real `cache.keys()` returns, nor
    // of thousands of `cache.delete()` succeeding, nor of the DEPLOYED
    // bundle (copied, regex-patched, minified) still carrying the written
    // code. Record it carries, replayable: cache seeded to 2,100, one
    // navigation, 2,100 → 1,623 — and 2,100 → 2,124 on the mutation
    // removing the trim call, i.e. exactly the 24 tiles its neighbour above
    // had counted on 03/08. The repo's only instrument that tells the two apart.
    "probe-tile-cache-trim.mjs",
    // Manual Chromium probe — are the third-party BOOT origins really at
    // zero, and does the tightened CSP break nothing? (08/08/2026).
    // VERSIONED because it is the ONLY instrument covering this lot:
    // `verify-app-template.cjs` reads neither the CSP nor the third-party
    // tags (0 occurrences of `unpkg|CSP|script-src|font|integrity`), and
    // `e2e/18-security.spec.js` asserts ONLY `securitypolicyviolation`
    // events, so it is indifferent to the allowed-origin list — the plan
    // had believed it a guardian and got the file wrong. Record it carries,
    // replayable: on the 2 variants, map rendered with canvas, `maplibregl`
    // present, **0 CSP violations, 0 requests to unpkg.com /
    // fonts.googleapis.com / fonts.gstatic.com**. Seen RED by putting the
    // Google Fonts stylesheet back in the source then rebuilding: 1
    // `style-src-elem` violation + 1 origin, named.
    // ⚠️ It distinguishes BOOT origins from RUNTIME hosts (OpenTopoMap,
    // USGS, S3 tiles) — a first draft counted everything not same-origin
    // and returned a false red on perfectly legitimate fetches.
    "probe-csp-origins.mjs",
    // Instruction probe — a route corridor's tile cost against its bbox's,
    // over five synthetic trips. VERSIONED because a design decision
    // depended on it: the "tile list" route adds BESIDE the bbox route and
    // does not replace it, and that verdict is only defensible if the
    // figure carrying it replays.
    // ⚠️ It measured the wrong quantity TWICE before holding: first the
    // trip's length, then its sinuosity, while what decides is the
    // FRACTION OF BBOX FILLED — its "straight" case was a diagonal, where
    // the corridor gains almost nothing. A committed instrument can be
    // corrected; an ad hoc figure cannot.
    "probe-corridor-cost.mjs",
    // Manual Chromium probe — the first load's WATERFALL (08/08/2026).
    // VERSIONED for the exact motive of its two neighbours: the 5 figures
    // the CHANGELOG was to publish came from an ad hoc probe NEVER
    // committed, hence neither replayable nor refutable — the
    // fossilising-figure failure mode. It carries 6 assertions derived from
    // the page, NO hardcoded count: precisely a copied "4 chunks" turned
    // out false (there are 3).
    // ⚠️ Like `probe-csp-origins.mjs`, it targets the nginx vhosts and is
    // thus NOT wired into `ci:local` — the gain it measures is real and not
    // guarded, which must be said rather than assumed.
    // 🛑 SEEN RED twice before being believed. The second one decides: on a
    // `modulepreload` removed from the deploy, W-06 turns red NAMING the
    // chunk while W-02 and W-03 stay green — it sees what no other sees.
    // The pre-compressed-archive trap had to be replayed in passing:
    // without setting aside the `.gz`/`.br`, nginx serves the old markup
    // and the mutation stays invisible.
    "probe-boot-waterfall.mjs",
    // Manual Chromium probe — does the bounded pull REALLY write into the
    // `features` store? (04/08/2026). VERSIONED deliberately: the local
    // read had been proven with an ad hoc probe never committed, whose
    // measure can thus no longer be replayed nor refuted — the preflight's
    // fossilising-figure failure mode. It carries four measures neither the
    // unit tests nor the E2E can render: empty store → 27 written (all
    // `serverId` + `VersionMarker` + `synced`), discriminating extent → 11,
    // and the HARD cap — the OGC loader returns 20 for a cap of 15, the
    // store carries 15. It is also what caught that `Config.Profile` is not
    // mounted on the global namespace, while the unit test was green
    // mocking the hoped-for shape.
    "probe-offline-pull.mjs",
    // VERSIONED for the same motive as its neighbour above: a measure that
    // cannot be replayed cannot be refuted, so it fossilises. It carries
    // six measures of which ONE that neither unit nor E2E render — M6:
    // does the cache purge remove the `synced` entities while leaving the
    // OUTBOX INTACT? The unit test exercises the rule; the probe exercises
    // that the button wired to the SHIPPED bundle applies it, through a
    // facade, a plugin contract and a deferred chunk. The defect already
    // described, and it only shows here end to end: measured 26 entities
    // purged, outbox intact.
    "probe-sync-report.mjs",
    // The instrument that established `performance.memory` is FROZEN by
    // Chrome, and the only one able to replay it: it compares the 4 heap
    // measurement candidates at N = 0 / 10,000 / 30,000 entities, on the
    // deploy, in a real Chromium. Without it, the two lines fossilise — a
    // verdict that cannot be re-measured does not expire. It is NOT
    // throwaway: `e2e/helpers/perf-gate.js` and `e2e/helpers/README.md`
    // cite it as the source of the bands they assert, and the re-measure
    // instruction makes it its recipe.
    "probe-heap-metrics.mjs",
    // The DETERMINISTIC clustering oracle that replaced the FPS invariant,
    // which decided at 5 fps a quantity whose measured noise runs from 31
    // to 52. Cited by `e2e/06-performance-baseline.spec.js`, which depends
    // on it for its criterion: removing it would leave the spec without the
    // measure justifying its threshold.
    "probe-cluster-oracle.mjs",
    "knip-hints-reporter.mjs", // lib/ — knip reporter for configurationHints, which the `json` reporter does not emit
    // lib/ — THE description of the `globalThis.GeoLeaf` surface, and the
    // walk that measures it. Four readers: the two surface tests, the
    // Chromium probe (which transports it by its SOURCE, hence
    // `walkNamespace`'s self-sufficiency) and
    // `verify-host-contract-sync.cjs`, which reads its AST instead of
    // parsing a test file as text. Declared in the commit that creates it —
    // fifth occasion not to miss that gesture, and the first where the
    // check said it itself: it stayed GREEN while the file was untracked,
    // which `verify-ci-scripts-tracked.cjs` exists to catch from the other side.
    "namespace-surface.mjs",
    // HOST-SYNC's inverse invariant: every namespace key is declared in
    // `GeoLeafGlobal` (HOST-04), the untyped list can only shrink
    // (HOST-05), and an EMPTY declaration does not count as typing (HOST-06).
    "check-namespace-typing-coverage.cjs",
    // lib/ — the two AST readers extracted from
    // `verify-host-contract-sync.cjs` the day the gate above needed BOTH.
    // Two copies of a reader drift, and the drift stays invisible while
    // both gates come out green.
    "ts-decl-read.cjs",
    // The INVERSE contract: what downstream DEPENDS on has not vanished.
    // CC-00 to CC-09. It skips with a named motive when `GEOLEAF_CONSUMERS` is not defined.
    "verify-consumer-contract.cjs",
    // lib/ — the consumption-manifest reader, and the VERSION FLOOR that
    // refuses to conclude on a file older than the one the gate was written
    // against. The manifest lives in ANOTHER repo, on a branch: without
    // this floor, a `git checkout` over there would let the gate exit green
    // having read something else.
    "consumer-manifest.cjs",
    // lib/ — the `geoleaf:*` literal survey and its THREE exclusion
    // families, extracted from `check-event-map-coverage.cjs` the day CC-07
    // needed all four. Same rule, same motive: a second reader triggers the
    // extraction.
    "event-names.cjs",
    // lib/ — Markdown code-fence state tracking, CommonMark-conformant.
    // Extracted because the toggle pattern was DUPLICATED in
    // `check-dead-links.cjs` (link AND anchor extraction): fixing one site
    // would have left the other, and the line's wording insisted precisely
    // on that point.
    "md-fences.cjs",
    // Decreasing ratchet on the typing of `scripts/`, `e2e/` and the root
    // configs. These three corpora were covered by NO tsconfig;
    // `tsconfig.tooling.json` covers them in `checkJs`, and the first run
    // returns 301 errors. A green was impossible, a tsconfig without
    // `checkJs` would have been a decorative perimeter — the ratchet is the
    // third way, and this repo's idiom: the debt is quantified and can only shrink.
    "check-tooling-typecheck.cjs",
    // Decreasing ratchet on artefacts without an existence verdict. The
    // sweep had reached 100% and the debt re-formed twice: a countermeasure
    // applied by hand to each member is not a countermeasure, it is a list
    // — and a list forgets.
    "check-tree-qualification.cjs",
    // lib/ — EM-03: an event literal containing a `:` MUST start with
    // `geoleaf:`. Separate from `event-names.cjs` because it measures its
    // companion's INVERSE: that one is anchored on `^geoleaf:` and can
    // thus, by construction, say nothing of an out-of-prefix name. The rule
    // bears on the colon and not an allowlist, because the 16/08 measure
    // made it possible — none of the 19 FOREIGN events surveyed (DOM,
    // Service Worker, MapLibre, Terra Draw) contains one, and the domain's
    // 3 all did.
    "event-gates.cjs",
    // lib/ — the documentation's TWO roots, public (`docs/`) and internal
    // (`_docs_projet/`), and the guard that THROWS when one is missing.
    // Eleven scripts and three test guards wrote `_docs_projet` hardcoded:
    // a hardcoded path does not break when the directory moves, it returns
    // `[]` — the generator then writes where nobody reads any more, and the
    // gate announces "0 results" exiting 0. Fourteen readers out of fifteen
    // were SEEN throwing on it, before the move.
    "docs-paths.cjs",

    // What git still knows of a REMOVED roadmap — shared between the
    // `ARCHIVEES.md` generator and the gate verifying it. Extracted at the
    // second reader, as the repo's rule requires: two copies of a reader
    // drift, and the drift is invisible while both come out green.
    "roadmap-closures.cjs",

    // lib/ — the GHOST packages a killed run leaves under
    // `packages/plugins/`. Two readers: `ci-local.cjs`'s refusal preamble
    // and the WORKSPACE-DEBRIS guard test. Extracted at the second reader,
    // as the repo's rule requires — and here the hardcoded table had
    // ALREADY drifted: it only knew one producer out of two, and the second
    // went through on 22/08 returning six reds none of which named it.
    "workspace-debris.cjs",
]);

// ─── Allowlist — the .cjs/.mjs files that legitimately live OUTSIDE scripts/ ──
//
// PATH-keyed, and deliberately a SEPARATE set from SCRIPTS_ALLOWLIST above. That one
// is keyed by BASENAME: sharing it would let a package-level `benchmark.cjs` or
// `packages.cjs` inherit the exemption written for the root tooling script of the
// same name — an exemption nobody granted it. None of these is a maintenance script,
// and the list is expected to stay short: a package has no business carrying scripts
// of its own (that is what root `scripts/` is for).
const OUTSIDE_SCRIPTS_ALLOWLIST = new Set([
    // Filename imposed by nyc, read from the repo root for the e2e coverage run.
    "nyc.config.cjs",
    // Vitest manual mock — `require()`d by __tests__/setup.js and 3 adapter tests,
    // hence .cjs. Listed by PATH rather than exempting `__mocks__/` wholesale: a
    // directory rule would turn it into a hiding place.
    // (`setup-esm.js` dropped from this list — the file was deleted, it
    // had no referent in any config, only this comment.)
    "packages/core/__tests__/__mocks__/maplibre-gl.cjs",
    // Binary e2e fixture builders (GeoTIFF / KMZ), cited by 17-cog.spec.js and
    // 15-file-import.spec.js. They are the only way to regenerate two binary
    // fixtures — deleting them would leave files nobody can rebuild.
    "e2e/fixtures/_gen-cog.cjs",
    "e2e/fixtures/_gen-kmz.cjs",
    // Root tool configs — filenames imposed by ESLint and PostCSS.
    "eslint.config.mjs",
    "postcss.config.mjs",
    // `@geoleaf/build-config` IS the shared build configuration (private, never
    // published): its 6 modules are the thing itself, not scripts that happen to live
    // there. Listed by PATH rather than exempting the package directory wholesale —
    // same reasoning as `__mocks__/` above, a directory rule would be a hiding place.
    "packages/build-config/rollup.mjs",
    "packages/build-config/csp-style-inject.mjs",
    "packages/build-config/vitest/base.mjs",
    "packages/build-config/vitest/ensure-tsx-node-options.mjs",
    "packages/build-config/vitest/resolve-js-to-ts.mjs",
    "packages/build-config/vitest/worker-budget.mjs",
]);

// Per-package Rollup configs, recognised STRUCTURALLY by exact basename rather than
// listed: every package that builds carries one, so a list would need a new entry per
// package — precisely the failure mode this file avoids elsewhere by deriving from
// `REGISTRY.all()` instead of hard-coding (see the perimeter note further down). 19 files
// today (18 `rollup.config.mjs` + core's `rollup.consumer.mjs`).
//
// ⚠️ EXACT basenames, deliberately NOT a `rollup*.mjs` glob: a glob would make
// `rollup-quickfix.mjs` a hiding place. A throwaway must not be able to pass by
// choosing its prefix.
const PACKAGE_CONFIG_BASENAMES = new Set(["rollup.config.mjs", "rollup.consumer.mjs"]);

// ─── Patterns ────────────────────────────────────────────────────────────────

// The three tables now live in `lib/hygiene-patterns.cjs`, with their
// witnesses. They have a SECOND reader (`probe-gate-visibility.cjs`), and
// this file executes at import: nobody could query them. Same pattern as
// `lib/generated-artifacts.cjs` — one definition, several readers.
//
// Two corrections were carried there, and the second was not in the
// sprint's wording:
//
//   • WIDENING. `fix_[\w-]+\.(py|cjs)$` missed `fix-deferred-paths.js`
//     TWICE — hyphen instead of underscore, and `.js` absent from the
//     alternation. Exactly the shape of the file deleted earlier: a bare
//     CJS in a `type: module` package, broken at execution.
//
//   • `\b` ANCHORING, measured indispensable. The sprint's wording
//     proposed `/fix[-_][\w-]+\.(py|cjs|js)$/i`, WITHOUT an anchor — it
//     takes `prefix-loader.js`, `hotfix-runner.js` and `postfix-util.js`.
//     The previous pattern already carried the defect in germ
//     (`suffix_map.cjs` matched); it had never fired for want of a file of
//     that shape in the index, which is luck, not a guarantee. `\btmp_`
//     and `\bscratch_` were anchored, `fix_` was not: the inconsistency
//     was the defect.
const {
    THROWAWAY_PATTERNS,
    ARTIFACT_PATTERNS,
    BYTECODE_PATTERNS,
} = require("./lib/hygiene-patterns.cjs");

const MAX_LINES = 700;

// Files with explicit ESLint max-lines: off override (deliberate exception)
const OVERSIZED_ALLOWLIST = new Set(["packages/core/src/kernel/security/index.ts"]);

// Paths derived from the registry, never hardcoded under `packages/`:
// after the directory regrouping they would no longer have existed,
// `collectSourceFiles` would have exited on its `existsSync`, and the
// 700-line check would have measured nothing — without a word.
//
// ─── Perimeter widened from 3 to 18 packages (24/07/2026) ─────────────────────
//
// The perimeter was `["core", "plugin-storage", "plugin-addpoi"]`: the repo
// applied to 3 packages a check it exempted the other 15 from. It now
// covers all 18, via `REGISTRY.all()` — a new package enters without
// anyone having to think of it, which a list never does.
//
// The extension was the other blindness: only `.ts` were counted, while
// the project rule bears on `.ts`, `.js` AND `.css`.
//
// ─── The limit targets CODE, never TESTS (settled 24/07/2026) ─────────────────
//
// The widening was first measured tests included: it surfaced 15 files,
// **all test files**, and NO source file in the repo exceeds 700 lines.
// That result settled the question rather than opening a work stream: the
// limit exists to hold the shipped code's readability and modularity, not
// to constrain a test suite — a long test file is often long because it
// covers exhaustively, which is the sought property.
//
// Tests are thus OUT OF SCOPE, by directory AND by file name (see
// `TEST_DIRS` / `TEST_FILE_RE`): `packages/core/__tests__/` sits at the
// package root, `src/__tests__/` at the other 15, and a `*.test.ts` can
// live elsewhere. Covering the three shapes keeps a move from silently
// putting tests back into the perimeter.
const REGISTRY = require("./lib/packages.cjs");
const SOURCE_DIRS = REGISTRY.all().map((pkg) => path.join(pkg.absDir, "src"));

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage", ".turbo"]);

/** Test directories — outside the line-limit perimeter. */
const TEST_DIRS = new Set(["__tests__", "__mocks__", "test-utils", "e2e", "fixtures"]);

/** Test files outside a dedicated directory — `foo.test.ts`, `foo.spec.js`. */
const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]s$/;

// GENERATED artefact directories: measuring the size of a file nobody
// writes by hand teaches nothing and produces a permanent warning.
//
// ⚠️ The list lived HERE, in the shape
// `/\/(docs\/api|docs\/public\/api|docs-dist)\//`, and it matched **zero
// files**: its only reader was `collectSourceFiles`, bounded to
// `<pkg>/src`, where none of those paths lives. The repo thus carried the
// list of its artefact directories with it looking at nothing, while 90
// TypeDoc files were tracked and published. It now lives in
// `lib/generated-artifacts.cjs`, with check 5 as second reader — the one
// that finally makes it load-bearing.
const {
    generatedRootOf,
    isGeneratedPath,
    declaredOutputs,
    gitIgnoredSet,
} = require("./lib/generated-artifacts.cjs");

/** Extensions subject to the line limit — the project rule targets these three. */
const SOURCE_EXTENSIONS = [".ts", ".js", ".css"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

// `core.quotePath=false`: without it, git escapes non-ASCII bytes AND
// wraps the path in quotes. Two of the TypeDoc files came out as
// `"packages/core/docs/api/documents/PWA_\342\200\224_….html"` — quotes
// included. Segment matching survives it, the DISPLAY does not: the report
// named a path that could not be copy-pasted. No effect on ASCII paths,
// hence none on checks 1/1b/2/3.
const LS_FILES = "git -c core.quotePath=false ls-files";

function getTrackedFiles() {
    try {
        return execSync(LS_FILES, { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
    } catch {
        console.error("ERROR: git ls-files failed — not a git repository?");
        process.exit(1);
    }
}

/**
 * Every file git can see: the index PLUS the untracked-and-not-ignored worktree.
 *
 * Check 1b cannot use getTrackedFiles(), for two reasons:
 *   - `probe-gate-visibility.cjs` plants its fixture on DISK and never stages it. A
 *     check reading only the index is therefore unprobeable — and the only way to
 *     probe it would be to `git add` the fixture, which a crashed run would leave
 *     behind. That is worse than the blindness being hunted.
 *   - a throwaway script is worth catching BEFORE it is committed, not after.
 *
 * `--exclude-standard` is what makes the wider corpus safe: dist/, coverage/,
 * node_modules/, deploy/, .turbo/, and `tmp_*` / `scratch_*` / `_archive_local/`
 * are all git-ignored, so the sanctioned parking place for one-shot scripts stays
 * out of scope for free — there is no directory exclusion list to maintain, and
 * none to drift from .gitignore.
 */
function getGitVisibleFiles() {
    try {
        const out = execSync(`${LS_FILES} --cached --others --exclude-standard`, {
            cwd: ROOT,
            encoding: "utf8",
            maxBuffer: 32 * 1024 * 1024,
        });
        // A Set because an unmerged path is listed once per conflict stage.
        return [...new Set(out.split("\n").filter(Boolean))];
    } catch {
        console.error("ERROR: git ls-files failed — not a git repository?");
        process.exit(1);
    }
}

function collectSourceFiles(dir, out) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name) && !TEST_DIRS.has(entry.name)) {
                collectSourceFiles(full, out);
            }
        } else if (
            SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext)) &&
            !entry.name.endsWith(".d.ts") &&
            !TEST_FILE_RE.test(entry.name) &&
            !isGeneratedPath(full)
        ) {
            out.push(full);
        }
    }
}

function countLines(filePath) {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    return lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
}

function matchesAny(filePath, patterns) {
    return patterns.find((p) => p.re.test(filePath));
}

// ─── Check 1+2+3 — Git-tracked files ─────────────────────────────────────────

const trackedFiles = getTrackedFiles();

const throwawayHits = [];
const artifactHits = [];
const bytecodeHits = [];
// A UTF-8 BOM shifts every byte offset by three, silently skewing any tool that
// slices by position — and it survives copy/paste and most editors. Zero tolerated:
// the 23-file stock was stripped on 24/08/2026, this is what keeps it at zero.
// Reading 3 bytes per tracked file costs ~one readdir; no cache, no baseline.
const bomHits = [];

for (const f of trackedFiles) {
    const basename = path.basename(f);
    const isInScripts = f.startsWith("scripts/");

    // Throwaway: .cjs/.mjs in scripts/ not in the register
    const isScript = basename.endsWith(".cjs") || basename.endsWith(".mjs");
    if (isInScripts && isScript && !SCRIPTS_ALLOWLIST.has(basename)) {
        throwawayHits.push({ file: f, label: "unlisted scripts/ module" });
        continue;
    }

    // BOM check first: it is orthogonal to the classification below (a file can be
    // both legitimately tracked AND carry a BOM), so no `continue` here.
    try {
        const fd = fs.openSync(path.join(ROOT, f), "r");
        const buf = Buffer.alloc(3);
        fs.readSync(fd, buf, 0, 3, 0);
        fs.closeSync(fd);
        if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
            bomHits.push({ file: f, label: "UTF-8 BOM" });
        }
    } catch {
        // unreadable (deleted mid-scan under a concurrent session): not this check's verdict
    }

    const throwaway = matchesAny(f, THROWAWAY_PATTERNS);
    if (throwaway) {
        throwawayHits.push({ file: f, label: throwaway.label });
        continue;
    }

    const artifact = matchesAny(f, ARTIFACT_PATTERNS);
    if (artifact) {
        artifactHits.push({ file: f, label: artifact.label });
        continue;
    }

    const bytecode = matchesAny(f, BYTECODE_PATTERNS);
    if (bytecode) {
        bytecodeHits.push({ file: f, label: bytecode.label });
    }
}

// ─── Check 1b — .cjs outside root scripts/ ───────────────────────────────────
//
// Check 1 above governs `scripts/` and nothing else. Nothing governed a `.cjs`
// living anywhere else — and no other tool did either: knip narrows every package
// workspace to `project: ["src/**/*.ts"]` (knip.js), and ESLint ignored
// `**/scripts/**/*.{cjs,js}` plus `**/cov-*.cjs` outright. Five dead scripts sat in
// that gap for months with zero consumers and zero npm scripts:
// `packages/core/cov-check.cjs` and `cov-detail.cjs` at the PACKAGE ROOT, and three
// under `packages/core/scripts/` — one of which (`fix-deferred-paths.js`) was bare
// CommonJS inside a `"type": "module"` package, i.e. broken the moment anyone ran it.
// They were found by an audit, not by a gate. This is the gate (T3.5).
//
// The scope is the WHOLE repository minus `scripts/`, and not `<pkg>/scripts/`:
//   - two of the five were at a package root, so a `scripts/`-shaped rule would have
//     missed the majority of the very files it was written for;
//   - `packages/core/scripts/` was the ONLY package-level `scripts/` in the repo, so
//     that rule would have scanned zero files the day T3.2 deleted it, and stayed
//     vacuously green forever — green because it looked at nothing;
//   - a repo-wide scope needs no package enumeration, so it also covers the two
//     places `REGISTRY.all()` cannot see: `packages/_plugin-template/` (excluded by
//     the `!packages/_*` workspace glob, and copied VERBATIM into every new plugin
//     by `create-plugin.cjs`, so a stray there would multiply), and any future
//     directory outside the workspace globs.
//
// A vacuously-green gate is exactly the failure class `probe-gate-visibility.cjs`
// exists for: it plants `packages/plugins/__probe__/probe-throwaway.cjs` — untracked,
// at the package root — and asserts THIS check names it. Narrowing this scope back to
// `<pkg>/scripts/`, or reading only the index, turns the meta-gate red.

// Hoisted: check 5 shares this corpus, and for the same reason as here. A single git call.
const gitVisibleFiles = getGitVisibleFiles();

const strayCjsHits = [];

for (const f of gitVisibleFiles) {
    if (!f.endsWith(".cjs") && !f.endsWith(".mjs")) continue;
    if (f.startsWith("scripts/")) continue; // governed by check 1's basename register
    if (OUTSIDE_SCRIPTS_ALLOWLIST.has(f)) continue;
    if (PACKAGE_CONFIG_BASENAMES.has(path.basename(f))) continue;
    strayCjsHits.push({ file: f, label: "unlisted module outside scripts/" });
}

// ─── Check 4 — TypeScript files > 700 lines (warning only) ──────────────────

const sourceFiles = [];
for (const dir of SOURCE_DIRS) collectSourceFiles(dir, sourceFiles);

const oversizedHits = [];
const seenFiles = new Set();
for (const f of sourceFiles) {
    const rel = path.relative(ROOT, f).replaceAll("\\", "/");
    if (OVERSIZED_ALLOWLIST.has(rel)) continue;
    if (seenFiles.has(rel)) continue; // `src/__tests__` is reached through two entries
    seenFiles.add(rel);
    const lineCount = countLines(f);
    if (lineCount > MAX_LINES) {
        oversizedHits.push({ file: rel, lines: lineCount });
    }
}

// ─── Check 5 — generated artifacts under git control (T4.1) ──────────────────
//
// Check 2 above is called "Build/test artifacts tracked in git" and
// carries `coverage-e2e/`, `.nyc_output/`. This one asks the SAME question
// about the generated-doc directories — hence its place here rather than
// in a separate script, which would have carried a second list bound to
// diverge and would have needed wiring into ci-local.cjs (49 steps) and
// ci.yml. The repo counts four gates laid without wiring; one carries the
// comment "an unrun gate is indistinguishable from no gate".
//
// ## The corpus, and the property that follows
//
// `gitVisibleFiles` = index + unignored worktree (`--cached --others
// --exclude-standard`). Truth table:
//
//   tracked (the before state, 91 paths)           → in the corpus → RED 5a
//   untracked AND unignored (a .gitignore rule that
//     stopped matching, or a brand-new artefact)   → in the corpus → RED 5b
//   untracked and ignored (the target state)       → out of corpus → green
//
// So: **the only way to be green is that every generated file be
// explicitly ignored.» A gate that can only be green thanks to a LIVE
// `.gitignore` rule cannot become "green scanning nothing" — if the rule
// dies (core move, rename), the files reappear in `--others` and 5b turns
// red. That is what distinguishes this gate from the empty-green constant
// it replaces.
//
// ⚠️ Corollary for `.gitignore`: patterns must be ANCHORED
// (`packages/core/docs/api/`) and not generic (`**/docs/api/`). A generic
// pattern would swallow `probe-gate-visibility.cjs`'s fixture
// (`packages/plugins/__probe__/docs/api/`), which is never indexed: the
// assertion would pass green proving nothing any more. The generic LOOKS
// more robust; it is the choice that makes this gate unfathomable.

const generatedRoots = new Map();
const trackedSet = new Set(trackedFiles);

for (const f of gitVisibleFiles) {
    const hit = generatedRootOf(f);
    if (!hit) continue;
    const group = generatedRoots.get(hit.root) ?? { ...hit, tracked: 0, loose: 0 };
    if (trackedSet.has(f)) group.tracked++;
    else group.loose++;
    generatedRoots.set(hit.root, group);
}

const generatedHits = [...generatedRoots.values()].sort((a, b) => a.root.localeCompare(b.root));

// 5c — the half derived from the PRODUCER, independent of disk state: it
// is thus alive on a fresh clone where no artefact has been generated yet,
// which 5a/5b cannot hold (they need the files to exist).
const declared = declaredOutputs();
// `noIndex` is indispensable: the question is "does a RULE cover this
// path?", not "is it tracked?". Without it, git refuses to qualify as
// ignored a path present in the index — and the RED pre-deindexing phase
// would be mute on 5c(ii).
const declaredIgnored = gitIgnoredSet(
    declared.filter((d) => d.rel).map((d) => `${d.rel}/`),
    { noIndex: true }
);

const producerHits = [];
for (const d of declared) {
    if (d.error) {
        producerHits.push({ producer: d.producer, reason: d.error });
    } else if (!generatedRootOf(d.rel)) {
        producerHits.push({
            producer: d.producer,
            reason: `écrit dans ${d.rel} — forme absente de GENERATED_DIR_FORMS`,
        });
    } else if (!declaredIgnored.has(`${d.rel}/`)) {
        producerHits.push({ producer: d.producer, reason: `${d.rel}/ n'est pas gitignoré` });
    }
}

// ─── Report ───────────────────────────────────────────────────────────────────

const WIDTH = 72;
console.log("=".repeat(WIDTH));
console.log("  REPO HYGIENE SCAN");
console.log("=".repeat(WIDTH));
console.log();

function reportCategory(label, hits, formatter) {
    console.log(`--- ${label} (${hits.length}) ---`);
    if (hits.length === 0) {
        console.log("  (none)");
    } else {
        for (const h of hits) console.log("  " + formatter(h));
    }
    console.log();
}

reportCategory("Throwaway scripts tracked in git", throwawayHits, (h) => `${h.file}  [${h.label}]`);
reportCategory("Unlisted modules outside scripts/", strayCjsHits, (h) => `${h.file}  [${h.label}]`);
reportCategory(
    "Build/test artifacts tracked in git",
    artifactHits,
    (h) => `${h.file}  [${h.label}]`
);
reportCategory("Python bytecode tracked in git", bytecodeHits, (h) => `${h.file}  [${h.label}]`);
reportCategory(
    "UTF-8 BOM in tracked files",
    bomHits,
    (h) => `${h.file}  → sed -i '1s/^\\xEF\\xBB\\xBF//'`
);
reportCategory(
    "Generated artifacts under git control",
    generatedHits,
    (h) =>
        `${h.root}  ${h.tracked} suivi(s), ${h.loose} non ignoré(s)  [${h.label}]` +
        (h.tracked > 0
            ? `\n      → git rm -r --cached ${h.root}`
            : "\n      → ajouter une règle .gitignore ANCRÉE")
);
reportCategory(
    "Producers writing outside the ignored set",
    producerHits,
    (h) => `${h.producer} — ${h.reason}`
);
reportCategory(
    `Source files > ${MAX_LINES} lines (WARNING)`,
    oversizedHits,
    (h) => `${h.file}  (${h.lines} lines)`
);

// ─── Summary ─────────────────────────────────────────────────────────────────

const errors =
    throwawayHits.length +
    strayCjsHits.length +
    artifactHits.length +
    bytecodeHits.length +
    bomHits.length +
    generatedHits.length +
    producerHits.length;
const warnings = oversizedHits.length;

console.log("-".repeat(WIDTH));
console.log("  SUMMARY");
console.log("-".repeat(WIDTH));
const throwawayStatus = throwawayHits.length === 0 ? "OK" : throwawayHits.length + " ERROR(S)";
const strayCjsStatus = strayCjsHits.length === 0 ? "OK" : strayCjsHits.length + " ERROR(S)";
const artifactStatus = artifactHits.length === 0 ? "OK" : artifactHits.length + " ERROR(S)";
const bytecodeStatus = bytecodeHits.length === 0 ? "OK" : bytecodeHits.length + " ERROR(S)";
const oversizedStatus =
    oversizedHits.length === 0 ? "OK" : oversizedHits.length + " WARNING(S) — fragmenter";
const generatedTracked = generatedHits.reduce((n, h) => n + h.tracked + h.loose, 0);
const generatedStatus =
    generatedHits.length === 0
        ? "OK"
        : `${generatedHits.length} ERROR(S) — ${generatedTracked} fichier(s)`;
const producerStatus = producerHits.length === 0 ? "OK" : producerHits.length + " ERROR(S)";
console.log("  Throwaway scripts     " + throwawayStatus);
console.log("  Stray modules         " + strayCjsStatus);
console.log("  Build artifacts       " + artifactStatus);
console.log("  Python bytecode       " + bytecodeStatus);
console.log(
    "  UTF-8 BOM             " + (bomHits.length === 0 ? "OK" : bomHits.length + " ERROR(S)")
);
console.log("  Generated artifacts   " + generatedStatus);
console.log("  Artifact producers    " + producerStatus);
console.log("  Source > " + MAX_LINES + "L       " + oversizedStatus);
console.log("-".repeat(WIDTH));
console.log();

if (errors === 0 && warnings === 0) {
    console.log("VERDICT: REPO HYGIENE OK");
    process.exit(0);
} else if (errors === 0) {
    console.log(`VERDICT: ${warnings} warning(s) — no blocking errors`);
    process.exit(0);
} else {
    console.log(`VERDICT: ${errors} error(s) found — fix before merging`);
    process.exit(1);
}
