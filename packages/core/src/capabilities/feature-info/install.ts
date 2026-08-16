/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability installer for the in-core `feature-info` capability — presets build (S2).
 *
 * Single self-sufficient anchor: importing THIS file is the only thing a preset does
 * to embark Feature-Info (declaration + facade globals + module factory). The
 * `GeoLeaf.FeatureInfo` write moved out of `globals.api.ts` (`assignApiFacades`).
 */

// ── Stylesheet (S6) ─────────────────────────────────────────────────────────
// The capability owns its CSS and pulls it into the module graph from HERE — the one module
// a consumer must import to get this capability at all. Skip the installer and the stylesheet
// is never in the graph either: the CSS tree-shakes with the code.
import "./css/feature-info-popup.css";
import "./css/feature-info-sidepanel.css";
// `feature-info-gallery.css` IS `poi-accordion-gallery.css` + `poi-lightbox.css`: the two
// were byte-identical concatenations of it and were loaded alongside it, so every rule
// shipped twice (visible as duplicate blocks in `geoleaf-main.min.css`). Removed in S9.
// Neither jscpd (TS/JS only) nor purgecss (both copies were referenced) could see it.
import "./css/feature-info-gallery.css";
import "./css/feature-info-overrides.css";
import "./css/feature-info-tooltip.css";

import type { CapabilityInstaller } from "../../contracts/preset.contract.js";
import { FEATURE_INFO_CAPABILITY } from "./feature-info-capability.js";
// The boot wrapper now lives INSIDE this capability (backlog R.10) — no app/ path,
// no exception, and the ICoreModule lifecycle is co-located with what it drives.
import { FeatureInfoModule } from "./module.js";
import { FeatureInfo } from "../../api/geoleaf.featureinfo.js";

/** Self-sufficient installer for the Feature-Info capability (attribute rendering). */
export const FEATURE_INFO_INSTALLER: CapabilityInstaller = {
    declaration: FEATURE_INFO_CAPABILITY,

    registerGlobals(gl: Record<string, unknown>): void {
        // Layer B — moved verbatim from globals.api.ts (assignApiFacades, B11).
        gl.FeatureInfo = FeatureInfo;
    },

    createModule() {
        return new FeatureInfoModule();
    },
};
