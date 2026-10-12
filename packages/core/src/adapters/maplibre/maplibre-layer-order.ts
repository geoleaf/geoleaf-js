/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Re-ranks a registered MapLibre layer in place — the engine side of
 * `IMapAdapter.setLayerZIndex`. Kept out of `MaplibreAdapter`, like the style applier, so the
 * adapter file stays within the size limit.
 *
 * The layer lands where an insertion at that rank would put it NOW: under the lowest layer of
 * strictly higher rank, above its equals. Nothing is rebuilt — the source and its data, the
 * filters, the zoom range, the visibility and the listeners stay as they are.
 *
 * 🛑 THE ANCHOR IS LOOKED UP IN THE STYLE BEFORE THE ENGINE IS CALLED, and that is not caution.
 * MapLibre's `moveLayer` (read in 6.7.0, `Style.moveLayer`) takes the layer out of the drawing
 * order BEFORE it finds out that the `before` layer is missing, then returns without putting it
 * back: a move towards an absent anchor makes the layer disappear. This module refuses instead,
 * and never calls the engine without an anchor it has just seen in the style.
 */
import type { MaplibreLayerRegistry } from "./maplibre-layer-registry.js";
import type { MaplibreMap } from "./maplibre-adapter-types.js";

/**
 * Moves the sub-layers of `id` to the place its new rank commands, then records the rank.
 *
 * Refuses — `false`, nothing moved and nothing recorded — for an unknown layer, a rank that is
 * not a finite number, a vector-tile layer, a layer none of whose sub-layers is in the style,
 * and an anchor that is not in the style. Asking for the rank the layer already holds returns
 * `true` without calling the engine: the layer is not lifted above its equals.
 *
 * @param map - The underlying `maplibregl.Map`.
 * @param registry - The adapter's layer registry.
 * @param id - GeoLeaf layer id.
 * @param zIndex - The rank to give the layer.
 * @returns `true` when the layer holds that rank on return; `false` when nothing moved.
 */
export function applyLayerZIndex(
    map: MaplibreMap,
    registry: MaplibreLayerRegistry,
    id: string,
    zIndex: number
): boolean {
    const entry = registry.get(id);
    if (!entry || !Number.isFinite(zIndex)) return false;
    // Refused by decision, not by necessity: a vector-tile layer takes its anchor from the same
    // computation. No caller re-ranks one and nothing proves that path in a browser — and a
    // refusal can be lifted later without breaking a caller, `false` already meaning "rebuild",
    // whereas an acceptance could not be withdrawn.
    if (entry.isVectorTile) return false;
    if (entry.zIndex === zIndex) return true;

    const present = entry.subLayerIds.filter((subId) => map.getLayer(subId));
    if (present.length === 0) return false;

    // The layer leaves itself out of the search: going down, it would otherwise anchor on its
    // own fill, and its outline would end up under it.
    const anchor = registry.getInsertBeforeId(zIndex, id);
    if (!map.getLayer(anchor)) return false;

    // One by one under the SAME anchor, in their order: the fill stays under the outline.
    for (const subId of present) map.moveLayer(subId, anchor);
    registry.setZIndex(id, zIndex);
    return true;
}
