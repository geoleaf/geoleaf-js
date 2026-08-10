/*!
 * GeoLeaf Core – Baselayers / Registry
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Sprint 3: rewritten to use the native MapLibre GL API.
 * The map instance stored here is a raw `maplibregl.Map`,
 * not an IMapAdapter wrapper.
 * https://geoleaf.dev
 */

import { Log } from "../../utils/log/index.js";
import {
    _core,
    _map,
    _activeKey,
    _activeType,
    _wmtsAbort,
    _setMap,
    _setActiveKey,
    _setActiveType,
    _setWmtsAbort,
    _nextStyleGeneration,
    _activationRequest,
    _nextActivationRequest,
} from "./basemaps-state.js";
import {
    _applyWmtsBasemap,
    _applyViaStyleChange,
    _dispatchBasemapChange,
    _handleTerrainOnSyncSwitch,
    _applySyncBasemapByType,
} from "./basemaps-strategies.js";
import { activateTerrain, resolveTerrainConfig } from "./terrain.js";
import {
    _resolveBasemapType,
    _trySwitchByTiles,
    BASEMAP_SOURCE_ID,
    BASEMAP_LAYER_ID,
} from "./basemaps-apply.js";
import type {
    BasemapDefinition,
    BaseLayerEntry,
    NativeMap,
    NativeMapHolder,
    SetBaseLayerOptions,
} from "./basemaps-types.js";

// ─── State ───────────────────────────────────────────────────────────────────

/**
 * Registry of all registered basemaps.
 * Each entry: `{ key, label, definition: BasemapConfig, layer: null }`
 * `layer: null` is a backward-compat tombstone — no layer instance is stored.
 */
export const _baseLayers: Record<string, BaseLayerEntry> = Object.create(null) as Record<
    string,
    BaseLayerEntry
>;

// ─── Map resolution ──────────────────────────────────────────────────────────

/**
 * Duck-type check for a native maplibregl.Map instance.
 * Detects the presence of `addSource` and `addLayer` methods.
 */
function _isNativeMaplibreMap(m: unknown): m is NativeMap {
    if (m == null || typeof m !== "object") return false;
    const candidate = m as { addSource?: unknown; addLayer?: unknown };
    return typeof candidate.addSource === "function" && typeof candidate.addLayer === "function";
}

/**
 * Resolves and caches the native maplibregl.Map instance.
 *
 * Resolution order:
 * 1. Explicit map passed as argument (must pass _isNativeMaplibreMap).
 * 2. Already-cached `_map` (if still a valid native map).
 * 3. Fallback via `GeoLeaf.Core.getMap().getNativeMap()`.
 */
export function _acquireNativeMap(explicitMap?: unknown) {
    if (explicitMap && _isNativeMaplibreMap(explicitMap)) {
        _setMap(explicitMap);
        Log.info("[GeoLeaf.Baselayers] _acquireNativeMap: using explicit native maplibregl.Map.");
        return;
    }

    if (_map && _isNativeMaplibreMap(_map)) return;

    const adapter = _core()?.getMap?.();
    const native =
        adapter && typeof adapter.getNativeMap === "function" ? adapter.getNativeMap() : null;

    if (native && _isNativeMaplibreMap(native)) {
        _setMap(native);
        Log.info(
            "[GeoLeaf.Baselayers] _acquireNativeMap: acquired via Core.getMap().getNativeMap()."
        );
    }
}

/**
 * Caches the map the basemap registry operates on.
 *
 * Accepts either a raw `maplibregl.Map` or an `IMapAdapter`, which is unwrapped through
 * `getNativeMap()` — the registry works against the native API since Sprint 3. `null` clears
 * the cache, which is what destroy flows and tests use.
 *
 * ⚠️ A value that is neither a native map nor an adapter yielding one is **silently
 * ignored**: the previous map stays cached and no error is raised.
 *
 * @param mapInstance - Native map, adapter, or `null` to clear.
 */
export function setMap(mapInstance: unknown) {
    // Accept null/undefined to clear the cached map (used in tests and destroy flows).
    if (mapInstance == null) {
        _setMap(null);
        return;
    }
    // Accept an IMapAdapter — unwrap to native map via getNativeMap().
    const holder = mapInstance as Partial<NativeMapHolder>;
    if (typeof holder.getNativeMap === "function") {
        const native = holder.getNativeMap();
        if (_isNativeMaplibreMap(native)) {
            _setMap(native);
            return;
        }
    }
    if (_isNativeMaplibreMap(mapInstance)) {
        _setMap(mapInstance);
    }
}

/**
 * The native map currently cached by the registry, or `null` before {@link setMap} ran.
 *
 * @returns The raw `maplibregl.Map`, never an adapter.
 */
