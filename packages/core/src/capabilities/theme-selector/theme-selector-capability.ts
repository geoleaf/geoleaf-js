/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability declaration for the in-core `theme-selector` capability.
 *
 * Registered by the preset loop (Pass 1) before the optional module gate so
 * that `ThemeSelectorModule` is registered through the SAME `CapabilityRegistry`
 * path as every other in-core capability (labels / filter / cluster / …) — no
 * inline gate. This is the convention: every `capabilities/*` subsystem is gated
 * via `CapabilityRegistry.isEnabled()`; only non-capability toggles (e.g. the
 * `pwa` install-prompt init) stay inline.
 *
 * Config gate: `modules.theme-selector.enabled`. `enableWhenAbsent: true` at the BOOT
 * GATE only — registration-only, not the visible default. The boot gate runs against the
 * pre-merge `baseCfg` (profile config not yet loaded by `loadActiveProfileResources`),
 * where the key does not exist yet: an opt-in gate would read `undefined` and never
 * register the capability at all. The bar itself is gated again late by the selector's
 * `_createUI` on the merged config (`modules.theme-selector.enabled === true`), and THAT
 * decision is opt-IN — a profile omitting the key gets no bar.
 * ⚠️ The two values answer different questions and are not meant to match. What must match
 * is the SCHEMA and the RUNTIME: the schema therefore declares `default: false`
 * (CAPACITÉS S11 / B.23 — it used to declare `true`, promising a bar nothing rendered).
 * Migrated from the former `ui.showThemeSelector` UI flag (extraction roadmap
 * theme-selector S8/F3).
 */
"use strict";

import type { ICapabilityDeclaration } from "../../contracts/capability.contract.js";

/** In-core capability declaration for the theme-selector UI. */
export const THEME_SELECTOR_CAPABILITY: ICapabilityDeclaration = {
    id: "theme-selector",
    label: "Theme selector",
    description:
        "Theme switcher bar (primary buttons + secondary select) for GeoJSON layer themes.",
    gate: {
        configPath: "modules.theme-selector.enabled",
        // Registration-only (profile-level): registers the module pre-merge, when
        // `modules.theme-selector` does not exist yet on `baseCfg`. An opt-in gate would read
        // `undefined` here and never register the capability at all (the documented
        // boot-gate-timing pitfall). The REAL decision is taken late, on the merged config —
        // `theme-selector.ts` → `_createUI` tests `enabled === true`. Same shape as `theme-toggle`.
        enableWhenAbsent: true,
    },
    configSchema: {
        enabled: {
            type: "boolean",
            // ⚠️ `false`, NOT the gate's `true` (CAPACITÉS S11 / B.23). The schema is what
            // `getCapabilitySchema('theme-selector')` publishes to integrators and to the
            // no-code studio: it must state what the runtime DOES, and the runtime is
            // opt-IN. Announcing `true` promised a bar that a profile omitting the key never
            // gets. The gate value and the schema value answer two different questions and
            // are not meant to match — it is the SCHEMA that must match the RUNTIME.
            default: false,
            description: "Show the theme selector bar (opt-in).",
        },
    },
    // No loader: the selector UI ships with the eager bundle. Gated via config.
};
