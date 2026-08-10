---
title: "GeoLeaf Core — Security Guide"
---

# GeoLeaf Core — Security Guide

**S'applique à :** `@geoleaf/core` v3.x
**Dernière vérification :** 29 juillet 2026

> Guide destiné aux consommateurs de `@geoleaf/core`. Il couvre les directives CSP requises, l'architecture de sécurité et le processus de divulgation responsable.

---

## 1. Content Security Policy (CSP) recommandée

GeoLeaf dépend de MapLibre GL JS (WebGL, workers) et de ressources cartographiques externes. La CSP minimale recommandée est :

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

> 🛑 **`font-src` a dit `'self' https:` ici jusqu'au 08/08/2026, et c'était un reliquat.** Cette
> valeur datait de l'époque où l'application chargeait Google Fonts ; le Sprint 5 (tâche 5.5) a
> supprimé cette origine, et la police réelle est une pile système. `https:` autorisait donc
> toute origine HTTPS de fonte au lendemain du sprint qui a mis les origines tierces à zéro. La
> valeur qui fait foi est celle de [security/SECURITY_CONTRACT.md](security/SECURITY_CONTRACT.md)
> §4 — `'self'`, motif « aucune fonte externe chargée par le core » —, et les deux tableaux
> décrivent bien le **même** objet.