export function getInternalMap(): NativeMap | null {
    return _map;
}

// ─── Switcher ────────────────────────────────────────────────────────────────

/**
 * Removes the currently active raster basemap source and layer.
 * Only used by the sync path (raster→raster). Vector basemaps are handled
 * entirely by `_applyViaStyleChange()` which calls `setStyle()`.
 */
function _removeCurrentBasemap(): void {
    if (!_map || _activeType !== "raster") return;
    try {
        if (_map.getLayer?.(BASEMAP_LAYER_ID)) {
            _map.removeLayer(BASEMAP_LAYER_ID);
        }
        if (_map.getSource?.(BASEMAP_SOURCE_ID)) {
            _map.removeSource(BASEMAP_SOURCE_ID);
        }
    } catch (e) {
        Log.warn("[GeoLeaf.Baselayers] Cannot remove current basemap:", e);
    }
}

// ─── Registration ────────────────────────────────────────────────────────────

/**
 * Registers a single basemap definition by key.
 * No map API calls are made at registration time — the definition is stored
 * and applied lazily when `setBaseLayer()` is called.
 *
 * If the key is already registered (e.g. from `registerDefaultBaseLayers`),
 * the new definition is shallow-merged on top of the existing one so that
 * profile overrides (apiKey, defaultBasemap, label, offline…) take effect
 * without losing the structural fields (tiles, wmts, attribution…) already
 * provided by the default entry.
 */
/**
 * Registers one basemap definition under a key.
 *
 * Registering does not activate: the basemap becomes selectable, and
 * {@link setBaseLayer} applies it. Re-registering a key replaces the definition.
 *
 * A missing key or definition logs a warning and returns — this never throws.
 *
 * @param key - Identifier used by `setBaseLayer` and by the `data-gl-baselayer` controls.
 * @param definition - The basemap definition (type, url, attribution…).
 *
 * @example
 * ```js
 * GeoLeaf.Baselayers.registerBaseLayer("mytiles", {
 *     id: "mytiles",
 *     label: "Mes tuiles",
 *     url: "https://tiles.example.com/{z}/{x}/{y}.png",
 *     attribution: "© Example Tiles",
 *     maxZoom: 20,
 * });
 * ```
 */
export function registerBaseLayer(key: string, definition: BasemapDefinition) {
    if (!key) {
        Log.warn("[GeoLeaf.Baselayers] registerBaseLayer called without key.");
        return;
    }

    if (!definition) {
        Log.warn("[GeoLeaf.Baselayers] Missing definition for layer:", key);
        return;
    }

    const actualKey = definition.id || key;

    // Merge with existing entry when re-registering a known key (e.g. profile override)
    const existing = _baseLayers[actualKey]?.definition;
    const merged: BasemapDefinition = existing ? { ...existing, ...definition } : definition;

    const label = merged.label || actualKey;

    // Validate: must have url, tiles, style, or be one of the extended raster types
    const hasRaster = !!merged.url || (Array.isArray(merged.tiles) && merged.tiles.length > 0);
    const hasVector = !!(merged.style || merged.type === "maplibre");
    const hasExtendedType =
        typeof merged.type === "string" &&
        ["image", "hillshade", "wmts", "wms"].includes(merged.type);

    if (!hasRaster && !hasVector && !hasExtendedType) {
        Log.warn(
            "[GeoLeaf.Baselayers] Invalid definition for layer:",
            actualKey,
            "(no url / tiles / style / type provided)"
        );
        return;
    }

    _baseLayers[actualKey] = {
        key: actualKey,
        label,
        definition: merged,
        layer: null, // tombstone — no layer instance
    };

    // Validate terrain config at registration time (boot-time warnings/errors)
    if (merged.terrain?.enabled) {
        resolveTerrainConfig(merged, actualKey);
    }
}

/**
 * Registers several basemap definitions at once, keyed by basemap id.
 *
 * A convenience wrapper over `registerBaseLayer` — this is the call the profile loader makes
 * with the whole `basemaps` block of a profile.
 *
 * ⚠️ Not transactional: entries are registered in iteration order, and one malformed
 * definition does not roll back those already accepted. A non-object argument logs a warning
 * and registers nothing.
 *
 * @param definitions - Map of basemap key to definition.
 *
 * @example
 * ```js
 * registerBaseLayers({
 *     street: {
 *         type: "raster",
 *         name: "Plan",
 *         url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
 *         attribution: "© OpenStreetMap",
 *     },
 *     satellite: { type: "raster", name: "Satellite", url: "https://…/{z}/{x}/{y}.jpg" },
 * });
 * ```
 */
