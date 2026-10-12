/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf GeoJSON Module - Feature interaction events (kernel seam)
 *
 * Registers map-level click / hover handlers on interactive GeoJSON &
 * vector-tile sub-layers and dispatches the geometry-agnostic
 * `geoleaf:feature:click` and `geoleaf:feature:hover` events. This is the
 * kernel-side seam that lets the `feature-info` capability render attribute
 * surfaces (tooltip / popup / side-panel) without the kernel knowing how
 * rendering is done. Cluster aggregates are skipped here.
 *
 * ⚠️ This sentence said "POI markers keep their own `geoleaf:poi:click` path"
 * until 17/08/2026, and **that path does not exist**: measured,
 * `geoleaf:poi:click` is the only one of the 49 declared events no code emits. The
 * sentence pointed at nothing, and it served as justification NOT to cover POI
 * markers here — a false reference costs more than no reference, because it closes
 * the question instead of opening it.
 */

import { dispatchGeoLeafEvent } from "../events/event-bus.js";
import { trackMapCleanup } from "../../adapters/maplibre/maplibre-event-subscriptions.js";
import type { GeoJSONNativeMap, MapInteractionEvent } from "./core-types.js";

/** Structural view of a MapLibre feature as read for interaction events. */
interface InteractionFeature {
    id?: string | number;
    geometry?: { type: string; coordinates?: unknown };
    properties?: Record<string, unknown> | null;
}

/** The sub-layer families that draw FEATURES — the ones a gesture can land on. */
const _FEATURE_SUFFIXES = ["-fill", "-fill-extrusion", "-line", "-circle", "-symbol"] as const;

/**
 * Returns the sub-layer IDs that carry **interaction** events — click AND hover, which share
 * this selector. Every sub-layer that draws features is listed, whatever its family: fill,
 * extrusion, line, circle, icon. Falls back to the whole list when no suffix is recognised.
 *
 * 🛑 **Every family, because a layer does not know at creation what it will hold.** A layer
 * that ships empty is built with the sub-layers of the three families, and the set is decided
 * once. This selector used to keep ONE family by precedence (fill, else circle, else line):
 * such a layer, filled later with points, drew them and never heard them — a click on a point
 * went to whatever another layer drew underneath.
 *
 * 🛑 **One gesture, one event — and it is the engine that guarantees it, not this list.** The
 * binder hands the whole list to ONE delegated listener (`map.on(type, ids[], fn)`): MapLibre
 * queries the listed sub-layers together and calls the listener once, with the features sorted
 * top-down. Binding each sub-layer on its own — one listener per id — is what emitted 2 events
 * on an icon point, 2 on a cased line, 3 on a cased polygon and 4 on a vector tile, and made
 * `feature-info` close and reopen its popup on each. A sub-layer added to this list costs no
 * event; a second `map.on` would.
 *
 * ⚠️ **Left out, on purpose.** `-casing` lies under its line and is wider: listing it would
 * widen the line's clickable band by the casing's overhang. `-clusters` / `-cluster-count`
 * draw aggregates, which carry no attributes (see `_isCluster`).
 */
function _interactionSubLayerIds(subLayerIds: string[]): string[] {
    const drawn = subLayerIds.filter((id) => _FEATURE_SUFFIXES.some((s) => id.endsWith(s)));
    return drawn.length ? drawn : subLayerIds;
}

/** Reads a stable feature id, falling back to `properties.id`, else `null`. */
function _featureId(feature: InteractionFeature): string | number | null {
    if (feature.id !== undefined) return feature.id;
    const pid = feature.properties?.id;
    return typeof pid === "string" || typeof pid === "number" ? pid : null;
}

/** True when the clicked/hovered feature is a cluster aggregate (no real attributes). */
function _isCluster(feature: InteractionFeature): boolean {
    return feature.properties?.point_count !== undefined;
}

