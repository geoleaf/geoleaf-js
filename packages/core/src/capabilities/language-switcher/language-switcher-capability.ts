/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability declaration for the in-core `language-switcher` capability.
 *
 * Config gate: `modules.language-switcher.enabled`. `enableWhenAbsent: true` governs
 * *module registration only* (same shape as `theme-toggle` / `profile-switcher`); the
 * *user-facing default is OFF*, enforced late by `LanguageSwitcherLifecycle` on the
 * merged config.
 */
"use strict";

import type { ICapabilityDeclaration } from "../../contracts/capability.contract.js";

/** In-core capability declaration for the UI language switcher. */
export const LANGUAGE_SWITCHER_CAPABILITY: ICapabilityDeclaration = {
    id: "language-switcher",
    label: "Language switcher",
    description: "UI language selector in the desktop tab strip and the mobile toolbar.",
    gate: {
        configPath: "modules.language-switcher.enabled",
        // Registration-only. The button defaults OFF — visibility is gated late.
        enableWhenAbsent: true,
    },
    configSchema: {
        enabled: {
            type: "boolean",
            default: false,
            description: "Show the UI language selector (opt-in).",
        },
        display: {
            type: "string",
            default: "flag",
            description:
                "How each language is rendered: 'flag' (regional emoji) or 'code' (FR, EN…) when the platform does not draw flag emoji.",
        },
        languages: {
            type: "array",
            default: [],
            description:
                "Restricts the offered languages (e.g. ['fr','en']). Empty/absent offers every compiled dictionary.",
        },
    },
    // No loader: inline (eager with the UI bundle). Gated via config.
};
