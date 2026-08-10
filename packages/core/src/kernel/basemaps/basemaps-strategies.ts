/*!
 * GeoLeaf Core – Baselayers / Apply strategies
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * The map-mutating half of the basemaps subsystem, extracted from `registry.ts`
 * to keep that file under the 700-line module budget.
 *
 * Each strategy knows HOW to put one kind of basemap on the map (raster, WMS,
 * WMTS, or full style replacement) and updates the shared state accordingly.
 * The registry keeps the orchestration — WHICH strategy to run, and whether to
 * mutate the live source or rebuild it.
 *
 * Imports flow one way: registry → strategies → state. This module never imports
 * `registry.js`.
 * https://geoleaf.dev
 */

import { Log } from "../../utils/log/index.js";
import { dispatchGeoLeafEvent } from "../events/event-bus.js";
import {
    _core,
    _map,
    _styleGeneration,
    _wmtsAbort,
    _setActiveKey,
    _setActiveType,
    _nextStyleGeneration,
    _setWmtsAbort,
} from "./basemaps-state.js";
import { applyLibertyFilters } from "./providers.js";
import {
    activateTerrain,
    deactivateTerrain,
    isTerrainActive,
    resolveTerrainConfig,
} from "./terrain.js";
import { applyImageBasemap } from "./image-source.js";
import { applyHillshadeBasemap } from "./hillshade.js";
import { buildWmsUrl, resolveWmtsTilesUrl } from "./wmts-resolver.js";
import {
    _buildRasterSourceSpec,
    insertBelow,
    BASEMAP_SOURCE_ID,
    BASEMAP_LAYER_ID,
} from "./basemaps-apply.js";
import type {
    BasemapDefinition,
    BasemapRenderType,
    BasemapChangeDetail,
    NativeMap,
    SetBaseLayerOptions,
} from "./basemaps-types.js";

/**
 * Empty MapLibre style used when transitioning from a vector basemap to
 * a raster one. `setStyle(EMPTY_STYLE)` clears the previous vector style
 * so that the raster source and layer can be injected cleanly.
 */
const EMPTY_STYLE = { version: 8 as const, sources: {}, layers: [] as never[] };

// ─── Raster basemap apply (state-mutating) ───────────────────────────────────

/**
 * Injects a raster basemap into the map by adding a raster source and layer.
 * The basemap is always inserted below all existing layers to avoid covering data layers.
 */
function _applyRasterBasemap(nativeMap: NativeMap, definition: BasemapDefinition): void {
    const { sourceSpec, layerSpec } = _buildRasterSourceSpec(definition);
    nativeMap.addSource(BASEMAP_SOURCE_ID, sourceSpec);
    insertBelow(nativeMap, layerSpec);
    _setActiveType("raster");
}

// ─── WMS raster basemap ───────────────────────────────────────────────────────

/**
 * Builds a MapLibre raster source from a WMS config and applies it to the map.
 * WMS tiles are fetched in EPSG:3857 using MapLibre's `{bbox-epsg-3857}` template.
 */
function _applyWmsBasemap(nativeMap: NativeMap, definition: BasemapDefinition): void {
    const tilesUrl = buildWmsUrl(definition);
    if (!tilesUrl) {
        Log.error("[GeoLeaf.Baselayers] Cannot build WMS URL.", definition?.id);
        return;
    }

    const tileSize = typeof definition.wms?.tileSize === "number" ? definition.wms.tileSize : 256;
    const attribution = definition.attribution ?? "";

    const sourceSpec: Record<string, unknown> = {
        type: "raster",
        tiles: [tilesUrl],
        tileSize,
    };
    if (attribution) sourceSpec.attribution = attribution;
    if (typeof definition.minZoom === "number") sourceSpec.minzoom = definition.minZoom;
    if (typeof definition.maxZoom === "number") sourceSpec.maxzoom = definition.maxZoom;

    nativeMap.addSource(BASEMAP_SOURCE_ID, sourceSpec);

    const layerSpec: Record<string, unknown> = {
        id: BASEMAP_LAYER_ID,
        type: "raster",
        source: BASEMAP_SOURCE_ID,
    };
    insertBelow(nativeMap, layerSpec);

    _setActiveType("raster");
}

