/*!
 * GeoLeaf Core (feature-info capability) — Config reader
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Feature-info capability — config reader.
 *
 * Reads `modules.feature-info.*` from the core Config singleton and merges it
 * over the built-in defaults.
 */
import type { FeatureInfoConfig } from "./types.js";
import { Config } from "../../kernel/config/config-primitives.js";

/** Subset of `Config` consumed here (`get` is augmented onto Config at runtime). */
interface ConfigLike {
    get?<T = unknown>(path: string, defaultValue?: T): T;
}
const _Config = Config as ConfigLike;

const DEFAULTS = { enabled: true } as const;

/** Reads `modules.feature-info` from the typed core Config (INV-CONFIG canonical form). */
export function getFeatureInfoConfig(): FeatureInfoConfig {
    const raw = _Config.get?.<Partial<FeatureInfoConfig>>("modules.feature-info", {}) ?? {};
    return { ...DEFAULTS, ...raw };
}
