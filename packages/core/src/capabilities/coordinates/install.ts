/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability installer for the in-core `coordinates` capability — presets build (S2).
 * Single self-sufficient anchor (declaration + facade globals + module factory).
 * Profile-level, opt-out.
 */
"use strict";

// ── Stylesheet (S6) ─────────────────────────────────────────────────────────
// The capability owns its CSS and pulls it into the module graph from HERE — the one module
// a consumer must import to get this capability at all. Skip the installer and the stylesheet
// is never in the graph either: the CSS tree-shakes with the code.
import "./css/coordinates.css";

import type { CapabilityInstaller } from "../../contracts/preset.contract.js";
import { COORDINATES_CAPABILITY } from "./coordinates-capability.js";
// The boot wrapper now lives INSIDE this capability (backlog R.10) — no app/ path,
// no exception, and the ICoreModule lifecycle is co-located with what it drives.
import { CoordinatesModule } from "./module.js";
import { Coordinates } from "../../api/geoleaf.coordinates.js";

/** Self-sufficient installer for the Coordinates readout capability. */
export const COORDINATES_INSTALLER: CapabilityInstaller = {
    declaration: COORDINATES_CAPABILITY,

    registerGlobals(gl: Record<string, unknown>): void {
        // Layer B — moved verbatim from globals.ui.ts (setupUI, B9).
        gl.Coordinates = Coordinates;
    },

    createModule() {
        return new CoordinatesModule();
    },
};