export function registerBaseLayers(definitions: Record<string, BasemapDefinition>) {
    if (!definitions || typeof definitions !== "object") {
        Log.warn("[GeoLeaf.Baselayers] registerBaseLayers expects a definitions object.");
        return;
    }

    Object.entries(definitions).forEach(([key, def]) => registerBaseLayer(key, def));
}

// ─── Activation ──────────────────────────────────────────────────────────────

/**
 * Sync raster→raster switch: removes the old basemap, applies the new one,
 * activates terrain, and dispatches the change event.
 * @internal
 */
/** Bookkeeping shared by both sync paths (mutation and rebuild). @internal */
function _finishSyncSwitch(
    key: string,
    previousKey: string | null,
    definition: BasemapDefinition,
    options: SetBaseLayerOptions
): void {
    _setActiveKey(key);
    Log.info("[GeoLeaf.Baselayers] Active basemap:", key);
    _handleTerrainOnSyncSwitch(key, definition);
    if (!options.silent) _dispatchBasemapChange(key, previousKey, definition);
}

function _applySyncRasterSwitch(
    nativeMap: NativeMap,
    definition: BasemapDefinition,
    key: string,
    previousKey: string | null,
    options: SetBaseLayerOptions
): void {
    // Supersede any in-flight async switch BEFORE touching the map (backlog B.12).
    // This path is synchronous, so without these two lines a WMTS GetCapabilities still
    // resolving would pass its own staleness check — `_styleGeneration` never moved — and
    // apply its tiles ON TOP of the raster basemap the user just picked. The other two
    // paths (`_applyViaStyleChange`, `_applyWmtsBasemap`) already do this; only the sync
    // raster path was missing it, which is exactly why the race was invisible from a
    // reading of the async code.
    _wmtsAbort?.abort();
    _setWmtsAbort(null);
    _nextStyleGeneration();

    // Mutate the live source when only the tiles change — no destroy/rebuild, no flash.
    const previous = previousKey ? _baseLayers[previousKey]?.definition : null;
    if (
        _activeType === "raster" &&
        _trySwitchByTiles(nativeMap, previous, definition, (m, e) => Log.warn(m, e))
    ) {
        _finishSyncSwitch(key, previousKey, definition, options);
        return;
    }
    _removeCurrentBasemap();
    try {
        _applySyncBasemapByType(nativeMap, definition);
    } catch (e) {
        Log.error("[GeoLeaf.Baselayers] Cannot apply basemap:", e);
        return;
    }
    _finishSyncSwitch(key, previousKey, definition, options);
}

/**
 * Activates a registered basemap by key.
 *
 * Three code paths:
 * - **Vector path**: `setStyle()` — full style replacement via `_applyViaStyleChange()`.
 * - **WMTS async path**: fetch GetCapabilities, then inject raster source.
 * - **Sync raster path**: remove old source/layer, add new one.
 *
 * If the map style is not yet loaded, activation is deferred until `load`.
 */
/**
 * Activates a registered basemap.
 *
 * The switch takes one of two paths depending on the target: raster→raster mutates the
 * current style in place, while anything involving a vector basemap goes through a full
 * `setStyle()`. Either way the work is **deferred until the map is idle**, so the active key
 * is not guaranteed to have changed by the time this returns.
 *
 * An unknown or missing key logs a warning and leaves the current basemap in place.
 *
 * @param key - Key of a previously registered basemap.
 * @param options - `silent` suppresses the `geoleaf:basemap:change` event.
 *
 * @example
 * ```js
 * GeoLeaf.Baselayers.setBaseLayer("street");
 * ```
 */
