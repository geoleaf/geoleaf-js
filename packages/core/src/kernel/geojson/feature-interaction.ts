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

/**
 * Returns the sub-layer IDs that carry **interaction** events — click AND hover, which share
 * this selector so a single gesture cannot be reported twice. Prefers `fill` sub-layers (cover
 * the whole polygon surface) over `line` (border only); falls back circle → line → all. Mirrors
 * the legacy popup binder selection so the pointer/tooltip fires anywhere inside a polygon, not
 * only on its border.
 *
 * 🛑 **Why one sub-layer and not all of them.** `_addSubLayers` stacks sub-layers per geometry
 * and cumulatively — a polygon gets `_addPolygonSubLayers` *then* `_addLineSubLayers`. Binding
 * all of them made MapLibre run one delegated listener per touched sub-layer, so a single click
 * emitted 2 events on an icon point, 2 on a cased line, 3 on a cased polygon and 4 on a vector
 * tile. Downstream, `feature-info` closes and reopens its popup on every event, so the user saw
 * it flicker.
 *
 * ⚠️ **What the precedence costs, measured.** `-symbol` is never selected, so on an icon point
 * the clickable area becomes the circle instead of the icon's collision box (the 12 px glyph
 * padded by `icon-padding`, default 2 px ⇒ a 16 px box). Measured against the five layers that
 * actually set `showIconsOnMap`: **nothing is lost on the axes** — every capture radius
 * (`radius + weight`) is at least equal to the box half-side. Only the diagonal ring is lost:
 * ~0.2 % of the box at radius 11, ~2.8 % at radius 10, ~21.5 % at radius 8 — and most of that
 * is the transparent padding, where a click arguably should never have registered.
 * Adding `-symbol` here is NOT the fix for that ring: it would bind both sub-layers again and
 * restore the double event this selector exists to prevent. The only other option is to bind
 * wide and deduplicate per gesture on `originalEvent`, which costs shared state — not worth it
 * for a diagonal sliver.
 */
function _interactionSubLayerIds(subLayerIds: string[]): string[] {
    const fills = subLayerIds.filter((id) => id.endsWith("-fill"));
    if (fills.length) return fills;
    const circles = subLayerIds.filter((id) => id.endsWith("-circle"));
    if (circles.length) return circles;
    const lines = subLayerIds.filter((id) => id.endsWith("-line"));
    if (lines.length) return lines;
    return subLayerIds;
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
 * non-interactive (`interactiveShape === false`).
 *
 * @param layerId - GeoLeaf layer id (forwarded on every event).
 * @param def - Layer definition; read for `interactiveShape` and `zIndex`.
 * @param nativeMap - The raw `maplibregl.Map` instance.
 * @param subLayerIds - MapLibre sub-layer IDs to bind events on.
 */
export function bindFeatureInteractionEvents(
    layerId: string,
    def: Record<string, unknown>,
    nativeMap: GeoJSONNativeMap,
    subLayerIds: string[]
): void {
    if (def.interactiveShape === false) return;
    const zIndex = typeof def.zIndex === "number" ? def.zIndex : 0;

    // ── Click → geoleaf:feature:click ──
    // Same selector as hover below: a gesture on ONE feature must emit ONE event, however many
    // sub-layers render it. Binding every sub-layer emitted 2 events on an icon point, 2 on a
    // cased line, 3 on a cased polygon and 4 on a vector tile — see `_interactionSubLayerIds`.
    const clickIds = _interactionSubLayerIds(subLayerIds);
    for (const subId of clickIds) {
        if (!nativeMap.getLayer(subId)) continue;
        const onClick = (e: MapInteractionEvent) => {
            const hit = e.features?.[0];
            if (!hit) return;
            if (nativeMap.__geoleafExclusiveMode) return;
            const feature = hit;
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
        nativeMap.on("click", subId, onClick);
        trackMapCleanup(nativeMap, () => nativeMap.off("click", subId, onClick));
    }

    // ── Hover → cursor pointer + geoleaf:feature:hover ──
    const hoverIds = _interactionSubLayerIds(subLayerIds).filter((id) => nativeMap.getLayer(id));
    for (const subId of hoverIds) {
        const onMove = (e: MapInteractionEvent) => {
            if (nativeMap.__geoleafExclusiveMode) return;
            nativeMap.getCanvas().style.cursor = "pointer";
            const hit = e.features?.[0];
            if (!hit) return;
            const feature = hit;
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
        nativeMap.on("mousemove", subId, onMove);
        nativeMap.on("mouseleave", subId, onLeave);
        trackMapCleanup(nativeMap, () => {
            nativeMap.off("mousemove", subId, onMove);
            nativeMap.off("mouseleave", subId, onLeave);
        });
    }
}
