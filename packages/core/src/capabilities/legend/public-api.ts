/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Legend capability — public API surface.
 *
 * Re-exports the full `Legend` runtime singleton (not a read-only wrapper): the layer
 * manager, the theme applier and integrators all consume `init` / `loadLayerLegend` /
 * `setLayerVisibility` / … through this object. Mounted on `GeoLeaf.Legend` by
 * `api/geoleaf.legend.ts`, which re-exports from HERE — that re-export is watched
 * by the `check:facade-purity` gate and must keep resolving.
 *
 * **Thin by construction (B.28).** This file used to hold the whole runtime — module
 * state, three timers, `fetch()`, DOM writes — 546 lines under a facade's name. The
 * implementation moved to `./legend.ts`, matching `labels/` and `geolocation/`, and
 * `./lifecycle.ts` now imports the implementation directly instead of reaching through
 * this facade (it was the only capability lifecycle doing so).
 */
"use strict";

export { Legend } from "./legend.js";
