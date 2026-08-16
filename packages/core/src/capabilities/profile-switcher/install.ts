/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability installer for the in-core `profile-switcher` capability.
 * Single self-sufficient anchor (declaration + facade globals + module factory).
 */

// ── Stylesheet ──────────────────────────────────────────────────────────────
// The capability owns its CSS and pulls it into the module graph from HERE — the one
// module a consumer must import to get this capability at all. Skip the installer and
// the stylesheet is never in the graph either: the CSS tree-shakes with the code.
import "./css/profile-switcher.css";

import type { CapabilityInstaller } from "../../contracts/preset.contract.js";
import { PROFILE_SWITCHER_CAPABILITY } from "./profile-switcher-capability.js";
import { ProfileSwitcherModule } from "./module.js";
import { ProfileSwitcher } from "../../api/geoleaf.profile-switcher.js";

/** Self-sufficient installer for the data-profile switcher capability. */
export const PROFILE_SWITCHER_INSTALLER: CapabilityInstaller = {
    declaration: PROFILE_SWITCHER_CAPABILITY,

    registerGlobals(gl: Record<string, unknown>): void {
        gl.ProfileSwitcher = ProfileSwitcher;
    },

    createModule() {
        return new ProfileSwitcherModule();
    },
};
