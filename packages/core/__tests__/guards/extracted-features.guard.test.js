/**
 * Test-garde « feature absente du core » (S0 / 0.2).
 *
 * Reusable guard for the capability-extraction roadmap: once a capability is
 * extracted to a plugin, its IMPLEMENTATION must be fully gone from
 * `packages/core/src` (the roadmap's "grep core/src = 0" zero-residu rule). This
 * test fails the build if a future extraction leaves a residue behind.
 *
 * HOW EACH SPRINT EXTENDS IT: append one entry to EXTRACTED_FEATURES with the
 * feature's removed source `paths` and its implementation `tokens`. Use `allow`
 * for legitimate residual references — config-key strings (`modules.<id>.*`) and
 * dispatch registration stay in core by design and must NOT trip the guard.
 *
 * Seeded + validated on the two already-extracted plugins (geocoding, table).
 * Their extractions were clean: every source path is gone and no implementation
 * token remains (the sole mention of "geocoding"/"table" left in core is a doc
 * comment in capability.contract.ts citing the `modules.<id>` config path —
 * covered by `allow`).
 */
"use strict";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORE_SRC = path.resolve(__dirname, "../../src");

/** Recursively collect source files under `dir` (skip tests, node_modules, .d.ts). */
function collectSources(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "__tests__" || entry.name === "node_modules") continue;
            out.push(...collectSources(full));
        } else if (/\.(ts|js)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
            out.push(full);
        }
    }
    return out;
}

/**
 * Extracted features. One entry per plugin sortie from core.
 * - paths   : source paths (relative to packages/core/src) that MUST NOT exist.
 * - tokens  : implementation-signature regexes that MUST NOT match anywhere.
 * - allow   : line regexes that are legitimate (config-key / dispatch / doc) and
 *             are excluded before the token scan.
 */
