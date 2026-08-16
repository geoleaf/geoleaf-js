/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Taxonomy capability — config reader.
 *
 * Reads `modules.taxonomy.*` from the core Config singleton (typed import —
 * the in-core equivalent of the former `GeoLeaf.Config.get` runtime seam) and
 * merges it over the built-in defaults.
 */

import type { TaxonomyConfig } from "./types.js";
import { Config } from "../../kernel/config/config-primitives.js";

/** Subset of `Config` consumed here (`get` is augmented onto Config at runtime). */
interface ConfigLike {
    get?<T = unknown>(path: string, defaultValue?: T): T;
}
const _Config = Config as ConfigLike;

/**
 * Built-in defaults. `enabled` is `true` — the capability is OPT-OUT.
 *
 * `modules.taxonomy.enabled` lives in a profile RESOURCE, which loads AFTER the
 * boot gate reads the pre-merge config. An opt-in default would therefore make
 * the gate read `undefined` and silence the capability for every profile — the
 * documented boot-gate pitfall that kept the old painter dead. Opt-out is the
 * posture of the other in-core capabilities, for exactly this reason.
 *
 * Only an explicit `enabled: false` silences taxonomy.
 */
const DEFAULTS: TaxonomyConfig = { enabled: true };

/**
 * Reads `modules.taxonomy.*` from the running core config and merges it over the
 * built-in defaults.
 */
export function getTaxonomyConfig(): TaxonomyConfig {
    const raw = _Config.get?.<Partial<TaxonomyConfig>>("modules.taxonomy", {}) ?? {};
    return { ...DEFAULTS, ...raw };
}
