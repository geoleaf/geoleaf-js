---
title: "GeoLeaf.Validators — Documentation du module Validators"
---

# GeoLeaf.Validators — Documentation du module Validators

**Product Version** : GeoLeaf Platform V3

**Version** : 3.0.0

**Fichier** : `src/modules/geoleaf.validators.ts` → `src/modules/utils/validators/general-validators.ts`

**Dernière mise à jour** : Mars 2026

---

## Vue d'ensemble

Le module **GeoLeaf.Validators** fournit des fonctions de validation centralisées et réutilisables pour tous les modules GeoLeaf. Il utilise les erreurs typées de `GeoLeaf.Errors` pour une gestion cohérente des erreurs.

### Responsabilités principales

- **Validation de coordonnées** — latitude/longitude
- **Validation d'URLs** — protocoles, formats
- **Validation d'emails** — format RFC
- **Validation de numéros de téléphone** — format international
- **Validation de niveaux de zoom** — plage configurable
- **Validation de couleurs** — hex, RGB, RGBA, CSS
- **Validation GeoJSON** — structure et géométries
- **Validation de champs requis** — vérification de présence
- **Validation par lot** — `validateBatch`

---

## API de validation

### `validateCoordinates(lat, lng, options?)`

Valide des coordonnées géographiques.

**Signature** :

```typescript
GeoLeaf.Validators.validateCoordinates(
    lat: number,
    lng: number,
    options?: { throwOnError?: boolean }
): { valid: boolean; error: string | null }
```

**Exemples** :

```js
// Coordonnées valides
const result = GeoLeaf.Validators.validateCoordinates(45.5017, -73.5673);
// Returns: { valid: true, error: null }

// Latitude invalide (> 90)
const result2 = GeoLeaf.Validators.validateCoordinates(95, -73);
// Returns: { valid: false, error: 'Latitude must be between -90 and 90' }

// Mode strict (lance exception)
try {
    GeoLeaf.Validators.validateCoordinates(95, -73, { throwOnError: true });
} catch (error) {
    console.error("Coordonnées invalides:", error.message);
}
```

**Validations effectuées** :

- Type `number` (pas string ou autre)
- Valeurs finies (pas NaN, Infinity)
- Latitude entre -90 et +90
- Longitude entre -180 et +180

---

### `validateUrl(url, options?)`

Valide une URL avec options de protocole.

**Signature** :

```typescript
GeoLeaf.Validators.validateUrl(
    url: string,
    options?: {
        allowedProtocols?: string[];
        allowDataImages?: boolean;
        throwOnError?: boolean;
    }
): { valid: boolean; error: string | null; url: string | null }
```

**Exemples** :

```js
// URL HTTPS valide
const result = GeoLeaf.Validators.validateUrl("https://example.com/data.json");
// Returns: { valid: true, error: null, url: 'https://example.com/data.json' }

// Protocole non autorisé
const result2 = GeoLeaf.Validators.validateUrl("ftp://example.com/file");
// Returns: { valid: false, error: 'Protocol "ftp:" not allowed', url: null }

// Autoriser seulement HTTPS
const result3 = GeoLeaf.Validators.validateUrl("http://example.com", {
    allowedProtocols: ["https:"],
});
// Returns: { valid: false, error: 'Protocol "http:" not allowed', url: null }

// Data URL (image uniquement)
const result4 = GeoLeaf.Validators.validateUrl("data:image/png;base64,...");
// Returns: { valid: true, error: null, url: '...' }
```

**Options par défaut** :

- `allowedProtocols` : `['http:', 'https:', 'data:']`
- `allowDataImages` : `true`
- `throwOnError` : `false`

> Les data URLs non-image (`data:text/html`, `data:application/javascript`) sont rejetées même si `allowDataImages: true`.

---

### `validateEmail(email, options?)`

Valide un format d'email.

**Signature** :

```typescript
GeoLeaf.Validators.validateEmail(
    email: unknown,
    options?: { throwOnError?: boolean }
): { valid: boolean; error: string | null }
```

**Exemples** :

