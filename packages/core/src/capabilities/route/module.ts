/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * RouteModule — `ICoreModule` wrapper for the in-core `route` capability (S11).
 *
 * Thin: delegates to `RouteLifecycle`, which subscribes to `geoleaf:layer:added`
 * / `geoleaf:map:ready` and derives start / end endpoint markers for polyline
 * layers bound via `modules.route.layers`. The line itself is rendered by the
 * GeoJSON engine — the capability only decorates the endpoints.
 *
 * Registered in `boot.ts` when `modules.route.enabled` (opt-in via
 * CapabilityRegistry). Depends on `geojson` only (the source of
 * `geoleaf:layer:added`); NOT `ui`.
 */

import type { ILifecycleModule } from "../../contracts/core-module.contract.ts";
import type { IMapAdapter } from "../../contracts/map-adapter.contract.ts";
import type { IGeoLeafConfig } from "../../contracts/config.contract.ts";
import { RouteLifecycle } from "./lifecycle.js";

/** Represents the GeoLeaf Route capability (itinerary endpoint decoration). */
export class RouteModule implements ILifecycleModule {
    readonly id = "route" as const;
    readonly dependencies = ["geojson"] as const;

    init(_adapter: IMapAdapter, _config: IGeoLeafConfig): void {
        RouteLifecycle.init();
    }

    destroy(): void {
        RouteLifecycle._reset();
    }
}
