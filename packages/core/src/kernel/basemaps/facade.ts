/*!
 * GeoLeaf Core – Baselayers / Facade
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import { DEFAULT_BASELAYERS } from "./providers.js";
import {
    _acquireNativeMap,
    setMap,
    registerBaseLayer,
    registerBaseLayers,
    setBaseLayer,
    refreshBasemap,
    getBaseLayers,
    getActiveKey,
    getActiveLayer,
} from "./registry.js";
import { createBaseLayerControlsUI, bindUIOnce, refreshUI, destroyUI } from "./ui.js";
import type { BasemapDefinition, BaselayersInitOptions } from "./basemaps-types.js";

export type { BaselayersInitOptions };

/**
 * Initialises the basemaps system: registers default layers, applies custom
 * layers from options, sets the active layer, and renders the basemap UI controls.
 *
 * @param options - Initialisation options.
 * @param options.map - Map instance (uses the global map if omitted).
 * @param options.baselayers - Map of layer key → basemap config objects.
 * @param options.activeKey - Key of the basemap to activate on init.
 * @returns An object with the active key and the full layers registry.
 */
/**
 * Registers the default basemaps, renders the controls and activates the initial basemap.
 *
 * @param options - `map` is the MapLibre instance to drive; `defaultKey` selects the basemap
 *   activated at boot.
 * @returns The active key and the registered layers, as they stand at the end of the call —
 *   ⚠️ `activeKey` may still be `null`, activation being deferred until the map is idle.
 *
 * @example
 * ```js
 * GeoLeaf.Baselayers.init({
 *     map: map, // instance MapLibre GL
 *     defaultKey: "street-vector",
 * });
 * ```
 */
function init(options?: BaselayersInitOptions): {
    activeKey: string | null;
    layers: Record<string, unknown>;
} {
    options = options || {};

    registerBaseLayers(DEFAULT_BASELAYERS);

    if (options.map) {
        setMap(options.map);
    } else {
        _acquireNativeMap(undefined);
    }

    if (options.baselayers && typeof options.baselayers === "object") {
        registerBaseLayers(options.baselayers as Record<string, BasemapDefinition>);
    }

    if (options.activeKey) {
        setBaseLayer(options.activeKey, { silent: true });
    } else if (!getActiveKey()) {
        // Fall back to the first registered basemap ONLY when no explicit activeKey was
        // requested. Was an unconditional `if`: when setBaseLayer defers because the map
        // style is not ready yet (F0/S8 boot — GeoJSON sources in flight), getActiveKey()
        // is still null here, which wrongly triggered a SECOND, different basemap that then
        // applied over the intended one. An invalid activeKey is already handled inside
        // setBaseLayer (it falls back to the first layer there).
        const [firstKey] = Object.keys(getBaseLayers());
        if (firstKey) {
            setBaseLayer(firstKey, { silent: true });
        }
    }

    createBaseLayerControlsUI(options);
    bindUIOnce();
    refreshUI();

    return {
        activeKey: getActiveKey(),
        layers: getBaseLayers(),
    };
}

/**
 * The `GeoLeaf.Baselayers` façade — registering, switching and rendering basemaps.
 *
 * Two aliases exist for backward compatibility: `setActive` is `setBaseLayer`, and
 * `getActiveId` is `getActiveKey`. `destroy` detaches the switcher listeners; it does not
 * unregister the basemaps.
 */
export const Baselayers = {
    init,
    registerBaseLayer,
    registerBaseLayers,
    setBaseLayer,
    setActive: setBaseLayer,
    refreshBasemap,
    getBaseLayers,
    getActiveKey,
    getActiveId: getActiveKey,
    getActiveLayer,
    destroy: destroyUI,
};
