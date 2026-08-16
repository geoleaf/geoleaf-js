/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Filter capability — config reader.
 *
 * Reads `modules.filter.*` from the core Config singleton (typed import — the
 * in-core equivalent of the former `GeoLeaf.Config.get` runtime seam) and merges
 * it over the built-in defaults. Replaces the scattered `searchConfig` /
 * `ui.showFilterPanel` reads (migrated in F4).
 */

import type { FilterConfig } from "./types.js";
import { Config } from "../../kernel/config/config-primitives.js";

/** Subset of `Config` consumed here (`get` is augmented onto Config at runtime). */
interface ConfigLike {
    get?<T = unknown>(path: string, defaultValue?: T): T;
}
const _Config = Config as ConfigLike;

/**
 * Built-in defaults. `enabled` is `true` — the filter is opt-out (active unless a
 * profile sets `modules.filter.enabled: false`), preserving the pre-migration
 * default-on behaviour of `ui.showFilterPanel`.
 */
const DEFAULTS: FilterConfig = { enabled: true };

/**
 * Reads `modules.filter.*` from the running core config and merges it over the
 * built-in defaults.
 */
export function getFilterConfig(): FilterConfig {
    const raw = _Config.get?.<Partial<FilterConfig>>("modules.filter", {}) ?? {};
    return { ...DEFAULTS, ...raw };
}
