---
title: "GeoLeaf — Authentification HTTP avec @geoleaf-plugins/connector"
---

# GeoLeaf — Authentification HTTP avec @geoleaf-plugins/connector

**Package :** `@geoleaf-plugins/connector`
**Licence :** MIT — destiné à npmjs.org ; sa présence et sa version au registre se mesurent
(`npm view @geoleaf-plugins/connector version`) et ne sont pas recopiées ici.

> ℹ️ **Ce guide a vécu dans `packages/core/docs/` jusqu'au 10/08/2026.** Il documente un plugin :
> il est désormais livré par le paquet de ce plugin, et il a emporté avec lui l'unique exemption
> de la règle `SYNC-02` (« aucune référence à un plugin dans les docs du core »). La règle, elle,
> n'a pas bougé — elle a été vue rougir après le déménagement pour s'en assurer.

---

## Vue d'ensemble

`@geoleaf-plugins/connector` est un plugin MIT qui ajoute une couche d'authentification transparente à GeoLeaf. Il intercepte toutes les requêtes `fetch` (GeoJSON, WFS, REST) et injecte automatiquement un header `Authorization: Bearer <token>`.

**Cas d'usage principal :** protéger vos données cartographiques derrière une authentification sans modifier le code de chargement des couches.

**Fonctionnalités :**

- Monkey-patch `window.fetch` — toutes les requêtes vers `baseUrl` reçoivent le header
- JWT : détection d'expiration + refresh automatique
- Persistance du token en IndexedDB (survit au rechargement de page)
- Modal de connexion accessible (aucune dépendance CSS externe)
- Intercept MapLibre `transformRequest` pour les tuiles vectorielles (MVT/PMTiles)

---

## Installation

```bash
npm install @geoleaf-plugins/connector
```

> **Prérequis :** `@geoleaf/core` ≥ 2.0.0 (peer dependency).

---

## Intégration avec GeoLeaf

Le connector doit être importé **après** `@geoleaf/core` et configuré **avant** `GeoLeaf.boot()` :

```js
import "@geoleaf/core";
import "@geoleaf-plugins/connector";

await GeoLeaf.Connector.configure({
    baseUrl: "https://api.example.com",
    getToken: () => localStorage.getItem("my-token"),
});

GeoLeaf.init({
    map: { target: "map" },
    data: {
        activeProfile: "mon-profil",
        profilesBasePath: "./profiles/",
    },
});
GeoLeaf.boot();
```

En CDN :

```html
<!-- MapLibre GL JS — peer dependency, avant tout le reste -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.css" />
<script type="module">
    import * as maplibregl from "https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.mjs";
    globalThis.maplibregl = maplibregl;
</script>

<script
    type="module"
    src="https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf.esm.js"
></script>
<script type="module" src="geoleaf-connector.plugin.js"></script>
<script type="module">
    await GeoLeaf.Connector.configure({
        baseUrl: "https://api.example.com",
        getToken: () => "MY_TOKEN",
    });
    GeoLeaf.init({ map: { target: "map" }, data: { activeProfile: "mon-profil" } });
    GeoLeaf.boot();
</script>
```

---

## Scénarios d'utilisation

| Scénario                   | Configuration                               | Cas d'usage                            |
| -------------------------- | ------------------------------------------- | -------------------------------------- |
| **S1** — Token statique    | `getToken: () => 'static'`                  | Dev / smoke test sans serveur          |
| **S2** — Login modal + JWT | `auth: { endpoint, ui: true }`              | Login modal + JWT + refresh auto (IDB) |
| **S3** — SSO externe       | `getToken: () => localStorage.getItem(...)` | Token existant géré par une autre lib  |
| **S4** — Provider async    | `getToken: async () => await myAuth.get()`  | N'importe quel SDK d'identité          |
| **S5** — Token silencieux  | `auth: { endpoint, ui: false }`             | Token pré-chargé en IDB — pas de modal |
| **S6** — Données publiques | `getToken: () => 'STATIC_DEV_TOKEN'`        | Démo publique, données non sensibles   |

### S1 — Token statique (développement)

```js
await GeoLeaf.Connector.configure({
    baseUrl: "http://localhost:3000",
    getToken: () => "MY_DEV_TOKEN",
});
```

