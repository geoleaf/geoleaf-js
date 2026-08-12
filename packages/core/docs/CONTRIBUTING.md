---
title: "Contributing Guide — GeoLeaf.js"
---

# Contributing Guide — GeoLeaf.js

> Thank you for your interest in contributing to GeoLeaf.js. This guide covers what is needed to get started.

**Applies to:** `@geoleaf/core` v3.x

---

## Table of contents

- [Code of Conduct](#code-of-conduct)
- [How to contribute](#how-to-contribute)
- [Development setup](#development-setup)
- [Code standards](#code-standards)
- [Pull request process](#pull-request-process)
- [Architecture and modules](#modular-architecture-v20)
- [Tests](#tests)
- [Documentation](#documentation)
- [Versioning](#versioning)

---

## Code of Conduct

### Our commitments

GeoLeaf.js is committed to an open, welcoming and inclusive community. All contributors are expected to:

- **Respect** every participant, whatever their level of experience
- **Accept** constructive criticism gracefully
- **Focus** on what is best for the community
- **Communicate** professionally and courteously

### Unacceptable behaviour

- Sexualised language or imagery, unwanted attention
- Trolling, insulting or derogatory comments
- Public or private harassment
- Publishing private information without permission

---

## How to contribute

### Types of contribution

Several kinds of contribution are welcome.

#### Bug reports

- Use the GitHub issue template
- Include a clear description of the problem
- Provide steps to reproduce
- Add screenshots where relevant
- State the GeoLeaf.js version

#### Feature suggestions

- Open an issue with the "enhancement" label
- Describe the use case and the problem being solved
- Propose a solution or alternatives
- Stay open to discussion

#### Documentation

- Typo corrections
- Clarifications
- New guides or tutorials

#### Code

- Bug fixes
- New features
- Performance optimisations
- Refactoring

---

## Development setup

### Prerequisites

```bash
# Node.js >= 22.13.0 (see `engines` in the root package.json)
node --version  # v22.13.0 or higher

# npm >= 11.x (workspaces support required)
npm --version
```

### Installation

```bash
# 1. Fork the repository on GitHub

# 2. Clone your fork
git clone https://github.com/VOTRE-USERNAME/geoleaf-js.git
cd geoleaf-js

# 3. Add the upstream remote
git remote add upstream https://github.com/geoleaf/geoleaf-js.git

# 4. Install dependencies (npm workspaces — installs every package)
npm install

# 5. Check the installation
npm test
```

### Branch structure

```
main              # Stable production
├── feature/*     # New features
├── bugfix/*      # Bug fixes
├── hotfix/*      # Urgent production fixes
└── release/*     # Release preparation
```

Active development happens on `main`; pull requests are squash-merged directly
into `main`.

### Git workflow

```bash
# 1. Create a branch from main
git checkout main
git pull upstream main
git checkout -b feature/my-new-feature

# 2. Make your changes
# ... code, test, commit ...

# 3. Update from upstream
git fetch upstream
git rebase upstream/main

# 4. Push to your fork
git push origin feature/my-new-feature

# 5. Open a pull request on GitHub
```

---

## Code standards

### TypeScript style

GeoLeaf.js uses **strict TypeScript** (ES2022), **ESLint** and **Prettier** for a uniform codebase.

```bash
# Lint the code
npm run lint

# Fix automatically
npm run lint:fix

# Format with Prettier
npm run format

# Type checking
cd packages/core && npm run typecheck
```

#### Naming conventions

```typescript
// Variables and functions: camelCase
const mapInstance = map;
function createMarker() {}

// Classes and interfaces: PascalCase
class LayerManager {}
interface POIConfig {}

// Constants: UPPER_SNAKE_CASE
const MAX_ZOOM_LEVEL = 18;
const DEFAULT_CONFIG = {};

// Modules: kebab-case
// file: layer-manager.ts
// directory: feature-info/
```

#### Code organisation

```typescript
/**
 * Structure of a GeoLeaf v2 module.
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

### TSDoc and inline documentation

**Every public function must carry complete TSDoc.**

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

### Modular architecture v2.0

#### Modularisation principles

1. **Single Responsibility Principle** — one module, one responsibility
2. **Modules under 500 lines** — soft limit; split beyond it (hard limit: 700)
3. **Explicit exports** — always name exports
4. **Minimal dependencies** — avoid tight coupling
5. **Pure ESM** — no `require()`, no CommonJS syntax

#### Directory structure (packages/core/src/)

```
src/
├── bundle-esm-entry.ts      ← ESM entry point (27 named exports)
├── kernel-exports.ts        ← Kernel surface, re-exported as a block by the entry
├── app/                     ← boot, module registry, helpers
├── adapters/maplibre/       ← The ONLY place that imports maplibre-gl
├── contracts/               ← Shared cross-module interfaces
├── capabilities/            ← In-core capabilities, each with its own install.ts
│                              (taxonomy, filter, cluster, legend, permalink, offline…)
├── api/                     ← Public `geoleaf.*.ts` facades (GeoLeaf.* namespace), no logic
├── globals/                 ← `globals.*.ts` — mounts kernel facades on window.GeoLeaf
├── kernel/                  ← The kernel: api/, config/, geojson/, ui/, security/, shared/…
├── utils/                   ← log, errors, constants, performance, general
├── css/ · lang/ · presets/  ← Source styles, translations, preset manifests
└── global.d.ts              ← Global namespace typing
```

> The exhaustive, **generated** tree lives in
> `docs/reference/ARBORESCENCE_QUALIFIEE.md` (`npm run docs:tree`); the listing
> above is an orientation summary.

#### Example: create a new capability

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

## Pull request process

### Pre-submission checklist

#### Code Quality & Style

- [ ] **Code style** — lint and format pass (`npm run lint`, `npm run format`)
- [ ] **TypeScript** — `npm run typecheck` reports no error
- [ ] **Complexity** — no function over 80 LOC (100 LOC maximum, with justification)
- [ ] **Duplication** — no duplicated code (use shared modules)
- [ ] **Naming** — conventions respected (camelCase, PascalCase, UPPER_SNAKE_CASE)

#### Security Checklist

- [ ] **XSS prevention** — no use of `innerHTML` without sanitization
    - Use `GeoLeaf.DOMSecurity.setSafeHTML()` or `textContent`
    - Verify with `node scripts/audit-innerhtml.cjs`
- [ ] **Input validation** — every user input validated
    - `JSON.parse()` wrapped in try/catch
    - No `Object.assign()` with untrusted data (prototype pollution)
- [ ] **CSRF protection** — CSRF tokens for forms and mutations
- [ ] **No-plugin-in-core** — no reference to `@geoleaf-plugins/*` inside `packages/core/src/`

#### Tests & Coverage

- [ ] **Tests** — all tests pass (`npm test`)
- [ ] **Coverage** — at least 75% on new code (`npm run test:coverage`)
- [ ] **Edge cases** — tests for null, undefined and empty values
- [ ] **New tests** — added for new features

#### Documentation

- [ ] **TSDoc** — complete on every public function and export
    - `@param` with types, `@returns`, `@throws` where applicable
- [ ] **CHANGELOG** — entry added with a description
- [ ] **Examples** — code examples provided for a new feature

#### Architecture & Performance

- [ ] **Memory leaks** — none introduced
    - Check event listener cleanup
    - Check that setTimeout/setInterval are cleared
- [ ] **Bundle size** — no significant increase (over 5%)
    - `npm run size` (hard budget: build fails above 300 KB gz, warning above 270 KB gz)
- [ ] **Boot order** — `globals.*.ts` not modified without checking the B1→B11 sequence

#### Git & CI/CD

- [ ] **Commits** — clear messages (Conventional Commits)
- [ ] **Branch** — up to date with `upstream/main`
- [ ] **CI/CD** — pipeline passes (lint, typecheck, tests, build)
- [ ] **No warnings** — no ESLint or TypeScript warning

### Pull request template

```markdown
## Description

Short description of the changes.

## Type of change

- [ ] Bug fix (non-breaking change that fixes a problem)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that breaks compatibility)
- [ ] Documentation (documentation changes only)
- [ ] Refactoring (change that neither adds a feature nor fixes a bug)
- [ ] Performance (performance improvement)
- [ ] Tests (test additions or corrections)

## Motivation and context

Why is this change needed? Which problem does it solve?

## How to test

1.
2.
3.

## Checklist

- [ ] My code follows the project style
- [ ] I have self-reviewed my code
- [ ] I have updated the documentation
- [ ] My changes generate no warnings
- [ ] I have added tests proving that my fix works
- [ ] All tests pass locally

## Related issues

Fixes #(issue_number)
```

### Code review

Pull requests are reviewed against these criteria:

1. **Code quality** — conventions, readability, performance
2. **Tests** — adequate coverage, no regression
3. **Documentation** — complete TSDoc, examples where needed
4. **Architecture** — established patterns, well-decoupled modules, no-plugin-in-core

### Merge process

1. **Review approved** by at least one maintainer
2. **CI/CD green** (typecheck, lint, tests, build)
3. **Conflicts resolved** against main
4. **Squash merge** into main (cleaned-up commits)

---

## Tests

### Test frameworks

- **Vitest 3** — unit and integration tests (ESM, Istanbul provider)
- **Playwright** — end-to-end tests (Chromium)

### Test commands

```bash
# All unit tests (through Turborepo)
npm test

# Unit tests (Vitest directly, inside packages/core)
cd packages/core && npm run test:vitest

# Tests with coverage
npm run test:coverage

# E2E tests (requires a built deploy/)
npm run test:e2e

# Specific tests (filter on the file path)
cd packages/core && npx vitest run __tests__/legend
```

### Writing tests

#### Unit tests (Vitest)

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

#### E2E tests (Playwright)

```typescript
// e2e/mon-feature.spec.ts

import { test, expect } from "@playwright/test";

test.describe("My Feature", () => {
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

### Test coverage

**Target** — at least 75% overall coverage (reached in v2.0.0)

- **Critical functions** — 100% coverage recommended
- **Utilities** — above 90% coverage
- **UI components** — above 70% coverage

---

## Documentation

### Documentation types

1. **Inline TSDoc** — in the source code (mandatory for public APIs)
2. **Guides** — documentation under `packages/core/docs/`
3. **API reference** — generated from TSDoc by TypeDoc (`npm run docs:api`)
4. **Examples** — JSON profiles under `profiles/` and demos under `packages/core/demo/`

### Updating the documentation

```bash
# 1. Update the TSDoc in the source code

# 2. Regenerate the API reference
cd packages/core && npm run docs:api

# 3. Update the relevant guide under docs/

# 4. Update packages/core/docs/CHANGELOG.md (the [Unreleased] section)
```

---

## Versioning

GeoLeaf.js follows **Semantic Versioning 2.0.0**.

### Format: `MAJOR.MINOR.PATCH`

- **MAJOR** — incompatible changes (breaking changes)
- **MINOR** — backwards-compatible new features
- **PATCH** — backwards-compatible bug fixes

### Examples

```
2.0.0 → 2.0.1   # Bug fix
2.0.0 → 2.1.0   # New feature
2.x.x → 3.0.0   # Breaking change
```

### Commit messages

Format: **Conventional Commits**

```bash
# Format
<type>(<scope>): <short description>

[optional body]

[optional footer]
```

#### Commit types

- `feat` — new feature
- `fix` — bug fix
- `docs` — documentation only
- `style` — formatting, missing semicolons, and similar
- `refactor` — refactoring without behaviour change
- `perf` — performance improvement
- `test` — test additions or corrections
- `chore` — maintenance, build, dependencies

#### Examples

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

## Best practices

### Performance

- **Payload** — never import a capability (`src/capabilities/*`) from the kernel; that is what makes it undetachable from the bundle. `npm run size:example` checks this against the sourcemaps
- **Debounce/throttle** — on frequent events (scroll, resize, input)
- **Cache** — cache expensive results
- **Memory management**
    - Clean up event listeners in destroy()
    - Clear setTimeout/setInterval
    - Avoid circular references (use WeakMap where needed)

### Security

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

### Maintainability

- **DRY** — Don't Repeat Yourself
- **KISS** — Keep It Simple, Stupid
- **YAGNI** — You Aren't Gonna Need It
- **Documentation** — explain the "why", not the "how"

---

## Need help?

### Resources

- **Documentation** — `packages/core/docs/`
- **GitHub issues** — [Issues](https://github.com/geoleaf/geoleaf-js/issues)
- **Contact** — Mattieu Pottier, contact@geoleaf.dev

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

**Important**: this header must be placed **before all other code and comments** in the file.

### License Agreement

By contributing to GeoLeaf Core, you agree that:

1. Your contributions are licensed under the **MIT License**
2. You have the right to license your contributions
3. Your contributions do not infringe on any third-party rights
4. You understand that the core and every plugin are MIT-licensed and independently versioned

See the [LICENSE](https://github.com/geoleaf/geoleaf-js/blob/main/LICENSE) file for the complete license text.

---

**Thank you for contributing to GeoLeaf.js.**

Every contribution makes GeoLeaf.js a better tool for everyone.
