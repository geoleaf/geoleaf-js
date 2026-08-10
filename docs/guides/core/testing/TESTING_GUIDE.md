# GeoLeaf Testing Guide

Product Version: GeoLeaf Platform V3

**Version:** 3.0.0
**Last Updated:** 27 juillet 2026 — sorti du dossier de tri, relu contre le code

## Overview

GeoLeaf uses **Vitest** for unit testing. This guide documents testing patterns, best practices, and key insights from the test suite development.

> ⚠️ Ce guide annonçait « Jest 29.x with jsdom environment » jusqu'au 22/07/2026 — soit les
> deux moitiés fausses : Jest a été remplacé par Vitest en mars 2026 (plus aucun script,
> fichier de config ni dépendance), et l'environnement est `happy-dom`, pas `jsdom`.

**Test Coverage:** non connue à ce jour. Les chiffres affichés ici (82,5 % lignes /
80,3 % statements / ~85,7 % branches) proviennent d'une mesure dont l'attribution est
fausse à 49 % — voir `roadmap_couverture-tests.md` (archivée le 24/07/2026). Ils sont retirés plutôt que remplacés :
les rechiffrer maintenant substituerait un chiffre faux à un autre. Rétablissement au
sprint 6 de cette roadmap.

**Framework:** Vitest 4, environnement `happy-dom`, pool `forks` pour le cœur (`vmForks`
pour la plupart des plugins) — voir `packages/core/vitest.config.ts` et la fabrique
`@geoleaf/build-config/vitest/base.mjs`.

**Map engine:** MapLibre GL JS ^6.0.0

---

## Test Suites

### 1. `environment.test.js`

Validates test environment setup:

- Vitest configuration

- Global helpers availability

- MapLibre GL JS mock functionality

- DOM availability (jsdom)

- Fetch mock setup

### 2. `helpers.test.js`

Tests utility functions in `geoleaf.helpers.ts`:

- `resolveField()` - nested property resolution

- `formatDuration()` - time formatting

- `formatDistance()` - distance formatting with i18n

- `debounce()` - function debouncing

- `deepMerge()` - object merging

### 3. `utils.test.js`

Tests utility functions in `geoleaf.utils.ts`:

- `capitalizeFirstLetter()` - string capitalization

- `escapeHtml()` - HTML entity escaping

- `sanitizeUrl()` - URL validation and sanitization

- `truncateText()` - text truncation with ellipsis

### 4. `security.test.js`

Tests security module (`security/`):

- HTML escaping (XSS prevention)

- URL sanitization (protocol validation)

- Input validation patterns

- Edge cases and attack vectors

### 5. `core.test.js`

Tests core GeoLeaf functionality (`geoleaf.core.ts`):

- Map initialization and configuration

- State management

- Module integration (Log, UI, Config)

- Error handling and recovery

- Multi-map support

### 6. `poi.test.js`

Tests POI module functionality:

- Module initialization (8 tests)

- POI addition and validation (14 tests)

- Data retrieval and reload (5 tests)

- Popup generation (3 tests)

- Security (HTML escaping, URL sanitization) (5 tests)

---

## Testing Patterns & Best Practices

### Pattern 1: No Exceptions, Only Logging

**Discovery**: The POI module logs errors instead of throwing exceptions.

**Example**:

```javascript
// INCORRECT - Test expects exception
test("should throw error without map", () => {
    expect(() => {
        GeoLeaf.POI.init({});
    }).toThrow();
});

// CORRECT - Test checks return value
test("should return undefined without map", () => {
    const result = GeoLeaf.POI.init({});
    expect(result).toBeUndefined();
});
```

**Rationale**:

- Better user experience (no crashes)

- Errors logged to console for debugging

- Functions return `null` or `undefined` on failure

- Caller can check return value and handle gracefully

**Affected modules**: POI, markers, normalizers

---

### Pattern 2: Lazy DOM Creation

**Discovery**: DOM elements are created on-demand, not during initialization.

**Example**:

