---
title: "GeoLeaf.Errors — Documentation du module Errors"
---

# GeoLeaf.Errors — Documentation du module Errors

**Product Version** : GeoLeaf Platform V3

**Version** : 3.0.0

**Fichier** : `src/modules/utils/errors/index.ts`

**Dernière mise à jour** : Mars 2026

---

## Vue d'ensemble

Le module **GeoLeaf.Errors** fournit des classes d'erreurs typées pour une gestion cohérente et contextuelle des erreurs dans toute la bibliothèque GeoLeaf.

### Avantages des erreurs typées

- **Catch spécifique** — distinguer les types d'erreurs avec `instanceof`
- **Contexte enrichi** — données additionnelles pour le debugging (`error.context`)
- **Stack trace propre** — préservation du stack d'appel via `captureStackTrace`
- **Sérialisable** — conversion JSON via `toJSON()`
- **Timestamp** — horodatage automatique (`error.timestamp`)
- **Code d'erreur** — identifiant machine (`error.code`)

---

## Hiérarchie des erreurs

```
Error (native)
  └─ GeoLeafError (base)
      ├─ ValidationError     VALIDATION_ERROR
      ├─ SecurityError       SECURITY_ERROR
      ├─ ConfigError         CONFIG_ERROR
      ├─ NetworkError        NETWORK_ERROR
      ├─ InitializationError INITIALIZATION_ERROR
      ├─ MapError            MAP_ERROR
      ├─ DataError           DATA_ERROR
      ├─ POIError            POI_ERROR
      ├─ RouteError          ROUTE_ERROR
      └─ UIError             UI_ERROR
```

---

## Classes d'erreurs

### `GeoLeafError` (Base)

Classe de base pour toutes les erreurs GeoLeaf. Étend `Error` natif.

**Propriétés** :

| Propriété   | Type           | Description                                   |
| ----------- | -------------- | --------------------------------------------- |
| `name`      | `string`       | Nom de la classe (ex. `'ValidationError'`)    |
| `message`   | `string`       | Message d'erreur                              |
| `context`   | `ErrorContext` | Données de contexte additionnelles            |
| `timestamp` | `string`       | ISO 8601 de la création                       |
| `code`      | `string`       | Code machine (défini dans chaque sous-classe) |
| `stack`     | `string`       | Stack trace                                   |

**Méthodes** :

- `toJSON()` — retourne un objet `{ name, message, context, timestamp, stack }` sérialisable
- `toString()` — formatage lisible avec contexte : `"ErrorName: message [Context: {...}]"`

```js
const error = new GeoLeaf.Errors.GeoLeafError("Erreur générique", {
    module: "Core",
    operation: "init",
});

console.log(error.name); // 'GeoLeafError'
console.log(error.message); // 'Erreur générique'
console.log(error.context); // { module: 'Core', operation: 'init' }
console.log(error.timestamp); // '2026-03-15T10:30:00.000Z'
console.log(error.code); // undefined (base class)
```

---

### `ValidationError`

Erreur de validation de données. **Code** : `VALIDATION_ERROR`

**Utilisée pour** :

- Coordonnées invalides
- Paramètres manquants ou incorrects
- Format de données non conforme

```js
throw new GeoLeaf.Errors.ValidationError("Latitude must be between -90 and 90", {
    lat: 95,
    lng: -73,
    expected: "Range: -90 to 90",
});

// Catch spécifique
try {
    GeoLeaf.Core.init({
        /* options */
    });
} catch (error) {
    if (error instanceof GeoLeaf.Errors.ValidationError) {
        console.error("Erreur de validation:", error.context);
    }
}
```

---

### `SecurityError`

Erreur de sécurité détectée. **Code** : `SECURITY_ERROR`

**Utilisée pour** :

- Détection de contenu XSS
- Protocole URL non autorisé
- Data URL non-image

```js
throw new GeoLeaf.Errors.SecurityError("Protocol not allowed: javascript:", {
    url: "javascript:alert(1)",
    allowedProtocols: ["http:", "https:", "data:"],
});

try {
    GeoLeaf.Validators.validateUrl(userUrl, { throwOnError: true });
} catch (error) {
    if (error instanceof GeoLeaf.Errors.SecurityError) {
        console.error("Tentative de sécurité détectée");
        // Logger pour analyse
    }
}
```

---

### `ConfigError`

Erreur de configuration. **Code** : `CONFIG_ERROR`

**Utilisée pour** :

- Configuration JSON invalide
- Champ de configuration manquant
- Structure de profil incorrecte

```js
throw new GeoLeaf.Errors.ConfigError("Invalid profile structure: missing layers", {
    profileId: "tourism",
    expected: "Array",
    received: "undefined",
});

try {
    GeoLeaf.Config.loadProfile("tourism");
} catch (error) {
    if (error instanceof GeoLeaf.Errors.ConfigError) {
        console.error("Configuration incorrecte:", error.message);
    }
}
```

---

### `NetworkError`

