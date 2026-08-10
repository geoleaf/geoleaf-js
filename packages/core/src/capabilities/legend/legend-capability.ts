/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability declaration for the in-core `legend` capability.
 *
 * Registered by the preset loop (Pass 1) before the optional module gate so
 * that `LegendModule` is registered through the SAME `CapabilityRegistry` path as
 * every other in-core capability (labels / filter / theme-selector / …) — no
 * inline gate. S10 F2 — migrated from the former `ui.showLegend` UI flag +
 * `legendConfig` block. See `CDC_capacite-legend.md`.
 *
 * Config gate: `modules.legend.enabled`. `enableWhenAbsent: true` — opt-out
 * (active unless a profile sets it to `false`). The boot gate runs against the
 * pre-merge `baseCfg` (profile config not yet loaded by `loadActiveProfileResources`),
 * so it MUST stay opt-out; an opt-in `=== true` would read `undefined` and never
 * register. The legend is gated again late by `LegendLifecycle._onAppReady` on the
 * merged `modules.legend.enabled` (read off `getLegendConfig()`).
 */
"use strict";

import type { ICapabilityDeclaration } from "../../contracts/capability.contract.js";

/** In-core capability declaration for the cartographic legend. */
export const LEGEND_CAPABILITY: ICapabilityDeclaration = {
    id: "legend",
    label: "Legend",
    description:
        "Cartographic multi-layer legend (accordion control + mobile toolbar / desktop side-panel toggles).",
    gate: { configPath: "modules.legend.enabled", enableWhenAbsent: true },
    configSchema: {
        enabled: {
            type: "boolean",
            default: true,
            description: "Enable or disable the legend (opt-out).",
        },
        title: {
            type: "string",
            default: "Légende",
            description:
                "Legend panel title. The built-in default is LOCALISED — it comes from the " +
                "`ui.legend.title` dictionary key and follows `ui.language`, so the value " +
                "advertised here is the French reference (`lang-fr.ts` is the canonical file " +
                "the other five translate). It used to be the hardcoded ENGLISH literal " +
                '"Legend", served to all six locales (fixed with B.24/B.38). A profile that ' +
                "sets this key still wins over the dictionary.",
        },
        position: {
            type: "string",
            enum: ["bottomleft", "bottomright", "topleft", "topright"],
            default: "bottomleft",
            description: "Legend control position on the map (`config.ts` → `DEFAULTS`).",
        },
        collapsedByDefault: {
            type: "boolean",
            default: false,
            description: "Whether the legend starts collapsed (`config.ts` → `DEFAULTS`).",
        },
    },
    // No loader: the legend ships with the eager bundle (Full and Lite). Gated via config.
};
