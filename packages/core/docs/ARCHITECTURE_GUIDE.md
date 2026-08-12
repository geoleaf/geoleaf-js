---
title: "GeoLeaf-JS — Architecture Guide"
---

# GeoLeaf-JS — Architecture Guide

**Package:** `@geoleaf/core`

**Applies to:** `@geoleaf/core` v3.x
**Target:** Browser (ESM), TypeScript strict

---

## Table of contents

1. [Overview](#overview)
2. [Boot sequence B1→B11](#boot-sequence-b1b11)
3. [Bundle formats](#bundle-formats)
4. [Map adapter — IMapAdapter](#map-adapter--imapadapter)
5. [Built-in vs optional modules](#built-in-vs-optional-modules)
6. [Composing a smaller bundle](#composing-a-smaller-bundle)
7. [Public facades (GeoLeaf.\*)](#public-facades-geoleaf)
8. [Shim layer — removed](#shim-layer--removed)
9. [Plugin Registry pattern](#plugin-registry-pattern)
10. [Security module](#security-module)
11. [Shared state](#shared-state)
12. [The no-plugin-in-core rule](#the-no-plugin-in-core-rule)

---

## Overview

GeoLeaf-JS is a **TypeScript library for interactive mapping** built on **MapLibre GL JS ^6.0.0**. It is organised as a **monorepo** (npm workspaces + Turborepo):

| Package                       | Licence | Registry           |
| ----------------------------- | ------- | ------------------ |
| `@geoleaf/core`               | MIT     | npmjs.org (public) |
| `@geoleaf-plugins/offline-ui` | MIT     | npmjs.org          |

The core package exposes:

- An **ESM CDN bundle** (`geoleaf.esm.js`, which assigns `window.GeoLeaf.*`) for CDN and browser use
- An **ESM bundle** with 27 named exports for bundlers (Vite, webpack, and others)
- **Stable `exports` subpaths** (`@geoleaf/core/kernel`, `@geoleaf/core/capabilities/<id>/install.js`, …) for composing a custom entry that embeds only the required capabilities — everything else is **tree-shaken**. See `COOKBOOK.md`, _Recipe 8_

---

## Boot sequence B1→B11

The boot sequence is orchestrated by `src/globals/globals.ts`, which imports the domain sub-modules in a strict order. **That order is critical — never change it without understanding every downstream dependency.**

```
bundle-esm-entry.ts
    │
    └── globals.ts  (orchestrator — imports in order)
            │
            ├── B1+B2  globals.core.ts
            │     ├── B1: Log, Errors, CONSTANTS, Security, CSRFToken
            │     └── B2: Utils (DOMSecurity, ErrorLogger,
            │               EventListenerManager, EventBus,
            │               FetchHelper, MapHelpers,
            │               PerformanceProfiler, TimerManager,
            │               ObjectUtils, ScaleUtils)
            │
            ├── B3+B4  globals.config.ts
            │     ├── B3: Helpers, Validators
            │     └── B4: Renderers, Data, Loaders, Map, Config
            │
            ├── B5     globals.geojson.ts
            │     └── B5: GeoJSON (INTERNAL), Route
            │
            ├── B6+B7+B9  globals.ui.ts
            │     ├── B6: Labels
            │     ├── B7: Legend, LayerManager
            │     └── B9: Themes, UI, Controls, Filters
            │
            ├── B8     globals.storage.ts
            │     └── B8: Storage namespace (populated by the plugin at runtime)
            │
            └── B11    globals.api.ts  ← MUST COME LAST
                  └── B11: All public facades (Core, GeoLeafAPI, Table, UI,
                            Filters, Baselayers, Legend, LayerManager, Helpers,
                            Validators, Themes, Labels, Search, Permalink,
                            Events, Notifications, PWA) + PluginRegistry + BootInfo

        There is no B10 step: globals.poi.ts disappeared when the POI subsystem was
        dissolved. A POI is a plain GeoJSON point layer, mounted by globals.geojson.ts
        then styled and rendered by the capabilities configured on the layer.


    app/app-namespace.ts  (boot-time helpers)
    app/init.ts     (initialisation orchestrator)
    app/boot.ts     (main boot — runs after globals)
```

### ModuleRegistry

Alongside the globals, `app/boot-install.ts` instantiates a **ModuleRegistry** that drives module lifecycles through a dependency graph:

```
app/boot-install.ts
    │
    └── new ModuleRegistry()
            ├── register(new CoreMapModule())              deps: ['config']
            ├── register(new ConfigModule())               deps: []
            ├── register(new SharedModule(capabilities))   deps: ['config']
            ├── register(new GeoJSONModule())              deps: ['config', 'core-map']
            ├── register(new UIModule())                   deps: ['config', 'core-map', 'shared', 'geojson']
            └── register(new ThemeEngineModule())          deps: ['geojson', 'ui']

    presets/apply-preset.ts
    │
    └── register(gatedModule(capability, gate))   for each capability of the manifest
            the gate is READ INSIDE init(), not at register time: a disabled
            capability is registered and stays inert
```

::: info
There are six kernel modules. `SecurityModule`, `APIModule` and `SearchModule` are not among them and have no class in the codebase. Optional capabilities are not registered here but by the preset.
:::

The topological sort (Kahn BFS) guarantees the initialisation order while honouring the dependencies each module declares through `ICoreModule.dependencies`.

### Critical rules

- `globals.api.ts` (B11) **must come last** — it reads the facades registered by B1–B10.
- `globals.core.ts` (B1+B2) **must come first** — every module depends on `Log` and `Errors`.
- `globals.storage.ts` (B8) sets up the `GeoLeaf.Storage` namespace — the plugin populates it at runtime.
- **Never** change the load order without reading every consuming file.

---

## Bundle formats

### ESM CDN (`bundle-esm-entry.ts` → `geoleaf.esm.js`)

Produces `dist/geoleaf.esm.js` (flat CDN bundle). Assigns `window.GeoLeaf.*` on load, through the side effects of `globals.ts`.

**Usage (CDN / browser):**

```html
<script
    type="module"
    src="https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf.esm.js"
></script>
<!-- window.GeoLeaf is now available -->
```

### ESM (`bundle-esm-entry.ts`)

Produces `dist/geoleaf.esm.js` and its static chunks. Exports the named symbols importable by TypeScript/ESM consumers (the kernel surface of `kernel-exports.ts`, plus the facades of the embedded capabilities). Triggers the same boot side effect. The chunks are a **build-time** split (`manualChunks`), all reached through static imports: they are not deferred loads.

**Usage (bundler / npm):**

```ts
import { Core, UI, LayerManager } from "@geoleaf/core";
```

---

## Map adapter — IMapAdapter

GeoLeaf V2 abstracts the mapping engine entirely behind the `IMapAdapter` interface (defined in `src/contracts/map-adapter.contract.ts`). No domain module may import directly from `maplibre-gl`.

### Geographic types

| Type            | Definition                           | Use               |
| --------------- | ------------------------------------ | ----------------- |
| `GeoLeafLatLng` | `{ lat, lng }` (WGS 84)              | Single coordinate |
| `GeoLeafBounds` | `{ north, south, east, west }`       | Geographic extent |
| `GeoLeafPoint`  | `{ x, y }` (pixels, top-left origin) | Screen projection |

**Ordering convention:** GeoLeaf uses `{ lat, lng }`; MapLibre GL uses `[lng, lat]` (GeoJSON order). The conversion lives exclusively in the adapter.

### IMapAdapter interface surface

```typescript
interface IMapAdapter {
    // Initialisation
    init(options: MapInitOptions): void;
    isReady(): boolean;
    destroy(): void;

    // View / navigation
    setView(center: GeoLeafLatLng, zoom: number): void;
    getCenter(): GeoLeafLatLng;
    getZoom(): number;
    setZoom(zoom: number): void;
    panTo(center: GeoLeafLatLng): void;
    flyTo(center: GeoLeafLatLng, zoom?: number): void;
    fitBounds(bounds: GeoLeafBounds, options?: { padding?: GeoLeafPoint; animate?: boolean }): void;
    getBounds(): GeoLeafBounds;

    // Events (normalised set)
    on(event: MapEvent, handler: (e: unknown) => void): void;
    off(event: MapEvent, handler: (e: unknown) => void): void;
    once(event: MapEvent, handler: (e: unknown) => void): void;

    // GeoJSON layers
    addGeoJSONLayer(id: string, data: unknown, options?: GeoLeafLayerOptions): void;
    removeLayer(id: string): void;
    hasLayer(id: string): boolean;
    showLayer(id: string): void;
    hideLayer(id: string): void;
    updateLayerData(id: string, data: unknown): void;
    setLayerStyle(id: string, style: GeoLeafStyleOptions): void;
    setLayerFilter(id: string, filter: unknown): void;

    // Markers
    createMarker(id: string, position: GeoLeafLatLng, options?: GeoLeafMarkerOptions): void;
    removeMarker(id: string): void;
    updateMarkerPosition(id: string, position: GeoLeafLatLng): void;
    createClusterGroup(id: string, options?: Record<string, unknown>): void;

    // Popups (opaque handles)
    createPopup(content: string | HTMLElement, options?: GeoLeafPopupOptions): unknown;
    openPopup(popup: unknown, position?: GeoLeafLatLng): void;
    closePopup(popup?: unknown): void;

    // Controls
    addControl(control: unknown, position: GeoLeafControlPosition): GeoLeafControl;
    removeControl(control: GeoLeafControl): void;

    // Utilities
    latLngToPoint(latlng: GeoLeafLatLng): GeoLeafPoint;
    pointToLatLng(point: GeoLeafPoint): GeoLeafLatLng;
    getContainer(): HTMLElement;
}
```

The concrete implementation is `MaplibreAdapter`, in `src/adapters/maplibre/`.

---

## Built-in vs optional modules

### Built-in modules (always present)

Loaded in the ESM bundle (`geoleaf.esm.js`). No additional network import is required.

| Module (`window.GeoLeaf.*`) | Source (`src/`)                   | Description                                     |
| --------------------------- | --------------------------------- | ----------------------------------------------- |
| `Log`                       | `utils/log/`                      | Internal logging system                         |
| `Errors`                    | `utils/errors/`                   | 9 typed error classes                           |
| `CONSTANTS`                 | `utils/constants/`                | Global constants                                |
| `Security`                  | `security/`                       | XSS, CSRF and DOM sanitisation                  |
| `Utils`                     | `utils/general/`                  | ~15 utilities (fetch, animation, lazy, perf, …) |
| `Config`                    | `built-in/config/`                | Profile loading, taxonomy, normalisation        |
| `Core`                      | `geoleaf.core.ts`                 | MapLibre map creation, base layers              |
| `Baselayers`                | `geoleaf.baselayers.ts`           | Raster and vector basemaps                      |
| `Filters`                   | `geoleaf.filters.ts`              | Filter system                                   |
| `UI`                        | `geoleaf.ui.ts` + `ui/`           | Interface (notifications, filters, controls)    |
| `Helpers`                   | `geoleaf.helpers.ts`              | Public helpers                                  |
| `Validators`                | `geoleaf.validators.ts`           | Data validation                                 |
| `plugins`                   | `built-in/api/plugin-registry.ts` | `GeoLeaf.plugins.*` — PluginRegistry            |
| `bootInfo`                  | `built-in/api/boot-info.ts`       | Boot toast                                      |

### In-core capabilities

A **capability** is an optional core feature, shipped inside the bundle and switched on by
configuration (`modules.<id>.enabled`). It is **not** loaded on demand: it is present as soon as
the bundle is. Capabilities live under `src/capabilities/<id>/`, each behind a single
`install.ts`.

---

## Composing a smaller bundle

::: danger
**BREAKING (v3) — lazy loading has been removed.** `GeoLeaf._loadModule()` and
`GeoLeaf._loadAllSecondaryModules()` **no longer exist**, and nothing replaces them: delete the
call. What they used to fetch is already there.
:::

Lazy loading answered a **build-time** question at runtime. It no longer kept its promise either:
the last chunks it served were re-export shells over code already present in the eager closure —
Rollup emitted them **empty**, and the browser downloaded them on every boot regardless.

A configuration flag can **disable** a capability; it cannot remove its code from the file the
browser has already downloaded. That choice is made **at build time**:

```ts
// my-entry.ts
import "@geoleaf/core/globals"; // populates window.GeoLeaf.* — also pulls in the kernel stylesheet
import "@geoleaf/core/helpers";
import { installBoot } from "@geoleaf/core/boot";
import { LEGEND_INSTALLER } from "@geoleaf/core/capabilities/legend/install.js";
import { CLUSTER_INSTALLER } from "@geoleaf/core/capabilities/cluster/install.js";

installBoot({ id: "mon-app", capabilities: [LEGEND_INSTALLER, CLUSTER_INSTALLER] });

export * from "@geoleaf/core/kernel";
export { Legend } from "@geoleaf/core/facades/legend.js";
```

::: warning
**BREAKING (v3)** — these subpaths are **new**. Paths of the form `@geoleaf/core/src/…` **never
worked**: `src/` is not listed in the package `files`, so it is never published, and `exports`
does not expose it.
:::

Whatever is not listed is **tree-shaken** — not deferred, **absent**. And **the CSS follows the
code**: each capability imports its stylesheet from its own `install.ts`, so the CSS is a node of
the module graph. Leave `filter` out and you get neither its JS nor the CSS of its proximity bar.
The cascade is pinned by `@layer gl.reset, gl.tokens, gl.kernel, gl.capabilities, gl.overrides` —
it no longer depends on concatenation order, and `gl.overrides` is reserved for integrators (a
rule placed there wins without `!important`).

**How this is verified.** Two entries are built and measured on **every build**:

| Entry                        | What it proves                                                                                                                                         | Command                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| `examples/minimal/entry.ts`  | the **source graph** tree-shakes                                                                                                                       | `npm run size:example`  |
| `examples/consumer/entry.ts` | the **published package** does too — it imports through the subpaths above, therefore through `exports` → `dist/esm/`, exactly like a consumer bundler | `npm run size:consumer` |

Both read the **sourcemaps** of the real eager closure (JS **and** CSS). The second exists because
the first cannot see beyond the repository: only the published package exercises the `exports`
map a consumer actually resolves.

---

## Public facades (GeoLeaf.\*)

The public API is exposed through **16+ facade files** in `src/api/`. Each facade re-exports from the domain module implementation — **no business logic in the facades**.

### Global namespace (`window.GeoLeaf.*`)

After boot, `window.GeoLeaf` contains:

| Property                               | Type   | Description                                            |
| -------------------------------------- | ------ | ------------------------------------------------------ |
| `GeoLeaf.Core`                         | Object | Map init, themes, lifecycle                            |
| ~~`GeoLeaf.POI`~~                      | —      | **No longer exists** — subsystem dissolved             |
| `GeoLeaf.UI`                           | Object | Controls, panels, UI filters                           |
| `GeoLeaf.Legend`                       | Object | Legend panel                                           |
| `GeoLeaf.LayerManager`                 | Object | GeoJSON layer management                               |
| `GeoLeaf.Baselayers`                   | Object | Basemaps (raster + MapLibre vector)                    |
| `GeoLeaf.Helpers`                      | Object | Utility helpers                                        |
| `GeoLeaf.Validators`                   | Object | Input validators                                       |
| `GeoLeaf.Labels`                       | Object | Label system                                           |
| `GeoLeaf.Notifications`                | Object | Toast notification system                              |
| `GeoLeaf.Permalink`                    | Object | URL permalink                                          |
| `GeoLeaf.Events`                       | Object | Event bus                                              |
| ~~`GeoLeaf.Search`~~                   | —      | **No longer exists** — engine purged with `flexsearch` |
| `GeoLeaf.PWA`                          | Object | Progressive Web App (install prompt)                   |
| `GeoLeaf.Config`                       | Object | Configuration access (get/set)                         |
| `GeoLeaf.Utils`                        | Object | 28 members (same shape as the ESM `Utils` export)      |
| `GeoLeaf.CONSTANTS`                    | Object | Application constants                                  |
| `GeoLeaf.Log`                          | Object | Logging system                                         |
| `GeoLeaf.Errors`                       | Object | 9 typed error classes                                  |
| `GeoLeaf.Security`                     | Object | XSS/CSRF helpers                                       |
| `GeoLeaf.Storage`                      | Object | Storage namespace (populated by the plugin at runtime) |
| `GeoLeaf.plugins`                      | Object | Plugin query/registration (PluginRegistry)             |
| `GeoLeaf.registry`                     | Object | Public ModuleRegistry (third-party self-registration)  |
| ~~`GeoLeaf._loadModule`~~              | —      | **No longer exists** — see the note below              |
| ~~`GeoLeaf._loadAllSecondaryModules`~~ | —      | **No longer exists** — see the note below              |
| `GeoLeaf._version`                     | string | Current version (for example `"3.0.0"`)                |

::: info
The struck-through members above no longer exist. `getModule("POI")` returns `null` — not
`undefined` — so that the question has an answer.
:::

::: info
`GeoLeaf.GeoJSON` is **not** a public facade. GeoJSON layers are managed internally and reached
through `GeoLeaf.LayerManager` and the JSON profiles. `GeoJSON.addData` does not exist at
runtime; the public replacement is `Layers.setData`.
:::

### Named ESM exports (27)

From `bundle-esm-entry.ts` — list **measured from the source**:

```ts
// Kernel facades — through ./kernel-exports.js
export { Core, GeoLeafAPI, UI, LayerManager, Baselayers, Helpers, Validators, Events };
export { APIController, APIFactoryManager, APIInitializationManager, APIModuleManager };
export { PluginRegistry, BootInfo, showBootInfo };
export { Log, Errors, CONSTANTS, Utils, Config, applyCssText };
export { CapabilityRegistry };

// Capability facades — embedded by this entry
export { Legend, Permalink, Share, Notifications, PWA };

export default GeoLeaf; // window.GeoLeaf (CDN/global passthrough)
```

---

## Shim layer — removed

There is no backward-compatibility layer any more. The eleven top-level re-export directories
(`src/baselayers/`, `src/poi/`, `src/ui/`, `src/validators/`, …) and the `src/modules/` they
redirected to **no longer exist**: the implementation lives directly under `src/kernel/`,
`src/capabilities/`, `src/api/` and `src/utils/`.

::: warning
An import aimed at one of those paths does not resolve — it is not deprecated, it is **dead**.
The up-to-date tree is generated: `docs/reference/ARBORESCENCE_QUALIFIEE.md`.
:::

---

## Plugin Registry pattern

GeoLeaf uses an explicit registration pattern to keep a strict separation between the MIT core and commercial plugins.

### Registration (plugin side)

```ts
// In the plugin entry point (for example storage/src/entry.ts)
import { PluginRegistry } from "@geoleaf/core";

PluginRegistry.register("storage", {
    version: "3.0.0",
    requires: ["core"],
    label: "GeoLeaf Storage",
});
```

### Querying (consumer side)

```js
GeoLeaf.plugins.isLoaded("storage"); // → true/false
GeoLeaf.plugins.getLoadedPlugins(); // → ["core", "storage"]
GeoLeaf.plugins.canActivate("addpoi"); // → true when dependencies are satisfied
GeoLeaf.plugins.getAvailableModules(); // → every module (loaded + lazy)
GeoLeaf.plugins.getInfo("storage"); // → { name, version, loaded, loadedAt, … }
await GeoLeaf.plugins.load("layerManager"); // → lazy load from the registry
```

### The no-plugin-in-core rule

`packages/core/src/` must never import `@geoleaf-plugins/*` — an **architecture** boundary, not a licensing one: the core stays standalone and tree-shakeable whatever the licence of the plugins. Checked by `scripts/verify-core-standalone.cjs`, run in CI (push and pull request) and in pre-commit.

---

## Security module

Every DOM injection must go through `src/kernel/security/`. Never use `innerHTML` directly in application code.

::: warning
**`Security` has no named ESM export.** Neither the entry, nor `./kernel`, nor any subpath
exposes it. The facade is mounted on the global namespace at boot; that is the only way in.
:::

```ts
// through the global namespace (CDN as well as bundler, once the core is initialised):
GeoLeaf.Security.sanitizeHTML(htmlString); // XSS sanitisation — the member is `sanitizeHTML`
GeoLeaf.Security.CSRFToken.get(); // CSRF token helper
```

**Key utilities:**

- `Security.sanitize()` — XSS sanitisation (strips dangerous HTML)
- `DOMSecurity` — Safe DOM helpers
- `CSRFToken` — CSRF token management
- `src/kernel/security/dom-security.ts` — Safe DOM operations; the XSS surface is gathered in a single directory

---

## Shared state

`src/kernel/shared/` holds the cross-module state objects and seams. Before changing a file here, identify every consumer — shared-state changes can silently break several modules.

Key files:

- `geojson-state.ts` — Registry of loaded GeoJSON layers
- `layer-visibility-state.ts` — Layer visibility state
- `lifecycle.ts` — IoC seam create → destroy → recreate
- `storage-contract.ts` — Decoupling boundary with the Storage plugin
- `sync-handler-contract.ts` — Synchronisation handler contract

::: info
This directory was previously `src/modules/shared/`, which has been removed.
:::

---

## The no-plugin-in-core rule

`packages/core/src/` must contain **zero references** to `@geoleaf-plugins/*`.

**Check:**

```bash
node scripts/verify-core-standalone.cjs
```

This script runs in CI (push and pull request) and in pre-commit. It is not part of the build: it fails CI and the commit, not the compilation. Plugin features are injected into the `GeoLeaf` namespace at runtime, through the Plugin Registry pattern — which is what lets the core ignore them entirely.
