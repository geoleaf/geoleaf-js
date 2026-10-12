# `@geoleaf-plugins/isochrone`

MIT plugin for [GeoLeaf](https://geoleaf.dev). It shows the zones reachable from a point of the
map within a given time. The zones are computed by a **routing engine**, elsewhere: the plugin
asks the question, reads the answer and credits the data. It computes nothing itself.

It mounts `GeoLeaf.Isochrone` and registers itself with the core at load time.

> **Under construction, and not published yet.** The package is not on the npm registry. This
> version carries the plugin's configuration, its provider registry and its routing-engine
> client; it draws no zone and opens no window yet. The tables below list what the code reads
> and exposes today, and nothing else.

## Installation

Once it is published:

```sh
npm install @geoleaf-plugins/isochrone
```

Load it **after** `@geoleaf/core`. Loaded **before** `GeoLeaf.boot()`, the plugin declares its
own toolbar button; a host may instead register it for loading on demand, and declare the button
itself.

```html
<script type="module" src="./geoleaf.esm.js"></script>
<script type="module" src="./geoleaf-isochrone.plugin.js"></script>
```

## Configuration (`modules.isochrone.*`)

Every key below is read through `src/config.ts`, the plugin's single door onto the profile.
A key absent from the profile takes the default shown here.

| Key           | Type       | Default                                                                                    | Description                                                                                                                                            |
| ------------- | ---------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `enabled`     | `boolean`  | `true`                                                                                     | `false`: `open()` answers `false` and builds nothing. The button follows `showButton` alone.                                                           |
| `showButton`  | `boolean`  | `true`                                                                                     | Shows the toolbar button. Read by the core registry through the slot's `profileKey`.                                                                   |
| `provider`    | `string`   | `"valhalla"`                                                                               | Routing engine to ask. An unknown name is refused, never replaced by another engine. Empty or not a string falls back on the default.                  |
| `endpoint`    | `string`   | `""`                                                                                       | Base URL of the engine. Empty selects the provider's default address. Anything that is not `https://` is refused, and never replaced by the default.   |
| `timeoutMs`   | `number`   | `10000`                                                                                    | Time the engine is given per request, in milliseconds. Zero or negative falls back on the default.                                                     |
| `mode`        | `string`   | `"car"`                                                                                    | Travel mode offered first — `car`, `foot` or `bike`. An unknown value falls back on `car`; a mode that is not among `modes`, on the first one that is. |
| `modes`       | `string[]` | `["car", "foot", "bike"]`                                                                  | Travel modes offered. An unknown name is discarded; an empty list falls back on the three.                                                             |
| `durations`   | `number[]` | `[5, 10, 15]`                                                                              | Durations offered, in whole positive minutes, sorted ascending. Anything else is discarded; an empty list falls back on the default.                   |
| `maxLayers`   | `number`   | `8`                                                                                        | Cap on the number of zones displayed. A whole number, at least 1.                                                                                      |
| `zIndex`      | `number`   | `50`                                                                                       | Base rank of the zones among the profile's layers.                                                                                                     |
| `palette`     | `string[]` | `["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"]` | Colours given to the zones, written `#rrggbb`. Anything else is discarded; an empty list falls back on the default.                                    |
| `fillOpacity` | `number`   | `0.25`                                                                                     | Initial opacity of a zone's fill, from 0 to 1.                                                                                                         |

Every key falls back on its own: a value the plugin cannot use costs the profile that key, and no
other.

> ⚠️ **Read and validated, not all in use yet.** From `mode` down, the keys are read and
> validated by this version, while what they govern — the zones on the map — is not written.

> 🛑 **A profile is a served file.** No key of a routing engine is ever written in it, neither in
> `endpoint` nor anywhere else.

## Public API (`GeoLeaf.Isochrone`)

| Member                          | Description                                                                                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getConfig()`                   | The merged and validated `modules.isochrone` configuration.                                                                                                                                                                     |
| `configure(overrides)`          | Gives the engine's address and the query parameters every request must carry: `{ endpoint?, query? }`. Replaces the previous settings whole; `null` clears them. Returns `false`, and applies nothing, when a value is refused. |
| `registerProvider(id, factory)` | Registers a routing engine. The same id registered twice replaces the first.                                                                                                                                                    |
| `getProvider()`                 | The id of the engine the next computation would use and the credit its data owes, or `null` when none resolves.                                                                                                                 |
| `open()`                        | Opens the plugin. Returns `false` when `enabled` is `false`, `true` otherwise.                                                                                                                                                  |
| `close()`                       | Closes the plugin. Does nothing when it is not open.                                                                                                                                                                            |

## The engine: its address, and its key

Three addresses can apply, in this order: the one given at runtime through `configure()`, the
`endpoint` of the profile, the provider's own default. **An address that is refused is never
replaced by the next one** — a profile declaring `http://…` gets no engine at all, not the
default one.

An address is refused when it does not start with `https://`, cannot be read, or carries
credentials (`https://user:secret@host`).

**A profile is a served file: no key is ever written in it.** A key is given at runtime, by the
host that obtained it through its own means:

```js
GeoLeaf.Isochrone.configure({
    endpoint: "https://routing.example.org",
    query: { api_key: "the key your own session holds" },
});
```

`configure()` validates everything or applies nothing. It refuses a parameter that is not a
string and a parameter named `json`, which carries the question. A refusal is logged with the
name of the field, never with its value. The settings survive an unmount of the application;
they do not survive a reload.

> ⚠️ **A key given to a browser can be read by whoever holds the browser** — in its developer
> tools, and in the logs of the engine. The plugin keeps it out of its own traces, and can do no
> more. To hide a key, put a relay on your own origin and point `endpoint` at it.

### The built-in engine

`provider: "valhalla"` asks a [Valhalla](https://github.com/valhalla/valhalla) instance. Without
an `endpoint`, it calls a shared public server — a convenience for a demonstration, with no
guarantee. An application in service declares its own.

It credits « © OpenStreetMap contributors »: the credit is owed by the **data** the engine
routes on, not by the engine. An instance fed with other data needs its own provider, with its
own credit.

### Plugging another engine

```js
GeoLeaf.Isochrone.registerProvider("my-engine", (endpoint, options) => ({
    id: "my-engine",
    attribution: "© My data source",
    async isochrone(request) {
        /* … */
        return { ok: true, contours: [] };
    },
}));
```

A provider **must** declare the credit its data owes: one that declares none is refused, never
given a default credit. `options` carries the query parameters given at runtime and the timeout
of the profile.

## License

MIT © 2026 Mattieu Pottier
