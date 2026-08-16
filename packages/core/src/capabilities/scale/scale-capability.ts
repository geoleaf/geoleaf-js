/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability declaration for the in-core `scale` capability.
 *
 * Registered in `boot.ts` before the optional module gate so that
 * `GeoLeaf.Introspection.getAllCapabilities()` and `getCapabilitySchema('scale')`
 * work at runtime. Reclassified from `modules/built-in/map/scale-control.ts` — the
 * graphical + numeric scale bar and zoom-level indicator.
 *
 * Config gate: `modules.scale.enabled`. Opt-out (`enableWhenAbsent: true`):
 * profile-level, so the pre-merge boot gate registers the module and the late gate
 * (ScaleLifecycle on `app:ready`, merged config) enforces the real value. Migrated
 * from the former `ui.showScale` flag + `scaleConfig` block. NOTE: the scale/zoom
 * math (`scale-utils.ts` — calculateMapScale/isScaleInRange) stays kernel (shared by
 * the visibility manager + labels); only the control is a capability.
 */

import type { ICapabilityDeclaration } from "../../contracts/capability.contract.js";

/** In-core capability declaration for the scale bar + zoom-level indicator. */
export const SCALE_CAPABILITY: ICapabilityDeclaration = {
    id: "scale",
    label: "Scale",
    description: "Graphical + numeric scale bar and zoom-level indicator.",
    gate: {
        configPath: "modules.scale.enabled",
        enableWhenAbsent: true,
    },
    configSchema: {
        enabled: {
            type: "boolean",
            default: true,
            description: "Show the scale control (opt-out).",
        },
        scaleGraphic: {
            type: "boolean",
            default: true,
            description: "Show the graphical scale bar.",
        },
        scaleNumeric: {
            type: "boolean",
            default: true,
            description: "Show the numeric scale (1:N).",
        },
        scaleNumericEditable: {
            type: "boolean",
            default: true,
            description: "Make the numeric scale editable.",
        },
        scaleNivel: {
            type: "boolean",
            default: true,
            description: "Show the zoom level indicator.",
        },
        position: {
            type: "string",
            default: "bottomleft",
            description: "Control position on the map.",
        },
    },
    // No loader: inline (eager with the UI bundle). Gated via config.
};
