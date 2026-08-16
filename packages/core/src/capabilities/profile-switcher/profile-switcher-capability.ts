/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability declaration for the in-core `profile-switcher` capability.
 *
 * Registered by the preset manifest before the optional module gate so that
 * `GeoLeaf.Introspection.getAllCapabilities()` and
 * `getCapabilitySchema('profile-switcher')` work at runtime.
 *
 * Config gate: `modules.profile-switcher.enabled`. `enableWhenAbsent: true` governs
 * *module registration only* — the same shape as `theme-toggle`: the block may live in
 * a profile, so the pre-merge boot gate has to register the module to allow a late
 * opt-in. The *user-facing default is OFF*: the selector appears only when the merged
 * `modules.profile-switcher.enabled === true` (enforced by `ProfileSwitcherLifecycle`,
 * with `getProfileSwitcherConfig().enabled` defaulting to `false`).
 */

import type { ICapabilityDeclaration } from "../../contracts/capability.contract.js";

/** In-core capability declaration for the data-profile switcher. */
export const PROFILE_SWITCHER_CAPABILITY: ICapabilityDeclaration = {
    id: "profile-switcher",
    label: "Profile switcher",
    description: "Data-profile selector at the top of the layer manager.",
    gate: {
        configPath: "modules.profile-switcher.enabled",
        // Registration-only. The selector defaults OFF — visibility is gated late on
        // the merged config (opt-in).
        enableWhenAbsent: true,
    },
    configSchema: {
        enabled: {
            type: "boolean",
            default: false,
            description:
                "Show the data-profile selector (opt-in). Requires at least 2 profiles in data.availableProfiles.",
        },
    },
    // No loader: inline (eager with the UI bundle). Gated via config.
};
