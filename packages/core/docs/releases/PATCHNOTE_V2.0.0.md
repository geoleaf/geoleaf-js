---
title: "GeoLeaf v2.0.0 — Release Notes"
description: "Full v2.0.0 release notes — MapLibre GL JS migration, ESM-only, @geoleaf/connector"
---

# GeoLeaf V2.0.0 release notes

**Version:** 2.0.0
**Release date:** 2026-03-22
**Comparison:** `v1.2.0` → `v2.0.0`
**Branch:** `main`

---

## Breaking Changes

This version introduces a major migration of the rendering engine (Leaflet → MapLibre GL JS v5). The breaking changes are detailed below.

### Rendering engine

- **Leaflet 1.9.4 → MapLibre GL JS ^5.0.0**: the rendering engine moves from DOM/SVG/Canvas to WebGL on the GPU. Performance characteristics are fundamentally different (GPU clustering, native vector tiles, data-driven expressions).
- **Reversed coordinate convention**: `[lat, lng]` (Leaflet) → `[lng, lat]` (GeoJSON/MapLibre standard). Every coordinate passed to the API must be adapted.
- **Peer dependency**: remove `leaflet` and `leaflet.markercluster`, add `maplibre-gl@^5.0.0`.

### npm package

- **Scope renamed**: `geoleaf` → `@geoleaf/core` (consumer projects may need to update the name in their `package.json`).
- **UMD removed**: no UMD CJS bundle is available. ESM only. Any load through a classic `<script>` must migrate to `<script type="module">`.

### Application configuration

- **`container:` → `mapId:`**: the initialisation key holding the map container ID is renamed.
- **`sidepanel` → `sidepanelConfig`**: canonical key for the side panel configuration in JSON profiles. The `sidepanel` key is still accepted on read (backwards-compatible fallback), but `sidepanelConfig` is now the reference.
- **`useProfilePoiMapping`, `useMapping`, `GeoLeafConfig.geojson`** removed from the TypeScript interfaces (the runtime fallback logic is kept for existing profiles).

### Public API

- **`applyTheme(theme)`** → **`applyTheme(layerId, themeId)`**: signature changed, with an added target `layerId` parameter.

### CSS

- The engine's `.leaflet-*` classes are replaced by `.maplibregl-*` (MapLibre). Internal GeoLeaf classes are all prefixed `.gl-*` (full isolation).
- `.geoleaf-ctrl-scale` / `.geoleaf-ctrl-scale-line` replaced by `.gl-scale-graphic` / `.gl-scale-graphic-line`.

### TypeScript

- **`SecureCookieOptions.secure`**: default value changed in the CSRF module (see `csrf-token.ts` — breaking change documented in TSDoc).

---

## Added

### Rendering engine — MapLibre GL JS v5

- **`MaplibreAdapter`**: complete implementation of `IMapAdapter` (33 methods) across 7 dedicated files, replacing `LeafletAdapter` in every runtime context:
    - `maplibre-adapter.ts` — map core, navigation (setView, panTo, flyTo, fitBounds), event bridge (`geoleaf:map:ready/move/zoom`), markers, clustering, popups, controls, destroy() cleanup
    - `maplibre-helpers.ts` — `bindGeoJSONClusterEvents()`, `addSubLayers()`, `detectGeometryTypes()`, `safeBeforeId()`
    - `maplibre-hatch-patterns.ts` — Canvas generation of 6 hatch types (diagonal, dot, cross, x, horizontal, vertical) through `OffscreenCanvas`, registered with `map.addImage()` for `fill-pattern`
    - `maplibre-poi-icons.ts` — `registerSpriteIcons()` converts each SVG sprite `<symbol>` into `ImageData` (48×48 px, pixelRatio 2), registered through `map.addImage()`
    - `maplibre-style-converter.ts` — `normalizeToFlat()`, `toFillPaint()`, `toLinePaint()`, `toCirclePaint()`, `toClusterCirclePaint()`, `toRouteLinePaint()`, `conditionToExpression()` (16 operators), data-driven `["case", ...]` expressions, zoom interpolation
    - `maplibre-layer-registry.ts` — GeoLeaf source/layer registry, z-index ordering, POI sentinel, `toSourceId()`, `toSubLayerId()`, `getInsertBeforeId()`
    - `maplibre-poi-renderer.ts` — clustered GeoJSON source (`cluster: true`), 4 stacked GPU layers (cluster circles, cluster-count symbols, unclustered circles, unclustered icon symbols), `applyPoiFilter()`, `poisToFeatureCollection()`
