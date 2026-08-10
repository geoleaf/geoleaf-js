/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Profile-switcher capability — config reader.
 *
 * Reads two unrelated things, on purpose:
 *   - `modules.profile-switcher.*` — how the selector behaves (opt-in gate);
 *   - `data.availableProfiles` — WHICH profiles exist, harvested at deploy time by
 *     `scripts/build-deploy.cjs` (a browser cannot enumerate a server directory).
 *
 * Opt-in: the selector is inert unless the merged config sets
 * `modules.profile-switcher.enabled: true` (real default OFF, enforced by the
 * lifecycle's late gate).
 */
"use strict";

import { Config } from "../../kernel/config/config-primitives.js";
import type { AvailableProfileEntry } from "../../kernel/config/geoleaf-config/config-types.js";

/** Subset of `Config` consumed here (`get` is augmented onto Config at runtime). */
interface ConfigLike {
    get?<T = unknown>(path: string, defaultValue?: T): T;
}
const _Config = Config as ConfigLike;

/** The `modules.profile-switcher` capability config block. */
export interface ProfileSwitcherCapabilityConfig {
    /** Capability gate — the selector is inert unless `true`. Opt-in (default OFF). */
    enabled: boolean;
}

/** Built-in defaults. `enabled` is `false` — the switcher is opt-in. */
const DEFAULTS: ProfileSwitcherCapabilityConfig = { enabled: false };

/**
 * Reads `modules.profile-switcher.*` from the running core config and merges it over
 * the built-in defaults.
 */
export function getProfileSwitcherConfig(): ProfileSwitcherCapabilityConfig {
    const raw =
        _Config.get?.<Partial<ProfileSwitcherCapabilityConfig>>("modules.profile-switcher", {}) ??
        {};
    return { ...DEFAULTS, ...raw };
}

/**
 * Returns the profiles offered by the switcher, as harvested into
 * `data.availableProfiles` at deploy time.
 *
 * Returns `[]` when the key is absent (app served straight from sources, no deploy
 * step) or malformed — the caller then renders nothing, which is the intended
 * degradation rather than an error.
 */
export function getAvailableProfiles(): AvailableProfileEntry[] {
    const raw = _Config.get?.<unknown>("data.availableProfiles", []) ?? [];
    if (!Array.isArray(raw)) return [];
    // Defensive: the list is generated, but it lands in a JSON an integrator can edit.
    return raw.filter(
        (e): e is AvailableProfileEntry =>
            !!e &&
            typeof e === "object" &&
            typeof (e as AvailableProfileEntry).id === "string" &&
            (e as AvailableProfileEntry).id.length > 0
    );
}
