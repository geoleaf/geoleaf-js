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

---

## DOM events

| Event                                         | Detail                       | Fired when                       | Cancelable |
| --------------------------------------------- | ---------------------------- | -------------------------------- | ---------- |
| `geoleaf:connector:authenticated`             | `{ baseUrl }`                | Login modal succeeded            | No         |
| `geoleaf:connector:token-refreshed`           | `{ baseUrl }`                | Automatic refresh (JWT expiring) | No         |
| `geoleaf:connector:auth-error`                | `{ baseUrl, error }`         | 401 after a refresh attempt      | No         |
| `geoleaf:connector:credential-button-clicked` | `{ baseUrl, authenticated }` | Credential button clicked        | No         |
| `geoleaf:connector:signup-requested`          | `{ url }`                    | "Create an account" clicked      | **Yes**    |
| `geoleaf:connector:forgot-password-requested` | `{ url }`                    | "Forgot password" clicked        | **Yes**    |

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

---

## Security

- The token is **never** passed in a query string.
- Passwords are wiped from memory after use (`OWASP A02`).
- `baseUrl` must use HTTPS in production (an error is raised otherwise).
- The modal's XSS sanitisation relies on `textContent` — no `innerHTML` with user data.
- MVT / PMTiles are intercepted through `map.setTransformRequest()` (MapLibre bridge), not through
  `window.fetch`.

---

## License

MIT — see [LICENSE](LICENSE).
