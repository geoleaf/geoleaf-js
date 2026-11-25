/*!
 * GeoLeaf Core – Whether the offline engine can come
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Answers, from the capability registry, whether the deferred offline engine
 * will ever be wired.
 *
 * The engine is a deferred chunk: the layer loader and the storage façade wait for it, bounded
 * by a timer, because `StorageContract.whenReady()` never resolves when the engine does not
 * load. That bound used to be paid on every variant WITHOUT the engine — 3 s per layer that
 * declares an offline read (and the loader's batches being sequential, every following layer
 * waited too), 3 s per pull, 3 s per edit. The registry knows at boot whether the engine can
 * come; the wait is now kept for the case where it can.
 *
 * Same condition as the offline lifecycle that loads it: `offline` AND its `pwa` dependency,
 * both declared (embarked) and switched on by the merged configuration.
 */

import { CapabilityRegistry } from "./capability-registry.js";
import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";

/** Dotted-path config reader — the shape `CapabilityRegistry.isEnabled()` expects. */
interface ConfigReader {
    get(key: string, defaultValue?: unknown): unknown;
}

/** Nothing configured: every gate then answers its own `enableWhenAbsent` (opt-in here). */
const _NO_CONFIG: ConfigReader = { get: (_key, defaultValue) => defaultValue };

/**
 * Whether the offline engine is expected to be wired in this page.
 *
 * Reads the config namespace on every call, never captured: the profile merge enriches it in
 * place, and a captured reader would keep the pre-merge verdict.
 *
 * @returns `true` when `offline` and `pwa` are both embarked and switched on — the engine will
 *   be wired, and a bounded wait for it is worth it; `false` when it never will.
 *
 * @example
 * ```ts
 * // `false`: the engine will never be wired — take the network at once, do not wait.
 * const worthWaiting = isOfflineEngineExpected();
 * ```
 */
export function isOfflineEngineExpected(): boolean {
    const config = (getGeoLeaf() as { Config?: ConfigReader } | undefined)?.Config ?? _NO_CONFIG;
    return (
        CapabilityRegistry.isEnabled("offline", config) &&
        CapabilityRegistry.isEnabled("pwa", config)
    );
}
