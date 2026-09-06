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
 * `map.setFeatureState()` and therefore requiring `promoteId` on the source.
 *
 * **A durable flag must ALSO be baked on the feature property** (see `patchFeature`).
 * That has always been the rule; what changed with R6 is the reason it matters.
 *
 * ⚠️ **This said "it is cleared by any source data rebuild (`setData`/`updateLayerData`)",
 * and that is no longer true of every write.** A whole-collection write still clears it.
 * A UNIT mutation now reaches the engine as a diff (`IMapAdapter.applyDataDiff`), which
 * updates features in place and leaves feature-state standing. The two writes therefore no
 * longer agree on this, and the difference is observable.
 *
 * The consequence to know before relying on it: the sync badge paints
 * `coalesce(feature-state.syncStatus, properties._syncStatus)` — **feature-state wins**.
 * While every write cleared it, the baked property was effectively authoritative; it no
 * longer is. Nothing in this repo sets that feature-state today (the only caller of
 * `setFeatureState` is this public passthrough), so no shipped behaviour changes — which
 * is precisely why no clearing was added: it would guard a caller that does not exist and
 * cost an engine call per mutation. An integrator who does set it must now clear it
 * themselves, and this paragraph is the notice.
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
 * Who last asked for a layer's visibility, as the centralized state records it.
 *
 * A union rather than an enum on purpose: `contracts/` is a **type-pure** surface
 * (gated), so it cannot export a runtime value — and it does not need to. The four
 * names are what makes {@link LayerDataApi.setVisibility} readable at the call site;
 * a caller writing `"system"` gets them checked without anything new being shipped.
 *
 * `"zoom"` is written by the engine when a scale threshold takes over, and is listed
 * for completeness — a caller has no reason to claim it.
 */
export type VisibilitySource = "user" | "theme" | "zoom" | "system";

/**
 * A layer definition, in the shape a profile's layer entry carries.
 *
 * This is deliberately the SAME object an integrator already writes in a profile
 * — `id` and an optional `label`, then a source (`url`, `dataFile`, or a `data`
 * block), plus the optional style, clustering, geometry and per-layer capability
 * blocks. It is declared here rather than invented so that a layer created at
 * runtime and a layer declared in a profile are described by one contract, and so
 * the JSON Schema that validates profiles keeps describing both.
 *
 * Only `id` is required, exactly as in the profile schema; every other key is
 * optional and reaches the loader untouched.
 */
export interface LayerDefinition {
    /** Unique layer identifier. */
    id: string;
    /** Display label; falls back to `id` when absent. */
    label?: string;
    /** Absolute or origin-relative URL of the layer's GeoJSON. */
    url?: string;
    /** Profile-relative data file, resolved against the active profile. */
    dataFile?: string;
    /**
     * Raw source data supplied by the caller, INSTEAD of a URL to resolve — the
     * same shape a fetched `url` would yield (it goes through the same mapping and
     * conversion). Supplying it makes `url`/`dataFile` unnecessary.
     *
     * 🛑 **RUNTIME-ONLY, and this is the one key of this interface that a profile
     * may NOT carry.** The interface's contract is that a runtime layer and a
     * profile layer are described once; this key is the deliberate exception, and
     * the motive is that a profile is a **static document** — a payload inlined
     * there would be data frozen into configuration, which is the defect
     * `dataFile` exists to avoid. ⚠️ The exception is **mechanical, not merely
     * documented**: `layers.schema.json` declares the layer object
     * `additionalProperties: false`, so a profile carrying this key fails
     * validation rather than silently working.
     *
     * 📌 Consumed once and not retained: the loader deletes its internal copy
     * after conversion, so a large collection is not held by the stored layer
     * definition.
     */
    inlineData?: unknown;
    /** Data-source block (`dataUrl`, `vectorTiles`, `directory`…). */
    data?: Record<string, unknown>;
    /** Style references (`default`, `available`, `directory`). */
    styles?: Record<string, unknown>;
    /** Point-clustering configuration. */
    clustering?: Record<string, unknown>;
    /** Geometry type, when it cannot be inferred from the features. */
    geometry?: string;
    /** Id of the plugin that renders this layer, when it is plugin-backed. */
    plugin?: string;
    /** `false` skips the layer, as in a profile. */
    active?: boolean;
    [key: string]: unknown;
}

