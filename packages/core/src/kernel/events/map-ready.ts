/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * `geoleaf:map:ready`, announced ONCE per map.
 *
 * Two places announce it, for good reasons each: the MapLibre adapter on the engine's `load`
 * (the earliest moment the map can draw — the route capability sweeps its layers there), and
 * the boot's reveal just before `geoleaf:app:ready` (the safety net plugins loaded late rely
 * on). Until 3.20.6 both dispatched it, so every subscriber ran twice per boot. They now go
 * through {@link announceMapReady}: the first of the two dispatches, the second is silent for
 * that map — which is exactly what subscribers already received, minus the duplicate.
 *
 * Keyed by map, not by page: several maps may coexist (`Core.listMaps()`), and a subscriber
 * wiring itself « once per map » (the editor) must still hear each one.
 */

import { dispatchGeoLeafEvent } from "./event-bus.js";

/** Maps whose readiness was already announced. Weak: a destroyed map is forgotten with it. */
const _announced = new WeakSet<object>();

/**
 * Dispatches `geoleaf:map:ready` for `map`, unless it was already announced for that map.
 *
 * @param map - The map adapter the event is about. Without one, the event is dispatched every
 *   time — there is nothing to key the « once » on.
 *
 * @example
 * ```ts
 * announceMapReady(adapter); // dispatches
 * announceMapReady(adapter); // silent: already announced for this map
 * ```
 */
export function announceMapReady(map: object | null | undefined): void {
    if (map) {
        if (_announced.has(map)) return;
        _announced.add(map);
    }
    dispatchGeoLeafEvent("geoleaf:map:ready", undefined);
}
