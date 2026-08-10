/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Basemap-switch style transform for the MapLibre adapter.
 *
 * A vector basemap switch calls `map.setStyle(next)`, which by default destroys
 * every source and layer of the current style — including the GeoLeaf data
 * layers (GeoJSON, POI clusters, sentinel). Historically the adapter re-injected
 * all of them from JS after `style.load` (the `geoleaf:style:rebuild` dance),
 * an O(layers × features) rebuild flagged by the native-alignment audit
 * (redundancy #1).
 *
 * `setStyle(next, { diff, transformStyle })` — introduit en MapLibre v5, toujours là en v6 —
 * nous laisse fusionner
 * the GeoLeaf-owned sources/layers of the **current** style into the **incoming**
 * one, so they survive the swap natively — no teardown, no re-injection, no
 * listener churn. This module builds that `transformStyle` callback from a
 * snapshot of the ids GeoLeaf owns.
 *
 * Runtime images added via `map.addImage()` (POI sprite icons) are **not** part
 * of the style spec and are still wiped by `setStyle()`; the adapter re-registers
 * them separately after the swap.
 */
"use strict";

/** Set of MapLibre source + layer ids that GeoLeaf owns and must preserve. */
export interface OwnedStyleIds {
    /** MapLibre layer ids to carry over (GeoJSON sub-layers, POI cluster layers, sentinel). */
    readonly layerIds: ReadonlySet<string>;
    /** MapLibre source ids to carry over (GeoJSON sources, POI cluster sources). */
    readonly sourceIds: ReadonlySet<string>;
}

/** Minimal structural view of a MapLibre layer spec (id + optional source). */
interface StyleLayerLike {
    id: string;
    source?: string;
}

/** Minimal structural view of a MapLibre style spec (sources map + ordered layers). */
export interface StyleSpecLike {
    sources?: Record<string, unknown>;
    layers?: StyleLayerLike[];
    [key: string]: unknown;
}

/**
 * A MapLibre `transformStyle` callback: given the previous and next style specs,
 * returns the style to actually apply.
 */
export type StyleTransform = (
    previous: StyleSpecLike | undefined,
    next: StyleSpecLike
) => StyleSpecLike;

/**
 * Builds a `transformStyle` callback that carries the GeoLeaf-owned sources and
 * layers from the previous style into the next one, appending the layers **after**
 * the incoming basemap layers so they render on top (correct z-order). The raster
 * basemap injection path re-inserts its layer at the bottom independently, so a
 * vector→raster swap keeps GeoLeaf layers on top as well.
 *
 * Ownership is passed in (snapshotted from the adapter's layer registry) rather
 * than inferred from id conventions, so the merge is authoritative. Preserved
 * layers keep their serialized paint/layout (e.g. taxonomy `match` expressions and
 * `visibility`), and GeoJSON sources keep their serialized `data` — hence the
 * rebuild is unnecessary.
 *
 * @param owned - The source/layer ids GeoLeaf owns at swap time.
 * @returns A `transformStyle` callback for `map.setStyle(next, { transformStyle })`.
 */
export function buildGeoLeafStyleTransform(owned: OwnedStyleIds): StyleTransform {
    return (previous, next) => {
        // First style load (no previous) or nothing to preserve → apply next as-is.
        if (!previous || owned.layerIds.size === 0) return next;

        const previousLayers = Array.isArray(previous.layers) ? previous.layers : [];
        const preservedLayers = previousLayers.filter((layer) => owned.layerIds.has(layer.id));
        if (preservedLayers.length === 0) return next;

        // Carry every owned source, plus any source a preserved layer references
        // (defensive against registry/style drift). Background layers (sentinel)
        // have no source and contribute nothing here.
        const neededSourceIds = new Set<string>(owned.sourceIds);
        for (const layer of preservedLayers) {
            if (layer.source) neededSourceIds.add(layer.source);
        }

        const previousSources = previous.sources ?? {};
        const mergedSources: Record<string, unknown> = { ...(next.sources ?? {}) };
        for (const sourceId of neededSourceIds) {
            if (sourceId in previousSources) mergedSources[sourceId] = previousSources[sourceId];
        }

        // Append preserved layers on top of the incoming basemap, skipping any id
        // the next style already defines (guards against an accidental collision).
        const nextLayers = Array.isArray(next.layers) ? next.layers : [];
        const nextLayerIds = new Set(nextLayers.map((layer) => layer.id));
        const layersToAppend = preservedLayers.filter((layer) => !nextLayerIds.has(layer.id));

        return { ...next, sources: mergedSources, layers: [...nextLayers, ...layersToAppend] };
    };
}
