/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Filter capability — apply pipeline (S5, F4).
 *
 * Reads the panel DOM into the engine's `ActiveField[]`, then applies the filter to
 * the GeoJSON layers through the kernel `GeoJSONCore.filterFeatures` seam, which
 * applies an id-based GPU `setLayerFilter` (zero re-tiling, RM-P1(b)) with a
 * `setData` fallback. The engine predicate (`featurePasses`) covers every kind,
 * every geometry (`point` included) and honours the per-layer `layers` scope.
 *
 * **The single writer of the layer filter.** A second, pure-native path lived in
 * `taxonomy-options.ts` until S5/N-4; it was retired rather than wired (see that module).
 */
"use strict";

import { dispatchGeoLeafEvent } from "../../kernel/events/index.js";
import { GeoJSONCore } from "../../kernel/geojson/index.js";
import { readActiveFilter } from "./panel/state.js";
import { expandActiveFilter, resolveFieldOptions } from "./taxonomy-options.js";
import { featurePasses, distinctFieldValues } from "./engine/index.js";
import type { ActiveField, FeatureLike } from "./engine/types.js";
import type { OptionsByField } from "./panel/render.js";
import type { FilterConfig, FilterFieldDescriptor } from "./types.js";

/** GeoJSON kernel seam — id-based GPU `setLayerFilter` + `setData` fallback (RM-P1(b)). */
interface GeoJSONFilterLike {
    filterFeatures(
        predicate: (feature: FeatureLike, layerId: string) => boolean,
        options?: { geometryType?: string }
    ): void;
    /** Live features of the loaded GeoJSON layers (optionally scoped) — for `"auto"` options. */
    getFeatures?(options?: { layerIds?: string[] }): FeatureLike[];
}

/** Geometry buckets the GeoJSON seam filters (mirrors the former applier). */
const GEOMETRY_TYPES = ["polygon", "line", "point"] as const;

/**
 * Gathers the features a `"auto"` tag field derives its options from: the GeoJSON
 * layers it targets (or all layers) — the same sources the filter applies to. Every
 * point layer (POI included) is a GeoJSON layer, so `GeoJSONCore.getFeatures`
 * yields the full set.
 */
function _autoOptionFeatures(field: FilterFieldDescriptor): FeatureLike[] {
    const gj = GeoJSONCore as unknown as GeoJSONFilterLike;
    return gj.getFeatures?.(field.layers ? { layerIds: field.layers } : {}) ?? [];
}

/**
 * Resolves every filter field's selectable options, deriving the `"auto"` tag fields from the
 * data actually loaded.
 *
 * Two-pass on purpose. `resolveFieldOptions` answers for the fields whose options are declared
 * in the profile — a static list needs no data. Only a `tag` field with `options: "auto"`
 * requires reading the features, and it is resolved here so that its option list reflects what
 * is currently on the map instead of what the profile guessed. A layer loaded later therefore
 * widens the list at the next call, not at boot.
 *
 * @param config - The filter configuration whose `fields` are being resolved.
 * @returns The options for every field, keyed by field id.
 */
export function resolveOptionsWithData(config: FilterConfig): OptionsByField {
    const options = resolveFieldOptions(config);
    for (const field of config.fields ?? []) {
        if (field.kind === "tag" && field.options === "auto" && field.field) {
            const values = distinctFieldValues(field.field, _autoOptionFeatures(field), true).map(
                (v) => ({ value: v })
            );
            options[field.id] = { values };
        }
    }
    return options;
}

/**
 * Reads the panel DOM, expands taxonomy selections, applies the filter to every
 * source and notifies listeners (`geoleaf:filters:applied`). Single entry point for
 * Apply / control changes / permalink restore.
 */
export function applyFilterFromPanel(panelEl: HTMLElement | null, config: FilterConfig): void {
    const active = expandActiveFilter(readActiveFilter(panelEl, config));
    applyActiveFilterToSources(active);
    dispatchGeoLeafEvent("geoleaf:filters:applied", {});
}

/**
 * Applies an already-expanded active filter to the GeoJSON layers (every geometry,
 * `point` included). Geometry-agnostic; the per-layer `layers` scope is honoured via
 * `featurePasses`.
 */
export function applyActiveFilterToSources(active: ActiveField[]): void {
    const gj = GeoJSONCore as unknown as GeoJSONFilterLike;
    if (gj && typeof gj.filterFeatures === "function") {
        const predicate = (feature: FeatureLike, layerId: string): boolean =>
            featurePasses(active, feature, layerId);
        for (const geometryType of GEOMETRY_TYPES) gj.filterFeatures(predicate, { geometryType });
    }
}
