---
title: "GeoLeaf v2.0.0 — Release Notes"
description: "Notes de release complètes v2.0.0 — Migration MapLibre GL JS, ESM-only, @geoleaf/connector"
---

# Patchnote GeoLeaf V2.0.0

**Version:** 2.0.0
**Date de release:** 2026-03-22
**Comparaison:** `v1.2.0` → `v2.0.0`
**Branche:** `main`

---

## ⚠️ Breaking Changes

Cette version introduit une migration majeure du moteur de rendu (Leaflet → MapLibre GL JS v5). Les changements cassants sont détaillés ci-dessous.

### Moteur de rendu

- **Leaflet 1.9.4 → MapLibre GL JS ^5.0.0** : le moteur de rendu passe du DOM/SVG/Canvas au WebGL GPU. Les performances sont fondamentalement différentes (GPU clustering, vector tiles natif, expressions data-driven).
- **Convention de coordonnées inversée** : `[lat, lng]` (Leaflet) → `[lng, lat]` (GeoJSON/MapLibre standard). Toutes les coordonnées passées à l'API doivent être adaptées.
- **Peer dependency** : supprimer `leaflet` et `leaflet.markercluster`, ajouter `maplibre-gl@^5.0.0`.

### Package npm

- **Scope renommé** : `geoleaf` → `@geoleaf/core` (le nom peut nécessiter une mise à jour dans `package.json` des projets consommateurs).
- **UMD supprimé** : aucun bundle UMD CJS disponible. Uniquement ESM. Tout chargement via `<script>` classique doit migrer vers `<script type="module">`.

### Configuration applicative

- **`container:` → `mapId:`** : la clé d'initialisation de l'ID du conteneur carte est renommée.
- **`sidepanel` → `sidepanelConfig`** : clé canonique pour la config side panel dans les profils JSON. La clé `sidepanel` reste acceptée en lecture (fallback rétrocompat) mais `sidepanelConfig` est désormais la référence.
- **`useProfilePoiMapping`, `useMapping`, `GeoLeafConfig.geojson`** supprimés des interfaces TypeScript (la logique runtime de fallback est conservée pour les profils existants).

### API publique

- **`applyTheme(theme)`** → **`applyTheme(layerId, themeId)`** : signature changée, ajout du paramètre `layerId` cible.

### CSS

- Les classes `.leaflet-*` du moteur sont remplacées par `.maplibregl-*` (MapLibre). Les classes GeoLeaf internes sont toutes préfixées `.gl-*` (isolation complète).
- `.geoleaf-ctrl-scale` / `.geoleaf-ctrl-scale-line` remplacées par `.gl-scale-graphic` / `.gl-scale-graphic-line`.

### TypeScript

- **`SecureCookieOptions.secure`** : valeur par défaut changée dans le module CSRF (cf. `csrf-token.ts` — breaking documented en TSDoc).

---

## Added (Ajouté)

### Moteur de rendu — MapLibre GL JS v5 (Sprints 2–9)

- **`MaplibreAdapter`** : implémentation complète de `IMapAdapter` (33 méthodes) en 7 fichiers dédiés, remplaçant `LeafletAdapter` dans tous les contextes runtime :
    - `maplibre-adapter.ts` — map core, navigation (setView, panTo, flyTo, fitBounds), bridge événements (`geoleaf:map:ready/move/zoom`), markers, clustering, popups, controls, cleanup destroy()
    - `maplibre-helpers.ts` — `bindGeoJSONClusterEvents()`, `addSubLayers()`, `detectGeometryTypes()`, `safeBeforeId()`
    - `maplibre-hatch-patterns.ts` — génération Canvas de 6 types de hatch (diagonal, dot, cross, x, horizontal, vertical) via `OffscreenCanvas`, enregistrement `map.addImage()` pour `fill-pattern`
    - `maplibre-poi-icons.ts` — `registerSpriteIcons()` convertit chaque `<symbol>` SVG sprite en `ImageData` (48×48 px, pixelRatio 2), registered via `map.addImage()`
    - `maplibre-style-converter.ts` — `normalizeToFlat()`, `toFillPaint()`, `toLinePaint()`, `toCirclePaint()`, `toClusterCirclePaint()`, `toRouteLinePaint()`, `conditionToExpression()` (16 opérateurs), expressions data-driven `["case", ...]`, zoom interpolation
    - `maplibre-layer-registry.ts` — registre source/layers GeoLeaf, ordering par z-index, sentinelle POI, `toSourceId()`, `toSubLayerId()`, `getInsertBeforeId()`
    - `maplibre-poi-renderer.ts` — source GeoJSON clusterisée (`cluster: true`), 4 layers GPU empilés (clusters circle, cluster-count symbol, unclustered circle, unclustered icons symbol), `applyPoiFilter()`, `poisToFeatureCollection()`
