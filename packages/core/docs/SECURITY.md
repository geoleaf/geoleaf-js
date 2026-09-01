---
title: "GeoLeaf Core — Security Guide"
---

# GeoLeaf Core — Security Guide

**Applies to:** `@geoleaf/core` v3.x

> Guide for consumers of `@geoleaf/core`. It covers the required CSP directives, the security architecture and the responsible disclosure process.

---

## 1. Recommended Content Security Policy (CSP)

GeoLeaf depends on MapLibre GL JS (WebGL, workers) and on external map resources. The recommended minimal CSP is:

```http
Content-Security-Policy:
  default-src 'self';
  script-src  'self';
  style-src   'self';
  img-src     'self' data: https:;
  connect-src 'self' https:;
  worker-src  'self' blob:;
  font-src    'self';
```

::: info

`font-src` is `'self'` because the core loads no external font — the typeface is a system stack. The authoritative value is the one in [security/SECURITY_CONTRACT.md](security/SECURITY_CONTRACT.md) §4; both tables describe the same object.

:::

::: warning

This table is the minimum required by the **core**, not the policy of the deployed demonstration application. The two do not coincide, and do not have to: the demonstration application serves `font-src 'self' data:` (the `data:` covers its embedded icon fonts) and `script-src 'self' blob:`, declared in its own `index.html`. An integrator composing their own document starts from the table above; there is no need to inherit the demonstration application's requirements.

:::

> **Strict `style-src` (no `'unsafe-inline'`)**: since v2.2.1, GeoLeaf no longer requires `'unsafe-inline'`. Dynamic styles are applied through the CSSOM property by property (`element.style.setProperty`, public helpers `GeoLeaf.Helpers.applyCssText` / `applyDeferredStyles`) or through CSS classes — forms that are **not** subject to `style-src`, unlike `element.style.cssText`, `setAttribute('style', …)` and `style` attributes (now eliminated from rendering: markers, panels, sprite). For the full inventory and CSP matrix, see [security/SECURITY_CONTRACT.md](security/SECURITY_CONTRACT.md) §4.

> **`worker-src blob:`** is required by the MapLibre Web Workers (tile decoding, GeoJSON parsing).

---

## 2. GeoLeaf Core security architecture

GeoLeaf implements several independent layers of protection:

| Layer              | Module                               | Key functions                                                                                                                              |
| ------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| XSS protection     | `kernel/security/`                   | `escapeHtml()`, `escapeAttribute()`, `sanitizeHTML()`, `sanitizeSvgContent()`                                                              |
| CSRF protection    | `kernel/security/csrf-token.ts`      | Token generation (32 crypto-random bytes), automatic rotation, `Secure; SameSite=Strict` cookie                                            |
| DOM security       | `kernel/security/dom-security.ts`    | `DOMSecurity.setTextContent()`, `DOMSecurity.setSafeHTML()` — no direct `innerHTML`                                                        |
| Input validation   | `kernel/security/validators.ts`      | URL protocol allowlist (`https:`, `http:`, `data:image/*`), coordinate bounds, GeoJSON structure                                           |
| Fetch security     | `utils/general/fetch-helper.ts`      | URL validation + rate limiting (50 requests / 10 s / domain)                                                                               |
| Error sanitisation | `utils/errors/errors.ts`             | `sanitizeErrorMessage()` — escapes HTML in error messages                                                                                  |
| Prototype guard    | `utils/general/object-path-guard.ts` | `isUnsafeKey()` / `hasUnsafeSegment()` — **single canonical** blocklist (`__proto__`, `constructor`, `prototype`), applied by 7 sink files |

### Covered vectors (summary)

