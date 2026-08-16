/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * LanguageSwitcherModule — `ICoreModule` wrapper for the in-core language-switcher
 * capability.
 *
 * Represents: `GeoLeaf.LanguageSwitcher` (UI language selector). Depends on `geojson`
 * so `init()` runs before the desktop tab strip can announce itself.
 */

import type { ILifecycleModule } from "../../contracts/core-module.contract.ts";
import type { IMapAdapter } from "../../contracts/map-adapter.contract.ts";
import type { IGeoLeafConfig } from "../../contracts/config.contract.ts";
import { LanguageSwitcherLifecycle } from "./lifecycle.js";

/** Represents the GeoLeaf UI language switcher. */
export class LanguageSwitcherModule implements ILifecycleModule {
    readonly id = "language-switcher" as const;
    readonly dependencies = ["geojson"] as const;

    init(_adapter: IMapAdapter, _config: IGeoLeafConfig): void {
        // No map handle needed: the button lives in the tab strip / mobile toolbar.
        LanguageSwitcherLifecycle.init();
    }

    destroy(): void {
        LanguageSwitcherLifecycle._reset();
    }
}
