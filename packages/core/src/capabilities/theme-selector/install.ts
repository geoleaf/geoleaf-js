/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability installer for the in-core `theme-selector` capability — presets build (S2 Lot 8).
 *
 * The **last** of the 17 in-core capabilities to migrate: it was pulled out of Lot 2 because
 * its DOM facade spans 6 files and its coverage came from a fragile, incidental full-boot
 * path. `__tests__/capabilities/theme-selector/mount.test.js` (S2 Lot 8) now mounts the bar
 * for real — that deterministic mount coverage was the precondition for this move.
 *
 * ⚠ **The theme ENGINE stays kernel.** Only `GeoLeaf.ThemeSelector` (the switch bar UI)
 * moves here. `ThemeCache`, `_ThemeLoader` and `_ThemeApplier` (`kernel/themes/**`)
 * remain in `globals.ui.ts`: they are the engine that applies the profile's default theme
 * (via `ThemeEngineModule`, kernel and unconditional) and the facade below consumes them.
 * Same rule as `theme-toggle`, whose installer leaves `_UITheme` / `ui.applyTheme` behind.
 *
 * ⚠ The Lite bundle keeps its own assignment (`globals.ui-lite.ts`) — it does not go through
 * a preset manifest.
 */
"use strict";

// ── Stylesheet (S6) ─────────────────────────────────────────────────────────
// The capability owns its CSS and pulls it into the module graph from HERE — the one module
// a consumer must import to get this capability at all. Skip the installer and the stylesheet
// is never in the graph either: the CSS tree-shakes with the code.
import "./css/theme-selector.css";

import type { CapabilityInstaller } from "../../contracts/preset.contract.js";
import { THEME_SELECTOR_CAPABILITY } from "./theme-selector-capability.js";
// The boot wrapper now lives INSIDE this capability (backlog R.10) — no app/ path,
// no exception, and the ICoreModule lifecycle is co-located with what it drives.
import { ThemeSelectorModule } from "./module.js";
import { ThemeSelector } from "./theme-selector.js";

/** Self-sufficient installer for the Theme-Selector capability (theme switch bar). */
export const THEME_SELECTOR_INSTALLER: CapabilityInstaller = {
    declaration: THEME_SELECTOR_CAPABILITY,

    registerGlobals(gl: Record<string, unknown>): void {
        // Layer B — moved verbatim from globals.ui.ts (setupUI, B7 block). The neighbouring
        // theme-engine writes (ThemeCache / _ThemeLoader / _ThemeApplier) stay there.
        gl.ThemeSelector = ThemeSelector;
    },

    createModule() {
        return new ThemeSelectorModule();
    },
};
