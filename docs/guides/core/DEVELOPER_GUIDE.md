# GeoLeaf-JS — Developer Guide

**Package:** `@geoleaf/core` + MIT plugins
**Version:** 3.0.0 — relu contre le code le 27/07/2026
**Build system:** Turborepo + Rollup + TypeScript strict
**Moteur cartographique:** MapLibre GL JS ^6.0.0 (WebGL, ESM-only)

---

## Table of contents

1. [Prerequisites](#prerequisites)
2. [Repository structure](#repository-structure)
3. [Installation](#installation)
4. [Build system](#build-system)
5. [Testing](#testing)
6. [Linting & formatting](#linting--formatting)
7. [TypeScript](#typescript)
8. [Release workflow](#release-workflow)
9. [Working with plugins](#working-with-plugins)
10. [Key conventions](#key-conventions)

---

## Prerequisites

- **Node.js** ≥ 22.13.0 (`package.json` → `engines`, `.nvmrc`). ⚠️ _Ce guide disait « ≥ 18 » jusqu'au 27/07/2026._
- **npm** ≥ 11 (npm workspaces support required)
- **Turborepo** — installed automatically as a dev dependency

```bash
node --version   # must be ≥ 18
npm --version    # must be ≥ 11
```

---

## Repository structure

GeoLeaf-JS est un **monorepo npm workspaces** orchestré par **Turborepo**.

```
GeoLeaf-JS/
├── apps/
│   └── geoleaf-app/     ← l'application déployable (private, jamais publiée)
├── packages/
│   ├── core/            ← @geoleaf/core (MIT — npm public)
│   ├── plugins/         ← les plugins publiés (@geoleaf-plugins/*)
│   ├── libs/            ← field-renderer, host-runtime
│   └── build-config/    ← configuration de build partagée (private)
├── profiles/            ← profils métier (JSON)
├── deploy/              ← variantes de déploiement générées
├── e2e/                 ← tests E2E Playwright
├── scripts/             ← scripts de build, CI et vérification
└── turbo.json           ← graphe de tâches Turborepo
```

⚠️ **Cet arbre s'arrête volontairement au premier niveau, et ne nomme AUCUN plugin.** Il en listait
deux — dont un sous son ancien nom `plugin-addpoi`, et un autre dont l'indentation le plaçait
directement sous `packages/` alors qu'il vit sous `packages/plugins/` (B-33). Un arbre écrit à la
main qui descend au fichier ne suit pas les sprints de structure : celui-ci ne descend plus assez
bas pour se périmer.

**L'arbre complet est généré et gaté** : `npm run docs:tree` écrit
[`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), et `ci:local` rougit
quand il dérive. La liste des paquets publiés se dérive par `npm run versions:check`.

---

## Installation

```bash
# Clone the repository
git clone <repo-url> GeoLeaf-JS
cd GeoLeaf-JS

# Install all workspace dependencies
npm install

# This installs dependencies for:
# - packages/core
# - packages/plugins/offline-ui
# - packages/plugins/addpoi
# - root dev dependencies (Turborepo, Playwright, ESLint, Prettier…)
```

> All packages are MIT and published on npmjs.org — no registry configuration needed.

---

## Build system

### Turborepo task graph

Turborepo orchestrates tasks across all workspaces, respecting dependency order
(`^build` means "build dependencies first").

```bash
# Build all packages (respects dependency order)
npm run build

# Build core only
npm run build:core

# Build plugins only
npm run build:plugins

# Full build: bundle + CSS + deploy variants
npm run build:all        # runs build:all in @geoleaf/core

# Build deploy variants (for deploy/ directory)
npm run build:deploy
npm run build:deploy:addpoi
npm run build:deploy:all

# Watch mode (core only)
cd packages/core && npm run build:watch
```

### Rollup builds (packages/core)

Le package core produit les artefacts suivants via Rollup. MapLibre GL JS est une **peer dependency** et n'est pas inclus dans les bundles.

| Output file                 | Format | Entry point                     | Description                                                                                                                                    |
| --------------------------- | ------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `dist/geoleaf.esm.js`       | ESM    | `bundle-esm-entry.ts`           | ESM bundle principal (bundlers)                                                                                                                |
| `dist/esm/`                 | ESM    | `bundle-esm-entry.ts`           | ESM avec code splitting                                                                                                                        |
| `dist/chunks/`              | ESM    | chunks du code-splitting Rollup | ⚠️ _pas du « lazy loading » : `GeoLeaf._loadModule` et `src/lazy/` sont supprimés (BREAKING S5). Ces chunks sont chargés statiquement au boot_ |
| `dist/geoleaf-main.min.css` | CSS    | `src/css/geoleaf-main.css`      | Styles minifiés (PostCSS/cssnano)                                                                                                              |

> **Note v2.0.0 :** Le bundle UMD (`geoleaf.umd.js`, `geoleaf.min.js`) a été
> supprimé. La distribution se fait exclusivement en ESM. Les CDN (`unpkg`,
> `jsDelivr`) pointent vers `dist/geoleaf.esm.js`.

```bash
# In packages/core:
npm run build        # Rollup + TypeScript declarations + CSS
npm run build:css    # PostCSS only
npm run clean        # Remove dist/
```

### Bundle budget

| Metric                        | Target / status                            | Current (approx.) |
| ----------------------------- | ------------------------------------------ | ----------------- |
| Boot payload (entry + static) | warn > 270 KB gz, **fails build > 300 KB** | ~178 KB gz        |
| `geoleaf.esm.js` alone (gz)   | ~0.5 KB shim — informational, not a budget | ~0.5 KB           |

The **boot payload** — the entry plus the transitive closure of its static imports — is the hard budget (`check-bundle-size.cjs`). Since `kernel-exports`, `geoleaf.esm.js` itself is a ~0.5 KB shim, so it is not budgeted alone; dynamic `import()` chunks load on demand and are excluded. MapLibre GL JS is an external peer dependency — out of bundle.
Evaluate bundle impact with `npm run size` before adding dependencies (also run automatically by `npm run build:deploy`).

---

## Testing

### Unit tests (Vitest)

> Jest a été remplacé par Vitest en mars 2026. `npm run test:jest`, `jest.config.cjs` et
> `jest.esm.config.cjs` n'existent plus — ni comme script, ni comme fichier, ni comme
> dépendance. Cette section les documentait encore ; corrigé le 22/07/2026.

```bash
# Tous les tests, les 17 paquets (borné : cf. scripts/run-tests.cjs)
npm test

# Cœur uniquement
npm run test:core

# Avec couverture — cœur
npm run test:coverage

# Le gate de couverture complet, seuils par paquet (17 paquets)
npm run test:coverage:all

# Directement dans packages/core (son script `test` inclut déjà --coverage)
cd packages/core
npm test
```

Une seule configuration par paquet, `vitest.config.ts`. Les champs communs aux 18 viennent
de la fabrique `@geoleaf/build-config/vitest/base.mjs` ; `core`, `plugin-addpoi` et
`offline-ui` gardent une configuration sur mesure (pool `forks`, alias, setup).

Les suites de tests sont organisées dans `packages/core/__tests__/` par domaine
(core, geojson, poi, ui, filters, route, table, errors, validators, etc.).

**Seuils de couverture du cœur** (`packages/core/vitest.config.ts`) : branches ≥ 55,
functions ≥ 65, lines ≥ 66, statements ≥ 66. Ils ont été recalibrés le 15/06/2026 pour le
provider V8 ; l'ancien « ≥ 75 % » était un chiffre istanbul d'avant `tsx`.

⚠️ **La couverture réelle du cœur n'est pas connue à ce jour.** Les chiffres qui
circulaient ici (82,5 % lignes / 80,3 % statements / ~85,7 % branches) proviennent d'une
mesure dont l'attribution est fausse à 49 % — voir `roadmap_couverture-tests.md` (archivée le 24/07/2026). Ils sont
retirés plutôt que remplacés : les rechiffrer aujourd'hui reviendrait à substituer un
chiffre faux à un autre. Le sprint 6 de cette roadmap les rétablira sur une mesure vraie.

### E2E tests (Playwright)

```bash
# Run E2E tests (requires built deploy/ variants)
npm run test:e2e

# Run with Playwright UI
npm run test:e2e:ui
```

La suite E2E utilise Chromium et teste trois variantes de déploiement :

| Spec file                    | Variant                 | Port |
| ---------------------------- | ----------------------- | ---- |
| `e2e/01-core-only.spec.js`   | Core only               | 8766 |
| `e2e/02-storage.spec.js`     | Core + Storage          | 8767 |
| `e2e/03-storage-poi.spec.js` | Core + Storage + AddPOI | 8768 |

### Smoke test

```bash
npm run smoke-test   # Post-build smoke test
```

---

## Linting & formatting

```bash
# Lint all packages
npm run lint

# Lint with auto-fix
cd packages/core && npm run lint:fix

# Format (Prettier)
cd packages/core && npm run format
```

The codebase uses:

- **ESLint** with TypeScript support (`@typescript-eslint/eslint-plugin`)
- **Prettier** for consistent formatting
- **Husky + lint-staged** for pre-commit hooks (runs ESLint + Prettier on staged files)

### Dead code detection

```bash
npm run dead-code   # Runs Knip across the whole monorepo (all 18 workspaces)
```

Knip is configured via `knip.js` at the monorepo root — a JS module, not JSON, because the
workspace keys are derived from `package.json#workspaces`. It is the **only** knip config the
repo may contain: any other one (root or per-package) fails the run.

The gate covers **unused files, unused/undeclared dependencies, and dead config entries**. It
deliberately does **not** report unused exports or types under `packages/core/src/**`: those
159 signals were triaged one by one and yielded 0 actionable items against 116 barrel-induced
false positives. That angle is covered instead by `npm run check-orphan-exports`, which
searches by token across the repo — including the literal values of string consts.

### Security audit (innerHTML)

```bash
npm run audit:security   # Scans for unsafe innerHTML usage
```

All DOM manipulation must go through the security helpers in
`packages/core/src/kernel/security/`. Never use `innerHTML` directly.

---

## TypeScript

All packages use **TypeScript strict mode** with ES2022 target.

```bash
# Type-check core
cd packages/core && npm run typecheck

# Type-check a plugin
cd packages/plugins/offline-ui && npm run typecheck
cd packages/plugins/addpoi && npm run typecheck
```

### TypeDoc (API documentation)

```bash
cd packages/core
npm run docs:api   # Generates docs/api/ from TSDoc comments
```

Config: `packages/core/typedoc.json` — entry point: `src/bundle-esm-entry.ts`.

---

## Release workflow

GeoLeaf-JS follows **Semantic Versioning** (SemVer).

### Version numbers

| Change type                       | Version bump  |
| --------------------------------- | ------------- |
| Breaking API change               | MAJOR (X.0.0) |
| New feature (backward-compatible) | MINOR (2.X.0) |
| Bug fix / patch                   | PATCH (2.0.X) |

### Publish `@geoleaf/core` (public npm)

```bash
# From monorepo root:
npm run publish:core
# Equivalent to: npm publish -w packages/core --access public
```

### Publish plugins (npmjs.org)

```bash
npm run publish:storage    # Publishes @geoleaf-plugins/offline-ui
npm run publish:addpoi     # Publishes @geoleaf-plugins/addpoi
npm run publish:plugins    # Publishes both via scripts/publish-plugins.cjs
```

> Plugins are published to npmjs.org with `--access public`,
> not to the public npm registry.

---

## Working with plugins

> **Authoritative reference:** the frozen plugin architecture — invariants, registration contract, per-module config, and governance — is specified in [`PLUGIN_ARCHITECTURE_SPEC.md`](../../specs/contrats/PLUGIN_ARCHITECTURE_SPEC.md) (**Plugin Contract v1**). The notes below are a quick reference; the spec prevails.

### No-plugin-in-core rule

**Never** import `@geoleaf-plugins/*` from `packages/core/src/`. This is an
**architecture** boundary, not a licence one — the core stays standalone and
tree-shakeable whatever licence the plugins carry. Enforced by
`scripts/verify-core-standalone.cjs`, run in CI (push and pull request), in the
pre-commit hook and in `ci:local`.

Plugins communicate with core via the **PluginRegistry** pattern
(auto-registration on import, using `GeoLeaf.PluginRegistry.register()`).

### Plugin ESM requirement

Both `offline-ui` and `plugin-addpoi` are **pure ESM** packages
(`"type": "module"` in package.json). No `require()` or CommonJS syntax is
allowed in plugin source files.

### Extending the core (fork only)

To add a new **internal module** to `@geoleaf/core` (requires a fork of the MIT repository), follow the boot sequence integration guide:

→ [CORE_EXTENSION_GUIDE.md](../../../packages/core/docs/CORE_EXTENSION_GUIDE.md)

Covers: B1→B11 sequence, `ICoreModule` contract, facade pattern (`geoleaf.*.ts`), ESM export conventions, and pre-merge checklist.

---

## Key conventions

| Convention               | Rule                                                          |
| ------------------------ | ------------------------------------------------------------- |
| Source language          | TypeScript strict (ES2022 target)                             |
| Comment language         | English only                                                  |
| Max file size            | 700 lines (soft limit: 500)                                   |
| TSDoc                    | Mandatory on all public facades and named exports             |
| Facade vs implementation | `geoleaf.*.ts` files expose API — no business logic           |
| Security                 | All DOM injection via `security/` helpers — no bare innerHTML |
| No-plugin-in-core        | Zero references to `@geoleaf-plugins/*` in `packages/core/`   |
| Plugins ESM              | Pure ESM — no `require()` in plugin source                    |
| Boot order               | Never modify `globals.*.ts` without verifying B1→B11 sequence |
| Shared state             | Identify all consumers before modifying `built-in/shared/`    |
| MapLibre GL JS           | Peer dependency ^5.0.0 — WebGL rendering, ESM-only            |

### Turborepo filtering

```bash
# Run a task in a specific workspace
turbo run build --filter=@geoleaf/core
turbo run test --filter=@geoleaf-plugins/offline-ui
turbo run lint --filter=@geoleaf-plugins/*
```

---

## Debug workflow

### Build watch mode

```bash
# Build @geoleaf/core with watch (recompiles on every change)
turbo run build --filter=@geoleaf/core -- --watch
```

### Source maps

Development builds include source maps (`.js.map`). In browser DevTools:

1. Open the **Sources** tab — source maps are loaded automatically
2. Navigate to the raw `.ts` files under `packages/core/src/`
3. Set breakpoints directly in TypeScript source

### Serving the demo locally

```bash
# Build the deploy/ folder (core-only variant)
npm run build:deploy

# Build with Storage plugin
npm run build:deploy:addpoi

# Build all variants (core, storage, storage+addpoi)
npm run build:deploy:all
```

The demo is served automatically by Playwright at `http://localhost:8766` (core), `8767` (storage), `8768` (storage+addpoi) when running `npm run test:e2e`. For manual inspection, open `deploy/index.html` via a static server (e.g. VS Code Live Server, `python -m http.server`).
See DEMO*SYSTEM_GUIDE.md — ⚠️ *`DEMO_SYSTEM_GUIDE.md` est **archivé** (`DEMO_SYSTEM_GUIDE_perime.md`) : la couche demo qu'il décrivait est supprimée\_ for variant configuration details.

### VS Code debugger

Attach to Vitest via `--inspect-brk`. ⚠️ `--no-file-parallelism` est nécessaire : sans lui,
les fichiers de test tournent dans des workers forkés et le point d'arrêt n'est jamais
atteint dans le processus auquel on s'attache (c'est l'équivalent Vitest de l'ancien
`--runInBand` de Jest, dont ce paragraphe donnait la commande jusqu'au 22/07/2026 — Jest
n'existe plus dans ce dépôt depuis mars 2026).

```bash
node --inspect-brk node_modules/.bin/vitest run --no-file-parallelism
```

Sample `launch.json` entry:

```json
{
    "type": "node",
    "request": "attach",
    "name": "Attach to Vitest",
    "port": 9229
}
```
