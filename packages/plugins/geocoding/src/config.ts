/*!
 * @geoleaf-plugins/geocoding — Config reader
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { GeocodingConfig } from "./types.js";
import { coreConfigGet } from "@geoleaf/host-runtime";

/** The keys the plugin gives a default to — what {@link getPluginConfig} always returns set. */
type DefaultedKey =
    "enabled" | "provider" | "debounceMs" | "minChars" | "resultLimit" | "position" | "flyToZoom";

/** A configuration merged over the defaults: every defaulted key is set. */
export type ResolvedGeocodingConfig = GeocodingConfig &
    Required<Pick<GeocodingConfig, DefaultedKey>>;

/**
 * Built-in defaults — the ONE place a default of `modules.geocoding` is written.
 *
 * `enabled` is `false` so the control is strictly opt-in, matching the historical core
 * behaviour (the widget only mounts when the profile sets `modules.geocoding.enabled: true`).
 */
export const DEFAULTS: Required<Pick<GeocodingConfig, DefaultedKey>> = {
    enabled: false,
    provider: "addok",
    debounceMs: 300,
    minChars: 3,
    resultLimit: 5,
    position: "top-left",
    flyToZoom: 15,
};

/**
 * Merges a `modules.geocoding` block over the built-in defaults.
 *
 * ⚠️ A key written `null` (or `undefined`) keeps its default, unlike a plain
 * `{ ...DEFAULTS, ...raw }`: these defaults were `??` fallbacks at the point of use before
 * they entered the table, and a profile carrying `"minChars": null` must keep meaning
 * "the default", not "search from the first keystroke".
 *
 * @param raw - The block as the profile wrote it; may be partial.
 * @returns The block, every defaulted key set.
 */
export function withDefaults(raw: GeocodingConfig): ResolvedGeocodingConfig {
    const written: GeocodingConfig = Object.fromEntries(
        Object.entries(raw).filter(([, value]) => value !== null && value !== undefined)
    );
    return { ...DEFAULTS, ...written };
}

/**
 * Reads `modules.geocoding.*` from the running core (Plugin Contract v1, INV-CONFIG)
 * and merges it over the built-in defaults — see {@link withDefaults} for a `null` key.
 */
export function getPluginConfig(): ResolvedGeocodingConfig {
    const raw = coreConfigGet<GeocodingConfig>("modules.geocoding", {}) ?? {};
    return withDefaults(raw);
}
