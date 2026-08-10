/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * BrandingModule — `ICoreModule` wrapper for the in-core Branding capability.
 *
 * Represents: `GeoLeaf.Branding` (customisable branding text overlay).
 * Reclassified to `capabilities/branding/` (migrated from `modules/built-in/ui/branding.ts`).
 *
 * Registered conditionally in `boot.ts` when `modules.branding.enabled` is truthy
 * (opt-in, app-global). `init()` mounts the overlay via the capability lifecycle,
 * passing the boot-created map adapter; `destroy()` tears it down.
 */
"use strict";

import type { ILifecycleModule } from "../../contracts/core-module.contract.ts";
import type { IMapAdapter } from "../../contracts/map-adapter.contract.ts";
import type { IGeoLeafConfig } from "../../contracts/config.contract.ts";
import { BrandingLifecycle } from "./lifecycle.js";
import type { BrandingMapLike } from "./types.js";

/**
 * Represents the GeoLeaf Branding overlay (customisable map text control).
 * Depends on `geojson` (mounts after the map + layers, matching the former #21 timing).
 */
export class BrandingModule implements ILifecycleModule {
    readonly id = "branding" as const;
    readonly dependencies = ["geojson"] as const;

    init(adapter: IMapAdapter, _config: IGeoLeafConfig): void {
        // The boot-created MaplibreAdapter is the live map (same instance as
        // `_app._currentMap`); it exposes `addControl` used by the overlay.
        BrandingLifecycle.init(adapter as unknown as BrandingMapLike);
    }

    destroy(): void {
        BrandingLifecycle._reset();
    }
}
