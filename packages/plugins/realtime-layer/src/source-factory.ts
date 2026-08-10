/*!
 * @geoleaf-plugins/realtime-layer
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * SourceFactory — instantiates the appropriate IRealtimeSource implementation
 * based on the `data.realtime.source` value in the layer config.
 */

import type { IRealtimeSource } from "./sources/i-realtime-source.js";
import type { RealtimeConfig } from "./config.js";
import { PollingSource } from "./sources/polling-source.js";
import { WebSocketSource } from "./sources/websocket-source.js";
import { SseSource } from "./sources/sse-source.js";

/**
 * Build the IRealtimeSource for the provided layer config.
 *
 * @param config - Validated RealtimeConfig for the layer.
 * @param layerId - Layer ID used in error messages only.
 * @returns The instantiated source.
 * @throws Error if the source type is unknown or required params are absent.
 */
export function createSource(config: RealtimeConfig, layerId: string): IRealtimeSource {
    switch (config.source) {
        case "polling": {
            if (!config.url) {
                throw new Error(
                    `[realtime-layer] "${layerId}": data.realtime.url is required for polling source`
                );
            }
            return new PollingSource(
                config.url,
                config.intervalMs ?? 30_000,
                config.decoder,
                config.fallbackUrl
            );
        }
        case "websocket": {
            if (!config.channel) {
                throw new Error(
                    `[realtime-layer] "${layerId}": data.realtime.channel is required for websocket source`
                );
            }
            return new WebSocketSource(config.channel);
        }
        case "sse": {
            if (!config.url) {
                throw new Error(
                    `[realtime-layer] "${layerId}": data.realtime.url is required for sse source`
                );
            }
            return new SseSource(config.url);
        }
        default: {
            throw new Error(
                `[realtime-layer] "${layerId}": unknown source type "${config.source}"`
            );
        }
    }
}
