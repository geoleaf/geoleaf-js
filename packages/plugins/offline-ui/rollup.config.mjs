/*!
 * GeoLeaf Storage Plugin — Rollup Config
 * © 2026 Mattieu Pottier — MIT License
 */
import { pluginStack, readPackageJson } from "@geoleaf/build-config/rollup.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = readPackageJson(import.meta.url);

// ── Switch to `pluginStack` (06/08/2026) ────────────────────────
//
// This file carried an ARTISANAL stack: the only one of the fifteen packages not
// going through the common factory, hence the only one unable to receive `minify`
// via a flag. No written motive backed that exception — just the history of its
// repairs.
//
// The rebuilt stack is plugin-for-plugin equivalent (`nodeResolve` → `commonjs` →
// `replace` → `postcss` → `typescript` → `minify`), with two nuances documented
// below.
//
// ── What was DELETED, and must not come back ─────────────────────────────────────
//
// `coreSourceRedirectPlugin` did two things, both now moot:
//
//   1. `resolveId` resolved `@core-offline/*` to the core's SOURCES. The plugin
//      has no `@core*` import left: singletons go through `globalThis.GeoLeaf`,
//      `resolveProfileLayers` through the published subpath, `estimateVectorZone`
//      was moved here. (Its `modulesRoot` moreover pointed at a long-gone
//      directory.)
//
//   2. 🛑 `load()` transpiled EVERY `.ts` with `ts.transpileModule`. That hook is
//      what PREVENTED declaration emission: by returning the transpiled code
//      itself, it made the TypeScript plugin never see the files, hence emit no
//      `.d.ts`. Measured: 0 files in `dist/types/` while it was there. It
//      moreover masked a wrong `include` filter, since the filter no longer served
//      anything.
//
// ⚠️ **The ABSOLUTE `include` pattern is therefore load-bearing, and kept as-is.**
// Relative, the filter does not match `src/entry.ts` and rollup receives raw TS
// ("Expected ',', got '{'"). Without the `load()` hook to mask it, the error is
// frank — the right failure mode, not a reason to loosen the pattern.
export default {
    input: "src/entry.ts",
    plugins: pluginStack({
        resolve: { browser: true, extensions: [".ts", ".js"] },
        commonjs: true,
        version: pkg.version,
        pkg,
        css: true,
        typescript: {
            tsconfig: path.resolve(__dirname, "tsconfig.json"),
            include: [path.resolve(__dirname, "src/**/*.ts")],
        },
        minify: true,
    }),
    // ⚠️ `@geoleaf/core` is external: a NET, not a mechanism. After the decoupling
    // only type imports remain (erased) and the published subpath
    // `kernel/config/profile-layers.js`, which stays bundled — a PURE function
    // with no identity to share, and the browser has no import map to resolve a
    // bare specifier.
    external: [/^@geoleaf\/core$/],
    treeshake: { moduleSideEffects: true },
    output: {
        file: "dist/geoleaf-offline-ui.plugin.js",
        format: "es",
        // 🛑 The `output.banner` that lived here is DELETED, not moved — and its
        // story is worth reading before reintroducing one. It was complete,
        // correct, and it NEVER reached the deliverable: rollup prefixes the
        // banner before the `renderChunk` hooks, `minify()` is one, and its
        // `legalComments: "none"` removed it. This bundle started with
        // `var Xe=Object.defineProperty`. It was the repo's only package declaring
        // one, hence the only one giving the illusion of being covered.
        // The banner is now set by `licenseBanner()`, in `generateBundle`, hence
        // AFTER the minifier — and LIC-04 measures that it comes out instead of
        // believing it is declared.
        sourcemap: true,
        // The sources already travel in `src/` (files[]): embedding them a SECOND
        // time in the map is a pure duplicate.
        sourcemapExcludeSources: true,
    },
};

// ── The switch's two nuances, written rather than suffered ──────────────────────
//
// 1. `postcss` goes from `sourceMap: true` to `sourceMap: false` — the common
//    factory's setting, shared by the seven other CSS packages. The rollup
//    `output`'s `sourcemap: true` is kept: the JS map stays emitted.
//
// 2. The `onwarn` that only did `warn(warning)` was removed: it is rollup's
//    default behaviour, hence an effect-less indirection. Its comment said TS5096
//    must NOT be filtered there ("keeping it would have swallowed any future
//    TS5096") — deleting it makes that risk vanish with it.
