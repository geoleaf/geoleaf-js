/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * MapLibre Layer Registry
 *
 * Internal registry that tracks the mapping between GeoLeaf layer IDs
 * and the MapLibre source + sub-layer IDs created for each layer.
 * Manages layer ordering by z-index using MapLibre's layer stack.
 *
 * **Naming convention:**
 * - Source:  `gl-src-{layerId}`
 * - Layers:  `gl-{layerId}-fill`, `gl-{layerId}-line`,
 *            `gl-{layerId}-circle`, `gl-{layerId}-symbol`,
 *            `gl-{layerId}-casing`
 *
 * **Ordering:**
 * Layers are rendered in insertion order (bottom to top). A sentinel
 * layer `gl-sentinel-poi` marks the boundary between GeoJSON layers
 * and POI layers. GeoJSON layers are inserted before this sentinel,
 * ordered by ascending `zIndex`.
 */
"use strict";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Source ID prefix for GeoLeaf GeoJSON sources. */
export const SOURCE_PREFIX = "gl-src-";

/** Layer ID prefix for GeoLeaf MapLibre sub-layers. */
export const LAYER_PREFIX = "gl-";

/** Sentinel layer inserted after all GeoJSON layers / before POI layers. */
export const SENTINEL_POI = "gl-sentinel-poi";

/**
 * The kinds of MapLibre sub-layer one GeoLeaf layer can expand into.
 *
 * A single declared layer becomes several MapLibre layers — fill, outline, symbol — which is
 * why visibility and style operations iterate rather than address one id.
 */
export type SubLayerType =
    | "fill"
    | "fill-extrusion"
    | "line"
    | "circle"
    | "symbol"
    | "casing"
    | "clusters"
    | "cluster-count";

// ─── Registry entry ──────────────────────────────────────────────────────────

/**
 * What the adapter remembers about one registered layer.
 *
 * Holds the mapping from a GeoLeaf layer id to the MapLibre ids it produced. Without it, a
 * teardown or a visibility toggle would have to re-derive those ids by convention, and any
 * drift in the convention would silently orphan layers.
 */
export interface LayerRegistryEntry {
    /** MapLibre source ID, e.g. `gl-src-my-layer`. */
    sourceId: string;
    /** Ordered list of MapLibre layer IDs created for this GeoLeaf layer. */
    subLayerIds: string[];
    /** z-index from the GeoLeaf profile (0–99). */
    zIndex: number;
    /** Current visibility state. */
    visible: boolean;
    /** Which sub-layer types were actually created. */
    subLayerTypes: Set<SubLayerType>;
    /**
     * GeoJSON geometry-type vocabulary present on this layer
     * (`"Point"` / `"LineString"` / `"Polygon"` …). Distinct from
     * {@link subLayerTypes}: a polygon layer also creates a `line` sub-layer for
     * its outline, so `subLayerTypes` cannot tell a polygon from a polyline.
     * Capability plugins (taxonomy) need the true geometry to pick fill vs stroke.
     */
    geometryTypes?: Set<string>;
    /** Whether this is a vector tile layer (vs. GeoJSON). */
    isVectorTile: boolean;
    /** Source-layer name for vector tile sources. */
    sourceLayer?: string;
}

// ─── Helper functions ────────────────────────────────────────────────────────

/** Builds the MapLibre source ID for a GeoLeaf layer. */
export function toSourceId(layerId: string): string {
    return SOURCE_PREFIX + layerId;
}

/** Builds a MapLibre sub-layer ID. */
export function toSubLayerId(layerId: string, type: SubLayerType): string {
    return LAYER_PREFIX + layerId + "-" + type;
}

// ─── MaplibreLayerRegistry ───────────────────────────────────────────────────

/**
 * Internal registry for MapLibre layers managed by the adapter.
 *
 * One instance per adapter. All mutations are through explicit methods —
 * callers never modify entries directly.
 */
export class MaplibreLayerRegistry {
    /** Registry map: GeoLeaf layerId → entry. */
    private readonly _entries: Map<string, LayerRegistryEntry> = new Map();

    // ── Query ────────────────────────────────────────────────────────────────

    /** Returns `true` if the layer is registered. */
    has(layerId: string): boolean {
        return this._entries.has(layerId);
    }

