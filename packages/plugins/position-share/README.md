# @geoleaf-plugins/position-share

Position sharing plugin for [GeoLeaf JS](https://github.com/geoleaf/geoleaf-js). It sends the
user's GPS position to a backend over an interchangeable transport, and optionally shows where
the other users are.

---

## Installation

```bash
npm install @geoleaf-plugins/position-share
```

> **Note** — Prerequisite: `@geoleaf/core` must be loaded before this plugin.

---

## Quick start

```js
import "@geoleaf-plugins/position-share";

// After GeoLeaf.boot() — GeoLeaf.PositionShare is available on globalThis.GeoLeaf
const cfg = GeoLeaf.PositionShare.getConfig();

// The identifier that labels every sample this browser emits.
console.log(GeoLeaf.PositionShare.getClientId()); // → "loc:3f2504e0-…"
```

Emission is **off by default, twice over**: `enabled` and `mode` must both be opened in the
profile. A position is personal data, so neither a half-filled profile nor a copied snippet can
start sending on its own.

```json
{
    "modules": {
        "position-share": {
            "enabled": true,
            "mode": "manual",
            "transport": "http",
            "endpoint": "https://api.example.com/positions",
            "intervalMs": 30000,
            "minDistanceM": 10
        }
    }
}
```

---

## Configuration — `modules.position-share`

| Key               | Type                          | Default  | Role                                             |
| ----------------- | ----------------------------- | -------- | ------------------------------------------------ |
| `enabled`         | `boolean`                     | `false`  | hard opt-in                                      |
| `mode`            | `"auto" \| "manual" \| "off"` | `"off"`  | emit at boot · on user action · never            |
| `transport`       | `string`                      | `"http"` | `"http"`, `"websocket"`, or a registered key     |
| `endpoint`        | `string`                      | —        | POST URL — required when `transport: "http"`     |
| `channel`         | `string`                      | —        | channel — required when `transport: "websocket"` |
| `intervalMs`      | `number`                      | `30000`  | emission period                                  |
| `minDistanceM`    | `number`                      | `10`     | below this movement, nothing is sent             |
| `showButton`      | `boolean`                     | `true`   | toolbar button (`manual` mode)                   |
| `receive.enabled` | `boolean`                     | `false`  | display the other users                          |
| `receive.layerId` | `string`                      | —        | target layer, delegated to `realtime-layer`      |

---

## Writing your own transport

Adding a transport modifies no existing code — register a factory under a key, then name that
key in the profile. It must be registered **before** the first send.

```js
import { registerTransport } from "@geoleaf-plugins/position-share";

registerTransport("my-backend", (cfg) => ({
    async send(payload) {
        await fetch(cfg.endpoint, { method: "POST", body: JSON.stringify(payload) });
    },
}));
```

A rejected `send()` means **this sample is lost**, not "retry later": the plugin keeps no
queue, because replaying a stale position publishes a false fact about where someone is.

---

## Authentication

Authentication is **asymmetric between the two built-in transports**, and the difference is
silent:

- **HTTP** — the `connector` plugin replaces `window.fetch` and injects the bearer token, but
  **only when the endpoint shares the origin of `connector.baseUrl`**. Anywhere else, the
  request goes out unauthenticated without a warning.
- **WebSocket** — there is **no** authentication. Wrap it in your own registered transport if
  you need one.

---

## License

MIT © Mattieu Pottier
