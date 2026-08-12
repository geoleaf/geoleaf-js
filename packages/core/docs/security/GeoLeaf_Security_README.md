---
title: "GeoLeaf.Security — Security module documentation"
---

# GeoLeaf.Security — Security module documentation

**Applies to:** `@geoleaf/core` v3.x
**Source file (monorepo)**: `packages/core/src/kernel/security/index.ts`
**CSRF module**: `packages/core/src/kernel/security/csrf-token.ts`

---

## Overview

The **GeoLeaf.Security** module provides centralised security functions that protect the application against XSS (Cross-Site Scripting) vulnerabilities, malicious injections and CSRF attacks.

### Main responsibilities

- **HTML escaping** — neutralises dangerous HTML characters
- **URL validation** — allowlist of permitted protocols (`http:`, `https:`, `data:image/`)
- **Data sanitisation** — cleans POI/GeoJSON properties
- **XSS protection** — prevents code injection attacks
- **HTML sanitisation** — parses HTML against a tag allowlist, injects into the DOM safely
- **SVG sanitisation** — strips scripts and event handlers from external SVGs
- **Number validation** — rejects NaN, Infinity and out-of-range values
- **CSRF tokens** — generation, validation and rotation of anti-CSRF tokens

---

## Security functions

### `escapeHtml(str)`

Escapes dangerous HTML characters to prevent XSS attacks.
Uses `div.textContent` + `div.innerHTML` — a native method, no regex.

**Signature**:

```ts
escapeHtml(str: string | null | undefined): string
```

**Example**:

```js
const userInput = '<script>alert("XSS")</script>';
const safe = GeoLeaf.Security.escapeHtml(userInput);
// Returns: '&lt;script&gt;alert("XSS")&lt;/script&gt;'

element.innerHTML = GeoLeaf.Security.escapeHtml(userInput);
```

**Escaped characters**: `<` `>` `&` `"` `'`

**Note**: `null` and `undefined` return `""`.

---

### `escapeAttribute(str)`

Escapes characters for safe use inside HTML attributes.

**Signature**:

```ts
escapeAttribute(str: string | null | undefined): string
```

**Example**:

```js
const userValue = 'value" onclick="alert(1)';
const safe = GeoLeaf.Security.escapeAttribute(userValue);
// Returns: 'value&quot; onclick=&quot;alert(1)'

const html = `<input value="${safe}">`;
```

---

### `validateUrl(url, baseUrl?, options?)`

Validates a URL against a strict allowlist of protocols.

**Signature**:

```ts
validateUrl(url: string, baseUrl?: string, options?: ValidateUrlOptions): string
```

**Parameters**:

- `url`: URL to validate (required)
- `baseUrl`: base URL for relative resolution (default: `location.origin`)
- `options.httpsOnly`: `true` = rejects `http:`, allows only `https:` and `data:image/`

**Allowed protocols** (normal mode):

- `http:`
- `https:`
- `data:` — only for allowed image types (`image/png`, `image/jpeg`, `image/gif`, `image/svg+xml`, `image/webp`)

**Examples**:

```js
// Valid URL
GeoLeaf.Security.validateUrl("https://example.com/data.json");
// Returns: 'https://example.com/data.json'

// Relative URL
GeoLeaf.Security.validateUrl("../data/poi.json", window.location.href);
// Returns: resolved absolute URL

// Malicious URL (throws)
try {
    GeoLeaf.Security.validateUrl("javascript:alert(1)");
} catch (error) {
    console.error("Disallowed URL:", error.message);
}

// HTTPS-only mode
GeoLeaf.Security.validateUrl("https://example.com/data", undefined, { httpsOnly: true });
```

**Errors thrown**:

- `TypeError`: empty or non-string URL
- `Error`: disallowed protocol

---

### `validateCoordinates(lat, lng)`

Validates geographic coordinates (latitude and longitude).

**Signature**:

```ts
validateCoordinates(lat: number, lng: number): [number, number]
```

**Rejects**: NaN, Infinity, values outside the ranges `[-90, 90]` (lat) and `[-180, 180]` (lng).

**Example**:

```js
const [lat, lng] = GeoLeaf.Security.validateCoordinates(48.857, 2.347);
// Returns: [48.857, 2.347]

try {
    GeoLeaf.Security.validateCoordinates(91, 0); // throws RangeError
} catch (e) {
    // Latitude must be between -90 and 90
}
```

---

### `containsDangerousHtml(str)`

Detects potentially dangerous HTML patterns (XSS vectors).