// ─── WMTS async basemap ───────────────────────────────────────────────────────

/**
 * Fetches WMTS GetCapabilities asynchronously, then applies the basemap.
 * Uses `_styleGeneration` as a stale-switch guard (if the user switches away
 * before resolution, the result is discarded).
 * Any previous in-flight request is aborted before starting a new one.
 */
export function _applyWmtsBasemap(
    nativeMap: NativeMap,
    definition: BasemapDefinition,
    key: string,
    previousKey: string | null,
    options: SetBaseLayerOptions
): void {
    // Abort any pending GetCapabilities fetch
    _wmtsAbort?.abort();
    // Keep a local handle: the signal must belong to the controller THIS invocation
    // created, never to whichever one happens to be current when the read runs.
    const abort = new AbortController();
    _setWmtsAbort(abort);

    const generation = _nextStyleGeneration();
    // Set state eagerly so getActiveKey() is consistent during the async gap
    _setActiveKey(key);
    _setActiveType("raster");

    resolveWmtsTilesUrl(definition, abort.signal)
        .then((tilesUrl) => {
            // Discard stale result if user has already switched to another basemap
            if (_styleGeneration !== generation) {
                Log.debug("[GeoLeaf.Baselayers] WMTS resolution superseded — skipping.");
                return;
            }

            _setWmtsAbort(null);

            if (!tilesUrl) {
                Log.error("[GeoLeaf.Baselayers] WMTS resolution failed for:", key);
                return;
            }

            try {
                // Build a resolved definition with the XYZ tile URL
                const resolved = { ...definition, tiles: [tilesUrl] };
                _applyRasterBasemap(nativeMap, resolved);
            } catch (e) {
                Log.error("[GeoLeaf.Baselayers] Cannot apply WMTS basemap:", e);
                return;
            }

            _handleTerrainOnSyncSwitch(key, definition);
            if (!options.silent) _dispatchBasemapChange(key, previousKey, definition);
        })
        .catch((e) => {
            Log.error("[GeoLeaf.Baselayers] WMTS async error:", e);
        });
}

// ─── Vector basemap via setStyle ─────────────────────────────────────────────

/**
 * Applies a basemap via `map.setStyle()` — full style replacement.
 *
 * Used for **all** transitions where the source or target basemap is vector:
 * raster→vector, vector→raster, vector→vector.
 *
 * The GeoLeaf-owned sources/layers of the current style are carried into the
 * incoming style via `transformStyle` (option de `setStyle` depuis la v5 ; voir l'adapter
 * `buildStyleChangeTransform`), so they survive the swap natively — no teardown,
 * no re-injection (the former `geoleaf:style:rebuild` dance; audit redundancy #1).
 *
 * After the new style loads:
 * 1. Re-registers runtime images (sprite icons) wiped by `setStyle()`.
 * 2. Applies the target basemap (raster source/layer inserted at the bottom, or
 *    vector filters).
 * 3. Activates terrain if the target has `terrain.default3D: true`.
 * 4. Dispatches `geoleaf:basemap:change`.
 */