> ⚠️ **Ce tableau est le minimum requis par le CORE, pas la politique de l'application
> déployée.** Les deux ne coïncident pas et n'ont pas à coïncider : `apps/geoleaf-app` sert
> `font-src 'self' data:` (le `data:` couvre ses fontes d'icônes embarquées) et
> `script-src 'self' blob:`. Cette politique-là est déclarée dans son `index.html`, gardée par
> **APP-09** (`scripts/verify-app-template.cjs`), et son écart de `script-src` est suivi en
> **B-165**. Un intégrateur qui compose son propre document part de ce tableau-ci ; il n'a pas
> à hériter des besoins de l'application de démonstration.

> **`style-src` strict (sans `'unsafe-inline'`)** : depuis la v2.2.1 (roadmap sécurité B.5), GeoLeaf n'exige plus `'unsafe-inline'`. Les styles dynamiques sont posés via le CSSOM propriété-par-propriété (`element.style.setProperty`, helpers publics `GeoLeaf.Helpers.applyCssText` / `applyDeferredStyles`) ou via des classes CSS — formes qui ne sont **pas** soumises à `style-src`, contrairement à `element.style.cssText`, `setAttribute('style', …)` et aux attributs `style` (désormais éliminés du rendu : marqueurs, panneaux, sprite). Pour l'inventaire et la matrice CSP complète, voir [security/SECURITY_CONTRACT.md](security/SECURITY_CONTRACT.md) §4.

> **`worker-src blob:`** est requis pour les Web Workers MapLibre (décodage tiles, parsing GeoJSON).

---

## 2. Architecture sécurité de GeoLeaf Core

GeoLeaf implémente plusieurs couches de protection indépendantes :

| Couche               | Module                               | Fonctions clés                                                                                                                                    |
| -------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protection XSS       | `kernel/security/`                   | `escapeHtml()`, `escapeAttribute()`, `sanitizeHTML()`, `sanitizeSvgContent()`                                                                     |
| Protection CSRF      | `kernel/security/csrf-token.ts`      | Génération token (32 bytes crypto-random), rotation auto, cookie `Secure; SameSite=Strict`                                                        |
| Sécurité DOM         | `kernel/security/dom-security.ts`    | `DOMSecurity.setTextContent()`, `DOMSecurity.setSafeHTML()` — aucun `innerHTML` direct                                                            |
| Validation entrées   | `kernel/security/validators.ts`      | Whitelist protocoles URL (`https:`, `http:`, `data:image/*`), bounds coordonnées, structure GeoJSON                                               |
| Sécurité fetch       | `utils/general/fetch-helper.ts`      | Validation URL + rate limiting (50 req/10s/domaine)                                                                                               |
| Sanitisation erreurs | `utils/errors/errors.ts`             | `sanitizeErrorMessage()` — échappe HTML dans les messages d'erreur                                                                                |
| Protection prototype | `utils/general/object-path-guard.ts` | `isUnsafeKey()` / `hasUnsafeSegment()` — blocklist **canonique unique** (`__proto__`, `constructor`, `prototype`), appliquée par 7 fichiers-sinks |

⚠️ **Les chemins de cette table ont été re-vérifiés contre le code le 31/07/2026, et cinq sur sept
étaient morts** — ils nommaient les racines `security/`, `validators/`, `errors/` et
`utils/fetch-helper.ts`, dissoutes au R.9. La ligne « Sécurité DOM » portait déjà le bon chemin :
elle avait été corrigée seule, ce qui rendait l'incohérence invisible à la lecture.

⚠️ **Aucune gate ne pouvait le voir, et c'est mesuré** : `check-dead-links` ne lit que les liens
markdown, `audit-report-freshness --source refs` n'est gaté que sur la source `tsdoc`, et un chemin
en **code inline** dans un `.md` n'appartient à aucun des deux périmètres. C'est le trou nommé au
§Ce que les gates ne couvrent pas de `roadmap_documentation-v3`, avec sa précision mesurée à 2/10 —
il se lit, il ne se gate pas.

### Vecteurs couverts (résumé)

- **Injection DOM** : 12 vecteurs identifiés (popup POI, tooltip, labels, résultats search, etc.) — tous sanitisés via `escapeHtml()` ou `DOMSecurity.*`
- **Injection URL** : 7 vecteurs (champs `url`, `website`, `image`, permalink lat/lng/zoom) — validés via `validateUrl()` + `validateCoordinates()`
- **Prototype pollution** : 5 vecteurs (profil JSON config, **sac `modules` d'un profil**, propriétés POI, styles GeoJSON, permalink compact) — bloqués par une blocklist **canonique unique**, `isUnsafeKey()` / `hasUnsafeSegment()` (`utils/general/object-path-guard.ts`), appliquée par les 7 fichiers-sinks ; le permalink passe par une revalidation de type. Jusqu'au S13.2 chaque chemin d'écriture portait sa **propre copie** de la liste — quatre au total, dont trois silencieuses et une réallouée à chaque appel récursif ; la divergence est précisément ce qui avait laissé passer le trou du S5. Un gate (`npm run check:dynamic-key-writes`) refuse désormais toute nouvelle écriture à clé dynamique non gardée

Pour l'inventaire complet avec fichiers source et tests, voir [security/SECURITY_CONTRACT.md](security/SECURITY_CONTRACT.md).

---

## 3. CSRF — note breaking change v2.0.0

La méthode `CSRFToken.setSecureCookie()` a `secure: true` par défaut depuis v2.0.0.

Sur un déploiement HTTP uniquement (développement local, intranets), cela génère un avertissement console mais n'empêche pas le fonctionnement. Pour supprimer l'avertissement :

```typescript
CSRFToken.setSecureCookie("my-cookie", value, { secure: false });
```

---

## 4. Limitations connues

| Limitation                                       | Raison                                   | Mitigation                                                           |
| ------------------------------------------------ | ---------------------------------------- | -------------------------------------------------------------------- |
| `data:` URLs autorisées pour les images          | Profils POI supportent les icônes base64 | Filtrage MIME strict (`image/*` uniquement via `_validateDataUrl()`) |
| `http:` autorisé par défaut dans `validateUrl()` | Contextes non-HTTPS (dev, intranet)      | Passer `{ httpsOnly: true }` pour forcer HTTPS                       |
| Service Worker non authentifié                   | Hors périmètre de la bibliothèque        | Implémenter l'auth SW côté applicatif                                |

---

## 5. Divulgation responsable

**Ne pas reporter les vulnérabilités via les issues publiques GitHub.**

### Contact

|                            |                                |
| -------------------------- | ------------------------------ |
| Email                      | **contact@geoleaf.dev**        |
| Accusé de réception        | Sous 48h                       |
| Triage initial             | Sous 5 jours                   |
| Correctif ou contournement | Sous 30 jours                  |
| Divulgation publique       | Après publication du correctif |

Nous suivons un modèle de **divulgation coordonnée**. Merci de nous laisser le temps d'adresser la vulnérabilité avant toute publication.

### Périmètre couvert

**In scope :** XSS dans le module sécurité, contournement CSRF, prototype pollution, injection HTML unsafe via le DOM, contournement de validation URL, vulnérabilités de dépendances avec chemin d'exploitation direct.

**Out of scope :** vulnérabilités dans MapLibre GL JS ou autres dépendances (à reporter à ces projets directement), accès physique, ingénierie sociale, versions non supportées (toute majeure antérieure à la courante), DoS.

---

## 6. Références

| Document                                                                                   | Description                                                     |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| [security/GeoLeaf_Security_README.md](security/GeoLeaf_Security_README.md)                 | API complète du module sécurité (signatures, exemples)          |
| [security/SECURITY_CONTRACT.md](security/SECURITY_CONTRACT.md)                             | Inventaire exhaustif des vecteurs d'injection et tests associés |
| [.github/SECURITY.md](https://github.com/geoleaf/geoleaf-js/blob/main/.github/SECURITY.md) | Security policy officielle (responsible disclosure)             |

---

## 7. Authentification HTTP — guide d'intégration JWT

> Cette section couvre l'intégration du plugin `@geoleaf-plugins/connector` avec des providers d'authentification externes. Pour l'installation et les scénarios de base, voir le `docs/CONNECTOR_GUIDE.md` livré par `@geoleaf-plugins/connector` — le guide appartient au paquet du plugin, pas à celui du core.

---

### 7.1 Protocole HTTP attendu par `@geoleaf-plugins/connector`

Le plugin impose un contrat HTTP strict côté backend, défini dans `auth-client.ts`.

**Endpoint de login (POST)**

```
POST {endpoint}
Content-Type: application/json

{ "login": "user@example.com", "password": "secret" }
```

Réponse attendue :

```json
{ "token": "<jwt>", "expiresIn": 3600 }
```

⚠️ **Le jeton est un `<placeholder>` et doit le rester.** La valeur d'illustration précédente
commençait par un vrai en-tête JWT encodé (`{"alg":"RS256"}` en base64) : elle n'était pas un
secret, mais elle **matchait** la règle `generic-api-key` du scan, qui a raison de ne pas savoir
distinguer un exemple d'un vrai. Un document publié n'a pas besoin de montrer à quoi ressemble un
JWT pour dire qu'il en attend un.

| Champ       | Type     | Description                                                          |
| ----------- | -------- | -------------------------------------------------------------------- |
| `token`     | `string` | JWT ou token opaque — transmis tel quel dans `Authorization: Bearer` |
| `expiresIn` | `number` | Durée de validité **en secondes**                                    |

Les deux champs sont obligatoires — une `AuthError` est levée si l'un est absent ou du mauvais type.

Codes HTTP interprétés par le plugin :

| Code  | Comportement                                    |
| ----- | ----------------------------------------------- |
| `200` | Token extrait et persisté                       |
| `401` | `AuthError("Invalid credentials")`              |
| `404` | `AuthError("Endpoint not found (404)")`         |
| `5xx` | `AuthError("Server error ({status})")`          |
| Autre | `AuthError("Authentication failed ({status})")` |

**Endpoint de refresh (POST, optionnel)**

```
POST {endpoint}/refresh
Authorization: Bearer {current_token}
Content-Type: application/json
```

Réponse : même format `{ token, expiresIn }`. Le plugin dégrade silencieusement sur `404` (refresh non supporté) — aucune erreur levée, le token existant reste utilisé jusqu'à expiration.

---

### 7.2 Cycle de vie du token JWT

Le plugin gère le token selon un cycle à trois niveaux de cache :

| Phase            | Comportement                                                                         |
| ---------------- | ------------------------------------------------------------------------------------ |
| `configure()`    | Warm du cache IndexedDB → RAM (accès non bloquant)                                   |
| Accès synchrone  | RAM uniquement — utilisé par le bridge MapLibre (`setTransformRequest`)              |
| Accès asynchrone | RAM → IDB → refresh si expiry < 5 min                                                |
| Refresh proactif | Déclenché en arrière-plan si expiry < 5 min, sans bloquer la requête en cours        |
| Expiration       | Refresh forcé ; événement `connector:auth-error` si le refresh échoue                |
| Retry `401`      | 1 seul retry maximum après tentative de refresh ; réponse `401` synthétique si échec |

**Persistance :** IndexedDB, base `geoleaf-connector`, store `auth-tokens`, clé `baseUrl`.  
Le token survit aux rechargements de page mais **pas** aux navigations vers d'autres origines.

**Contraintes de sécurité imposées par le code :**

| Contrainte                      | Comportement                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| HTTPS obligatoire en production | `ConfigError` levée si `baseUrl` utilise HTTP hors `localhost`/`127.0.0.1`                                                |
| Token uniquement en header      | `Authorization: Bearer {token}` — jamais en query string                                                                  |
| Mot de passe effacé après usage | String overwritten in memory post-login (OWASP A02)                                                                       |
| Token non-JWT                   | `console.warn` si le token ne contient pas `.` — **uniquement en mode `getToken` callback** (pas en mode `auth.endpoint`) |
| XSS modal                       | `textContent` uniquement dans la modal de login — aucun `innerHTML` avec données utilisateur                              |

---

### 7.3 Choix du mode d'authentification

`getToken` et `auth` sont **mutuellement exclusifs** — une `ConfigError` est levée si les deux sont fournis.

| Mode                    | Configuration                   | Cas d'usage                                                                                                                                         |
| ----------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Autonome + modal**    | `auth: { endpoint, ui: true }`  | Backend propre retournant `{ token, expiresIn }`, modal gérée par le plugin                                                                         |
| **Autonome silencieux** | `auth: { endpoint, ui: false }` | Token pré-chargé en IDB lors d'une session précédente — aucune modal. Si aucun token valide n'est trouvé au démarrage, une `ConfigError` est levée. |
| **Callback async**      | `getToken: async () => token`   | SSO externe (Keycloak-js, Auth0 SPA SDK) — le plugin délègue la résolution                                                                          |

---

### 7.4 Intégration Keycloak

L'endpoint natif Keycloak (`/protocol/openid-connect/token`) attend `grant_type=password` en `application/x-www-form-urlencoded` — format incompatible avec le connector. Deux approches sont possibles.

**Approche A — `getToken()` avec `keycloak-js`** (recommandée pour les déploiements SSO)

Keycloak-js gère le cycle de session et le refresh ; le connector récupère simplement le token courant.

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
        // Demande un refresh si le token expire dans moins de 30 s
        await keycloak.updateToken(30);
        return keycloak.token ?? null;
    },
});
```

**Approche B — Adapter backend**

Un endpoint intermédiaire traduit le format du connector vers le protocole Keycloak ROPC :

```
POST /api/auth/login        ← reçoit { login, password }
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