    /** Returns the entry for a layer, or `undefined`. */
    get(layerId: string): LayerRegistryEntry | undefined {
        return this._entries.get(layerId);
    }

    /** Returns the sub-layer IDs for a registered layer. */
    getSubLayerIds(layerId: string): string[] {
        return this._entries.get(layerId)?.subLayerIds ?? [];
    }

    /** Returns the source ID for a registered layer. */
    getSourceId(layerId: string): string {
        return this._entries.get(layerId)?.sourceId ?? toSourceId(layerId);
    }

    /**
     * Returns the GeoJSON geometry-type set for a registered layer, or
     * `undefined` if the layer is unknown or its geometry was not recorded.
     */
    getGeometryTypes(layerId: string): Set<string> | undefined {
        return this._entries.get(layerId)?.geometryTypes;
    }

    /** Returns all registered layer IDs. */
    getAllLayerIds(): string[] {
        return Array.from(this._entries.keys());
    }

    /** Returns the number of registered layers. */
    get size(): number {
        return this._entries.size;
    }

    // ── Registration ─────────────────────────────────────────────────────────

    /**
     * Registers a new GeoLeaf layer with its MapLibre sub-layers.
     *
     * @param layerId - GeoLeaf layer identifier.
     * @param subLayerTypes - Which sub-layer types were created.
     * @param zIndex - Layer z-index for ordering (0–99).
     * @param options - Additional options (vector tile, source-layer, custom IDs).
     */
    register(
        layerId: string,
        subLayerTypes: SubLayerType[],
        zIndex: number,
        options?: {
            isVectorTile?: boolean;
            sourceLayer?: string;
            /** Override auto-generated sub-layer IDs (e.g. for cluster layers). */
            customSubLayerIds?: string[];
            /** Override auto-generated source ID. */
            customSourceId?: string;
            /** GeoJSON geometry-type vocabulary present on the layer. */
            geometryTypes?: Set<string>;
        }
    ): LayerRegistryEntry {
        const entry: LayerRegistryEntry = {
            sourceId: options?.customSourceId ?? toSourceId(layerId),
            subLayerIds:
                options?.customSubLayerIds ?? subLayerTypes.map((t) => toSubLayerId(layerId, t)),
            zIndex,
            visible: true,
            subLayerTypes: new Set(subLayerTypes),
            // L'entrée est conservée dans `this._entries` et relue par clé : une clé présente
            // valant `undefined` n'y est pas équivalente à une clé absente.
            ...(options?.geometryTypes !== undefined && { geometryTypes: options.geometryTypes }),
            isVectorTile: options?.isVectorTile ?? false,
            ...(options?.sourceLayer !== undefined && { sourceLayer: options.sourceLayer }),
        };
        this._entries.set(layerId, entry);
        return entry;
    }

    /** Unregisters a layer. Returns `true` if it existed. */
    unregister(layerId: string): boolean {
        return this._entries.delete(layerId);
    }

    // ── Visibility ───────────────────────────────────────────────────────────

    /** Marks a layer as visible or hidden in the registry. */
    setVisible(layerId: string, visible: boolean): void {
        const entry = this._entries.get(layerId);
        if (entry) entry.visible = visible;
    }

    // ── Ordering ─────────────────────────────────────────────────────────────

    /**
     * Computes the `beforeId` for inserting a new layer at the given z-index.
     *
     * Finds the first existing sub-layer with a **higher** z-index and returns
     * its ID. If none exists, returns the sentinel layer ID so the new layer
     * is inserted just below the POI boundary.
     *
     * @param zIndex - The z-index of the layer being inserted.
     * @returns The MapLibre layer ID to pass as `beforeId` to `map.addLayer()`.
     */
    getInsertBeforeId(zIndex: number): string {
        let bestId: string | null = null;
        let bestZ = Infinity;

        for (const entry of this._entries.values()) {
            if (entry.zIndex > zIndex && entry.zIndex < bestZ && entry.subLayerIds.length > 0) {
                bestZ = entry.zIndex;
                bestId = entry.subLayerIds[0] ?? bestId;
            }
        }

        return bestId ?? SENTINEL_POI;
    }

    // ── Cleanup ──────────────────────────────────────────────────────────────

    /** Removes all entries. */
    clear(): void {
        this._entries.clear();
    }
}
