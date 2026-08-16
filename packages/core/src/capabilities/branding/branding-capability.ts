/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability declaration for the in-core `branding` capability.
 *
 * Registered in `boot.ts` before the optional module gate so that
 * `GeoLeaf.Introspection.getAllCapabilities()` and `getCapabilitySchema('branding')`
 * work at runtime. Reclassified from `modules/built-in/ui/branding.ts` — a
 * customisable text overlay added to the map as a native control.
 *
 * Config gate: `modules.branding.enabled`. Opt-in (`enableWhenAbsent` omitted →
 * `false`): the overlay is inert unless a profile enables it. Branding is
 * app-global (base `geoleaf.config.json`), so the gate reads correctly at boot
 * (baseCfg is pre-merge but already carries the app-global block). Migrated from
 * the former root `branding` key.
 */

import type { ICapabilityDeclaration } from "../../contracts/capability.contract.js";
import { brandingConfigDefaults } from "./constants.js";

/**
 * The advertised defaults ARE the applied ones: this is the very object
 * `getBrandingConfig()` merges the profile block over, and that seeds
 * `Branding._options` (B.24 — `position` used to be advertised here, absent from the
 * reader, and re-declared a third time in `branding.ts`).
 */
const DEFAULTS = brandingConfigDefaults();

/** In-core capability declaration for the Branding overlay. */
export const BRANDING_CAPABILITY: ICapabilityDeclaration = {
    id: "branding",
    label: "Branding",
    description: "Customisable branding text overlay on the map.",
    gate: {
        configPath: "modules.branding.enabled",
    },
    configSchema: {
        enabled: {
            type: "boolean",
            default: DEFAULTS.enabled,
            description: "Show the branding overlay (opt-in).",
        },
        text: {
            type: "string",
            description: "Text displayed in the branding overlay.",
        },
        position: {
            type: "string",
            default: DEFAULTS.position,
            description: "Overlay position on the map.",
        },
    },
    // No loader: branding is inline (eagerly loaded with the UI bundle). Gated via config.
};
