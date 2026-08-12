---
title: "GeoLeaf — Usage via CDN and npm"
---

# GeoLeaf — Usage via CDN and npm

**Applies to:** `@geoleaf/core` v3.x

---

This page describes the recommended ways to load GeoLeaf in a web application:

- via the **UNPKG CDN**;
- via the **jsDelivr CDN**;
- via **npm / ESM** in a modern bundler;
- via a **local ESM bundle** (`dist/geoleaf.esm.js`);
- with a **complete HTML example**;
- with **API warnings** around `GeoLeaf.Core.init(...)`.

> **Note (v2.0.0):** GeoLeaf is distributed exclusively as **ESM**. There is no UMD bundle
> (`geoleaf.min.js`) any more. Use `<script type="module">` or a modern bundler (Vite, Webpack,
> Rollup).

> **Peer dependency:** `maplibre-gl ^6.0.0` must be loaded separately — it is **not** included in
> the GeoLeaf bundle.

::: warning

**MapLibre has been ESM-only since v6** and no longer exposes a global: the two shim lines are
what puts `globalThis.maplibregl` back, which is where GeoLeaf reads the engine. That shim is
**inline**, so it requires `'unsafe-inline'` (or a nonce/hash) in `script-src` — in production,
prefer the self-hosted setup described in [`GETTING_STARTED.md`](GETTING_STARTED.md), where the
shim is a file.

:::

---

## 1. Usage via UNPKG (CDN)

```html
<!-- MapLibre GL JS (peer dependency — must be loaded before GeoLeaf) -->
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.css" />
<script type="module">
    import * as maplibregl from "https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.mjs";
    globalThis.maplibregl = maplibregl;
</script>

<!-- GeoLeaf styles -->
<link rel="stylesheet" href="https://unpkg.com/@geoleaf/core@3.0.0/dist/geoleaf-main.min.css" />

<!-- GeoLeaf ESM (via script type="module") -->
<script type="module">
    import { Core } from "https://unpkg.com/@geoleaf/core@3.0.0/dist/geoleaf.esm.js";
    // ...
</script>
```

---

## 2. Usage via jsDelivr (CDN)

```html
<!-- MapLibre GL JS -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.css" />
<script type="module">
    import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.mjs";
    globalThis.maplibregl = maplibregl;
</script>

<!-- GeoLeaf styles -->
<link
    rel="stylesheet"
    href="https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf-main.min.css"
/>

<!-- GeoLeaf ESM -->
<script type="module">
    import { Core } from "https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf.esm.js";
    // ...
</script>
```

---

## 3. Local use of the ESM bundle (dist/)

```html
<!-- MapLibre GL JS (self-hosted here — the shim is a file, not an inline block) -->
<link rel="stylesheet" href="/vendor/maplibre-gl/maplibre-gl.css" />
<script type="module" src="/vendor/maplibre-gl/global.mjs"></script>

<!-- Local GeoLeaf styles -->
<link rel="stylesheet" href="/dist/geoleaf-main.min.css" />

<!-- Local GeoLeaf ESM -->
<script type="module">
    import { Core } from "/dist/geoleaf.esm.js";
    // ...
</script>
```

---

## 4. npm / ESM import in a modern bundler

```bash
npm install @geoleaf/core maplibre-gl
```

```typescript
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { Core } from "@geoleaf/core";
import "@geoleaf/core/style.css";

Core.init({
    mapId: "geoleaf-map",
    center: [-32.95, -60.65], // [lat, lng] — GeoLeaf; MapLibre expects [lng, lat], conversion is internal
    zoom: 12,
    theme: "light",
});
```

---

## 5. Complete HTML example

```html
<!DOCTYPE html>
<html lang="fr">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>GeoLeaf example — CDN ESM</title>

        <!-- MapLibre GL JS (peer dependency) — stylesheet AND engine -->
        <link
            rel="stylesheet"
            href="https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.css"
        />
        <script type="module">
            import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.mjs";
            globalThis.maplibregl = maplibregl;
        </script>

        <!-- GeoLeaf styles -->
        <link
            rel="stylesheet"
            href="https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf-main.min.css"
        />

        <style>
            html,
            body {
                margin: 0;
                padding: 0;
                height: 100%;
            }
            #geoleaf-map {
                width: 100vw;
                height: 100vh;
            }
        </style>
    </head>
    <body>
        <div id="geoleaf-map"></div>

        <script type="module">
            import { Core } from "https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf.esm.js";

            document.addEventListener("DOMContentLoaded", () => {
                Core.init({
                    mapId: "geoleaf-map",
                    center: [-32.95, -60.65], // [lat, lng] — GeoLeaf; MapLibre expects [lng, lat], conversion is internal
                    zoom: 12,
                    theme: "light",
                });
            });
        </script>
    </body>
</html>
```

---

## 6. API `GeoLeaf.Core.init(...)`

```typescript
interface GeoLeafCoreInitOptions {
    mapId: string;
    center: [number, number]; // [lat, lng] — GeoLeaf convention
    zoom: number;
    theme?: string;
    basemapId?: string;
    configUrl?: string;
    onReady?: (ctx: GeoLeafCoreContext) => void;
    onError?: (error: unknown) => void;
}

interface GeoLeafCoreContext {
    map: maplibregl.Map;
    baselayers?: unknown;
    ui?: unknown;
    config?: unknown;
}
```

