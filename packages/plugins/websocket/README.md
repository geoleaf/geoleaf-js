# @geoleaf-plugins/websocket

WebSocket transport plugin for [GeoLeaf JS](https://github.com/geoleaf/geoleaf-js). It provides a
real-time connection with automatic reconnection, offline buffering and built-in metrics.

---

## Installation

```bash
npm install @geoleaf-plugins/websocket
```

> **Note** — Prerequisite: `@geoleaf/core` must be loaded before this plugin.

---

## Quick start

```js
import "@geoleaf-plugins/websocket";

// After GeoLeaf.boot() — GeoLeaf.Ws is available on globalThis.GeoLeaf
await GeoLeaf.Ws.init({
    transport: "native-ws",
    url: "wss://api.example.com/ws",
    reconnect: { maxRetries: 10 },
    heartbeat: { enabled: true },
});

// Subscribe to a channel
const unsubscribe = GeoLeaf.Ws.subscribe("poi-updates", (payload) => {
    console.log("POI update received:", payload);
});

// Send a message
GeoLeaf.Ws.send("user-action", { type: "map-click", lngLat: [2.35, 48.85] });

// Clean shutdown
GeoLeaf.Ws.destroy();
```

---

## Configuration — `WsPluginConfig`

Passed to `GeoLeaf.Ws.init()`.

| Option                     | Type                         | Default     | Description                                                                                      |
| -------------------------- | ---------------------------- | ----------- | ------------------------------------------------------------------------------------------------ |
| `transport`                | `string`                     | —           | Transport key. Built in: `"native-ws"`. See [Custom transport](#custom-transport).               |
| `url`                      | `string`                     | —           | WebSocket endpoint URL. Required. `wss://` is required in production.                            |
| `auth`                     | `JwtAuth \| CredentialsAuth` | `undefined` | Authentication configuration (reserved — not active in v1.0).                                    |
| `reconnect.initialDelayMs` | `number`                     | `1000`      | Delay before the first retry (ms).                                                               |
| `reconnect.maxDelayMs`     | `number`                     | `30000`     | Ceiling of the exponential backoff (ms).                                                         |
| `reconnect.maxRetries`     | `number`                     | `10`        | Maximum number of retries. `0` means unlimited (recommended for offline-first PWAs).             |
| `heartbeat.enabled`        | `boolean`                    | `false`     | Enables ping/pong keep-alive.                                                                    |
| `heartbeat.intervalMs`     | `number`                     | `25000`     | Interval between pings (ms).                                                                     |
| `heartbeat.timeoutMs`      | `number`                     | `5000`      | How long to wait for the pong before declaring the connection lost (ms). Must be `< intervalMs`. |
| `queueOnDisconnect`        | `boolean`                    | `true`      | Buffers outgoing messages while disconnected.                                                    |
| `maxQueueSize`             | `number`                     | `100`       | Maximum buffer size. On overflow, the oldest message is evicted.                                 |

### Full example

```js
await GeoLeaf.Ws.init({
    transport: "native-ws",
    url: "wss://api.example.com/ws",
    reconnect: {
        initialDelayMs: 500,
        maxDelayMs: 60000,
        maxRetries: 0, // unlimited — offline-first PWA
    },
    heartbeat: {
        enabled: true,
        intervalMs: 30000,
        timeoutMs: 8000,
    },
    queueOnDisconnect: true,
    maxQueueSize: 50,
});
```

### JWT auth (v1.0 — types defined, logic to implement in a custom transport)

```ts
import type { JwtAuth } from "@geoleaf-plugins/websocket";

const auth: JwtAuth = {
    type: "jwt",
    token: "eyJ...",
    headerName: "Authorization",
    refreshCallback: async () => fetchFreshToken(),
};
```

---

## API — `GeoLeaf.Ws`

| Method / property  | Signature                                                  | Description                                                                     |
| ------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `init`             | `(config: WsPluginConfig) => Promise<void>`                | Initialises and connects. Resolves once the connection is ready.                |
| `destroy`          | `() => void`                                               | Disconnects, drops subscriptions and resets metrics. Idempotent.                |
| `reconnect`        | `() => void`                                               | Forces a reconnection and resets the retry counter. No-op if already connected. |
| `state`            | `readonly TransportState`                                  | Current connection state. See [Connection states](#connection-states).          |
| `subscribe`        | `(channel: string, handler: MessageHandler) => () => void` | Subscribes to a channel. Returns an idempotent unsubscribe function.            |
| `unsubscribe`      | `(channel: string) => void`                                | Unsubscribes from a channel by name. No-op if not subscribed.                   |
| `send`             | `(channel: string, payload: unknown) => void`              | Sends a message. Buffered when disconnected and `queueOnDisconnect: true`.      |
| `getSubscriptions` | `() => string[]`                                           | Names of the active channels.                                                   |
| `getMetrics`       | `() => WsMetrics`                                          | Metrics snapshot. Usable before `init()`.                                       |

### Connection states

```
disconnected → connecting → connected
connected    → disconnected → reconnecting → connected
reconnecting → failed  (when maxRetries > 0 and exhausted)
```

| State          | Description                                       |
| -------------- | ------------------------------------------------- |
| `disconnected` | No active connection.                             |
| `connecting`   | Initial connection attempt in progress.           |
| `connected`    | Connection established and ready.                 |
| `reconnecting` | Connection lost, recovery attempt in progress.    |
| `failed`       | All retries exhausted, or an unrecoverable error. |

---

## The `queueOnDisconnect` pattern

With `queueOnDisconnect: true` (the default), messages sent through `GeoLeaf.Ws.send()` while
disconnected are buffered FIFO and replayed automatically on reconnection.

### Offline / online lifecycle

```
Connection lost
  → state: reconnecting
  → send() → message placed in the buffer (geoleaf:ws:send-queued)

Reconnection succeeds
  → resubscribeAll() — every channel is reactivated
  → SendQueue.flush() — buffered messages are replayed in FIFO order
  → state: connected
```

### Buffer overflow

When the buffer reaches `maxQueueSize`, **the oldest message is evicted** to make room for the new
one:

```js
// Listen for overflows
document.addEventListener("geoleaf:ws:send-queued-overflow", (e) => {
    console.warn("Message evicted from the buffer:", e.detail.channel, e.detail.droppedPayload);
});
```

### Disabling buffering

```js
await GeoLeaf.Ws.init({
    transport: "native-ws",
    url: "wss://api.example.com/ws",
    queueOnDisconnect: false, // messages are lost while disconnected
});

// Detect dropped messages
document.addEventListener("geoleaf:ws:send-dropped", (e) => {
    console.warn("Message dropped on channel:", e.detail.channel);
});
```

---

## Metrics and monitoring

`GeoLeaf.Ws.getMetrics()` returns an immutable `WsMetrics` snapshot at any time, including before
`init()`.

### The `WsMetrics` interface

| Field              | Type             | Description                                                                      |
| ------------------ | ---------------- | -------------------------------------------------------------------------------- |
| `connectedAt`      | `string \| null` | ISO 8601 timestamp of the last successful connection. `null` if never connected. |
| `reconnectCount`   | `number`         | Total successful reconnections since `init()`.                                   |
| `messagesSent`     | `number`         | Messages sent, including those replayed from the buffer.                         |
| `messagesReceived` | `number`         | Messages received on subscribed channels.                                        |
| `lastPingMs`       | `number \| null` | Last round-trip ping latency in ms. `null` when the heartbeat is disabled.       |
| `activeChannels`   | `string[]`       | Names of the currently subscribed channels.                                      |
| `queueLength`      | `number`         | Number of messages waiting in the buffer.                                        |

### Monitoring examples

```js
// Metrics dashboard
function logMetrics() {
    const m = GeoLeaf.Ws.getMetrics();
    console.table({
        "Connected since": m.connectedAt ?? "—",
        Reconnections: m.reconnectCount,
        "Msgs sent": m.messagesSent,
        "Msgs received": m.messagesReceived,
        "Ping latency": m.lastPingMs != null ? `${m.lastPingMs} ms` : "—",
        "Active channels": m.activeChannels.join(", ") || "—",
        Buffer: m.queueLength,
    });
}

// Periodic snapshot
setInterval(logMetrics, 10_000);

// React to metrics updates
document.addEventListener("geoleaf:ws:metrics-updated", (e) => {
    const metrics = e.detail; // WsMetrics
    if (metrics.lastPingMs > 500) {
        console.warn("High latency:", metrics.lastPingMs, "ms");
    }
});
```

### Alerting on connection events

```js
document.addEventListener("geoleaf:ws:reconnecting", (e) => {
    const { attempt, nextDelayMs } = e.detail;
    console.warn(`Reconnection #${attempt}, next attempt in ${nextDelayMs} ms`);
});

document.addEventListener("geoleaf:ws:failed", (e) => {
    const { error } = e.detail;
    console.error(`Connection permanently lost [${error.code}]:`, error.message);
});
```

---

## Events

All events are dispatched through `document.dispatchEvent()` and consumed with
`document.addEventListener()`.

> **Note** — These events are separate from the `GeoLeaf.Events` system — they do not travel
> through it.

| Event                             | Payload                       | Fired when                                                 |
| --------------------------------- | ----------------------------- | ---------------------------------------------------------- |
| `geoleaf:ws:connected`            | `{ transport, channels }`     | The connection is established and ready.                   |
| `geoleaf:ws:disconnected`         | `{ transport, reason }`       | The connection is lost.                                    |
| `geoleaf:ws:reconnecting`         | `{ attempt, nextDelayMs }`    | A reconnection attempt is in progress.                     |
| `geoleaf:ws:failed`               | `{ transport, error }`        | Unrecoverable failure (maxRetries reached, or auth error). |
| `geoleaf:ws:auth-required`        | `{ transport }`               | The session expired and user action is required.           |
| `geoleaf:ws:channel-subscribed`   | `{ channel }`                 | A subscription was added or replaced.                      |
| `geoleaf:ws:channel-unsubscribed` | `{ channel }`                 | A subscription was removed.                                |
| `geoleaf:ws:send-queued`          | `{ channel, queueLength }`    | A message was placed in the offline buffer.                |
| `geoleaf:ws:send-dropped`         | `{ channel }`                 | A message was dropped (`queueOnDisconnect: false`).        |
| `geoleaf:ws:send-queued-overflow` | `{ channel, droppedPayload }` | A message was evicted from the buffer (maxQueueSize hit).  |
| `geoleaf:ws:heartbeat-timeout`    | `{ transport }`               | The pong timed out — a reconnection was triggered.         |
| `geoleaf:ws:metrics-updated`      | `WsMetrics`                   | The metrics snapshot was updated.                          |

### Example: listening for incoming messages

Channel messages are delivered through the **callback** passed to `subscribe()`; there is no
dedicated `document` event for messages (see the event table above):

```js
GeoLeaf.Ws.subscribe("layer-updates", (payload) => {
    GeoLeaf.Layers.setData("my-layer", payload.geojson.features);
});
```

---

## Custom transport

To replace or complement `native-ws`, register your own `IWsTransport` implementation:

```js
import { registerTransport } from "@geoleaf-plugins/websocket";

registerTransport("my-transport", () => ({
    async connect(config) {
        /* ... */
    },
    disconnect(reason) {
        /* ... */
    },
    subscribe(channel, handler) {
        return () => {};
    },
    send(channel, payload) {
        /* ... */
    },
    async ping() {
        /* ... */
    },
    get state() {
        return "connected";
    },
    onConnected: null,
    onDisconnected: null,
    onError: null,
}));

await GeoLeaf.Ws.init({
    transport: "my-transport",
    url: "wss://api.example.com/ws",
});
```

> **Important** — `registerTransport()` must be called **before** `GeoLeaf.Ws.init()`. An unknown
> key at `init()` time raises an `INVALID_TRANSPORT` error.

---

## Consumer tests

The package exposes `registerTransport()` so an integrator can plug in a fake transport of their
own for unit tests.

> **Note — `MockTransport` is NOT published, and that is deliberate (decided 17/08/2026).**
> It lives in the repository at `test-utils/mock-transport.ts` and drives this plugin's own test
> suites, but it no longer travels in the tarball: `files[]` stopped carrying `test-utils/`.
>
> Until then it _was_ shipped while the `exports` map declared no `./test-utils` — so the import
> below cost download weight and raised `ERR_PACKAGE_PATH_NOT_EXPORTED` for anyone who tried it.
> The alternative — declaring the subpath — would have pointed at **uncompiled TypeScript**,
> where every other subpath in this package targets `dist/`; supporting a test helper publicly was
> judged not worth a second build entry and its type emission.
>
> **What to do instead:** implement `IWsTransport` yourself (it is five methods) and register it
> with `registerTransport()`, exactly as the snippet below does. The interface is exported from
> the package root and _is_ a supported surface. `test-utils/mock-transport.ts` in the repository
> is a working reference you may copy from.

```js
import { registerTransport } from "@geoleaf-plugins/websocket";

// `MockTransport` here is YOUR implementation of `IWsTransport` — see the note above.

// Register the mock before init()
registerTransport("mock", () => new MockTransport());

await GeoLeaf.Ws.init({ transport: "mock", url: "wss://test" });

// Simulate an incoming message
const mock = MockTransport.lastInstance;
mock.simulateMessage("poi-updates", { id: 42, name: "Test" });

// Assert on the sent messages
expect(mock.sentMessages).toContainEqual({
    channel: "user-action",
    payload: { type: "map-click" },
});
```

---

## Error handling

Unrecoverable errors emit `geoleaf:ws:failed` with a `WsError` object:

| Code                   | Description                                                                  |
| ---------------------- | ---------------------------------------------------------------------------- |
| `CONNECTION_REFUSED`   | Backend unreachable, invalid URL, or `ws://` used in production.             |
| `AUTH_FAILED`          | Handshake refused (for example close code 1008).                             |
| `AUTH_EXPIRED`         | The session or token expired while connected.                                |
| `MAX_RETRIES_EXCEEDED` | All reconnection attempts were exhausted.                                    |
| `INVALID_TRANSPORT`    | Unknown transport key in `WsPluginConfig.transport`.                         |
| `SEND_QUEUE_OVERFLOW`  | `maxQueueSize` exceeded (informational — emitted as `send-queued-overflow`). |

```js
document.addEventListener("geoleaf:ws:failed", (e) => {
    const { code, message, transport, attempt } = e.detail.error;

    switch (code) {
        case "AUTH_FAILED":
        case "AUTH_EXPIRED":
            // Fetch a fresh token, then reconnect
            refreshToken().then(() => GeoLeaf.Ws.reconnect());
            break;
        case "MAX_RETRIES_EXCEEDED":
            // Notify the user
            GeoLeaf.Notifications?.show("Real-time connection lost.", "error");
            break;
        default:
            console.error(
                `[ws:${transport}] ${code}: ${message}`,
                attempt != null ? `(attempt ${attempt})` : ""
            );
    }
});
```
