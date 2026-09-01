/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * MapLibre adapter — internal type hub.
 *
 * Type-only re-exports of the MapLibre GL JS types consumed by
 * `maplibre-adapter.ts`. MapLibre is a peer dependency loaded at runtime via a
 * `<script>` tag; importing its types **type-only** keeps them fully erased at
 * build time (zero bytes added to the CDN bundle).
 *
 * INTERDIT : every import from "maplibre-gl" here MUST be `import type` — a
 * value import would pull the engine into the bundle.
 */

import type {
    Map as MaplibreMap,
    IControl,
    Popup as MaplibrePopup,
    Marker as MaplibreMarker,
    MapLayerMouseEvent,
    MapGeoJSONFeature,
    LngLatBounds,
    ControlPosition,
    FlyToOptions,
    FitBoundsOptions,
    Listener,
} from "maplibre-gl";

/** The native MapLibre GL `Map` instance held by the adapter. */
export type { MaplibreMap, IControl, MaplibrePopup, MaplibreMarker };

/** Native MapLibre `LngLatBounds` returned by `map.getBounds()`. */
export type { LngLatBounds };

/**
 * Native MapLibre layer-scoped pointer event (the `(type, layerId, listener)`
 * overload of `map.on`). Carries the queried `features` and pointer `lngLat`
 * consumed by the POI / cluster click handlers.
 */
export type { MapLayerMouseEvent };

/**
 * Native MapLibre rendered GeoJSON feature (a GeoJSON `Feature` augmented with
 * the engine's `layer`/`source` metadata) handed to layer event callbacks.
 */
export type { MapGeoJSONFeature };

/**
 * Structural view of a MapLibre clustered GeoJSON source's expansion-zoom
 * method. `map.getSource()` returns a `Source` union; the POI renderer narrows
 * to this shape to query the zoom that explodes a cluster.
 */
export interface ClusterSourceLike {
    getClusterExpansionZoom(clusterId: number): Promise<number>;
}

/** Native MapLibre control-position token accepted by `map.addControl()`. */
export type { ControlPosition };

/** Native MapLibre camera-animation option bags (re-exported). */
export type { FlyToOptions, FitBoundsOptions };

/**
 * Native MapLibre event-listener type accepted by the `Map.on/off/once(type: string, …)`
 * string overload. Aliased from MapLibre's own published `Listener` type.
 *
 * ⚠️ **This alias used to be reached through a cast, and the cast only held because the
 * target was `any`.** Until maplibre-gl 6.2.0 the published type was
 * `Listener = (a: any) => any`; 6.3.0 narrowed it to `Listener<E extends Event = Event> =
 * (event: E) => any`. A wrapper declared as `(e: GeoLeafNormalizedMapEvent) => void` then
 * stopped overlapping it, and `wrapped as MaplibreEventListener` became `TS2352`. Measured
 * on a 2×2 matrix: maplibre 6.3.0 alone reproduces all four errors, TypeScript 5.9.3 alone
 * reproduces none. **The alias was never wrong — the target tightened, and the cast had
 * been hiding the mismatch all along.**
 *
 * The subscription boundary no longer casts: wrappers declare {@link MaplibreEventArg} as
 * their parameter, so they are assignable to this type by construction.
 */
export type MaplibreEventListener = Listener;

/**
 * The argument MapLibre actually hands to a listener, derived from the published type
 * rather than restated.
 *
 * Deriving it is what keeps this correct across engine versions: it resolves to `any` on
 * 6.2.0 and to MapLibre's `Event` on 6.3.0, so a wrapper typed with it compiles against
 * both without a cast, and will follow any further narrowing on its own.
 */
export type MaplibreEventArg = Parameters<MaplibreEventListener>[0];

/**
 * Native MapLibre filter expression accepted by `map.setFilter()`, derived from
 * the `Map` type so no extra import from the style-spec sub-package is needed.
 */
export type MaplibreFilter = Parameters<MaplibreMap["setFilter"]>[1];

/**
 * Native MapLibre source specification accepted by `map.addSource()`, derived
 * from the `Map` type (avoids importing the style-spec sub-package). The layer
 * builders assemble a plain options bag and cast to this at the call boundary.
 */
export type MaplibreSourceSpec = Parameters<MaplibreMap["addSource"]>[1];

/**
 * Native MapLibre layer object accepted by `map.addLayer()`, derived from the
 * `Map` type. The helpers assemble per-geometry layer literals (whose `type`
 * discriminant TS widens) and cast to this at the `addLayer` boundary.
 */
export type MaplibreLayerSpec = Parameters<MaplibreMap["addLayer"]>[0];

/**
 * Structural view of a MapLibre GeoJSON source's mutating method. The registry
 * stores generic `Source` handles; the adapter narrows to this shape (guarded
 * by `typeof source.setData === "function"`) before replacing layer data.
 */
export interface GeoJSONSourceLike {
    setData(data: unknown): void;
}

/**
 * A MapLibre control object accepted by `map.addControl()`.
 * Either an `IControl` implementation or a thin HTMLElement wrapper produced by
 * the adapter's `_resolveControl()`.
 */
export type MaplibreControl = IControl;

/**
 * GeoLeaf-normalised event object: a native MapLibre event with an optional
 * `latlng` mirror added by the adapter's event wrapper.
 */
export interface GeoLeafNormalizedMapEvent {
    /** GeoLeaf `{lat, lng}` mirror of MapLibre's `lngLat` (pointer events only). */
    latlng?: { lat: number; lng: number };
    /** Native MapLibre `lngLat` (pointer events only). */
    lngLat?: { lat: number; lng: number };
    [key: string]: unknown;
}