```js
// Email valide
GeoLeaf.Validators.validateEmail("user@example.com");
// Returns: { valid: true, error: null }

// Email invalide
GeoLeaf.Validators.validateEmail("not-an-email");
// Returns: { valid: false, error: 'Invalid email format' }

// Formats supportés
GeoLeaf.Validators.validateEmail("user+tag@sub.example.com"); // valide
GeoLeaf.Validators.validateEmail("user@domain.co.uk"); // valide
```

---

### `validatePhone(phone, options?)`

Valide un numéro de téléphone.

**Signature** :

```typescript
GeoLeaf.Validators.validatePhone(
    phone: unknown,
    options?: { throwOnError?: boolean }
): { valid: boolean; error: string | null }
```

**Exemples** :

```js
GeoLeaf.Validators.validatePhone("+33 6 12 34 56 78");
// Returns: { valid: true, error: null }

GeoLeaf.Validators.validatePhone("06-12-34-56-78");
// Returns: { valid: true, error: null }

// Trop peu de chiffres
GeoLeaf.Validators.validatePhone("123");
// Returns: { valid: false, error: 'Phone number must contain at least 10 digits' }
```

**Règles** :

- Caractères autorisés : chiffres, espaces, `+`, `-`, `(`, `)`
- Au moins 10 chiffres après normalisation

---

### `validateZoom(zoom, options?)`

Valide un niveau de zoom cartographique.

**Signature** :

```typescript
GeoLeaf.Validators.validateZoom(
    zoom: number,
    options?: {
        min?: number;
        max?: number;
        throwOnError?: boolean;
    }
): { valid: boolean; error: string | null }
```

**Exemples** :

```js
GeoLeaf.Validators.validateZoom(12);
// Returns: { valid: true, error: null }

GeoLeaf.Validators.validateZoom(25);
// Returns: { valid: false, error: 'Zoom must be between 0 and 20' }

// Plage personnalisée
GeoLeaf.Validators.validateZoom(15, { min: 5, max: 18 });
// Returns: { valid: true, error: null }
```

**Valeurs par défaut** : `min: 0`, `max: 20`

---

### `validateRequiredFields(config, requiredFields, options?)`

Vérifie la présence de champs requis dans un objet de configuration.

**Signature** :

```typescript
GeoLeaf.Validators.validateRequiredFields(
    config: Record<string, unknown> | null | undefined,
    requiredFields: string[],
    options?: { throwOnError?: boolean }
): { valid: boolean; error: string | null; missing: string[] }
```

**Exemples** :

```js
const config = { map: { target: "my-map" } };

const result = GeoLeaf.Validators.validateRequiredFields(config, ["map", "layers"]);
// Returns: { valid: false, error: 'Missing required fields: layers', missing: ['layers'] }

const result2 = GeoLeaf.Validators.validateRequiredFields(config, ["map"]);
// Returns: { valid: true, error: null, missing: [] }
```

---

### `validateGeoJSON(geojson, options?)`

Valide la structure d'un objet GeoJSON.

**Signature** :

```typescript
GeoLeaf.Validators.validateGeoJSON(
    geojson: Record<string, unknown> | null | undefined,
    options?: { throwOnError?: boolean }
): { valid: boolean; error: string | null }
```

**Exemples** :

```js
// FeatureCollection valide
const geojson = {
    type: "FeatureCollection",
    features: [
        {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-73.5673, 45.5017] },
            properties: { name: "Montreal" },
        },
    ],
};
GeoLeaf.Validators.validateGeoJSON(geojson);
// Returns: { valid: true, error: null }

// GeoJSON invalide (features manquant)
GeoLeaf.Validators.validateGeoJSON({ type: "FeatureCollection" });
// Returns: { valid: false, error: 'FeatureCollection must have a features array' }
```

**Types GeoJSON valides** :

`Point`, `MultiPoint`, `LineString`, `MultiLineString`, `Polygon`, `MultiPolygon`, `GeometryCollection`, `Feature`, `FeatureCollection`

---

### `validateColor(color, options?)`

Valide un format de couleur CSS.

**Signature** :

```typescript
GeoLeaf.Validators.validateColor(
    color: unknown,
    options?: { throwOnError?: boolean }
): { valid: boolean; error: string | null }
```

