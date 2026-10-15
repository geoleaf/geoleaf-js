/*!
 * GeoLeaf Core – Baselayers / Registry
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Rewritten to use the native MapLibre GL API.
 * The map instance stored here is a raw `maplibregl.Map`,
 * not an IMapAdapter wrapper.
 * https://geoleaf.dev
 */

import { Log } from "../../utils/log/index.js";
// The events a deferred activation re-tests `isStyleLoaded()` on — ONE list for every wait on
// the style. The measurement that chose them is written out in `setBaseLayer`, below.
import { STYLE_READY_EVENTS } from "../../utils/general/style-ready.js";
import { hasDrawableBasemapShape } from "../../utils/general/basemap-shape.js";
import {
    _core,
    _map,
    _activeKey,
    _activeType,
    _wmtsAbort,
    _landedStyleKey,
    _landedStyleLandmarks,
    _setLandedStyleKey,
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
import { resetTerrain, syncTerrainToBasemap, validateTerrainConfig } from "./terrain.js";
import {
    removeHillshadeOverlay,
    resolveHillshadeOverlay,
    syncHillshadeOverlay,
} from "./hillshade.js";
import {
    _resolveBasemapType,
    _trySwitchByTiles,
    declaredAttribution,
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
 * `getNativeMap()` — the registry works against the native API. `null` clears
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

    // Validate: must have url, tiles, style, or be one of the extended types — the same
    // predicate the profile check warns with.
    if (!hasDrawableBasemapShape(merged)) {
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
        validateTerrainConfig(merged, actualKey);
    }
    // Same for a hillshade overlay: one that cannot be drawn is said here, not at first use.
    if (merged.hillshade?.overlay) {
        resolveHillshadeOverlay(merged, actualKey);
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
    // The landmarks only matter to a vector basemap, which reaches this function through the
    // shared-style switch alone: they are those of the style the map already holds.
    if (_map) syncHillshadeOverlay(_map, definition, key, _landedStyleLandmarks);
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
        // The slot is empty: the previous basemap's overlay has nothing left under it.
        removeHillshadeOverlay(nativeMap);
        return;
    }
    _finishSyncSwitch(key, previousKey, definition, options);
}

/** A style as two definitions can be compared by: its URL, or its content when given inline. */
function _styleIdentity(definition: BasemapDefinition): string | null {
    const style: unknown = definition.style;
    if (style === undefined || style === null) return null;
    return typeof style === "string" ? style : JSON.stringify(style);
}

/**
 * True when `next` draws the very style the map already holds for the active basemap: same
 * `style`, same declared credit, and that style has LANDED — not merely been asked for.
 *
 * The credit is part of the test because it travels in the incoming style: two basemaps that
 * differ by it do need a `setStyle`.
 */
function _sharesLandedStyle(
    previousKey: string | null,
    next: BasemapDefinition,
    targetType: string
): boolean {
    if (targetType !== "vector" || !previousKey || _landedStyleKey !== previousKey) return false;
    const previous = _baseLayers[previousKey]?.definition;
    const identity = previous ? _styleIdentity(previous) : null;
    if (!previous || identity === null) return false;
    return (
        identity === _styleIdentity(next) &&
        declaredAttribution(previous) === declaredAttribution(next)
    );
}

/**
 * Switches between two vector basemaps that share one style, WITHOUT asking the engine for it.
 *
 * Asking would not work: the diff between the live style and the same style holds no operation,
 * and MapLibre then returns before it fires `style.load` — the handler that finishes a style
 * change never ran, so the selector showed the new basemap while its relief and
 * `geoleaf:basemap:change` never came. There is nothing to load, hence nothing to wait for: what
 * differs between the two basemaps is what `_finishSyncSwitch` applies.
 * @internal
 */
function _applySameStyleSwitch(
    definition: BasemapDefinition,
    key: string,
    previousKey: string | null,
    options: SetBaseLayerOptions
): void {
    _nextStyleGeneration();
    // Read before the switch: the landmarks belong to the style, which stays.
    const landmarks = _landedStyleLandmarks;
    _finishSyncSwitch(key, previousKey, definition, options);
    _setLandedStyleKey(key, landmarks);
}

/**
 * Activates a registered basemap.
 *
 * The switch takes one of two paths depending on the target: raster→raster mutates the
 * current style in place (a WMTS basemap fetches its GetCapabilities first), while anything
 * involving a vector basemap goes through a full `setStyle()` — except between two vector
 * basemaps that share one style and one credit, where the style already on the map is kept and
 * only what differs between them is applied. Either way the work is
 * **deferred until the style is loaded** — re-tested on `styledata`, `sourcedata` and `idle`,
 * never on the one-shot `load` —, so the active key is not guaranteed to have changed by the
 * time this returns. The last call wins: a deferred activation is dropped by any later call that
 * asks for another basemap, the active one included.
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

    // Asking for the ACTIVE basemap is not a no-op when another one waits on a deferral: it is
    // the user's last choice, and it must supersede that deferral. Returning before the ticket
    // let B — asked while the style loaded, then A asked again — apply when the style got ready.
    // The ticket costs nothing when nothing is pending.
    if (_activeKey === key) {
        _nextActivationRequest();
        return;
    }

    // Every other genuine activation request takes a ticket, AFTER the guards above so that an
    // invalid call cannot cancel a legitimate pending deferral.
    const requestId = _nextActivationRequest();

    // Boot regression (F0/S8): the profile GeoJSON layers now load earlier (GeoJSONModule.init,
    // phase B5), so at initBasemaps time (UI #17) those sources are still in flight and the map
    // is not settled — `isStyleLoaded()` is false. The activation is therefore deferred, and
    // WHICH EVENT IT WAITS ON IS THE WHOLE QUESTION. Two constraints bound the answer, and each
    // one was paid for:
    //
    // 🛑 NOT the one-shot `load` (nor its predicate `loaded()`): it may ALREADY have fired when
    // the deferral is armed, the handler then never runs, and the basemap is never applied.
    //
    // 🛑 NOT `idle` ALONE either, though it was the previous answer. `idle` fires once the map
    // is FULLY settled — style, sources, tiles, no transition in flight — which is strictly
    // stronger than what this deferral needs, and a rich profile may simply never reach it.
    // Measured on the public nightly E2E run 35580569108 (21/09/2026), `tourism`, 43 layers and
    // third-party tiles: no `idle` at boot at all. The run's first one was provoked ~20 s later
    // by the user's own first gesture — and the basemap, applied at last, tilted the camera to
    // `pitch: 60` through `terrain.default3D` IN THE MIDDLE OF THAT GESTURE (see
    // `_applyTerrainToMap` in `terrain.ts` — animated then, posted at once since). The drag was
    // lost and the edit persisted an unmoved geometry.
    //
    // 🛑 AND NOT `styledata` ALONE — the correction this replaces, measured wrong on
    // `deploy-full`/`tourism` at boot, with no interaction:
    //
    //     232 / 275 / 291 / 429 / 489 ms   styledata   isStyleLoaded() === false
    //     629 ms                           isStyleLoaded() flips — carried by `sourcedata`
    //     804 / 1940 ms                    idle        isStyleLoaded() === true
    //
    // The last `styledata` lands 140 ms BEFORE the predicate flips, and none follows: the
    // listener woke five times, read `false` five times, and was never called again. Being
    // emitted repeatedly is NOT the property that matters — coming AFTER the flip is.
    //
    // Hence all three. `isStyleLoaded()` covers the style AND its sources, so the emission that
    // carries it over the line is a `sourcedata` as often as a `styledata`; `idle` stays as a
    // net for a map that settles without either. The listener re-tests the predicate on each
    // emission and detaches from all three as soon as it applies.
    //
    // ⚠️ The ticket check is what makes the deferral safe. Without it, this closure
    // re-applies the key it captured whenever it finally wakes — including LONG after the
    // user picked a different basemap, which it then silently overwrites. Measured on the
    // `tourism` profile: `positron` applied, then ~500 ms later the map snapped back to the
    // boot basemap `terrain-terrarium`, and the layer labels were destroyed by the round trip
    // without being rebuilt. Nothing was logged on either side.
    if (typeof _map.isStyleLoaded === "function" && !_map.isStyleLoaded()) {
        const deferredMap = _map;
        const detach = () => {
            for (const evt of STYLE_READY_EVENTS) deferredMap.off?.(evt, onStyleReady);
        };
        const onStyleReady = () => {
            if (requestId !== _activationRequest) {
                detach();
                Log.info("[GeoLeaf.Baselayers] deferred activation superseded, skipping:", key);
                return;
            }
            if (typeof deferredMap.isStyleLoaded === "function" && !deferredMap.isStyleLoaded())
                return;
            detach();
            // 🛑 NOT HERE, IN THE ENGINE'S OWN EMISSION. MapLibre 6.7.0 fires a `sourcedata`
            // (`visibility`) from INSIDE `Style.update`, while looping over its tile managers —
            // when a source's layers were hidden for a frame and shown again. Replacing the style
            // here removed tile managers under that loop, which resumed on one that was gone:
            // `TypeError: Cannot read properties of undefined (reading 'used')` out of
            // `Map._render`, uncaught. A microtask runs once the render callback has returned,
            // still before the next frame; the ticket is read again there, since a newer request
            // may have come in between.
            queueMicrotask(() => {
                if (requestId !== _activationRequest) {
                    Log.info("[GeoLeaf.Baselayers] deferred activation superseded, skipping:", key);
                    return;
                }
                setBaseLayer(key, options);
            });
        };
        for (const evt of STYLE_READY_EVENTS) deferredMap.on(evt, onStyleReady);
        return;
    }

    const definition = _baseLayers[key].definition;
    const targetType = _resolveBasemapType(definition);

    if (_sharesLandedStyle(previousKey, definition, targetType)) {
        _applySameStyleSwitch(definition, key, previousKey, options);
    } else if (targetType === "vector" || _activeType === "vector") {
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
 * - the active basemap is a WMTS one whose GetCapabilities is still resolving: the resolution
 *   builds the source when it lands
 *
 * A WMTS basemap whose source is gone is resolved again rather than re-applied as it stands —
 * so it comes back asynchronously, where every other raster type comes back before this returns.
 *
 * The active basemap's hillshade overlay and terrain are checked along with it, and put back
 * when they went missing. The camera is left where the visitor put it: a refresh never posts
 * the basemap's `pitch` and `bearing` again.
 *
 * Does NOT emit `geoleaf:basemap:change` — this is an internal re-apply, not a
 * user-visible basemap change.
 */
export function refreshBasemap(): void {
    if (!_map || !_activeKey || _activeType !== "raster") return;
    if (_map.getSource?.(BASEMAP_SOURCE_ID)) return;

    const entry = _baseLayers[_activeKey];
    if (!entry) return;

    // A WMTS definition carries no tile URL: the one its GetCapabilities resolved to is not kept.
    // Re-applying the definition as it stands built a raster source with NO tile at all — and,
    // during a resolution, took the slot that resolution was about to fill: its own `addSource`
    // then threw on the id, and the basemap stayed empty.
    if (entry.definition.type === "wmts") {
        if (_wmtsAbort === null) {
            Log.info("[GeoLeaf.Baselayers] refreshBasemap: resolving WMTS again:", _activeKey);
            _applyWmtsBasemap(_map, entry.definition, _activeKey, _activeKey, { silent: true });
        }
        return;
    }

    Log.info("[GeoLeaf.Baselayers] refreshBasemap: source absent, re-applying:", _activeKey);
    try {
        _removeCurrentBasemap();
        _applySyncBasemapByType(_map, entry.definition);
        syncHillshadeOverlay(_map, entry.definition, _activeKey);
        syncTerrainToBasemap(_map, entry.definition, _activeKey);
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

/**
 * Forgets everything the registry learnt about the map an application tears down: the map, the
 * active basemap, the registered definitions, any activation still deferred on that map, and
 * the relief the terrain manager held on it.
 *
 * Called when an application is unmounted (`UIModule.destroy()`). Without it the next map got
 * NO basemap: the active key survived, and {@link setBaseLayer} returns early on the key that is
 * already active — it was active on the map that went away. The definitions are registered again
 * by the next `Baselayers.init`, defaults included.
 */
export function resetBasemapRegistry(): void {
    // A ticket and a generation taken now supersede an activation deferred on the old map, and a
    // WMTS request still in flight for it — each re-checks its own against these counters.
    _nextActivationRequest();
    _nextStyleGeneration();
    _wmtsAbort?.abort();
    _setWmtsAbort(null);
    _setActiveKey(null);
    _setActiveType(null);
    _setLandedStyleKey(null);
    // The relief goes with the map: left for active, it made the next map's first basemap
    // "leave" a relief that map never had, and flatten its camera doing so.
    resetTerrain();
    _setMap(null);
    for (const key of Object.keys(_baseLayers)) delete _baseLayers[key];
}

/** @internal Resets transient activation state. Used only in test environments. */
export function _resetStateForTesting(): void {
    _setActiveKey(null);
    _setActiveType(null);
    _setLandedStyleKey(null);
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
