/*!
 * GeoLeaf Core – Baselayers / Shared module state
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Mutable module state and ambient handles for the basemaps subsystem, extracted
 * from `registry.ts` so that the registry (orchestration) and the strategies
 * (map mutation) can share it without a circular import.
 *
 * Holds no business logic and calls no map API. Values are exported as live
 * bindings: readers import them directly, writers go through the setters below
 * (ESM forbids assigning to an imported binding).
 *
 * Note that `_baseLayers` deliberately stays in `registry.ts` — no strategy reads
 * it, and it is part of the registry's public surface.
 * https://geoleaf.dev
 */

import { Log } from "../../utils/log/index.js";
import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";
import type { BasemapsCoreSurface, NativeMap } from "./basemaps-types.js";

/** Resolves the `GeoLeaf.Core` surface used to acquire the live map / adapter. */
export function _core(): BasemapsCoreSurface | undefined {
    return getGeoLeaf()?.Core as BasemapsCoreSurface | undefined;
}

// ─── State ───────────────────────────────────────────────────────────────────

/** Native `maplibregl.Map` instance (null before init or after destroy). */
export let _map: NativeMap | null = null;

/** Key of the currently active basemap. */
export let _activeKey: string | null = null;

/**
 * Type of the currently active basemap — used by the switcher to know
 * whether a source+layer removal is needed before switching.
 * - 'raster' : was applied via addSource + addLayer
 * - 'vector' : was applied via setStyle (replaces the entire style)
 */
export let _activeType: "raster" | "vector" | null = null;

/**
 * Monotonically increasing counter used to guard against race conditions
 * when the user switches basemaps faster than `style.load` fires.
 * Each call to `_applyViaStyleChange()` increments the counter; the
 * `style.load` callback skips work if the generation no longer matches.
 * Also used by the WMTS async path as a stale-switch guard.
 */
export let _styleGeneration = 0;

/**
 * Monotonically increasing ticket taken by every ACTIVATION REQUEST reaching
 * `setBaseLayer()` — distinct from `_styleGeneration`, which counts style
 * APPLICATIONS (`_applyViaStyleChange` and the WMTS path).
 *
 * Exists because an activation can be DEFERRED: when the style is not loaded,
 * `setBaseLayer` re-arms itself on the map's `idle` event, capturing its key in
 * the closure. Nothing made that closure notice it had been superseded, so the
 * boot basemap could re-apply itself **on top of a basemap the user had since
 * chosen** — measured at R.7b on the `tourism` profile: `positron` applied, then
 * ~500 ms later the map silently snapped back to `terrain-terrarium`, and the
 * layer labels were destroyed by the round trip without being rebuilt. No error
 * was logged on either side.
 *
 * `_styleGeneration` could not serve here: a deferred request that never applies
 * anything does not move it, so a stale deferral would still pass its own check.
 */
export let _activationRequest = 0;

/** AbortController for any in-flight WMTS GetCapabilities request. */
export let _wmtsAbort: AbortController | null = null;

// ─── Setters ─────────────────────────────────────────────────────────────────

/** Sets the live native map instance (null on teardown). */
export function _setMap(map: NativeMap | null): void {
    _map = map;
}

/** Listener notified whenever the active basemap key is set. */
type ActiveKeyListener = (key: string | null) => void;

const _activeKeyListeners = new Set<ActiveKeyListener>();

/**
 * Subscribes to active-basemap-key changes. Returns an unsubscribe function.
 *
 * Exists because the UI cannot learn about activation any other way at boot:
 * `setBaseLayer` defers until the map is idle (style + sources still in flight),
 * and both boot call sites pass `silent: true`, which suppresses the public
 * `geoleaf:basemap:change` event. The UI therefore rendered its buttons, ran
 * `refreshUI()` against a still-null key, and never re-synced — leaving no
 * button highlighted until the user clicked one.
 *
 * Hooking `_setActiveKey` rather than the event keeps this path-agnostic: it
 * fires for the sync raster, WMTS and vector (`setStyle`) paths alike, and
 * regardless of `silent`. State owns no UI import, so no cycle is created.
 */
export function _onActiveKeyChange(listener: ActiveKeyListener): () => void {
    _activeKeyListeners.add(listener);
    return () => {
        _activeKeyListeners.delete(listener);
    };
}

/** Sets the key of the currently active basemap, notifying subscribers. */
export function _setActiveKey(key: string | null): void {
    _activeKey = key;
    // Notified unconditionally (not only on change): listeners are idempotent
    // re-syncs, and a no-op guard here would alter existing re-set semantics.
    for (const listener of _activeKeyListeners) {
        try {
            listener(key);
        } catch (err) {
            Log.warn("[GeoLeaf.Baselayers] active-key listener failed:", err);
        }
    }
}

/** Sets the render type of the currently active basemap. */
export function _setActiveType(type: "raster" | "vector" | null): void {
    _activeType = type;
}

/**
 * Increments the style generation and returns the new value.
 *
 * Pre-increment semantics are the contract: the caller keeps the value its own
 * invocation owns, and later compares it against the counter to detect that a
 * newer switch has superseded it. Returning the pre-increment value would invert
 * the guard.
 */
export function _nextStyleGeneration(): number {
    return ++_styleGeneration;
}

/**
 * Takes the next activation ticket and returns it.
 *
 * Same pre-increment contract as {@link _nextStyleGeneration}: the caller keeps
 * the value its own request owns and later compares it against the counter to
 * learn that a newer request has superseded it.
 */
export function _nextActivationRequest(): number {
    return ++_activationRequest;
}

/** Stores the in-flight WMTS AbortController (null when no request is pending). */
export function _setWmtsAbort(controller: AbortController | null): void {
    _wmtsAbort = controller;
}