### 7.5 Intégration Auth0

Auth0 déprécie le Resource Owner Password flow. L'approche recommandée est le callback avec le SDK Auth0 SPA.

**Via `getToken()` avec Auth0 SPA SDK**

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
            return null; // Déclenche connector:auth-error si la requête échoue (401)
        }
    },
});
```

Le token retourné par `getTokenSilently()` est un JWT signé RS256 valide — le connector le transmet directement dans `Authorization: Bearer`.

---

### 7.6 Intégration Symfony

Symfony avec `json_login` est nativement compatible avec le protocole du connector (requête JSON `{ login, password }`).

**`config/packages/security.yaml`**

```yaml
firewalls:
    api:
        pattern: ^/api
        stateless: true
        json_login:
            check_path: /api/auth/login
            username_path: login # mappe le champ "login" → username interne
            password_path: password
            success_handler: lexik_jwt_authentication.handler.authentication_success
            failure_handler: lexik_jwt_authentication.handler.authentication_failure
```

La réponse de `lexik/jwt-authentication-bundle` par défaut ne contient pas `expiresIn`. Ajouter un event listener pour l'inclure :

```php
// src/EventListener/JwtSuccessListener.php
use Lexik\Bundle\JWTAuthenticationBundle\Event\AuthenticationSuccessEvent;