- **DOM injection**: 12 identified vectors (POI popup, tooltip, labels, search results, etc.) — all sanitised through `escapeHtml()` or `DOMSecurity.*`
- **URL injection**: 7 vectors (`url`, `website`, `image` fields, permalink lat/lng/zoom) — validated through `validateUrl()` + `validateCoordinates()`
- **Prototype pollution**: 5 vectors (JSON profile config, **a profile's `modules` bag**, POI properties, GeoJSON styles, compact permalink) — blocked by a **single canonical** blocklist, `isUnsafeKey()` / `hasUnsafeSegment()` (`utils/general/object-path-guard.ts`), applied by the 7 sink files; the permalink additionally goes through a type revalidation

For the full inventory with source files and tests, see [security/SECURITY_CONTRACT.md](security/SECURITY_CONTRACT.md).

---

## 3. CSRF — v2.0.0 breaking change note

`CSRFToken.setSecureCookie()` defaults to `secure: true` since v2.0.0.

On an HTTP-only deployment (local development, intranets) this produces a console warning but does not prevent operation. To silence the warning:

```typescript
CSRFToken.setSecureCookie("my-cookie", value, { secure: false });
```

---

## 4. Known limitations

| Limitation                                    | Reason                                     | Mitigation                                                       |
| --------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| `data:` URLs allowed for images               | POI profiles support base64 icons          | Strict MIME filtering (`image/*` only, via `_validateDataUrl()`) |
| `http:` allowed by default in `validateUrl()` | Non-HTTPS contexts (development, intranet) | Pass `{ httpsOnly: true }` to force HTTPS                        |
| Unauthenticated service worker                | Outside the scope of the library           | Implement service worker authentication in the application       |

---

## 5. Responsible disclosure

**Do not report vulnerabilities through public GitHub issues.**

### Contact

|                   |                           |
| ----------------- | ------------------------- |
| Email             | **contact@geoleaf.dev**   |
| Acknowledgement   | Within 48 h               |
| Initial triage    | Within 5 days             |
| Fix or workaround | Within 30 days            |
| Public disclosure | After the fix is released |

GeoLeaf follows a **coordinated disclosure** model. Please allow time for the vulnerability to be addressed before any publication.

### Scope

**In scope:** XSS in the security module, CSRF bypass, prototype pollution, unsafe HTML injection through the DOM, URL validation bypass, dependency vulnerabilities with a direct exploitation path.

**Out of scope:** vulnerabilities in MapLibre GL JS or other dependencies (report them to those projects directly), physical access, social engineering, unsupported versions (any major release earlier than the current one), denial of service.

---

## 6. References

| Document                                                                                   | Description                                               |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| [security/GeoLeaf_Security_README.md](security/GeoLeaf_Security_README.md)                 | Full API of the security module (signatures, examples)    |
| [security/SECURITY_CONTRACT.md](security/SECURITY_CONTRACT.md)                             | Exhaustive inventory of injection vectors and their tests |
| [.github/SECURITY.md](https://github.com/geoleaf/geoleaf-js/blob/main/.github/SECURITY.md) | Official security policy (responsible disclosure)         |

---

## 7. HTTP authentication — JWT integration guide

> This section covers integrating the `@geoleaf-plugins/connector` plugin with external authentication providers. For installation and basic scenarios, see the `docs/CONNECTOR_GUIDE.md` shipped by `@geoleaf-plugins/connector` — that guide belongs to the plugin package, not to the core.

---

### 7.1 HTTP protocol expected by `@geoleaf-plugins/connector`

The plugin imposes a strict HTTP contract on the backend, defined in `auth-client.ts`.

**Login endpoint (POST)**

```
POST {endpoint}
Content-Type: application/json

{ "login": "user@example.com", "password": "secret" }
```

Expected response:

```json
{ "token": "<jwt>", "expiresIn": 3600 }
```

| Field       | Type     | Description                                                   |
| ----------- | -------- | ------------------------------------------------------------- |
| `token`     | `string` | JWT or opaque token — passed as-is in `Authorization: Bearer` |
| `expiresIn` | `number` | Validity period **in seconds**                                |

Both fields are required — an `AuthError` is thrown if either is missing or of the wrong type.

HTTP status codes interpreted by the plugin:

| Status | Behaviour                                       |
| ------ | ----------------------------------------------- |
| `200`  | Token extracted and persisted                   |
| `401`  | `AuthError("Invalid credentials")`              |
| `404`  | `AuthError("Endpoint not found (404)")`         |
| `5xx`  | `AuthError("Server error ({status})")`          |
| Other  | `AuthError("Authentication failed ({status})")` |

**Refresh endpoint (POST, optional)**

```
POST {endpoint}/refresh
Authorization: Bearer {current_token}
Content-Type: application/json
```

Response: the same `{ token, expiresIn }` format. The plugin degrades silently on `404` (refresh not supported) — no error is thrown, and the existing token stays in use until it expires.

---

### 7.2 JWT token lifecycle

The plugin manages the token through a three-level cache cycle:

| Phase               | Behaviour                                                                           |
| ------------------- | ----------------------------------------------------------------------------------- |
| `configure()`       | Warms the IndexedDB cache → RAM (non-blocking access)                               |
| Synchronous access  | RAM only — used by the MapLibre bridge (`setTransformRequest`)                      |
| Asynchronous access | RAM → IDB → refresh if expiry < 5 min                                               |
| Proactive refresh   | Triggered in the background if expiry < 5 min, without blocking the current request |
| Expiry              | Forced refresh; `connector:auth-error` event if the refresh fails                   |
| `401` retry         | One retry at most after a refresh attempt; synthetic `401` response on failure      |

**Persistence:** IndexedDB, database `geoleaf-connector`, store `auth-tokens`, key `baseUrl`.  
The token survives page reloads but **not** navigation to another origin.

**Security constraints enforced by the code:**

| Constraint                   | Behaviour                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| HTTPS required in production | `ConfigError` thrown if `baseUrl` uses HTTP outside `localhost`/`127.0.0.1`                                      |
| Token in the header only     | `Authorization: Bearer {token}` — never in a query string                                                        |
| Password wiped after use     | String overwritten in memory post-login (OWASP A02)                                                              |
| Non-JWT token                | `console.warn` if the token contains no `.` — **only in `getToken` callback mode** (not in `auth.endpoint` mode) |
| Modal XSS                    | `textContent` only in the login modal — no `innerHTML` with user data                                            |

---

### 7.3 Choosing the authentication mode

`getToken` and `auth` are **mutually exclusive** — a `ConfigError` is thrown if both are provided.

| Mode                   | Configuration                   | Use case                                                                                                                         |
| ---------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Standalone + modal** | `auth: { endpoint, ui: true }`  | Own backend returning `{ token, expiresIn }`; the modal is handled by the plugin                                                 |
| **Silent standalone**  | `auth: { endpoint, ui: false }` | Token preloaded into IDB during an earlier session — no modal. If no valid token is found at startup, a `ConfigError` is thrown. |
| **Async callback**     | `getToken: async () => token`   | External SSO through an identity SDK running in the page — the plugin delegates resolution                                       |

---

### 7.4 Mode callback (`getToken`) — delegating to an identity provider

Use this mode when an identity SDK already runs in the page and owns the session: it holds the
token, refreshes it, and the connector merely reads the current value at each request.

```js
await GeoLeaf.Connector.configure({
    baseUrl: "https://api.example.com",
    getToken: async () => {
        // Ask the SDK to refresh if the token expires within 30 s, then hand it over.
        await authClient.refreshIfExpiringWithin(30);
        return authClient.token ?? null;
    },
});
```

**Returning `null` is meaningful**: it makes the connector emit `connector:auth-error`, the same
path a `401` takes. Never return an expired token to avoid a `null` — a silent `401` is harder to
diagnose than an explicit auth error.

A JWT signed with RS256 is passed straight into `Authorization: Bearer`, unchanged.

---

### 7.5 Mode `auth.endpoint` — a login endpoint on your server

Use this mode when the server exposes a login route. The connector posts
`{ login, password }` as **JSON** and expects `{ token, expiresIn }` back. When `ui: true`, the
plugin renders the modal itself.

```js
await GeoLeaf.Connector.configure({
    baseUrl: "https://api.example.com",
    auth: {
        endpoint: "https://api.example.com/api/auth/login",
        ui: true,
    },
});
```

**Refresh is derived, not configured**: the connector reaches `POST {endpoint}/refresh`
automatically — with the endpoint above, that is `/api/auth/login/refresh`.

⚠️ **`expiresIn` is frequently missing.** Many JWT libraries return only the token, and their
default success response carries no lifetime. Without it the connector cannot schedule a refresh.
If your library omits it, add it to the response payload — its own token-TTL setting is the value
to expose.

---

### 7.6 Three traps that do not depend on which server you run

**① A native OAuth 2.0 password flow is NOT compatible with this contract.** The ROPC grant
(RFC 6749 §4.3, the `/token` endpoint of most OIDC servers) expects `grant_type=password` encoded
as `application/x-www-form-urlencoded`. The connector sends **JSON**. Two ways out: use the
callback mode of §7.4 with the provider's own SDK, or put a thin adapter in front:

```
POST /api/auth/login          ← receives { login, password }   (connector format)
    → POST <provider> /token  ← grant_type=password, form-encoded
    ← { token: access_token, expiresIn: expires_in }
```

⚠️ Note that ROPC is **deprecated by most modern providers** — prefer §7.4 when the provider
offers a browser SDK.

**② Opaque tokens are accepted, but only in one of the two modes.** Some API-token schemes issue
opaque strings rather than JWTs. Because they contain no `.`, the plugin emits a `console.warn`
**in `getToken` mode**. Through `auth.endpoint` that check does not apply and no warning is
emitted — the mode you choose changes the diagnostics you get, not the validity of the token.

**③ Field names are part of the contract.** The connector sends `login`, not `username`. Servers
whose login route reads `username` need an explicit mapping — most authentication layers expose a
setting for exactly this, and getting it wrong yields a `401` with no other symptom.
