---
title: "GeoLeaf.Security — Documentation du module Security"
---

# GeoLeaf.Security — Documentation du module Security

Product Version: GeoLeaf Platform V3
**Version**: 3.0.0
**Fichier source (monorepo)** : `packages/core/src/modules/built-in/security/index.ts`
**Module CSRF** : `packages/core/src/modules/built-in/security/csrf-token.ts`
**Date**: mars 2026

---

## Vue d'ensemble

Le module **GeoLeaf.Security** fournit des fonctions de sécurité centralisées pour protéger l'application contre les vulnérabilités XSS (Cross-Site Scripting), les injections malveillantes et les attaques CSRF.

### Responsabilités principales

- **Échappement HTML** — neutralise les caractères HTML dangereux
- **Validation d'URLs** — whitelist de protocoles autorisés (`http:`, `https:`, `data:image/`)
- **Sanitization de données** — nettoie les propriétés des POI/GeoJSON
- **Protection XSS** — prévention des attaques par injection de code
- **Sanitization HTML** — parse HTML avec tag allowlist, injection DOM sécurisée
- **Sanitization SVG** — supprime scripts et handlers d'événements des SVG externes
- **Validation de nombres** — rejette NaN, Infinity et valeurs hors-range
- **Tokens CSRF** — génération, validation et rotation de tokens anti-CSRF

---

## Fonctions de sécurité

### `escapeHtml(str)`

Échappe les caractères HTML dangereux pour prévenir les attaques XSS.
Utilise `div.textContent` + `div.innerHTML` — méthode native, sans regex.

**Signature** :

```ts
escapeHtml(str: string | null | undefined): string
```

**Exemple** :

```js
const userInput = '<script>alert("XSS")</script>';
const safe = GeoLeaf.Security.escapeHtml(userInput);
// Returns: '&lt;script&gt;alert("XSS")&lt;/script&gt;'

element.innerHTML = GeoLeaf.Security.escapeHtml(userInput);
```

**Caractères échappés** : `<` `>` `&` `"` `'`

**Remarque** : `null` et `undefined` retournent `""`.

---

### `escapeAttribute(str)`

Échappe les caractères pour une utilisation sûre dans les attributs HTML.

**Signature** :

```ts
escapeAttribute(str: string | null | undefined): string
```

**Exemple** :

```js
const userValue = 'value" onclick="alert(1)';
const safe = GeoLeaf.Security.escapeAttribute(userValue);
// Returns: 'value&quot; onclick=&quot;alert(1)'

const html = `<input value="${safe}">`;
```

---

### `validateUrl(url, baseUrl?, options?)`

Valide une URL avec une whitelist stricte de protocoles autorisés.

**Signature** :

```ts
validateUrl(url: string, baseUrl?: string, options?: ValidateUrlOptions): string
```

**Paramètres** :

- `url` : URL à valider (obligatoire)
- `baseUrl` : URL de base pour résolution relative (défaut: `location.origin`)
- `options.httpsOnly` : `true` = rejette `http:`, autorise seulement `https:` et `data:image/`

**Protocoles autorisés** (mode normal) :

- `http:`
- `https:`
- `data:` — uniquement pour les types image autorisés (`image/png`, `image/jpeg`, `image/gif`, `image/svg+xml`, `image/webp`)

**Exemples** :

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
    console.error("URL non autorisée:", error.message);
}

