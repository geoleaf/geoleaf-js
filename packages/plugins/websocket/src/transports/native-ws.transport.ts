/*!
 * @geoleaf-plugins/websocket
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * native-ws.transport.ts — NativeWsTransport implementation.
 *
 * Uses the browser's native WebSocket API. Backend-neutral — no knowledge of
 * application protocol beyond the minimal channel routing convention:
 *
 * Outgoing: JSON.stringify({ channel, payload })
 * Incoming: JSON.parse → dispatch to ChannelManager via the "channel" key.
 *           Messages without a "channel" key are silently ignored.
 *
 * Ping/pong protocol (application-level):
 *   → send JSON { type: "ping" }
 *   ← expect JSON { type: "pong" } within timeoutMs
 *
 * Auth: Close code 1008 → onError({ code: "AUTH_FAILED" })
 */

import type {
    IWsTransport,
    MessageHandler,
    TransportConfig,
    TransportState,
    WsError,
} from "./i-ws-transport.js";

type RawMessage = { channel?: string; type?: string; payload?: unknown };

/**
 * Transport backed by the browser's native `WebSocket`.
 *
 * Backend-neutral: it knows nothing of the application protocol beyond the minimal channel
 * routing convention, which is what lets the same plugin sit in front of different servers.
 */
export class NativeWsTransport implements IWsTransport {
    private _ws: WebSocket | null = null;
    private _state: TransportState = "disconnected";
    private _handlers: Map<string, MessageHandler> = new Map();
    private _pingResolve: (() => void) | null = null;

    onConnected: (() => void) | null = null;
    onDisconnected: ((reason: string) => void) | null = null;
    onError: ((error: WsError) => void) | null = null;

    get state(): TransportState {
        return this._state;
    }

    connect(config: TransportConfig): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this._state === "connected" || this._state === "connecting") {
                resolve();
                return;
            }

            this._state = "connecting";

            let ws: WebSocket;
            try {
                ws = new WebSocket(config.url);
                this._ws = ws;
            } catch (err) {
                this._state = "disconnected";
                const wsErr = this._makeError(
                    "CONNECTION_REFUSED",
                    err instanceof Error ? err.message : "WebSocket construction failed"
                );
                this.onError?.(wsErr);
                reject(wsErr);
                return;
            }

            this._setupWsHandlers(ws, resolve, reject);
        });
    }

    disconnect(reason = "manual"): void {
        if (this._ws && this._ws.readyState < WebSocket.CLOSING) {
            this._ws.close(1000, reason);
        }
        this._state = "disconnected";
        this._ws = null;
        // Discard any in-flight ping
        this._pingResolve = null;
    }

    subscribe(channel: string, handler: MessageHandler): () => void {
        this._handlers.set(channel, handler);
        return () => {
            const current = this._handlers.get(channel);
            if (current === handler) {
                this._handlers.delete(channel);
            }
        };
    }

    send(channel: string, payload: unknown): void {
        if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
            throw new Error(
                `[NativeWsTransport] Cannot send: transport not connected (state=${this._state})`
            );
        }
        this._ws.send(JSON.stringify({ channel, payload }));
    }

    ping(): Promise<void> {
        return new Promise<void>((resolve) => {
            if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
                // Resolve immediately — HeartbeatManager will handle the disconnect path
                resolve();
                return;
            }
            // Store resolve — called when pong arrives in _handleMessage
            this._pingResolve = resolve;
            try {
                this._ws.send(JSON.stringify({ type: "ping" }));
            } catch {
                this._pingResolve = null;
                resolve();
            }
        });
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    /**
     * Wire onopen / onclose / onerror / onmessage on a freshly created WebSocket.
     * Extracted from connect() to keep that method under 50 lines.
     */
    private _setupWsHandlers(
        ws: WebSocket,
        resolve: () => void,
        reject: (err: WsError) => void
    ): void {
        let settled = false;

        ws.onopen = () => {
            if (settled) return;
            settled = true;
            this._state = "connected";
            this.onConnected?.();
            resolve();
        };

        ws.onclose = (ev) => {
            const wasConnecting = !settled;
            settled = true;

            if (ev.code === 1008) {
                this._state = "disconnected";
                const wsErr = this._makeError(
                    "AUTH_FAILED",
                    "WebSocket closed with code 1008 — authentication rejected."
                );
                this.onError?.(wsErr);
                if (wasConnecting) reject(wsErr);
                return;
            }

            this._state = "disconnected";
            const reason = ev.reason || `close code ${ev.code}`;
            if (wasConnecting) {
                const wsErr = this._makeError(
                    "CONNECTION_REFUSED",
                    `WebSocket closed during handshake: ${reason}`
                );
                this.onError?.(wsErr);
                reject(wsErr);
            } else {
                this.onDisconnected?.(reason);
            }
        };

        ws.onerror = () => {
            // onerror always precedes onclose — let onclose handle the final state
        };

        ws.onmessage = (ev) => {
            this._handleMessage(ev);
        };
    }

    /** Build a structured WsError with transport="native-ws". */
    private _makeError(code: WsError["code"], message: string): WsError {
        return { code, message, transport: "native-ws" };
    }

    private _handleMessage(ev: MessageEvent): void {
        let raw: RawMessage;
        try {
            raw = JSON.parse(ev.data as string) as RawMessage;
        } catch {
            // Non-JSON message — silently ignore
            return;
        }

        // Pong response to our ping
        if (raw.type === "pong" && this._pingResolve) {
            const resolve = this._pingResolve;
            this._pingResolve = null;
            resolve();
            return;
        }

        // Channel-routed message
        if (typeof raw.channel === "string") {
            const handler = this._handlers.get(raw.channel);
            if (handler) {
                handler(raw.payload);
            }
            // No handler → silently ignored (per spec §5.2)
        }
        // Message without "channel" key → silently ignored
    }
}
