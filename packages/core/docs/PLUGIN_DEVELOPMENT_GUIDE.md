---
title: "GeoLeaf — Plugin development guide"
---

# GeoLeaf — Plugin development guide

**Package:** `@geoleaf/core`

---

## Overview

A GeoLeaf plugin is an ESM npm package that:

1. Is imported **after** the GeoLeaf core
2. Extends the `GeoLeaf.*` namespace through the `globalThis` bridge
3. Registers itself in `GeoLeaf.plugins` through `GeoLeaf.plugins.register()`

The system is deliberately simple: no base class, no framework — a single entry file is enough.

**Reference:** the reference plugins (`@geoleaf-plugins/connector`, `@geoleaf-plugins/editor`, `@geoleaf-plugins/offline-ui`) all follow the same pattern.

---

## Prerequisites

- Node.js ≥ 18
- `@geoleaf/core` in `peerDependencies`
- Pure ESM is mandatory: `"type": "module"` in `package.json`
- No `require()`, no `module.exports`

---

## Minimal structure

```
my-plugin/
├── package.json
├── rollup.config.js        ← ESM build
└── src/
    └── entry.ts            ← single entry point
```

### package.json

```json
{
    "name": "@my-scope/my-plugin",
    "version": "1.0.0",
    "type": "module",
    "main": "./dist/my-plugin.js",
    "module": "./dist/my-plugin.js",
    "exports": {
        ".": "./dist/my-plugin.js"
    },
    "peerDependencies": {
        "@geoleaf/core": "^2.0.0"
    },
    "devDependencies": {
        "@geoleaf/core": "^2.0.0",
        "rollup": "^4.0.0",
        "typescript": "^5.0.0"
    }
}
```

### rollup.config.js

```js
import { defineConfig } from "rollup";
import typescript from "@rollup/plugin-typescript";

export default defineConfig({
    input: "src/entry.ts",
    output: {
        file: "dist/my-plugin.js",
        format: "esm",
    },
    plugins: [typescript()],
    external: ["@geoleaf/core"],
});
```

---

## Entry pattern

The `src/entry.ts` file follows a three-step pattern.

### Step 1 — Internal imports

```typescript
// Import your internal modules (they run at import time)
import "./my-feature.js";
import { MyService } from "./my-service.js";
```

### Step 2 — Bridge to the GeoLeaf namespace

```typescript
// Reach the global GeoLeaf namespace (without importing the core — avoids circular dependencies)
const _g = globalThis as {
    GeoLeaf?: {
        _version?: string;
        plugins?: {
            register(
                name: string,
                opts: {
                    version?: string;
                    requires?: string[];
                    optional?: string[];
                    label?: string;
                    healthCheck?: () => boolean;
                }
            ): void;
        };
        // Declare here whatever you are about to add
        MyPlugin?: { myMethod(): void };
    };
};

// Add your API onto GeoLeaf.*
if (_g.GeoLeaf) {
    _g.GeoLeaf.MyPlugin = {
        myMethod: MyService.myMethod.bind(MyService),
    };
}
```

### Step 3 — Registration in PluginRegistry

```typescript
if (_g.GeoLeaf?.plugins?.register) {
    _g.GeoLeaf.plugins.register("my-plugin", {
        version: _g.GeoLeaf._version, // core version (for compatibility)
        requires: [], // required plugins (e.g. ["storage"])
        optional: [], // optional plugins
        label: "My Plugin (description)",
        healthCheck: () => !!_g.GeoLeaf?.MyPlugin?.myMethod,
    });
}
```

---

## Full example: a "Hello World" plugin

```typescript
// src/entry.ts

interface GeoLeafGlobal {
    _version?: string;
    plugins?: {
        register(
            name: string,
            opts: {
                version?: string;
                requires?: string[];
                optional?: string[];
                label?: string;
                healthCheck?: () => boolean;
            }
        ): void;
    };
    Hello?: {
        greet(name: string): string;
        version: string;
    };
}

const _g = globalThis as { GeoLeaf?: GeoLeafGlobal };

// --- Implementation ---
const HelloService = {
    greet(name: string): string {
        return `Hello, ${name}! From GeoLeaf Hello plugin.`;
    },
    version: "1.0.0",
};

// --- Bridge ---
if (_g.GeoLeaf) {
    _g.GeoLeaf.Hello = HelloService;
}

// --- Registration ---
if (_g.GeoLeaf?.plugins?.register) {
    const coreVersion = _g.GeoLeaf._version;
    _g.GeoLeaf.plugins.register("hello", {
        // `version` is optional on both sides: under `exactOptionalPropertyTypes`, an ABSENT
        // key and a key present but holding `undefined` are no longer interchangeable.
        // Insert it conditionally rather than propagating the `undefined`.
        ...(coreVersion !== undefined && { version: coreVersion }),
        label: "Hello Plugin (example)",
        healthCheck: () => typeof _g.GeoLeaf?.Hello?.greet === "function",
    });
}
```