- **GeoJSON source/layer model**: 1 source `gl-src-{id}` + N sub-layers (`gl-{id}-fill`, `gl-{id}-line`, `gl-{id}-circle`) per GeoLeaf layer
- **Native MVT/PBF vector tiles**: `vector-tiles.ts` rewritten — native `map.addSource({type:'vector'})` + `map.addLayer()`, data-driven `fill-pattern`
- **MapLibre symbol layer labels**: `LabelRenderer.createSymbolLayerForMapLibre()` — native layer on the existing GeoJSON source (field, font, colour, buffer/halo), font stack resolved dynamically from `map.getStyle()`
- **CI gate `verify-no-leaflet.cjs`**: automatic scanning script (6 categories: runtime, imports, globals, branching, JSDoc, config), final result **ZERO LEAFLET REFERENCES**

### New package — `@geoleaf/connector` v1.0.0 (MIT, public npm)

- **Universal fetch interceptor** for authenticated geospatial sources (GeoJSON, WFS, vector tiles, FlatGeobuf, PMTiles, OGC API Features)
- 6 modules: `config-schema.ts`, `format-detector.ts`, `token-store.ts`, `fetch-interceptor.ts`, `auth-client.ts`, `login-ui.ts`
- **`__GEOLEAF_WORKER_HEADERS_HOOK__` hook**: optional core↔connector coupling without breaking `no-plugin-in-core`
- 105 tests, `CONNECTOR_GUIDE.md` documentation

### Basemaps

- **CARTO tiles**: positron, dark-matter and voyager added to `DEFAULT_BASELAYERS`
- **ESRI Street** replaces standard OpenStreetMap
- **`normalizeTilesArray()`**: `{s}` subdomain expansion (string/array) + `pmtiles://` support
- `BasemapConfig` extended: `tiles?: string[]` and `tileSize?: number` fields

### Performance and monitoring

- **Performance marks**: `_pm()` helper in `boot.ts` and `init.ts` — 8 pairs of marks gated on `window.__GEOLEAF_PERF__ = true`
- **Deferred UI init**: Legend, LayerManager, Scale, Labels and CoordinatesDisplay moved into a `geoleaf:app:ready` listener with `{ once: true }` — improved TTI

### TypeScript architecture

- **`lazy-module-loader.ts`**: `LazyModuleName`, `loadModule()` and `loadAllSecondaryModules()` extracted from `bundle-esm-entry.ts` — zero `any`, zero `@ts-nocheck`
- **`loader-types.ts`**: 13 service-locator interfaces, `LoaderDependencies` with 17 getters — replaces 69 occurrences of `(_g as any).GeoLeaf.*`
- **Enriched contracts**: `content-builder.contract.ts`, `ui-controls.contract.ts`, `api.contract.ts`, `map-adapter.contract.ts`

### Security

- **Complete CSRF module** (`csrf-token.ts`): `init`, `getToken`, `validateToken`, `addTokenToHeaders`, `rotateToken`, `getTokenInfo`, `setSecureCookie`, `destroy`
- **`DOMSecurity.setSafeHTML()`** used systematically — SVG-only allowlist
- **`CSS.escape()`** applied to the POI ID in the popup querySelector (CSS selector injection prevention)
- **Login modal** (`login-ui.ts`): no user data exposed through `innerHTML`, focus trap, Escape handler

### CSS accessibility (WCAG 2.1 / RGAA 4.1)

- **`@media (prefers-reduced-motion: reduce)`** in `geoleaf-mobile-toolbar.css` (WCAG 2.3.3)
- **`:focus-visible`** replaces `:focus` in 5 CSS files
- **`.gl-search-bar:focus-within`**: visible focus ring (WCAG 2.4.7)
- **`aria-label` + `role="img"`** on MapLibre markers (keyboard navigation)

---

## Changed

### Leaflet → MapLibre GL JS migration

- All `L.*` calls removed from the core source — blocking CI gate `verify-no-leaflet.cjs`
- `L.Control.extend()` → plain objects with `addTo(map)/remove()` in every control
- `L.DomEvent.*` → native DOM (`addEventListener`, `stopPropagation`, capture phase)
- CSS classes `leaflet-control-*` → `gl-control-*`

### Build and distribution

- **UMD removed**: 3 ESM outputs — full chunked bundle (`dist/esm/`), preserveModules, lite (`dist/esm-lite/`)
- `packages/core/package.json` v2.0.0: ESM-only `exports`, `peerDependencies` → `maplibre-gl: ^5.0.0`

### Test infrastructure — Jest → Vitest 3

- **Jest fully removed**: 10 configuration files plus dependencies dropped
- **Vitest 3** in workspace mode, with the `@vitest/coverage-istanbul` provider
- Coverage thresholds: `branches: 75, functions: 68, lines: 70, statements: 70`

