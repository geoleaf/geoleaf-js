/*!
 * @geoleaf-plugins/realtime-layer
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * public-api — builds the `GeoLeaf.RealtimeLayer` namespace object.
 *
 * This is the only surface exposed to integrators. All methods delegate to
 * realtime-runtime and stale-tracking internals.
 */

import type { IDecoder } from "./decoders/i-decoder.js";
import type { StaleActionHandler } from "./stale-tracking.js";
import type { RealtimeStatus } from "./realtime-runtime.js";
import {
    start,
    stop,
    stopAll,
    getStatus,
    registerDecoder as _registerDecoder,
} from "./realtime-runtime.js";
import { registerStaleAction as _registerStaleAction } from "./stale-tracking.js";

/**
 * The `GeoLeaf.RealtimeLayer` surface — starting and stopping per-layer feeds.
 *
 * Layers declaring `data.realtime.enabled: true` are started at boot; the methods here exist
 * for the opt-in case and for tearing a feed down.
 */
export interface RealtimeLayerPublicAPI {
    /**
     * Start real-time updates for a layer.
     * Called automatically at boot for all layers with `data.realtime.enabled: true`.
     * Can be called manually for layers with `enabled: false` (opt-in).
     */
    start(layerId: string): void;

    /** Stop real-time updates for a specific layer. */
    stop(layerId: string): void;

    /** Stop all active realtime layers. */
    stopAll(): void;

    /** Returns the current status of a realtime layer. */
    getStatus(layerId: string): RealtimeStatus;

    /**
     * Register a custom decoder.
     * Must be called before `GeoLeaf.boot()` so it is available at boot scan.
     *
     * @example
     * GeoLeaf.RealtimeLayer.registerDecoder('my-format', new MyDecoder());
     */
    registerDecoder(name: string, decoder: IDecoder): void;

    /**
     * Register a custom stale action handler.
     * Must be called before `GeoLeaf.boot()`.
     *
     * @example
     * GeoLeaf.RealtimeLayer.registerStaleAction('notify', (layerId, featureId, feature) => {
     *   GeoLeaf.Notifications.show(`Feature ${featureId} is stale`, { type: 'warning' });
     * });
     */
    registerStaleAction(name: string, handler: StaleActionHandler): void;

    /** Plugin version string. */
    version: string;
}

/**
 * Builds the object mounted on `GeoLeaf.RealtimeLayer`.
 *
 * The plugin's single entry point into the namespace — the module-level `start` / `stop` are
 * bound here rather than exported directly, so the mounted surface is one auditable object.
 *
 * @returns The public API, ready to mount.
 */
export function buildPublicApi(): RealtimeLayerPublicAPI {
    return {
        start,
        stop,
        stopAll,
        getStatus,
        registerDecoder: _registerDecoder,
        registerStaleAction: _registerStaleAction,
        version: "__GEOLEAF_VERSION__",
    };
}
