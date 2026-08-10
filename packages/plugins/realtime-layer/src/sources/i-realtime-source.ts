/*!
 * @geoleaf-plugins/realtime-layer
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * IRealtimeSource — contract for all realtime data sources.
 *
 * Implementations: polling-source, websocket-source, sse-source.
 * Custom sources should implement this interface too.
 */

/**
 * Interface that every realtime source must implement.
 */
export interface IRealtimeSource {
    /** Start fetching / subscribing. */
    start(): void;
    /** Stop fetching / unsubscribe and free resources. */
    stop(): void;
    /**
     * Register a handler called each time new raw data arrives.
     * The handler is called with the raw payload (string, object, or ArrayBuffer
     * depending on the source). The manager calls `decode()` on the registered
     * decoder before forwarding to `layer-updater`.
     */
    onData(handler: (data: unknown) => void): void;
}
