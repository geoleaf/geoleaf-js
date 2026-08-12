---
title: "GeoLeaf Security Contract v3.0.0"
---

# GeoLeaf Security Contract v3.0.0

**Applies to:** `@geoleaf/core` v3.x — MapLibre GL JS security audit

This document is the security reference. Every identified injection vector, the sanitisation method
applied to it and the matching test file are listed below. **After each sprint, verify that every
listed vector still has a passing test.**

---

## 1. Injection vector inventory

### 1.1 DOM vectors (HTML/SVG injection into the DOM)

Source paths are relative to **`packages/core/src/`** unless a plugin is named. Tests live under
`packages/core/__tests__/` (or `packages/<plugin>/src/__tests__/`).

| Vector                                 | Source file (sink)                                                                             | Sanitisation                                                                                                                                                                                                                         | Test file                                                                                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Feature popup** (click on an entity) | `capabilities/feature-info/surfaces/popup.ts:131` → `.setDOMContent(node)`                     | **No `innerHTML` sink at all**: the popup is a **constructed DOM node**. Title `render/popup-content.ts:132-138` and fields `render/fields.ts:95,109,152,189` use `textContent`; URLs go through `safeUrl` (`render/dom.ts:202-214`) | `capabilities/feature-info/popup.test.js` · `renderers.test.js:60,122,184`                                                              |
| **Feature tooltip** (hover)            | `capabilities/feature-info/surfaces/tooltip.ts:84` and `:89` (`innerHTML`)                     | `escapeHtml(String(value))` — `render/popup-content.ts:310`; `escapeHtml` is `render/dom.ts:185-189`                                                                                                                                 | `capabilities/feature-info/tooltip.test.js:94-100` — covers the live path                                                               |
| **Feature sidepanel** (3rd surface)    | `capabilities/feature-info/render/sidepanel-content.ts:140,144,146,224,228`                    | `textContent`                                                                                                                                                                                                                        | None                                                                                                                                    |
| **Filter categories**                  | `capabilities/filter/panel/render.ts:205` (category), `:237` (subcategory), `:308` (badge)     | `createElement({ textContent })` → `modules/utils/general/dom-helpers.ts:92`                                                                                                                                                         | `capabilities/filter/panel-dom-golden.test.js` — `<img onerror>` payload on all three sites, and `DOMSecurity.setSafeHTML` never called |
| **Address search results**             | `geocoding/src/control.ts:132` (`li.textContent = result.label`)                               | `textContent`                                                                                                                                                                                                                        | `geocoding/src/__tests__/control.test.ts:130`                                                                                           |
| **Layer names** (layer manager)        | `modules/built-in/layer-manager/section-renderer.ts:22,52`                                     | `textContent`                                                                                                                                                                                                                        | `layer-manager.test.js`                                                                                                                 |
| **Mobile toolbar icons**               | `modules/built-in/ui/mobile/mobile-toolbar-pill.ts:324`                                        | `DOMSecurity.setSafeHTML(btn, icon.icon, _MOBILE_SVG_TAGS)` — allowlist at `:32`                                                                                                                                                     | None                                                                                                                                    |
| **Desktop toolbar icons**              | `modules/built-in/ui/desktop/desktop-panel-registry.ts:156`                                    | `DOMSecurity.setSafeHTML(btn, btnDef.icon, _SVG_ALLOWED)`                                                                                                                                                                            | None                                                                                                                                    |
| **Marker icons** (profile SVG)         | `adapters/maplibre/maplibre-adapter.ts:431`                                                    | `DOMSecurity.setSafeHTML(el, iconHtml, SVG_ALLOWED_TAGS)`                                                                                                                                                                            | None                                                                                                                                    |
| **Share QR code SVG**                  | `capabilities/permalink/share/share-modal.ts:125`                                              | `setSafeHTML(container, svg, QR_ALLOWED_TAGS)`; URL at `:65` through `input.value`                                                                                                                                                   | None                                                                                                                                    |
| **Theme selector labels**              | `capabilities/theme-selector/theme-selector-primary.ts:129,132` · `-secondary.ts:114`          | `textContent`                                                                                                                                                                                                                        | `theme-selector.test.js`                                                                                                                |
| **Search bar (permalink → UI)**        | `capabilities/filter/panel/write.ts:64` (`input.value = sf?.text ?? ""`)                       | `element.value` (never `innerHTML`) plus a `MAX_TEXT_LEN = 200` truncation (`permalink-url.ts:50,87,207`)                                                                                                                            | `permalink-injection.test.js`                                                                                                           |
| **Taxonomy badge colours** (CSSOM)     | `capabilities/feature-info/render/fields.ts:155-157` ← `render/dom.ts:294-303`                 | Values pre-validated by the taxonomy seam; written property by property (CSP `style-src`)                                                                                                                                            | None                                                                                                                                    |
| **SVG sprite reference**               | `capabilities/feature-info/render/dom.ts:250-251` (`use.setAttribute("href", "#" + symbolId)`) | `symbolId` is an allowlisted id resolved by taxonomy                                                                                                                                                                                 | None                                                                                                                                    |
| **Navigation arrows**                  | `modules/built-in/ui/mobile/mobile-toolbar-pill.ts:377-378` and `:407-408`                     | Hard-coded SVG literals                                                                                                                                                                                                              | N/A (safe by design)                                                                                                                    |
| **iOS PWA banner**                     | `capabilities/pwa/ios-banner.ts:112` and `:122` (`innerHTML = SHARE_ICON_SVG`)                 | SVG constant (`:26`). The title at `:80` is hard-coded rather than localised                                                                                                                                                         | N/A (safe by design)                                                                                                                    |
| **Temporary addpoi marker**            | `addpoi/src/poi/poi-placement.ts:280` (`el.innerHTML`)                                         | `color` (`:268`) is a ternary over two hex literals — **no user data**                                                                                                                                                               | N/A (safe by design)                                                                                                                    |

