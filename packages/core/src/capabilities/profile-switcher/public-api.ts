/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Profile-switcher capability — public API surface.
 *
 * Mounted on `GeoLeaf.ProfileSwitcher` via `api/geoleaf.profile-switcher.ts`.
 */
"use strict";

import {
    getAvailableProfiles,
    getProfileSwitcherConfig,
    type ProfileSwitcherCapabilityConfig,
} from "./config.js";
import { switchToProfile } from "./profile-switch.js";
import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";
import type { AvailableProfileEntry } from "../../kernel/config/geoleaf-config/config-types.js";

/** The object mounted on `GeoLeaf.ProfileSwitcher`. */
export interface ProfileSwitcherPublicApi {
    /** Profiles offered by the switcher (empty when none were harvested at build). */
    list(): AvailableProfileEntry[];
    /** Active profile id, or `null` before the config has loaded. */
    current(): string | null;
    /** Persists the choice and reloads onto that profile. */
    switchTo(id: string): void;
    /** `true` when the selector is enabled (`modules.profile-switcher.enabled === true`). */
    isEnabled(): boolean;
    /** The resolved `modules.profile-switcher` config (merged over the built-in defaults). */
    getConfig(): ProfileSwitcherCapabilityConfig;
}

/** Builds the object mounted on `GeoLeaf.ProfileSwitcher`. */
export function buildPublicApi(): ProfileSwitcherPublicApi {
    return {
        list: (): AvailableProfileEntry[] => getAvailableProfiles(),
        current: (): string | null => {
            const config = getGeoLeaf()?.Config as
                | { getActiveProfileId?: () => unknown }
                | undefined;
            const id =
                typeof config?.getActiveProfileId === "function"
                    ? config.getActiveProfileId()
                    : null;
            return typeof id === "string" && id ? id : null;
        },
        switchTo: (id: string): void => switchToProfile(id),
        isEnabled: (): boolean => getProfileSwitcherConfig().enabled === true,
        getConfig: (): ProfileSwitcherCapabilityConfig => getProfileSwitcherConfig(),
    };
}
