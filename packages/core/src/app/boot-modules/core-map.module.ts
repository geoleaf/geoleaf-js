/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * CoreMapModule — `ICoreModule` wrapper for the runtime core.
 *
 * S1.2: owns map creation (#3 permalink, #5 GeoLeaf.init). Stores cross-module state on
 * `GeoLeaf._app` for UIModule to consume.
 *
 * The behaviour lives in {@link CoreMapLifecycle}: this file is registry glue, like the
 * other 18 `ICoreModule` wrappers. Until R.42 it was the exception — `init()` carried
 * ~148 lines orchestrating seven responsibilities under a `complexity` /
 * `max-lines-per-function` disable, the only such disable among the 19 wrappers. The
 * extraction is graph-preserving on purpose: `id` and `dependencies` are unchanged, so
 * the boot graph and `boot-sequence-order` are untouched.
 */
"use strict";

import type { ILifecycleModule } from "../../contracts/core-module.contract.ts";
import type { IMapAdapter } from "../../contracts/map-adapter.contract.ts";
import type { IGeoLeafConfig } from "../../contracts/config.contract.ts";
import { CoreMapLifecycle } from "./core-map-lifecycle.js";

/**
 * Represents the GeoLeaf runtime core: logging, error classes, constants,
 * utilities, AND the MapLibre map instance (S1.2+). Must init after `security`
 * (sanitization) and `config` (profile data).
 */
export class CoreMapModule implements ILifecycleModule {
    readonly id = "core-map" as const;
    // S6 Lot 6: `security` pruned with SecurityModule (facade-only, ordered by the ESM chain).
    readonly dependencies = ["config"] as const;

    init(adapter: IMapAdapter, config: IGeoLeafConfig): void {
        CoreMapLifecycle.init(adapter, config);
    }

    destroy(): void {
        CoreMapLifecycle._reset();
    }
}
