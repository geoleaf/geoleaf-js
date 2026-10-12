/*!
 * GeoLeaf Core – Basemaps / Hillshade
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Implements hillshade (terrain shadow / ambient occlusion) twice over, from one config block:
 * as a basemap TYPE — the shading is the basemap —, and as an OVERLAY of any other basemap,
 * which stays what it is. Both use a MapLibre `raster-dem` source with a `hillshade` render
 * layer; they differ by where the layer goes and by which source it reads.
 *
 * Terrain-dem reuse, basemap type only: when the terrain module has already added a
 * `raster-dem` source with a matching DEM URL, the hillshade layer reuses that source to avoid
 * redundant tile loading.
 *
 * The overlay NEVER reuses it, and that is a decision. The engine forces a doubled tile size on
 * the source it drapes the terrain over, so a shading read from it is one zoom level coarser —
 * MapLibre warns about that very sharing itself; and `terrain-dem` is removed on a deferred
 * frame when the terrain goes, which a layer still reading it turns into a refusal and an
 * orphan source. Measured in a browser, one camera over a massif: 43 DEM tiles with a shared
 * source, 86 with two, the shading one zoom level finer.
 *
 * The overlay can FOLLOW the terrain (`hillshade.onlyWithTerrain`): shown while a terrain is on
 * the map, hidden — and requesting no tile — the rest of the time. It learns of the terrain from
 * the engine's own `terrain` event, fired on every `setTerrain`, the engine's own resets
 * included: this module and `terrain.ts` do not know each other.
 *
 * Security: DEM URLs are validated before use. No innerHTML or eval.
 * https://geoleaf.dev
 */

import { Log } from "../../utils/log/index.js";
import { validateUrl } from "../../utils/general/utils-base.js";
import {
    BASEMAP_SOURCE_ID,
    BASEMAP_LAYER_ID,
    _resolveBasemapType,
    insertBelow,
    readStyleLandmarks,
} from "./basemaps-apply.js";
import type {
    BasemapDefinition,
    HillshadeConfig,
    NativeMap,
    NativeMapErrorEvent,
    StyleLandmarks,
} from "./basemaps-types.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Source ID managed by terrain.ts for 3D terrain. */
const TERRAIN_DEM_SOURCE_ID = "terrain-dem";

/**
 * When `terrain-dem` cannot be reused, hillshade takes over the **basemap slot**
 * rather than opening a source of its own — hence the shared id. Aliased locally
 * so the call sites keep reading as hillshade intent.
 */
const HILLSHADE_SOURCE_ID = BASEMAP_SOURCE_ID;

/**
 * Layer and source of the hillshade OVERLAY. Ids of their own: the overlay lives next to the
 * basemap, not in its slot, and never on the terrain's source.
 */
const OVERLAY_LAYER_ID = "__geoleaf_hillshade_overlay_layer__";
const OVERLAY_SOURCE_ID = "__geoleaf_hillshade_overlay__";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds the hillshade render layer spec, referencing the given source.
 * @internal
 */
function _buildHillshadeLayerSpec(
    sourceId: string,
    layerId: string,
    config: Partial<HillshadeConfig>
): Record<string, unknown> {
    const paint: Record<string, unknown> = {};

    if (config.shadowColor) paint["hillshade-shadow-color"] = config.shadowColor;
    if (config.highlightColor) paint["hillshade-highlight-color"] = config.highlightColor;
    if (config.accentColor) paint["hillshade-accent-color"] = config.accentColor;

    if (typeof config.exaggeration === "number") {
        paint["hillshade-exaggeration"] = Math.max(0, Math.min(1, config.exaggeration));
    }
    if (typeof config.illuminationDirection === "number") {
        paint["hillshade-illumination-direction"] = config.illuminationDirection;
    }
    if (config.illuminationAnchor) {
        paint["hillshade-illumination-anchor"] = config.illuminationAnchor;
    }

    return { id: layerId, type: "hillshade", source: sourceId, paint };
}

/**
 * Returns the tiles array from an existing `raster-dem` map source, or null.
 * MapLibre exposes `.tiles` on the source spec; this may be absent in some versions.
 * @internal
 */
function _getExistingDemTiles(map: NativeMap, sourceId: string): string[] | null {
    if (!map?.getSource) return null;
    const src = map.getSource(sourceId);
    if (!src) return null;
    return Array.isArray(src.tiles) ? src.tiles : null;
}