**Out of XSS scope.** GeoJSON labels no longer reach the DOM:
`capabilities/labels/label-renderer.ts:120` sets `"text-field": ["get", labelId]` on a **native
MapLibre `symbol` layer** (GPU rendering), so the file contains no `textContent` or `innerHTML` —
the data never meets an HTML parser.

### 1.2 URL vectors (injection through protocol or parameters)

| Vector                                                | Sanitisation                                                    | Test file                                           |
| ----------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------- |
| POI URLs (`url`, `website`, `image`, `photo`, `icon`) | `validateUrl()` — protocol allowlist (http/https/data:image)    | `security.test.js`, `xss-injection-vectors.test.js` |
| Data URLs                                             | `_validateDataUrl()` — MIME allowlist (image/\* only)           | `security.test.js`                                  |
| Permalink lat/lng/zoom                                | `validateNumber()` and `validateCoordinates()`                  | `permalink-injection.test.js`                       |
| Permalink layer IDs                                   | String filtering, capped at 100 entries                         | `permalink-injection.test.js`                       |
| Permalink filter text                                 | Truncated to 200 characters (`MAX_TEXT_LEN`)                    | `permalink-injection.test.js`                       |
| Permalink compact form (base64)                       | `JSON.parse(atob())` followed by `_validateRaw()` re-validation | `permalink-injection.test.js`                       |
| Permalink rating                                      | `Number()` and a `> 0` check                                    | `permalink-injection.test.js`                       |

### 1.3 Prototype pollution vectors

Every protection below calls the same blocklist — `isUnsafeKey()` / `hasUnsafeSegment()` from
`modules/utils/general/object-path-guard.ts`. That module has **no imports of its own**, which is
what makes it importable from any layer without creating an edge or a cycle.

| Vector                               | Protection                                                                                                                                 | Test file                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Profile JSON config                  | `_isUnsafeKey()` (`built-in/config/storage.ts`, logging wrapper) on `set()`, `merge()` and `deepMerge()`                                   | `sprint1-sink-hardening.test.js` (M3)                    |
| POI properties (mapping.json)        | `_isUnsafeKey()` on `setValueByPath()` — the write path of `normalizePoiWithMapping`                                                       | `prototype-pollution.test.js`                            |
| **A profile's `modules` bag**        | `isUnsafeKey()` on `mergeModulesBag()`, `mergeModuleBags()` and the `Files.modules` loader                                                 | `module-config-pollution.test.js`                        |
| Permalink compact base64             | `JSON.parse()` (safe) plus `_validateRaw()` type checks                                                                                    | `permalink-injection.test.js`                            |
| GeoJSON styles (paint normalisation) | `_safeCopy()`, `_mergeNativePaint()`, `_resolveRuleStyle()` and `_buildPaintFromRules()` (`adapters/maplibre/maplibre-style-converter.ts`) | `s14-style-converter-paint.test.js`                      |
| Public path utilities                | `deepMerge()` (`utils/general/utils-base.ts`) and `setNestedValue()` (`utils/general/object-utils.ts`)                                     | `utils-base.test.js`, `object-utils.test.js` (@security) |
| **The inventory itself**             | `check-dynamic-key-writes.cjs` — any new unguarded `X[k] = …` write fails at commit time and in CI                                         | `guards/prototype-pollution-sinks.guard.test.js`         |

