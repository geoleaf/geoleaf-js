---
title: "GeoLeaf.Validators — Validators module documentation"
---

# GeoLeaf.Validators — Validators module documentation

**Applies to**: @geoleaf/core v3.x

**Source**: `src/modules/geoleaf.validators.ts` → `src/modules/utils/validators/general-validators.ts`

---

## Overview

The **GeoLeaf.Validators** module provides centralised, reusable validation functions for every GeoLeaf module. It relies on the typed errors of `GeoLeaf.Errors` for consistent error handling.

### Main responsibilities

- **Coordinate validation** — latitude/longitude
- **URL validation** — protocols, formats
- **Email validation** — RFC format
- **Phone number validation** — international format
- **Zoom level validation** — configurable range
- **Colour validation** — hex, RGB, RGBA, CSS
- **GeoJSON validation** — structure and geometries
- **Required field validation** — presence check
- **Batch validation** — `validateBatch`

---

## Validation API

### `validateCoordinates(lat, lng, options?)`

Validates geographic coordinates.

**Signature**:

```typescript
GeoLeaf.Validators.validateCoordinates(
    lat: number,
    lng: number,
    options?: { throwOnError?: boolean }
): { valid: boolean; error: string | null }
```

**Examples**:

```js
// Valid coordinates
const result = GeoLeaf.Validators.validateCoordinates(45.5017, -73.5673);
// Returns: { valid: true, error: null }

// Invalid latitude (> 90)
const result2 = GeoLeaf.Validators.validateCoordinates(95, -73);
// Returns: { valid: false, error: 'Latitude must be between -90 and 90' }

// Strict mode (throws)
try {
    GeoLeaf.Validators.validateCoordinates(95, -73, { throwOnError: true });
} catch (error) {
    console.error("Invalid coordinates:", error.message);
}
```

**Checks performed**:

- Type `number` (not a string or anything else)
- Finite values (no NaN, no Infinity)
- Latitude between -90 and +90
- Longitude between -180 and +180

---

### `validateUrl(url, options?)`

Validates a URL, with protocol options.

**Signature**:

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

**Examples**:

```js
// Valid HTTPS URL
const result = GeoLeaf.Validators.validateUrl("https://example.com/data.json");
// Returns: { valid: true, error: null, url: 'https://example.com/data.json' }

// Protocol not allowed
const result2 = GeoLeaf.Validators.validateUrl("ftp://example.com/file");
// Returns: { valid: false, error: 'Protocol "ftp:" not allowed', url: null }

// Allow HTTPS only
const result3 = GeoLeaf.Validators.validateUrl("http://example.com", {
    allowedProtocols: ["https:"],
});
// Returns: { valid: false, error: 'Protocol "http:" not allowed', url: null }

// Data URL (images only)
const result4 = GeoLeaf.Validators.validateUrl("data:image/png;base64,...");
// Returns: { valid: true, error: null, url: '...' }
```

**Default options**:

- `allowedProtocols`: `['http:', 'https:', 'data:']`
- `allowDataImages`: `true`
- `throwOnError`: `false`

> Non-image data URLs (`data:text/html`, `data:application/javascript`) are rejected even when `allowDataImages: true`.

---

### `validateEmail(email, options?)`

Validates an email format.

**Signature**:

```typescript
GeoLeaf.Validators.validateEmail(
    email: unknown,
    options?: { throwOnError?: boolean }
): { valid: boolean; error: string | null }
```

**Examples**:

```js
// Valid email
GeoLeaf.Validators.validateEmail("user@example.com");
// Returns: { valid: true, error: null }

// Invalid email
GeoLeaf.Validators.validateEmail("not-an-email");
// Returns: { valid: false, error: 'Invalid email format' }

// Supported formats
GeoLeaf.Validators.validateEmail("user+tag@sub.example.com"); // valid
GeoLeaf.Validators.validateEmail("user@domain.co.uk"); // valid
```

---

### `validatePhone(phone, options?)`

Validates a phone number.

**Signature**:

```typescript
GeoLeaf.Validators.validatePhone(
    phone: unknown,
    options?: { throwOnError?: boolean }
): { valid: boolean; error: string | null }
```

**Examples**:

```js
GeoLeaf.Validators.validatePhone("+33 6 12 34 56 78");
// Returns: { valid: true, error: null }

GeoLeaf.Validators.validatePhone("06-12-34-56-78");
// Returns: { valid: true, error: null }

// Too few digits
GeoLeaf.Validators.validatePhone("123");
// Returns: { valid: false, error: 'Phone number must contain at least 10 digits' }
```

**Rules**:

- Allowed characters: digits, spaces, `+`, `-`, `(`, `)`
- At least 10 digits after normalisation

---

### `validateZoom(zoom, options?)`

Validates a map zoom level.

**Signature**:

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

**Examples**:

```js
GeoLeaf.Validators.validateZoom(12);
// Returns: { valid: true, error: null }

GeoLeaf.Validators.validateZoom(25);
// Returns: { valid: false, error: 'Zoom must be between 0 and 20' }

// Custom range
GeoLeaf.Validators.validateZoom(15, { min: 5, max: 18 });
// Returns: { valid: true, error: null }
```

**Default values**: `min: 0`, `max: 20`

