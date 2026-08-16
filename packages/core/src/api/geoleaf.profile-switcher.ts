/*!
 * GeoLeaf Core - ProfileSwitcher (public facade)
 * Released under the MIT License
 * © 2026 Mattieu Pottier
 * https://geoleaf.dev
 */

/**
 *
 * Public `GeoLeaf.ProfileSwitcher` facade — data-profile selector rendered at the top
 * of the layer manager. In-core capability, mounted by its installer.
 *
 * Opt-in: inert unless `modules.profile-switcher.enabled` is `true` AND at least two
 * profiles were harvested into `data.availableProfiles` at deploy time.
 */

import {
    buildPublicApi,
    type ProfileSwitcherPublicApi,
} from "../capabilities/profile-switcher/public-api.js";

/** The object mounted on `GeoLeaf.ProfileSwitcher`. */
export const ProfileSwitcher: ProfileSwitcherPublicApi = buildPublicApi();
