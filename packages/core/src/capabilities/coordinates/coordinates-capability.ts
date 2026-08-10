/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability declaration for the in-core `coordinates` capability.
 *
 * Registered in `boot.ts` before the optional module gate so that
 * `GeoLeaf.Introspection.getAllCapabilities()` and `getCapabilitySchema('coordinates')`
 * work at runtime. Reclassified from `modules/built-in/ui/coordinates-display.ts` —
 * a real-time cursor coordinates readout that docks onto the scale control.
 *
 * Config gate: `modules.coordinates.enabled`. Opt-out (`enableWhenAbsent: true`):
 * profile-level, so the pre-merge boot gate registers the module and the late gate
 * (CoordinatesLifecycle on `app:ready`, merged config) enforces the real value.
 * Migrated from the former `ui.showCoordinates` flag.
 */
"use strict";

import type { ICapabilityDeclaration } from "../../contracts/capability.contract.js";
import { DEFAULT_COORDINATES_DECIMALS } from "./constants.js";

/** In-core capability declaration for the cursor coordinates readout. */
export const COORDINATES_CAPABILITY: ICapabilityDeclaration = {
    id: "coordinates",
    label: "Coordinates",
    description: "Real-time cursor coordinates readout on the map.",
    gate: {
        configPath: "modules.coordinates.enabled",
        enableWhenAbsent: true,
    },
    configSchema: {
        enabled: {
            type: "boolean",
            default: true,
            description: "Show the cursor coordinates readout (opt-out).",
        },
        position: {
            type: "string",
            default: "bottomleft",
            description: "Control position on the map (standalone fallback).",
        },
        decimals: {
            type: "number",
            default: DEFAULT_COORDINATES_DECIMALS,
            description: "Number of decimals shown for latitude / longitude.",
        },
    },
    // No loader: inline (eager with the UI bundle). Gated via config.
};