Erreur réseau ou HTTP. **Code** : `NETWORK_ERROR`

**Utilisée pour** :

- Échec de `fetch()`
- Timeout réseau
- Status HTTP 4xx/5xx

```js
throw new GeoLeaf.Errors.NetworkError("Failed to load POI data", {
    url: "/api/poi",
    status: 404,
    statusText: "Not Found",
});

async function loadWithRetry() {
    try {
        return await GeoLeaf.Config.loadConfig("config.json");
    } catch (error) {
        if (error instanceof GeoLeaf.Errors.NetworkError) {
            console.warn("Retry après 3s...");
            await GeoLeaf.Helpers.wait(3000);
            return await GeoLeaf.Config.loadConfig("config.json");
        }
        throw error;
    }
}
```

---

### `InitializationError`

Erreur lors de l'initialisation. **Code** : `INITIALIZATION_ERROR`

**Utilisée pour** :

- Échec de création de la carte
- Élément DOM introuvable
- Dépendance manquante

```js
throw new GeoLeaf.Errors.InitializationError("Failed to create map: target element not found", {
    target: "map-container",
    domReady: document.readyState,
});
```

---

### `MapError`

Erreur liée à la carte MapLibre. **Code** : `MAP_ERROR`

**Utilisée pour** :

- Opération carte invalide
- Bounds invalides
- Layer introuvable

```js
throw new GeoLeaf.Errors.MapError("Cannot fit bounds: no features loaded", {
    operation: "fitBounds",
    featureCount: 0,
});
```

---

### `DataError`

Erreur de données génériques. **Code** : `DATA_ERROR`

**Utilisée pour** :

- Données malformées non spécifiques à POI/Route/GeoJSON
- Parsing de données échoué

```js
throw new GeoLeaf.Errors.DataError("Invalid data structure", {
    source: "api/response",
    expected: "array",
    received: typeof data,
});
```

---

### `POIError`

Erreur lors de la gestion des POI. **Code** : `POI_ERROR`

**Utilisée pour** :

- POI mal formé
- Chargement POI échoué
- Marker invalide

```js
throw new GeoLeaf.Errors.POIError("Invalid POI: missing latlng", {
    poiId: "poi-123",
    provided: { id: "poi-123", label: "Test" },
    expected: "latlng: [lat, lng]",
});
```

---

### `RouteError`

Erreur lors du traitement des itinéraires. **Code** : `ROUTE_ERROR`

**Utilisée pour** :

- GPX mal formé
- Parsing GPX échoué
- Route vide

```js
throw new GeoLeaf.Errors.RouteError("Failed to parse GPX: invalid XML", {
    url: "route.gpx",
    parseError: "Unexpected end of input",
});
```

---

### `UIError`

Erreur liée à l'interface utilisateur. **Code** : `UI_ERROR`

**Utilisée pour** :

- Composant UI non initialisé
- Rendu échoué
- Élément DOM manquant lors d'une opération UI

```js
throw new GeoLeaf.Errors.UIError("Panel render failed: container not found", {
    panelId: "sidepanel",
    operation: "render",
});
```

---

## Constantes

### `ErrorCodes`

Objet immuable listant tous les codes d'erreur :

```js
GeoLeaf.Errors.ErrorCodes.VALIDATION; // 'VALIDATION_ERROR'
GeoLeaf.Errors.ErrorCodes.SECURITY; // 'SECURITY_ERROR'
GeoLeaf.Errors.ErrorCodes.CONFIG; // 'CONFIG_ERROR'
GeoLeaf.Errors.ErrorCodes.NETWORK; // 'NETWORK_ERROR'
GeoLeaf.Errors.ErrorCodes.INITIALIZATION; // 'INITIALIZATION_ERROR'
GeoLeaf.Errors.ErrorCodes.MAP; // 'MAP_ERROR'
GeoLeaf.Errors.ErrorCodes.DATA; // 'DATA_ERROR'
GeoLeaf.Errors.ErrorCodes.POI; // 'POI_ERROR'
GeoLeaf.Errors.ErrorCodes.ROUTE; // 'ROUTE_ERROR'
GeoLeaf.Errors.ErrorCodes.UI; // 'UI_ERROR'
```

---

## Fonctions utilitaires

### `normalizeError(error, defaultMessage?)`

Normalise n'importe quelle valeur en `GeoLeafError`.

```js
try {
    // code risqué
} catch (rawError) {
    const err = GeoLeaf.Errors.normalizeError(rawError, "Unexpected error");
    GeoLeaf.Log.error(err.toString());
}
```

---

### `isErrorType(error, ErrorClass)`

Vérifie si une erreur est instance d'une classe spécifique.

```js
const isConfig = GeoLeaf.Errors.isErrorType(error, GeoLeaf.Errors.ConfigError);
```

---

### `getErrorCode(error)`

Extrait le code d'erreur depuis n'importe quelle valeur.

```js
const code = GeoLeaf.Errors.getErrorCode(error);
// 'VALIDATION_ERROR' | 'CONFIG_ERROR' | ... | 'UNKNOWN_ERROR'
```