### Strict TypeScript

- **30 `@ts-nocheck` removed** through type contracts (api/, ui/controls/, ui/content-builder/, loader-types.ts)
- `tsc --noEmit --strict` kept at 0 errors

### Dead code — Knip

- **7 orphan files removed**, **172 dead exports removed**

---

## Fixed

- **Basemap z-ordering**: raster rendered above the data layers — fixed with `addLayer(spec, firstLayerId)`
- **Root-level style selector**: `_applyStyleResult()` extracts `(styleData).style ?? styleData` before `normalizeToFlat()`
- **MapLibre GeoJSON filters**: `_applyFeatureVisibilityForLayer()` — new `updateLayerData()` path added
- **Native clustering**: the `cluster/clusterRadius/clusterMaxZoom` options were not propagated to the GeoJSON source
- **Empty side panel**: `normalizeFromGeoJSON` runs `JSON.parse(props.attributes)` when `typeof props.attributes === "string"`
- **Invisible graphic scale**: the `.gl-scale-graphic` classes were missing from the CSS rules
- **Label glyph 404s**: `_resolveMapFontStack()` with the `["Noto Sans Regular", "Arial Unicode MS Bold"]` fallback
- **Zoom visibility**: `_applyThemeLayers()` calls `_reapplyZoomVisibility()` after applying the theme
- **Immediate UI filters**: `applyFiltersNow()` in `attachCategoryTreeListeners()` and `attachTagsListeners()`
- **Clustering corruption after filtering**: `POI.setFilteredDisplay()` no longer clobbers `state.allPois`
- **Orphan tooltips**: explicit `hoverPopup.remove()` at the start of every `mouseenter`
- **Data-driven styleRules**: `conditionToExpression()` strips the `"properties."` prefix — 5 layers fixed
- **Dot hatch pattern with styleRules**: `collectHatchPatterns()` registers the patterns before `addLayer()`
- **Dark cluster text contrast**: `#e5e7eb` → `#111827` (ratio 1.83:1 → 7.86:1, WCAG AAA)

---

## Tests and quality

| Stage | Scope                                            | Result                      |
| ----- | ------------------------------------------------ | --------------------------- |
| T1–T5 | Jest → Vitest 3 migration                        | 10 Jest configs removed     |
| T6    | UI + integration/controls/basemap/legend/storage | 0 regressions               |
| T7    | +223 MapLibre tests (4 new suites)               | 284 files, 6,403 tests      |
| T8    | V8 → Istanbul, `require()` imports → ESM         | real thresholds unblocked   |
| T9    | Module-by-module coverage                        | 323 files, ~7,800 tests     |
| T10   | Target of 75% branches reached                   | **8,317 tests, 0 failures** |

### Final coverage (Istanbul)

| Metric     | v1.2.0 | v2.0.0     |
| ---------- | ------ | ---------- |
| Suites     | 280    | **323**    |
| Tests      | 6,149  | **8,317**  |
| Statements | 89.49% | **87.82%** |
| Branches   | 85.08% | **77.97%** |
| Functions  | —      | **84.89%** |
| Lines      | —      | **87.82%** |

---

## Performance — Baselines

| Metric          | v1.x (Leaflet) | v2.0.0 (MapLibre)   |
| --------------- | -------------- | ------------------- |
| UMD bundle      | 196 KB gzip    | Removed             |
| ESM bundle gzip | 35 KB          | ~35 KB              |
| ESM lite        | —              | ~84 KB              |
| CSS total       | —              | 151 KB / 22 KB gzip |
| 10,000 markers  | 4 FPS (DOM)    | **60 FPS** (GPU)    |
| 10,000 GeoJSON  | 572 ms         | **< 100 ms** WebGL  |
| TTI             | < 0.5 s        | < 0.5 s             |

---

## Summary

- **Breaking engine change**: Leaflet 1.9.4 → MapLibre GL JS v5. WebGL rendering, native GPU clustering, MVT/PBF, data-driven expressions. See the detailed breaking changes above.
- **New MIT package**: `@geoleaf/connector` v1.0.0 — universal fetch interceptor, published on npmjs.org.
- **ESM-only distribution**: the UMD bundle is removed for good. 3 ESM outputs.
- **Modernised tests**: Vitest 3 + Istanbul, **8,317 tests**, 77.97% branch coverage.
- **100% strict TypeScript**: 30 `@ts-nocheck` removed, 0 errors from `tsc --noEmit --strict`.
- **Complete documentation**: VitePress site `geoleaf.dev/docs/`, 62+ guides updated.
