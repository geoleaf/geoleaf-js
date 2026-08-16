/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * ProfileSwitcherModule — `ICoreModule` wrapper for the in-core profile-switcher
 * capability.
 *
 * Represents: `GeoLeaf.ProfileSwitcher` (data-profile selector at the top of the layer
 * manager). Registered by the preset manifest when `modules.profile-switcher.enabled`
 * is not `false`; the real opt-in gate is applied late, by the lifecycle, on the merged
 * config.
 *
 * Depends on `geojson` so `init()` runs before the layer manager's panel seam can fire
 * for the first time.
 */

import type { ILifecycleModule } from "../../contracts/core-module.contract.ts";
import type { IMapAdapter } from "../../contracts/map-adapter.contract.ts";
import type { IGeoLeafConfig } from "../../contracts/config.contract.ts";
import { ProfileSwitcherLifecycle } from "./lifecycle.js";

/** Represents the GeoLeaf data-profile switcher. */
export class ProfileSwitcherModule implements ILifecycleModule {
    readonly id = "profile-switcher" as const;
    readonly dependencies = ["geojson"] as const;

    init(_adapter: IMapAdapter, _config: IGeoLeafConfig): void {
        // No map handle needed: the control lives in the layer manager panel, reached
        // through the kernel seam.
        ProfileSwitcherLifecycle.init();
    }

    destroy(): void {
        ProfileSwitcherLifecycle._reset();
    }
}