**Use from the application:**

```js
import "@geoleaf/core";
import "@my-scope/hello-plugin";

// Check that it is loaded
GeoLeaf.plugins.isLoaded("hello"); // → true

// Use the API
GeoLeaf.Hello.greet("World"); // → "Hello, World! From GeoLeaf Hello plugin."
```

---

## Load order

The plugin **must be imported after** the GeoLeaf core:

```js
// Correct order
import GeoLeaf from "@geoleaf/core";
import "@my-scope/my-plugin"; // GeoLeaf.* already exists

// Incorrect order — GeoLeaf.plugins does not exist yet
import "@my-scope/my-plugin";
import GeoLeaf from "@geoleaf/core";
```

Over a CDN (ESM):

```html
<script type="module" src="geoleaf.esm.js"></script>
<script type="module" src="my-plugin.js"></script>
```

---

## PluginRegistry API

Reachable through `GeoLeaf.plugins` (a named export of the core):

| Method                  | Description                                    | Returns          |
| ----------------------- | ---------------------------------------------- | ---------------- |
| `register(name, opts)`  | Registers a plugin as loaded                   | `void`           |
| `isLoaded(name)`        | Is the plugin loaded?                          | `boolean`        |
| `canActivate(name)`     | Are all `requires` dependencies loaded?        | `boolean`        |
| `getLoadedPlugins()`    | List of loaded names                           | `string[]`       |
| `getAvailableModules()` | List of every module (loaded + lazy available) | `string[]`       |
| `getInfo(name)`         | Metadata for a plugin                          | `object \| null` |
| `load(name)`            | Loads a lazy module by name                    | `Promise<void>`  |
| `reportPlugins()`       | Prints the loaded plugins to the console       | `void`           |

```js
// Example
GeoLeaf.plugins.getLoadedPlugins();
// → ["core", "poi", "connector", "hello"]

GeoLeaf.plugins.getInfo("hello");
// → { name: "hello", version: "3.0.0", loaded: true, label: "Hello Plugin", healthCheck: fn }
```

---

## DOM events

The system emits events on `document`:

| Event                        | Fired when                                          |
| ---------------------------- | --------------------------------------------------- |
| `geoleaf:plugin:loaded`      | A plugin registers through `plugins.register()`     |
| `geoleaf:plugin:lazy-loaded` | A lazy module is loaded via `PluginRegistry.load()` |
| `geoleaf:plugin:failed`      | Lazy loading failed                                 |

```js
document.addEventListener("geoleaf:plugin:loaded", (e) => {
    console.log("Plugin chargé :", e.detail.name, e.detail.version);
});
```

---

## What a plugin may import from `@geoleaf/core`

The public named exports are available to plugins:

```typescript
import {
    PluginRegistry,
    APIController,
    Log,
    Errors,
    CONSTANTS,
    Core,
    // ... see API_REFERENCE.md for the complete list
} from "@geoleaf/core";
```

::: warning
**Rule:** import only the exports listed in [API_REFERENCE.md](API_REFERENCE.md). Do not import from internal subpaths (`@geoleaf/core/src/modules/...`).
:::

---

## Namespace rules

- **Prefix your namespace** to avoid collisions: `GeoLeaf.MyOrg_MyPlugin` or `GeoLeaf.MyPlugin`
- **Do not overwrite** existing namespaces: `GeoLeaf.POI`, `GeoLeaf.Core`, `GeoLeaf.UI`, and so on
- **Keep the healthCheck light**: it is called at boot for the start-up report

---

## Plugins with dependencies

If your plugin requires another plugin:

```typescript
_g.GeoLeaf.plugins.register("my-plugin", {
    requires: ["storage"], // will be checked by canActivate()
    optional: ["addpoi"], // documented but not blocking
    healthCheck: () => GeoLeaf.plugins.isLoaded("storage") && !!_g.GeoLeaf?.MyPlugin,
});
```

Check before using an optional dependency:

```typescript
if (GeoLeaf.plugins.isLoaded("storage")) {
    // Use the Storage API
}
```

---

## Rules to follow

| Rule                                             | Reason                                    |
| ------------------------------------------------ | ----------------------------------------- |
| Pure ESM — no `require()`                        | GeoLeaf has been ESM-only since v2.0.0    |
| Do not import `@geoleaf-plugins/*` from the core | The `no-plugin-in-core` rule              |
| No access to the `src/modules/` internals        | Only the public API is stable             |
| Light healthCheck, free of side effects          | Called synchronously at boot              |
| Declare `@geoleaf/core` in `peerDependencies`    | Avoids bundling two instances of the core |

---

## See also

- PLUGIN_REGISTRY_BOOT.md — internal architecture of the registry
- [API_REFERENCE.md](API_REFERENCE.md) — complete list of the public named exports
- [ARCHITECTURE_GUIDE.md](ARCHITECTURE_GUIDE.md) — boot sequence and lazy modules
- `packages/plugins/connector/src/entry.ts` — the simplest reference implementation
