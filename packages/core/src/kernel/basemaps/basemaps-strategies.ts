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
    _setLandedStyleKey,
} from "./basemaps-state.js";
import { applyLibertyFilters } from "./providers.js";
import { suspendTerrainForStyleSwap, syncTerrainToBasemap } from "./terrain.js";
import { applyImageBasemap } from "./image-source.js";
import {
    applyHillshadeBasemap,
    removeHillshadeOverlay,
    syncHillshadeOverlay,
} from "./hillshade.js";
import { buildWmsUrl, resolveWmtsTilesUrl } from "./wmts-resolver.js";
import {
    _buildRasterSourceSpec,
    declaredAttribution,
    hasRenderedShape,
    insertBelow,
    trackIncomingStyle,
    BASEMAP_SOURCE_ID,
    BASEMAP_LAYER_ID,
} from "./basemaps-apply.js";
import type {
    BasemapDefinition,
    BasemapRenderType,
    BasemapChangeDetail,
    NativeMap,
    NativeStyleView,
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
    const attribution = declaredAttribution(definition);

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
    // The previous basemap's slot is empty until the resolution lands: a hillshade overlay left
    // there would be drawn over nothing for that long.
    removeHillshadeOverlay(nativeMap);

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

            syncHillshadeOverlay(nativeMap, definition, key);
            _handleTerrainOnSyncSwitch(key, definition);
            if (!options.silent) _dispatchBasemapChange(key, previousKey, definition);
        })
        .catch((e) => {
            // The request is over: left in place, its controller would read as a resolution
            // still in flight, and `refreshBasemap` would wait for it forever.
            if (_wmtsAbort === abort) _setWmtsAbort(null);
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
 * incoming style via `transformStyle` (a `setStyle` option since v5; see the adapter's
 * `buildStyleChangeTransform`), so they survive the swap natively — no teardown,
 * no re-injection (the former `geoleaf:style:rebuild` dance; audit redundancy #1).
 *
 * After the new style loads — or, when MapLibre had nothing to apply and so fired no
 * `style.load`, once the style has passed through the transform and the live style has the shape
 * it rendered (going back to the vector basemap whose style the map holds, while another one
 * downloads):
 * 1. Puts back the runtime images (hatch patterns, sprite icons) a style REBUILD wiped —
 *    the engine keeps them when it can diff the two styles.
 * 2. Applies the target basemap (raster source/layer inserted at the bottom, or
 *    vector filters), then its hillshade overlay if it declares one — the style change dropped
 *    the previous basemap's.
 * 3. Brings the terrain in line with the target — put on at once when it declares
 *    `terrain.default3D`, bound to the tilt when its `terrain.activation` is `"pitch"`.
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

    // The terrain comes off before the style is replaced: left on, it keeps the engine from
    // diffing the two styles, and its source is destroyed with the outgoing one anyway.
    suspendTerrainForStyleSwap(nativeMap);

    const styleTarget = targetType === "vector" ? definition.style : EMPTY_STYLE;

    // Build the transform BEFORE setStyle so the GeoLeaf sources/layers are carried into
    // the incoming style. It reads what GeoLeaf owns when MapLibre RUNS it — for a style
    // URL, once the style has downloaded — so the layers created in between are carried
    // too: at boot, a vector default basemap's style downloads while the data layers land.
    // `null` only when the adapter lacks the member or returns nothing: a plain setStyle.
    //
    // 🛑 A VECTOR basemap's declared credit travels HERE, and only here: the raster paths set it
    // on the source they build, but a vector style brings its own sources, so the credit can
    // only reach MapLibre's attribution control through the incoming style.
    const adapter = _core()?.getAdapter?.();
    const attribution = targetType === "vector" ? declaredAttribution(definition) : "";
    // Wrapped so that the incoming style is read as it passes, before the carried layers are
    // appended to it: a hillshade overlay is placed by the basemap's OWN layers.
    //
    // 🛑 A switch MapLibre has nothing to do for never fires `style.load`. Going back to the
    // vector basemap whose style the map holds, while another one downloads, aborts that download
    // and diffs the held style against itself: `Style.setState` returns without an event, and the
    // switch never finished — the active key read the basemap, no `geoleaf:basemap:change` was
    // emitted, and what it puts on at landing stayed off. The wrapper tells when the style has
    // passed; if `style.load` has not come by then and the live style has the shape the transform
    // rendered, the engine applied it with nothing to do, and the switch is finished here.
    let finished = false;
    const incoming = trackIncomingStyle(
        adapter?.buildStyleChangeTransform?.(attribution ? { attribution } : undefined) ?? null,
        (rendered) => {
            if (finished || _styleGeneration !== generation) return;
            let live: NativeStyleView | undefined;
            try {
                live = nativeMap.getStyle();
            } catch {
                return; // A style still rebuilding: its own `style.load` will come.
            }
            if (!hasRenderedShape(live, rendered)) return;
            nativeMap.off("style.load", onStyleLoad);
            onStyleLoad();
        }
    );
    const transform = incoming.transform;

    // Register the listener BEFORE calling setStyle(). For inline style
    // objects (e.g. EMPTY_STYLE) MapLibre may fire `style.load` synchronously
    // during setStyle(), so the handler must already be in place.
    function onStyleLoad(): void {
        finished = true;
        // Guard against superseded style changes (rapid basemap switching)
        if (_styleGeneration !== generation) return;

        // From here the map HOLDS this basemap's style — what a later switch to a basemap
        // sharing it relies on. A raster target replaced the style with an empty one.
        const landmarks = incoming.landmarks();
        _setLandedStyleKey(targetType === "vector" ? key : null, landmarks);

        // 1. Put back the runtime images (hatch patterns, sprite icons). transformStyle
        //    carried the sources/layers; images are not part of the style spec, and a
        //    style the engine rebuilt rather than diffed starts with none.
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
            // By TYPE, as the sync path does: a WMS, an image or a hillshade carries no
            // `tiles` / `url`, so the XYZ constructor gave them an empty raster source.
            try {
                _applySyncBasemapByType(nativeMap, definition);
            } catch (e) {
                Log.error("[GeoLeaf.Baselayers] Cannot apply raster after style change:", e);
            }
        }
        syncHillshadeOverlay(nativeMap, definition, key, landmarks);

        // 3. Terrain (directly — no nested style.load)
        syncTerrainToBasemap(nativeMap, definition, key);

        // 4. Notify
        Log.info("[GeoLeaf.Baselayers] Active basemap:", key);
        if (!options.silent) {
            _dispatchBasemapChange(key, previousKey, definition);
        }
    }
    nativeMap.once("style.load", onStyleLoad);

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
 * Brings the terrain in line with the basemap a switch that replaced no style just applied: the
 * sync raster path, a WMTS resolution, two vector basemaps sharing one style. Whatever the
 * previous basemap held is released, and the new one's terrain is put on or bound to the tilt —
 * which of the two is `terrain.ts`'s to decide.
 *
 * The async vector path (`_applyViaStyleChange`) handles terrain directly
 * inside its `style.load` callback.
 * @internal
 */
export function _handleTerrainOnSyncSwitch(key: string, definition: BasemapDefinition): void {
    syncTerrainToBasemap(_map, definition, key);
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
