/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * LabelsModule — `ICoreModule` wrapper for the in-core Labels capability.
 *
 * Represents: `GeoLeaf.Labels` (per-layer text labels on map features).
 * Reclassified to `capabilities/labels/` (S4, migrated from `modules/optional/labels`).
 *
 * Registered conditionally in `boot.ts` when `modules.labels.enabled` is set
 * (opt-out). `init()` wires the capability lifecycle (Labels init + the
 * `geoleaf:layer-item:controls` button seam); `destroy()` tears it down.
 */

import type { ILifecycleModule } from "../../contracts/core-module.contract.ts";
import type { IMapAdapter } from "../../contracts/map-adapter.contract.ts";
import type { IGeoLeafConfig } from "../../contracts/config.contract.ts";
import { LabelsLifecycle } from "./lifecycle.js";

/**
 * Represents the GeoLeaf Labels subsystem (per-layer map feature labels).
 * Depends on `geojson` (the layers it labels + the events it listens to).
 */
export class LabelsModule implements ILifecycleModule {
    readonly id = "labels" as const;
    readonly dependencies = ["geojson"] as const;

    init(_adapter: IMapAdapter, _config: IGeoLeafConfig): void {
        LabelsLifecycle.init();
    }

    destroy(): void {
        LabelsLifecycle._reset();
    }
}
