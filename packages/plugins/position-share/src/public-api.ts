/*!
 * @geoleaf-plugins/position-share — Public API facade
 * © 2026 Mattieu Pottier — MIT License
 *
 * Façade only: exposes the plugin's public surface (INV-FACADE). Methods are
 * thin wrappers that delegate to internal modules — no business logic here.
 * https://geoleaf.dev
 */
import { getPluginConfig, type PluginConfig } from "./config.js";
import { getClientId, clearClientId } from "./client-id.js";
import { startEmission, stopEmission, toggleEmission, isEmitting } from "./emitter.js";
import { showOthers } from "./receive.js";
import { registerTransport, registeredTransports } from "./transports/registry.js";
import type { PositionTransportFactory } from "./transports/registry.js";

/** The object mounted on `GeoLeaf.PositionShare`. */
export interface PositionSharePublicApi {
    /** The merged `modules.position-share` configuration. */
    getConfig(): PluginConfig;
    /** The stable identifier labelling every sample this browser emits. */
    getClientId(): string;
    /** Forgets the identifier (storage + cache) — the right-to-erasure primitive (RGPD art. 17). */
    clearClientId(): void;
    /** Starts emitting. Returns `false` when configuration forbids or prevents it. */
    start(): boolean;
    /** Stops emitting. Idempotent. */
    stop(): void;
    /** Flips emission; returns the state after the call. */
    toggle(): boolean;
    /** Whether the emission loop is running. */
    isEmitting(): boolean;
    /** Shows or hides the other users, by delegating to the `realtime-layer` plugin. */
    showOthers(visible: boolean): boolean;
    /** Registers a transport factory under `key`. Must run before the first send. */
    registerTransport(key: string, factory: PositionTransportFactory): void;
    /** The transport keys currently registered. */
    listTransports(): string[];
}

/**
 * Builds the object mounted on `GeoLeaf.PositionShare`.
 *
 * @returns The plugin's public surface.
 */
export function buildPublicApi(): PositionSharePublicApi {
    return {
        getConfig: (): PluginConfig => getPluginConfig(),
        getClientId: (): string => getClientId(),
        clearClientId: (): void => clearClientId(),
        start: (): boolean => startEmission(),
        stop: (): void => stopEmission(),
        toggle: (): boolean => toggleEmission(),
        isEmitting: (): boolean => isEmitting(),
        showOthers: (visible: boolean): boolean => showOthers(visible),
        registerTransport: (key: string, factory: PositionTransportFactory): void =>
            registerTransport(key, factory),
        listTransports: (): string[] => registeredTransports(),
    };
}
