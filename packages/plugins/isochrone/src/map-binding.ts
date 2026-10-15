/*!
 * @geoleaf-plugins/isochrone — Map binding
 *
 * Draws, restyles, hides, re-ranks and erases the zones — through the core's map adapter, and
 * through nothing else. It holds no state: what to draw comes from the stack, by the
 * controller.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import { getGeoLeaf } from "@geoleaf/host-runtime";
import type { IsochroneGeometry, IsochroneLayer } from "./model.js";

/**
 * The part of the core's map adapter this package calls.
 *
 * Declared here, structurally: the host runtime's description of the adapter types only the
 * members its own consumers need. Every member is checked to be a function before the slice is
 * handed out, so a core missing one reads as "no map" rather than failing mid-gesture.
 */
export interface IsochroneMap {
    addGeoJSONLayer(id: string, data: unknown, options: Record<string, unknown>): void;
    removeLayer(id: string): void;
    hasLayer(id: string): boolean;
    showLayer(id: string): void;
    hideLayer(id: string): void;
    setLayerStyle(id: string, style: Record<string, unknown>): void;
    /** Optional on the adapter's contract: an older core reads as a refusal. */
    setLayerZIndex?(id: string, zIndex: number): boolean;
    createMarker(id: string, position: { lat: number; lng: number }, options: object): void;
    removeMarker(id: string): void;
    getContainer(): HTMLElement;
}

/** The members a usable adapter must have — `setLayerZIndex` is not among them. */
const REQUIRED: readonly string[] = [
    "addGeoJSONLayer",
    "removeLayer",
    "hasLayer",
    "showLayer",
    "hideLayer",
    "setLayerStyle",
    "createMarker",
    "removeMarker",
    "getContainer",
];

/** Width of a zone's outline, in pixels. */
const OUTLINE_WEIGHT = 2;

/**
 * The map adapter of the mounted map.
 *
 * @returns The adapter, or `null` when no map is mounted or it lacks a member this package
 *   calls.
 */
export function getMapAdapter(): IsochroneMap | null {
    const adapter: unknown = getGeoLeaf()?.Core?.getMap?.();
    if (typeof adapter !== "object" || adapter === null) return null;
    const members = adapter as Record<string, unknown>;
    return REQUIRED.every((name) => typeof members[name] === "function")
        ? (adapter as IsochroneMap)
        : null;
}

/**
 * The style of a zone, COMPLETE.
 *
 * 🛑 Always the whole style: the adapter rebuilds the paint from what it is given, and a
 * partial style turns the missing colours back to its grey default.
 *
 * @param layer The zone.
 * @returns Fill and outline in one colour; the fill takes the zone's opacity, the outline
 *   stays opaque so a faint zone keeps its edge.
 */
function styleOf(layer: IsochroneLayer): Record<string, unknown> {
    return {
        color: layer.color,
        weight: OUTLINE_WEIGHT,
        opacity: 1,
        fillColor: layer.color,
        fillOpacity: layer.opacity,
    };
}

/**
 * Draws a zone at its rank.
 *
 * @param map The adapter.
 * @param layer The zone.
 * @param geometry Its area.
 * @param zIndex Its rank.
 */
export function drawZone(
    map: IsochroneMap,
    layer: IsochroneLayer,
    geometry: IsochroneGeometry,
    zIndex: number
): void {
    const data = {
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: { minutes: layer.minutes }, geometry }],
    };
    map.addGeoJSONLayer(layer.id, data, { ...styleOf(layer), zIndex, visible: layer.visible });
}

/**
 * Gives a zone its colour and opacity again, after a change.
 *
 * @param map The adapter.
 * @param layer The zone, as it now is.
 */
export function restyleZone(map: IsochroneMap, layer: IsochroneLayer): void {
    map.setLayerStyle(layer.id, styleOf(layer));
}

/**
 * Shows or hides a zone. A hidden zone keeps its rank.
 *
 * @param map The adapter.
 * @param id The zone's identifier.
 * @param visible Whether it is drawn.
 */
export function showZone(map: IsochroneMap, id: string, visible: boolean): void {
    if (visible) map.showLayer(id);
    else map.hideLayer(id);
}

/**
 * Erases a zone and its source. Tolerates one already gone.
 *
 * @param map The adapter.
 * @param id The zone's identifier.
 */
export function eraseZone(map: IsochroneMap, id: string): void {
    if (map.hasLayer(id)) map.removeLayer(id);
}

/**
 * Re-ranks zones in place.
 *
 * Each goes through the adapter's `setLayerZIndex`, which moves the layer without rebuilding
 * it. When the adapter refuses — or is too old to have the member — the zone is erased and
 * drawn again at its new rank, with the same area, style and visibility: slower, never wrong.
 *
 * ⚠️ The calls are made one by one, in any order, and the result is still the order asked: a
 * layer is always placed against the ranks the others hold at that moment, and every pair ends
 * up decided by whichever of the two moved last — by then the other already holds its final
 * rank.
 *
 * @param map The adapter.
 * @param moves The zones whose rank changes, with that rank.
 * @param zoneOf Finds a zone and its area, for the rebuild.
 */
export function rerankZones(
    map: IsochroneMap,
    moves: readonly { id: string; zIndex: number }[],
    zoneOf: (id: string) => { layer: IsochroneLayer; geometry: IsochroneGeometry } | null
): void {
    for (const { id, zIndex } of moves) {
        if (map.setLayerZIndex?.(id, zIndex) === true) continue;
        const zone = zoneOf(id);
        if (!zone) continue;
        eraseZone(map, id);
        drawZone(map, zone.layer, zone.geometry, zIndex);
    }
}
