/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability declaration for the in-core `filter` capability.
 *
 * Registered in `boot.ts` so that `GeoLeaf.Introspection.getAllCapabilities()` and
 * `getCapabilitySchema('filter')` work at runtime. S5 — generic attribute filter
 * (side-panel, geometry-agnostic, multi-source), refonte of the former POI/Route
 * filter. See `CDC_capacite-filter.md` v1.0.1.
 *
 * Config gate: `modules.filter.enabled`. `enableWhenAbsent: true` — opt-out
 * (active unless a profile sets it to `false`), preserving the pre-migration
 * default-on behaviour of `ui.showFilterPanel`.
 *
 * F0 registers the declaration (introspection + gate) and mounts the thin
 * `GeoLeaf.Filter` read facade. The predicate engine (F1) and the mapping-driven
 * panel (F2) are wired next; the panel lifecycle (`FilterModule`) is introduced in
 * F2 when the panel moves into the capability — no empty `init()` at F0.
 */
"use strict";

import type { ICapabilityDeclaration } from "../../contracts/capability.contract.js";

/** In-core capability declaration for the generic attribute filter. */
export const FILTER_CAPABILITY: ICapabilityDeclaration = {
    id: "filter",
    label: "Filter",
    description:
        "Generic attribute filter panel (taxonomy, tag, range, text, boolean, proximity) over any geometry and source.",
    gate: { configPath: "modules.filter.enabled", enableWhenAbsent: true },
    configSchema: {
        enabled: {
            type: "boolean",
            default: true,
            description: "Enable the filter panel globally (opt-out).",
        },
        title: {
            type: "string",
            description: "Filter panel title.",
        },
        fields: {
            type: "array",
            description: "Filterable-field descriptors — which fields are filterable and how.",
            items: {
                type: "object",
                properties: {
                    id: { type: "string", description: "Stable field id." },
                    kind: {
                        type: "string",
                        enum: ["taxonomy", "tag", "range", "text", "boolean", "proximity"],
                        description: "How the field is filtered.",
                    },
                    label: { type: "string", description: "Panel label." },
                    layers: {
                        type: "array",
                        description: "Layers filtered by this field (absent = all).",
                        items: { type: "string" },
                    },
                    field: { type: "string", description: "Attribute field to test." },
                    taxonomyRef: {
                        type: "string",
                        description: "Named taxonomy for option values (kind: taxonomy).",
                    },
                },
            },
        },
        actions: {
            type: "object",
            description: "Apply/reset action labels.",
            properties: {
                applyLabel: { type: "string", description: "Apply button label." },
                resetLabel: { type: "string", description: "Reset button label." },
            },
        },
    },
    // No loader: the filter is inline (core UI, present in Full and Lite). Gated via config.
};