export function _applyViaStyleChange(
    nativeMap: NativeMap,
    definition: BasemapDefinition,
    targetType: BasemapRenderType,
    key: string,
    previousKey: string | null,
    options: SetBaseLayerOptions
): void {
    const generation = _nextStyleGeneration();

    // Set state immediately so getActiveKey() is consistent during async gap
    _setActiveKey(key);
    _setActiveType(targetType);

    // Deactivate terrain before style replacement (source will be destroyed)
    if (isTerrainActive()) {
        deactivateTerrain(nativeMap);
    }

    const styleTarget = targetType === "vector" ? definition.style : EMPTY_STYLE;

    // Snapshot the transform BEFORE setStyle so the GeoLeaf sources/layers are
    // carried into the incoming style (null when nothing is owned yet → plain
    // setStyle, matching the first-load path).
    const adapter = _core()?.getAdapter?.();
    const transform = adapter?.buildStyleChangeTransform?.() ?? null;

    // Register the listener BEFORE calling setStyle(). For inline style
    // objects (e.g. EMPTY_STYLE) MapLibre may fire `style.load` synchronously
    // during setStyle(), so the handler must already be in place.
    nativeMap.once("style.load", () => {
        // Guard against superseded style changes (rapid basemap switching)
        if (_styleGeneration !== generation) return;

        // 1. Re-register runtime images (sprite icons) wiped by setStyle().
        //    transformStyle preserved the sources/layers; images are not part of
        //    the style spec, so they must be re-added here.
        adapter?.reregisterStyleImages?.();

        // 2. Apply basemap
        if (targetType === "vector") {
            applyLibertyFilters(nativeMap);
            Log.info("[GeoLeaf.Baselayers] Vector style loaded:", key);
        } else if (definition.type === "wmts") {
            // WMTS needs async GetCapabilities resolution. The preserved GeoLeaf
            // layers stay in place; the tile source is injected at the bottom async.
            _applyWmtsBasemap(nativeMap, definition, key, previousKey, options);
            return;
        } else {
            try {
                _applyRasterBasemap(nativeMap, definition);
            } catch (e) {
                Log.error("[GeoLeaf.Baselayers] Cannot apply raster after style change:", e);
            }
        }

        // 3. Terrain activation (directly — no nested style.load)
        const terrainConfig = resolveTerrainConfig(definition, key);
        if (terrainConfig?.default3D) {
            activateTerrain(nativeMap, terrainConfig, key);
        }

        // 4. Notify
        Log.info("[GeoLeaf.Baselayers] Active basemap:", key);
        if (!options.silent) {
            _dispatchBasemapChange(key, previousKey, definition);
        }
    });

    // Trigger style replacement AFTER the listener is in place. transformStyle
    // merges the GeoLeaf sources/layers into the incoming basemap style.
    nativeMap.setStyle(
        styleTarget,
        transform ? { diff: true, transformStyle: transform } : undefined
    );
}

// ─── Activation side-effects ─────────────────────────────────────────────────

/**
 * Emits `geoleaf:basemap:change` on `document` after a basemap became active.
 *
 * Called by every activation path — sync raster, WMTS and vector — unless the caller passed
 * `silent`. A no-op where there is no `document`.
 *
 * @param key - The basemap now active.
 * @param previousKey - The basemap it replaced, or `null` at boot.
 * @param definition - The definition of the newly active basemap.
 */
export function _dispatchBasemapChange(
    key: string,
    previousKey: string | null,
    definition: BasemapDefinition
) {
    if (typeof document === "undefined" || typeof document.dispatchEvent !== "function") return;

    const detail: BasemapChangeDetail = {
        key,
        previousKey,
        map: _map,
        definition,
        layer: null, // tombstone for backward compat — no layer instance
        source: "geoleaf.baselayers",
    };

    dispatchGeoLeafEvent("geoleaf:basemap:change", detail);
}

/**
 * Handles terrain activation/deactivation for the sync raster→raster path.
 * Deactivates any active terrain, then auto-activates if `default3D: true`.
 *
 * The async vector path (`_applyViaStyleChange`) handles terrain directly
 * inside its `style.load` callback.
 * @internal
 */
export function _handleTerrainOnSyncSwitch(key: string, definition: BasemapDefinition): void {
    if (isTerrainActive()) {
        deactivateTerrain(_map);
    }

    const terrainConfig = resolveTerrainConfig(definition, key);
    if (!terrainConfig?.default3D) return;

    activateTerrain(_map, terrainConfig, key);
}

/**
 * Dispatches the correct sync basemap apply function based on `definition.type`.
 * @internal
 */
export function _applySyncBasemapByType(nativeMap: NativeMap, definition: BasemapDefinition): void {
    if (definition.type === "image") {
        applyImageBasemap(nativeMap, definition);
        _setActiveType("raster");
    } else if (definition.type === "hillshade") {
        applyHillshadeBasemap(nativeMap, definition);
        _setActiveType("raster");
    } else if (definition.type === "wms") {
        _applyWmsBasemap(nativeMap, definition);
    } else {
        _applyRasterBasemap(nativeMap, definition);
    }
}
