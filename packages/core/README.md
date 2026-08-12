# @geoleaf/core

**Applies to:** `@geoleaf/core` v3.x · **License:** MIT

A TypeScript interactive mapping library built on **MapLibre GL JS**. Fully configurable through
JSON profiles — GeoJSON layers, styles, themes, taxonomy — with no application-side development.

[![npm version](https://img.shields.io/npm/v/@geoleaf/core.svg)](https://www.npmjs.com/package/@geoleaf/core)
[![npm downloads](https://img.shields.io/npm/dm/@geoleaf/core.svg)](https://www.npmjs.com/package/@geoleaf/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.13-brightgreen)](https://nodejs.org/)

> [!NOTE]
> This file is a **shop window, not a reference**. It covers installation, a minimal example and
> the entry points. Everything else lives on [geoleaf.dev/docs](https://www.geoleaf.dev/docs/),
> and each fact is written in exactly one place.

---

## Installation

```bash
npm install @geoleaf/core maplibre-gl
```

`maplibre-gl` is a **peerDependency** (`^6.0.0`): the engine stays outside the bundle, and **you**
supply it. **ESM only** on both sides — no UMD, no CommonJS, for GeoLeaf as for MapLibre since its
v6. Compilation target: **ES2022**.

> [!NOTE]
> Do not confuse this with the ready-made application shipped in the repository (`deploy/`), which
> has no dependency to install: it **self-hosts** MapLibre under `vendor/maplibre-gl/`, copied from
> `node_modules` at build time and pre-cached by its service worker. This package is the library —
> it does not pick the engine version, it declares it.

The package declares `engines.node`, so `npm install` warns on a Node version that is too old and
fails under `engine-strict`. Read the exact range from the manifest rather than from this page:
`npm view @geoleaf/core engines` for the published package, or
`node -p "require('@geoleaf/core/package.json').engines.node"` for the one you installed.

```javascript
import { Core } from "@geoleaf/core";
import "@geoleaf/core/style.css";

// `center` is [lat, lng] — the `coordinates` of a GeoJSON feature stay [lng, lat]
Core.init({
    map: { target: "map", center: [46.5, 2.5], zoom: 6 },
});
```

> [!WARNING]
> **The stylesheet is imported through the declared `@geoleaf/core/style.css` subpath.** A
> `@geoleaf/core/dist/…` specifier throws `ERR_PACKAGE_PATH_NOT_EXPORTED` — the `exports` map does
> not open `dist/`. Served URLs, on the other hand, point at files rather than package subpaths.

**In the browser — self-hosted** (what the shipped application does):

GeoLeaf reads the engine from `globalThis.maplibregl`, which v6 no longer publishes. Two lines put
it back, in a file placed next to the copied modules:

```javascript
// vendor/maplibre-gl/global.mjs
import * as maplibregl from "./maplibre-gl.mjs";
globalThis.maplibregl = maplibregl;
```

```html
<!-- MapLibre GL JS — ESM since v6; the shim republishes the global -->
<link rel="stylesheet" href="/vendor/maplibre-gl/maplibre-gl.css" />
<script type="module" src="/vendor/maplibre-gl/global.mjs"></script>

<!-- GeoLeaf — ESM -->
<link rel="stylesheet" href="/dist/geoleaf-main.min.css" />
<script type="module" src="/dist/geoleaf.esm.js"></script>
```

Copy **all four files** from `node_modules/maplibre-gl/dist/` — `maplibre-gl.mjs`,
`maplibre-gl-shared.mjs`, `maplibre-gl-worker.mjs` and `maplibre-gl.css` — into a **flat**
directory: the three modules reference each other by relative path.

> [!WARNING]
> **Your server must know the MIME type of `.mjs`.** Many configurations only list `js` and serve
> the module as `application/octet-stream`, which makes the browser refuse to execute it. MapLibre
> v6 is ESM-only and no longer publishes any classic bundle, so there is no non-module fallback.

CDN usage, and why `dist/chunks/` must be copied:
[CDN / NPM usage](https://www.geoleaf.dev/docs/usage-cdn.html).

---

## What the package exposes

The named exports of the ESM entry point:

`Core` · `GeoLeafAPI` · `UI` · `LayerManager` · `Baselayers` · `Helpers` · `Validators` ·
`Events` · `Log` · `Errors` · `CONSTANTS` · `Utils` · `Config` · `applyCssText` · `Legend` ·
`Permalink` · `Share` · `Notifications` · `PWA`, plus the API submodules (`APIController`,
`PluginRegistry`, `CapabilityRegistry`, `BootInfo`, `showBootInfo`…).

> [!IMPORTANT]
> **`POI`, `Filters`, `Route` and `Table` are no longer exported.** A POI is now a feature of an
> ordinary GeoJSON layer, read and written through `GeoLeaf.Layers.*`; `Table` moved out into its
> own plugin.

**The list is derived, not copied** — `npm run gen:api-surface` produces the surface manifest, and a
freshness gate compares it against the code on every `ci:local` run. Full signatures live at
[geoleaf.dev/docs/api/](https://www.geoleaf.dev/docs/api/) (TypeDoc, regenerable locally with
`npm run docs:api`).

The package also declares public subpaths — `./kernel`, `./globals`, `./helpers`, `./boot`,
`./facades/*`, `./capabilities/*`, `./contracts/*`, `./presets/*`. They all resolve (guarded by
`check:subpath-resolve`) and are documented in the
[Architecture Guide](https://www.geoleaf.dev/docs/ARCHITECTURE_GUIDE.html).

---

## Documentation

The full documentation is published at **[geoleaf.dev/docs](https://www.geoleaf.dev/docs/)**. It is
not shipped inside the npm tarball, which carries only `dist/`, this README and the licence.

| To…                                        | Read                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| get started in 5 minutes                   | [Getting Started](https://www.geoleaf.dev/docs/GETTING_STARTED.html)                                  |
| follow a step-by-step tutorial             | [Quickstart Tutorial](https://www.geoleaf.dev/docs/QUICKSTART_TUTORIAL.html)                          |
| learn the full usage                       | [User Guide](https://www.geoleaf.dev/docs/USER_GUIDE.html)                                            |
| configure a profile                        | [Profiles Guide](https://www.geoleaf.dev/docs/PROFILES_GUIDE.html)                                    |
| look up the JSON files                     | [Configuration Guide](https://www.geoleaf.dev/docs/CONFIGURATION_GUIDE.html)                          |
| look up the API                            | [API Reference](https://www.geoleaf.dev/docs/API_REFERENCE.html)                                      |
| look up the events                         | [Events API](https://www.geoleaf.dev/docs/EVENTS_API.html)                                            |
| understand the architecture and boot order | [Architecture Guide](https://www.geoleaf.dev/docs/ARCHITECTURE_GUIDE.html)                            |
| write a plugin                             | [Plugin Development](https://www.geoleaf.dev/docs/PLUGIN_DEVELOPMENT_GUIDE.html)                      |
| find recipes                               | [Cookbook](https://www.geoleaf.dev/docs/COOKBOOK.html) · [FAQ](https://www.geoleaf.dev/docs/FAQ.html) |
| review security                            | [Security](https://www.geoleaf.dev/docs/SECURITY.html)                                                |
| review accessibility                       | [Accessibility](https://www.geoleaf.dev/docs/ACCESSIBILITY.html)                                      |
| read the version history                   | [Changelog](https://www.geoleaf.dev/docs/CHANGELOG.html)                                              |
| read the versioning policy                 | [Versioning Policy](https://www.geoleaf.dev/docs/VERSIONING_POLICY.html)                              |

---

## Plugins

The core is standalone and tree-shakeable: it **never** imports a plugin (a boundary guarded by
`verify-core-standalone.cjs`). The `@geoleaf-plugins/*` packages are all MIT, each with its own
version and its own documentation.

The list and current versions are printed by `npm run versions:check` rather than restated here —
that is exactly the kind of table that drifts unnoticed. Note that `versions:check` measures **the
repository**, while `npm view <package> version` measures **the registry**; the two are not
guaranteed to agree.

To write your own: [Plugin Development](https://www.geoleaf.dev/docs/PLUGIN_DEVELOPMENT_GUIDE.html).

---

## Licence

**MIT**, with no exception — for the core as for every plugin. Full text in [`LICENSE`](LICENSE);
third-party attributions (including MapLibre GL JS, BSD-3-Clause) in
[NOTICE](https://www.geoleaf.dev/docs/NOTICE.html).

Commercial use, modification and redistribution are permitted, provided the licence notice is kept
and changes are documented.

---

## Support

- **Documentation** — [geoleaf.dev/docs](https://www.geoleaf.dev/docs/)
- **Issues** — [GitHub](https://github.com/geoleaf/geoleaf-js/issues)
- **Contributing** — [Contributing guide](https://www.geoleaf.dev/docs/CONTRIBUTING.html)

© 2026 Mattieu Pottier
