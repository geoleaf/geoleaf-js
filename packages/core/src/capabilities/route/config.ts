/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Route capability — config reader.
 *
 * Reads `modules.route.*` from the core Config singleton (typed import — the
 * in-core equivalent of the former `GeoLeaf.Config.get` runtime seam) and merges
 * it over the built-in defaults (`enabled: false` → strictly opt-in).
 */

import type { RouteConfig } from "./types.js";
import { Config } from "../../kernel/config/config-primitives.js";

/** Subset of `Config` consumed here (`get` is augmented onto Config at runtime). */
interface ConfigLike {
    get?<T = unknown>(path: string, defaultValue?: T): T;
}
const _Config = Config as ConfigLike;

/** Built-in defaults. `enabled: false` → the capability is strictly opt-in. */
const DEFAULTS: RouteConfig = { enabled: false };

/** Reads `modules.route.*` from the running core config, merged over defaults. */
export function getRouteConfig(): RouteConfig {
    const raw = _Config.get?.<Partial<RouteConfig>>("modules.route", {}) ?? {};
    return { ...DEFAULTS, ...raw };
}
