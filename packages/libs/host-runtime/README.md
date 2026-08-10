# @geoleaf/host-runtime

Internal shared library — **not published**. Two things for GeoLeaf plugins: typed
access to the global `GeoLeaf` namespace, and the UI chrome utilities they all share.

## Why

Plugins reach the host application through the runtime global `GeoLeaf` (assembled at
boot by `@geoleaf/core`). Before this package, each plugin did
`const _g = globalThis as any` and re-declared its own partial namespace shape —
reintroducing `any` and drifting. This package provides **one** typed accessor and
**one** shared shape (`roadmap_typage-plugins.md`, S0).

PLUGINS S1 widened the charter: the same plugins had also forked a handful of small UI
utilities (stylesheet adoption, menu drag, tooltips) into 2 packages each. Those live
here now, under `src/ui/`.

## API

### Host access

- `getGeoLeaf(): GeoLeafHost | undefined` — the namespace, or `undefined` before boot.
- `ensureGeoLeaf(): GeoLeafHost` — the namespace, creating an empty one if absent
  (to mount a plugin façade, e.g. `ensureGeoLeaf().Measure = …`).
- `coreConfigGet<T>(key, fallback?): T` — read `GeoLeaf.Config.get(key)`, else `fallback`
  (consolidates the per-plugin `utils/core-config.ts` copies).
- `getUINotifications(): UINotificationsSeam | undefined` — the live toast renderer off
  `GeoLeaf._UINotifications`, or `undefined` when the capability is absent. A **runtime
  seam**: the lookup happens at call time, so no static import to the core is created.
- `GeoLeafHost` — permissive structural shape of the namespace (the client subset;
  loosely mirrors the core source of truth `GeoLeafGlobal`).

### Shared UI (`src/ui/`)

- `adoptStylesheet(css, key)` — CSP-safe stylesheet injection via constructable
  stylesheets, idempotent per key.
- `wireDrag(handle, container, getRoot, varPrefix)` /
  `wireTouchDrag(handle, container, getRoot, varPrefix)` — floating-menu repositioning,
  RAF-throttled and clamped to the container. `varPrefix` selects the CSS custom-property
  family (`"editor"` → `--gl-editor-left` / `--gl-editor-top`).
- `wireTooltips(getRoot, getTooltipEl)`, `showTooltip`, `hideTooltip` — JS-positioned
  tooltips, needed because the floating menus clip their overflow.

Element parameters are passed as **getters**, not values: the menus rebuild their DOM on
`destroy()` + `init()`, and capturing by value would leave handlers on a detached node.

## Bundle contract

Imports **no value** from `@geoleaf/core` — that would pull the whole core (boot
side-effects, non-tree-shakable) into the plugin bundle. ⚠️ Load-bearing: do not import
from `@geoleaf/core` here, not even a type.

## Onboarding a plugin

Three steps. The third breaks the **build**, not the typecheck, so it is the one that
gets missed:

1. `"@geoleaf/host-runtime": "*"` in `devDependencies`
2. `paths` in `tsconfig.json` → `["../../libs/host-runtime/dist/types/index.d.ts"]`
3. `typescript: { compilerOptions: { paths: {} } }` in `rollup.config.mjs` — blanks the
   TS alias at build time so rollup resolves to `dist/index.js` by Node resolution

## Tests

The package default environment is `node` — the namespace accessors take no DOM, and
`host.test.ts` relies on `window` being genuinely absent to exercise its fallback arm.
DOM-dependent suites opt in per file with `// @vitest-environment happy-dom`.
