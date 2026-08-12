---
title: "URL Permalink / Deep Linking"
---

# URL Permalink / Deep Linking

::: tip

**How-to here, contract elsewhere.** This page explains **how to use the feature**. The contract
— scope, configuration, exposed API, boundaries — lives in
[`permalink.md`](https://github.com/geoleaf/geoleaf-js/blob/main/docs/specs/capacites/permalink.md).
Where the two pages disagree, the capability sheet wins.

:::

> **Applies to:** `@geoleaf/core` v2.0.0+

---

## Table of contents

1. [Overview](#overview)
2. [Activation](#activation)
3. [URL parameters](#url-parameters)
4. [Encoding modes](#encoding-modes)
5. [JavaScript API](#javascript-api)
6. [Practical examples](#practical-examples)
7. [Security](#security)
8. [Known limitations](#known-limitations)

---

## Overview

::: warning

**BREAKING (v3.0.0)** — the `poi` field (`gl_poi`) is removed: it made a URL→state→URL round
trip without ever influencing the behaviour of the application (a relic of the POI era, since
dissolved).

:::

The **Permalink** module serialises the current map state (centre, zoom, layer visibility, active filter) into the browser URL. This makes it possible to:

- **Share a link** pointing at a precise map view
- **Reload the page** and land on exactly the same view
- **Embed a specific view** in a marketing campaign (GA4 / Matomo)

Synchronisation uses `history.replaceState()` — no entry is added to the browser history, and the "Back" button is unaffected.

### Internal architecture (v2.0.0)

```
built-in/permalink/
├── permalink-api.ts      // Stateful internal facade — bound to GeoLeaf.Permalink
└── permalink-url.ts      // Stateless logic (readUrl, buildUrl, applyState, startSync)
```

The module is also exposed as the `Permalink` named ESM export of `@geoleaf/core`.

---

## Activation

### Through the JSON profile (`geoleaf.config.json` or `profile.json`)

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

The permalink is **disabled by default** (`enabled: false`). It has no performance impact while disabled.

### Configuration options

| Option    | Type                                 | Default    | Description                              |
| --------- | ------------------------------------ | ---------- | ---------------------------------------- |
| `enabled` | `boolean`                            | `false`    | Enables the permalink.                   |
| `mode`    | `"hash"` \| `"query"` \| `"compact"` | `"hash"`   | URL encoding strategy (see below).       |
| `fields`  | `string[]`                           | all fields | Fields to include in the serialised URL. |

**Valid values for `fields`:** `"lat"`, `"lng"`, `"zoom"`, `"layers"`, `"filter"`

#### Example — map position only, no filters

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

## URL parameters

In `hash` or `query` mode, the following parameters are used. All of them are prefixed with `gl_` to avoid collisions with other fragments in the URL.

| Parameter   | Example         | Description                                                |
| ----------- | --------------- | ---------------------------------------------------------- |
| `gl_lat`    | `48.857445`     | Latitude of the map centre (6 decimal places).             |
| `gl_lng`    | `2.347211`      | Longitude of the centre (6 decimal places).                |
| `gl_zoom`   | `13`            | Zoom level (integer).                                      |
| `gl_layers` | `layer1,layer2` | IDs of the layers **hidden** by the user, comma-separated. |
| `gl_filter` | `restaurant`    | Value of the active text filter.                           |

In `compact` mode, all of these parameters are replaced by a single `gl` parameter encoded as base64 JSON.

---

## Encoding modes

### `"hash"` (default — recommended)

The state is encoded in the URL fragment (`#`). No HTTP request is generated when the page is reloaded.

```
https://mymap.example.com/#gl_lat=48.857445&gl_lng=2.347211&gl_zoom=13
```

**Best for:** static deployments (Nginx, GitHub Pages, S3, CDN).

### `"query"`

The state is encoded in the query string (`?`). The server must return the same HTML whatever the query string is.

```
https://mymap.example.com/?gl_lat=48.857445&gl_lng=2.347211&gl_zoom=13
```

**Best for:** server applications able to pass the query string through to the client.

### `"compact"`

The state is encoded as base64 JSON in the fragment. URLs are shorter, but no longer human-readable.

```
https://mymap.example.com/#gl=eyJsYXQiOjQ4Ljg1NywibG5nIjoyLjM0Nywiem9vbSI6MTN9
```

**Best for:** complex states (many hidden layers, long filter) or sharing through a QR code.

### Transparent auto-compact

In `"hash"` mode, when the fragment grows beyond 200 characters (many hidden layers, for instance), GeoLeaf automatically switches to the compact format, transparently for the user. The switch is silent.

---

## JavaScript API

The module is reachable through `GeoLeaf.Permalink.*` (CDN/global) or as a named ESM export.

### ESM import

```javascript
import { Permalink } from "@geoleaf/core";
```

### `GeoLeaf.Permalink.init(config)`

Initialises the module with the configuration taken from the active profile. Called automatically at boot — not needed in normal use.

```javascript
GeoLeaf.Permalink.init({ enabled: true, mode: "hash" });
```

### `GeoLeaf.Permalink.readAndStore()`

Reads the current URL and caches the parsed state. Called automatically before the map is created.

### `GeoLeaf.Permalink.applyStoredState(map)`

Applies the cached state to the map and the UI. Called automatically once every module is initialised.

**Parameter:** `map` — MapLibre GL instance (`maplibregl.Map`).

### `GeoLeaf.Permalink.startSync(map)`

Starts continuous synchronisation (listens to the MapLibre `moveend` event). Called automatically — not needed in normal use.

### `GeoLeaf.Permalink.getState()`

Returns the permalink state currently loaded (parsed from the URL at start-up), or `null` when no permalink was present.

```javascript
const state = GeoLeaf.Permalink.getState();
// → { lat: 48.857, lng: 2.347, zoom: 13, layers: [], filter: "coffee" }
// → null
```

### `GeoLeaf.Permalink.buildUrl(state?)`

Serialises a state (or the current state) into a URL string.

```javascript
// Current stored state
const url = GeoLeaf.Permalink.buildUrl();
// → "#gl_lat=48.857445&gl_lng=2.347211&gl_zoom=13"

// Explicit state
const url = GeoLeaf.Permalink.buildUrl({ lat: 44.0, lng: 3.0, zoom: 10 });
// → "#gl_lat=44.000000&gl_lng=3.000000&gl_zoom=10"
```

### `GeoLeaf.Permalink._reset()` (test only)

Resets the internal state. Reserved for tests.

---

## Practical examples

### Shareable link — copy the current URL

```javascript
const permalinkUrl =
    window.location.origin + window.location.pathname + GeoLeaf.Permalink.buildUrl();

navigator.clipboard.writeText(permalinkUrl);
```

### "Share" button in an application

```html
<button id="share-btn">Share this view</button>
```

```javascript
document.getElementById("share-btn").addEventListener("click", () => {
    const url = window.location.origin + window.location.pathname + GeoLeaf.Permalink.buildUrl();

    if (navigator.share) {
        navigator.share({ title: "Map view", url });
    } else {
        navigator.clipboard.writeText(url);
        alert("Link copied to the clipboard");
    }
});
```

### Analytics — send the shared view to GA4

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

### Compact mode — sharing through a QR code

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

### Enabling the permalink on an existing profile (minimal addition)

```json
{
    "ui": {
        "permalink": { "enabled": true }
    }
}
```

GeoLeaf then uses the default values: `hash` mode, every field included.

---

## Security

The Permalink module applies the following measures to prevent injection or exploitation through the URL:

- Numeric values (`lat`, `lng`, `zoom`) are validated with `validateCoordinates()` and `validateNumber()` from the `security` module (`packages/core/src/modules/built-in/security/index.ts`). Any out-of-range or non-numeric value is silently ignored (permalink state = `null`).
- Layer lists are capped at **100 entries**.
- Text fields (`filter`) are truncated to **200 characters**.
- In compact mode, the base64 data is parsed with `JSON.parse()` inside a `try/catch`. Any invalid or malformed payload is ignored.
- No `innerHTML` is used in this module.

---

## Known limitations

| Limitation             | Detail                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Multiple tabs**      | Two tabs open on the same map change the same URL fragment without coordination. Expected behaviour.           |
| **`file://` protocol** | `history.replaceState()` is not available on the `file://` protocol. URL synchronisation is silently disabled. |
| **SSR / Node.js**      | The module detects the absence of `window` and returns `null` — no error is raised in a server context.        |

---

_GeoLeaf Core — © 2026 Mattieu Pottier — MIT License_