```javascript
// INCORRECT - Expects immediate DOM creation
test("should create the side panel", () => {
    GeoLeaf.FeatureInfo.init({ map: mockMap });
    const panel = document.querySelector(".gl-poi-sidepanel");
    expect(panel).toBeTruthy(); // FAILS - element doesn't exist yet
});

// CORRECT - Tests module existence, not DOM
test("should initialize the feature-info module", () => {
    GeoLeaf.FeatureInfo.init({ map: mockMap });
    // The side panel is created lazily
    expect(GeoLeaf.FeatureInfo).toBeDefined();
});

// ALSO CORRECT - Trigger creation, then test
test("should create the side panel on demand", () => {
    GeoLeaf.FeatureInfo.init({ map: mockMap });
    GeoLeaf.FeatureInfo.showDetails({ id: "test", latlng: [45, -73] });
    // Now the DOM element exists
    const panel = document.querySelector(".gl-poi-sidepanel");
    expect(panel).toBeTruthy();
});
```

> ⚠️ Mis à jour au S9 (21/07/2026). L'exemple s'appuyait sur `GeoLeaf.POI`, **API dissoute** lors de l'extraction en capacités, et sur `.gl-poi-sidepanel-overlay`, une classe qu'aucun code ne pose plus (son CSS, mort, a été purgé au S9). La classe vivante est `.gl-poi-sidepanel`, posée par `capabilities/feature-info/surfaces/sidepanel.ts:50`. Le principe illustré — ne pas attendre de DOM avant l'action qui le crée — est inchangé.

**Rationale**:

- Performance optimization (no unnecessary DOM manipulation)

- Memory efficiency (create only when needed)

- Cleaner initialization code

**Affected components**: Sidepanel, popups, UI overlays

---

### Pattern 3: Render-Time Normalization

**Discovery**: POI data is stored raw, normalization/sanitization happens during rendering.

**Example**:

```javascript
// INCORRECT - Checks stored data
test("should sanitize URLs in POI data", () => {
    const poi = {
        id: "poi-url",
        latlng: [45.5, -73.6],
        attributes: { link: "javascript:alert(1)" },
    };
    GeoLeaf.POI.addPoi(poi);
    const stored = GeoLeaf.POI.getPoiById("poi-url");
    expect(stored.attributes.link).toBeNull(); // FAILS - raw data stored
});

// CORRECT - Checks rendered output
test("should sanitize URLs in popup", () => {
    const poi = {
        id: "poi-url",
        latlng: [45.5, -73.6],
        attributes: { link: "javascript:alert(1)" },
    };
    GeoLeaf.POI.addPoi(poi);
    const marker = getLastCreatedMarker();
    const popup = marker.bindPopup.mock.calls[0][0];
    // Malicious URL should not appear in rendered HTML
    expect(popup).not.toContain("javascript:");
});
```

**Rationale**:

- Preserve original data (for debugging, logging)

- Apply transformations consistently at render time

- Single source of truth for normalization logic

- Easier to update sanitization rules (one place)

**Affected data**: POI attributes, URLs, HTML content, coordinates

---

### Pattern 4: HTML Escaping Verification

**Discovery**: HTML is escaped using `&lt;`, `&gt;`, etc., not removed.

**Example**:

```javascript
// INCORRECT - Checks for absence of dangerous string
test("should escape XSS in description", () => {
    const poi = {
        id: "xss-desc",
        description: "<img src=x onerror=alert(1)>",
    };
    GeoLeaf.POI.addPoi(poi);
    const popup = getPopupContent();
    expect(popup).not.toContain("onerror="); // FAILS - string still present (escaped)
});

// CORRECT - Checks for escaped characters
test("should escape XSS in description", () => {
    const poi = {
        id: "xss-desc",
        description: "<img src=x onerror=alert(1)>",
    };
    GeoLeaf.POI.addPoi(poi);
    const popup = getPopupContent();
    // Verify characters are escaped
    expect(popup).toContain("&lt;img");
    expect(popup).toContain("&gt;");
    // Verify raw HTML doesn't appear
    expect(popup).not.toContain("<img src=x");
});
```

**Rationale**:

- Preserves user content (shows what they typed)

