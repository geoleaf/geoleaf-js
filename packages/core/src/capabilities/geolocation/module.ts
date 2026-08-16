/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeolocationModule — `ICoreModule` wrapper for the in-core geolocation capability.
 *
 * Represents: `GeoLeaf.Geolocation` (GPS button + state seam).
 * Reclassified to `capabilities/geolocation/` (migrated from
 * `modules/built-in/ui/control-geolocation.ts`).
 *
 * Registered conditionally in `boot.ts` when `modules.geolocation.enabled` is not
 * `false` (opt-out). `init()` runs post-merge, so the lifecycle reads the merged
 * config and mounts the control synchronously (mirroring the former
 * `ui-api._initMapControls` timing); `destroy()` tears it down.
 */

import type { ILifecycleModule } from "../../contracts/core-module.contract.ts";
import type { IMapAdapter } from "../../contracts/map-adapter.contract.ts";
import type { IGeoLeafConfig } from "../../contracts/config.contract.ts";
import { GeolocationLifecycle } from "./lifecycle.js";

/**
 * Represents the GeoLeaf geolocation (GPS) control.
 * Depends on `geojson` (mounts after the map + layers; toolbar delegates clicks to it).
 */
export class GeolocationModule implements ILifecycleModule {
    readonly id = "geolocation" as const;
    readonly dependencies = ["geojson"] as const;

    init(adapter: IMapAdapter, _config: IGeoLeafConfig): void {
        // The boot-created MaplibreAdapter is the live map (addControl/createMarker/…).
        GeolocationLifecycle.init(adapter);
    }

    destroy(): void {
        GeolocationLifecycle._reset();
    }
}