---

### `createError(ErrorClass, message, context?)`

Crée une instance d'erreur typée avec stack trace propre.

```js
const err = GeoLeaf.Errors.createError(GeoLeaf.Errors.ValidationError, "Invalid zoom level", {
    zoom: 25,
    max: 20,
});
```

---

### `createErrorByType(type, message, context?)`

Crée une erreur depuis son type en string.

```js
const err = GeoLeaf.Errors.createErrorByType("validation", "Invalid value", { value: 42 });
// Retourne une instance de ValidationError
```

Types supportés : `'validation'`, `'security'`, `'config'`, `'network'`, `'initialization'`, `'map'`, `'data'`, `'poi'`, `'route'`, `'ui'`

---

### `sanitizeErrorMessage(message, maxLength?)`

Sanitise un message d'erreur (échappement HTML, troncature).

```js
const safe = GeoLeaf.Errors.sanitizeErrorMessage(userInput, 500);
```

---

### `safeErrorHandler(handler, error)`

Exécute un handler d'erreur en toute sécurité (évite les erreurs dans les handlers).

```js
GeoLeaf.Errors.safeErrorHandler(onError, caughtError);
```

---

## Patterns d'utilisation

### Pattern 1 : Validation avec erreur typée

```js
function validatePOI(poi) {
    if (!poi.latlng || !Array.isArray(poi.latlng)) {
        throw new GeoLeaf.Errors.ValidationError("POI must have latlng array", {
            poiId: poi.id,
            provided: poi.latlng,
        });
    }
    GeoLeaf.Validators.validateCoordinates(poi.latlng[0], poi.latlng[1], {
        throwOnError: true,
    });
    // ValidationError lancée automatiquement si invalide
}
```

---

### Pattern 2 : Catch multi-niveaux

```js
try {
    await GeoLeaf.Config.loadConfig("config.json");
} catch (error) {
    if (error instanceof GeoLeaf.Errors.NetworkError) {
        console.error("Problème réseau, mode offline activé");
        activateOfflineMode();
    } else if (error instanceof GeoLeaf.Errors.ConfigError) {
        console.error("Configuration invalide");
        showConfigHelp();
    } else if (error instanceof GeoLeaf.Errors.SecurityError) {
        console.error("Problème de sécurité détecté");
        reportSecurityIssue(error);
    } else {
        console.error("Erreur inconnue:", error);
    }
}
```

---

### Pattern 3 : Logging enrichi

```js
try {
    // Code risqué
} catch (error) {
    if (error instanceof GeoLeaf.Errors.GeoLeafError) {
        GeoLeaf.Log.error("[GeoLeaf] Error:", {
            type: error.name,
            code: error.code,
            message: error.message,
            context: error.context,
            timestamp: error.timestamp,
        });
    } else {
        GeoLeaf.Log.error("[GeoLeaf] Unknown error:", error);
    }
}
```

---

### Pattern 4 : Utiliser `normalizeError` dans les handlers génériques

```js
async function safeLoad(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) {
            throw new GeoLeaf.Errors.NetworkError(`HTTP ${res.status}`, {
                url,
                status: res.status,
            });
        }
        return await res.json();
    } catch (rawError) {
        const err = GeoLeaf.Errors.normalizeError(rawError, "Load failed");
        GeoLeaf.Log.error("[GeoLeaf] Load error:", err.toString());
        throw err;
    }
}
```

---

## Tests

```bash
npm test -- errors

# Fichiers de tests
# packages/core/__tests__/core/errors.test.js
# packages/core/__tests__/core/errors-extended.test.js
```

**Couverture** : 95 %+ (150+ tests passants)

---

## Statistiques d'erreurs

| Type d'erreur     | Fréquence | Criticité |
| ----------------- | --------- | --------- |
| `ValidationError` | 45 %      | Moyenne   |
| `ConfigError`     | 25 %      | Haute     |
| `NetworkError`    | 15 %      | Moyenne   |
| `SecurityError`   | 5 %       | Haute     |
| Autres            | 10 %      | Variable  |

---

## Changelog

**v2.0.0 (mars 2026)** — version initiale officielle

- Module créé avec la hiérarchie de base : `GeoLeafError`, `ValidationError`, `SecurityError`, `ConfigError`, `NetworkError`, `InitializationError`, `MapError`
- Ajout de `DataError` et `UIError`
- Ajout de `ErrorCodes` (constantes machines)
- Ajout de fonctions utilitaires : `normalizeError`, `isErrorType`, `getErrorCode`, `createError`, `createErrorByType`, `sanitizeErrorMessage`, `safeErrorHandler`

---

## Voir aussi

- `GeoLeaf.Validators` — utilise `ValidationError` et `SecurityError`
- `GeoLeaf.Security` — utilise `SecurityError`
- `GeoLeaf.Config` — utilise `ConfigError` et `NetworkError`
- `GeoLeaf.Log` — logging des erreurs