export function setBaseLayer(key: string, options: SetBaseLayerOptions = {}) {
    if (!key) {
        Log.warn("[GeoLeaf.Baselayers] setBaseLayer called without key.");
        return;
    }

    const previousKey = _activeKey;
    _acquireNativeMap();
    Log.info("[GeoLeaf.Baselayers] setBaseLayer:", key, "_map=", !!_map);

    if (!_map) {
        Log.warn("[GeoLeaf.Baselayers] No maplibregl.Map available.");
        return;
    }

    if (!_baseLayers[key]) {
        Log.warn("[GeoLeaf.Baselayers] Unknown layer:", key);
        const [firstKey] = Object.keys(_baseLayers);
        if (!previousKey && firstKey) setBaseLayer(firstKey, { silent: true });
        return;
    }

    if (_activeKey === key) return;

    // Every genuine activation request takes a ticket, AFTER the guards above so that a
    // no-op or invalid call cannot cancel a legitimate pending deferral.
    const requestId = _nextActivationRequest();

    // Boot regression (F0/S8): the profile GeoJSON layers now load earlier (GeoJSONModule.init,
    // phase B5), so at initBasemaps time (UI #17) those sources are still in flight and the map
    // is not settled — `isStyleLoaded()` is false. Deferring on the one-shot `load` (or its
    // predicate `loaded()`) is unreliable here: `load` may already have fired, so the handler
    // never runs (basemap never applied). Defer instead on `idle` — the map fires it once it is
    // fully settled (style + sources + tiles, no transitions), which happens at boot WITHOUT a
    // user interaction, then re-run setBaseLayer (which now finds the style ready and applies).
    //
    // ⚠️ The ticket check is what makes the deferral safe (R.7b). Without it, this closure
    // re-applies the key it captured whenever `idle` finally fires — including LONG after the
    // user picked a different basemap, which it then silently overwrites. Measured on the
    // `tourism` profile: `positron` applied, then ~500 ms later the map snapped back to the
    // boot basemap `terrain-terrarium`, and the layer labels were destroyed by the round trip
    // without being rebuilt. Nothing was logged on either side.
    if (typeof _map.isStyleLoaded === "function" && !_map.isStyleLoaded()) {
        _map.once("idle", () => {
            if (requestId !== _activationRequest) {
                Log.info("[GeoLeaf.Baselayers] deferred activation superseded, skipping:", key);
                return;
            }
            setBaseLayer(key, options);
        });
        return;
    }

    const definition = _baseLayers[key].definition;
    const targetType = _resolveBasemapType(definition);

    if (targetType === "vector" || _activeType === "vector") {
        _applyViaStyleChange(_map, definition, targetType, key, previousKey, options);
    } else if (definition.type === "wmts") {
        _removeCurrentBasemap();
        _applyWmtsBasemap(_map, definition, key, previousKey, options);
    } else {
        _applySyncRasterSwitch(_map, definition, key, previousKey, options);
    }
}

// ─── Refresh ─────────────────────────────────────────────────────────────────

/**
 * Re-applies the active raster basemap when its source has been lost from the
 * style without a deliberate basemap switch (e.g., race with a plugin that adds
 * layers inside the same `map.on("load")` dispatch as the deferred setBaseLayer).
 *
 * No-op when:
 * - no basemap is considered active (`_activeKey` is null)
 * - the active basemap is vector (managed by `setStyle`, not this path)
 * - the basemap source is already present in the style
 *
 * Does NOT emit `geoleaf:basemap:change` — this is an internal re-apply, not a
 * user-visible basemap change.
 */
export function refreshBasemap(): void {
    if (!_map || !_activeKey || _activeType !== "raster") return;
    if (_map.getSource?.(BASEMAP_SOURCE_ID)) return;

    const entry = _baseLayers[_activeKey];
    if (!entry) return;

    Log.info("[GeoLeaf.Baselayers] refreshBasemap: source absent, re-applying:", _activeKey);
    try {
        _removeCurrentBasemap();
        _applySyncBasemapByType(_map, entry.definition);
        const terrainConfig = resolveTerrainConfig(entry.definition, _activeKey);
        if (terrainConfig?.default3D) {
            activateTerrain(_map, terrainConfig, _activeKey);
        }
    } catch (e) {
        Log.error("[GeoLeaf.Baselayers] refreshBasemap failed:", e);
    }
}

// ─── Accessors ───────────────────────────────────────────────────────────────

/**
 * A snapshot of every registered basemap, keyed by id.
 *
 * The returned object is a **shallow copy**: adding or removing keys on it does not touch the
 * registry, but the entries themselves are shared and must not be mutated.
 *
 * @returns Registered basemap definitions, by key.
 */
export function getBaseLayers() {
    return { ..._baseLayers };
}

/** @internal Resets transient activation state. Used only in test environments. */
export function _resetStateForTesting(): void {
    _setActiveKey(null);
    _setActiveType(null);
    _wmtsAbort?.abort();
    _setWmtsAbort(null);
}

/**
 * The key of the active basemap, or `null` when none has been applied yet.
 *
 * @returns The active basemap key.
 */
export function getActiveKey() {
    return _activeKey;
}

/**
 * Returns the `BasemapConfig` definition of the currently active basemap.
 * Returns `null` when no basemap is active.
 *
 * NOTE: unlike the pre-Sprint-3 version, this no longer returns a
 * layer instance. The `layer` field on each `_baseLayers` entry is always
 * `null` and exists only for backward compatibility.
 */
export function getActiveLayer() {
    if (!_activeKey || !_baseLayers[_activeKey]) return null;
    return _baseLayers[_activeKey]?.definition ?? null;
}
