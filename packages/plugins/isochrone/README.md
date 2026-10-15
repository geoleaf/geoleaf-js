# `@geoleaf-plugins/isochrone`

MIT plugin for [GeoLeaf](https://geoleaf.dev). It shows the zones reachable from a point of the
map within a given time. The zones are computed by a **routing engine**, elsewhere: the plugin
asks the question, reads the answer and credits the data. It computes nothing itself.

It mounts `GeoLeaf.Isochrone` and registers itself with the core at load time.

## Installation

```sh
npm install @geoleaf-plugins/isochrone
```

Its peers are `@geoleaf/core` 3.15.0 or later and `maplibre-gl` 6. It has no runtime dependency.

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
| `maxLayers`   | `number`   | `8`                                                                                        | Cap on the number of zones displayed. A whole number from 1 to 99.                                                                                     |
| `zIndex`      | `number`   | `50`                                                                                       | Base rank of the zones among the profile's layers.                                                                                                     |
| `palette`     | `string[]` | `["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"]` | Colours given to the zones, written `#rrggbb`. Anything else is discarded; an empty list falls back on the default.                                    |
| `fillOpacity` | `number`   | `0.25`                                                                                     | Initial opacity of a zone's fill, from 0 to 1.                                                                                                         |

Every key falls back on its own: a value the plugin cannot use costs the profile that key, and no
other.

`mode`, `modes` and `durations` set what the window offers; the other keys govern the zones
`compute()` draws.

A profile declares the block in its own file, named under `Files.modules.isochrone` in
`profile.json` — here, walking zones placed above layers ranked up to 70:

```jsonc
// config/plugins/isochrone.json
{
    "enabled": true,
    "mode": "foot",
    "durations": [5, 10, 15],
    "zIndex": 70,
}
```

The zones live strictly between `zIndex` and `zIndex + 1`: they are drawn above every layer of
the profile ranked `zIndex` or lower, and below every layer ranked higher.

> 🛑 **A profile is a served file.** No key of a routing engine is ever written in it, neither in
> `endpoint` nor anywhere else.

## Public API (`GeoLeaf.Isochrone`)

| Member                                    | Description                                                                                                                                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getConfig()`                             | The merged and validated `modules.isochrone` configuration.                                                                                                                                                                     |
| `configure(overrides)`                    | Gives the engine's address and the query parameters every request must carry: `{ endpoint?, query? }`. Replaces the previous settings whole; `null` clears them. Returns `false`, and applies nothing, when a value is refused. |
| `registerProvider(id, factory)`           | Registers a routing engine. The same id registered twice replaces the first.                                                                                                                                                    |
| `getProvider()`                           | The id of the engine the next computation would use and the credit its data owes, or `null` when none resolves.                                                                                                                 |
| `open(anchor?)`                           | Opens the window, beside `anchor` when one is given, and closes the other floating tools'. Returns `false` when `enabled` is `false`, `true` otherwise.                                                                         |
| `close()`                                 | Closes the window and leaves the picking of a point. The zones stay on the map. Does nothing when it is not open.                                                                                                               |
| `compute({ origin, mode?, minutes? })`    | Computes the zones reachable from `origin` (`[lon, lat]`) and draws them on top of the stack; mode and durations default to the profile's. Resolves to `{ ok: true, ids }` — top first — or `{ ok: false, reason }`.            |
| `getLayers()`                             | A snapshot of the stack, top first: id, origin, mode, minutes, colour, opacity, visibility, credit.                                                                                                                             |
| `setLayerStyle(id, { color?, opacity? })` | Changes a zone's colour (`#rrggbb`) or the opacity of its fill (0 to 1). Returns `false` for an unknown id or a refused value.                                                                                                  |
| `setLayerVisible(id, visible)`            | Hides or shows a zone; a hidden zone keeps its place. Returns `false` for an unknown id.                                                                                                                                        |
| `moveLayer(id, toIndex)`                  | Moves a zone to a row of the stack, `0` being the top — on the map too, without asking the engine again. Returns `false` for an unknown id or a row outside the stack.                                                          |
| `removeLayer(id)`                         | Removes a zone. Returns `false` for an unknown id.                                                                                                                                                                              |
| `clear()`                                 | Removes every zone.                                                                                                                                                                                                             |

### The stack of zones

- **One zone per duration, the shortest on top.** The zones of one point are nested: a larger one
  drawn above would hide the others. A new batch goes on top of the stack, and moves no zone
  already there.
- **The zones live strictly between `zIndex` and `zIndex + 1`**, among the profile's own layers —
  which is why `maxLayers` stops at 99.
- **Each zone takes the first colour of the palette no zone wears**, and keeps it. Once all are
  worn, the one worn the fewest times.
- **A marker shows each point the zones start from**, and the credit of the engine's data shows on
  the map, for as long as a zone does.
- **Nothing is drawn unless every duration came back.** Refused before any request: `invalid`,
  `no-map`, `no-engine`, `busy`, `too-long` (a duration beyond what the engine accepts, carried as
  `limit`), `cap-reached` (beyond `maxLayers`, carried as `limit`). Then the engine's own reasons:
  `http` with its `status` and `code`, `timeout`, `network`, `malformed`.
- **Unmounting the application removes the zones**; the settings given to `configure()` stay.

### The window

`open()` — or the toolbar button — shows a floating window over the map, which stays usable:
the modes and durations of the profile, « Place the point » on the map, « My position »,
and one row per zone — colour, opacity, visibility, ▲ ▼, remove.

- **Every action has a named button.** ▲ ▼ are the way to reorder, disabled at the ends; the focus
  follows the moved row and its new place is announced. Dragging a row by its handle is a comfort
  for the mouse.
- **« My position »** reads the core's GPS — `modules.geolocation` —, switching it on when it is
  off, and computes from the first fix; it is hidden when the profile turns the GPS off. A refusal,
  a device without GPS and a fix slower than 20 s all read « position unavailable ». The plugin
  never calls `navigator.geolocation` itself.
- **Escape** leaves the picking of a point, else abandons the position being sought, else cancels
  the computation, else closes the window when the focus is in it.
- **One floating tool at a time**: the window closes when another tool opens, and the other way
  round. Closing it keeps the zones.
- **While a point is being placed**, a click on the map opens no feature's sheet, and the window
  folds to give the map back.

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

Two answers of the shared public server are worth knowing — measured on 10 and 11 October 2026,
and the server may change them:

- **It stops at 60 minutes.** The built-in provider declares 120, the limit of a self-hosted
  instance, so that an instance of your own is not capped by the demonstration server. On the
  default address, a duration from 61 to 120 minutes is therefore sent and comes back refused:
  `http`, status 400, code 151 — late, but named. A duration beyond 120 is refused before any
  request, as `too-long`. The default durations stay far below both.
- **A point far from any road is not refused.** The server answers it with a success: one zone
  per duration, a mesh less than 200 m wide around the point. The plugin draws it, without
  a message — it does not judge a geometry. Another instance that does refuse such a point is
  read as any refusal: `http`, with its status and its code.

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
