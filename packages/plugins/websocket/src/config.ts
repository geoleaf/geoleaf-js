/*!
 * @geoleaf-plugins/websocket
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * config.ts — WsPluginConfig definition, defaults, and validation.
 *
 * Auth type stubs (JwtAuth, CredentialsAuth) are re-exported from i-ws-transport.ts
 * for consumer convenience — no auth logic is implemented in v1.0.
 */

import type { WsError, WsErrorCode } from "./transports/i-ws-transport.js";

// ─── Sub-configs ──────────────────────────────────────────────────────────────

/** Reconnection backoff configuration. */
export interface ReconnectConfig {
    /** Initial delay before first retry. Default: 1000 ms. */
    initialDelayMs?: number;
    /** Maximum delay cap (exponential backoff ceiling). Default: 30000 ms. */
    maxDelayMs?: number;
    /** Maximum retry count. 0 = infinite (suitable for offline-first PWAs). Default: 10. */
    maxRetries?: number;
}

/** Heartbeat keep-alive configuration. */
export interface HeartbeatConfig {
    /** Enable or disable heartbeat entirely. */
    enabled: boolean;
    /** Ping interval in ms. Default: 25000. */
    intervalMs?: number;
    /** Timeout to wait for pong before declaring the connection lost. Default: 5000. Must be < intervalMs. */
    timeoutMs?: number;
}

// ─── Main config ──────────────────────────────────────────────────────────────

/** Full plugin configuration passed to GeoLeaf.Ws.init(). */
export interface WsPluginConfig {
    /**
     * Transport key. Built-in: "native-ws".
     * Custom transports registered via registerTransport() are also valid.
     */
    transport: string;
    /** WebSocket endpoint URL. Must be wss:// in production. */
    url: string;
    /** Auth configuration. Not used by native-ws in v1.0 — reserved for extensibility. */
    auth?:
        | import("./transports/i-ws-transport.js").JwtAuth
        | import("./transports/i-ws-transport.js").CredentialsAuth;
    /** Reconnection strategy. */
    reconnect?: ReconnectConfig;
    /** Heartbeat keep-alive. */
    heartbeat?: HeartbeatConfig;
    /** Queue outgoing messages during disconnection. Default: true. */
    queueOnDisconnect?: boolean;
    /** Maximum messages held in the send queue. Default: 100. */
    maxQueueSize?: number;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

/** Fully-resolved plugin config with all defaults applied. */
export interface ResolvedWsConfig {
    transport: string;
    url: string;
    auth?: WsPluginConfig["auth"];
    reconnect: Required<ReconnectConfig>;
    heartbeat: { enabled: boolean; intervalMs: number; timeoutMs: number };
    queueOnDisconnect: boolean;
    maxQueueSize: number;
}

/** Apply defaults to a validated WsPluginConfig. */
export function applyDefaults(config: WsPluginConfig): ResolvedWsConfig {
    return {
        transport: config.transport,
        url: config.url,
        auth: config.auth,
        reconnect: {
            initialDelayMs: config.reconnect?.initialDelayMs ?? 1000,
            maxDelayMs: config.reconnect?.maxDelayMs ?? 30000,
            maxRetries: config.reconnect?.maxRetries ?? 10,
        },
        heartbeat: {
            enabled: config.heartbeat?.enabled ?? false,
            intervalMs: config.heartbeat?.intervalMs ?? 25000,
            timeoutMs: config.heartbeat?.timeoutMs ?? 5000,
        },
        queueOnDisconnect: config.queueOnDisconnect ?? true,
        maxQueueSize: config.maxQueueSize ?? 100,
    };
}

// ─── Validation ───────────────────────────────────────────────────────────────

/** Thrown when the provided WsPluginConfig fails validation. */
export class WsConfigError extends Error {
    readonly wsError: WsError;
    constructor(code: WsErrorCode, message: string, transport: string) {
        super(message);
        this.name = "WsConfigError";
        this.wsError = { code, message, transport };
    }
}

/**
 * Validate a WsPluginConfig.
 * Throws WsConfigError on the first rule violation.
 * Does NOT check if the transport key is registered — that is the responsibility
 * of TransportRegistry at create() time.
 *
 * Rules:
 *   1. url starting with "ws://" when NODE_ENV === "production" → CONNECTION_REFUSED
 *   2. heartbeat enabled + timeoutMs >= intervalMs → CONNECTION_REFUSED
 */
export function validateConfig(config: WsPluginConfig): void {
    const transport = config.transport ?? "unknown";

    // Rule 1 — TLS required in production
    if (
        typeof process !== "undefined" &&
        process.env["NODE_ENV"] === "production" &&
        config.url?.startsWith("ws://")
    ) {
        throw new WsConfigError(
            "CONNECTION_REFUSED",
            "TLS required in production. Use wss:// URL.",
            transport
        );
    }

    // Rule 2 — heartbeat timeoutMs < intervalMs
    if (config.heartbeat?.enabled) {
        const intervalMs = config.heartbeat.intervalMs ?? 25000;
        const timeoutMs = config.heartbeat.timeoutMs ?? 5000;
        if (timeoutMs >= intervalMs) {
            throw new WsConfigError(
                "CONNECTION_REFUSED",
                "heartbeat.timeoutMs must be less than intervalMs.",
                transport
            );
        }
    }
}
