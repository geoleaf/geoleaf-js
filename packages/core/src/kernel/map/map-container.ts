/*!
 * GeoLeaf Core – Core / Map Container
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import { Log } from "../../utils/log/index.js";
import type { GeoLeafBounds } from "../../contracts/map-adapter.contract.js";

// Narrow view of the global `GeoLeaf` namespace members read by the factory.
interface MapFactoryGlobal {
    GeoLeaf?: {
        /**
         * `persist` is the real second parameter of `ui/theme.ts#applyTheme` (default
         * `true` there). This local view omitted it, which is partly why the boot
         * persisted a theme it only meant to display — see {@link applyThemeSafe}.
         */
        UI?: { applyTheme?(theme: string, persist?: boolean): void };
    };
}

// ES2022 target + Node ≥ 18: globalThis is always defined.
const _g = globalThis as unknown as MapFactoryGlobal;

/**
 * Validates and resolves the DOM container element for the map.
 *
 * @param mapId - DOM element id or selector string.
 * @returns The resolved HTMLElement.
 * @throws Error if mapId is missing or no element is found.
 */
export function resolveMapContainer(mapId: string): HTMLElement {
    if (!mapId) throw new Error("The required 'mapId' option is missing.");
    const el = document.getElementById(mapId);
    if (!el) throw new Error(`No DOM element found for mapId='${mapId}'.`);
    return el;
}

/**
 * Returns a new GeoLeafBounds expanded by the given ratio on all sides.
 *
 * Replaces the legacy `latLngBounds().pad()` call.
 * Used to compute `maxBounds` for the `positionFixed` feature.
 *
 * @param b - Original bounds.
 * @param ratio - Expansion ratio (e.g. 0.3 = 30% added to each side).
 * @returns Expanded bounds as a plain GeoLeafBounds object.
 */
export function padBounds(b: GeoLeafBounds, ratio: number): GeoLeafBounds {
    const latSpan = (b.north - b.south) * ratio;
    const lngSpan = (b.east - b.west) * ratio;
    return {
        north: Math.min(b.north + latSpan, 85.051129),
        south: Math.max(b.south - latSpan, -85.051129),
        east: Math.min(b.east + lngSpan, 180),
        west: Math.max(b.west - lngSpan, -180),
    };
}

/**
 * Applies the current UI theme via GeoLeaf.UI if available.
 * Silently no-ops if the UI module has not been loaded yet.
 *
 * @param theme - Theme identifier (e.g. "light", "dark").
 * @param persist - Whether to write the theme to `localStorage`. **Defaults to `false`**:
 * the boot *applies* a theme, it does not *choose* one. Persisting here overwrote the
 * user's stored preference that `resolveInitialTheme()` had just read, so no chosen theme
 * survived a reload (backlog B.18). Same `persist=false` idiom as the system-preference
 * and media-query paths in `ui/theme.ts`, which apply a detected theme without claiming
 * it as a choice.
 */
export function applyThemeSafe(theme: string, persist: boolean = false): void {
    try {
        if (_g.GeoLeaf?.UI && typeof _g.GeoLeaf.UI.applyTheme === "function") {
            _g.GeoLeaf.UI.applyTheme(theme, persist);
        }
    } catch (err) {
        Log.warn("[GeoLeaf.Core] Error applying theme:", err);
    }
}
