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
    resetBasemapRegistry,
} from "./registry.js";
import { createBaseLayerControlsUI, bindUIOnce, refreshUI, destroyUI } from "./ui.js";
import type { BasemapDefinition, BaselayersInitOptions } from "./basemaps-types.js";

export type { BaselayersInitOptions };

/**
 * The basemaps `init` registers. A caller that declares basemaps gets those and no other: the
 * defaults only stand in when nothing is declared. A declared key that names a default
 * (`street`, `topo`, `satellite`) and brings no source of its own is merged over that default,
 * so a declaration that only overrides its `label` or `apiKey` keeps the default's tiles. One
 * that brings a source (`url`, `tiles`, `style`, `wmts`, `wms`, `imageSource`) is taken as is: merged, the default's `tiles` would
 * win over the declared `url` (`normalizeTilesArray` reads `tiles` first) and serve the
 * default's tiles under the declared name.
 */
function _basemapsToRegister(declared: unknown): Record<string, BasemapDefinition> {
    const entries =
        declared && typeof declared === "object"
            ? Object.entries(declared as Record<string, BasemapDefinition>)
            : [];
    if (entries.length === 0) return DEFAULT_BASELAYERS;
    return Object.fromEntries(
        entries.map(([key, def]) => {
            const ownSource = Boolean(
                def?.url || def?.tiles || def?.style || def?.wmts || def?.wms || def?.imageSource
            );
            const base =
                !ownSource && Object.prototype.hasOwnProperty.call(DEFAULT_BASELAYERS, key)
                    ? DEFAULT_BASELAYERS[key]
                    : undefined;
            return [key, base ? { ...base, ...def } : def];
        })
    );
}

/**
 * Registers the basemaps, renders the controls and activates the initial basemap.
 *
 * The basemaps registered are those of `options.baselayers` and no other. The built-in
 * defaults (`street`, `topo`, `satellite`) are registered only when `options.baselayers` is
 * absent or empty — a caller that declares its basemaps has chosen them.
 *
 * @param options - `map` is the MapLibre instance to drive; `baselayers` maps keys to the
 *   basemap definitions to register; `activeKey` selects the basemap to activate. Without
 *   it, the first registered basemap is activated.
 * @returns The active key and the registered layers, as they stand at the end of the call —
 *   ⚠️ `activeKey` may still be `null`, activation being deferred until the style is loaded.
 *
 * @example
 * ```js
 * GeoLeaf.Baselayers.init({
 *     map: map, // MapLibre GL instance
 *     activeKey: "street-vector",
 * });
 * ```
 */
function init(options?: BaselayersInitOptions): {
    activeKey: string | null;
    layers: Record<string, unknown>;
} {
    options = options || {};

    registerBaseLayers(_basemapsToRegister(options.baselayers));

    if (options.map) {
        setMap(options.map);
    } else {
        _acquireNativeMap(undefined);
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
 * Tears the basemaps down with the application that showed them: the switcher's listeners, its
 * `#gl-left-panel` — which lives in the map container, where the engine's own teardown leaves
 * it —, and what the registry knew of the map that goes away (`resetBasemapRegistry`). Not on
 * the façade: it runs when the application is unmounted, from `UIModule.destroy()`.
 */
export function resetBasemaps(): void {
    destroyUI();
    if (typeof document !== "undefined") document.getElementById("gl-left-panel")?.remove();
    resetBasemapRegistry();
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
