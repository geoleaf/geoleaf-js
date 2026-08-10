/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability installer for the in-core `language-switcher` capability.
 * Single self-sufficient anchor (declaration + facade globals + module factory).
 */
"use strict";

// ── Stylesheet ──────────────────────────────────────────────────────────────
// The capability owns its CSS and pulls it into the module graph from HERE: skip the
// installer and the stylesheet is never in the graph either.
import "./css/language-switcher.css";

import type { CapabilityInstaller } from "../../contracts/preset.contract.js";
import { LANGUAGE_SWITCHER_CAPABILITY } from "./language-switcher-capability.js";
import { LanguageSwitcherModule } from "./module.js";
import { LanguageSwitcher } from "../../api/geoleaf.language-switcher.js";

/** Self-sufficient installer for the UI language switcher capability. */
export const LANGUAGE_SWITCHER_INSTALLER: CapabilityInstaller = {
    declaration: LANGUAGE_SWITCHER_CAPABILITY,

    registerGlobals(gl: Record<string, unknown>): void {
        gl.LanguageSwitcher = LanguageSwitcher;
    },

    createModule() {
        return new LanguageSwitcherModule();
    },
};