- **Modèle source/layer GeoJSON** : 1 source `gl-src-{id}` + N sub-layers (`gl-{id}-fill`, `gl-{id}-line`, `gl-{id}-circle`) par couche GeoLeaf
- **MVT/PBF vector tiles natifs** : `vector-tiles.ts` réécrit — `map.addSource({type:'vector'})` + `map.addLayer()` MapLibre natif, `fill-pattern` data-driven
- **Symbol layer labels MapLibre** : `LabelRenderer.createSymbolLayerForMapLibre()` — layer natif sur source GeoJSON existante (field, font, color, buffer/halo), résolution dynamique du font stack depuis `map.getStyle()`
- **Gate CI `verify-no-leaflet.cjs`** : script de scan automatique (6 catégories : runtime, imports, globals, branching, JSDoc, config), résultat final **ZERO LEAFLET REFERENCES**

### Nouveau package — `@geoleaf/connector` v1.0.0 (MIT, npm public)

- **Intercepteur fetch universel** pour sources géospatiales authentifiées (GeoJSON, WFS, vector tiles, FlatGeobuf, PMTiles, OGC API Features)
- 6 modules : `config-schema.ts`, `format-detector.ts`, `token-store.ts`, `fetch-interceptor.ts`, `auth-client.ts`, `login-ui.ts`
- **Hook `__GEOLEAF_WORKER_HEADERS_HOOK__`** : couplage optionnel core↔connector sans violer `no-plugin-in-core`
- 105 tests, documentation `CONNECTOR_GUIDE.md` — à cette date dans `packages/core/docs/` ; déménagée
  le 10/08/2026 dans le paquet du plugin (`packages/plugins/connector/docs/`). Le lien de la note
  n'est pas ré-écrit vers la nouvelle adresse : une note de version dit où se trouvait le document
  **à sa date**, elle ne suit pas les déménagements ultérieurs

### Basemaps

- **CARTO tiles** : positron, dark-matter, voyager ajoutés à `DEFAULT_BASELAYERS`
- **ESRI Street** remplace OpenStreetMap standard
- **`normalizeTilesArray()`** : expansion `{s}` subdomains (string/array) + support `pmtiles://`
- `BasemapConfig` étendu : champs `tiles?: string[]` et `tileSize?: number`

### Performance & Monitoring

- **Performance marks** : `_pm()` helper dans `boot.ts` et `init.ts` — 8 paires de marks gateés sur `window.__GEOLEAF_PERF__ = true`
- **Deferred UI init** : Legend, LayerManager, Scale, Labels, CoordinatesDisplay déplacés dans un listener `geoleaf:app:ready` `{ once: true }` — TTI amélioré

### Architecture TypeScript

- **`lazy-module-loader.ts`** : `LazyModuleName`, `loadModule()`, `loadAllSecondaryModules()` extraites de `bundle-esm-entry.ts` — zero `any`, zero `@ts-nocheck`
- **`loader-types.ts`** : 13 interfaces service locator, `LoaderDependencies` avec 17 getters — remplace 69 occurrences `(_g as any).GeoLeaf.*`
- **Contracts enrichis** : `content-builder.contract.ts`, `ui-controls.contract.ts`, `api.contract.ts`, `map-adapter.contract.ts`

### Sécurité

- **Module CSRF complet** (`csrf-token.ts`) : `init`, `getToken`, `validateToken`, `addTokenToHeaders`, `rotateToken`, `getTokenInfo`, `setSecureCookie`, `destroy`
- **`DOMSecurity.setSafeHTML()`** systématique — whitelist SVG-only
- **`CSS.escape()`** sur POI ID dans le querySelector popup (prévention injection CSS selector)
- **Login modal** (`login-ui.ts`) : aucune exposition de données user dans `innerHTML`, focus trap, Escape handler

### Accessibilité CSS (WCAG 2.1 / RGAA 4.1)

- **`@media (prefers-reduced-motion: reduce)`** dans `geoleaf-mobile-toolbar.css` (WCAG 2.3.3)
- **`:focus-visible`** remplace `:focus` dans 5 fichiers CSS
- **`.gl-search-bar:focus-within`** : ring de focus visible (WCAG 2.4.7)
- **`aria-label` + `role="img"`** sur les markers MapLibre (navigation clavier)

---

## Changed (Modifié)

### Migration Leaflet → MapLibre GL JS

- Tous les appels `L.*` supprimés du code source core — gate CI `verify-no-leaflet.cjs` bloquant
- `L.Control.extend()` → plain objects avec `addTo(map)/remove()` dans tous les contrôles
- `L.DomEvent.*` → DOM natif (`addEventListener`, `stopPropagation`, capture phase)
- CSS classes `leaflet-control-*` → `gl-control-*`

### Build & Distribution

- **UMD supprimé** : 3 sorties ESM — bundle full chunked (`dist/esm/`), preserveModules, lite (`dist/esm-lite/`)
- `packages/core/package.json` v2.0.0 : `exports` ESM-only, `peerDependencies` → `maplibre-gl: ^5.0.0`

### Infrastructure de tests — Jest → Vitest 3 (Sprints T1–T5)

