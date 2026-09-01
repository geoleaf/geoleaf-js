/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Handler-wrapper registry for the MapLibre adapter's core map events.
 *
 * The adapter's public `on(event, handler)` — the 2-arg form — wraps every
 * handler so MapLibre's `e.lngLat` is also exposed as `e.latlng`, the shape
 * GeoLeaf modules expect. `off()` must therefore hand the **wrapper** back to
 * `map.off()`, not the caller's handler: MapLibre matches listeners by
 * identity, so passing the original silently detaches nothing.
 *
 * The registry is keyed **by handler, then by event**. Binding one handler to
 * several events is routine — the scale control registers a single `updateScale`
 * on both `zoomend` and `moveend` — and a handler-only key made the second
 * `on()` overwrite the first wrapper: the first listener became unreachable, and
 * `off()`'s entry deletion then stranded the second one too. Both leaked past
 * `destroy()` (LOW-30, tâche 4.3).
 *
 * Sibling of {@link module:adapters/maplibre/maplibre-event-subscriptions},
 * which tracks the *delegated* (3-arg, layer-scoped) listeners instead — those
 * need flushing across `setStyle()`, these do not.
 */

import type {
    GeoLeafNormalizedMapEvent,
    MaplibreEventArg,
    MaplibreMap,
} from "./maplibre-adapter-types.ts";
import type { MapEvent } from "../../contracts/map-adapter.contract.ts";
import { fromMapLibreLngLat } from "./maplibre-primitives.js";

/**
 * Caller handler → the events it is bound to → the wrapper actually attached.
 *
 * ⚠️ The wrapper is typed on {@link MaplibreEventArg} — what MapLibre hands a listener —
 * and NOT on `GeoLeafNormalizedMapEvent`, which is what it hands the CALLER. The two differ,
 * and stating the engine's side here is what lets `map.on/off` take the wrapper without a
 * cast. Normalisation happens inside the wrapper, where it belongs.
 */
export type EventWrapperMap = Map<
    (e: unknown) => void,
    Map<MapEvent, (e: MaplibreEventArg) => void>
>;

/** Creates an empty wrapper registry. One per adapter instance. */
export function createEventWrapperMap(): EventWrapperMap {
    return new Map();
}

/**
 * Wraps `handler`, attaches it to `map` for `event`, and records the wrapper.
 *
 * @param map - The native MapLibre map.
 * @param wrappers - The adapter's wrapper registry.
 * @param event - The core map event to listen for.
 * @param handler - The caller's handler, invoked with `e.latlng` populated.
 */
export function attachWrappedHandler(
    map: MaplibreMap,
    wrappers: EventWrapperMap,
    event: MapEvent,
    handler: (e: unknown) => void
): void {
    // The wrapper does NOT convert the event into the GeoLeaf shape — it names only the two
    // fields it reads and writes. That distinction is what keeps the conversion honest AND
    // free of `as unknown as`: since maplibre-gl 6.3.0 the native event is `Event`, a CLASS,
    // and a class has no index signature, so it relates to `GeoLeafNormalizedMapEvent`
    // (`[key: string]: unknown`) in neither direction — a two-step conversion would be the
    // only way, and `check-nonnull-assertion-debt` rightly refuses one born here. Narrowing
    // to `Pick<…>` drops the index signature from the target, and the cast becomes ordinary.
    //
    // ⚠️ Do NOT "fix" this by having `GeoLeafNormalizedMapEvent` extend the engine type: that
    // contract describes what the ADAPTER hands GeoLeaf modules, and tying it to MapLibre
    // would put the engine back into a type every consumer sees.
    type PointerFields = Pick<GeoLeafNormalizedMapEvent, "lngLat" | "latlng">;

    const wrapped = (e: MaplibreEventArg) => {
        const ev = e as PointerFields;
        if (ev?.lngLat && !ev.latlng) {
            ev.latlng = fromMapLibreLngLat(ev.lngLat);
        }
        // `e` and `ev` are the same object — the caller gets the native event, enriched.
        handler(e);
    };

    let byEvent = wrappers.get(handler);
    if (!byEvent) {
        byEvent = new Map();
        wrappers.set(handler, byEvent);
    }
    byEvent.set(event, wrapped);

    map.on(event, wrapped);
}

/**
 * Detaches the wrapper recorded for the `(handler, event)` pair and forgets it.
 *
 * Falls back to the raw handler when no wrapper is on file — it may have been
 * attached directly, or `on()` may never have run for this pair.
 *
 * The handler's entry survives as long as it still has another event bound, so
 * detaching one event never strands the others.
 *
 * @param map - The native MapLibre map.
 * @param wrappers - The adapter's wrapper registry.
 * @param event - The event to stop listening for.
 * @param handler - The handler originally passed to {@link attachWrappedHandler}.
 */
export function detachWrappedHandler(
    map: MaplibreMap,
    wrappers: EventWrapperMap,
    event: MapEvent,
    handler: (e: unknown) => void
): void {
    const byEvent = wrappers.get(handler);
    const wrapped = byEvent?.get(event) ?? handler;

    map.off(event, wrapped);

    if (byEvent) {
        byEvent.delete(event);
        if (byEvent.size === 0) wrappers.delete(handler);
    }
}