const EXTRACTED_FEATURES = [
    {
        feature: "geocoding",
        paths: ["modules/optional/geocoding", "api/geoleaf.geocoding.ts", "lazy/geocoding.ts"],
        tokens: [
            /GeoLeaf\.Geocoding\b/,
            /\bGeocodingRegistry\b/,
            /\bgeocodingConfig\b/,
            /loadModule\(\s*["']geocoding["']\s*\)/,
            /optional\/geocoding/,
            /geoleaf\.geocoding/,
        ],
        allow: [/modules\.geocoding/],
    },
    {
        feature: "table",
        paths: ["modules/optional/table", "api/geoleaf.table.ts", "lazy/table.ts"],
        tokens: [
            /\btableConfig\b/,
            /GeoLeaf\.Table\b/,
            /loadModule\(\s*["']table["']\s*\)/,
            /optional\/table/,
            /geoleaf\.table/,
            /\bui\.showTable\b/,
        ],
        // `modules.table` config-key refs + the migration breadcrumb comment left
        // in bundle-esm-entry.ts ("export { Table } removed — use GeoLeaf.Table…").
        allow: [/modules\.table/, /export \{ Table \} removed/],
    },
    // NOTE (SR0, 2026-07-04): the two former `feature-info` guard specs were
    // removed when feature-info was RECLASSIFIED from an external plugin back into
    // an in-core capability (`packages/core/src/capabilities/feature-info/`). The
    // "extracted feature absent from core" contract no longer applies to it — its
    // implementation is intentionally in core now. (The taxonomy *capability* is
    // likewise in-core; S10 F5 adds a spec below for the removed *legacy* taxonomy.)
    {
        // RM-P0b (2026-07-04): purge of 4 dead public APIs — a straight deletion, not a
        // plugin extraction. Deleted files must stay gone; narrow tokens must not reappear.
        // Tokens are deliberately specific so they never match the live homonyms kept in
        // core (ThemeApplier engine, RouteLoaders.loadGeoJSON, filter-panel LazyLoader, …).
        feature: "rm-p0b-dead-apis",
        paths: [
            "kernel/themes/themes-api.ts",
            "api/geoleaf.themes.ts",
            "kernel/geojson/loader/data.ts",
            "utils/general/animation-helper.ts",
            "utils/general/event-helpers.ts",
            "utils/general/file-validator.ts",
            "utils/general/lazy-loader.ts",
        ],
        tokens: [
            /_g\.Themes\b/,
            /\bLegacyGeoJsonLayer\b/,
            /\bsetupDataDeps\b/,
            /\bgetAnimationHelper\b/,
            /utils\.LazyLoader\b/,
            /\bloadGPX\b/,
        ],
        allow: [],
    },
    {
        // S9 (2026-07-08): POI subsystem dissolution — the monolithic POI pipeline
        // (built-in/poi + GeoLeaf.POI facade + poi-source aggregate) is removed; a POI
        // is now a generic point layer (GeoLeaf.Layers) styled by taxonomy / cluster /
        // feature-info. Tokens target the dead data-pipeline surface only, so they never
        // match the intentional adapter survivors (`poisToFeatureCollection` removed;
        // `registerSpriteIcons` kept) nor the addpoi plugin seam (migrated to
        // `GeoLeaf.AddPOI`). (`TaxonomyManager` removal landed in S10 F5 — see the
        // `taxonomy-unification` spec below.)
        feature: "poi-dissolution",
        paths: [
            "kernel/poi",
            "api/geoleaf.poi.ts",
            "globals/globals.poi.ts",
            "app/boot-modules/poi.module.ts",
            "kernel/shared/poi-state.ts",
            "lazy/poi-core.ts",
            "lazy/poi-extras.ts",
            "contracts/poi-core.contract.ts",
            "contracts/poi-display.contract.ts",
        ],
        tokens: [
            /GeoLeaf\.POI\b/,
            /\bPOICoreContract\b/,
            /\b_POICore\b/,
            /\bresolveCategoryDisplay\b/,
            /\bgetAllPois\b/,
            /poi-source/,
        ],
        allow: [],
    },
    {
        // S6 (2026-07-08): the dead flexsearch full-text engine was PURGED — a straight
        // deletion, not an extraction (0 consumer, never wired at runtime; UI text search
        // lives in the in-core `capabilities/filter` substring path). Tokens target the
        // engine's own implementation signatures only, so they never match the live filter
        // homonyms kept in core: `searchFields` / `searchText` / `pill-search` /
        // `window.location.search` / i18n `aria.search.*`. No `allow` needed — the
        // bundle-esm-entry breadcrumb is worded without any of these tokens.
        feature: "search-engine",
        paths: [
            "modules/optional/search",
            "api/geoleaf.search.ts",
            "lazy/search.ts",
            "app/boot-modules/search.module.ts",
        ],
        tokens: [
            /GeoLeaf\.Search\b/,
            /\bSearchRegistry\b/,
            /\bSearchModule\b/,
            /loadModule\(\s*["']search["']\s*\)/,
            /optional\/search/,
            /geoleaf\.search/,
            /\bflexsearch\b/,
            /\bui\.showSearch\b/,
        ],
        allow: [],
    },
    {
        // S10 F5 (2026-07-11): taxonomy unification — the legacy `TaxonomyManager`
        // (kernel/config/taxonomy.ts) + the filter's transitional
        // `taxonomy-source.ts` seam are removed; legend + filter + the POI icon
        // injector now read the in-core taxonomy capability (`GeoLeaf.Taxonomy`).
        // Tokens target the removed legacy surface only — NOT the kept capability
        // (`getCategories(ref)` on public-api.ts / `GeoLeaf.Taxonomy.getCategories`)
        // nor legend-api's own `_loadTaxonomy` (reads `modules.taxonomy`). The legacy
        // `getIconsConfig` + profile-loader `_loadTaxonomy` are removed in Lot 2 — see
        // the `taxonomy-legacy` spec below.
        feature: "taxonomy-unification",
        paths: ["kernel/config/taxonomy.ts", "capabilities/filter/taxonomy-source.ts"],
        tokens: [/\bTaxonomyManager\b/, /Config\.getCategories\b/, /taxonomy-source/],
        allow: [],
    },
    {
        // Taxonomy v3 (2026-07-14): the "painter" is gone. `applyToLayer` +
        // `expression-builder` + `TaxonomyLifecycle` + `TaxonomyModule` painted
        // `fill-color`/`line-color` from a category table — and never ran ONCE, because
        // the opt-in gate read a profile key that only loads after the gate. Geometry
        // colour belongs to each layer's `styleRules`; taxonomy now owns the point
        // SYMBOL, purely pull-based (no module, no lifecycle). `forceConfig` went with
        // it (its only client), as did `utils/helpers/style-resolver.ts` — an
        // orphan public API with zero production callers that hard-coded
        // `properties.categoryId`.
        //
        // ⚠ Two names are deliberately NOT tokens, because they have LIVE homonyms and
        // would fail this guard on a healthy tree:
        //   - `applyToLayer` → `capabilities/route/apply.ts` exports one.
        //   - `colorStroke`  → the dormant `gl-poi-*` renderer reads it off features
        //     (`maplibre-poi-builders.ts`), which has nothing to do with the taxonomy
        //     category table this guard is about.
        // A token has to be unique to the dead surface, or the guard is just noise.
        feature: "taxonomy-painter",
        paths: [
            "capabilities/taxonomy/apply.ts",
            "capabilities/taxonomy/expression-builder.ts",
            "capabilities/taxonomy/lifecycle.ts",
            "app/boot-modules/taxonomy.module.ts",
            "utils/helpers/style-resolver.ts",
        ],
        tokens: [
            /\bTaxonomyLifecycle\b/,
            /\bTaxonomyModule\b/,
            /\bbuildColorMatch\b/,
            /\bforceConfig\b/,
            /\bresolvePoiColors\b/,
            /\bgetColorsFromLayerStyle\b/,
        ],
        allow: [],
    },
    {
        // S11 (2026-07-11): Route module dissolved into the in-core `route` capability
        // (endpoint decorator, gate `modules.route`) under `capabilities/route/`. The
        // legacy optional module + `GeoLeaf.Route` facade + `RouteContract` + the
        // `_Route*` globals + the `lazy/route` chunk are removed; itinerary lines are
        // generic GeoJSON layers, endpoints derived by the capability. Tokens are narrow
        // so they never match the live survivors kept in core: `convertRouteArrayToGeoJSON`
        // (data-converter), (`filterRouteList` / `GeoLeaf.Filters` was also listed here until
        // the public-API review removed it — it is no longer a survivor, it is gone),
        // `--gl-color-route-*` (theme tokens), or the new `capabilities/route/` files.
        feature: "route-dissolution",
        paths: [
            "modules/optional/route",
            "api/geoleaf.route.ts",
            "api/geoleaf.route-lite.ts",
            "contracts/route.contract.ts",
            "lazy/route.ts",
        ],
        tokens: [
            /GeoLeaf\.Route\b/,
            /\bRouteContract\b/,
            /\b_RouteLayerManager\b/,
            /\b_RouteLoaders\b/,
            /\b_RouteStyleResolver\b/,
            /optional\/route/,
            /geoleaf:route:loaded/,
        ],
        // `modules.route` config-key refs (the new capability) + the migration
        // breadcrumb in bundle-esm-entry.ts ("export { Route } removed …").
        allow: [/modules\.route/, /export \{ Route \} removed/],
    },
    {
        // Lot 2 (2026-07-11): removal of the LEGACY taxonomy path deferred at S10 F5.
        // Gone: the separate `config/core/taxonomy.json` file (profile data, not src),
        // `Config.getIconsConfig` / `ProfileManager.getIconsConfig`, the profile-loader
        // `_loadTaxonomy` thread + `Files.taxonomyFile`, `_applyTaxonomyCategories` +
        // `Config.categories`, and the dead `populateSelectOptionsFromTaxonomy` public
        // API. The taxonomy capability (`modules.taxonomy`, `GeoLeaf.Taxonomy.getIcons`
        // / `getCategories`) is the sole source. Tokens are narrow so they never match
        // the live survivors: `modules.taxonomy`, `getTaxonomyConfig`, `Taxonomy.getIcons`,
        // the adapter's `_getTaxonomyIcons`, or legend-api's own `_loadTaxonomy`.
        feature: "taxonomy-legacy",
        paths: [],
        tokens: [
            /getIconsConfig/,
            /\btaxonomyFile\b/,
            /_applyTaxonomyCategories/,
            /populateSelectOptionsFromTaxonomy/,
        ],
        allow: [],
    },
    {
        // 2026-07-13: PWA implementation co-located under the `pwa` capability. The
        // install-prompt orchestration (PWAManager + InstallPrompt + IosBanner) moved
        // from `kernel/pwa/` to `capabilities/pwa/`, so the capability now owns
        // its whole body (declaration + lifecycle + impl). This is a RELOCATION, not an
        // extraction — the `PWAManager` / `InstallPrompt` tokens legitimately live on
        // under `capabilities/pwa/` — hence a path-only guard (empty tokens). The unified
        // service worker (`built-in/storage/sw-register.ts` + `sw-core.js`) stays kernel
        // by design (target architecture lists the SW as core plumbing).
        feature: "pwa-colocation",
        paths: ["kernel/pwa"],
        tokens: [],
        allow: [],
    },
];

describe("test-garde — extracted features are absent from packages/core/src", () => {
    const files = collectSources(CORE_SRC);
    const contents = files.map((f) => [path.relative(CORE_SRC, f), fs.readFileSync(f, "utf8")]);

    // STRUCT S7 — non-vacuity. Every assertion below is a NEGATIVE one ("this path is
    // gone", "this token matches nowhere"): they all pass trivially against an empty
    // corpus. A wrong CORE_SRC that happens to resolve to an existing-but-wrong
    // directory would therefore turn this guard GREEN while it checks nothing —
    // the one failure mode a `resolve()` fix cannot prevent. `readdirSync` throws
    // ENOENT on a path that does not exist at all, so only this covers the rest.
    // The floor is deliberately far below the real count (846 .ts in core at the time
    // of writing): it must catch "scanned nothing", not track the codebase size.
    it("the scan actually reached the core sources", () => {
        expect(files.length).toBeGreaterThan(200);
    });

    for (const spec of EXTRACTED_FEATURES) {
        describe(spec.feature, () => {
            it("source paths are removed from core", () => {
                for (const rel of spec.paths) {
                    const abs = path.join(CORE_SRC, rel);
                    expect(fs.existsSync(abs), `${rel} should be gone from packages/core/src`).toBe(
                        false
                    );
                }
            });

            it("no implementation tokens remain (config-key refs allowlisted)", () => {
                const hits = [];
                for (const [rel, code] of contents) {
                    code.split(/\r?\n/).forEach((line, i) => {
                        if (spec.allow.some((rx) => rx.test(line))) return;
                        if (spec.tokens.some((rx) => rx.test(line))) {
                            hits.push(`${rel}:${i + 1}  ${line.trim()}`);
                        }
                    });
                }
                expect(
                    hits,
                    `Residual ${spec.feature} implementation in core:\n${hits.join("\n")}`
                ).toEqual([]);
            });
        });
    }
});
