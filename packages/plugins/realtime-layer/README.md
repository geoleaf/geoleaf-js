# @geoleaf-plugins/realtime-layer

**Real-time** updates for a GeoJSON layer of [GeoLeaf JS](https://github.com/geoleaf/geoleaf-js) —
over HTTP polling, WebSocket or SSE, with pluggable decoding and eviction of stale features.

**MIT** licensed ([`LICENSE`](LICENSE)).

---

> [!IMPORTANT]
> **Not on the registry at this version.** The GeoLeaf 3.x line is not published yet, so the
> install command below either fails with `E404` or resolves to an older release than the one
> this page describes. Measure rather than assume — no version number is copied into this page:
>
> ```bash
> npm view @geoleaf-plugins/realtime-layer version  # what the registry serves
> npm run versions:check                            # what this repository declares
> ```
>
> Until those agree, build from source.

## Installation

```bash
npm install @geoleaf-plugins/realtime-layer
```

> [!NOTE]
> **Prerequisite:** `@geoleaf/core` must be loaded before this plugin.
>
> **For `websocket` sources only:** [`@geoleaf-plugins/websocket`](../websocket/README.md) must be
> loaded **before** this one. It is an _optional_ dependency, declared as such in the plugin
> registry — `polling` and `sse` sources do not need it.

---

## What the plugin does on its own

The plugin **bootstraps from the profile**. On `geoleaf:app:ready` it scans the layers and starts a
stream for each one whose configuration carries `data.realtime.enabled: true`. In the common case
there is nothing to call.

The public API exists for the two other cases: starting a layer declared `enabled: false` (opt-in),
and stopping a stream.

```json
{
    "id": "bus-positions",
    "data": {
        "realtime": {
            "enabled": true,
            "source": "polling",
            "url": "https://example.test/gtfs-rt/vehicles",
            "decoder": "gtfs-rt",
            "intervalMs": 15000,
            "idField": "vehicle_id",
            "updateMode": "upsert",
            "staleTimeoutMs": 90000,
            "staleAction": "remove"
        }
    }
}
```

---

## API — `GeoLeaf.RealtimeLayer`

```js
import "@geoleaf-plugins/realtime-layer";

// Opt-in: a layer declared `enabled: false` does not start at boot
GeoLeaf.RealtimeLayer.start("bus-positions");

// Current state of a layer
const status = GeoLeaf.RealtimeLayer.getStatus("bus-positions");

// Stop one stream, or all of them
GeoLeaf.RealtimeLayer.stop("bus-positions");
GeoLeaf.RealtimeLayer.stopAll();
```

| Member                               | Role                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `start(layerId)`                     | Starts a layer's stream. Called automatically at boot when `enabled: true` |
| `stop(layerId)`                      | Stops a layer's stream                                                     |
| `stopAll()`                          | Stops every active stream                                                  |
| `getStatus(layerId)`                 | Returns `{ active, source, lastUpdateAt, staleCount }`                     |
| `registerDecoder(name, decoder)`     | Registers a decoder — **before `GeoLeaf.boot()`**                          |
| `registerStaleAction(name, handler)` | Registers a stale-feature action — **before `GeoLeaf.boot()`**             |
| `version`                            | Plugin version                                                             |

> [!WARNING]
> **`active: true` does not mean data is arriving.** A polling source whose endpoint is unreachable
> stays active with a frozen `lastUpdateAt`. Read the two fields together.
>
> **`registerDecoder` and `registerStaleAction` must be called before `GeoLeaf.boot()`**: the
> profile scan resolves decoder names at startup, and a name registered afterwards is never seen.

---

## Configuration — a layer's `data.realtime` block

Validated at boot. A layer whose block is invalid is **skipped with a message naming the layer**; it
does not bring down the rest of the profile.

| Key              | Type                                        | Default    | Role                                                                 |
| ---------------- | ------------------------------------------- | ---------- | -------------------------------------------------------------------- |
| `enabled`        | `boolean`                                   | —          | **Required.** Automatic start at boot                                |
| `source`         | `"polling" \| "websocket" \| "sse"`         | —          | **Required.** Transport                                              |
| `decoder`        | `string`                                    | —          | **Required.** Built in: `"json"`, `"gtfs-rt"`, plus registered ones  |
| `updateMode`     | `"upsert" \| "replace" \| "merge"`          | `"upsert"` | How decoded features are applied to the layer                        |
| `idField`        | `string`                                    | —          | GeoJSON property used as the key — required for `upsert` and `merge` |
| `staleTimeoutMs` | `number`                                    | —          | Delay after which a feature that was not refreshed becomes stale     |
| `staleAction`    | `string`                                    | `"remove"` | Built in: `"remove"`, `"dim"`, plus registered ones                  |
| `url`            | `string`                                    | —          | **Required** for `polling` and `sse`                                 |
| `intervalMs`     | `number`                                    | `30000`    | Polling period — `polling` only                                      |
| `fallbackUrl`    | `string`                                    | —          | Snapshot served while `url` is failing — `polling` only              |
| `channel`        | `string`                                    | —          | **Required** for `websocket` — passed to `GeoLeaf.Ws.subscribe()`    |
| `mapping`        | `{ idField?, delayField?, targetLayerId? }` | —          | Hints for the GTFS-RT decoder                                        |

### `fallbackUrl` — what it does exactly

When `url` returns a non-2xx response or raises a network error, the plugin serves the `fallbackUrl`
snapshot **once** for the duration of the outage, **keeps polling** `url` every `intervalMs`, and
switches back on the first success. The snapshot is typically a static file served from the same
origin as the profile.

### `mapping.targetLayerId` — the layer that actually receives

A `realtime` block attached to one layer can feed **another** layer. Everything after decoding —
writing the features **and** the whole staleness cycle — applies to that target, never to the layer
carrying the configuration. Without `targetLayerId`, the two are the same.

---

## Extending the plugin

**Two registrable extension points** — a decoder and a stale-feature action. The entry point
re-exports the types that describe them: `IDecoder` and `DecodedUpdate`, `StaleActionHandler`, plus
`IRealtimeSource`.

> [!NOTE]
> **`IRealtimeSource` is exported without a registration point.** The three transports (`polling`,
> `websocket`, `sse`) are wired into the plugin factory; the type is there to implement one in a
> fork or a derived plugin, not to plug one in from a profile.

```js
import "@geoleaf-plugins/realtime-layer";

// Before GeoLeaf.boot()
// decode() returns an ARRAY of updates, one per feature.
GeoLeaf.RealtimeLayer.registerDecoder("my-format", {
    decode(raw) {
        return [
            { id: "v-42", properties: { delay: 120 } },
            { id: "v-43", geometry: { type: "Point", coordinates: [2.35, 48.85] } },
            { id: "v-44", action: "delete" },
        ];
    },
});

// (layerId, featureId, feature) => void — called ONCE per feature per staleness event,
// not repeatedly while it stays stale.
GeoLeaf.RealtimeLayer.registerStaleAction("report", (layerId, featureId, feature) => {
    console.warn(`[realtime] ${layerId}: ${featureId} is stale`, feature);
});
```

---

## Load order

1. `@geoleaf/core`
2. `@geoleaf-plugins/websocket` — **only** if a profile declares `source: "websocket"`
3. `@geoleaf-plugins/realtime-layer`
4. `GeoLeaf.boot()` — after every `registerDecoder` / `registerStaleAction`

---

© 2026 Mattieu Pottier — MIT