// HTTPS-only mode
GeoLeaf.Security.validateUrl("https://example.com/data", undefined, { httpsOnly: true });
```

**Erreurs lancées** :

- `TypeError` : URL vide ou non-string
- `Error` : Protocole non autorisé

---

### `validateCoordinates(lat, lng)`

Valide des coordonnées géographiques (latitude et longitude).

**Signature** :

```ts
validateCoordinates(lat: number, lng: number): [number, number]
```

**Rejette** : NaN, Infinity, valeurs hors des plages `[-90, 90]` (lat) et `[-180, 180]` (lng).

**Exemple** :

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

Détecte les patterns HTML potentiellement dangereux (XSS vectors).

**Signature** :

```ts
containsDangerousHtml(str: unknown): boolean
```

Détecte : `<script`, `javascript:`, handlers `on*=`, `<iframe`, `<object`, `<embed`, `<meta`, `data:text/html`, `<form`, etc.

**Exemple** :

```js
GeoLeaf.Security.containsDangerousHtml("<script>alert(1)</script>"); // true
GeoLeaf.Security.containsDangerousHtml("Normal text"); // false
```

---

### `stripHtml(html)`

Supprime tout le HTML d'une chaîne, ne conservant que le texte.

**Signature** :

```ts
stripHtml(html: string): string
```

```js
const text = GeoLeaf.Security.stripHtml("<h1>Hello <b>World</b></h1>");
// Returns: "Hello World"
```

---

### `createSafeElement(tagName, options)`

Crée un élément DOM de manière sécurisée avec échappement automatique du contenu.

**Signature** :

```ts
createSafeElement(tagName: string, options?: SafeElementOptions): Element
```

**Options** : `className`, `id`, `textContent`, `attributes` (valeurs échappées via `escapeAttribute`), `children`

```js
const el = GeoLeaf.Security.createSafeElement("div", {
    className: "gl-poi-name",
    textContent: userInput,
    attributes: { "data-id": poiId },
});
```

---

### `sanitizeSvgContent(svgContent)`

Parse et sanitize un contenu SVG externe : supprime les scripts, `foreignObject`, handlers `on*` et `href` javascript.

**Signature** :

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

Valide qu'une valeur est un nombre fini dans un intervalle donné.

**Signature** :

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

Parse du HTML avec un allowlist de tags. Convertit les éléments non autorisés en nœuds texte. Valide les `href` des liens via `validateUrl`.

**Signature** :

```ts
parseHtmlSafely(html: string, allowedTags?: string[]): DocumentFragment
```

Tags autorisés par défaut : `p`, `br`, `strong`, `em`, `span`, `a`, `ul`, `ol`, `li`, `b`, `i`

```js
const fragment = GeoLeaf.Security.parseHtmlSafely(
    "<p>Texte <b>gras</b> <script>alert(1)</script></p>"
);
// Returns a DocumentFragment with <script> converted to text node
container.appendChild(fragment);
```

---

### `sanitizeHTML(element, html, options?)`

Sanitize du HTML et l'injecte dans un élément DOM de façon sécurisée. Point d'entrée principal pour l'injection HTML dans le DOM.

**Signature** :

```ts
sanitizeHTML(element: Element, html: string | null | undefined, options?: SanitizeHtmlOptions): Element | null
```

**Options** :

- `stripAll: true` — supprime tous les tags (texte seulement)
- `allowedTags: string[]` — tags autorisés personnalisés

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

## Module CSRF (`csrf-token.ts`)

### `GeoLeaf.Security.CSRF` / `CSRFToken`

Gestionnaire de tokens anti-CSRF basé sur `crypto.getRandomValues`.

**API** :

| Méthode                                        | Description                                             |
| ---------------------------------------------- | ------------------------------------------------------- |
| `CSRFToken.init()`                             | Génère le token initial et démarre l'auto-refresh       |
| `CSRFToken.getToken()`                         | Retourne le token courant (régénère si expiré)          |
| `CSRFToken.validateToken(token)`               | Valide un token reçu                                    |
| `CSRFToken.addTokenToData(data)`               | Ajoute le token à un objet ou FormData                  |
| `CSRFToken.addTokenToHeaders(options)`         | Ajoute `X-CSRF-Token` aux headers fetch                 |
| `CSRFToken.createTokenInput()`                 | Crée un `<input type="hidden" name="csrf_token">`       |
| `CSRFToken.addTokenToForm(form)`               | Ajoute le token à un formulaire HTML                    |
| `CSRFToken.validateFormToken(data)`            | Valide le token depuis un FormData/objet                |
| `CSRFToken.setSecureCookie(name, value, opts)` | Définit un cookie avec `Secure`, `SameSite`, `HttpOnly` |
| `CSRFToken.rotateToken()`                      | Rotation manuelle du token                              |
| `CSRFToken.getTokenInfo()`                     | Retourne `{ hasToken, expiresIn, isValid }`             |
| `CSRFToken.destroy()`                          | Détruit le token et arrête l'auto-refresh               |

**Exemple** :

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

## Convention de vidage du DOM

**Règle** : pour vider le contenu d'un élément (supprimer ses enfants), ne pas utiliser `element.innerHTML = ''`.

Utiliser à la place :

| Méthode                                    | Usage                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------- |
| `GeoLeaf.DOMSecurity.clearElement(el)`     | Vide via `removeChild` — préférable si listeners attachés aux enfants |
| `GeoLeaf.DOMSecurity.clearElementFast(el)` | Vide via `el.textContent = ''` — plus rapide, contenu sans listeners  |

**Exemple** :

```js
// Correct
GeoLeaf.DOMSecurity.clearElementFast(container);

// To avoid
container.innerHTML = "";
```

Cette convention garantit un point unique de vidage du DOM. Voir `src/kernel/security/dom-security.ts` (déplacé au STRUCT S6 depuis `utils/general/`).

---

## Protection XSS dans GeoLeaf

### Où la sécurité est appliquée

| Module              | Protection appliquée                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| **POI**             | `escapeHtml()` au rendu (popup `setSafeHTML`, sidepanel `normalizePoi`) + `validateUrl()` sur `href`/`src` |
| **GeoJSON**         | `escapeHtml()` sur les propriétés dans popups                                                              |
| **Route**           | `validateUrl()` sur les URLs de chargement GPX/GeoJSON                                                     |
| **Config**          | `validateUrl()` sur les URLs de dataSources                                                                |
| **UI**              | `escapeHtml()` sur tous les textes utilisateur                                                             |
| **Permalink**       | `validateCoordinates()` et `validateNumber()` sur les paramètres URL                                       |
| **Content Builder** | `escapeHtml()` et `validateUrl()` importés depuis `built-in/security`                                      |

### Exemple d'intégration

```js
// Layer writes go through Security automatically
GeoLeaf.Layers.addFeature("mes-points", {
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

## Bonnes pratiques

### A FAIRE

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

### A EVITER

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

Le module Security est couvert par des tests Jest complets :

```bash
# Run security tests
npm test -- security

# Available test files
packages/core/__tests__/security/security.test.js
packages/core/__tests__/security/security-extended.test.js
```

**Couverture** : 95%+ (187+ tests passants)

---

## Références

- **OWASP XSS Prevention Cheat Sheet** : https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- **MDN - Content Security Policy** : https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
- **Module Errors** : `docs/errors/GeoLeaf_Errors_README.md`

---

## Voir aussi

- `GeoLeaf.Validators` — Validation de données structurées
- `GeoLeaf.Errors` — Gestion d'erreurs typées
- `GeoLeaf.POI` — Utilisation de Security dans POI
