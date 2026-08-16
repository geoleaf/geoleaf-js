/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * FeatureInfoModule — `ICoreModule` wrapper for the in-core Feature-Info capability.
 *
 * Represents: `GeoLeaf.FeatureInfo` (attribute rendering — tooltip / popup /
 * side-panel). Reclassified from `@geoleaf-plugins/feature-info` (SR0).
 *
 * Registered conditionally in `boot.ts` when `modules.feature-info.enabled` is
 * not `false`. `init()` wires the capability lifecycle (the
 * `geoleaf:feature:click/hover` seam listeners); `destroy()` detaches them and
 * tears down the surfaces.
 *
 * Note: the former plugin registered an i18n dict via `GeoLeaf.I18n.registerDict`,
 * but the `GeoLeaf.I18n.t` read seam was never mounted (`globals.core.ts` exposes
 * only `{ registerDict, getLabel }`), so that dict was never read — the renderer
 * always used its inline fallback strings. The dead dict wiring is dropped here;
 * rendering output is byte-identical.
 */

import type { ILifecycleModule } from "../../contracts/core-module.contract.ts";
import type { IMapAdapter } from "../../contracts/map-adapter.contract.ts";
import type { IGeoLeafConfig } from "../../contracts/config.contract.ts";
import { FeatureInfoLifecycle } from "./lifecycle.js";

/**
 * Represents the GeoLeaf Feature-Info subsystem (attribute rendering surfaces).
 * Depends on `geojson` (emitter of the `geoleaf:feature:click/hover` seam).
 */
export class FeatureInfoModule implements ILifecycleModule {
    readonly id = "feature-info" as const;
    readonly dependencies = ["geojson"] as const;

    init(_adapter: IMapAdapter, _config: IGeoLeafConfig): void {
        FeatureInfoLifecycle.init();
    }

    destroy(): void {
        FeatureInfoLifecycle._reset();
    }
}
