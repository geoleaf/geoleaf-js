/*!
 * @geoleaf-plugins/geocoding — Config reader
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { GeocodingConfig } from "./types.js";
import { coreConfigGet } from "@geoleaf/host-runtime";

/**
 * Built-in defaults. `enabled` is `false` so the control is strictly opt-in,
 * matching the historical core behaviour (the widget only mounts when the
 * profile sets `modules.geocoding.enabled: true`).
 */
const DEFAULTS: GeocodingConfig = { enabled: false };

/**
 * Reads `modules.geocoding.*` from the running core (Plugin Contract v1, INV-CONFIG)
 * and merges it over the built-in defaults.
 */
export function getPluginConfig(): GeocodingConfig {
    const raw = coreConfigGet<GeocodingConfig>("modules.geocoding", {}) ?? {};
    return { ...DEFAULTS, ...raw };
}