/** What {@link LayerDataApi.create} hands back once a layer is on the map. */
export interface CreatedLayer {
    /** The layer's id — the one it can now be addressed by. */
    id: string;
    /** The label it was mounted under. */
    label: string;
    /** Features loaded, when the source yielded a countable body. */
    featureCount?: number;
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

    // ── visibility reads ──
    //
    // ⚠️ TWO accessors, and the split IS the design. The underlying state holds a
    // physical flag and an intent flag, and they disagree exactly when it matters:
    // a layer outside its zoom range is wanted but not painted. Handing out the raw
    // state made the two indistinguishable at the call site, and reading the
    // physical one to drive a toggle is a defect that has already been committed.
    // The user's own write is not repeated here — `GeoJSON.showLayer` / `hideLayer` /
    // `toggleLayer` already carry it, hard-wiring `"user"`. What `setVisibility` below
    // adds is the ONLY thing they cannot express: attributing the change to something
    // other than the user.

    /**
     * `true` when the layer is painted on the map right now.
     *
     * This is the PHYSICAL state. A zoom range can force it `false` while the layer
     * is still switched on, so use it to answer "what is on screen" — never to
     * decide what a toggle should show.
     */
    isVisible(layerId: string): boolean;
    /**
     * `true` when the layer is switched on, whatever the map is currently painting.
     *
     * This is the INTENT — what the user or the active theme asked for. It is what a
     * visibility toggle must reflect, since it does not flip on its own when the
     * viewer zooms out of the layer's range.
     */
    isEnabled(layerId: string): boolean;
    /**
     * `true` when a USER action last set this layer's visibility — as opposed to a
     * theme, a zoom threshold or the initial load.
     *
     * ⚠️ Distinct from {@link LayerDataApi.isEnabled}, and the two are easy to
     * confuse: `isEnabled` says WHAT is wanted, this says WHO wanted it. A theme that
     * switches a layer on leaves `isEnabled` true and this false. Read it to decide
     * whether an automatic rule may still override the layer, never to paint a toggle.
     */
    isUserOverridden(layerId: string): boolean;

    // ── visibility write ──

    /**
     * Sets a layer's visibility, **naming the source** of the change.
     *
     * 🛑 `source` is REQUIRED, and that is what keeps this from being a second door
     * to an existing room. `GeoJSON.showLayer` / `hideLayer` / `toggleLayer` already
     * carry the user's own actions and hard-wire `"user"`; this route exists only for
     * a caller that must attribute the change to something else — restoring a saved
     * state as `"system"`, applying its own rule as `"theme"`. Needing no attribution
     * means needing the existing trio, not this.
     *
     * The physical state is recomputed against the current zoom before returning, so
     * a layer outside its range stays unpainted while its intent is recorded — the
     * same two-step the existing writes perform.
     *
     * @param layerId - Id of the layer to switch.
     * @param visible - The intent to record.
     * @param source - Who is asking. See {@link VisibilitySource}.
     * @returns `true` when the state actually changed; `false` when the layer is
     *   unknown, or when it already held that intent from a source that outranks
     *   this one.
     */
    setVisibility(layerId: string, visible: boolean, source: VisibilitySource): boolean;

    // ── base dataset write ──

    /**
     * Creates and renders a layer the active profile does not declare, from a
     * definition supplied by the caller.
     *
     * The definition takes the same shape a profile's layer entry carries and
     * travels the same loading path, so the result is indistinguishable from a
     * profile-declared layer once mounted, and a relative `dataFile` resolves
     * against the active profile.
     *
     * ⚠️ This is a CREATE, not an upsert: an id that already names a layer is
     * refused rather than silently overwritten. The two operations have different
     * consequences and only one of them is reversible by the caller. To rewrite the
     * features of a layer that exists, use {@link LayerDataApi.setData}.
     *
     * The created layer is registered with the layer manager, so it gets its row
     * like any profile-declared layer — not only a rendering on the map.
     *
     * @param def - The layer definition. `id` is required.
     * @returns The created layer, or `null` when the definition named no resolvable
     *   source or was skipped by `active: false` (the reason is logged).
     * @throws When `def.id` is missing, or already names a layer.
     */
    create(def: LayerDefinition): Promise<CreatedLayer | null>;

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
