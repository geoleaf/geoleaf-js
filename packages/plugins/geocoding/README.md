# @geoleaf-plugins/geocoding

GeoLeaf plugin that adds **address search (geocoding)** to an interactive map. The user types an address or place name in a floating pill; the plugin queries a geocoding provider, shows the matches in a dropdown, and recenters the map on the chosen result. All in the browser — no server, no API key for the built-in providers.

- **MIT License** — public registry (npmjs.org)
- Requires `@geoleaf/core` loaded before this plugin
- ESM only — no CommonJS/UMD
- **Zero runtime npm dependencies** (native `fetch` + a small inlined search-pill helper)
- Providers: **Addok / BAN** (France, default), **Nominatim** (worldwide), **Photon** (worldwide), a **custom HTTPS endpoint**, **`layers` — the map's own features, found by reference with no network** (1.1.0), or one you register
- An ordered **list** of providers (1.1.0): `["layers", "nominatim"]` shows the map's features before any address, and asks no address service while the browser is offline

> **Extracted from `@geoleaf/core`.** Address search used to be part of the core and configured via the root `geocodingConfig` profile key. It is now this plugin, configured under `modules.geocoding.*`. See [Migration from core](#migration-from-core) — this is a breaking change.

---

## Installation

```bash
npm install @geoleaf-plugins/geocoding
```

Load in your HTML **after** `@geoleaf/core` and **before** `GeoLeaf.boot()`:

```html
<script
    type="module"
    src="node_modules/@geoleaf-plugins/geocoding/dist/geoleaf-geocoding.plugin.js"
></script>
```

The plugin mounts the `GeoLeaf.Geocoding` namespace at load and, when enabled, renders its own search pill on the map. On desktop the pill is always visible; on mobile (≤ 768 px) it is revealed by the geocoding toolbar button.

---

## Quick start

Enable geocoding in the active profile under `modules.geocoding` (file `config/plugins/geocoding.json`, referenced by `Files.modules.geocoding`):

```json
{
    "enabled": true,
    "provider": "nominatim",
    "countrycodes": "fr"
}
```

That is all the UI needs — the pill appears and works on its own. You can also drive geocoding programmatically, without the UI:

```html
<script type="module">
    // Programmatic search — no UI required
    const results = await GeoLeaf.Geocoding.search("10 rue de Rivoli, Paris", 5);
    if (results.length) {
        GeoLeaf.Geocoding.selectResult(results[0]); // recenters the map + emits the event
    }

    // React to any selection (pill or programmatic)
    document.addEventListener("geoleaf:geocoding:result", (e) => {
        const { label, lat, lng, bounds } = e.detail;
        console.log("Selected:", label, lat, lng, bounds);
    });
</script>
```

---

## Providers

| `provider`             | Service                                              | Coverage    | API key             | Geographic filters                      |
| ---------------------- | ---------------------------------------------------- | ----------- | ------------------- | --------------------------------------- |
| `"addok"` _(default)_  | Addok / BAN (Base Adresse Nationale)                 | France      | No                  | `bbox` → proximity bias (centroid)      |
| `"nominatim"`          | OpenStreetMap Nominatim                              | Worldwide   | No                  | `bbox` (strict viewbox), `countrycodes` |
| `"photon"`             | Photon (Komoot)                                      | Worldwide   | No                  | `bbox` (strict)                         |
| `"https://…"` (string) | Custom HTTPS endpoint                                | Your own    | Your own            | depends on the endpoint                 |
| `"layers"` _(1.1.0)_   | The features the map holds (`GeoLeaf.Layers.search`) | Your layers | No — **no network** | the layers declaring `searchable`       |

- **`"layers"`** searches the layers whose configuration declares `searchable: { fields: [...] }`, on each feature's id and those fields — with no network, so it answers off-network for a layer read from the device store. Selecting one of its results frames the feature and selects it (`GeoLeaf.Layers.focus`). Requires `@geoleaf/core` 3.10.0; an older core answers nothing.
- **A list** — `"provider": ["layers", "nominatim"]` — is asked in order, its results kept in that order within `resultLimit`. While the browser is offline, the providers that need the network are not asked at all.
- ⚠️ **An unknown single `provider`**, or a custom URL that does not start with `https://`, **falls back to Addok** — which sends the search to that service — and, since 1.1.0, **a warning names it: this value will be refused from the next minor version.** Inside a list, an unknown name is refused already: nothing is asked for it.
- **Nominatim** is the only provider that honours `countrycodes`; it enforces a max of **1 request/second** (the plugin sends an identifying `User-Agent`).
- **Addok** has no strict `bbox` filter — the box centroid is used as a proximity bias.
- A custom endpoint is called with `?q=<query>&limit=<n>` and must return a GeoJSON `FeatureCollection`.

---

## Configuration (`modules.geocoding.*`)

| Key            | Type                                                                                                                  | Default                     | Description                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------ |
| `enabled`      | `boolean`                                                                                                             | `false`                     | Enables the search pill (the control mounts only when `true`).                       |
| `provider`     | `"addok" \| "nominatim" \| "photon" \| "layers" \| string` (https URL or registered name), or an ordered list of them | `"addok"`                   | Provider(s) asked (see above).                                                       |
| `debounceMs`   | `number`                                                                                                              | `300`                       | Debounce delay before firing a search (ms).                                          |
| `minChars`     | `number`                                                                                                              | `3`                         | Minimum characters before a search is triggered.                                     |
| `resultLimit`  | `number`                                                                                                              | `5`                         | Maximum number of results.                                                           |
| `position`     | `"top-left" \| "top-right" \| "bottom-left" \| "bottom-right"`                                                        | `"top-left"`                | Pill position on the map.                                                            |
| `placeholder`  | `string`                                                                                                              | `"Rechercher une adresse…"` | Input placeholder text.                                                              |
| `flyToZoom`    | `number`                                                                                                              | `15`                        | Zoom level when flying to a point result.                                            |
| `bbox`         | `[west, south, east, north]` (WGS-84)                                                                                 | —                           | Restrict results to an area. Nominatim/Photon: strict filter; Addok: proximity bias. |
| `countrycodes` | `string` (ISO 3166-1 alpha-2, comma-separated)                                                                        | —                           | Restrict results to countries — **Nominatim only**.                                  |

```json
{
    "enabled": true,
    "provider": "photon",
    "bbox": [-5.2, 41.3, 9.6, 51.1],
    "resultLimit": 8,
    "flyToZoom": 14
}
```

---

## Public API (`GeoLeaf.Geocoding`)

### `isEnabled()`

Returns `true` when `modules.geocoding.enabled` is set in the active profile.

```typescript
function isEnabled(): boolean;
```

### `search(query, limit?)`

Searches programmatically — no UI required — across the configured provider(s). Resolves to an array of results (empty on no match or network error; never rejects). `limit` defaults to `resultLimit` or 5.

```typescript
interface GeocodingResult {
    label: string; // display label
    lat: number; // WGS-84 latitude
    lng: number; // WGS-84 longitude
    bounds?: { north: number; south: number; east: number; west: number };
    layerId?: string; // set by "layers": the feature's layer
    layerLabel?: string; // …and its display label
    featureId?: string | null; // …and its id (null: framed, not selected)
}

function search(query: string, limit?: number): Promise<GeocodingResult[]>;
```

### `selectResult(result)`

Recenters the map on a result and emits `geoleaf:geocoding:result`. A feature found by `"layers"` is framed and selected through `GeoLeaf.Layers.focus`; any other result uses `fitBounds` when it has a `bounds`, `flyTo` (at `flyToZoom`) otherwise.

```typescript
function selectResult(result: GeocodingResult): void;
```

### `registerProvider(name, factory)` _(1.1.0)_

Makes a search service available under `name`, for `modules.geocoding.provider` to list. Registering an existing name replaces it. A provider's `search(query, limit)` resolves to results shaped like `GeocodingResult`; `network: false` lets it be asked off-network. Throws when `name` is empty or `factory` is not a function.

```typescript
interface GeocodingProvider {
    search(query: string, limit: number): Promise<GeocodingResult[]>;
    readonly network?: boolean;
}

function registerProvider(name: string, factory: (config: object) => GeocodingProvider): void;
```

### `open(button?)`

Toggles the floating pill on mobile and focuses the input. Invoked by the geocoding toolbar button (action `"geocoding"`). No-op until the control is mounted.

```typescript
function open(button?: HTMLElement | null): void;
```

### `destroy()`

Unmounts the control and releases all DOM listeners (useful on a hot profile change — it re-mounts on the next `geoleaf:map:ready` if still enabled).

```typescript
function destroy(): void;
```

---

## Event

`geoleaf:geocoding:result` is dispatched on `document` (bubbling) whenever a result is selected — from the pill or via `selectResult()`.

```typescript
document.addEventListener("geoleaf:geocoding:result", (e) => {
    // `geoleaf:geocoding:result` is not in `GeoLeafEventMap`, so the listener receives an
    // `Event` — hence the cast. Same shape as the TSDoc of `public-api.ts`.
    const { label, lat, lng, bounds } = (e as CustomEvent).detail; // bounds is null for a point
});
```

---

## Migration from core

Before the extraction (`@geoleaf/core` ≤ v3), geocoding was part of the core: `GeoLeaf.Geocoding` was provided by the core and configured via the **root** `geocodingConfig` profile key. Now the core no longer ships geocoding — this plugin does.

**There is no compatibility shim.** To migrate:

1. Move the `geocodingConfig` block out of the profile root into `config/plugins/geocoding.json`.
2. Declare it in the profile manifest under `Files.modules.geocoding`.
3. Load this plugin's script on the page, after `@geoleaf/core`.

| Before (core)                                    | After (plugin)                                              |
| ------------------------------------------------ | ----------------------------------------------------------- |
| `geocodingConfig` at the profile root            | `modules.geocoding` (`config/plugins/geocoding.json`)       |
| `GeoLeaf.Config.get("geocodingConfig")` → object | `GeoLeaf.Config.get("geocodingConfig")` → **`undefined`**   |
| `GeoLeaf.Geocoding` present with the core        | requires this plugin's script loaded after `geoleaf.esm.js` |

---

## Limitations

- **Nominatim** is the only provider honouring `countrycodes`; **Addok** maps `bbox` to a proximity bias, not a strict filter.
- A **custom endpoint must be HTTPS** (anything else falls back to Addok, with a warning, until the next minor version refuses it) and must return a GeoJSON `FeatureCollection` answering `?q=` and `&limit=`.
- **`"layers"` finds only what the map holds**: a layer never loaded (`active: false`) and a vector-tile layer are not searched. A search that finds nothing says so ("No results").
- The pill mounts on the map returned by `GeoLeaf.Core.getMap()` — one map at a time (no per-`mapId` scoping yet).

---

## Bundle budget

| Part          | Size (gzip)               |
| ------------- | ------------------------- |
| Plugin bundle | budget 25 KB (warn 18 KB) |

No third-party runtime dependency is bundled (native `fetch` + an inlined copy of the search-pill helper). `@geoleaf/core` is accessed via `globalThis.GeoLeaf`; `maplibre-gl` is a peer dependency provided by the host page.

---

## MIT License

Copyright © 2026 Mattieu Pottier. See [LICENSE](./LICENSE) for details.
