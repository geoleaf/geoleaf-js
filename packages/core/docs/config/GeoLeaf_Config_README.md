---
title: "GeoLeaf.Config – Config module documentation (JSON loading)"
---

# GeoLeaf.Config – Config module documentation (JSON loading)

The **GeoLeaf.Config** module loads and validates the **external JSON configuration** used by GeoLeaf.

It provides:

- loading of an external JSON file (by URL) or of an inline object;

- validation and normalisation of the schema (`map`, `data`, `ui`, `basemaps`, `layers`, `poi` blocks…);

- exposure of the data to the other modules through typed accessors;

- an internal event signalling that the configuration is ready;

- an automatic call to a user callback (`onLoaded`);

- support for `autoEvent` mode, which dispatches a custom DOM event;

- multi-profile handling through `ProfileManager` (the taxonomy belongs to the `GeoLeaf.Taxonomy` capability).

This module drives the **complete initialisation sequence** of GeoLeaf.

---

## 1. Functional role of GeoLeaf.Config

1. Load a JSON configuration from:
    - a remote file (`url`),
    - an inline JS object (`config`).

2. Validate and normalise the essential blocks:
    - `map` (DOM target, centre, zoom, bounds, MapLibre options),
    - `data` (active profile, profile path),
    - `ui` (theme, language, controls),
    - `basemaps` (raster or vector background layers),
    - `layers` (referenced GeoJSON/vector layers),
    - `poi`, `poiConfig`, `categories`.

3. Expose the configuration to the other modules through:
    - `Config.getAll()` — full configuration,
    - `Config.get(path, default)` — read by dotted path,
    - `Config.getSection(name)` — read a whole block,
    - `Config.getActiveProfile()` — active profile (through `ProfileManager`),
    - `Config.getActiveProfileMapping()` — mapping of the active profile,
    - `Config.isProfilePoiMappingEnabled()` — POI mapping enabled.

4. Call an `onLoaded(config)` callback once everything is ready.

5. Dispatch a `"geoleaf:config:loaded"` DOM event when `autoEvent` is enabled.

This module is the **entry point** of the whole GeoLeaf logic.

---

## 2. Public API of the Config module

- `GeoLeaf.Config.init(options)` — loads the configuration and initialises the sub-modules
- `GeoLeaf.Config.loadUrl(url, options?)` — loads an external JSON file
- `GeoLeaf.Config.loadTaxonomy(url, options?)` — loads a category mapping
- `GeoLeaf.Config.loadActiveProfileResources(options?)` — loads the resources of the active profile
- `GeoLeaf.Config.getAll()` — returns the full configuration
- `GeoLeaf.Config.get(path, default?)` — reads a field by dotted path
- `GeoLeaf.Config.set(path, value)` — sets a field
- `GeoLeaf.Config.getSection(name, default?)` — reads a configuration block
- `GeoLeaf.Config.getActiveProfile()` — active profile (full object)
- `GeoLeaf.Config.getActiveProfileId()` — identifier of the active profile
- `GeoLeaf.Config.getActiveProfileMapping()` — taxonomy mapping of the active profile
- `GeoLeaf.Config.isProfilePoiMappingEnabled()` — true when the POI mapping is enabled
- The taxonomy (categories / sub-categories) is exposed by the `GeoLeaf.Taxonomy` capability — see `GeoLeaf.Taxonomy.getCategories(ref)`
- `GeoLeaf.Config.isLoaded()` — true when the configuration is ready
- `GeoLeaf.Config.getSource()` — source that produced the configuration (`"url"` or `"inline"`)

---

## 3. `GeoLeaf.Config.init(options)`

Initialises the module by declaring the source of the configuration.

```js
GeoLeaf.Config.init({
    url: "../data/geoleaf.config.json",
    autoEvent: true,
    onLoaded: (config) => {
        console.log("Config loaded:", config);
    },
});
```

### 3.1 Parameters (`ConfigInitOptions`)

| Parameter                  | Type                              | Description                                                          |
| -------------------------- | --------------------------------- | -------------------------------------------------------------------- |
| `config`                   | `GeoLeafConfig`                   | Inline configuration (takes precedence over `url`)                   |
| `url`                      | `string`                          | URL of the JSON file to load through `fetch`                         |
| `headers`                  | `Record<string, string>`          | Custom HTTP headers for the `fetch`                                  |
| `strictContentType`        | `boolean`                         | Rejects non-`application/json` responses (default: `true`)           |
| `autoEvent`                | `boolean`                         | Dispatches `"geoleaf:config:loaded"` after loading (default: `true`) |
| `onLoaded`                 | `(config: GeoLeafConfig) => void` | Callback invoked after a successful load                             |
| `onError`                  | `(err: Error) => void`            | Callback invoked when loading fails                                  |
| `profileId`                | `string`                          | Identifier of the profile to activate                                |
| `mappingUrl`               | `string`                          | URL of the category mapping file (taxonomy)                          |
| `mappingHeaders`           | `Record<string, string>`          | HTTP headers for the taxonomy fetch                                  |
| `mappingStrictContentType` | `boolean`                         | Content-type validation for the taxonomy                             |

### 3.2 Behaviour

- When `config` is supplied → the configuration is used immediately (synchronous path).
- When `url` is supplied → an asynchronous `fetch` call is made.
- When `mappingUrl` is supplied → the taxonomy is loaded in parallel.
- After loading:
    - the configuration is normalised and stored internally,
    - `StorageHelper` and `ProfileManager` are initialised,
    - the `onLoaded` callback is invoked,
    - the DOM event is dispatched (when `autoEvent = true`).
