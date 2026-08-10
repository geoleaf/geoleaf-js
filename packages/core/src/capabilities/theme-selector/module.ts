/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * ThemeSelectorModule — `ICoreModule` wrapper for the in-core `theme-selector`
 * capability (S8/F2). Thin: delegates to `ThemeSelectorLifecycle`, which mounts the
 * theme switch bar on `geoleaf:app:ready`.
 *
 * Depends on `geojson` only (NOT `ui`/`theme-engine`): it must be dequeued BEFORE
 * ThemeEngineModule (deps `["geojson","ui"]`) so its `app:ready` listener is
 * registered before the engine dispatches `geoleaf:theme:applied` → `app:ready`.
 * Registered by the preset loop via `CapabilityRegistry.isEnabled("theme-selector", …)`
 * (`modules.theme-selector.enabled`, **opt-in** — défaut `false`, S8/F3).
 */
"use strict";

import type { ILifecycleModule } from "../../contracts/core-module.contract.ts";
import type { IMapAdapter } from "../../contracts/map-adapter.contract.ts";
import type { IGeoLeafConfig } from "../../contracts/config.contract.ts";
import { ThemeSelectorLifecycle } from "./lifecycle.js";

/** Represents the theme-selector UI capability (switch bar). */
export class ThemeSelectorModule implements ILifecycleModule {
    readonly id = "theme-selector" as const;
    readonly dependencies = ["geojson"] as const;

    init(_adapter: IMapAdapter, _config: IGeoLeafConfig): void {
        ThemeSelectorLifecycle.init();
    }

    destroy(): void {
        ThemeSelectorLifecycle._reset();
    }
}
