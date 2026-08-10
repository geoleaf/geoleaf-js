/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * LegendModule — `ICoreModule` wrapper for the in-core `legend` capability (S10/F1).
 * Thin: delegates to `LegendLifecycle`, which mounts the legend on
 * `geoleaf:app:ready` (map + theme layers ready) and loads the active theme's
 * layer legends.
 *
 * Depends on `geojson` only (NOT `ui`): it must be dequeued BEFORE
 * ThemeEngineModule (deps `["geojson","ui"]`) so its `app:ready` listener is
 * registered before the engine dispatches `geoleaf:theme:applied` → `app:ready`.
 * The `app:ready` handler runs after `ui.init()` regardless (UI precedes every
 * geojson-gated module), so the panel DOM is present when the legend mounts.
 *
 * Registered in `boot.ts` when `modules.legend.enabled` (opt-out via
 * CapabilityRegistry, S10 F2). Declares a mobile toolbar icon (legend toggle)
 * driven by the `modules.legend.enabled` profileKey.
 */
"use strict";

import type { ILifecycleModule, IModuleUISlot } from "../../contracts/core-module.contract.ts";
import type { IMapAdapter } from "../../contracts/map-adapter.contract.ts";
import type { IGeoLeafConfig } from "../../contracts/config.contract.ts";
import { LegendLifecycle } from "./lifecycle.js";

/**
 * Represents the GeoLeaf Legend subsystem (legend control, generator, renderer).
 * Depends on `geojson` (layer styles); see the module doc for the ordering rule.
 */
export class LegendModule implements ILifecycleModule {
    readonly id = "legend" as const;
    readonly dependencies = ["geojson"] as const;

    readonly ui: IModuleUISlot = {
        mobileIcon: {
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 10h10M4 14h8M4 18h6"/></svg>',
            labelKey: "aria.toolbar.legend",
            profileKey: "modules.legend.enabled",
            defaultVisible: true,
            // Explicit pill order (socle-init 7.5). Before it, `legend` came before `share`
            // only because `LEGEND_INSTALLER` precedes `PERMALINK_INSTALLER` in the manifest —
            // an order chosen for topo-sort and lifecycle reasons, not for the toolbar.
            order: 10,
        },
    };

    init(_adapter: IMapAdapter, _config: IGeoLeafConfig): void {
        LegendLifecycle.init();
    }

    destroy(): void {
        LegendLifecycle._reset();
    }
}
