// postcss.config.mjs — ROOT config.
// GeoLeaf CSS Pipeline – Phase 3.3 / Phase 8.5.4
// Handles @import + aggressive minification
//
// Scope: the SINGLE PostCSS config of the monorepo. postcss-load-config
// walks up from each package, so this file serves all ten workspaces that use
// rollup-plugin-postcss — core, plugin-{addpoi,editor,geocoding,measure,print,
// storage,table}, field-renderer and _plugin-template.
//
// `packages/core/postcss.config.mjs` used to shadow it with a byte-identical
// copy; removed after checking the produced stylesheet is unchanged
// (same md5, 127 366 o). Do NOT reintroduce a per-package config without a real
// reason: the duplication was invisible, and only core was affected by it.
//
// ⚠️ `turbo.json` references this file as `$TURBO_ROOT$/postcss.config.mjs` in
// the `build`, `build:all` and `@geoleaf/core#build` inputs. Keep that prefix —
// a bare "postcss.config.mjs" resolves per package, so with no local copy it
// would match nothing and the build cache would stop being invalidated when this
// file changes (verified: editing it turns core's build from a cache replay into
// a rebuild).
//
// The `build` task carries it too, added at the audit: only `build:all`
// and `@geoleaf/core#build` had been repointed, but core is the sole workspace
// running `build:all` — the nine others (field-renderer, the seven plugins and
// _plugin-template) run plain `build` and so tracked NO PostCSS config at all,
// before or after the dedup. Editing this file left their cached CSS stale. The
// input is declared on the shared `build` task rather than per package: a few
// CSS-less workspaces rebuild for nothing when it changes, which is the cheap
// side of the trade — this file changes about once a year, a silently stale
// stylesheet does not announce itself.

import postcssImport from "postcss-import";
import cssnano from "cssnano";

export default {
    plugins: [
        postcssImport(),
        cssnano({
            preset: [
                "default",
                {
                    // Normalize whitespace and values
                    normalizeWhitespace: true,
                    // Deduplicate rules (reduces repetitions)
                    discardDuplicates: true,
                    // Remove comments
                    discardComments: { removeAll: true },
                    // Optimize numeric values
                    convertValues: true,
                    // Minify selectors
                    minifySelectors: true,
                    // Minify font declarations
                    minifyFontValues: true,
                    // Minify gradients
                    minifyGradients: true,
                    // Reduce transform properties
                    minifyParams: true,
                    // Inline SVG: minify
                    svgo: true,
                    // Reduce URLs
                    normalizeUrl: true,
                },
            ],
        }),
    ],
};
