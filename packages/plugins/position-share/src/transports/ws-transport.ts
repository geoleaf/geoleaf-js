/*!
 * @geoleaf-plugins/position-share — WebSocket transport
 *
 * Sends one sample per `GeoLeaf.Ws.send` on the configured channel, and never initialises the
 * connection: it belongs to the integrator and may already be serving realtime layers, so
 * calling `init` here would tear down someone else's socket to send a position. There is no
 * authentication on this path — the `websocket` plugin's `auth` field was never delivered.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { getGeoLeaf } from "@geoleaf/host-runtime";

import type { PluginConfig } from "../config.js";
import type { IPositionTransport, PositionPayload } from "./contract.js";

/** The slice of `GeoLeaf.Ws` this transport needs — read late, never imported. */
interface WsSurface {
    state?: string;
    send?: (channel: string, payload: unknown) => void;
}

/**
 * Builds the built-in WebSocket transport: one `GeoLeaf.Ws.send` per sample.
 *
 * **It never calls `GeoLeaf.Ws.init()`.** The connection belongs to the integrator and may
 * already be serving realtime layers; `init` destroys before it rebuilds, so initialising here
 * would tear down someone else's socket to send a position.
 *
 * Corollary the integrator has to know: the queue policy is the connection's, not ours. Its
 * default `queueOnDisconnect: true` would REPLAY stale positions on reconnect — publishing a
 * false fact about where someone was. Recommend `queueOnDisconnect: false` on any connection
 * that carries this plugin.
 *
 * There is no authentication on this path. The `websocket` plugin's `auth` field is a
 * reservation that was never delivered. Wrap this transport in your own registered one if you
 * need a token.
 *
 * @param cfg - The merged plugin configuration; `cfg.channel` must be set.
 * @returns A transport whose `send` rejects with a cause-naming error when `Ws` is missing or
 *   not connected.
 */
export function createWsTransport(cfg: PluginConfig): IPositionTransport {
    return {
        async send(payload: PositionPayload): Promise<void> {
            const channel = cfg.channel;
            if (!channel) {
                throw new Error(
                    'position-share: modules.position-share.channel is required when transport is "websocket"'
                );
            }

            // Read at call time: the websocket plugin may register after this factory ran, and
            // a captured reference would pin the absence.
            const ws = getGeoLeaf()?.Ws as WsSurface | undefined;

            if (!ws || typeof ws.send !== "function") {
                throw new Error(
                    "position-share: GeoLeaf.Ws is absent — load @geoleaf-plugins/websocket " +
                        'before using transport: "websocket"'
                );
            }

            if (ws.state !== "connected") {
                throw new Error(
                    `position-share: GeoLeaf.Ws is "${String(ws.state)}" — call GeoLeaf.Ws.init() ` +
                        "before emitting; this plugin deliberately does not initialise it"
                );
            }

            ws.send(channel, payload);
        },
    };
}