**Formats supportés** :

- Hex court : `#fff`, `#000`
- Hex long : `#ffffff`, `#000000`
- RGB : `rgb(255, 0, 0)`
- RGBA : `rgba(255, 0, 0, 0.5)`
- Toute couleur CSS valide (via `CSS.supports('color', value)`)

**Exemples** :

```js
GeoLeaf.Validators.validateColor("#ff0000"); // valide
GeoLeaf.Validators.validateColor("rgb(255, 0, 0)"); // valide
GeoLeaf.Validators.validateColor("rgba(0,0,0,0.5)"); // valide
GeoLeaf.Validators.validateColor("red"); // valide (CSS named)
GeoLeaf.Validators.validateColor("hsl(120, 100%, 50%)"); // valide (via CSS.supports)
GeoLeaf.Validators.validateColor("#gggggg"); // invalide
```

---

### `validateBatch(validations)`

Exécute plusieurs validations en une seule passe et agrège les erreurs.

**Signature** :

```typescript
GeoLeaf.Validators.validateBatch(
    validations: ValidateBatchItem[]
): { valid: boolean; errors: string[] }
```

**Type `ValidateBatchItem`** :

```typescript
{
    value: unknown;
    validator: (value: unknown, options?: Record<string, unknown>) => { valid: boolean; error?: string | null };
    options?: Record<string, unknown>;
    label?: string;
}
```

**Exemple** :

```js
const result = GeoLeaf.Validators.validateBatch([
    {
        value: 45.5017,
        validator: (v, opts) => GeoLeaf.Validators.validateCoordinates(v, 0, opts),
        label: "latitude",
    },
    {
        value: "https://example.com",
        validator: GeoLeaf.Validators.validateUrl,
        label: "url",
    },
    {
        value: "user@example.com",
        validator: GeoLeaf.Validators.validateEmail,
        label: "email",
    },
]);
// Returns: { valid: true, errors: [] }
// Si erreurs : { valid: false, errors: ['latitude: ...', 'url: ...'] }
```

---

## Intégration dans GeoLeaf

### Où les validateurs sont utilisés

| Module         | Validations appliquées                      |
| -------------- | ------------------------------------------- |
| **Core**       | `validateCoordinates()` pour center/bounds  |
| **POI**        | `validateCoordinates()`, `validateColor()`  |
| **GeoJSON**    | `validateGeoJSON()`, `validateUrl()`        |
| **Route**      | `validateCoordinates()`, `validateUrl()`    |
| **Config**     | `validateUrl()`, `validateRequiredFields()` |
| **BaseLayers** | `validateUrl()` pour les URLs de tuiles     |

### Exemple d'utilisation interne

```js
// Dans GeoLeaf.Core.init()
function init(options) {
    const validation = GeoLeaf.Validators.validateCoordinates(
        options.center[0],
        options.center[1],
        { throwOnError: true }
    );

    // ValidationError lancée automatiquement si invalide
    // Continue l'initialisation...
}
```

---

## Validateurs de style (via `StyleValidator`)

Le module expose également des validateurs de style GeoLeaf accessibles via `GeoLeaf.Validators` :

- `validateStyleRules(rules)` — valide les règles de style conditionnelles
- `validateWhenCondition(condition)` — valide une condition `when`
- `validateSimpleCondition(condition)` — valide une condition simple
- `validateScales(scales)` — valide une configuration de scales
- `validateLegend(legend)` — valide une configuration de légende
- `validateStyle(style)` — validation complète d'un objet style
- `formatValidationErrors(errors)` — formate les erreurs pour affichage

---

## Tests

```bash
# Lancer les tests Validators
npm test -- validators

# Fichiers de tests
# packages/core/__tests__/validators/validators.test.js
```

**Couverture** : 90 %+ (120+ tests passants)

---

## Voir aussi

- `GeoLeaf.Errors` — erreurs typées utilisées par Validators (`ValidationError`, `SecurityError`, `ConfigError`)
- `GeoLeaf.Security` — validation de sécurité XSS/CSRF
- `GeoLeaf.Core` — utilisation lors de l'initialisation
