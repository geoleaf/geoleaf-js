/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * FilterModule — `ICoreModule` wrapper for the in-core Filter capability.
 *
 * Represents: `GeoLeaf.Filter` (generic attribute filter panel). Registered
 * conditionally in `boot.ts` when `modules.filter.enabled` (opt-out). `init()`
 * wires the capability lifecycle (panel mount on `geoleaf:app:ready` + apply/reset
 * + consumer shims); `destroy()` tears it down.
 *
 * Depends on `geojson` (the layers it filters + the data it reads at mount).
 */

import type { ILifecycleModule } from "../../contracts/core-module.contract.ts";
import type { IMapAdapter } from "../../contracts/map-adapter.contract.ts";
import type { IGeoLeafConfig } from "../../contracts/config.contract.ts";
import { FilterLifecycle } from "./lifecycle.js";

/**
 * Represents the GeoLeaf Filter subsystem (generic attribute filter panel).
 * Depends on `geojson` (the layers it filters + the data it reads at mount).
 */
export class FilterModule implements ILifecycleModule {
    readonly id = "filter" as const;
    readonly dependencies = ["geojson"] as const;

    init(_adapter: IMapAdapter, _config: IGeoLeafConfig): void {
        FilterLifecycle.init();
    }

    destroy(): void {
        FilterLifecycle._reset();
    }
}
