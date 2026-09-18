# @geoleaf-plugins/connector

MIT plugin for GeoLeaf — transparent authentication and `Authorization` header injection on every
GeoJSON / WFS / REST fetch request.

[![npm](https://img.shields.io/npm/v/@geoleaf-plugins/connector)](https://www.npmjs.com/package/@geoleaf-plugins/connector)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## Installation

```bash
npm install @geoleaf-plugins/connector
```

> **Important** — Requires `@geoleaf/core` v3.x. The core is declared in **`dependencies`**, not in
> `peerDependencies`. This means npm may install a **second copy** of the core rather than reusing
> yours; deduplicate if your bundler reports two instances.

---

## Quick start

Static token — scenario S6 in the table below, for development and public demos:

```html
<script type="module" src="geoleaf-connector.plugin.js"></script>
<script>
    GeoLeaf.Connector.configure({
        baseUrl: "http://localhost:3000",
        getToken: () => "MY_DEV_TOKEN",
    });
</script>
```

> **Note** — A `console.warn` is emitted when the token contains no `.` (not a JWT). This is
> expected in development mode.

---

## Usage scenarios

| Scenario | Config                                      | Use case                                  |
| -------- | ------------------------------------------- | ----------------------------------------- |
| S1       | `getToken: () => 'static'`                  | Development / smoke test without a server |
| S2       | `auth: { endpoint, ui: true }`              | Login modal + JWT + auto refresh (IDB)    |
| S3       | `getToken: () => localStorage.getItem(...)` | Existing SSO — external token             |
| S4       | `getToken: async () => await myAuth.get()`  | Async provider (any identity SDK)         |
| S5       | `auth: { endpoint, ui: false }`             | Token preloaded in IDB — silent           |
| S6       | `getToken: () => 'STATIC_DEV_TOKEN'`        | Non-sensitive data, public demo           |

---

## API

### `GeoLeaf.Connector.configure(config)`

```typescript
await GeoLeaf.Connector.configure({
    baseUrl: "https://api.example.com",
    getToken: () => "JWT_TOKEN",
    // — OR —
    auth: {
        endpoint: "https://api.example.com/auth/login",
        ui: true, // Show login modal if no valid token found
        signupUrl: "https://app.example.com/signup", // "Create an account" link (optional)
        forgotPasswordUrl: "https://app.example.com/forgot", // "Forgot password" link (optional)
        credentialButton: {
            enabled: true, // Auto-inject credential button in UI
            iconVariant: "lock", // "lock" (default) or "user"
        },
    },
});
```

`getToken` and `auth` are mutually exclusive.

With `getToken`, the provider is called for **every** request that needs the token: each
intercepted `fetch`, each vector tile, each GeoJSON load the worker makes. Nothing keeps a copy.
A provider that answers with a promise reaches the tiles on MapLibre 5.21 or later, and the
GeoJSON worker on `@geoleaf/core` 3.4.0 or later; older versions send those requests without a
token. A provider that throws or rejects fails the page's request with its error, while tiles
and worker loads go without a token until it answers again.

### `GeoLeaf.Connector.openLoginModal()`

Opens the login modal manually. Requires a prior `configure()` call carrying `auth`.

```javascript
GeoLeaf.Connector.openLoginModal();
```

### `createConnector(config)` — ESM named export

For advanced integration cases and unit tests:

```typescript
import { createConnector } from "@geoleaf-plugins/connector";

const conn = createConnector({ baseUrl: "...", getToken: () => "TOKEN" });
const token = await conn.getTokenAsync();
conn.destroy();
```

The instance installs no fetch interception, worker hook, tile bridge or renewal delegate, and never
opens the login window, `auth.ui` included. With `auth.endpoint`, it renews its own reads against
**its** endpoint, and `destroy()` only deactivates its token reads: the `configure()` singleton's
session, renewal included, is never its business. ⚠️ A session is still a `baseUrl`'s: an instance
and `configure()` on the same API share the stored token.

---

## DOM events

| Event                                         | Detail                       | Fired when                  | Cancelable |
| --------------------------------------------- | ---------------------------- | --------------------------- | ---------- |
| `geoleaf:connector:authenticated`             | `{ baseUrl }`                | Login modal succeeded       | No         |
| `geoleaf:connector:token-refreshed`           | `{ baseUrl }`                | Automatic renewal succeeded | No         |
| `geoleaf:connector:auth-error`                | `{ baseUrl, error }`         | The session ended: refused  | No         |
| `geoleaf:connector:credential-button-clicked` | `{ baseUrl, authenticated }` | Credential button clicked   | No         |
| `geoleaf:connector:signup-requested`          | `{ url }`                    | "Create an account" clicked | **Yes**    |
| `geoleaf:connector:forgot-password-requested` | `{ url }`                    | "Forgot password" clicked   | **Yes**    |

The `cancelable` events let the host application intercept the default behaviour through
`preventDefault()`:

```javascript
document.addEventListener("geoleaf:connector:signup-requested", (e) => {
    e.preventDefault(); // Prevents the link from opening
    myApp.showCustomSignup(); // Show a custom UI instead
});
```

```javascript
document.addEventListener("geoleaf:connector:authenticated", (e) => {
    console.log("Authenticated on", e.detail.baseUrl);
});
```

### When the authentication server cannot be reached

`auth-error` means the session **ended**: the renewal was refused (a `401`, a `403`, no renewal
offered, an answer that cannot be used). A renewal that could not **conclude** — no network, a
time-out, a `503`, a body cut in transit — keeps the session and fires nothing:

- a request that met a `401` gets it back, and the core's drain waits for the session;
- `configure()` resolves when a stored session cannot be renewed right now — with or without
  `auth.ui` — instead of opening a login window that needs the missing network;
- the renewal is tried again when the network returns, when the application comes back to the
  foreground, and when a capture enters the offline queue. Online, in the foreground and with no
  new capture, it waits for the next of those moments.

### What a returning session does to the offline queue

When the session had died, the core's drain stopped at the first `401` and set that capture
aside; it cannot see a sign-in, so it waits. On `authenticated` and on `token-refreshed`, this
plugin therefore asks the core to take them back, through two public calls:

```javascript
await GeoLeaf.Storage.requeueAll("authRequired");
await GeoLeaf.Storage.pushOutbox();
```

An application that signs in by its own means makes exactly those two calls. Without the
offline capability, there is nothing to resume and nothing happens.

A session can also come back before the offline engine does: a `configure()` called before
`GeoLeaf.boot()` renews an expired session while `GeoLeaf.Storage` has no engine yet, and both
calls answer `engineUnavailable`. The plugin then waits for `GeoLeaf.Storage.whenReady()`, lets
the core's own first pass end, and makes the two calls — once per page, however many renewals
came before.

---

## Security

- The token is **never** passed in a query string.
- Passwords are wiped from memory after use (`OWASP A02`).
- `baseUrl` must use HTTPS in production (an error is raised otherwise).
- The modal's XSS sanitisation relies on `textContent` — no `innerHTML` with user data.
- Vector tiles (MVT) get the token through `map.setTransformRequest()` (MapLibre bridge); PMTiles
  archives through `window.fetch`, which the `pmtiles` library reads them with.

---

## License

MIT — see [LICENSE](LICENSE).