> Un `console.warn` est émis si le token ne contient pas `.` (non-JWT). Normal en mode dev.

### S2 — Authentification avec modal de connexion

```js
await GeoLeaf.Connector.configure({
    baseUrl: "https://api.example.com",
    auth: {
        endpoint: "https://api.example.com/auth/login",
        ui: true, // affiche une modal si aucun token valide en IDB
    },
});
```

Le connector vérifie d'abord IndexedDB. Si aucun token valide n'est trouvé, la modal de connexion s'affiche. Le token obtenu est persisté en IDB et rafraîchi automatiquement avant expiration.

### S4 — Provider async (SDK d'identité tiers)

```js
await GeoLeaf.Connector.configure({
    baseUrl: "https://api.example.com",
    getToken: async () => {
        // Demande un rafraîchissement si le token expire dans moins de 30 s.
        await authClient.refreshIfExpiringWithin(30);
        return authClient.token;
    },
});
```

---

## API

### `GeoLeaf.Connector.configure(config)`

```typescript
await GeoLeaf.Connector.configure({
    baseUrl: "https://api.example.com", // Toutes les requêtes vers ce domaine seront interceptées
    getToken: () => "JWT_TOKEN", // Fonction synchrone ou async retournant le token
    // — OU —
    auth: {
        endpoint: "https://api.example.com/auth/login", // Endpoint login (POST)
        ui: true, // true → modal si absent | false → silencieux
    },
});
```

### `createConnector(config)` — export nommé ESM

Pour les cas d'intégration avancés (tests unitaires, usage sans namespace global) :

```typescript
import { createConnector } from "@geoleaf-plugins/connector";

const conn = createConnector({
    baseUrl: "https://api.example.com",
    getToken: () => "TOKEN",
});

const token = await conn.getTokenAsync();
conn.destroy(); // Retire les intercepteurs fetch
```

---

## Événements DOM

| Événement                           | Détail               | Déclenché quand                |
| ----------------------------------- | -------------------- | ------------------------------ |
| `geoleaf:connector:authenticated`   | `{ baseUrl }`        | Login modal réussi             |
| `geoleaf:connector:token-refreshed` | `{ baseUrl }`        | Refresh automatique JWT        |
| `geoleaf:connector:auth-error`      | `{ baseUrl, error }` | 401 après tentative de refresh |

```js
document.addEventListener("geoleaf:connector:authenticated", (e) => {
    console.log("Authentifié sur", e.detail.baseUrl);
});

document.addEventListener("geoleaf:connector:auth-error", (e) => {
    console.error("Échec auth", e.detail.error);
    // Rediriger vers la page de connexion
});
```

---

## Sécurité

- Le token n'est **jamais** transmis en query string — uniquement via header `Authorization`
- Les mots de passe sont effacés de la mémoire après utilisation (OWASP A02)
- `baseUrl` doit utiliser HTTPS en production (erreur levée sinon)
- Sanitisation XSS de la modal : `textContent` uniquement — aucun `innerHTML` avec données utilisateur
- MVT / PMTiles : interceptés via `map.setTransformRequest()` (MapLibre bridge), pas via `window.fetch`

---

## Vérification du chargement

```js
GeoLeaf.plugins.isLoaded("connector"); // → true / false
GeoLeaf.plugins.getInfo("connector");
// → { name: "connector", version: "3.0.0", loaded: true, label: "Connector (Auth + Fetch intercept)" }
```

---

## Documentation complète

Pour les options avancées, le détail de l'architecture interne, les tests et le build :

→ `packages/plugins/connector/README.md`

---

## Voir aussi

- [`README.md`](../README.md) du plugin — options avancées, architecture interne, tests et build

Les trois guides ci-dessous sont livrés par **`@geoleaf/core`**, dans son répertoire `docs/`. Ils
ne sont pas atteignables en relatif depuis ce paquet-ci : chaque tarball npm est une racine à lui
seul, et un lien qui traverserait les deux serait mort chez les deux lecteurs.

- `PLUGIN_DEVELOPMENT_GUIDE.md` — développer un plugin custom
- `PLUGIN_CONFIGURATION_GUIDE.md` — configuration des plugins dans un profil
- `GETTING_STARTED.md` — démarrage rapide