**Signature**:

```ts
containsDangerousHtml(str: unknown): boolean
```

Detects: `<script`, `javascript:`, `on*=` handlers, `<iframe`, `<object`, `<embed`, `<meta`, `data:text/html`, `<form`, and similar.

**Example**:

```js
GeoLeaf.Security.containsDangerousHtml("<script>alert(1)</script>"); // true
GeoLeaf.Security.containsDangerousHtml("Normal text"); // false
```

---

### `stripHtml(html)`

Removes all HTML from a string, keeping only the text.

**Signature**:

```ts
stripHtml(html: string): string
```

```js
const text = GeoLeaf.Security.stripHtml("<h1>Hello <b>World</b></h1>");
// Returns: "Hello World"
```

---

### `createSafeElement(tagName, options)`

Creates a DOM element safely, escaping its content automatically.

**Signature**:

```ts
createSafeElement(tagName: string, options?: SafeElementOptions): Element
```

**Options**: `className`, `id`, `textContent`, `attributes` (values escaped through `escapeAttribute`), `children`

```js
const el = GeoLeaf.Security.createSafeElement("div", {
    className: "gl-poi-name",
    textContent: userInput,
    attributes: { "data-id": poiId },
});
```

---

### `sanitizeSvgContent(svgContent)`

Parses and sanitises external SVG content: removes scripts, `foreignObject`, `on*` handlers and javascript `href` values.

**Signature**:

```ts
sanitizeSvgContent(svgContent: string | null | undefined): SVGElement | null
```

```js
const svgEl = GeoLeaf.Security.sanitizeSvgContent(rawSvgString);
if (svgEl) {
    container.appendChild(svgEl);
}
```

---

### `validateNumber(value, min?, max?)`

Validates that a value is a finite number within a given interval.

**Signature**:

```ts
validateNumber(value: unknown, min?: number, max?: number): number | null
```

```js
const zoom = GeoLeaf.Security.validateNumber(urlParamZoom, 0, 22);
if (zoom === null) {
    // Invalid value — silently ignored
}
```

---

### `parseHtmlSafely(html, allowedTags?)`

Parses HTML against a tag allowlist. Converts disallowed elements into text nodes. Validates link `href` values through `validateUrl`.

**Signature**:

```ts
parseHtmlSafely(html: string, allowedTags?: string[]): DocumentFragment
```

Tags allowed by default: `p`, `br`, `strong`, `em`, `span`, `a`, `ul`, `ol`, `li`, `b`, `i`

```js
const fragment = GeoLeaf.Security.parseHtmlSafely(
    "<p>Text <b>bold</b> <script>alert(1)</script></p>"
);
// Returns a DocumentFragment with <script> converted to text node
container.appendChild(fragment);
```

---

### `sanitizeHTML(element, html, options?)`

Sanitises HTML and injects it into a DOM element safely. Main entry point for injecting HTML into the DOM.

**Signature**:

```ts
sanitizeHTML(element: Element, html: string | null | undefined, options?: SanitizeHtmlOptions): Element | null
```

**Options**:

- `stripAll: true` — removes every tag (text only)
- `allowedTags: string[]` — custom list of allowed tags

```js
// Inject sanitized HTML
GeoLeaf.Security.sanitizeHTML(container, poiDescription);

// Strip all tags
GeoLeaf.Security.sanitizeHTML(container, htmlContent, { stripAll: true });

// Custom allowed tags
GeoLeaf.Security.sanitizeHTML(container, htmlContent, {
    allowedTags: ["p", "strong", "em"],
});
```

---

## CSRF module (`csrf-token.ts`)

### `GeoLeaf.Security.CSRF` / `CSRFToken`

Anti-CSRF token manager built on `crypto.getRandomValues`.

**API**:

| Method                                         | Description                                          |
| ---------------------------------------------- | ---------------------------------------------------- |
| `CSRFToken.init()`                             | Generates the initial token and starts auto-refresh  |
| `CSRFToken.getToken()`                         | Returns the current token (regenerated if expired)   |
| `CSRFToken.validateToken(token)`               | Validates a received token                           |
| `CSRFToken.addTokenToData(data)`               | Adds the token to an object or FormData              |
| `CSRFToken.addTokenToHeaders(options)`         | Adds `X-CSRF-Token` to the fetch headers             |
| `CSRFToken.createTokenInput()`                 | Creates an `<input type="hidden" name="csrf_token">` |
| `CSRFToken.addTokenToForm(form)`               | Adds the token to an HTML form                       |
| `CSRFToken.validateFormToken(data)`            | Validates the token from a FormData/object           |
| `CSRFToken.setSecureCookie(name, value, opts)` | Sets a cookie with `Secure`, `SameSite`, `HttpOnly`  |
| `CSRFToken.rotateToken()`                      | Manual token rotation                                |
| `CSRFToken.getTokenInfo()`                     | Returns `{ hasToken, expiresIn, isValid }`           |
| `CSRFToken.destroy()`                          | Destroys the token and stops auto-refresh            |

