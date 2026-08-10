/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Labels capability — config reader.
 *
 * Reads `modules.labels.*` from the core Config singleton (typed import — the
 * in-core equivalent of the former `GeoLeaf.Config.get` runtime seam) and merges
 * it over the built-in defaults. This is the *capability-level* gate only; the
 * per-layer label styling (font / colour / halo / scale) lives in the layer style
 * files under the `label` key, read at render time by `labels.ts`.
 *
 * Migrated from the former root `labels.enabled` key (S4). The root `labels`
 * namespace now belongs solely to the i18n override dictionary.
 */
"use strict";

import { Config } from "../../kernel/config/config-primitives.js";

/** Subset of `Config` consumed here (`get` is augmented onto Config at runtime). */
interface ConfigLike {
    get?<T = unknown>(path: string, defaultValue?: T): T;
}
const _Config = Config as ConfigLike;

/** The `modules.labels` capability-level config block. */
export interface LabelsCapabilityConfig {
    /**
     * Capability gate — labels are inert when `false`. Opt-out (`enableWhenAbsent:
     * true`): absent → active, preserving the pre-migration default-on behaviour.
     */
    enabled: boolean;
}

/**
 * Built-in defaults. `enabled` is `true` — labels are opt-out (active unless a
 * profile sets `modules.labels.enabled: false`).
 */
const DEFAULTS: LabelsCapabilityConfig = { enabled: true };

/**
 * Reads `modules.labels.*` from the running core config and merges it over the
 * built-in defaults.
 */
export function getLabelsConfig(): LabelsCapabilityConfig {
    const raw = _Config.get?.<Partial<LabelsCapabilityConfig>>("modules.labels", {}) ?? {};
    return { ...DEFAULTS, ...raw };
}
