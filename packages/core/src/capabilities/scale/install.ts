/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability installer for the in-core `scale` capability — presets build (S2).
 * Single self-sufficient anchor (declaration + facade globals + module factory).
 * Profile-level, opt-out. NB: `scale-utils` (zoom/scale math) stays kernel.
 */

// ── Stylesheet (S6) ─────────────────────────────────────────────────────────
// The capability owns its CSS and pulls it into the module graph from HERE — the one module
// a consumer must import to get this capability at all. Skip the installer and the stylesheet
// is never in the graph either: the CSS tree-shakes with the code.
import "./css/scale.css";

import type { CapabilityInstaller } from "../../contracts/preset.contract.js";
import { SCALE_CAPABILITY } from "./scale-capability.js";
// The boot wrapper now lives INSIDE this capability (backlog R.10) — no app/ path,
// no exception, and the ICoreModule lifecycle is co-located with what it drives.
import { ScaleModule } from "./module.js";
import { Scale } from "../../api/geoleaf.scale.js";

/** Self-sufficient installer for the map Scale control capability. */
export const SCALE_INSTALLER: CapabilityInstaller = {
    declaration: SCALE_CAPABILITY,

    registerGlobals(gl: Record<string, unknown>): void {
        // Layer B — moved verbatim from globals.ui.ts (setupUI, B9).
        gl.Scale = Scale;
    },

    createModule() {
        return new ScaleModule();
    },
};