**Example**:

```js
// Add CSRF token to a fetch request
const options = CSRFToken.addTokenToHeaders({ method: "POST", body: JSON.stringify(data) });
fetch("/api/poi", options);

// Validate token on form submit
form.addEventListener("submit", (e) => {
    const data = new FormData(form);
    if (!CSRFToken.validateFormToken(data)) {
        e.preventDefault();
        console.error("Invalid CSRF token");
    }
});
```

---

## DOM clearing convention

**Rule**: to empty an element (remove its children), do not use `element.innerHTML = ''`.

Use instead:

| Method                                     | Usage                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| `GeoLeaf.DOMSecurity.clearElement(el)`     | Empties through `removeChild` — preferable when children hold listeners   |
| `GeoLeaf.DOMSecurity.clearElementFast(el)` | Empties through `el.textContent = ''` — faster, for listener-free content |

**Example**:

```js
// Correct
GeoLeaf.DOMSecurity.clearElementFast(container);

// To avoid
container.innerHTML = "";
```

This convention guarantees a single DOM-clearing entry point. See `src/kernel/security/dom-security.ts`.

---

## XSS protection in GeoLeaf

### Where security is applied

| Module              | Protection applied                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **POI**             | `escapeHtml()` at render time (popup `setSafeHTML`, side panel `normalizePoi`) + `validateUrl()` on `href`/`src` |
| **GeoJSON**         | `escapeHtml()` on properties inside popups                                                                       |
| **Route**           | `validateUrl()` on GPX/GeoJSON loading URLs                                                                      |
| **Config**          | `validateUrl()` on dataSources URLs                                                                              |
| **UI**              | `escapeHtml()` on every user-supplied text                                                                       |
| **Permalink**       | `validateCoordinates()` and `validateNumber()` on URL parameters                                                 |
| **Content Builder** | `escapeHtml()` and `validateUrl()` imported from `kernel/security`                                               |

### Integration example

```js
// Layer writes go through Security automatically
GeoLeaf.Layers.addFeature("my-points", {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-73.6, 45.5] },
    properties: {
        id: "point-user",
        label: userInput, // may contain malicious HTML
        description: userDesc, // may contain malicious HTML
    },
});

// Internally, the render sinks escape text (popup setSafeHTML, side panel
// normalization) and validate href/src via Security.validateUrl().
```

---

## Best practices

### Do

```js
// Always escape user data
const userName = GeoLeaf.Security.escapeHtml(userInput);
element.innerHTML = `<h1>${userName}</h1>`;

// Validate URLs before fetch
const safeUrl = GeoLeaf.Security.validateUrl(userProvidedUrl);
fetch(safeUrl).then(/* ... */);

// Use sanitizeHTML to inject arbitrary HTML
GeoLeaf.Security.sanitizeHTML(container, richTextFromServer);
```

### Avoid

```js
// NEVER insert raw user HTML directly
element.innerHTML = userInput; // XSS risk

// NEVER load unvalidated URLs
fetch(userUrl); // may be javascript:, file:, etc.

// DO NOT bypass sanitization
poi.properties.popupContent = unsafeHtml; // XSS possible

// DO NOT clear DOM with innerHTML = ''
element.innerHTML = ""; // use DOMSecurity.clearElement instead
```

---

## Tests

The Security module is covered by an extensive test suite:

```bash
# Run security tests
npm test -- security

# Available test files
packages/core/__tests__/security/security.test.js
packages/core/__tests__/security/security-extended.test.js
```

**Coverage**: 95%+ (187+ passing tests)

---

## References

- **OWASP XSS Prevention Cheat Sheet**: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- **MDN — Content Security Policy**: https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
- **Errors module**: `docs/errors/GeoLeaf_Errors_README.md`

---

## See also

- `GeoLeaf.Validators` — structured data validation
- `GeoLeaf.Errors` — typed error handling
- `GeoLeaf.POI` — how POI uses Security