/**
 * Returns `true` when the `terrain-dem` source exists and contains `demUrl`.
 * @internal
 */
function _canReuseTerrainSource(map: NativeMap, demUrl: string): boolean {
    const tiles = _getExistingDemTiles(map, TERRAIN_DEM_SOURCE_ID);
    return tiles !== null && tiles.includes(demUrl);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Builds a MapLibre `raster-dem` source spec for a hillshade basemap.
 * Pure factory — does not call any map API.
 *
 * @param definition - Basemap config with `hillshade.demUrl` (or top-level `demUrl`).
 * @returns The raster-dem source spec.
 */
export function buildHillshadeSourceSpec(definition: BasemapDefinition): Record<string, unknown> {
    const config: Partial<HillshadeConfig> = definition?.hillshade ?? {};
    const demUrl = config.demUrl ?? definition.demUrl ?? "";
    const encoding = config.demEncoding ?? definition.demEncoding ?? "terrarium";
    const maxzoom =
        typeof config.demMaxZoom === "number"
            ? config.demMaxZoom
            : typeof definition.demMaxZoom === "number"
              ? definition.demMaxZoom
              : 15;

    return {
        type: "raster-dem",
        tiles: [demUrl],
        encoding,
        tileSize: 256,
        maxzoom,
    };
}

/**
 * Applies a hillshade basemap to the map.
 *
 * - Reuses `terrain-dem` source if it already covers the same DEM URL.
 * - Otherwise adds a new `raster-dem` source using `HILLSHADE_SOURCE_ID`.
 * - Inserts the hillshade layer below all existing layers.
 *
 * @param map - Native `maplibregl.Map` instance.
 * @param definition - Basemap config with `hillshade` settings.
 * @param layerId - Layer ID. Defaults to `"__geoleaf_basemap_layer__"`.
 * @returns The source ID actually used (`"terrain-dem"` or `"__geoleaf_basemap__"`).
 */
export function applyHillshadeBasemap(
    map: NativeMap,
    definition: BasemapDefinition,
    layerId = BASEMAP_LAYER_ID
): string {
    const config: Partial<HillshadeConfig> = definition?.hillshade ?? {};
    const demUrl: string = config.demUrl ?? definition.demUrl ?? "";

    if (!demUrl) {
        Log.error("[GeoLeaf.Hillshade] hillshade.demUrl is required.");
        return HILLSHADE_SOURCE_ID;
    }

    // Security: validate DEM URL before use
    const safeDemUrl = validateUrl(demUrl, ["http:", "https:"]);
    if (!safeDemUrl) {
        Log.error("[GeoLeaf.Hillshade] Invalid hillshade demUrl:", demUrl);
        return HILLSHADE_SOURCE_ID;
    }

    // Determine source to use
    let sourceId = HILLSHADE_SOURCE_ID;
    if (_canReuseTerrainSource(map, demUrl)) {
        sourceId = TERRAIN_DEM_SOURCE_ID;
        Log.debug("[GeoLeaf.Hillshade] Reusing terrain-dem source for hillshade.");
    } else if (!map.getSource?.(HILLSHADE_SOURCE_ID)) {
        map.addSource(HILLSHADE_SOURCE_ID, buildHillshadeSourceSpec(definition));
    }

    const layerSpec = _buildHillshadeLayerSpec(sourceId, layerId, config);
    insertBelow(map, layerSpec);

    Log.info("[GeoLeaf.Hillshade] Hillshade basemap applied (source:", sourceId, ")");
    return sourceId;
}

// ─── Overlay ──────────────────────────────────────────────────────────────────

/** Ids of the live layers, bottom to top. */
function _layerOrder(map: NativeMap): string[] {
    const layers = map.getStyle()?.layers ?? [];
    return layers.map((layer) => layer.id).filter((id): id is string => typeof id === "string");
}

/**
 * The layer that follows `id` in the live style, or `undefined` when `id` is the top one or is
 * not there. Inserting before it puts a layer right above `id`.
 */
function _layerAbove(map: NativeMap, id: string): string | undefined {
    const order = _layerOrder(map);
    const at = order.indexOf(id);
    return at < 0 ? undefined : order[at + 1];
}

/**
 * Where the overlay goes in a VECTOR basemap's style: before the layer the basemap names, else
 * before the style's first `symbol` layer, else right above the style's last layer — under
 * whatever was carried over it. `undefined` means on top.
 */
function _vectorAnchor(
    map: NativeMap,
    config: HillshadeConfig,
    key: string,
    landmarks: StyleLandmarks
): string | undefined {
    if (config.beforeLayer) {
        if (map.getLayer(config.beforeLayer)) return config.beforeLayer;
        Log.warn(
            `[GeoLeaf.Hillshade] basemap "${key}": hillshade.beforeLayer names "${config.beforeLayer}",` +
                ` which its style does not have. Falling back to the first symbol layer.`
        );
    }
    if (landmarks.firstSymbolId && map.getLayer(landmarks.firstSymbolId)) {
        return landmarks.firstSymbolId;
    }
    return landmarks.lastLayerId ? _layerAbove(map, landmarks.lastLayerId) : undefined;
}

/**
 * Key of the overlay's signature in its layer's `metadata`. NOT written `geoleaf:…`, the usual
 * prefix of a style metadata key: in this repository a `geoleaf:` string literal is an event
 * name, and the gate that types the dispatched events reads it as one.
 */
const SIGNATURE_KEY = "geoleaf-hillshade-signature";

/** The signature the live overlay layer was added with, or `null` when there is none. */
function _liveSignature(map: NativeMap): string | null {
    const layer = map.getLayer(OVERLAY_LAYER_ID) as
        { metadata?: Record<string, unknown> } | null | undefined;
    const signature = layer?.metadata?.[SIGNATURE_KEY];
    return typeof signature === "string" ? signature : null;
}

/** What the overlay's `visibility` must be for the terrain the map holds right now. */
function _visibilityWithTerrain(map: NativeMap): "visible" | "none" {
    return map.getTerrain() ? "visible" : "none";
}

/**
 * The engine's `terrain` event: a terrain was put on, replaced or taken off — by the kernel, or
 * by the engine itself when it rebuilds a style. An overlay that follows the terrain is shown or
 * hidden with it; hidden, the layer reads nothing, and its `raster-dem` source requests no tile.
 *
 * Registered only while such an overlay is on the map, and taken back with it
 * (`removeHillshadeOverlay`): an overlay that does not follow the terrain never hears of it. A
 * module-level function, so nothing is remembered here — the map is the one the event names.
 *
 * The overlay may be GONE when the event comes: a style the engine rebuilds takes the layer away
 * and resets the terrain in the same breath, before the kernel has put anything back.
 */
function _onTerrainChange(event: NativeMapErrorEvent): void {
    const map = event?.target;
    if (!map) return;
    try {
        if (!map.getLayer(OVERLAY_LAYER_ID)) return;
        map.setLayoutProperty(OVERLAY_LAYER_ID, "visibility", _visibilityWithTerrain(map));
    } catch (e) {
        // A style being replaced refuses the write; the overlay is put back with the style.
        Log.debug("[GeoLeaf.Hillshade] Overlay visibility not set:", e);
    }
}

/**
 * Reads the hillshade OVERLAY a basemap declares, if it declares one that can be drawn.
 *
 * `null` without a word when the basemap asks for none: no `hillshade.overlay`, or a basemap of
 * `type: "hillshade"`, whose shading is the basemap itself. `null` with an error logged when it
 * asks for one without a usable `demUrl`.
 *
 * @param definition - The basemap definition from the registry.
 * @param key - The basemap key, for the log messages.
 * @returns The `hillshade` block to draw as an overlay, or `null`.
 */
export function resolveHillshadeOverlay(
    definition: BasemapDefinition,
    key: string
): HillshadeConfig | null {
    const config = definition?.hillshade;
    if (!config?.overlay || definition.type === "hillshade") return null;

    const demUrl: string = config.demUrl ?? definition.demUrl ?? "";
    if (!demUrl) {
        Log.error(
            `[GeoLeaf.Hillshade] basemap "${key}" has hillshade.overlay: true but hillshade.demUrl` +
                ` is missing. The overlay will not be drawn.`
        );
        return null;
    }
    if (!validateUrl(demUrl, ["http:", "https:"])) {
        Log.error(`[GeoLeaf.Hillshade] basemap "${key}": invalid hillshade demUrl:`, demUrl);
        return null;
    }
    if (config.onlyWithTerrain && !definition.terrain?.enabled) {
        Log.warn(
            `[GeoLeaf.Hillshade] basemap "${key}" has hillshade.onlyWithTerrain: true and no` +
                ` enabled terrain. Its overlay will never show.`
        );
    }
    return config;
}

/**
 * Removes the hillshade overlay, layer first then source. A no-op when there is none.
 *
 * @param map - Native `maplibregl.Map` instance.
 */
export function removeHillshadeOverlay(map: NativeMap): void {
    try {
        map.off?.("terrain", _onTerrainChange);
        if (map.getLayer?.(OVERLAY_LAYER_ID)) map.removeLayer(OVERLAY_LAYER_ID);
        if (map.getSource?.(OVERLAY_SOURCE_ID)) map.removeSource(OVERLAY_SOURCE_ID);
    } catch (e) {
        Log.warn("[GeoLeaf.Hillshade] Cannot remove the hillshade overlay:", e);
    }
}

/**
 * Brings the hillshade overlay in line with the basemap that just became active: drawn where
 * that basemap wants it, or gone when it declares none. Called once the basemap is in place, on
 * every activation path.
 *
 * - An image basemap (tiles, WMS, WMTS, georeferenced image): right above the basemap's layer,
 *   under everything else. When that layer is not there — a WMTS still resolving, an apply that
 *   failed — there is nothing to lay the shading over, and the overlay is removed.
 * - A vector basemap: before `hillshade.beforeLayer`, else before the first `symbol` layer of
 *   its style, else right above the style's last layer.
 *
 * The overlay already on the map is left untouched when it is the one asked for — its source
 * spec, its paint and the layer it was asked to sit before, kept as a signature in the layer's
 * own `metadata`. No state lives outside the map: a style change takes the signature away with
 * the layer.
 *
 * It is NOT declared to the style transform: carried layers are appended above every layer of
 * the incoming style, labels included. A style change drops the overlay, and this puts it back.
 *
 * With `hillshade.onlyWithTerrain` the overlay is added hidden or shown, as the map holds a
 * terrain or not at that moment, and follows the terrain from then on. The basemap's terrain is
 * settled AFTER this runs, on every path: the overlay learns of it from the engine.
 *
 * Never throws: an overlay that cannot be drawn must not keep the basemap switch from finishing.
 *
 * @param map - Native `maplibregl.Map` instance.
 * @param definition - The definition of the basemap now active.
 * @param key - Its key, for the log messages.
 * @param landmarks - The landmarks of a vector basemap's style, read as it arrived. Without them
 *   the live style is read instead — exact as long as nothing was carried into it.
 */
export function syncHillshadeOverlay(
    map: NativeMap,
    definition: BasemapDefinition,
    key: string,
    landmarks?: StyleLandmarks | null
): void {
    try {
        const config = resolveHillshadeOverlay(definition, key);
        const vector = _resolveBasemapType(definition) === "vector";
        if (!config || (!vector && !map.getLayer(BASEMAP_LAYER_ID))) {
            removeHillshadeOverlay(map);
            return;
        }

        const sourceSpec = buildHillshadeSourceSpec(definition);
        const layerSpec = _buildHillshadeLayerSpec(OVERLAY_SOURCE_ID, OVERLAY_LAYER_ID, config);
        const asked = vector ? (config.beforeLayer ?? null) : null;
        const follows = config.onlyWithTerrain === true;
        const signature = JSON.stringify([sourceSpec, layerSpec.paint, asked, follows]);
        if (_liveSignature(map) === signature) return;

        removeHillshadeOverlay(map);
        // The anchor is settled BEFORE the source is added: the engine refuses a layer whose
        // anchor is missing without throwing, and the source would stay behind, read by nothing.
        const anchor = vector
            ? _vectorAnchor(map, config, key, landmarks ?? readStyleLandmarks(map.getStyle()))
            : _layerAbove(map, BASEMAP_LAYER_ID);
        map.addSource(OVERLAY_SOURCE_ID, sourceSpec);
        layerSpec.metadata = { [SIGNATURE_KEY]: signature };
        if (follows) {
            layerSpec.layout = { visibility: _visibilityWithTerrain(map) };
            map.on("terrain", _onTerrainChange);
        }
        if (anchor) map.addLayer(layerSpec, anchor);
        else map.addLayer(layerSpec);
        Log.info("[GeoLeaf.Hillshade] Hillshade overlay applied for basemap:", key);
    } catch (e) {
        Log.error("[GeoLeaf.Hillshade] Cannot apply the hillshade overlay:", e);
    }
}
