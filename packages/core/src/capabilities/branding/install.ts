/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability installer for the in-core `branding` capability — presets build (S2).
 * Single self-sufficient anchor (declaration + facade globals + module factory).
 * App-global, opt-in (`modules.branding.enabled === true`).
 */

// ── Stylesheet (S6) ─────────────────────────────────────────────────────────
// The capability owns its CSS and pulls it into the module graph from HERE — the one module
// a consumer must import to get this capability at all. Skip the installer and the stylesheet
// is never in the graph either: the CSS tree-shakes with the code.
import "./css/branding.css";

import type { CapabilityInstaller } from "../../contracts/preset.contract.js";
import { BRANDING_CAPABILITY } from "./branding-capability.js";
// The boot wrapper now lives INSIDE this capability (backlog R.10) — no app/ path,
// no exception, and the ICoreModule lifecycle is co-located with what it drives.
import { BrandingModule } from "./module.js";
import { Branding } from "../../api/geoleaf.branding.js";

/** Self-sufficient installer for the Branding overlay capability. */
export const BRANDING_INSTALLER: CapabilityInstaller = {
    declaration: BRANDING_CAPABILITY,

    registerGlobals(gl: Record<string, unknown>): void {
        // Layer B — moved verbatim from globals.ui.ts (setupUI, B9).
        gl.Branding = Branding;
    },

    createModule() {
        return new BrandingModule();
    },
};
