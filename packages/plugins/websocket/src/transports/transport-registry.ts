/*!
 * @geoleaf-plugins/websocket
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * transport-registry.ts — Factory registry for IWsTransport implementations.
 *
 * Built-in transport: "native-ws" (NativeWsTransport).
 * Consumers may register custom transports via registerTransport().
 * Unknown keys at create() time throw a WsConfigError with code INVALID_TRANSPORT.
 */

import type { IWsTransport } from "./i-ws-transport.js";
import { WsConfigError } from "../config.js";

/** Factory function signature for transport constructors. */
type TransportFactory = () => IWsTransport;

const _registry: Map<string, TransportFactory> = new Map();

/**
 * Register a custom transport under the given key.
 * Overwrites any existing registration for that key.
 * @param key - The transport identifier (used in WsPluginConfig.transport).
 * @param factory - Factory function that returns a fresh IWsTransport instance.
 */
export function registerTransport(key: string, factory: TransportFactory): void {
    _registry.set(key, factory);
}

/**
 * Create a transport instance for the given key.
 * Throws WsConfigError(INVALID_TRANSPORT) if the key is not registered.
 */
export function createTransport(key: string): IWsTransport {
    const factory = _registry.get(key);
    if (!factory) {
        throw new WsConfigError(
            "INVALID_TRANSPORT",
            `Unknown transport: "${key}". Register it via registerTransport() before calling init().`,
            key
        );
    }
    return factory();
}

// ─── Register built-in "native-ws" transport ──────────────────────────────────
// Lazy import to avoid circular dependency during tree-shaking.
// The factory is registered at module evaluation time.

import { NativeWsTransport } from "./native-ws.transport.js";

registerTransport("native-ws", () => new NativeWsTransport());
