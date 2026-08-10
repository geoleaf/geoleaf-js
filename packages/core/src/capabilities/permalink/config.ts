/*!
 * GeoLeaf Core (permalink capability) — config reader
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Permalink capability — config reader.
 *
 * Reads `modules.permalink.*` from the core Config singleton (typed import — the
 * in-core equivalent of the former `GeoLeaf.Config.get` runtime seam) and merges it
 * over the built-in defaults. Migrated from the former `ui.permalink` block (S13).
 */
"use strict";

import { Config } from "../../kernel/config/config-primitives.js";
import type { PermalinkConfig } from "../../kernel/config/geoleaf-config/config-types.js";

/** Subset of `Config` consumed here (`get` is augmented onto Config at runtime). */
interface ConfigLike {
    get?<T = unknown>(path: string, defaultValue?: T): T;
}
const _Config = Config as ConfigLike;

/**
 * Built-in defaults. `enabled` is `true` — permalink is opt-out (active unless a
 * profile sets `modules.permalink.enabled: false`); `mode` defaults to `"hash"`.
 */
const DEFAULTS: PermalinkConfig = { enabled: true, mode: "hash" };

/**
 * Reads `modules.permalink.*` from the running core config and merges it over the
 * built-in defaults.
 */
export function getPermalinkConfig(): PermalinkConfig {
    const raw = _Config.get?.<Partial<PermalinkConfig>>("modules.permalink", {}) ?? {};
    return { ...DEFAULTS, ...raw };
}
