# @geoleaf-plugins/connector

Plugin MIT pour GeoLeaf — Authentification transparente et injection d'en-têtes `Authorization` sur toutes les requêtes fetch GeoJSON / WFS / REST.

[![npm](https://img.shields.io/npm/v/@geoleaf-plugins/connector)](https://www.npmjs.com/package/@geoleaf-plugins/connector)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

> [!IMPORTANT]
> **Not on the registry at this version.** The GeoLeaf 3.x line is not published yet, so the
> install command below either fails with `E404` or resolves to an older release than the one
> this page describes. Measure rather than assume — no version number is copied into this page:
>
> ```bash
> npm view @geoleaf-plugins/connector version  # what the registry serves
> npm run versions:check                       # what this repository declares
> ```
>
> Until those agree, build from source.

## Installation

```bash
npm install @geoleaf-plugins/connector
```

> **Prérequis** : `@geoleaf/core` ≥ 1.2.0 (peer dependency).

---

## Utilisation rapide

### S6 — Token statique (dev / demo)

```html
<script type="module" src="geoleaf-connector.plugin.js"></script>
<script>
    GeoLeaf.Connector.configure({
        baseUrl: "http://localhost:3000",
        getToken: () => "MY_DEV_TOKEN",
    });
</script>
```

> Un `console.warn` est émis si le token ne contient pas `.` (non-JWT). C'est attendu en mode dev.

---

## Scénarios d'utilisation

| Scénario | Config                                      | Cas d'usage                            |
| -------- | ------------------------------------------- | -------------------------------------- |
| S1       | `getToken: () => 'static'`                  | Dev / smoke test sans serveur          |
| S2       | `auth: { endpoint, ui: true }`              | Login modal + JWT + refresh auto (IDB) |
| S3       | `getToken: () => localStorage.getItem(...)` | SSO existant — token externe           |
| S4       | `getToken: async () => await myAuth.get()`  | Provider async (Keycloak, Auth0, etc.) |
| S5       | `auth: { endpoint, ui: false }`             | Token pré-chargé en IDB — silencieux   |
| S6       | `getToken: () => 'STATIC_DEV_TOKEN'`        | Données non-sensibles, démo publique   |

---

## API

### `GeoLeaf.Connector.configure(config)`

```typescript
await GeoLeaf.Connector.configure({
    baseUrl: "https://api.example.com",
    getToken: () => "JWT_TOKEN",
    // — OU —
    auth: {
        endpoint: "https://api.example.com/auth/login",
        ui: true, // Show login modal if no valid token found
        signupUrl: "https://app.example.com/signup", // Lien "Créer un compte" (optionnel)
        forgotPasswordUrl: "https://app.example.com/forgot", // Lien "Mot de passe oublié" (optionnel)
        credentialButton: {
            enabled: true, // Auto-inject credential button in UI
            iconVariant: "lock", // "lock" (default) or "user"
        },
    },
});
```

### `GeoLeaf.Connector.openLoginModal()`

Ouvre la modal de connexion manuellement (requiert `configure()` préalable avec `auth`).

```javascript
GeoLeaf.Connector.openLoginModal();
```

### `createConnector(config)` — ESM named export

Pour les cas d'intégration avancés (suite-connector, tests unitaires) :

```typescript
import { createConnector } from "@geoleaf-plugins/connector";

const conn = createConnector({ baseUrl: "...", getToken: () => "TOKEN" });
const token = await conn.getTokenAsync();
conn.destroy();
```

---

## Événements DOM

| Événement                             | Détail                       | Déclencheur                        | Cancelable |
| ------------------------------------- | ---------------------------- | ---------------------------------- | ---------- |
| `connector:authenticated`             | `{ baseUrl }`                | Login modal réussi                 | Non        |
| `connector:token-refreshed`           | `{ baseUrl }`                | Refresh automatique (JWT expirant) | Non        |
| `connector:auth-error`                | `{ baseUrl, error }`         | 401 après tentative de refresh     | Non        |
| `connector:credential-button-clicked` | `{ baseUrl, authenticated }` | Clic sur le bouton credential      | Non        |
| `connector:signup-requested`          | `{ url }`                    | Clic sur "Créer un compte"         | **Oui**    |
| `connector:forgot-password-requested` | `{ url }`                    | Clic sur "Mot de passe oublié"     | **Oui**    |

Les événements `cancelable` permettent à l'application hôte d'intercepter le comportement par défaut via `preventDefault()` :

```javascript
document.addEventListener("connector:signup-requested", (e) => {
    e.preventDefault(); // Empêche l'ouverture du lien
    myApp.showCustomSignup(); // Affiche une UI custom à la place
});
```

```javascript
document.addEventListener("connector:authenticated", (e) => {
    console.log("Authentifié sur", e.detail.baseUrl);
});
```

---

## Sécurité

- Le token n'est **jamais** transmis en query string.
- Les mots de passe sont effacés de la mémoire après utilisation (`OWASP A02`).
- `baseUrl` doit utiliser HTTPS en production (erreur levée sinon).
- La sanitisation XSS de la modal repose sur `textContent` — aucun `innerHTML` avec données utilisateur.
- MVT / PMTiles : interceptés via `map.setTransformRequest()` (MapLibre bridge) — non via `window.fetch`.

---

## Architecture

```
src/
├── entry.ts              ← Point d'entrée — boot + GeoLeaf.Connector global
├── config-schema.ts      ← Types + validation ConnectorConfig
├── fetch-interceptor.ts  ← Monkey-patch window.fetch + Worker headers hook
├── token-store.ts        ← IDB persistence + RAM cache + refresh
├── auth-client.ts        ← HTTP login + refresh vers endpoint
├── login-ui.ts           ← Modal de connexion accessible (close, overlay, liens externes)
├── credential-button.ts  ← Auto-injection bouton credential (desktop + mobile)
├── format-detector.ts    ← Détection format (GeoJSON, FGB, KML, CSV, PMTiles, MVT)
└── maplibre-bridge.ts    ← Hook MapLibre transformRequest (MVT/PMTiles auth)
```

---

## Tests

```bash
# Tests unitaires (Vitest)
npm test

# Rapport de couverture
npx vitest run --coverage
# → rapport HTML dans packages/plugins/connector/coverage/

# Smoke test visuel (nécessite un build préalable)
npm run build
# Ouvrir packages/plugins/connector/demo/smoke.html dans un navigateur
```

---

## Build

```bash
# Depuis la racine du monorepo
npm run build:connector

# Publier sur npmjs.org (accès public, MIT)
npm run publish:connector
```

---

## Licence

MIT — voir [LICENSE](LICENSE).