class JwtSuccessListener
{
    public function __construct(private readonly string $jwtTtl) {}

    public function onAuthenticationSuccess(AuthenticationSuccessEvent $event): void
    {
        $data = $event->getData();
        $data['expiresIn'] = (int) $this->jwtTtl; // paramètre lexik_jwt.token_ttl
        $event->setData($data);
    }
}
```

**Refresh** : `gesdinet/jwt-refresh-token-bundle` expose `/api/token/refresh` — le connector l'atteint automatiquement via `POST {endpoint}/refresh` si `endpoint` = `/api/auth/login`.

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

### 7.7 Intégration Laravel

Avec `laravel/sanctum` (tokens API) ou un controller JWT custom.

**Controller `AuthController`**

```php
// routes/api.php
Route::post('/auth/login', [AuthController::class, 'login']);
Route::post('/auth/login/refresh', [AuthController::class, 'refresh']); // optionnel

// app/Http/Controllers/AuthController.php
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class AuthController extends Controller
{
    public function login(Request $request): JsonResponse
    {
        $credentials = $request->validate([
            'login'    => 'required|string',   // champ "login" du connector
            'password' => 'required|string',
        ]);

        if (!Auth::attempt(['email' => $credentials['login'], 'password' => $credentials['password']])) {
            return response()->json(['message' => 'Invalid credentials'], 401);
        }

        $token = $request->user()->createToken('geoleaf')->plainTextToken;

        return response()->json([
            'token'     => $token,
            'expiresIn' => 86400, // 24 h en secondes
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

> **Note :** Les tokens Sanctum sont des tokens opaques (pas des JWT). Pour utiliser GeoLeaf Connector avec Sanctum via le mode `getToken` callback, le plugin émettrait un `console.warn` car ils ne contiennent pas `.`. Avec le mode `auth.endpoint` tel qu'utilisé ici, ce check ne s'applique pas — aucun warning n'est émis.
