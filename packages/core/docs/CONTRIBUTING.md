---
title: "Guide de Contribution — GeoLeaf.js"
---

# Guide de Contribution — GeoLeaf.js

> **Bienvenue !** Merci de votre intérêt pour contribuer à GeoLeaf.js. Ce guide vous aidera à démarrer.

**Version produit** : GeoLeaf Platform V3
**S'applique à :** `@geoleaf/core` v3.x
**Dernière mise à jour** : mars 2026

> Convention de versioning : **Platform V3** est le label produit ; le SemVer technique des packages/releases est en **3.0.x**. Voir [VERSIONING_POLICY.md](VERSIONING_POLICY.md).

---

## Table des matières

- [Code de Conduite](#code-de-conduite)
- [Comment Contribuer](#comment-contribuer)
- [Configuration de Développement](#configuration-de-développement)
- [Standards de Code](#standards-de-code)
- [Processus de Pull Request](#processus-de-pull-request)
- [Architecture et Modules](#architecture-modulaire-v20)
- [Tests](#tests)
- [Documentation](#documentation)
- [Versioning](#versioning)

---

## Code de Conduite

### Nos Engagements

GeoLeaf.js s'engage à maintenir une communauté ouverte, accueillante et inclusive. Nous attendons de tous les contributeurs qu'ils :

- **Respectent** tous les participants, indépendamment de leur niveau d'expérience
- **Acceptent** les critiques constructives avec grâce
- **Se concentrent** sur ce qui est le mieux pour la communauté
- **Communiquent** de manière professionnelle et courtoise

### Comportements Inacceptables

- Langage ou imagerie sexualisés, attention non désirée
- Trolling, commentaires insultants/désobligeants
- Harcèlement public ou privé
- Publication d'informations privées sans permission

---

## Comment Contribuer

### Types de Contributions

Nous accueillons plusieurs types de contributions :

#### Rapports de Bugs

- Utilisez le template d'issue GitHub
- Incluez une description claire du problème
- Fournissez des étapes pour reproduire
- Ajoutez des captures d'écran si pertinent
- Précisez la version de GeoLeaf.js

#### Suggestions de Fonctionnalités

- Ouvrez une issue avec le label "enhancement"
- Décrivez le cas d'usage et le problème résolu
- Proposez une solution ou des alternatives
- Soyez ouvert aux discussions

#### Documentation

- Corrections de typos
- Clarifications
- Nouveaux guides ou tutoriels

#### Code

- Corrections de bugs
- Nouvelles fonctionnalités
- Optimisations de performance
- Refactoring

---

## Configuration de Développement

### Prérequis

```bash
# Node.js >= 22.13.0 (cf. `engines` du package.json racine)
node --version  # v22.13.0 ou supérieur

# npm >= 11.x (workspaces support requis)
npm --version
```

### Installation

```bash
# 1. Fork le repository sur GitHub

# 2. Clone votre fork
git clone https://github.com/VOTRE-USERNAME/geoleaf-js.git
cd geoleaf-js

# 3. Ajouter le remote upstream
git remote add upstream https://github.com/geoleaf/geoleaf-js.git

# 4. Installer les dépendances (npm workspaces — installe tous les packages)
npm install

# 5. Vérifier l'installation
npm test
```

### Structure de Branches

```
main              # Production stable
├── feature/*     # Nouvelles fonctionnalités
├── bugfix/*      # Corrections de bugs
├── hotfix/*      # Corrections urgentes production
└── release/*     # Préparation releases
```

La branche de développement actif est `main` ; les PR mergent directement dans
`main` via squash merge.

### Workflow Git

```bash
# 1. Créer une branche depuis main
git checkout main
git pull upstream main
git checkout -b feature/ma-nouvelle-fonctionnalite

# 2. Faire vos modifications
# ... codez, testez, commitez ...

# 3. Mettre à jour depuis upstream
git fetch upstream
git rebase upstream/main

# 4. Pousser vers votre fork
git push origin feature/ma-nouvelle-fonctionnalite

# 5. Créer une Pull Request sur GitHub
```

---

## Standards de Code

### Style TypeScript

GeoLeaf.js utilise **TypeScript strict** (ES2022), **ESLint** et **Prettier** pour l'uniformité du code.

```bash
# Linter le code
npm run lint

# Fixer automatiquement
npm run lint:fix

# Formatter avec Prettier
npm run format

# Vérification de types
cd packages/core && npm run typecheck
```

#### Conventions de Nommage

```typescript
// Variables et fonctions : camelCase
const mapInstance = map;
function createMarker() {}

// Classes et interfaces : PascalCase
class LayerManager {}
interface POIConfig {}

// Constants : UPPER_SNAKE_CASE
const MAX_ZOOM_LEVEL = 18;
const DEFAULT_CONFIG = {};

// Modules : kebab-case
// fichier : layer-manager.ts
// répertoire : feature-info/
```

#### Organisation du Code

```typescript
/**
 * Structure d'un module GeoLeaf v2.
 */

// 1. Imports
import { dependency } from "./module.js";

// 2. Constants
const CONSTANT_VALUE = "value";

// 3. Internal state
let _initialized = false;

// 4. Private helper functions
function _helperFunction() {}

// 5. Public functions (exports)
/**
 * Public function description.
 * @param config - Module configuration
 * @returns true on success
 */
export function publicFunction(config: Config): boolean {
    // Implementation
    return true;
}
```

### TSDoc et Documentation Inline

**Toutes les fonctions publiques DOIVENT avoir une TSDoc complète.**

```typescript
/**
 * Creates a POI marker on the map with custom options.
 *
 * @param mapId - Target map container ID
 * @param poi - POI object with coordinates and metadata
 * @param poi.lnglat - [longitude, latitude] pair (MapLibre GL JS convention)
 * @param poi.title - Display title
 * @param options - Additional options
 * @param options.draggable - Whether the marker is draggable
 *
 * @returns The created marker instance
 *
 * @throws {TypeError} If mapId is not a valid string
 * @throws {ValidationError} If coordinates are out of valid range
 *
 * @example
 * const marker = createPoiMarker('my-map', {
 *   lnglat: [2.3522, 48.8566],
 *   title: 'Paris'
 * }, { draggable: true });
 *
 * @since 2.0.0
 */
export function createPoiMarker(mapId: string, poi: POIConfig, options: MarkerOptions = {}) {
    // Implementation
}
```

### Architecture Modulaire v2.0

#### Principes de Modularisation

1. **Single Responsibility Principle** : Un module = une responsabilité
2. **Modules < 500 lignes** : Soft limit — fragmenter si dépassé (hard limit : 700)
3. **Exports explicites** : Toujours nommer les exports
4. **Dépendances minimales** : Éviter les couplages forts
5. **ESM pur** : Aucun `require()` ni syntaxe CommonJS

#### Structure de Répertoires (packages/core/src/)

```
src/
├── bundle-esm-entry.ts      ← Point d'entrée ESM (27 exports nommés)
├── kernel-exports.ts        ← La surface kernel, ré-exportée en bloc par l'entrée
├── app/                     ← boot, registry de modules, helpers
├── adapters/maplibre/       ← Le SEUL endroit qui importe maplibre-gl
├── contracts/               ← Interfaces partagées inter-modules
├── capabilities/            ← Les capacités in-core, chacune avec son install.ts
│                              (taxonomy, filter, cluster, legend, permalink, offline…)
├── api/                     ← Façades publiques `geoleaf.*.ts` (namespace GeoLeaf.*), sans logique
├── globals/                 ← `globals.*.ts` — pose les façades kernel sur window.GeoLeaf
├── kernel/                  ← Le noyau : api/, config/, geojson/, ui/, security/, shared/…
├── utils/                   ← log, errors, constants, performance, general
├── css/ · lang/ · presets/  ← Styles sources, traductions, manifestes de préréglages
└── global.d.ts              ← Typage du namespace global
```

> L'arborescence exhaustive et **générée** vit dans
> `docs/reference/ARBORESCENCE_QUALIFIEE.md` (`npm run docs:tree`) — ce bloc n'en est
> qu'un résumé d'orientation.

#### Exemple : Créer une Nouvelle Capacité

```typescript
// packages/core/src/capabilities/mon-module/mon-module.ts

/**
 * @description Module description
 */

import { Log } from "../../utils/log/index.js";
import { Validators } from "../../api/geoleaf.validators.js";

// Constants
const MODULE_NAME = "MonModule";

// Internal state
let _initialized = false;

/**
 * Initializes the module with the provided configuration.
 *
 * @param config - Module configuration object
 * @returns true on success
 */
export function init(config: ModuleConfig): boolean {
    try {
        Validators.validateConfig(config);
        _initialized = true;
        return true;
    } catch (error) {
        Log.error(`${MODULE_NAME} init failed`, error);
        return false;
    }
}

/**
 * Main feature entry point.
 *
 * @param data - Data to process
 * @returns Processed result
 */
export function mainFeature(data: unknown): unknown {
    if (!_initialized) {
        throw new Error(`${MODULE_NAME} not initialized`);
    }
    // Implementation
}
```

---

## Processus de Pull Request

### Checklist Avant Soumission

#### Code Quality & Style

- [ ] **Code style** : Lint et format validés (`npm run lint`, `npm run format`)
- [ ] **TypeScript** : `npm run typecheck` passe sans erreur
- [ ] **Complexity** : Aucune fonction >80 LOC (max : 100 LOC avec justification)
- [ ] **Duplication** : Pas de code dupliqué (utiliser modules partagés)
- [ ] **Nomenclature** : Conventions respectées (camelCase, PascalCase, UPPER_SNAKE_CASE)

#### Security Checklist

- [ ] **XSS Prevention** : Aucun usage de `innerHTML` sans sanitization
    - Utiliser `GeoLeaf.DOMSecurity.setSafeHTML()` ou `textContent`
    - Valider avec : `node scripts/audit-innerhtml.cjs`
- [ ] **Input Validation** : Toutes les entrées utilisateur validées
    - `JSON.parse()` wrappé dans try-catch
    - Pas de `Object.assign()` avec données non fiables (prototype pollution)
- [ ] **CSRF Protection** : Tokens CSRF si formulaires/mutations
- [ ] **No-plugin-in-core** : Aucune référence à `@geoleaf-plugins/*` dans `packages/core/src/`

#### Tests & Coverage

- [ ] **Tests** : Tous les tests passent (`npm test`)
- [ ] **Coverage** : Couverture ≥ 75% pour nouveau code (`npm run test:coverage`)
- [ ] **Edge cases** : Tests pour null/undefined/empty values
- [ ] **Tests ajoutés** : Nouveaux tests pour nouvelles fonctionnalités

#### Documentation

- [ ] **TSDoc** : Complète sur toutes fonctions et exports publics
    - `@param` avec types, `@returns`, `@throws` si applicable
- [ ] **CHANGELOG** : Entrée ajoutée avec description
- [ ] **Examples** : Code examples fournis si nouvelle feature

#### Architecture & Performance

- [ ] **Memory leaks** : Pas de fuites mémoire
    - Vérifier event listeners cleanup
    - Vérifier setTimeout/setInterval clearés
- [ ] **Bundle size** : Pas d'augmentation significative (>5%)
    - `npm run size` (budget dur : échec build > 300 KB gz, alerte > 270 KB gz)
- [ ] **Boot order** : `globals.*.ts` non modifié sans vérification séquence B1→B11

#### Git & CI/CD

- [ ] **Commits** : Messages clairs (Conventional Commits)
- [ ] **Branch** : À jour avec `upstream/main`
- [ ] **CI/CD** : Pipeline passe (lint, typecheck, tests, build)
- [ ] **No warnings** : Aucun warning ESLint/TypeScript

### Template de Pull Request

```markdown
## Description

Brève description des changements.

## Type de Changement

- [ ] Bug fix (changement non-breaking qui corrige un problème)
- [ ] New feature (changement non-breaking qui ajoute une fonctionnalité)
- [ ] Breaking change (fix ou feature qui casse la compatibilité)
- [ ] Documentation (changements de documentation uniquement)
- [ ] Refactoring (changement qui n'ajoute pas de feature ni ne fixe de bug)
- [ ] Performance (amélioration des performances)
- [ ] Tests (ajout ou correction de tests)

## Motivation et Contexte

Pourquoi ce changement est nécessaire ? Quel problème résout-il ?

## Comment Tester

1.
2.
3.

## Checklist

- [ ] Mon code suit le style du projet
- [ ] J'ai effectué une auto-revue de mon code
- [ ] J'ai mis à jour la documentation
- [ ] Mes changements ne génèrent pas de warnings
- [ ] J'ai ajouté des tests qui prouvent que mon fix fonctionne
- [ ] Tous les tests passent localement

## Issues Liées

Fixes #(issue_number)
```

### Revue de Code

Les Pull Requests seront reviewées selon ces critères :

1. **Qualité du Code** — Conventions, lisibilité, performance
2. **Tests** — Couverture adéquate, pas de régression
3. **Documentation** — TSDoc complète, exemples si nécessaire
4. **Architecture** — Patterns établis, modules bien découplés, no-plugin-in-core

### Processus de Merge

1. **Review approuvée** par au moins 1 mainteneur
2. **CI/CD green** (typecheck, lint, tests, build)
3. **Conflits résolus** avec main
4. **Squash merge** dans main (commits nettoyés)

---

## Tests

### Framework de Tests

- **Vitest 3** : Tests unitaires et d'intégration (ESM, provider Istanbul)
- **Playwright** : Tests E2E (end-to-end, Chromium)

### Commandes de Tests

```bash
# Tous les tests unitaires (via Turborepo)
npm test

# Tests unitaires (Vitest direct, dans packages/core)
cd packages/core && npm run test:vitest

# Tests avec couverture
npm run test:coverage

# Tests E2E (nécessite deploy/ construit)
npm run test:e2e

# Tests spécifiques (filtre sur le chemin du fichier)
cd packages/core && npx vitest run __tests__/legend
```

### Écrire des Tests

#### Tests Unitaires (Vitest)

```typescript
// packages/core/__tests__/capabilities/mon-module.test.ts

import { init, mainFeature } from "../../src/capabilities/mon-module/mon-module.js";

describe("MonModule", () => {
    describe("init()", () => {
        it("should initialize with valid config", () => {
            const config = { key: "value" };
            const result = init(config);
            expect(result).toBe(true);
        });

        it("should reject invalid config", () => {
            const result = init(null as any);
            expect(result).toBe(false);
        });
    });

    describe("mainFeature()", () => {
        beforeEach(() => {
            init({ key: "value" });
        });

        it("should process data correctly", () => {
            const data = { test: "data" };
            const result = mainFeature(data);
            expect(result).toBeDefined();
        });

        it("should throw if not initialized", () => {
            expect(() => mainFeature({})).toThrow();
        });
    });
});
```

#### Tests E2E (Playwright)

```typescript
// e2e/mon-feature.spec.ts

import { test, expect } from "@playwright/test";

test.describe("Ma Fonctionnalité", () => {
    test.beforeEach(async ({ page }) => {
        // Each spec targets its own deploy variant (ports 8766-8768)
        await page.goto("http://localhost:8766");
        await page.waitForSelector("#geoleaf-map");
    });

    test("should render the map", async ({ page }) => {
        const canvas = await page.locator("canvas.maplibregl-canvas");
        await expect(canvas).toBeVisible();
    });
});
```

### Couverture de Tests

**Objectif** : ≥ 75% couverture globale (cible atteinte en v2.0.0)

- **Fonctions critiques** : 100% couverture recommandée
- **Utilitaires** : >90% couverture
- **UI components** : >70% couverture

---

## Documentation

### Types de Documentation

1. **TSDoc Inline** : Dans le code source (obligatoire pour les APIs publiques)
2. **Guides** : Documentation dans `packages/core/docs/`
3. **API Reference** : Générée depuis TSDoc via TypeDoc (`npm run docs:api`)
4. **Exemples** : Profils JSON dans `profiles/` et démos dans `packages/core/demo/`

### Mettre à Jour la Documentation

```bash
# 1. Mettre à jour TSDoc dans le code source

# 2. Régénérer la référence API
cd packages/core && npm run docs:api

# 3. Mettre à jour le guide concerné dans docs/

# 4. Mettre à jour packages/core/docs/CHANGELOG.md (§[Unreleased])
#    ⚠️ `_docs_projet/CHANGELOG.md`, écrit ici jusqu'au 31/07/2026, N'EXISTE PAS.
#    Le CONTRIBUTING de la racine portait le même énoncé et a été corrigé le 30/07 ;
#    cette copie ne l'a pas été — deux exemplaires d'un même document, un seul réparé.
```

---

## Versioning

GeoLeaf.js suit le **Semantic Versioning 2.0.0** :

### Format : `MAJOR.MINOR.PATCH`

- **MAJOR** : Changements incompatibles (breaking changes)
- **MINOR** : Nouvelles fonctionnalités compatibles
- **PATCH** : Corrections de bugs compatibles

### Exemples

```
2.0.0 → 2.0.1   # Bug fix
2.0.0 → 2.1.0   # New feature
2.x.x → 3.0.0   # Breaking change
```

### Messages de Commit

Format : **Conventional Commits**

```bash
# Format
<type>(<scope>): <description courte>

[corps optionnel]

[footer optionnel]
```

#### Types de Commits

- `feat` : Nouvelle fonctionnalité
- `fix` : Correction de bug
- `docs` : Documentation uniquement
- `style` : Formatage, point-virgules manquants, etc.
- `refactor` : Refactoring sans changer le comportement
- `perf` : Amélioration des performances
- `test` : Ajout ou correction de tests
- `chore` : Maintenance, build, dépendances

#### Exemples

```bash
# Feature
git commit -m "feat(legend): add template caching system"

# Bug fix
git commit -m "fix(layers): correct point positioning on zoom"

# Breaking change
git commit -m "feat(api)!: change init signature to accept options object

BREAKING CHANGE: init() now requires options object instead of individual parameters"
```

---

## Bonnes Pratiques

### Performance

- **Payload** : ne jamais importer une capacité (`src/capabilities/*`) depuis le kernel — c'est ce qui la rend indétachable du bundle. Le gate `npm run size:example` le vérifie sur les sourcemaps
- **Debounce/Throttle** : Sur événements fréquents (scroll, resize, input)
- **Cache** : Mettre en cache les résultats coûteux
- **Memory Management** :
    - Cleanup event listeners dans destroy()
    - Clear setTimeout/setInterval
    - Éviter circular references (utiliser WeakMap si nécessaire)

### Sécurité

#### XSS Prevention

```typescript
// FORBIDDEN
element.innerHTML = userInput;

// CORRECT
GeoLeaf.DOMSecurity.setSafeHTML(element, userInput);
element.textContent = userText;
```

#### Input Validation

```typescript
// JSON.parse with error handling
try {
    const config = JSON.parse(jsonString);
    if (!validateSchema(config)) {
        throw new Error("Invalid schema");
    }
} catch (e) {
    Log.error("Parse error:", (e as Error).message);
    config = DEFAULT_CONFIG;
}
```

#### Prototype Pollution Prevention

```typescript
// FORBIDDEN
const merged = Object.assign({}, baseConfig, userConfig);

// CORRECT
const ALLOWED_KEYS = ["id", "label", "data"];
const safe: Record<string, unknown> = {};
Object.keys(userConfig).forEach((key) => {
    if (ALLOWED_KEYS.includes(key) && key !== "__proto__" && key !== "constructor") {
        safe[key] = (userConfig as any)[key];
    }
});
const merged = { ...baseConfig, ...safe };
```

#### Security Tools

```bash
# Audit XSS vulnerabilities
node scripts/audit-innerhtml.cjs

# Check dependencies
npm audit

# Validate code
npm run lint
```

### Maintenabilité

- **DRY** : Don't Repeat Yourself
- **KISS** : Keep It Simple, Stupid
- **YAGNI** : You Aren't Gonna Need It
- **Documentation** : Expliquer le "pourquoi", pas le "comment"

---

## Besoin d'Aide ?

### Ressources

- **Documentation** : `packages/core/docs/`
- **Issues GitHub** : [Issues](https://github.com/geoleaf/geoleaf-js/issues)
- **Contact** : Mattieu Pottier — contact@geoleaf.dev

---

## Licensing

### License Header

All TypeScript/JavaScript files contributed to GeoLeaf Core must include the MIT license header:

```typescript
/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */
```

**Important** : This header must be placed **before all other code and comments** in the file.

### License Agreement

By contributing to GeoLeaf Core, you agree that :

1. Your contributions are licensed under the **MIT License**
2. You have the right to license your contributions
3. Your contributions do not infringe on any third-party rights
4. You understand that the core and every plugin are MIT-licensed and independently versioned

See the [LICENSE](https://github.com/geoleaf/geoleaf-js/blob/main/LICENSE) file for the complete license text.

---

**Merci de contribuer à GeoLeaf.js !**

Votre aide fait de GeoLeaf.js un meilleur outil pour tous.