::: tip Scope of the guarantee
On `setValueByPath`, **global** pollution of `Object.prototype` was never reachable: the own-property
check replaces the intermediate with a fresh object and breaks the `constructor.prototype` chain.
What was reachable is a prototype injection **scoped** to the POIs under construction
(`"__proto__.x"` yielding an inherited property on every POI), which then flowed into feature
properties, popups and table columns. Medium severity, not critical.

GeoJSON feature properties are only **read** in the core pipeline (validated by
`feature-validator.ts`), never merged into another object, so there is no sink to guard for them.
The "styles" row above covers the only path where they are copied.
:::

---

## 2. Security module API

### Sanitisation functions

| Function                        | Input                          | Output guarantee                                                                           | Usage                    |
| ------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------ |
| `escapeHtml(str)`               | Any string                     | HTML characters (`<`, `>`, `&`, `"`, `'`) escaped as entities                              | Text content in the DOM  |
| `escapeAttribute(str)`          | Any string                     | Same characters plus `'` escaped                                                           | HTML attribute values    |
| `containsDangerousHtml(str)`    | Any string                     | `true` when XSS patterns are detected                                                      | Fast detection/rejection |
| `stripHtml(html)`               | HTML string                    | Plain text with every tag removed                                                          | Plain-text display       |
| `sanitizeSvgContent(svg)`       | Raw SVG string                 | An SVGElement without `<script>`, `<foreignObject>`, `on*` handlers or `javascript:` hrefs | External SVG icons       |
| `parseHtmlSafely(html, tags)`   | HTML string plus tag allowlist | A DocumentFragment containing only the allowed tags                                        | Controlled rich content  |
| `sanitizeHTML(el, html, opts)`  | DOM element plus HTML          | Sanitised injection through `parseHtmlSafely`                                              | Main wrapper             |
| `validateUrl(url, base, opts)`  | URL string                     | A validated URL (allowlisted protocol), or throws                                          | Links, images, media     |
| `validateCoordinates(lat, lng)` | Numbers                        | A valid `[lat, lng]` tuple, or throws                                                      | Map coordinates          |
| `validateNumber(val, min, max)` | Any value                      | A finite number within [min, max], or `null`                                               | Numeric parameters       |

### Safe DOM functions

| Function                                          | Input                             | Guarantee                                                             | Usage              |
| ------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------- | ------------------ |
| `DOMSecurity.setTextContent(el, text)`            | Element plus text                 | Assignment through `textContent` (never `innerHTML`)                  | Any non-HTML text  |
| `DOMSecurity.setSafeHTML(el, html, tags?)`        | Element, HTML, optional allowlist | Routed through `Security.sanitizeHTML()`, falls back to `textContent` | Controlled HTML    |
| `DOMSecurity.clearElement(el)`                    | Element                           | Children removed through a `removeChild` loop                         | DOM cleanup        |
| `DOMSecurity.createElement(tag, attrs, children)` | Tag, attributes, children         | Element created through the safe DOM API                              | Element creation   |
| `DOMSecurity.createSVGIcon(w, h, path, opts)`     | Dimensions plus path data         | An SVGElement built with `createElementNS` (not `innerHTML`)          | Internal SVG icons |

### CSRF protection

| Function                                     | Description                                           |
| -------------------------------------------- | ----------------------------------------------------- |
| `CSRFToken.init()`                           | Generates a crypto-random token (32 bytes, base64url) |
| `CSRFToken.getToken()`                       | Returns the current token, regenerating it if expired |
| `CSRFToken.validateToken(token)`             | Constant-time token validation                        |
| `CSRFToken.rotateToken()`                    | Manual rotation plus a `geoleaf:csrf:rotated` event   |
| `CSRFToken.addTokenToHeaders(opts)`          | Adds `X-CSRF-Token` to the headers                    |
| `CSRFToken.addTokenToForm(form)`             | Adds `<input type="hidden" name="csrf_token">`        |
| `CSRFToken.setSecureCookie(name, val, opts)` | Cookie with `Secure`, `SameSite` and `HttpOnly`       |

