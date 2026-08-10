/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability declaration for the in-core `labels` capability.
 *
 * Registered in `boot.ts` before the optional module gate so that
 * `GeoLeaf.Introspection.getAllCapabilities()` and `getCapabilitySchema('labels')`
 * work at runtime. Reclassified to `capabilities/labels/` (S4) — per-layer text
 * labels rendered as a native MapLibre `symbol` layer.
 *
 * Config gate: `modules.labels.enabled`. `enableWhenAbsent: true` — opt-out
 * (active unless a profile sets it to `false`), preserving the pre-migration
 * default-on behaviour. Migrated from the former root `labels.enabled` key (which
 * now belongs solely to the i18n override dictionary).
 */
"use strict";

import type { ICapabilityDeclaration } from "../../contracts/capability.contract.js";

/** In-core capability declaration for the Labels subsystem. */
export const LABELS_CAPABILITY: ICapabilityDeclaration = {
    id: "labels",
    label: "Labels",
    description: "Per-layer text labels on GeoJSON map features.",
    gate: {
        configPath: "modules.labels.enabled",
        enableWhenAbsent: true,
    },
    configSchema: {
        enabled: {
            type: "boolean",
            default: true,
            description: "Enable or disable per-layer text labels globally (opt-out).",
        },
    },
    // No loader: labels are inline (eagerly loaded with the UI bundle). Gated via config.
};
