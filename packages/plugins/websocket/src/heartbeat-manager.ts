/*!
 * @geoleaf-plugins/websocket
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * heartbeat-manager.ts — Ping/pong keep-alive for long-lived WebSocket connections.
 *
 * Starts a timer after the transport connects.
 * On each tick, calls transport.ping().
 * If the ping does not resolve within timeoutMs, the connection is considered
 * lost: transport.disconnect("heartbeat-timeout") is called and the
 * heartbeat-timeout event is emitted. The ConnectionManager then handles reconnection.
 * The timer restarts automatically after reconnection.
 */

import type { IWsTransport } from "./transports/i-ws-transport.js";
import { emitHeartbeatTimeout } from "./event-bus-bridge.js";

/**
 * The heartbeat's shape **AFTER normalisation** — derived, never redeclared.
 *
 * 🛑 This manager declared its own `interface HeartbeatConfig` with the three
 * fields REQUIRED, homonymous with `config.ts`'s PUBLIC type where
 * `intervalMs` and `timeoutMs` are OPTIONAL. Two shapes, one name — and the
 * divergence was about optionality, not the types.
 *
 * ⚠️ Neither was wrong. `attach()` normalises nothing (it stores), and the
 * normalisation lives in `applyDefaults()` — `?? false`, `?? 25000`,
 * `?? 5000`. The manager thus does receive a complete shape: it described the
 * AFTER state, the public type the BEFORE. **What was missing was not a
 * correct type, it was a name for the resolved state.**
 *
 * 🛑 **A NAMED INTERFACE — and BOTH shorter shapes were ruled out BY MEASUREMENT.**
 *
 * - An **alias** `type X = ResolvedWsConfig["heartbeat"]` resolves to a type
 *   literal, which TypeDoc **inlines into `attach()`'s signature**. Measured
 *   on 17/08/2026: it added **4 entries** to `API_SURFACE.txt` — a
 *   `TypeLiteral` and its three `Property` — for a strictly identical
 *   accepted shape. Growing an npm package's published surface for a
 *   readability gain is not an acceptable trade.
 * - An **`interface … extends ResolvedWsConfig["heartbeat"]`** does not
 *   compile: TS2499, "an interface can only extend an identifier/qualified-name".
 *
 * A named, unexported interface is **referenced** instead of inlined: the
 * manifest does not move. The price is a second writing of the shape — and
 * the guard below is what pays it, not goodwill.
 */
interface ResolvedHeartbeatConfig {
    enabled: boolean;
    intervalMs: number;
    timeoutMs: number;
}

/*
 * 🛑 WHAT GUARDS THIS SHAPE IS THE CALL SITE, AND IT EXISTED BEFORE THE FIX.
 *
 * `ws-lifecycle.ts` passes `resolved.heartbeat` to `attach()`. If
 * `applyDefaults()` stops providing a field this interface requires, **tsc
 * refuses to compile**.
 *
 * ✅ **Seen turning red, by mutation, on 17/08/2026** — a stray field added
 * here yields `ws-lifecycle.ts(66,41): error TS2345: Argument of type
 * '{ enabled: boolean; intervalMs: number; timeoutMs: number; }' is not
 * assignable to parameter of type 'ResolvedHeartbeatConfig'`. The guard is
 * not assumed: it is exercised.
 *
 * ⚠️ **Three heavier devices were tried and ruled out BY MEASUREMENT**, in this order:
 *   1. `type X = ResolvedWsConfig["heartbeat"]` — TypeDoc **inlines** the
 *      literal into `attach()`'s signature: **+4 entries** in
 *      `API_SURFACE.txt`, for an identical shape.
 *   2. `interface X extends ResolvedWsConfig["heartbeat"]` — does not compile (TS2499).
 *   3. An explicit type guard `[A extends B ? true : never, B extends A ? true : never]` —
 *      **TS6196, "declared but never used"** if it stays local; and **flagged
 *      a dead export by knip** if exported. It has no viable shape, and it
 *      was **redundant** anyway: the mutation above proves the call site
 *      already does the job.
 *
 * 📌 What stays unguarded, and is **benign**: if
 * `ResolvedWsConfig["heartbeat"]` GAINS a field, structural typing accepts it
 * and the manager ignores it. No dangerous silence — the fixed defect was the
 * opposite, a shape demanding what it does not receive.
 */

/**
 * Ping/pong keep-alive for long-lived connections.
 *
 * Starts once the transport connects and pings on each tick. Its purpose is detection, not
 * politeness: a socket severed by an intermediary stays `OPEN` on the client until something
 * writes to it, so without this a dead connection looks healthy indefinitely.
 */
export class HeartbeatManager {
    private _transport: IWsTransport | null = null;
    private _config: ResolvedHeartbeatConfig | null = null;
    private _transportKey = "unknown";
    private _timerId: ReturnType<typeof setTimeout> | null = null;
    private _running = false;

    /**
     * Attach a config and transport. Does not start the timer — call start() after connecting.
     *
     * @param transport    - The live transport to ping.
     * @param config       - Heartbeat timing config.
     * @param transportKey - The configured transport key (e.g. the value of
     *   `WsPluginConfig.transport`), reported on the `heartbeat-timeout` event so a
     *   custom transport is not mislabelled as the built-in `"native-ws"`.
     */
    attach(transport: IWsTransport, config: ResolvedHeartbeatConfig, transportKey: string): void {
        this._transport = transport;
        this._config = config;
        this._transportKey = transportKey;
    }

    /** Start the heartbeat timer. No-op if disabled or already running. */
    start(): void {
        if (!this._config?.enabled) return;
        if (this._running) return;
        this._running = true;
        this._scheduleNext();
    }

    /** Stop the heartbeat timer. Safe to call multiple times. */
    stop(): void {
        this._running = false;
        if (this._timerId !== null) {
            clearTimeout(this._timerId);
            this._timerId = null;
        }
    }

    /** Detach transport and config. Stops the timer. */
    detach(): void {
        this.stop();
        this._transport = null;
        this._config = null;
    }

    private _scheduleNext(): void {
        if (!this._running || !this._config) return;
        this._timerId = setTimeout(() => {
            void this._tick();
        }, this._config.intervalMs);
    }

    private async _tick(): Promise<void> {
        if (!this._running || !this._config || !this._transport) return;

        const transport = this._transport;
        const config = this._config;

        const pingRace = Promise.race([
            transport.ping().then(() => "ok" as const),
            new Promise<"timeout">((resolve) =>
                setTimeout(() => resolve("timeout"), config.timeoutMs)
            ),
        ]);

        const result = await pingRace;

        if (!this._running) return; // stopped while waiting

        if (result === "timeout") {
            emitHeartbeatTimeout({ transport: this._transportKey });
            transport.disconnect("heartbeat-timeout");
            // ConnectionManager will trigger reconnection via onDisconnected callback
            this.stop();
            return;
        }

        // Ping succeeded — schedule next tick
        this._scheduleNext();
    }
}