---

## 3. Dangerous patterns — audit result

| Pattern                    | Occurrences | Status                                           |
| -------------------------- | ----------- | ------------------------------------------------ |
| `eval()`                   | 0           | OK                                               |
| `new Function(`            | 0           | OK                                               |
| `setTimeout(string, ...)`  | 0           | OK                                               |
| `setInterval(string, ...)` | 0           | OK                                               |
| `document.write`           | 0           | OK                                               |
| `insertAdjacentHTML`       | 0           | OK                                               |
| `outerHTML` (write)        | 0           | OK (one read in `label-renderer.ts` — safe)      |
| `innerHTML`                | see 3.1     | All safe — every occurrence is classified in 3.1 |

The `innerHTML` count is not restated here because it moves with every refactor. Re-measure it with
`grep -rn "innerHTML" packages/core/src --include="*.ts"`; the sinks that actually carry user data
are the ones listed in 1.1.

### 3.1 innerHTML classification

- **DOM construction (no `innerHTML`)** — the feature popup:
  `capabilities/feature-info/surfaces/popup.ts:131` passes a **node** to `.setDOMContent()`.
- **Escape pattern** (textContent → innerHTML read): `modules/built-in/security/index.ts` ·
  `capabilities/feature-info/surfaces/tooltip.ts:84,89` (through `escapeHtml`,
  `render/popup-content.ts:310`).
- **`DOMSecurity.setSafeHTML` wrapper**: `modules/utils/general/dom-helpers.ts` ·
  `modules/built-in/ui/mobile/mobile-toolbar-pill.ts:324` ·
  `modules/built-in/ui/desktop/desktop-panel-registry.ts:156` ·
  `adapters/maplibre/maplibre-adapter.ts:431` · `capabilities/permalink/share/share-modal.ts:125`.
- **Clearing** (`innerHTML = ""`): `modules/built-in/ui/mobile/mobile-toolbar.ts` ·
  `mobile-toolbar-sheet.ts`.
- **Hard-coded SVG constants**: `capabilities/pwa/ios-banner.ts:112,122` ·
  `capabilities/theme-selector/theme-selector-primary.ts` ·
  `modules/built-in/ui/mobile/mobile-toolbar-pill.ts:377-378,407-408` ·
  `addpoi/src/poi/poi-placement.ts:280`.

---

## 4. CSP compatibility (Content Security Policy)

Minimum directives required for GeoLeaf plus MapLibre GL JS v6:

| Directive     | Value                 | Reason                                                                                                                                                                                                               |
| ------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `script-src`  | `'self'`              | No `eval`, no `Function`, no inline scripts. Same-origin workers.                                                                                                                                                    |
| `style-src`   | `'self'`              | Dynamic styles are applied through the **CSSOM** (`element.style.setProperty`, `applyCssText` helper) or through **CSS classes**, neither of which is subject to `style-src`. `'unsafe-inline'` is **not** required. |
| `img-src`     | `'self' data: https:` | Data URLs for markers and icons, HTTPS tiles                                                                                                                                                                         |
| `connect-src` | `'self' https:`       | Fetching GeoJSON, profiles and tile URLs                                                                                                                                                                             |
| `worker-src`  | `'self' blob:`        | The GeoJSON worker is loaded from a blob URL (`worker-manager.ts`)                                                                                                                                                   |
| `font-src`    | `'self'`              | The core loads no external font                                                                                                                                                                                      |
| `default-src` | `'self'`              | Safe fallback                                                                                                                                                                                                        |

**Notable points:**

- `unsafe-eval` is **not required** — confirmed for MapLibre GL JS v6 and GeoLeaf.
- `unsafe-inline` is **not required**: dynamic styles go through the CSSOM
  (`element.style.setProperty`, the `applyCssText` helper) or CSS classes, and property-by-property
  CSSOM writes escape `style-src` entirely. This is guarded by the `18-security` end-to-end suite.
- After a MapLibre upgrade, check whether the new version requires additional directives (WebGL,
  workers).

---

## 5. Review checklist

The MapLibre migration is complete (v3.0.0, native engine end to end), so this section is no longer
a migration checklist but **the review to run against this contract** on every sprint that touches
rendering.

- [ ] Does every `Source file` in 1.1 still exist? A refactor moves the protections, never the map.
- [ ] Does every `Test file` in 1.1 actually **import** the code it claims to test? A test with no
      `import` only tests the browser.