- Prevents XSS attacks (browser won't execute)

- Better UX than silently removing content

---

## Mock Setup

### MapLibre GL JS Mock

Located in `__tests__/__mocks__/maplibre-gl.cjs`. Provides comprehensive MapLibre GL JS API mocking:

```javascript
// Sprint 7 — single source of truth for all maplibregl.* mocks.
// Covers the full surface used by MaplibreAdapter, maplibre-poi-builders,
// maplibre-helpers, and all MapLibre-dependent test files.

global.maplibregl = require("./__mocks__/maplibre-gl.cjs");
```

The mock covers:

- `Map` — full map instance with sources, layers, events, controls
- `Marker` — marker with popup binding, drag support
- `Popup` — popup with content setters
- `LngLatBounds` — bounding box helpers
- `NavigationControl`, `ScaleControl`, `GeolocateControl` — control constructors
- `supported()` — WebGL support detection (returns `true`)

**Key capabilities of the map mock:**

- `addSource()` / `removeSource()` / `getSource()` — source lifecycle with `setData()` support
- `addLayer()` / `removeLayer()` / `getLayer()` — layer lifecycle
- `on()` / `off()` / `fire()` — event system with full handler registry
- `addControl()` / `removeControl()` — control management

The mock uses `vi.fn()` throughout. `setup.js` expose par ailleurs `vi` sous le nom
`globalThis.jest`, afin que les suites moteur héritées de l'ère Jest (`jest.fn()`,
`jest.spyOn()`) continuent de tourner sans réécriture — c'est un alias de compatibilité,
pas une dépendance à Jest.

---

## Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- __tests__/poi.test.js

# Run with coverage
npm test -- --coverage

# Watch mode
npm test -- --watch

# Verbose output
npm test -- --verbose
```

---

## Test Results (current)

- **Total tests:** all suites passing
- **Coverage:** 82.5% lines / 80.3% statements / ~85.7% branches
- **Thresholds (`packages/core/vitest.config.ts`):** branches ≥ 55, functions ≥ 65,
  lines ≥ 66, statements ≥ 66 — recalibrés le 15/06/2026 pour le provider V8. L'ancien
  « branches ≥ 75 %, le reste ≥ 70 % » venait de `jest.config.cjs`, supprimé avec Jest en
  mars 2026. ⚠️ Les chiffres de couverture ci-dessus proviennent d'une mesure dont
  l'attribution est fausse à 49 % (`roadmap_couverture-tests.md`, archivée) — à rétablir au sprint 6,
  pas à rechiffrer maintenant
- **Deferred suites:** `__tests__/deferred/` — excluded from default run, pending reactivation

---

## Common Testing Pitfalls

### 1. Assuming Synchronous DOM Creation

**Wrong**: Expecting DOM elements immediately after `init()`

**Right**: Trigger the action that creates DOM, then test

### 2. Testing Implementation Instead of Behavior

**Wrong**: Checking internal data structures

**Right**: Testing rendered output and user-visible behavior

### 3. Expecting Exceptions Where None Are Thrown

**Wrong**: Using `.toThrow()` for functions that log errors

**Right**: Check return values (`null`, `undefined`, `false`)

### 4. Testing Raw Data Instead of Processed Output

**Wrong**: Checking stored POI data for sanitization

**Right**: Checking rendered popup HTML for sanitized content

---

## Architecture Insights

### Design Philosophy

The test suite reflects key architectural decisions:

1. **Graceful Degradation**: Return `null`/`undefined` instead of throwing

2. **Lazy Initialization**: Create resources only when needed

3. **Late Binding**: Apply transformations at render time, not storage time

4. **Separation of Concerns**: Raw data ≠ rendered data

### Benefits

- **Resilience**: Application doesn't crash on invalid input

- **Performance**: Lazy loading reduces initialization time

- **Flexibility**: Normalization rules can change without data migration

- **Debuggability**: Raw data preserved for inspection

---

## Future Improvements

### Potential Test Enhancements

1. **Coverage Expansion**
    - Add tests for error recovery scenarios
    - Test multi-map edge cases
    - Add performance benchmarks

2. **Mock Improvements**
    - Mock additional browser APIs (geolocation, localStorage)
    - Extend MapLibre GL JS mock for new API surface

3. **Integration Tests**
    - Test module interactions
    - Test full workflows (add POI → show details → close)

4. **Visual Regression Tests**
    - Screenshot comparison for UI components
    - CSS rendering validation

---

## References

- **Vitest Documentation**: https://vitest.dev/
- **MapLibre GL JS Documentation**: https://maplibre.org/maplibre-gl-js/docs/
- **Testing Best Practices**: docs/testing/best-practices.md (TODO)

---

## Changelog

**v2.0.0 (March 2026)**

- Updated to GeoLeaf Platform V2 (MapLibre GL JS engine)
- Replaced Leaflet mock with MapLibre GL JS mock (`__tests__/__mocks__/maplibre-gl.cjs`)
- Updated coverage metrics: 82.5% lines / 80.3% statements / ~85.7% branches
- Sprint 7: centralized MapLibre mock (single source of truth)
- Sprint 9: Leaflet mock fully removed
