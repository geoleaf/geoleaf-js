# GeoLeaf Monorepo — Workflow Guide

> **Version :** 1.2.0 | **Dernière mise à jour :** 31 mars 2026

Complete reference for developing, building, testing, and publishing in the GeoLeaf Turborepo monorepo. For directory roles and conventions (packages, apps, deploy, scripts, profiles), see [MONOREPO_STRUCTURE.md](MONOREPO_STRUCTURE.md).

**Contenu** : Vue d’ensemble (Section 1 + principe du pipeline complet) · Workflow quotidien (2) · Release (3) · Sécurité et distribution (4) · Installation client (5) · Référence rapide (6) · CI/CD (7) · Structure (8) · [Dossiers obsolètes et étape de suppression (9)](#section-9--dossiers-obsolètes-et-étape-de-suppression).

---

## Section 1 — Architecture Overview

```
GeoLeaf-Js (private, monorepo)          ← Single source of truth
├── packages/core/                       ← Core library source (MIT)
├── packages/plugins/connector/           ← Connector HTTP REST source (MIT)
├── packages/plugins/offline-ui/             ← Storage plugin source (MIT)
├── packages/plugins/addpoi/              ← AddPOI plugin source (MIT)
├── deploy/                              ← Test variants generated (deploy-core, deploy-storage, deploy-storage-addpoi)
└── scripts/                             ← Build, benchmark, audit tools

GeoLeaf-Core (mirror, FROZEN)            ← Sync deleted, ARCHI S9.0
├── packages/core/                       ← MIT — core library
└── packages/connector/                  ← MIT — connector (synced from plugin-connector)

GeoLeaf-Demo (mirror, FROZEN)            ← Sync deleted, ARCHI S9.0
└── content = deploy/deploy-core/        ← ready-to-use demo + PWA template

GeoLeaf-Plugins-MIT (mirror, FROZEN)     ← Sync deleted, ARCHI S9.0

GeoLeaf-Plugins (private, archived)      ← No longer used, replaced by npm publish
```

⚠️ **Les 3 miroirs ne sont plus alimentés** depuis le 20/07/2026 (ARCHI S9.0). Les dépôts existent encore, figés sur leur dernier état. La distribution passe **exclusivement par npm**.

### Package responsibilities

| Package                       | License | npm registry | Visibility |
| ----------------------------- | ------- | ------------ | ---------- |
| `@geoleaf/core`               | MIT     | npmjs.com    | Public     |
| `@geoleaf/connector`          | MIT     | npmjs.com    | Public     |
| `@geoleaf-plugins/offline-ui` | MIT     | npmjs.org    | Public     |
| `@geoleaf-plugins/addpoi`     | MIT     | npmjs.org    | Public     |

### Principe du pipeline complet

Flux unique du code jusqu’à la distribution et au déploiement :

```
Sources (packages/core, packages/plugins/*)
    │
    ├── npm run build          → packages/*/dist/ (bundles)
    │
    ├── npm run build:deploy   → deploy/deploy-core, deploy-storage, deploy-storage-addpoi (3 variantes en une fois)
    │   │   (scripts/build-deploy.cjs ; ou --plugins=none|storage|addpoi|all pour un seul deploy/)
    │
    └── npm run publish:core   → npm (public)  ;  npm run publish:plugins → npm (public)
```

> Les 3 workflows de miroir sur `push main` ont été supprimés (ARCHI S9.0). npm est le seul canal de publication.

- **Build** : Turborepo build → `packages/core/dist`, `packages/plugins/*/dist`.
- **Déploiement local / test** : `npm run build:deploy` produit en une fois **deploy/deploy-core/**, **deploy/deploy-storage/**, **deploy/deploy-storage-addpoi/** à partir des fichiers du dossier `demo/` (index.html, demo-header.html, init.js, demo.extensions.js). Tester depuis `deploy/` revient au même que tester la démo (même page, bundles de prod). Servir avec `npx serve deploy -p 8765` ou `node scripts/serve-test.cjs` (ports 3001–3003).
- **Publication** : les 18 packages sur npmjs public. ⚠️ Plus aucune synchronisation vers les dépôts publics — les 3 miroirs sont supprimés (ARCHI S9.0).
- **Docs** : le site se publie par `npm run docs:deploy`, **manuel**, sur `www.geoleaf.dev/docs/`. Voir [DOCS_SOURCE_AND_SYNC.md](DOCS_SOURCE_AND_SYNC.md) §2.
    - ⚠️ **Cette ligne était fausse sur ses trois assertions, corrigée le 11/08/2026.** ① Les sources de `packages/core/docs/` **ne partent plus dans le tarball** : `docs/` a quitté les `files[]` ; un paquet n'emporte que `README.md` + `dist/`. ② **`docs.geoleaf.dev` rend NXDOMAIN** — le sous-domaine n'existe pas. ③ La chaîne n'est pas « coupée » : `scripts/deploy-docs.cjs` est **vivant**, il est simplement manuel et n'a pas été relancé — le rendu publié est à `v2.1.5`. Un site périmé appelle un geste, pas un constat.

---

## Section 2 — Daily Development Workflow

### Where to code

Always work in **GeoLeaf-Js** — this is the single source of truth. Never modify GeoLeaf-Core or GeoLeaf-Plugins directly; they are downstream.

### Building

```bash
# Build all packages (core first, then plugins in parallel via Turborepo)
npm run build

# Build only the core
npm run build:core

# Build only the plugins
npm run build:plugins
```

### Testing

```bash
# Run all tests across all workspaces (3 packages — Vitest)
npm run test:vitest

# Run core tests only
npm run test:vitest:core

# Run all tests with coverage
npm run test:vitest:coverage

# Run smoke test (validates the built bundle loads correctly)
npm run smoke-test
```

### Linting

```bash
# Lint all packages via Turborepo
npm run lint
```

⚠️ **`npm run lint` échoue sur 0 erreur ET 0 avertissement** depuis QUALITÉ Q1.5 (26/07/2026) — il porte `--max-warnings 0`. Un `no-console`, un `max-depth` ou un `max-lines-per-function` dépassé **casse le build**, là où ces règles étaient purement décoratives auparavant : aucun `--max-warnings` n'existait nulle part, et l'étape CI le disait dans son propre nom (« warnings allowed »).

### Cleaning build artifacts

```bash
npm run clean
```

### Committing and pushing

```bash
# Push only to GeoLeaf-Js — CI handles everything else
git add -A
git commit -m "feat: your change"
git push
```

The CI pipeline will build and test all packages.

⚠️ **It no longer syncs anything.** The three mirror workflows were deleted in ARCHI S9.0 — they were copying from a private repo to private repos. Distribution now goes through npm only, and `docs.geoleaf.dev` is frozen on its last build.

---

## Section 3 — Release Workflow (Step by Step)

### Prerequisites

- NPM token configured for `npmjs.com` (`npm login`)
- npm token with publish rights on the `@geoleaf` and `@geoleaf-plugins` scopes

### Steps

```bash
# 1. Build everything
npm run build

# 2. Verify all tests pass
npm run test

# 3. Publish the core to npmjs.com (public, MIT)
npm publish -w packages/core --access public

# 4. Publish the connector to npmjs.com (public, MIT)
npm publish -w packages/plugins/connector --access public

# 5. Publish storage plugin to npmjs (MIT, public)
npm publish -w packages/plugins/offline-ui

# 6. Publish addpoi plugin to npmjs (MIT, public)
npm publish -w packages/plugins/addpoi

# Or publish both plugins at once:
npm run publish:plugins
```

⚠️ Il n'y a plus d'étape 7 : la synchronisation CI vers `GeoLeaf-Core` est supprimée (ARCHI S9.0). npm est le seul canal de distribution.

### Release flow diagram

```
git push (GeoLeaf-Js private)
     │
     ├──→ CI build + test
     │
     ├──→ npm publish core       ──→ npmjs.com (public, MIT)
     ├──→ npm publish connector  ──→ npmjs.com (public, MIT)
     └──→ npm publish plugins    ──→ npmjs.com (public, MIT)

     (les 3 synchronisations CI vers GeoLeaf-Core / -Demo / -Plugins-MIT
      sont supprimées — ARCHI S9.0)
```

### Documentation release checklist

Before tagging a release, verify:

| #   | Check                                                               | Files concerned                           |
| --- | ------------------------------------------------------------------- | ----------------------------------------- |
| 1   | Versions updated in plugin docs (`**Version:**` header)             | `packages/plugins/*/docs/*.md`            |
| 2   | `CHANGELOG.md` entry added (`## YYYY-MM-DD — vX.x.x`)               | `_docs_projet/CHANGELOG.md`               |
| 3   | `_docs_projet/CHANGELOG.md` à jour, `_docs_projet/travail/` courant | `_docs_projet/CHANGELOG.md`               |
| 4   | Plugin READMEs accurate (links, version, feature list)              | `packages/plugins/*/README.md`            |
| 5   | Code snippets in examples use current API signatures                | `packages/*/docs/EXAMPLES.md`             |
| 6   | `INDEX_CORE.md` lists all guides                                    | `packages/core/docs/INDEX_CORE.md`        |
| 7   | Public docs cross-references valid (no broken links)                | `packages/core/docs/**/*.md`              |
| 8   | `@geoleaf/core` peer version in plugin INSTALLATION.md is current   | `packages/plugins/*/docs/INSTALLATION.md` |

> Run `npm run check:links` to verify all internal links automatically.

---

## Section 4 — Code Security and Distribution

**The core never references a plugin package** — architecture boundary, enforced by `verify-core-standalone.cjs`.

| Code          | Goes where | How protected         |
| ------------- | ---------- | --------------------- |
| Core (MIT)    | npmjs.com  | Open source by design |
| Plugins (MIT) | npmjs.com  | Public                |

Key guarantees:

- **npm est le seul canal de distribution.** Les 3 miroirs GitHub sont supprimés (ARCHI S9.0) : ils recopiaient d'un dépôt privé vers des dépôts privés.
- Les 18 packages sont **MIT et publics sur npmjs** : `npm install` suffit.
- `verify-core-standalone.cjs` garantit que le core ne référence aucun plugin. Il ne dépend pas des miroirs : il tourne dans `ci:local`, `ci.yml` et `.husky/pre-commit` depuis ARCHI S0.

### Documentation : source et synchronisation

- **Sources documentaires :** la documentation publique (guides, API, modules) est dans **`packages/core/docs/`** (100 % MIT, maintenu manuellement). La documentation interne (CDC, RFC, roadmaps, guides opérationnels) est dans **`_docs_projet/`**. Les conventions partagées sont dans **`_docs_communs/`**.
- **Sync vers le repo public :** ⚠️ **supprimé (ARCHI S9.0).** `sync-core-public.yml` copiait `packages/core/` (dont `docs/`) vers GeoLeaf-Core à chaque push sur `main` ; ce workflow n'existe plus. La doc de `packages/core/docs/` est publiée **via npm** (elle est dans le tarball du package) et via TypeDoc. Voir [DOCS_SOURCE_AND_SYNC.md](DOCS_SOURCE_AND_SYNC.md).

---

## Section 5 — Installation côté intégrateur

Rien à configurer : pas de `.npmrc`, pas de jeton, pas de registre à déclarer.

```bash
npm install @geoleaf/core
npm install @geoleaf-plugins/offline-ui
npm install @geoleaf-plugins/addpoi
```

`maplibre-gl` est une **peer dependency** — l'installer aussi (`npm install maplibre-gl`) ; elle
reste hors du bundle GeoLeaf.

---

## Section 6 — Quick Reference

### Development commands

| Task                        | Command                       |
| --------------------------- | ----------------------------- |
| Build all                   | `npm run build`               |
| Build core only             | `npm run build:core`          |
| Build plugins only          | `npm run build:plugins`       |
| Run all tests (17 packages) | `npm test`                    |
| Run unit tests, core only   | `npm run test:core`           |
| Run with coverage (core)    | `npm run test:coverage`       |
| Coverage gate (17 packages) | `npm run test:coverage:all`   |
| Lint all                    | `npm run lint`                |
| Clean all dist/             | `npm run clean`               |
| Smoke test                  | `npm run smoke-test`          |
| Benchmark                   | `npm run benchmark`           |
| Security audit              | `npm run audit:security`      |
| Build deploy (core only)    | `npm run build:deploy`        |
| Build deploy + addpoi       | `npm run build:deploy:addpoi` |
| Build deploy (all plugins)  | `npm run build:deploy:all`    |

### Publishing commands

| Task                   | Command                                      |
| ---------------------- | -------------------------------------------- |
| Publish core (public)  | `npm run publish:core`                       |
| Publish storage plugin | `npm run publish:storage`                    |
| Publish addpoi plugin  | `npm run publish:addpoi`                     |
| Publish all plugins    | `npm run publish:plugins`                    |
| Dry-run all plugins    | `node scripts/publish-plugins.cjs --dry-run` |

### Workspace-scoped commands

Run a script in a specific workspace without going through Turborepo:

```bash
npm run build -w packages/core
npm run test -w packages/core
npm run build -w packages/plugins/offline-ui
npm run build -w packages/plugins/addpoi
```

### Turborepo task graph

Turborepo runs tasks in dependency order automatically:

```
build:all (core)
    └──→ build (core)
              └──→ build (offline-ui)
              └──→ build (plugin-addpoi)
```

Use `npx turbo run build --graph` to visualize the full task graph.

---

## Section 7 — CI/CD Workflows

### `ci.yml` — triggered on every push to `main` and on all PRs

Steps (ordre réel, ~30 étapes) : checkout → setup Node → `npm ci` → `turbo run build` →
gates de bundle (exports, tree-shaking, `sideEffects`, paquet publié) → `turbo run typecheck` →
lint → audits sécurité + gitleaks → **`npx vitest run`** (tests unitaires, mode `projects`,
reporter JSON) → `check-test-failures.cjs` → **`npm run test:coverage:all`** (gate de
couverture, seuils par paquet) → smoke-test → budget de bundle → knip → filet B3 (exports
orphelins du core) → gates de pureté, liens morts, duplication, i18n, CSS mort.

⚠️ Deux corrections par rapport aux versions antérieures de cette ligne : **`benchmark` n'est
plus une étape CI** (`node scripts/benchmark.cjs --ci` retiré au T6.3 — ses 3 assertions étaient
inertes ; le script et `npm run benchmark` subsistent comme outil manuel), et **knip ne couvre
plus les exports** — depuis le 26/07/2026 il gate les fichiers morts, les dépendances et sa
propre config morte, la catégorie exports/types étant coupée sur `packages/core/src/**`
(`ignoreIssues` dans `knip.js`). L'angle exports du core est tenu par le filet B3, seul.

⚠️ Les tests unitaires de la CI passent par `npx vitest run` (**mode `projects`**, un seul
processus, 11 paquets), pas par `turbo run test`. C'est `ci:local` qui lance l'essaimage
turbo, sur **17 paquets** — un sur-ensemble, vérifié à chaque run par
`scripts/lib/test-scope.cjs`. Voir l'en-tête de `scripts/ci-local.cjs`.

### ~~`sync-core-public.yml`~~, ~~`sync-demo-public.yml`~~, ~~`sync-plugins-mit-public.yml`~~ — **supprimés (ARCHI S9.0, 20/07/2026)**

Les 3 workflows de miroir n'existent plus. Deux raisons :

1. **Leur justification était devenue fausse.** Ils étaient conservés comme « seul canal par lequel le code MIT est publiquement lisible » — mais `GeoLeaf-Core` étant passé privé, ils synchronisaient du privé vers du privé.
2. **Ils bloquaient ARCHI S9.** Ils copiaient `tsconfig.json` et `rollup.config.mjs` verbatim ; une fois ces fichiers pointant vers le package privé `@geoleaf/build-config`, le miroir aurait reçu des configs non construisibles — **sans erreur**, leur boucle de copie faisant `continue` sur source absente.

Le secret `CORE_SYNC_TOKEN` n'est plus utilisé par aucun workflow ; il peut être révoqué.

Les 3 dépôts satellites subsistent, figés. Leur sort se tranche avec **ARCHI S3.6** (passage public du monorepo).

### `deploy-docs.yml` — triggered in `GeoLeaf-Core` on push to `main`

Steps (VM Ubuntu temporaire) : `npm install` → `npm run docs:build` (VitePress) → `actions/deploy-pages` → GitHub Pages
Résultat : `docs.geoleaf.dev` mis à jour automatiquement. `docs-dist/` (racine — T4.4 l'a sorti de `packages/`) n'est jamais commité dans git.

---

## Section 8 — Monorepo Structure Reference

> Arborescence complète et rôles des répertoires → [MONOREPO_STRUCTURE.md](MONOREPO_STRUCTURE.md)

---

## Section 9 — Dossiers obsolètes et étape de suppression

### Dossiers / artefacts considérés obsolètes ou à traiter

| Élément                        | Rôle actuel / historique                                                                                                                                                                                                                                 | Action recommandée                                                                                                                                                                                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`src/` à la racine**         | Ancienne arborescence JS dupliquant la logique de `packages/core` (TypeScript). Utilisé par la démo (CSS, assets) et certains tests racine (`__tests__/`).                                                                                               | **Réduction ou suppression** : migrer les tests racine vers `packages/core` (ou apps) en important `@geoleaf/core` ; ne garder sous `src/` que les assets démo (CSS, images) ou déplacer la démo dans `apps/demo` et supprimer le JS dupliqué.                           |
| **Scripts cités mais absents** | `sync-to-public.ps1` et `sync-core-docs.cjs` étaient mentionnés dans le CDC et les guides mais n’existent plus. Le sync vers GeoLeaf-Core était alors assuré uniquement par le workflow CI `sync-core-public.yml`.                                       | ✅ Résolu — puis **rendu sans objet** : `sync-core-public.yml` est lui-même supprimé (ARCHI S9.0, 20/07/2026). Il n'existe plus aucune synchronisation vers GeoLeaf-Core (voir `DOCS_SOURCE_AND_SYNC.md`).                                                               |
| **`demo/`**                    | Template source pour `build-deploy.cjs` (index.html, demo-header.html, init.js, demo.extensions.js). **Ne pas supprimer** sans déplacer ces fichiers (ex. vers `scripts/templates/deploy/`). Tester depuis `deploy/` revient au même que tester la démo. | Optionnel : déplacer les templates dans `scripts/templates/deploy/`, adapter `build-deploy.cjs`, puis supprimer le dossier `demo/` si on ne veut plus le conserver. Sinon garder `demo/` et documenter que les tests manuels se font depuis `deploy/` ou `test-deploy/`. |

Le dossier **`deploy/`** est la sortie de `npm run build:deploy` (trois sous-dossiers : deploy-core, deploy-storage, deploy-storage-addpoi). **`demo/`** sert de template source pour `build-deploy.cjs`.

### Étape de suppression / maintenance (à inclure en release ou nettoyage cible)

1. **Avant suppression définitive de `src/` (racine)**
    - Migrer tous les tests qui utilisent `require('../../src/...')` vers `packages/core` (ou apps) en important depuis `@geoleaf/core` ou les sources du package.
    - Vérifier que la démo et les scripts (ex. `build-deploy.cjs`) ne dépendent plus du JS sous `src/` (uniquement CSS/assets si conservés).
    - Exécuter la suite de tests et le smoke-test après migration.

2. **Suppression ou réduction**
    - Supprimer les fichiers `.js` sous `src/` qui dupliquent `packages/core`, ou archiver le dossier (ex. `_archive/src-legacy/`) si une transition progressive est préférée.
    - Conserver uniquement ce qui sert la démo (ex. `src/css/`, `src/assets/`) si encore référencé, ou déplacer ces assets dans `apps/demo` ou `demo/`.

3. **Documentation**
    - Mettre à jour MONOREPO_STRUCTURE.md, PROJECT_TREE.md et le spec si des chemins ou scripts obsolètes sont cités (ex. `sync-to-public.ps1` → workflow CI).

Cette étape peut être planifiée comme une tâche de maintenance (sprint dédié ou critère d’acceptation d’une release). Le suivi vit aux registres : `_docs_projet/registres/backlog_technique.md` et `dette_technique.md`.

> ⚠️ **Ce renvoi affichait `AUDIT_COMPLET_APPLICATION.md` et pointait
> `travail/roadmaps/roadmap_documentation-v3.md`** — deuxième cas de texte et cible divergents
> trouvé le 01/08/2026, dans le même répertoire que celui de `MONOREPO_STRUCTURE.md`. Le document
> affiché n'existe nulle part dans le dépôt ; la cible était une roadmap qui n'a jamais porté ce
> chantier. Un lien vert vers le mauvais document est plus coûteux qu'un lien mort — celui-ci a
> survécu à deux refontes documentaires. Le renvoi est supprimé plutôt que repointé : le
> destinataire réel de ces tâches, ce sont les registres.

### Fusion deploy/ et test-deploy/ (étape 10 — faite)

- **Un seul dossier** : `deploy/` avec deploy-core, deploy-storage, deploy-storage-addpoi.
- **Un seul script** : `build-deploy.cjs` produit les 3 variantes en une fois (`npm run build:deploy`).
- **Scripts de serve** : `serve-test.cjs` et `serve-test.py` pointent vers ces sous-dossiers (ports 3001–3003). `create-test-deploy.ps1` est déprécié.
