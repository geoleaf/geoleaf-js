/*!
 * @geoleaf-plugins/position-share — Transport contract
 * © 2026 Mattieu Pottier — MIT License
 *
 * Pure types. This module imports NO runtime value, so a consumer writing its own transport
 * can depend on the shape without pulling the plugin's implementation into its bundle.
 * https://geoleaf.dev
 */

/** One position sample, as it travels to the backend. */
export interface PositionPayload {
    /** Stable per-browser identifier — see `client-id.ts`. Prefixed `loc:`. */
    clientId: string;
    lat: number;
    lng: number;
    /** Metres, when the browser reports it. */
    accuracy?: number;
    /** Epoch milliseconds at which the fix was taken. */
    timestamp: number;
}

/**
 * A way to get one {@link PositionPayload} to a backend.
 *
 * Rejecting means "this sample is lost", NOT "retry later". The plugin keeps no queue: a
 * position is perishable, and replaying a stale one publishes a false fact about where
 * someone is.
 */
export interface IPositionTransport {
    /** Sends one sample. Rejects to signal failure — the sample is then dropped. */
    send(payload: PositionPayload): Promise<void>;
    /** Optional teardown, called when the emitter stops or the transport is replaced. */
    close?(): void;
}