- [ ] Does each cited test reach the **real sink**, and not just the sanitisation primitive?
- [ ] Does feature rendering (popup / tooltip / sidepanel) still build **DOM**, or does it route
      through `escapeHtml` before `innerHTML`?
- [ ] Do markers and SVG icons still go through `DOMSecurity.setSafeHTML` plus an allowlist?
- [ ] Does `validateUrl` cover tile and media URLs?
- [ ] Is every **new** injection surface recorded in 1.1?
- [ ] CSP: does a new dependency require `unsafe-eval` or `unsafe-inline`? Neither is required today.
- [ ] Prototype pollution: are new configuration entry points covered?
- [ ] Prototype pollution: does every new path writer (`a.b.c`) apply a guard **to each segment,
      including the last**? A single-segment path skips the descent loop entirely.
- [ ] Is the guard tested **against the real implementation**, with no mock of the sink?
- [ ] Is `npm run check:dynamic-key-writes` green **with no new baseline entry**? A new entry must be
      justified in the commit message.
- [ ] Does the guard import `object-path-guard.js` rather than redeclaring its list? The
      `prototype-pollution-sinks.guard.test.js` guard test refuses a fifth copy.
- [ ] **Does the new test fail when the guard is neutralised?** Manual mutation protocol: make
      `isUnsafeKey` return `false`, check that the test turns red, then restore. A security test that
      has never been seen failing proves nothing.
- [ ] Do all `__tests__/security/` tests pass?

---

## 6. Security test files

| File                                          | Tests | Coverage                                                                                                                                   |
| --------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `security/security.test.js`                   | 42    | escapeHtml, escapeAttribute, validateUrl, validateCoordinates                                                                              |
| `security/sprint1-sink-hardening.test.js`     | 12    | Guards wired at the sink: sprite loader (M1), Config `deepMerge`/`set`/`merge` (M3), `setValueByPath` — **real StorageHelper, not mocked** |
| `security/csrf-token.test.js`                 | 23    | Full CSRFToken lifecycle                                                                                                                   |
| `security/security-comprehensive.test.js`     | ~60   | Extended coverage of escapeHtml and coordinates                                                                                            |
| `security/security-extended.test.js`          | ~50   | sanitizeSvgContent, validateNumber, parseHtmlSafely                                                                                        |
| `security/security.esm.test.js`               | ~70   | ESM tests across all functions                                                                                                             |
| `security/prototype-pollution.test.js`        | 6     | The real `normalizePoiWithMapping` → `setValueByPath` pipeline, **with no mock** of the sink                                               |
| `security/xss-prevention.test.js`             | 12    | Browser DOM escaping only — the file has **no `import`** and loads no GeoLeaf code. To rewrite against a real sink from 1.1, or to delete  |
| `security/xss-injection-vectors.test.js`      | ~90   | The **primitives only** (`Security`, `DOMSecurity`, its sole imports at `:17-18`). Reaches **none** of the 1.1 vectors                     |
| `security/permalink-injection.test.js`        | ~30   | URL parameter injection plus compact mode                                                                                                  |
| `security/file-validator.test.js`             | ~25   | Safe upload (size, extension, MIME)                                                                                                        |
| `security/dom-security.test.js`               | 24    | Full DOMSecurity wrapper                                                                                                                   |
| `capabilities/feature-info/tooltip.test.js`   | —     | `:94-100` injects `<b>x</b>` and asserts `querySelector("b")` is null. A real test on the live path                                        |
| `capabilities/feature-info/renderers.test.js` | —     | `:60,122,184` — `javascript:` payloads                                                                                                     |

### 6.1 Vectors that are protected but not tested

These vectors are **genuinely protected** (see 1.1), but no test verifies it. The protection rests on
review, not on a safety net.

| Vector                                   | Sanitisation in place                             |
| ---------------------------------------- | ------------------------------------------------- |
| Filter categories                        | `createElement({ textContent })`                  |
| **Mobile** and **desktop** toolbar icons | `DOMSecurity.setSafeHTML` plus an SVG allowlist   |
| Marker icons (profile SVG)               | `DOMSecurity.setSafeHTML` plus `SVG_ALLOWED_TAGS` |
| Share QR code SVG                        | `setSafeHTML` plus `QR_ALLOWED_TAGS`              |
| feature-info sidepanel                   | `textContent`                                     |
| Taxonomy badge colours (CSSOM)           | Values pre-validated by the taxonomy seam         |
