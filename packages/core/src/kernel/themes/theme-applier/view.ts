/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Theme Applier - View
 * Moves the camera to the view a theme declares.
 *
 * A plain export, imported by `core.ts` — not a member grafted onto `ThemeApplierCore` like
 * its three neighbours: nothing here needs the applier's state.
 */

import { Core } from "../../../api/geoleaf.core.js";
import { Log } from "../../../utils/log/index.js";
import { Config } from "../../config/config-primitives.js";
import {
    resolveThemeView,
    resolveViewPadding,
    type ThemeViewDeclaration,
} from "../../config/view-extent.js";

/**
 * Moves the camera to the view a theme declares.
 *
 * Without animation, and meant to run BEFORE the theme's layers are applied: a layer loaded by
 * extent then asks for the area the theme frames, once. An animated move would have it ask for
 * the area being left first, and again where the animation lands.
 *
 * The room kept around a framed extent is the profile's `map.padding`. The navigation limit is
 * not touched: under `map.positionFixed` the engine keeps the camera inside the profile extent.
 *
 * @param view - The theme's view, or `undefined` for a theme that declares none.
 * @returns `true` when the camera was moved. `false` when the theme declares no view, when no
 *   map exists, or when the engine refused the move — which is logged, and does not stop the
 *   theme from being applied.
 */
export function frameThemeView(view: ThemeViewDeclaration | undefined): boolean {
    const map = view ? Core.getMap() : null;
    if (!view || !map) return false;
    const target = resolveThemeView(view);
    try {
        if ("bounds" in target) {
            const padding = resolveViewPadding(Config.get("map.padding"));
            map.fitBounds(target.bounds, { padding, animate: false });
        } else {
            map.setView(target.center, target.zoom);
        }
        return true;
    } catch (error) {
        Log?.warn("[ThemeApplier] The theme view could not be applied:", error);
        return false;
    }
}
