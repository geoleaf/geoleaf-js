/**
 * mock-transport.ts — MockTransport for unit testing @geoleaf-plugins/websocket.
 *
 * Implements IWsTransport with fully controllable behavior.
 *
 * 🛑 THIS FILE IS NOT PUBLISHED, AND THAT IS A DECISION — not an oversight.
 *
 * It was until 17/08/2026: `files[]` carried `test-utils/`, so the tarball
 * took it along (measured by `npm pack`: 4.8 kB over 41 files), while the
 * `exports` map declared no `./test-utils`. A consumer paid the weight and
 * received `ERR_PACKAGE_PATH_NOT_EXPORTED` on trying the import — measured on
 * 31/07/2026, not deduced. ⚠️ The header moreover announced "exported
 * publicly" for four versions, with three other places saying the same: only
 * the manifest told the truth.
 *
 * **The arbitration, settled on 17/08/2026, is REMOVAL, not declaration.**
 * The two branches did not cost the same: declaring `./test-utils` would
 * target **uncompiled TypeScript**, where every other subpath in the repo
 * targets `dist/` — it would have taken a second build entry and its type
 * emission, to publicly support a test utility. Removing is one line, and
 * makes the tarball consistent with what its `exports` map announces.
 *
 * ⚠️ **The file stays in the repo and stays used**: the four suites of
 * `src/__tests__/` import it by **relative** path
 * (`../../test-utils/mock-transport.js`), which the `files[]` removal does
 * not touch. What changes is what **ships to the consumer**, and nothing else.
 *
 * 🛑 Do not put back an `@example` showing an import from
 * `@geoleaf-plugins/websocket/test-utils`: it would describe an import that
 * **fails**, and that is exactly what this header did for four versions.
 */

import type {
    IWsTransport,
    MessageHandler,
    TransportConfig,
    TransportState,
    WsError,
} from "../src/transports/i-ws-transport.js";

export class MockTransport implements IWsTransport {
    state: TransportState = "disconnected";

    onConnected: (() => void) | null = null;
    onDisconnected: ((reason: string) => void) | null = null;
    onError: ((error: WsError) => void) | null = null;

    /** Controls the behavior of connect(). Default: "success". */
    connectBehavior: "success" | "fail" | "timeout" = "success";

    /** Simulated ping round-trip latency in ms. Default: 5. */
    pingLatencyMs = 5;

    /** All messages sent via send() — use for assertions. */
    sentMessages: Array<{ channel: string; payload: unknown }> = [];

    /** All active channel subscriptions. */
    subscriptions: Map<string, MessageHandler> = new Map();

    async connect(_config: TransportConfig): Promise<void> {
        if (this.connectBehavior === "fail") {
            this.state = "disconnected";
            const err: WsError = {
                code: "CONNECTION_REFUSED",
                message: "MockTransport: connect() configured to fail.",
                transport: "mock",
            };
            this.onError?.(err);
            throw err;
        }

        if (this.connectBehavior === "timeout") {
            // Never resolves — caller must handle timeout externally
            return new Promise(() => {});
        }

        this.state = "connected";
        this.onConnected?.();
    }

    disconnect(reason = "manual"): void {
        if (this.state === "disconnected") return;
        this.state = "disconnected";
        this.onDisconnected?.(reason);
    }

    subscribe(channel: string, handler: MessageHandler): () => void {
        this.subscriptions.set(channel, handler);
        return () => {
            if (this.subscriptions.get(channel) === handler) {
                this.subscriptions.delete(channel);
            }
        };
    }

    send(channel: string, payload: unknown): void {
        if (this.state !== "connected") {
            throw new Error(`MockTransport: send() called while state=${this.state}`);
        }
        this.sentMessages.push({ channel, payload });
    }

    async ping(): Promise<void> {
        if (this.pingLatencyMs <= 0) return;
        return new Promise<void>((resolve) => setTimeout(resolve, this.pingLatencyMs));
    }

    // ─── Simulation helpers ────────────────────────────────────────────────────

    /**
     * Simulate an incoming message on a subscribed channel.
     * No-op if no handler is registered for the channel.
     */
    simulateMessage(channel: string, payload: unknown): void {
        this.subscriptions.get(channel)?.(payload);
    }

    /**
     * Simulate an unexpected disconnection (network loss, server close, etc.).
     */
    simulateDisconnect(reason: string): void {
        this.state = "disconnected";
        this.onDisconnected?.(reason);
    }

    /**
     * Simulate an auth expiry mid-connection.
     * Sets state to "disconnected" and fires onError with AUTH_EXPIRED.
     */
    simulateAuthExpired(): void {
        this.state = "disconnected";
        this.onError?.({
            code: "AUTH_EXPIRED",
            message: "MockTransport: session expired.",
            transport: "mock",
        });
    }

    /** Reset all recorded messages and subscriptions. */
    reset(): void {
        this.sentMessages = [];
        this.subscriptions.clear();
        this.state = "disconnected";
        this.connectBehavior = "success";
        this.pingLatencyMs = 5;
        this.onConnected = null;
        this.onDisconnected = null;
        this.onError = null;
    }
}
