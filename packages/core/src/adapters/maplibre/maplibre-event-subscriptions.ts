/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Delegated-listener subscription tracker for the MapLibre adapter.
 *
 * MapLibre's layer-scoped `map.on(type, layerId, handler)` registers a
 * *delegated listener* stored on the `Map` instance (not on the style). A
 * `setStyle()` basemap swap destroys the style's layers but leaves these
 * delegated listeners in place, so the post-rebuild re-bind adds a **second**
 * copy for every layer id — a listener leak and duplicated event dispatch
 * (audit-code_alignement-natif-maplibre, redundancy #2).
 *
 * This module records one cleanup thunk per delegated listener, keyed by the
 * native map, so the adapter can flush them all before a style rebuild and on
 * destroy. Core map events (`load`/`zoomstart`/`zoomend`/`moveend`, the 2-arg
 * form) are **not** tracked here: they survive style changes and are
 * owned/cleaned by the adapter directly via its named handler refs.
 *
 * The registry is a `WeakMap` keyed by the native map object, so multiple map
 * instances stay isolated and entries are GC'd with their map.
 */

/** A no-arg teardown that removes one previously-attached delegated listener. */
type CleanupThunk = () => void;

/** Per-map list of delegated-listener teardowns, keyed by the native map. */
const _cleanupsByMap = new WeakMap<object, CleanupThunk[]>();

/**
 * Records a cleanup thunk for a delegated listener attached to `map`.
 *
 * Call immediately after `map.on(type, layerId, handler)`, passing a thunk that
 * issues the matching `map.off(type, layerId, handler)` with the **same**
 * handler reference (MapLibre matches delegated listeners by identity).
 *
 * @param map - The native MapLibre map the listener is attached to.
 * @param cleanup - Teardown that detaches the listener.
 */
export function trackMapCleanup(map: object, cleanup: CleanupThunk): void {
    let list = _cleanupsByMap.get(map);
    if (!list) {
        list = [];
        _cleanupsByMap.set(map, list);
    }
    list.push(cleanup);
}

/**
 * Runs and discards every tracked cleanup for `map`, detaching all delegated
 * listeners recorded via {@link trackMapCleanup}. Safe to call repeatedly and
 * when nothing is tracked.
 *
 * Individual teardown errors are swallowed: after `setStyle()` the target layer
 * may already be gone, in which case `map.off()` is a harmless no-op but could
 * throw on an engine edge case — one failing teardown must not abort the rest.
 *
 * @param map - The native MapLibre map to flush.
 */
export function flushMapCleanups(map: object): void {
    const list = _cleanupsByMap.get(map);
    if (!list) return;
    for (const cleanup of list) {
        try {
            cleanup();
        } catch (error) {
            // Layer/source already removed by setStyle(); off() is a no-op.
            void error;
        }
    }
    _cleanupsByMap.delete(map);
}

/**
 * Test/introspection helper: number of delegated-listener cleanups currently
 * tracked for `map` (0 when the map is unknown). Not part of the runtime path.
 *
 * @param map - The native MapLibre map to inspect.
 * @returns The count of pending cleanups.
 */
export function trackedCleanupCount(map: object): number {
    return _cleanupsByMap.get(map)?.length ?? 0;
}
