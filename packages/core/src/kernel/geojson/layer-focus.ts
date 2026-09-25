/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Layer focus — brings one feature into view and selects it.
 *
 * Body of `GeoLeaf.Layers.focus`: the gesture a search result, a list row or a work order's
 * "next" all end with. A point is flown to; a line or a polygon is fitted; then the
 * feature's `selected` feature-state is set, which the adapter paints
 * (`adapters/maplibre/maplibre-selection-paint.ts`).
 *
 * 🛑 **One selection per map.** The previous one is cleared before the next is set — on its
 * own layer, which need not be this one. It is remembered per adapter, in a `WeakMap`: a map
 * recreated by `Core.destroy()` / `init()` has a new adapter and inherits no ghost, and a
 * destroyed adapter takes its entry with it.
 *
 * ⚠️ A feature-state is addressed by the source's promoted id — `properties.id`. A feature
 * without one is framed, not selected. And a whole-collection write (`setData`, a filter
 * re-feed) clears every state: the selection lasts until the layer is rewritten whole.
 */

import { GeoJSONShared } from "./shared.js";
import { readFeaturePropId } from "./geojson-filter.js";
import { geometryBounds, representativePoint } from "../../utils/geo/geometry-bounds.js";
import type { GeoJSONFeature } from "./geojson-types.js";
import type { LayerFocusOptions } from "../../contracts/layer-data.contract.js";

/** Zoom a point is shown at when the caller names none — close enough to tell neighbours apart. */
const DEFAULT_FOCUS_ZOOM = 17;

/** Screen padding (px) around a fitted line or polygon. */
const FIT_PADDING = { x: 40, y: 40 };

/** The feature each map adapter currently shows selected. */
const _selection = new WeakMap<object, { layerId: string; id: string | number }>();

/**
 * Frames and selects a feature already found in `layerId`'s store.
 *
 * @param layerId - The feature's layer.
 * @param feature - The stored feature.
 * @param opts - `zoom` for a point.
 * @returns `false` when there is no map or the feature has no position; `true` otherwise.
 */
export function focusFeature(
    layerId: string,
    feature: GeoJSONFeature,
    opts: LayerFocusOptions = {}
): boolean {
    const adapter = GeoJSONShared.state.adapter;
    const at = representativePoint(feature.geometry);
    if (!adapter || !at) return false;

    const box = feature.geometry?.type === "Point" ? null : geometryBounds(feature.geometry);
    if (box && (box.north !== box.south || box.east !== box.west)) {
        adapter.fitBounds(box, { padding: FIT_PADDING, animate: true });
    } else {
        adapter.flyTo(at, opts.zoom ?? DEFAULT_FOCUS_ZOOM);
    }

    const previous = _selection.get(adapter);
    if (previous) adapter.setFeatureState?.(previous.layerId, previous.id, { selected: false });
    const id = readFeaturePropId(feature);
    if (id === null) {
        _selection.delete(adapter);
        return true;
    }
    adapter.setFeatureState?.(layerId, id, { selected: true });
    _selection.set(adapter, { layerId, id });
    return true;
}
