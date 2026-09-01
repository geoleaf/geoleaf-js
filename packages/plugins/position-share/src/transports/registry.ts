/*!
 * @geoleaf-plugins/position-share — Transport registry
 * © 2026 Mattieu Pottier — MIT License
 *
 * Replays the ADR-WS01 pattern already settled in this repository: one package, third-party
 * transports injected by the consumer, and adding a transport modifies NO existing code.
 * The price is the same one stated there, and it is explicit: `registerTransport()` must be
 * called BEFORE the first send.
 * https://geoleaf.dev
 */
import type { PluginConfig } from "../config.js";
import type { IPositionTransport } from "./contract.js";

/** Builds a transport from the resolved plugin configuration. */
export type PositionTransportFactory = (cfg: PluginConfig) => IPositionTransport;

const _factories = new Map<string, PositionTransportFactory>();

/**
 * Registers a transport under `key`, making `transport: "<key>"` usable in the profile.
 *
 * Registering the same key twice replaces the previous factory — this is what lets an
 * integrator override a built-in transport (say, to add authentication to the WebSocket one)
 * without forking the package.
 *
 * @param key - Profile value that selects this transport.
 * @param factory - Called once per emission cycle start, with the merged configuration.
 *
 * @example
 * ```ts
 * import { registerTransport } from "@geoleaf-plugins/position-share";
 *
 * registerTransport("my-backend", (cfg) => ({
 *     send: async (payload) => {
 *         await fetch(String(cfg.endpoint), {
 *             method: "POST",
 *             body: JSON.stringify(payload),
 *         });
 *     },
 * }));
 * ```
 */
export function registerTransport(key: string, factory: PositionTransportFactory): void {
    _factories.set(key, factory);
}

/**
 * Resolves the transport named by `cfg.transport`.
 *
 * @param cfg - The merged configuration.
 * @returns The transport, or `null` when no factory answers to that key.
 */
export function resolveTransport(cfg: PluginConfig): IPositionTransport | null {
    const factory = _factories.get(cfg.transport);
    return factory ? factory(cfg) : null;
}

/** Keys with a registered factory, in registration order. Exposed for diagnostics. */
export function registeredTransports(): string[] {
    return [..._factories.keys()];
}
