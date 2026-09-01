/*!
 * GeoLeaf Core — Layer data seam (public contract)
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Public contract for the `GeoLeaf.Layers` kernel seam — generic per-layer
 * feature access & mutation, promoted from the internal `GeoJSONCore` store.
 *
 * `GeoLeaf.Layers` is the single, engine-agnostic surface through which plugins
 * (feature CRUD, offline replay) and in-core capabilities (filter, search) read
 * and mutate a layer's features by `layerId` — with no knowledge of "POI".
 * ⚠️ The two use cases were named by their PLUGIN until the 19/08/2026, and both plugins
 * have since been removed or renamed. A contract described by its callers dates with them;
 * described by its use cases, it stays true. Reads are a promotion of the existing per-layer store; the unit
 * mutations, ephemeral feature-state and dedup-merge are the seam's additions.
 *
 * TS strict, no `any`.
 */

/**
 * Ephemeral GPU-side feature-state (sync badge, hover, selection). Applied via
 * `map.setFeatureState()` and therefore requiring `promoteId` on the source; it
 * is cleared by any source data rebuild (`setData`/`updateLayerData`), so a
 * durable flag must also be baked on the feature property (see `patchFeature`).
 */
export interface LayerFeatureState {
    /** `"pending"` → sync badge stroke; `"synced"`/absent → cleared. */
    syncStatus?: string;
    /** Hover halo. */
    hover?: boolean;
    /** Selection halo. */
    selected?: boolean;
    [key: string]: unknown;
}

/**
 * The object mounted on `GeoLeaf.Layers`. Reads promote the per-layer
 * `GeoJSONCore` store; the base-dataset writes, unit mutations, visible-subset,
 * reactive paint and merge are the seam's own surface.
 */
export interface LayerDataApi {
    // ── read (GeoJSONCore promotion) ──

    /** All features of a layer (empty array when the layer is unknown). */
    getFeatures(layerId: string): GeoJSON.Feature[];
    /** A single feature by its stable id (`feature.id` or `properties.id`), or `null`. */
    getFeatureById(layerId: string, id: string | number): GeoJSON.Feature | null;
    /** Number of features currently held for a layer. */
    getFeatureCount(layerId: string): number;
    /** Ids of every layer known to the store. */
    listLayerIds(): string[];
    /** `true` when a layer with this id exists in the store. */
    hasLayer(layerId: string): boolean;

    // ── base dataset write ──

    /** Replaces a layer's base features, re-renders the source, and emits. */
    setData(layerId: string, features: GeoJSON.Feature[]): void;
    /** Empties a layer (equivalent to `setData(layerId, [])`). */
    clear(layerId: string): void;

    // ── unit mutations (per-feature CRUD) ──

    /** Appends one feature to the base dataset. */
    addFeature(layerId: string, feature: GeoJSON.Feature): void;
    /** Removes one feature by id; returns `true` when a feature was removed. */
    removeFeature(layerId: string, id: string | number): boolean;
    /** Re-keys a feature (temp id → server id) on both `feature.id` and `properties.id`. */
    updateFeatureId(layerId: string, oldId: string | number, newId: string | number): void;
    /**
     * Merges `patch` into a feature's `properties` (baked — persists across
     * source rebuilds). Silent by default (no source rebuild); pass
     * `{ rerender: true }` to re-render immediately.
     */
    patchFeature(
        layerId: string,
        id: string | number,
        patch: Record<string, unknown>,
        opts?: { rerender?: boolean }
    ): void;

    // ── filtered display WITHOUT mutating the base (filter capability) ──

    /**
     * Displays only the features matching `predicate`, WITHOUT mutating the base
     * dataset — the subset is re-derived from the full base on each apply (GPU
     * `setFilter` id-match, JS predicate fallback).
     */
    setVisibleSubset(layerId: string, predicate: (f: GeoJSON.Feature) => boolean): void;
    /** Restores full visibility (clears any active subset). */
    clearVisibleSubset(layerId: string): void;

    // ── reactive paint (sync badge, hover/select) — adapter.setFeatureState passthrough ──

    /** Sets ephemeral feature-state on a feature (requires `promoteId` on the source). */
    setFeatureState(layerId: string, id: string | number, state: LayerFeatureState): void;

    // ── offline replay merge (plugin-storage) — normalize-free, dedup by id ──

    /** Upserts features into the base dataset, de-duplicated by id. */
    mergeFeatures(layerId: string, features: readonly GeoJSON.Feature[]): void;
}