/**
 * Binds click + hover handlers that emit `geoleaf:feature:click` /
 * `geoleaf:feature:hover` for an interactive layer. Kernel-only: no rendering,
 * no popup — only events + the pointer cursor. Safe no-op when the layer is
 * non-interactive (`interactiveShape === false`) or when none of its sub-layers exists.
 *
 * ONE listener per gesture for the whole layer, over every sub-layer that draws features: a
 * gesture on a feature emits one event however many sub-layers render it, and the feature
 * reported is the one drawn on top — a point lying on a polygon of the same layer answers as
 * the point. `leave` fires once the pointer has left every sub-layer of the layer, not when it
 * crosses from one to another.
 *
 * ⚠️ Between two LAYERS nothing is arbitrated here: each layer under the pointer emits its
 * own event, in the order the layers were bound.
 *
 * @param layerId - GeoLeaf layer id (forwarded on every event).
 * @param def - Layer definition; read for `interactiveShape` and `zIndex`.
 * @param nativeMap - The raw `maplibregl.Map` instance.
 * @param subLayerIds - The layer's MapLibre sub-layer IDs; the ones that draw features are bound.
 */
export function bindFeatureInteractionEvents(
    layerId: string,
    def: Record<string, unknown>,
    nativeMap: GeoJSONNativeMap,
    subLayerIds: string[]
): void {
    if (def.interactiveShape === false) return;
    const zIndex = typeof def.zIndex === "number" ? def.zIndex : 0;

    // The SAME list for the three subscriptions, and one subscription each — see
    // `_interactionSubLayerIds` for why neither may be split per sub-layer.
    const ids = _interactionSubLayerIds(subLayerIds).filter((id) => nativeMap.getLayer(id));
    if (ids.length === 0) return;

    // ── Click → geoleaf:feature:click ──
    const onClick = (e: MapInteractionEvent) => {
        const feature = e.features?.[0];
        if (!feature) return;
        if (nativeMap.__geoleafExclusiveMode) return;
        if (_isCluster(feature)) return;
        const lngLat = e.lngLat;
        if (!lngLat) return;
        dispatchGeoLeafEvent("geoleaf:feature:click", {
            layerId,
            featureId: _featureId(feature),
            properties: feature.properties ?? {},
            geometry: feature.geometry,
            lngLat: { lat: lngLat.lat, lng: lngLat.lng },
            point: { x: e.point?.x ?? 0, y: e.point?.y ?? 0 },
        });
    };

    // ── Hover → cursor pointer + geoleaf:feature:hover ──
    const onMove = (e: MapInteractionEvent) => {
        if (nativeMap.__geoleafExclusiveMode) return;
        nativeMap.getCanvas().style.cursor = "pointer";
        const feature = e.features?.[0];
        if (!feature) return;
        if (_isCluster(feature)) return;
        const lngLat = e.lngLat;
        if (!lngLat) return;
        dispatchGeoLeafEvent("geoleaf:feature:hover", {
            layerId,
            featureId: _featureId(feature),
            properties: feature.properties ?? {},
            lngLat: { lat: lngLat.lat, lng: lngLat.lng },
            point: { x: e.point?.x ?? 0, y: e.point?.y ?? 0 },
            zIndex,
            phase: "move",
        });
    };
    const onLeave = () => {
        if (nativeMap.__geoleafExclusiveMode) return;
        nativeMap.getCanvas().style.cursor = "";
        dispatchGeoLeafEvent("geoleaf:feature:hover", {
            layerId,
            featureId: null,
            properties: {},
            lngLat: { lat: 0, lng: 0 },
            point: { x: 0, y: 0 },
            zIndex,
            phase: "leave",
        });
    };

    nativeMap.on("click", ids, onClick);
    nativeMap.on("mousemove", ids, onMove);
    nativeMap.on("mouseleave", ids, onLeave);
    trackMapCleanup(nativeMap, () => {
        nativeMap.off("click", ids, onClick);
        nativeMap.off("mousemove", ids, onMove);
        nativeMap.off("mouseleave", ids, onLeave);
    });
}
