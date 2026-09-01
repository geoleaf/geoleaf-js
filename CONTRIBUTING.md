# Contributing to GeoLeaf-JS

Thank you for your interest in contributing. This document covers the workflow for the
**monorepo** — `@geoleaf/core`, the published plugins and the shared libs, all MIT.

> **How to read this file.** Every verifiable fact here names the command or the file that
> proves it. Nothing measurable is transcribed into prose: counts, percentages and byte
> budgets drift between two commits, and a stale number in a contributor guide is worse than
> no number at all. When you need the value, run the command.

---

## Prerequisites

| Tool      | Version                                      | Where it is declared                 |
| --------- | -------------------------------------------- | ------------------------------------ |
| Node.js   | ≥ 22.13.0                                    | `package.json` → `engines`, `.nvmrc` |
| npm       | ships with Node 22 (workspaces are required) | —                                    |
| Turborepo | via `npx turbo` — no global install needed   | `turbo.json`                         |

---

## Setup

```bash
git clone https://github.com/geoleaf/geoleaf-js.git
```

```bash
npm install
```

```bash
npm run build
```

`npm run build` is required before the tests: several suites and every E2E spec run against
built artefacts, not sources.

---

## Monorepo structure

The workspace globs are **explicit**, and deliberately so:

```json
["apps/*", "packages/*", "packages/plugins/*", "packages/libs/*", "!packages/_*"]
```

⚠️ Never widen this to `packages/*/*` — it would capture generated artefacts
(`core/node_modules`, `core/dist`…) as workspaces.

| Directory                    | Role                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `apps/geoleaf-app/`          | the deployable **application** — single source of the 3 shipped deploy variants. `private: true`, never published to npm |
| `packages/core/`             | `@geoleaf/core` — the library                                                                                            |
| `packages/plugins/*`         | the published plugins (`@geoleaf-plugins/*`)                                                                             |
| `packages/libs/*`            | `field-renderer`, `host-runtime` — shared by core and plugins                                                            |
| `packages/build-config/`     | shared build configuration, private                                                                                      |
| `packages/_plugin-template/` | scaffold, **outside** the workspaces (`!packages/_*`)                                                                    |

**The list of packages and their versions is derived, not maintained by hand:**

```bash
npm run versions:check
```

⚠️ Never hard-code a `packages/<name>` path in a script or a config. Resolve it through
`scripts/lib/packages.cjs` (`all()`, `byName()`, `requireByDirName()`), which **throws** when
a package is missing. A hard-coded path does not break when a package moves — it silently
stops matching, and the gate built on it goes green having scanned nothing.
`scripts/probe-gate-visibility.cjs` watches for exactly that failure mode.

---

## The one command that matters

```bash
npm run ci:local
```

It reproduces the `.github/workflows/ci.yml` gate sequence locally, and it is the **only**
criterion before spending CI quota. The script holds a verified property — `ci:local ⊇ ci.yml`
— asserted at every run by `scripts/lib/test-scope.cjs`, which throws if the local unit gate
covers less than the remote one.

```bash
node scripts/ci-local.cjs --bail    # stop at the first failing gate
node scripts/ci-local.cjs --e2e     # also build the deploy variants and run Playwright
```

### Push protocol — GitHub Actions quota is scarce (free account)

1. **Always** run `npm run ci:local` before any push. It must be **100 % green**.
2. **Green locally** → normal push allowed. This is the **only** case where a CI run is warranted.
3. **Red, not run, or pushing a WIP** → push with **`[skip ci]`** in the commit message.
4. Pushes stay **occasional** (end of branch), not one per commit.

### Hooks

`.husky/pre-commit` runs a subset of the gates on every commit — among them
`scripts/verify-core-standalone.cjs`, `scripts/check-orphan-exports.cjs`,
`scripts/check-dead-links.cjs`, `scripts/check-contracts-pure.cjs` and
`scripts/validate-profiles.cjs`. They are blocking. `--no-verify` is not the answer: if a hook
fails, the gate found something.

---

## Individual commands

### Lint and types

```bash
npm run lint                         # eslint . --max-warnings 0 — 0 warning tolerated
```

```bash
npm run typecheck -w packages/core   # tsc --noEmit on @geoleaf/core
```

### Unit tests (Vitest)

```bash
npm run test:vitest                  # every package, `projects` mode
npm run test:vitest:core             # @geoleaf/core only
npm run test:coverage                # @geoleaf/core, through turbo — the exact gate command
npm run test:coverage:all            # the aggregate, including packages excluded from the root run
```

The two runs do **not** cover the same packages, and neither count is written down here — the
aggregate prints its own in the run header, and both are derived:

```bash
node -e "const t=require('./scripts/lib/test-scope.cjs'); console.log(t.unitScope().length, t.rootProjectScope().length)"
```

> **Coverage provider:** Istanbul (`@vitest/coverage-istanbul`) is the single provider across
> all packages. `@vitest/coverage-v8` is no longer used. Istanbul instruments TypeScript
> sources before transformation, which is what makes branch attribution trustworthy — a
> property probed by `scripts/verify-coverage-attribution.cjs`, wired into `ci:local`.
>
> ⚠️ **Several packages are excluded from the root `projects` run**, each with a written
> reason, in `scripts/lib/test-scope.cjs` → `EXCLUDED_FROM_ROOT_RUN`. They are measured by
> `npm run test:coverage:all` only. Read that constant rather than assuming — the list moves,
> and every entry carries its motive.
>
> **For plugins, run coverage from the monorepo root.** `npx vitest run --coverage` inside a
> plugin directory reports 0 %: the forks+tsx setup bypasses Vite's transform pipeline and
> Istanbul never instruments anything. Workspace mode resolves this through Vite's SSR module
> runner.

