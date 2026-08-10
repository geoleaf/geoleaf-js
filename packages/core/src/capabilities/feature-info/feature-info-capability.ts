/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability declaration for the in-core `feature-info` capability.
 *
 * Registered in `boot.ts` before the optional module gate so that
 * `GeoLeaf.Introspection.getAllCapabilities()` and
 * `getCapabilitySchema('feature-info')` work at runtime. Reclassified from
 * `@geoleaf-plugins/feature-info` (SR0).
 *
 * Config gate: `modules.feature-info.enabled`. `enableWhenAbsent: true` — the
 * capability is opt-out (active unless a profile sets it to `false`), matching
 * the former plugin default (`DEFAULTS.enabled = true`).
 */
"use strict";

import type { ICapabilityDeclaration } from "../../contracts/capability.contract.js";

/** In-core capability declaration for the Feature-Info subsystem. */
export const FEATURE_INFO_CAPABILITY: ICapabilityDeclaration = {
    id: "feature-info",
    label: "Feature Info",
    description:
        "Attribute rendering on feature click/hover: tooltip, popup and side-panel surfaces.",
    gate: { configPath: "modules.feature-info.enabled", enableWhenAbsent: true },
    configSchema: {
        enabled: {
            type: "boolean",
            default: true,
            description: "Enable attribute rendering (tooltip / popup / side-panel) globally.",
        },
    },
    // No loader: feature-info is inline (quasi-universal). Gated via isEnabled().
};
