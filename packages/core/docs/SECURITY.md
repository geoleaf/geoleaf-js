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
| **Async callback**     | `getToken: async () => token`   | External SSO (keycloak-js, Auth0 SPA SDK) — the plugin delegates resolution                                                      |

---

### 7.4 Keycloak integration

The native Keycloak endpoint (`/protocol/openid-connect/token`) expects `grant_type=password` as `application/x-www-form-urlencoded` — a format incompatible with the connector. Two approaches are possible.

**Approach A — `getToken()` with `keycloak-js`** (recommended for SSO deployments)

keycloak-js handles the session cycle and the refresh; the connector simply reads the current token.

```js
import Keycloak from "keycloak-js";

const keycloak = new Keycloak({
    url: "https://keycloak.example.com",
    realm: "myrealm",
    clientId: "geoleaf-app",
});

await keycloak.init({ onLoad: "login-required" });

await GeoLeaf.Connector.configure({
    baseUrl: "https://api.example.com",
    getToken: async () => {
        // Request a refresh if the token expires in less than 30 s
        await keycloak.updateToken(30);
        return keycloak.token ?? null;
    },
});
```

**Approach B — Backend adapter**

An intermediate endpoint translates the connector format into the Keycloak ROPC protocol:

```
POST /api/auth/login        ← receives { login, password }
    → POST keycloak /token  ← grant_type=password + form-encoded
    ← { token: access_token, expiresIn: expires_in }
```

```js
await GeoLeaf.Connector.configure({
    baseUrl: "https://api.example.com",
    auth: {
        endpoint: "https://api.example.com/api/auth/login",
        ui: true,
    },
});
```

---

### 7.5 Auth0 integration

Auth0 deprecates the Resource Owner Password flow. The recommended approach is the callback with the Auth0 SPA SDK.

**Via `getToken()` with the Auth0 SPA SDK**

```js
import { createAuth0Client } from "@auth0/auth0-spa-js";

const auth0 = await createAuth0Client({
    domain: "your-tenant.auth0.com",
    clientId: "YOUR_CLIENT_ID",
    authorizationParams: { audience: "https://api.example.com" },
});

await GeoLeaf.Connector.configure({
    baseUrl: "https://api.example.com",
    getToken: async () => {
        try {
            return await auth0.getTokenSilently();
        } catch {
            return null; // Triggers connector:auth-error if the request fails (401)
        }
    },
});
```

The token returned by `getTokenSilently()` is a valid RS256-signed JWT — the connector passes it straight into `Authorization: Bearer`.

---

### 7.6 Symfony integration

Symfony with `json_login` is natively compatible with the connector protocol (JSON request `{ login, password }`).

**`config/packages/security.yaml`**

```yaml
firewalls:
    api:
        pattern: ^/api
        stateless: true
        json_login:
            check_path: /api/auth/login
            username_path: login # maps the "login" field → internal username
            password_path: password
            success_handler: lexik_jwt_authentication.handler.authentication_success
            failure_handler: lexik_jwt_authentication.handler.authentication_failure
```

The default response of `lexik/jwt-authentication-bundle` does not contain `expiresIn`. Add an event listener to include it:

```php
// src/EventListener/JwtSuccessListener.php
use Lexik\Bundle\JWTAuthenticationBundle\Event\AuthenticationSuccessEvent;

class JwtSuccessListener
{
    public function __construct(private readonly string $jwtTtl) {}

    public function onAuthenticationSuccess(AuthenticationSuccessEvent $event): void
    {
        $data = $event->getData();
        $data['expiresIn'] = (int) $this->jwtTtl; // lexik_jwt.token_ttl parameter
        $event->setData($data);
    }
}
```

**Refresh**: `gesdinet/jwt-refresh-token-bundle` exposes `/api/token/refresh` — the connector reaches it automatically through `POST {endpoint}/refresh` when `endpoint` = `/api/auth/login`.

```js
await GeoLeaf.Connector.configure({
    baseUrl: "https://api.example.com",
    auth: {
        endpoint: "https://api.example.com/api/auth/login",
        ui: true,
    },
});
```

---

### 7.7 Laravel integration

With `laravel/sanctum` (API tokens) or a custom JWT controller.

**`AuthController` controller**

```php
// routes/api.php
Route::post('/auth/login', [AuthController::class, 'login']);
Route::post('/auth/login/refresh', [AuthController::class, 'refresh']); // optional

// app/Http/Controllers/AuthController.php
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class AuthController extends Controller
{
    public function login(Request $request): JsonResponse
    {
        $credentials = $request->validate([
            'login'    => 'required|string',   // the connector's "login" field
            'password' => 'required|string',
        ]);

        if (!Auth::attempt(['email' => $credentials['login'], 'password' => $credentials['password']])) {
            return response()->json(['message' => 'Invalid credentials'], 401);
        }

        $token = $request->user()->createToken('geoleaf')->plainTextToken;

        return response()->json([
            'token'     => $token,
            'expiresIn' => 86400, // 24 h in seconds
        ]);
    }
}
```

```js
await GeoLeaf.Connector.configure({
    baseUrl: "https://api.example.com",
    auth: {
        endpoint: "https://api.example.com/api/auth/login",
        ui: true,
    },
});
```

> **Note:** Sanctum tokens are opaque tokens, not JWTs. Using GeoLeaf Connector with Sanctum through the `getToken` callback mode would make the plugin emit a `console.warn`, because they contain no `.`. With the `auth.endpoint` mode used here, that check does not apply — no warning is emitted.
