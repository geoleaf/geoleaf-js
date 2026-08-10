/*!
 * GeoLeaf Core (share capability) — config reader
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Share capability — config reader.
 *
 * Reads `modules.permalink.share.*` from the core Config singleton (typed import — the in-core
 * equivalent of the former `GeoLeaf.Config.get` runtime seam) and merges it over the
 * built-in defaults. This is the capability-level gate only.
 *
 * Migrated from the former `ui.showShareButton` UI flag (S12).
 */
"use strict";

import { Config } from "../../../kernel/config/config-primitives.js";

/** Subset of `Config` consumed here (`get` is augmented onto Config at runtime). */
interface ConfigLike {
    get?<T = unknown>(path: string, defaultValue?: T): T;
}
const _Config = Config as ConfigLike;

/** The `modules.permalink.share` capability-level config block. */
export interface ShareCapabilityConfig {
    /**
     * Capability gate — the share button and modal are inert when `false`. Opt-out
     * (`enableWhenAbsent: true`): absent → active, preserving the pre-migration
     * default-on behaviour.
     */
    enabled: boolean;
}

/**
 * Built-in defaults. `enabled` is `true` — share is opt-out (active unless a profile
 * sets `modules.permalink.share.enabled: false`).
 */
const DEFAULTS: ShareCapabilityConfig = { enabled: true };

/**
 * Reads `modules.permalink.share.*` from the running core config and merges it over the
 * built-in defaults.
 */
export function getShareConfig(): ShareCapabilityConfig {
    const raw = _Config.get?.<Partial<ShareCapabilityConfig>>("modules.permalink.share", {}) ?? {};
    return { ...DEFAULTS, ...raw };
}
