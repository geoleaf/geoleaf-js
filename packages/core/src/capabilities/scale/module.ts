/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * ScaleModule — `ICoreModule` wrapper for the in-core Scale capability.
 *
 * Represents: `GeoLeaf.Scale` (graphical + numeric scale bar + zoom-level indicator).
 * Reclassified to `capabilities/scale/` (migrated from
 * `modules/built-in/map/scale-control.ts`).
 *
 * Registered conditionally in `boot.ts` when `modules.scale.enabled` is not `false`
 * (opt-out). `init()` captures the boot-created map adapter and wires the capability
 * lifecycle (which mounts the control on `geoleaf:app:ready`); `destroy()` tears it down.
 */

import type { ILifecycleModule } from "../../contracts/core-module.contract.ts";
import type { IMapAdapter } from "../../contracts/map-adapter.contract.ts";
import type { IGeoLeafConfig } from "../../contracts/config.contract.ts";
import { ScaleLifecycle } from "./lifecycle.js";
import type { ScaleMapLike } from "./scale-control.js";

/**
 * Represents the GeoLeaf Scale control (scale bar + zoom-level indicator).
 * Depends on `geojson` so the `app:ready` subscription runs before the event fires.
 */
export class ScaleModule implements ILifecycleModule {
    readonly id = "scale" as const;
    readonly dependencies = ["geojson"] as const;

    init(adapter: IMapAdapter, _config: IGeoLeafConfig): void {
        // The boot-created MaplibreAdapter is the live map; the lifecycle uses it at
        // `app:ready` mount time.
        ScaleLifecycle.init(adapter as unknown as ScaleMapLike);
    }

    destroy(): void {
        ScaleLifecycle._reset();
    }
}