> **Note:** the `map` type in the context is `maplibregl.Map`.

::: warning

`center` follows the **GeoLeaf** convention — `[lat, lng]`. It is the `coordinates` of a GeoJSON
feature that are `[lng, lat]`; the conversion is performed by the adapter.

:::

---

## 7. dist/ artefacts

Shape of the `dist/` directory after a build:

```
dist/
 ├─ geoleaf.esm.js          ← Main ESM bundle (CDN, bundlers)
 ├─ geoleaf-main.min.css    ← Minified styles (kernel + all in-core capabilities)
 ├─ chunks/                 ← Code-splitting chunks — REQUIRED, see below
 ├─ sw-core.js              ← Service worker — copied AS IS, never bundled
 ├─ geojson-worker.js       ← GeoJSON web worker — copied as is too
 ├─ esm/                    ← Granular ESM, one module per source file
 │   └─ bundle-esm-entry.js ← named-export entry (resolved by exports["."])
 └─ types/                  ← TypeScript declarations
```

::: warning

`sw-core.js` and `geojson-worker.js` are **workers**: they are not bundled but copied as is, and
loaded through a URL at runtime, never through an `import`. Neither of the two errors they cause
when absent looks like "a file is missing" — offline support simply stops working.

:::

::: danger

**`dist/chunks/` is part of the deliverable — self-hosting without it produces a dead
application.** `geoleaf.esm.js` **imports** those chunks: copying them is mandatory, not
optional. Their names carry a content hash and change on every build, so they are never listed by
hand — copy the directory.

:::

Two families of chunks live side by side there, and the distinction matters when optimising
loading:

- **Those the entry point imports statically** — loaded on every boot. They, and only they, are
  declared as `<link rel="modulepreload">` by `build-deploy.cjs` in the deployed page.
- **Those an `import()` fetches** — the `offline-engine`, the QR-code generator. Preloading them
  would fetch in advance exactly what their `import()` exists to defer.

To ship less, compose your own entry point from the `exports` subpaths (see `COOKBOOK.md`,
_Recipe 8_) — the rest is **tree-shaken**. The counts are not written here: `npm run size`
measures them.

### 7.1 — The PACKAGE `dist/` and the APPLICATION `dist/` are two different trees

The tree above is the one of the **npm package** (`packages/core/dist/`), the only one relevant to
the self-hosting described on this page. The deployable application (`npm run build:deploy:all`)
produces **another one**, and confusing the two is a trap:

|                                                        | `packages/core/dist/` (package) | `deploy/<variant>/dist/` (application)        |
| ------------------------------------------------------ | ------------------------------- | --------------------------------------------- |
| `esm/`, `types/`                                       | Yes                             | **No** — the app is not consumed by a bundler |
| Plugin bundles `geoleaf-*.plugin.js`                   | No                              | Yes — one per plugin embedded in the variant  |
| Lazy plugin chunks (`terra-draw`, `jspdf`, `gtfs-rt`…) | No                              | Yes                                           |
| Pre-compressed `.br` / `.gz` variants                  | No                              | Yes — **served first** by the server          |

::: warning

**The pre-compressed files are not decorative.** A server configured with `gzip_static` /
`brotli_static` serves the `.gz` or the `.br` **and ignores the `.js`**. Modifying a deployed file
without regenerating its compressed counterpart therefore returns the old content, silently — and
every check that reads the `.js` while the server serves the `.gz` will point at the wrong
culprit.

:::

::: warning

**The server must know the MIME type of `.mjs`** (`types { text/javascript mjs; }` on nginx).
MapLibre 6 is ESM-only and its global shim is a `.mjs`: served as `application/octet-stream`, the
browser **refuses to execute it** and nothing boots.

:::

---

## 8. API warnings

- Load **MapLibre GL JS before GeoLeaf** (peer dependency).
- Use **`<script type="module">`** — no classic script without `type="module"`.
- Do not mix a CDN ESM build and a local bundle.
- **Coordinates:** `Core.init({ center })` expects **`[lat, lng]`**. GeoJSON `coordinates` remain `[lng, lat]`.
- Version the CDN URLs explicitly (for example `@3.0.0`, not `@latest`).
- Plan a local fallback in production.

---

## 9. Integration checklist

- [ ] MapLibre GL JS CSS loaded
- [ ] MapLibre GL JS engine loaded (peer dependency)
- [ ] GeoLeaf CSS loaded
- [ ] GeoLeaf ESM imported (`type="module"`)
- [ ] `window.GeoLeaf` defined
- [ ] `Core.init()` available
- [ ] Map visible in the DOM (CSS height set)
- [ ] `center` in `[lat, lng]` form (GeoJSON `coordinates`, for their part, are `[lng, lat]`)
- [ ] CDN URLs versioned explicitly

---

## 10. Optional extensions

- **`@geoleaf-plugins/offline-ui`** — offline selection UI. **MIT**, published on **npmjs.org**. _(The offline engine itself — IndexedDB, cache, sync — has been part of the core since v3, behind the `modules.offline` gate.)_
- **`@geoleaf-plugins/editor`** — geometry editing and POI capture. **MIT** licence, published on npmjs.org.

For more information: [geoleaf.dev](https://geoleaf.dev).
