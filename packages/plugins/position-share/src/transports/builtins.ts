/*!
 * @geoleaf-plugins/position-share — Built-in transport registration
 *
 * Fills the `http` and `websocket` keys of the registry when emission starts, without ever
 * overwriting a key someone else already claimed. That guard is the whole point: this runs
 * after the integrator's own registration, so registering unconditionally would silently undo
 * every override — on the exact keys people are most likely to override.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { registerTransport, registeredTransports } from "./registry.js";
import { createHttpTransport } from "./http-transport.js";
import { createWsTransport } from "./ws-transport.js";

/**
 * Registers the two built-in transports, without ever overwriting a key someone else already
 * claimed.
 *
 * Two decisions meet here, and they pull in opposite directions. `registerTransport` lets the
 * LAST writer win — that is the documented override path, how an integrator wraps the WebSocket
 * transport to add the authentication it does not ship with. But this function runs when
 * emission STARTS, which is necessarily after the integrator's own registration at load time.
 * Registering unconditionally would therefore undo every override, on the exact keys people are
 * most likely to override. Hence the guard: built-ins fill the gaps, they never take a seat.
 *
 * Idempotent by construction — no `_registered` flag needed, since a second call finds both keys
 * taken.
 */
export function registerBuiltinTransports(): void {
    const taken = new Set(registeredTransports());
    if (!taken.has("http")) registerTransport("http", createHttpTransport);
    if (!taken.has("websocket")) registerTransport("websocket", createWsTransport);
}