---

### `validateRequiredFields(config, requiredFields, options?)`

Checks that required fields are present in a configuration object.

**Signature**:

```typescript
GeoLeaf.Validators.validateRequiredFields(
    config: Record<string, unknown> | null | undefined,
    requiredFields: string[],
    options?: { throwOnError?: boolean }
): { valid: boolean; error: string | null; missing: string[] }
```

**Examples**:

```js
const config = { map: { target: "my-map" } };

const result = GeoLeaf.Validators.validateRequiredFields(config, ["map", "layers"]);
// Returns: { valid: false, error: 'Missing required fields: layers', missing: ['layers'] }

const result2 = GeoLeaf.Validators.validateRequiredFields(config, ["map"]);
// Returns: { valid: true, error: null, missing: [] }
```

---

### `validateGeoJSON(geojson, options?)`

Validates the structure of a GeoJSON object.

**Signature**:

```typescript
GeoLeaf.Validators.validateGeoJSON(
    geojson: Record<string, unknown> | null | undefined,
    options?: { throwOnError?: boolean }
): { valid: boolean; error: string | null }
```

**Examples**:

```js
// Valid FeatureCollection
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

// Invalid GeoJSON (features missing)
GeoLeaf.Validators.validateGeoJSON({ type: "FeatureCollection" });
// Returns: { valid: false, error: 'FeatureCollection must have a features array' }
```

**Valid GeoJSON types**:

`Point`, `MultiPoint`, `LineString`, `MultiLineString`, `Polygon`, `MultiPolygon`, `GeometryCollection`, `Feature`, `FeatureCollection`

---

### `validateColor(color, options?)`

Validates a CSS colour format.

**Signature**:

```typescript
GeoLeaf.Validators.validateColor(
    color: unknown,
    options?: { throwOnError?: boolean }
): { valid: boolean; error: string | null }
```

**Supported formats**:

- Short hex: `#fff`, `#000`
- Long hex: `#ffffff`, `#000000`
- RGB: `rgb(255, 0, 0)`
- RGBA: `rgba(255, 0, 0, 0.5)`
- Any valid CSS colour (through `CSS.supports('color', value)`)

**Examples**:

```js
GeoLeaf.Validators.validateColor("#ff0000"); // valid
GeoLeaf.Validators.validateColor("rgb(255, 0, 0)"); // valid
GeoLeaf.Validators.validateColor("rgba(0,0,0,0.5)"); // valid
GeoLeaf.Validators.validateColor("red"); // valid (CSS named)
GeoLeaf.Validators.validateColor("hsl(120, 100%, 50%)"); // valid (through CSS.supports)
GeoLeaf.Validators.validateColor("#gggggg"); // invalid
```

---

### `validateBatch(validations)`

Runs several validations in a single pass and aggregates the errors.

**Signature**:

```typescript
GeoLeaf.Validators.validateBatch(
    validations: ValidateBatchItem[]
): { valid: boolean; errors: string[] }
```

**`ValidateBatchItem` type**:

```typescript
{
    value: unknown;
    validator: (value: unknown, options?: Record<string, unknown>) => { valid: boolean; error?: string | null };
    options?: Record<string, unknown>;
    label?: string;
}
```

**Example**:

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
// On failure: { valid: false, errors: ['latitude: ...', 'url: ...'] }
```

---

## Integration inside GeoLeaf

### Where the validators are used

| Module         | Validations applied                         |
| -------------- | ------------------------------------------- |
| **Core**       | `validateCoordinates()` for center/bounds   |
| **POI**        | `validateCoordinates()`, `validateColor()`  |
| **GeoJSON**    | `validateGeoJSON()`, `validateUrl()`        |
| **Route**      | `validateCoordinates()`, `validateUrl()`    |
| **Config**     | `validateUrl()`, `validateRequiredFields()` |
| **BaseLayers** | `validateUrl()` for tile URLs               |

### Internal usage example

```js
// Inside GeoLeaf.Core.init()
function init(options) {
    const validation = GeoLeaf.Validators.validateCoordinates(
        options.center[0],
        options.center[1],
        { throwOnError: true }
    );

    // ValidationError is thrown automatically when invalid
    // Carry on with initialisation...
}
```

---

## Style validators (through `StyleValidator`)

The module also exposes the GeoLeaf style validators, reachable through `GeoLeaf.Validators`:

- `validateStyleRules(rules)` — validates conditional style rules
- `validateWhenCondition(condition)` — validates a `when` condition
- `validateSimpleCondition(condition)` — validates a simple condition
- `validateScales(scales)` — validates a scales configuration
- `validateLegend(legend)` — validates a legend configuration
- `validateStyle(style)` — full validation of a style object
- `formatValidationErrors(errors)` — formats the errors for display

---

## Tests

```bash
# Run the Validators tests
npm test -- validators

# Test files
# packages/core/__tests__/validators/validators.test.js
```

**Coverage**: 90%+ (120+ passing tests)

---

## See also

- `GeoLeaf.Errors` — typed errors used by Validators (`ValidationError`, `SecurityError`, `ConfigError`)
- `GeoLeaf.Security` — XSS/CSRF security validation
- `GeoLeaf.Core` — used during initialisation
