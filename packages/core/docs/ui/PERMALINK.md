---
title: "URL Permalink / Deep Linking"
---

# URL Permalink / Deep Linking

> **GeoLeaf Core — `@geoleaf/core` v2.0.0+**
> Feature §1.3 — Stabilisé en v2.0.0

---

## Sommaire

1. [Vue d'ensemble](#vue-densemble)
2. [Activation](#activation)
3. [Paramètres URL](#paramètres-url)
4. [Modes d'encodage](#modes-dencodage)
5. [API JavaScript](#api-javascript)
6. [Exemples pratiques](#exemples-pratiques)
7. [Sécurité](#sécurité)
8. [Limitations connues](#limitations-connues)

---

## Vue d'ensemble

> **BREAKING (v3.0.0)** — le champ `poi` (`gl_poi`) est retiré : il faisait un
> aller-retour URL→état→URL sans jamais influencer le comportement de l'app
> (vestige de l'ère POI, dissoute — roadmap nettoyage Sprint 3, R-3).

Le module **Permalink** sérialise l'état courant de la carte (centre, zoom, visibilité des couches, filtre actif) dans l'URL du navigateur. Cela permet de :

- **Partager un lien** pointant vers une vue précise de la carte
- **Recharger la page** en retrouvant exactement la même vue
- **Intégrer une vue spécifique** dans une campagne marketing (GA4 / Matomo)

La synchronisation utilise `history.replaceState()` — aucune entrée n'est ajoutée dans l'historique du navigateur ; le bouton « Précédent » n'est pas affecté.

### Architecture interne (v2.0.0)

```
built-in/permalink/
├── permalink-api.ts      // Facade interne stateful — liée à GeoLeaf.Permalink
└── permalink-url.ts      // Logique stateless (readUrl, buildUrl, applyState, startSync)
```

Le module expose aussi `Permalink` comme export nommé ESM depuis `@geoleaf/core`.

---

## Activation

### Via le profil JSON (`geoleaf.config.json` ou `profile.json`)

```json
{
    "ui": {
        "permalink": {
            "enabled": true,
            "mode": "hash"
        }
    }
}
```

Le permalink est **désactivé par défaut** (`enabled: false`). Il n'a aucun impact sur les performances lorsqu'il est désactivé.

### Options de configuration

| Option    | Type                                 | Défaut          | Description                                 |
| --------- | ------------------------------------ | --------------- | ------------------------------------------- |
| `enabled` | `boolean`                            | `false`         | Active le permalink.                        |
| `mode`    | `"hash"` \| `"query"` \| `"compact"` | `"hash"`        | Stratégie d'encodage URL (voir ci-dessous). |
| `fields`  | `string[]`                           | tous les champs | Champs à inclure dans l'URL sérialisée.     |

**Valeurs valides pour `fields` :** `"lat"`, `"lng"`, `"zoom"`, `"layers"`, `"filter"`

#### Exemple — position carte uniquement, sans filtres :

```json
{
    "ui": {
        "permalink": {
            "enabled": true,
            "mode": "hash",
            "fields": ["lat", "lng", "zoom"]
        }
    }
}
```

---

## Paramètres URL

En mode `hash` ou `query`, les paramètres suivants sont utilisés. Tous sont préfixés `gl_` pour éviter les collisions avec d'autres fragments dans l'URL.

| Paramètre   | Exemple         | Description                                                               |
| ----------- | --------------- | ------------------------------------------------------------------------- |
| `gl_lat`    | `48.857445`     | Latitude du centre de la carte (6 décimales).                             |
| `gl_lng`    | `2.347211`      | Longitude du centre (6 décimales).                                        |
| `gl_zoom`   | `13`            | Niveau de zoom (entier).                                                  |
| `gl_layers` | `layer1,layer2` | IDs des couches **masquées** par l'utilisateur, séparés par des virgules. |
| `gl_filter` | `restaurant`    | Valeur du filtre texte actif.                                             |

En mode `compact`, tous ces paramètres sont remplacés par un seul paramètre `gl` encodé en base64 JSON.

---

## Modes d'encodage

### `"hash"` (défaut — recommandé)

L'état est encodé dans le fragment de l'URL (`#`). Aucune requête HTTP n'est générée lors d'un rechargement de page.

```
https://mymap.example.com/#gl_lat=48.857445&gl_lng=2.347211&gl_zoom=13
```

**Idéal pour :** déploiements statiques (Nginx, GitHub Pages, S3, CDN).

### `"query"`

L'état est encodé dans la query string (`?`). Nécessite que le serveur renvoie le même HTML quelle que soit la query string.

```
https://mymap.example.com/?gl_lat=48.857445&gl_lng=2.347211&gl_zoom=13
```

**Idéal pour :** applications serveur capables de passer la query string au client.

### `"compact"`

L'état est encodé en base64 JSON dans le fragment. Génère des URLs plus courtes, mais non lisibles par un humain.

```
https://mymap.example.com/#gl=eyJsYXQiOjQ4Ljg1NywibG5nIjoyLjM0Nywiem9vbSI6MTN9
```

**Idéal pour :** états complexes (nombreuses couches masquées, filtre long) ou partage via QR code.

### Auto-compact transparent

En mode `"hash"`, si la longueur du fragment dépasse 200 caractères (par exemple, beaucoup de couches masquées), GeoLeaf passe automatiquement au format compact, de façon transparente pour l'utilisateur. Ce basculement est silencieux.

---

## API JavaScript

Le module est accessible via `GeoLeaf.Permalink.*` (CDN/global) ou comme export nommé ESM.

### Import ESM

```javascript
import { Permalink } from "@geoleaf/core";
```

### `GeoLeaf.Permalink.init(config)`

Initialise le module avec la configuration issue du profil actif. Appelé automatiquement au boot — inutile en usage normal.

```javascript
GeoLeaf.Permalink.init({ enabled: true, mode: "hash" });
```

### `GeoLeaf.Permalink.readAndStore()`

Lit l'URL courante et met en cache l'état parsé. Appelé automatiquement avant la création de la carte.

### `GeoLeaf.Permalink.applyStoredState(map)`

Applique l'état mis en cache à la carte et à l'UI. Appelé automatiquement après l'initialisation de tous les modules.

**Paramètre :** `map` — instance MapLibre GL (`maplibregl.Map`).

### `GeoLeaf.Permalink.startSync(map)`

Démarre la synchronisation continue (écoute l'événement `moveend` de MapLibre). Appelé automatiquement — inutile en usage normal.

### `GeoLeaf.Permalink.getState()`

Retourne l'état permalink actuellement chargé (parsé depuis l'URL au démarrage), ou `null` si aucun permalink n'était présent.

```javascript
const state = GeoLeaf.Permalink.getState();
// → { lat: 48.857, lng: 2.347, zoom: 13, layers: [], filter: "café" }
// → null
```

### `GeoLeaf.Permalink.buildUrl(state?)`

Sérialise un état (ou l'état courant) en chaîne URL.

```javascript
// Current stored state
const url = GeoLeaf.Permalink.buildUrl();
// → "#gl_lat=48.857445&gl_lng=2.347211&gl_zoom=13"

// Explicit state
const url = GeoLeaf.Permalink.buildUrl({ lat: 44.0, lng: 3.0, zoom: 10 });
// → "#gl_lat=44.000000&gl_lng=3.000000&gl_zoom=10"
```

### `GeoLeaf.Permalink._reset()` (test only)

Réinitialise l'état interne. Réservé aux tests.

---

## Exemples pratiques

### Lien partageable — copier l'URL courante

```javascript
const permalinkUrl =
    window.location.origin + window.location.pathname + GeoLeaf.Permalink.buildUrl();

navigator.clipboard.writeText(permalinkUrl);
```

### Bouton "Partager" dans une application

```html
<button id="share-btn">Partager la vue</button>
```

```javascript
document.getElementById("share-btn").addEventListener("click", () => {
    const url = window.location.origin + window.location.pathname + GeoLeaf.Permalink.buildUrl();

    if (navigator.share) {
        navigator.share({ title: "Vue carte", url });
    } else {
        navigator.clipboard.writeText(url);
        alert("Lien copié dans le presse-papiers !");
    }
});
```

### Analytics — envoyer la vue partagée à GA4

```javascript
document.addEventListener("geoleaf:map:ready", () => {
    const state = GeoLeaf.Permalink.getState();
    if (state) {
        // Page opened via a permalink
        gtag("event", "permalink_opened", {
            map_lat: state.lat,
            map_lng: state.lng,
            map_zoom: state.zoom,
        });
    }
});
```

### Mode compact — partage via QR code

```json
{
    "ui": {
        "permalink": {
            "enabled": true,
            "mode": "compact"
        }
    }
}
```

### Activer le permalink sur un profil existant (ajout minimal)

```json
{
    "ui": {
        "permalink": { "enabled": true }
    }
}
```

GeoLeaf utilise alors les valeurs par défaut : mode `hash`, tous les champs inclus.

---

## Sécurité

Le module Permalink applique les mesures suivantes pour prévenir toute injection ou exploitation via l'URL :

- Les valeurs numériques (`lat`, `lng`, `zoom`) sont validées via `validateCoordinates()` et `validateNumber()` du module `security` (`packages/core/src/modules/built-in/security/index.ts`). Toute valeur hors-limite ou non-numérique est silencieusement ignorée (état permalink = `null`).
- Les listes de couches sont limitées à **100 entrées maximum**.
- Les champs texte (`filter`) sont tronqués à **200 caractères**.
- En mode compact, les données base64 sont parsées avec `JSON.parse()` dans un `try/catch`. Tout payload invalide ou malformé est ignoré.
- Aucun `innerHTML` n'est utilisé dans ce module.

---

## Limitations connues

| Limitation             | Détail                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Multi-onglets**      | Deux onglets ouverts sur la même carte modifient le même fragment d'URL sans coordination. Comportement attendu.                 |
| **`file://` protocol** | `history.replaceState()` n'est pas disponible sur le protocole `file://`. La synchronisation URL est silencieusement désactivée. |
| **SSR / Node.js**      | Le module détecte l'absence de `window` et retourne `null` — aucune erreur n'est levée en contexte serveur.                      |

---

_GeoLeaf Core — © 2026 Mattieu Pottier — MIT License_
