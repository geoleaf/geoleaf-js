/*!
 * @geoleaf-plugins/position-share — Config reader
 *
 * Reads `modules.position-share`, the plugin's ONLY branch of the profile, and merges it over
 * the built-in defaults. It also carries `validateConfig`, which checks the cross-field rules a
 * JSON schema cannot express: each built-in transport requires one companion key, and which one
 * depends on `transport`.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { coreConfigGet } from "@geoleaf/host-runtime";

/** Emission mode: at boot, on user action, or never. */
export type PositionShareMode = "auto" | "manual" | "off";

/** Receive-side options — delegated wholesale to the `realtime-layer` plugin. */
export interface ReceiveConfig {
    enabled: boolean;
    layerId?: string;
}

/**
 * The resolved `modules.position-share` block: built-in defaults under any profile override.
 *
 * The trailing index signature is deliberate — a third-party transport reads its own keys from
 * the same block, and typing them here would mean this package knowing about transports it does
 * not ship.
 */
export interface PluginConfig {
    enabled: boolean;
    mode: PositionShareMode;
    transport: string;
    endpoint?: string;
    channel?: string;
    intervalMs: number;
    minDistanceM: number;
    showButton: boolean;
    receive: ReceiveConfig;
    [key: string]: unknown;
}

// `enabled` defaults to FALSE, against the scaffold's generic `true`. What this plugin
// transports is a person's location: an open default would turn a routine dependency bump
// into a data leak. `mode` is closed too — the redundancy is deliberate, so that neither a
// half-filled profile nor a copied snippet can start emitting on its own.
const DEFAULTS: PluginConfig = {
    enabled: false,
    mode: "off",
    transport: "http",
    intervalMs: 30000,
    minDistanceM: 10,

    // Read by the toolbar slot as `modules.position-share.showButton` — the SAME branch this
    // file reads. INV-CONFIG forbids a second one, and `PC-14` now enforces it.
    showButton: true,

    receive: { enabled: false },
};

/** Reported by {@link validateConfig} when the profile cannot produce a working transport. */
export interface ConfigProblem {
    key: string;
    message: string;
}

/**
 * Checks the cross-field requirements that a JSON schema cannot express: each built-in
 * transport needs one companion key, and which one depends on `transport`.
 *
 * An UNKNOWN `transport` is NOT a problem here. A third-party transport registers itself
 * at runtime, possibly after the profile is read, so availability is a question of *moment*,
 * not of form — rejecting it at configuration time would reject a correct setup.
 *
 * @param cfg - The merged configuration to check.
 * @returns One entry per unmet requirement; empty when the configuration can emit.
 *
 * @example
 * ```ts
 * validateConfig({ ...cfg, transport: "http", endpoint: undefined });
 * // → [{ key: "endpoint", message: "…" }]
 * ```
 */
export function validateConfig(cfg: PluginConfig): ConfigProblem[] {
    const problems: ConfigProblem[] = [];
    if (cfg.transport === "http" && !cfg.endpoint) {
        problems.push({
            key: "endpoint",
            message: 'modules.position-share.endpoint is required when transport is "http"',
        });
    }
    if (cfg.transport === "websocket" && !cfg.channel) {
        problems.push({
            key: "channel",
            message: 'modules.position-share.channel is required when transport is "websocket"',
        });
    }
    return problems;
}

/**
 * Reads the plugin configuration from the `modules.position-share` namespace of the running
 * core (Plugin Contract v1, INV-CONFIG), merged over the built-in defaults.
 *
 * `modules.position-share` is the plugin's ONLY branch of the profile — never open a
 * second one, whatever the key. See `PLUGIN_ARCHITECTURE_SPEC.md` §5.
 *
 * @returns The merged configuration — built-in defaults under any profile override.
 */
export function getPluginConfig(): PluginConfig {
    const raw = coreConfigGet<Partial<PluginConfig>>("modules.position-share", {}) ?? {};
    return {
        ...DEFAULTS,
        ...raw,
        // `receive` is a nested object: a shallow spread would drop the built-in default the
        // moment a profile sets only one of its two keys.
        receive: { ...DEFAULTS.receive, ...(raw.receive ?? {}) },
    };
}
