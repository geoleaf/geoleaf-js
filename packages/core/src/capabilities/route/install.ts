/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability installer for the in-core `route` capability — presets build (S2 Lot 5).
 *
 * Single self-sufficient anchor: importing THIS file is the only thing a preset does to
 * embark Route. Route owns **no layer B** (its namespace facade was dissolved in S11 —
 * the capability is driven entirely by `modules.route.*` config + its lifecycle), so
 * `registerGlobals` is intentionally empty: the contract requires the method, not a write.
 *
 * API publique S4.5 — this installer used to carry a second thing: the route-filter
 * contribution. It pushed `filterRouteList` into a seam under `capabilities/filter/filters/`
 * at import time, so that `GeoLeaf.Filters.filterRouteList()` worked whenever a preset
 * embarked route. That whole chain is gone with `GeoLeaf.Filters`, which was its only
 * reachable caller: install → `registerRouteFilter` → `getRouteFilter` → the barrel.
 * Cutting the barrel left the other three links with no reader at all, so they went too.
 * The installer now carries only its module — which is what its own doc above already said.
 */
"use strict";

import type { CapabilityInstaller } from "../../contracts/preset.contract.js";
import { ROUTE_CAPABILITY } from "./route-capability.js";
// The boot wrapper now lives INSIDE this capability (backlog R.10) — no app/ path,
// no exception, and the ICoreModule lifecycle is co-located with what it drives.
import { RouteModule } from "./module.js";

/** Self-sufficient installer for the Route capability (itinerary endpoint decoration). */
export const ROUTE_INSTALLER: CapabilityInstaller = {
    declaration: ROUTE_CAPABILITY,

    registerGlobals(): void {
        // No layer B — the namespace facade was dissolved in S11 (see the module doc).
    },

    createModule() {
        return new RouteModule();
    },
};
