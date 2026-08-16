/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability declaration for the in-core `geolocation` capability.
 *
 * Registered in `boot.ts` before the optional module gate so that
 * `GeoLeaf.Introspection.getAllCapabilities()` and `getCapabilitySchema('geolocation')`
 * work at runtime. Reclassified from `modules/built-in/ui/control-geolocation.ts` —
 * the GPS button (user marker + accuracy circle + recenter).
 *
 * Config gate: `modules.geolocation.enabled`. Opt-out (`enableWhenAbsent: true`):
 * profile-level, so the pre-merge boot gate registers the module and the late gate
 * (GeolocationLifecycle, merged config at registry.init) enforces the real value.
 * Migrated from the former `ui.showGeolocation` flag. The GPS state singleton is
 * exposed via `GeoLeaf.Geolocation.getState()` for external consumers.
 */

import type { ICapabilityDeclaration } from "../../contracts/capability.contract.js";

/** In-core capability declaration for the geolocation (GPS) control. */
export const GEOLOCATION_CAPABILITY: ICapabilityDeclaration = {
    id: "geolocation",
    label: "Geolocation",
    description: "GPS button — center the map on the user's position (marker + accuracy circle).",
    gate: {
        configPath: "modules.geolocation.enabled",
        enableWhenAbsent: true,
    },
    configSchema: {
        enabled: {
            type: "boolean",
            default: true,
            description: "Show the geolocation (GPS) button (opt-out).",
        },
        position: {
            type: "string",
            default: "topleft",
            description: "Button position on the map.",
        },
    },
    // No loader: inline (eager with the UI bundle). Gated via config.
};