**Thresholds** are gated per package in `packages/*/vitest.config.ts`. They are **ratcheted
up, never down** — each config records the measurement that justified its current values and
the margin that was chosen. They are not reproduced here on purpose. To see where you stand:

```bash
npm run test:coverage
```

The HTML report lands in `packages/core/coverage/index.html`. In CI it is uploaded as the
`coverage-report` artifact on every run.

### E2E tests (Playwright)

```bash
npm run build:deploy    # build the 3 deploy variants first
```

```bash
npm run test:e2e        # Playwright starts its own http-servers (default target: `ports`)
npm run test:e2e:ui     # interactive Playwright UI
```

You do **not** need to serve the variants yourself on the default target: the `webServer`
block of `playwright.config.js` starts them. The alternative target is
`E2E_TARGET=nginx npx playwright test`, which starts nothing and aims at a local nginx
serving `deploy/`. `ports` is the CI target and the **reference** — a red seen only under
nginx is replayed on `ports` before being qualified.

Which spec targets which variant, and why there are three variants rather than two:
[`e2e/README.md`](e2e/README.md).

### Bundle size

```bash
npm run build:core
npm run size
```

### Security audit

```bash
npm run audit:security   # scans innerHTML, outerHTML, insertAdjacentHTML, document.write
```

---

## Branch and commit conventions

```
main          ← production-ready, protected, and the branch PRs target
feat/<name>   ← new feature
fix/<name>    ← bug fix
chore/<name>  ← tooling, deps, docs
```

Commit format (loose Conventional Commits):

```
type(scope): short description

feat(poi): add cluster threshold warning
fix(init): correct secondary module load order
chore(eslint): activate no-explicit-any warn
```

**Blame hygiene.** Purely mechanical reformat commits are listed in
`.git-blame-ignore-revs`. GitHub and GitLab apply that file automatically; enable it locally,
once per clone, with:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

An entry there never excuses a commit from justifying itself — it only states that attributing
it line by line teaches nothing. Adding one requires _proving_ neutrality; the file's own
header records the standard and the proof used for each entry.

---

## Pull Request process

1. Branch off `main`, never commit to it directly.
2. `npm run ci:local` green before opening the PR — see the push protocol above.
3. Keep PRs focused — one concern per PR.
4. Add an entry to [`packages/core/docs/CHANGELOG.md`](packages/core/docs/CHANGELOG.md)
   under `[Unreleased]` when the change is visible to an integrator.

---

## Contribution rules

### Bundle budget

The metric that matters at load time is the **boot payload**: the
`packages/core/dist/geoleaf.esm.js` entry **plus the transitive closure of the chunks it
imports statically**. ⚠️ Do **not** call the flat entry "a shim": the ~1 KB shim is the
_granular_ entry (`dist/esm/`), and conflating the two is how a documented figure once drifted
by a factor of 100. Budgeting the entry alone catches no regression. Only dynamic `import()`
chunks are genuinely lazy and therefore excluded.

> ⚠️ **This paragraph carried the very defect it forbids until 26/08/2026.** It claimed the
> command measured the flat entry at "~69 KB gz", and the measurement had already moved. A size
> copied into prose is stale the moment a chunk boundary shifts — including in the sentence that
> forbids copying it. **Neither entry has a size written here. Run the command.**

Hard budget: the build **fails above 300 KB gz**, warns above 270 KB gz.
`scripts/check-bundle-size.cjs` measures the closure; the current figure is what
`npm run size` prints, and it is not written down anywhere — it has already diverged from its
prose copy by a factor of more than 100.

Run it before adding any dependency:

```bash
npm run size
```

### No plugin references in core (`no-plugin-in-core`)

`packages/core/src/` must never import from `@geoleaf-plugins/*`. This is an **architecture**
boundary, not a licence one: every package is MIT, and the rule exists so the core stays
standalone and tree-shakeable. Enforced in CI, in the pre-commit hook and in `ci:local`:

```bash
node scripts/verify-core-standalone.cjs
```

### ESM-only plugins

`packages/plugins/offline-ui/` and `packages/plugins/addpoi/` declare `"type": "module"` and
must contain no `require()` and no `module.exports` — tests and `__mocks__/` included. The
single exception is a `require()` targeting a genuinely CommonJS module (`*.cjs`).

### Facade / implementation separation

`packages/core/src/api/geoleaf.*.ts` files expose the public API. They contain no logic.

### File length

Source files are capped at **700 lines** (ESLint `max-lines: error`); split proactively past 500. The cap does **not** apply to test files (`__tests__/`, `__mocks__/`, `*.test.*`,
`*.spec.*`, `e2e/`) nor to `.md`.

### TypeScript strict

No `@ts-nocheck`, and no `any` where a real type exists. Shared interface patterns live in
`packages/core/src/contracts/` — note that those files are a **pure type surface**, gated by
`scripts/check-contracts-pure.cjs`: no runtime export, no value import, no top-level statement.

### Security

- Never bypass `escapeHtml` / `sanitizeHtml` from `packages/core/src/kernel/security/`.
- Never use `innerHTML` without a `// SAFE: <justification>` comment.
- CSRF tokens: always `secure: true` in non-HTTP-only contexts.

### Generated artefacts — never edited by hand

`deploy/`, `dist/`, `packages/core/docs/api/` (TypeDoc) and
`docs/reference/ARBORESCENCE_QUALIFIEE.{md,html}` are produced by scripts. Change the
generator, then regenerate.

---

## Reporting security vulnerabilities

Do **not** open a public issue. See
[`packages/core/docs/SECURITY.md`](packages/core/docs/SECURITY.md) for the responsible
disclosure process.

---

_GeoLeaf Platform — Mattieu Pottier_