- **Jest entièrement supprimé** : 10 fichiers de configuration + dépendances retirées
- **Vitest 3** avec workspace mode, provider `@vitest/coverage-istanbul`
- Seuils couverture : `branches: 75, functions: 68, lines: 70, statements: 70`

### TypeScript strict (Sprints R1–R4)

- **30 `@ts-nocheck` supprimés** par contrats de types (api/, ui/controls/, ui/content-builder/, loader-types.ts)
- `tsc --noEmit --strict` 0 erreur maintenu

### Dead code — Knip

- **7 fichiers orphelins supprimés**, **172 exports morts supprimés**

---

## Fixed (Corrections)

- **Basemap z-ordering** : raster s'affichait au-dessus des couches data — fix `addLayer(spec, firstLayerId)`
- **Style selector niveau racine** : `_applyStyleResult()` extrait `(styleData).style ?? styleData` avant `normalizeToFlat()`
- **Filtres GeoJSON MapLibre** : `_applyFeatureVisibilityForLayer()` — nouveau chemin `updateLayerData()` ajouté
- **Clustering natif** : options `cluster/clusterRadius/clusterMaxZoom` non propagées à la source GeoJSON
- **Side panel vide** : `normalizeFromGeoJSON` parse `JSON.parse(props.attributes)` quand `typeof props.attributes === "string"`
- **Échelle graphique invisible** : classes `.gl-scale-graphic` absentes des règles CSS
- **Labels glyphs 404** : `_resolveMapFontStack()` avec fallback `["Noto Sans Regular", "Arial Unicode MS Bold"]`
- **Visibilité zoom** : `_applyThemeLayers()` appelle `_reapplyZoomVisibility()` après application du thème
- **Filtres UI immédiats** : `applyFiltersNow()` dans `attachCategoryTreeListeners()` et `attachTagsListeners()`
- **Corruption clustering post-filtrage** : `POI.setFilteredDisplay()` ne crase plus `state.allPois`
- **Tooltips orphelins** : `hoverPopup.remove()` explicite au début de chaque `mouseenter`
- **StyleRules data-driven** : `conditionToExpression()` supprime le préfixe `"properties."` — 5 couches corrigées
- **Hachures dot pattern + styleRules** : `collectHatchPatterns()` enregistre les patterns avant `addLayer()`
- **Contraste texte cluster sombre** : `#e5e7eb` → `#111827` (ratio 1.83:1 → 7.86:1, WCAG AAA)

---

## Tests & Qualité

| Sprint | Périmètre                                        | Résultat                   |
| ------ | ------------------------------------------------ | -------------------------- |
| T1–T5  | Migration Jest → Vitest 3                        | 10 configs Jest supprimées |
| T6     | UI + integration/controls/basemap/legend/storage | 0 régression               |
| T7     | +223 tests MapLibre (4 nouvelles suites)         | 284 fichiers, 6 403 tests  |
| T8     | V8 → Istanbul, imports `require()` → ESM         | thresholds réels débloqués |
| T9     | Couverture module par module                     | 323 fichiers, ~7 800 tests |
| T10    | Cible ≥ 75% branches atteinte                    | **8 317 tests, 0 échec**   |

### Couverture finale (Istanbul)

| Métrique   | v1.2.0  | v2.0.0      |
| ---------- | ------- | ----------- |
| Suites     | 280     | **323**     |
| Tests      | 6 149   | **8 317**   |
| Statements | 89,49 % | **87,82 %** |
| Branches   | 85,08 % | **77,97 %** |
| Functions  | —       | **84,89 %** |
| Lines      | —       | **87,82 %** |

---

## Performance — Baselines

| Métrique        | v1.x (Leaflet) | v2.0.0 (MapLibre)   |
| --------------- | -------------- | ------------------- |
| UMD bundle      | 196 KB gzip    | ❌ supprimé         |
| ESM bundle gzip | 35 KB          | ~35 KB              |
| ESM lite        | —              | ~84 KB              |
| CSS total       | —              | 151 KB / 22 KB gzip |
| 10 000 markers  | 4 FPS (DOM)    | **60 FPS** (GPU)    |
| 10 000 GeoJSON  | 572 ms         | **< 100 ms** WebGL  |
| TTI             | < 0,5 s        | < 0,5 s             |

---

## Résumé

- **Breaking change moteur** : Leaflet 1.9.4 → MapLibre GL JS v5. Rendu WebGL, GPU clustering natif, MVT/PBF, expressions data-driven. Voir les changements cassants détaillés ci-dessus.
- **Nouveau package MIT** : `@geoleaf/connector` v1.0.0 — intercepteur fetch universel, publié sur npmjs.org.
- **Distribution ESM-only** : bundle UMD supprimé définitivement. 3 sorties ESM.
- **Tests modernisés** : Vitest 3 + Istanbul, **8 317 tests**, couverture branches 77,97 %.
- **TypeScript 100% strict** : 30 `@ts-nocheck` supprimés, 0 erreur `tsc --noEmit --strict`.
- **Documentation complète** : site VitePress `geoleaf.dev/docs/`, 62+ guides mis à jour.
