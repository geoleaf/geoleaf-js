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
 * Layers are rendered in the order of the style (bottom to top). A sentinel
 * layer `gl-sentinel-poi` marks the boundary between ranked layers
 * and POI layers. GeoJSON and vector-tile layers are inserted before
 * this sentinel, ordered by ascending `zIndex`. A rank is given at insertion
 * and may change afterwards (`setZIndex`): the registry then holds the rank
 * the layer was moved to, which is no longer the one its profile declared.
 */

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
    /**
     * The rank the layer is registered under — what {@link MaplibreLayerRegistry.getInsertBeforeId}
     * orders by. It starts as the rank given at registration and follows every re-rank; it is
     * not bounded, and need not be an integer.
     */
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
     * @param zIndex - The rank the layer is registered under.
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
            // The entry is kept in `this._entries` and re-read by key: a key present with
            // value `undefined` is not equivalent there to an absent key.
            ...(options?.geometryTypes !== undefined && { geometryTypes: options.geometryTypes }),
            isVectorTile: options?.isVectorTile ?? false,
            ...(options?.sourceLayer !== undefined && { sourceLayer: options.sourceLayer }),
        };
        this._entries.set(layerId, entry);
        return entry;
    }

    /**
     * Records sub-layers added to a layer AFTER its registration — a layer that received a
     * geometry it had no sub-layer for (`growGeoJSONLayer`).
     *
     * `subLayerIds` is read bottom-up by the ordering code — its first id is the bottom of
     * the layer's stack, which {@link getInsertBeforeId} anchors other layers on — so the
     * list is put back in the order the engine DRAWS, never appended to.
     *
     * @param layerId - GeoLeaf layer identifier.
     * @param added - The sub-layer families added.
     * @param geometryTypes - The GeoJSON geometry types the layer now also holds.
     * @param drawingOrder - Every layer id of the style, bottom first.
     * @returns `true` if the layer is registered; `false` otherwise, and nothing changed.
     */
    extend(
        layerId: string,
        added: readonly SubLayerType[],
        geometryTypes: Iterable<string>,
        drawingOrder: readonly string[]
    ): boolean {
        const entry = this._entries.get(layerId);
        if (!entry) return false;
        for (const type of added) {
            const subId = toSubLayerId(layerId, type);
            if (!entry.subLayerIds.includes(subId)) entry.subLayerIds.push(subId);
            entry.subLayerTypes.add(type);
        }
        // An id the style does not hold keeps its place at the end: `Array.sort` is stable.
        const rank = (id: string): number => {
            const at = drawingOrder.indexOf(id);
            return at === -1 ? Number.MAX_SAFE_INTEGER : at;
        };
        entry.subLayerIds.sort((x, y) => rank(x) - rank(y));
        const known = (entry.geometryTypes ??= new Set<string>());
        for (const t of geometryTypes) known.add(t);
        return true;
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
     * Records a new rank for a registered layer, and moves its entry to the END of the registry.
     *
     * The move is what keeps {@link getInsertBeforeId} right. A re-ranked layer is drawn above
     * the layers already holding its new rank, and that method takes the FIRST entry of a rank
     * for the bottom of its group. An entry re-ranked where it stood could be that first entry
     * while drawn on top of the group: the next layer inserted under that rank would anchor on
     * it, and end above layers it belongs under.
     *
     * @param layerId - GeoLeaf layer identifier.
     * @param zIndex - The rank the layer is now drawn at.
     * @returns `true` if the layer is registered; `false` otherwise, and nothing changed.
     */
    setZIndex(layerId: string, zIndex: number): boolean {
        const entry = this._entries.get(layerId);
        if (!entry) return false;
        this._entries.delete(layerId);
        entry.zIndex = zIndex;
        this._entries.set(layerId, entry);
        return true;
    }

    /**
     * Computes the `beforeId` for placing a layer at the given z-index.
     *
     * Finds the entry with the lowest **strictly higher** z-index and returns its first
     * sub-layer ID. If none exists, returns the sentinel layer ID so the layer goes just below
     * the POI boundary. Among entries of the same rank the first registered answers: it is the
     * bottom of its group, every later layer of that rank having been placed above it.
     *
     * @param zIndex - The z-index of the layer being placed.
     * @param excludeLayerId - A layer left out of the search: the one being re-ranked, which
     *   must not anchor on itself.
     * @returns The MapLibre layer ID to pass as `beforeId` to `map.addLayer()` or
     *   `map.moveLayer()`.
     */
    getInsertBeforeId(zIndex: number, excludeLayerId?: string): string {
        let bestId: string | null = null;
        let bestZ = Infinity;

        for (const [layerId, entry] of this._entries) {
            if (layerId === excludeLayerId) continue;
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
