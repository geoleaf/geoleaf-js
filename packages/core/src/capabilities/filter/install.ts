/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability installer for the in-core `filter` capability — presets build (S2 Lot 5).
 *
 * Single self-sufficient anchor: importing THIS file is the only thing a preset does to
 * embark Filter. Carries the layer-B write moved out of `globals.api.ts`
 * (`assignApiFacades`, B11): `Filter` — the capability facade (generic panel, permalink
 * contract).
 *
 * API publique S4.5 — `Filters` (plural) is GONE. It carried one method,
 * `filterRouteList`, which had zero caller anywhere in the repo outside its own
 * definition, and its one-letter distance from `Filter` (8 members, 5 runtime readers,
 * a permalink serialisation contract) was an integration trap: the typed one was not on
 * the ESM root entry, the untyped one was. Removing it took the route-filter engine and
 * its contributor seam with it — `GeoLeaf.Filters` was their only reachable caller.
 */

// ── Stylesheet (S6) ─────────────────────────────────────────────────────────
// The capability owns its CSS and pulls it into the module graph from HERE — the one module
// a consumer must import to get this capability at all. Skip the installer and the stylesheet
// is never in the graph either: the CSS tree-shakes with the code.
import "./css/filter-panel.css";
import "./css/filter-controls.css";
import "./css/filter-pill-search.css";

import type { CapabilityInstaller } from "../../contracts/preset.contract.js";
import { FILTER_CAPABILITY } from "./filter-capability.js";
// The boot wrapper now lives INSIDE this capability (backlog R.10) — no app/ path,
// no exception, and the ICoreModule lifecycle is co-located with what it drives.
import { FilterModule } from "./module.js";
import { Filter } from "../../api/geoleaf.filter.js";

/** Self-sufficient installer for the Filter capability (generic filter panel + engine). */
export const FILTER_INSTALLER: CapabilityInstaller = {
    declaration: FILTER_CAPABILITY,

    registerGlobals(gl: Record<string, unknown>): void {
        // Layer B — moved verbatim from globals.api.ts (assignApiFacades, B11).
        gl.Filter = Filter;
    },

    createModule() {
        return new FilterModule();
    },
};
