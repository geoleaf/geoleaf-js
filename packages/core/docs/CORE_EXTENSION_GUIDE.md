---
title: "GeoLeaf-JS — Core Extension Guide"
---

# GeoLeaf-JS — Core Extension Guide

**Package:** `@geoleaf/core`

> This guide is aimed at developers who **fork the MIT core** and want to add a new internal module to it (a new domain layer, a new public facade). To build an **external plugin** without touching the core, see [PLUGIN_DEVELOPMENT_GUIDE.md](PLUGIN_DEVELOPMENT_GUIDE.md).

---

## Table of contents

1. [Prerequisites and required reading](#prerequisites-and-required-reading)
2. [Anatomy of a core module](#anatomy-of-a-core-module)
3. [Step 1 — Create the domain module](#step-1--create-the-domain-module)
4. [Step 2 — Register in the boot sequence](#step-2--register-in-the-boot-sequence)
5. [Step 3 — Expose a public facade](#step-3--expose-a-public-facade)
6. [Step 4 — Export from bundle-esm-entry.ts](#step-4--export-from-bundle-esm-entryts)
7. [Rules that must be followed](#rules-that-must-be-followed)
8. [Pre-merge checklist](#pre-merge-checklist)

---

## Prerequisites and required reading

Before touching the code, read, in order:

1. [ARCHITECTURE_GUIDE.md](ARCHITECTURE_GUIDE.md) — boot sequence B1→B11, bundles
2. [CONTRIBUTING.md](CONTRIBUTING.md) — conventions, TSDoc, ESLint

::: danger
**Critical rule:** never change the import order in `globals.*.ts` without having traced every downstream dependency. The B1→B11 order is non-negotiable.
:::

---

## Anatomy of a core module

A GeoLeaf core module is made of 3 to 5 files, depending on its complexity:

```
src/modules/{name}/
├── {name}.module.ts          ← Implementation — pure domain logic
├── {name}.types.ts           ← Types and interfaces (optional)
├── {name}-state.ts           ← Shared state when required (in shared/)
└── geoleaf.{name}.ts         ← Public facade (in src/modules/)
```

Plus 2 global entry points:

```
src/modules/globals.{group}.ts   ← Import of the module into the boot sequence
src/bundle-esm-entry.ts          ← Named ESM export of the facade
```

---

## Step 1 — Create the domain module

### 1a. Minimal structure

Create `src/modules/{name}/{name}.module.ts`:

```typescript
// src/modules/analytics/analytics.module.ts

import { Log } from "../core/log/log.module";
import { EventBus } from "../core/utils/event-bus";

/**
 * @internal
 * Analytics module — internal implementation.
 * Public API is exposed via GeoLeaf.Analytics facade (geoleaf.analytics.ts).
 */
export class AnalyticsModule {
    private static _initialized = false;

    static init(): void {
        if (this._initialized) return;
        this._initialized = true;
        Log.info("AnalyticsModule", "initialized");
    }

    static track(event: string, data?: Record<string, unknown>): void {
        EventBus.emit("analytics:track", { event, data });
    }
}
```

> **Naming rules:**
>
> - Class: `PascalCase` with a `Module` suffix
> - File: `kebab-case.module.ts`
> - Log namespace: identical to the class name

### 1b. Implementing ICoreModule (when using ModuleRegistry)

If the module has to integrate with the `ModuleRegistry` (recommended for conditional modules):

```typescript
import type {
    ICoreModule,
    IMapAdapter,
    IGeoLeafConfig,
} from "../../contracts/core-module.contract";

export class AnalyticsModule implements ICoreModule {
    readonly id = "analytics";
    readonly dependencies = ["core", "config"] as const; // Must be loaded after these

    async init(_adapter: IMapAdapter, _config: IGeoLeafConfig): Promise<void> {
        // Initialization logic
    }

    destroy(): void {
        // Cleanup
    }
}
```

---

## Step 2 — Register in the boot sequence

### 2a. Choose the right globals file

| Globals file         | Groups                | When to use it                         |
| -------------------- | --------------------- | -------------------------------------- |
| `globals.core.ts`    | B1, B2                | Low-level utilities, logging, security |
| `globals.config.ts`  | B3, B4                | Helpers, validators, config, renderers |
| `globals.geojson.ts` | B5                    | GeoJSON, vector layers, route          |
| `globals.ui.ts`      | B6, B7, B9            | Labels, UI, controls, filters          |
| `globals.poi.ts`     | B10                   | POI, forms, POI renderers              |
| `globals.api.ts`     | B11 — **always last** | Public facades only                    |

> `globals.storage.ts` (B8) is reserved for the Storage plugin — do not add core code here.

### 2b. Add the import to the right file

For example, for a post-config utility module:

```typescript
// src/modules/globals.config.ts  (excerpt)
// ...existing imports...
import { AnalyticsModule } from "./analytics/analytics.module";

// Init within the sequence
AnalyticsModule.init();
```

::: warning
**Important:** check that every dependency of the module sits in an **earlier** group (a lower B number). A module that depends on `Config` must be in B4 or later.
:::

---

## Step 3 — Expose a public facade

Create `src/modules/geoleaf.analytics.ts`:

````typescript
// src/modules/geoleaf.analytics.ts

/**
 * @description GeoLeaf Analytics namespace — event tracking facade.
 *
 * @example
 * ```ts
 * import { Analytics } from "@geoleaf/core";
 * Analytics.track("map:zoom", { level: 12 });
 * ```
 *
 * @see AnalyticsModule
 */

import { AnalyticsModule } from "./analytics/analytics.module";

export const Analytics = {
    /**
     * Track a named event with optional metadata.
     * @param event - Event name (e.g. "map:zoom", "poi:click")
     * @param data - Optional payload
     */
    track: (event: string, data?: Record<string, unknown>): void =>
        AnalyticsModule.track(event, data),
} as const;
````

> **Facade rules (`geoleaf.*.ts`):**
>
> - No domain logic — pure delegation to the module
> - TSDoc is mandatory: `@description`, `@example`, `@see`
> - **Never `@module`** — the tag is forbidden, and the commit is rejected if it appears.
>   Nothing read it, and the file path already says where the file is
> - `as const` on the exported object
> - Naming: `Analytics`, `POI`, `UI`, … (PascalCase, no suffix)

---

## Step 4 — Export from bundle-esm-entry.ts

Add the facade to the named ESM exports:

```typescript
// src/bundle-esm-entry.ts  (excerpt)
// ...existing exports...
export { Analytics } from "./modules/geoleaf.analytics";
```

And to assign it to the global namespace as well (`window.GeoLeaf.Analytics`), add this to `globals.api.ts` (B11):

```typescript
// src/modules/globals.api.ts  (excerpt)
import { Analytics } from "./geoleaf.analytics";
// ...
(globalThis as any).GeoLeaf.Analytics = Analytics;
```

---

## Rules that must be followed

| Rule                                                             | Reason                                                                              |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Never import from `@geoleaf-plugins/*`                           | The no-plugin-in-core rule — an architecture boundary, checked in CI and pre-commit |
| Never use `innerHTML` without `DOMSecurity`                      | Critical XSS surface                                                                |
| Go through `IMapAdapter` for every map interaction               | Mapping engine abstraction                                                          |
| Declare inter-module dependencies via `ICoreModule.dependencies` | Guaranteed topological order                                                        |
| TSDoc on every public method of the facade                       | TypeDoc prerequisite                                                                |
| Source files ≤ 700 lines (soft limit 500)                        | Maintainability                                                                     |
| Comment the code in English                                      | Project convention                                                                  |

---

## Pre-merge checklist

```
[ ] Module implements ICoreModule when conditional (ModuleRegistry)
[ ] Import added to the right globals.*.ts (B1→B10, never B11)
[ ] Facade geoleaf.{name}.ts created with complete TSDoc
[ ] Export added to bundle-esm-entry.ts
[ ] Global export added to globals.api.ts when required
[ ] No @geoleaf-plugins/* import in the code
[ ] No innerHTML without DOMSecurity
[ ] Unit tests created in packages/core/__tests__/
[ ] Module README created in packages/core/docs/{name}/
[ ] INDEX_CORE.md updated with the new module
[ ] npm run build passes
[ ] npm run test:jest passes
[ ] npm run lint passes
```

---

## See also

- [ARCHITECTURE_GUIDE.md](ARCHITECTURE_GUIDE.md) — Full architecture and boot sequence
- [PLUGIN_DEVELOPMENT_GUIDE.md](PLUGIN_DEVELOPMENT_GUIDE.md) — Build an **external** plugin (without modifying the core)
- [CONTRIBUTING.md](CONTRIBUTING.md) — Conventions and contribution workflow
