/*!
 * @geoleaf-plugins/websocket
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * IWsTransport — Core transport interface for @geoleaf-plugins/websocket.
 *
 * All transport implementations must satisfy this interface.
 * The ConnectionManager and HeartbeatManager interact with transports
 * exclusively through this surface.
 */

// ─── State ────────────────────────────────────────────────────────────────────

/** Connection lifecycle states. */
export type TransportState =
    | "disconnected"
    | "connecting"
    | "connected"
    | "reconnecting"
    | "failed";

// ─── Handlers ─────────────────────────────────────────────────────────────────

/** Callback invoked when a message is received on a subscribed channel. */
export type MessageHandler = (payload: unknown) => void;

// ─── Transport type ───────────────────────────────────────────────────────────

/**
 * Open string type — allows consumers to register custom transports
 * via registerTransport() without being constrained to a closed union.
 * Built-in value: "native-ws".
 */
export type TransportType = string;

// ─── Config passed to transport.connect() ─────────────────────────────────────

/** Minimal config slice required by the transport layer. */
export interface TransportConfig {
    /** WebSocket endpoint URL. */
    url: string;
    /** Optional auth configuration (concrete shape depends on the transport). */
    auth?: JwtAuth | CredentialsAuth;
}

// ─── Auth stubs (types only — no logic in v1.0) ───────────────────────────────

/** JWT authentication stub — defined for extensibility, not active in v1.0. */
export interface JwtAuth {
    type: "jwt";
    token: string;
    /** Default: "Authorization" */
    headerName?: string;
    /** Called on transport error code 4401 — optional token refresh hook. */
    refreshCallback?: () => Promise<string>;
}

/** Credentials authentication stub — defined for extensibility, not active in v1.0. */
export interface CredentialsAuth {
    type: "credentials";
    username: string;
    password: string;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

/** Machine-readable error codes emitted by the plugin. */
export type WsErrorCode =
    | "CONNECTION_REFUSED" // Backend unreachable or TLS required
    | "AUTH_FAILED" // Handshake rejected (e.g. close code 1008)
    | "AUTH_EXPIRED" // Session or token expired mid-connection
    | "MAX_RETRIES_EXCEEDED" // All reconnect attempts exhausted
    | "INVALID_TRANSPORT" // Unknown transport key in config
    | "SEND_QUEUE_OVERFLOW"; // maxQueueSize exceeded

/** Structured error object emitted on WsError events. */
export interface WsError {
    code: WsErrorCode;
    message: string;
    transport: TransportType;
    attempt?: number;
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

/** Connection and message metrics snapshot. */
export interface WsMetrics {
    /** ISO 8601 timestamp of last successful connection. null if never connected. */
    connectedAt: string | null;
    /** Total successful reconnections since init(). */
    reconnectCount: number;
    /** Total messages sent (including queued and re-sent). */
    messagesSent: number;
    /** Total messages received on subscribed channels. */
    messagesReceived: number;
    /** Last ping round-trip duration in ms. null if heartbeat disabled. */
    lastPingMs: number | null;
    /** Names of currently active channel subscriptions. */
    activeChannels: string[];
    /** Current number of messages in the send queue. */
    queueLength: number;
}

// ─── IWsTransport ─────────────────────────────────────────────────────────────

/**
 * Transport interface — the only surface of contact between the plugin
 * infrastructure (ConnectionManager, HeartbeatManager) and underlying transports.
 */
export interface IWsTransport {
    /**
     * Establish the connection to the backend.
     * Resolves when the transport is ready to receive subscriptions.
     * Rejects with WsError on irrecoverable failure.
     */
    connect(config: TransportConfig): Promise<void>;

    /**
     * Disconnect gracefully. Must be idempotent.
     * @param reason - Human-readable disconnect reason for logging/events.
     */
    disconnect(reason?: string): void;

    /**
     * Subscribe to a named channel.
     * Returns an idempotent unsubscribe function.
     */
    subscribe(channel: string, handler: MessageHandler): () => void;

    /**
     * Send a message to the backend.
     * Serializes payload to the transport's native format.
     * Throws if the transport is not connected (ConnectionManager handles queuing).
     */
    send(channel: string, payload: unknown): void;

    /**
     * Send a ping and await the pong.
     * Used by HeartbeatManager.
     * Resolves when the pong is received.
     * Rejects or never resolves on timeout — HeartbeatManager races it.
     */
    ping(): Promise<void>;

    /** Current transport connection state. */
    readonly state: TransportState;

    /** Fires when connection is established and ready. */
    onConnected: (() => void) | null;

    /** Fires when connection is lost (before reconnect attempts start). */
    onDisconnected: ((reason: string) => void) | null;

    /** Fires on unrecoverable error (auth failure, invalid config). */
    onError: ((error: WsError) => void) | null;
}
