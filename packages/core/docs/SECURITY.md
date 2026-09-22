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

## 3. CSRF — no client-side module

`GeoLeaf.Security.CSRFToken` was removed in 3.4.0. It minted its token in the browser and checked it in the same context, so no server could verify it: it protected nothing while reading like a protection. GeoLeaf authenticates writes with the bearer token of `@geoleaf-plugins/connector`, which adds it to the requests it intercepts — and a browser never attaches a bearer token on its own, which is the condition a CSRF attack relies on.

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

**In scope:** XSS in the security module, prototype pollution, unsafe HTML injection through the DOM, URL validation bypass, dependency vulnerabilities with a direct exploitation path.

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

The wire contract — the sign-in and renewal requests, the fields each answer must carry, and how
every status is read — is written once, in §3 of the [server contract](./SERVER_CONTRACT.md). What
it means for security:

- The token travels in `Authorization: Bearer <token>`, never in a query string. GeoLeaf never
  decodes it.
- `expiresIn` is a lifetime **in seconds**, and sign-in fails without it.
- **A renewal the server refuses ends the session** — a `404` included: the token is erased and
  `geoleaf:connector:auth-error` is emitted. A server that offers no `POST {endpoint}/refresh`
  therefore ends every session 30 seconds before its expiry. ⚠️ This page used to call the refresh
  route "optional", and said a `404` "degrades silently" with the token staying in use until it
  expires: the session does end then, and loudly.
- Signing out calls no route: a token that must stop working before its expiry has to be revoked
  by the server.

---

### 7.2 JWT token lifecycle

The plugin manages the token through a three-level cache cycle:

| Phase               | Behaviour                                                                           |
| ------------------- | ----------------------------------------------------------------------------------- |
| `configure()`       | Reads the session once: IndexedDB → RAM, and renews an expired token                |
| Synchronous access  | RAM only — the MapLibre bridge and the worker hook, in `auth.endpoint` mode         |
| Asynchronous access | RAM → IDB → refresh if expiry < 5 min                                               |
| Proactive refresh   | Triggered in the background if expiry < 5 min, without blocking the current request |
| Expiry              | Forced refresh; `geoleaf:connector:auth-error` only if the renewal is **refused**   |
| `401` retry         | One retry at most after a refresh attempt; synthetic `401` response on failure      |
| Outage              | A renewal that cannot conclude keeps the session and fires nothing (see below)      |

**Persistence:** IndexedDB, database `geoleaf-connector`, store `auth-tokens`, key `baseUrl`.  
The token survives page reloads but **not** navigation to another origin.

**Only a refusal ends a session.** A renewal the server refuses — a `401`, a `403`, no renewal
offered, a `501`, an answer received whole but unusable — erases the stored token and fires
`geoleaf:connector:auth-error`. A renewal that cannot **conclude** — no network, the time budget spent
(the whole exchange is bounded, body included), a `408`, `429`, `500`, `502`, `503` or `504`, a
body cut in transit — keeps the session: the request gets its `401`, `configure()` resolves
instead of blocking, and the renewal is tried again when the network returns, when the page
comes back to the foreground, and when a capture enters the offline queue. A renewed token is
stored, and a refused one erased, only if it is still the one the renewal presented — a sign-in
or a sign-out made meanwhile wins. With no stored session at all, a `401` is returned as the
server sent it, without a renewal and without `geoleaf:connector:auth-error`.

**Security constraints enforced by the code:**

| Constraint                   | Behaviour                                                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| HTTPS required in production | `ConfigError` thrown if `baseUrl` uses HTTP while the page is not on a development host — `localhost`, `*.localhost`, loopback, `*.test` |
| Token in the header only     | `Authorization: Bearer {token}` — never in a query string                                                                                |
| Password wiped after use     | String overwritten in memory post-login (OWASP A02)                                                                                      |
| Non-JWT token                | `console.warn` if the token contains no `.` — **only in `getToken` callback mode** (not in `auth.endpoint` mode)                         |
| Modal XSS                    | `textContent` only in the login modal — no `innerHTML` with user data                                                                    |

---

### 7.3 Choosing the authentication mode

`getToken` and `auth` are **mutually exclusive** — a `ConfigError` is thrown if both are provided.

| Mode                   | Configuration                   | Use case                                                                                                                                                                                                                            |
| ---------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Standalone + modal** | `auth: { endpoint, ui: true }`  | Own backend returning `{ token, expiresIn }`; the modal is handled by the plugin                                                                                                                                                    |
| **Silent standalone**  | `auth: { endpoint, ui: false }` | Token preloaded into IDB during an earlier session — no modal. If no session is stored, or its renewal is refused, a `ConfigError` is thrown; a stored session whose renewal cannot be reached is kept, and `configure()` resolves. |
| **Async callback**     | `getToken: async () => token`   | External SSO through an identity SDK running in the page — the plugin delegates resolution                                                                                                                                          |

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

**Returning `null` sends the request without a token.** If the server answers `401`, the connector
asks once more, and a second `null` emits `geoleaf:connector:auth-error`. Never return an expired
token to avoid a `null` — a silent `401` is harder to diagnose than an explicit auth error.

The provider is called for every request that needs the token — each intercepted `fetch`, each
vector tile, each GeoJSON load the worker makes — and nothing keeps a copy. A provider that
answers with a promise reaches the tiles on MapLibre 5.21 or later and the worker on
`@geoleaf/core` 3.4.0 or later. One that throws or rejects fails the page's request with its
error; tiles and worker loads go without a token until it answers again.

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
default success response carries no lifetime. Without it, sign-in fails ("Invalid server response:
missing token or expiresIn"). If your library omits it, add it to the response payload — its own
token-TTL setting is the value to expose.

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
