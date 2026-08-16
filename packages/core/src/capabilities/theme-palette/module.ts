/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * ThemePaletteModule — `ICoreModule` wrapper for the in-core theme-palette capability.
 *
 * Represents: `GeoLeaf.ThemePalette` (accent-colour palette). `init()` applies the
 * resolved palette BEFORE the UI is painted — that is what prevents the default-colour
 * flash — then mounts the button when enabled.
 */

import type { ILifecycleModule } from "../../contracts/core-module.contract.ts";
import type { IMapAdapter } from "../../contracts/map-adapter.contract.ts";
import type { IGeoLeafConfig } from "../../contracts/config.contract.ts";
import { ThemePaletteLifecycle } from "./lifecycle.js";

/** Represents the GeoLeaf accent-colour palette. */
export class ThemePaletteModule implements ILifecycleModule {
    readonly id = "theme-palette" as const;
    readonly dependencies = ["geojson"] as const;

    init(_adapter: IMapAdapter, _config: IGeoLeafConfig): void {
        ThemePaletteLifecycle.init();
    }

    destroy(): void {
        ThemePaletteLifecycle._reset();
    }
}