- Returns a `Promise<GeoLeafConfig>`.

---

## 4. `GeoLeaf.Config.loadUrl(url, options?)`

Loads the JSON configuration from a URL.

```js
await GeoLeaf.Config.loadUrl("../data/config.json", {
    headers: { Authorization: "Bearer token" },
});
```

### 4.1 Behaviour

- performs an asynchronous `fetch(url)`;
- validates the content-type when `strictContentType` is enabled;
- parses the JSON and applies the configuration through `_applyConfig`;
- automatically triggers the follow-up (`_maybeFireLoadedEvent`).

### 4.2 Error handling

- Invalid JSON → controlled log, returns the existing configuration
- Unreachable URL → error log and clean return (no unhandled exception)

---

## 5. Main accessors

### `GeoLeaf.Config.getAll()`

Returns the configuration currently loaded.

```js
const config = GeoLeaf.Config.getAll();
console.log(config.map.zoom);
```

### `GeoLeaf.Config.get(path, defaultValue?)`

Reads a field by dotted path.

```js
const theme = GeoLeaf.Config.get("ui.theme", "light");
const zoom = GeoLeaf.Config.get("map.zoom", 10);
```

### `GeoLeaf.Config.getActiveProfile()`

Returns the active profile object (loaded by `ProfileManager`).

```js
const profile = GeoLeaf.Config.getActiveProfile();
if (profile?.panels?.detail?.layout) {
    // Use the detail panel layout
}
```

---

## 6. Supported JSON structure

The full structure is shown below (every block is optional except `map`):

```json
{
    "map": {
        "target": "geoleaf-map",
        "bounds": [
            [43.0, -0.5],
            [46.0, 3.5]
        ],
        "zoom": 10,
        "maxZoom": 19,
        "minZoom": 6
    },
    "data": {
        "activeProfile": "mon-profil",
        "profilesBasePath": "profiles"
    },
    "ui": {
        "theme": "auto",
        "language": "en",
        "showLayerManager": true,
        "showFilterPanel": true,
        "permalink": {
            "enabled": true,
            "mode": "hash"
        }
    },
    "basemaps": {
        "osm": {
            "type": "tile",
            "label": "OpenStreetMap",
            "url": "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "defaultBasemap": true
        }
    },
    "layers": [],
    "logging": {
        "level": "info"
    },
    "security": {
        "httpsOnly": false
    }
}
```

---

## 7. Full initialisation sequence

1. `GeoLeaf.Config.init({ url })`
2. `fetch()` of the JSON file
3. Validation and normalisation of the JSON
4. `StorageHelper.init(config)` — read/write access to the configuration
5. `ProfileManager.init(config)` — loading of the active profile
6. Call to the `onLoaded(config)` callback
7. Dispatch of `geoleaf:config:loaded` (when `autoEvent = true`)
8. The `geoleaf.boot.ts` facade then chains:
    - `GeoLeaf.Core.init(config.map)` → creates the MapLibre GL map
    - initialisation of the UI, the layers, the POIs and the plugins

---

## 8. Quick summary of the Config API

| Method                         | Role                                            |
| ------------------------------ | ----------------------------------------------- |
| `init(options)`                | Starts loading the JSON file or the inline data |
| `loadUrl(url, options?)`       | Loads an external JSON file                     |
| `loadTaxonomy(url, options?)`  | Loads a category mapping                        |
| `loadActiveProfileResources()` | Loads the resources of the active profile       |
| `getAll()`                     | Returns the full configuration                  |
| `get(path, default?)`          | Reads a field by dotted path                    |
| `set(path, value)`             | Sets a field                                    |
| `getSection(name, default?)`   | Reads a configuration block                     |
| `getActiveProfile()`           | Active profile (through ProfileManager)         |
| `getActiveProfileId()`         | Identifier of the active profile                |
| `getActiveProfileMapping()`    | Taxonomy mapping of the active profile          |
| `isProfilePoiMappingEnabled()` | `true` when the POI mapping is enabled          |
| `isLoaded()`                   | True when the configuration is initialised      |
| `getSource()`                  | Configuration source (`"url"` or `"inline"`)    |

---

## 9. TypeScript types

The types are declared in `config-types.ts`:

- `GeoLeafConfig` — root object (map, data, ui, basemaps, layers…)
- `MapConfig` — `map` section (target, bounds, center, zoom, mapOptions…)
- `DataConfig` — `data` section (activeProfile, profilesBasePath)
- `UIConfig` — `ui` section (theme, language, controls, permalink)
- `ConfigInitOptions` — options of `Config.init()`
- `BasemapConfig` — definition of a basemap
- `LayerConfig` — reference to a GeoJSON layer
- `LayerFileConfig` — structure of a layer configuration file
- `PermalinkConfig` — URL deep-linking

---

## 10. Best practices

- Always initialise **Config** before any other module.
- Prefer a single, centralised JSON configuration per deployment.
- Use `autoEvent: true` (the default) to integrate GeoLeaf into external frameworks.
- Always validate JSON files before use (no JSON5 comments).
- Use the typed accessors (`get`, `getSection`, `getActiveProfile`) rather than reading `_config` directly.
- The `map.target` block is mandatory (HTML identifier of the container element).
