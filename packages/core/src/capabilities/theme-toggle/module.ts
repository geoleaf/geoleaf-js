/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * ThemeToggleModule — `ICoreModule` wrapper for the in-core theme-toggle capability.
 *
 * Represents: `GeoLeaf.ThemeToggle` (light/dark theme toggle button).
 * Reclassified to `capabilities/theme-toggle/` (migrated from
 * `modules/built-in/ui/control-theme-toggle.ts`).
 *
 * Registered conditionally in `boot.ts` (opt-out registration gate — profile-level).
 * `init()` runs post-merge, so the lifecycle reads the merged config and mounts the
 * button only when `modules.theme-toggle.enabled === true` (default OFF, opt-in).
 */
"use strict";

import type { ILifecycleModule } from "../../contracts/core-module.contract.ts";
import type { IMapAdapter } from "../../contracts/map-adapter.contract.ts";
import type { IGeoLeafConfig } from "../../contracts/config.contract.ts";
import { ThemeToggleLifecycle } from "./lifecycle.js";

/**
 * Represents the GeoLeaf light/dark theme toggle button.
 * Depends on `geojson` (mounts after the map; the theme engine is kernel-global).
 */
export class ThemeToggleModule implements ILifecycleModule {
    readonly id = "theme-toggle" as const;
    readonly dependencies = ["geojson"] as const;

    init(adapter: IMapAdapter, _config: IGeoLeafConfig): void {
        // The boot-created MaplibreAdapter is the live map (addControl available).
        ThemeToggleLifecycle.init(adapter);
    }

    destroy(): void {
        ThemeToggleLifecycle._reset();
    }
}
