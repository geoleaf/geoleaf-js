/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * CoordinatesModule — `ICoreModule` wrapper for the in-core Coordinates capability.
 *
 * Represents: `GeoLeaf.Coordinates` (real-time cursor coordinates readout).
 * Reclassified to `capabilities/coordinates/` (migrated from
 * `modules/built-in/ui/coordinates-display.ts`).
 *
 * Registered conditionally in `boot.ts` when `modules.coordinates.enabled` is not
 * `false` (opt-out). `init()` captures the boot-created map adapter and wires the
 * capability lifecycle (which mounts the readout on `geoleaf:app:ready`);
 * `destroy()` tears it down.
 */

import type { ILifecycleModule } from "../../contracts/core-module.contract.ts";
import type { IMapAdapter } from "../../contracts/map-adapter.contract.ts";
import type { IGeoLeafConfig } from "../../contracts/config.contract.ts";
import { CoordinatesLifecycle } from "./lifecycle.js";
import type { CoordinatesMapLike } from "./types.js";

/**
 * Represents the GeoLeaf Coordinates readout (cursor lat/lng on the map).
 * Depends on `geojson` so the `app:ready` subscription runs before the event fires.
 */
export class CoordinatesModule implements ILifecycleModule {
    readonly id = "coordinates" as const;
    readonly dependencies = ["geojson"] as const;

    init(adapter: IMapAdapter, _config: IGeoLeafConfig): void {
        // The boot-created MaplibreAdapter is the live map (same instance as
        // `_app._currentMap`); the lifecycle uses it at `app:ready` mount time.
        CoordinatesLifecycle.init(adapter as unknown as CoordinatesMapLike);
    }

    destroy(): void {
        CoordinatesLifecycle._reset();
    }
}
