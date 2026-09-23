/*!
 * GeoLeaf Core — Labels runtime types
 * © 2026 Mattieu Pottier — MIT License — https://geoleaf.dev
 */
/**
 * Structural types for the Labels module (manager + renderer + button manager).
 *
 * Extracted so `labels.ts`, `label-renderer.ts` and `label-button-manager.ts`
 * share one typed view of the layer entries they read, the label style/config
 * objects, the MapLibre native map handle they call and the per-layer label
 * state — without re-declaring `any` locally
 * (mirrors `poi/core-types.ts` and `search-types.ts`).
 *
 * Layer/style/map shapes are intentionally permissive (`[key: string]: unknown`)
 * because they arrive from arbitrary user profiles and from runtime adapters;
 * narrow at the call site.
 *
 * This module is a LEAF: it imports NO types from `kernel/ui/` (cycle risk).
 */

// ─── Label style + config ───────────────────────────────────────────────────

/** Font sub-config of a label style. */
interface LabelFontConfig {
    family?: string;
    sizePt?: number;
    weight?: number;
    bold?: boolean;
    italic?: boolean;
    [key: string]: unknown;
}

/** Text-buffer (halo) sub-config of a label style. */
interface LabelBufferConfig {
    enabled?: boolean;
    color?: string;
    opacity?: number;
    sizePx?: number;
    [key: string]: unknown;
}

/** Scale window (1:X) controlling when a label is visible. */
interface LabelScaleConfig {
    minScale?: number | null;
    maxScale?: number | null;
    [key: string]: unknown;
}

/**
 * Where a label sits relative to the feature it names.
 *
 * ⚠️ This is the AUTHOR's vocabulary, never MapLibre's: `top` means the label is drawn
 * above the feature. MapLibre's `text-anchor` names the opposite thing — the edge of the
 * text pinned to the point — and the two are converted in `label-renderer.ts`.
 */
type LabelPlacement =
    | "center"
    | "top"
    | "bottom"
    | "left"
    | "right"
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right";

/** Label placement relative to the feature: which side, and how far from it. */
interface LabelOffsetConfig {
    placement?: LabelPlacement;
    /** Gap in CSS pixels between the feature and the nearest edge of the text box. */
    distancePx?: number;
    [key: string]: unknown;
}

/**
 * Resolved label style passed to the renderer. Built either from the layer's
 * declared label (its style's `label` object, else its definition's `labels`
 * block) or from a free-standing `labelConfig`. Permissive on purpose — profile
 * authors add arbitrary keys.
 */
export interface LabelStyleLike {
    enabled?: boolean;
    field?: string;
    className?: string;
    variant?: string;
    prefix?: string;
    suffix?: string;
    font?: LabelFontConfig;
    color?: string;
    opacity?: number;
    buffer?: LabelBufferConfig;
    background?: { enabled?: boolean; [key: string]: unknown };
    offset?: LabelOffsetConfig;
    textTransform?: string;
    visibleByDefault?: boolean;
    labelScale?: LabelScaleConfig;
    [key: string]: unknown;
}

/** Minimal label config consumed by the renderer (field id + zoom window). */
export interface LabelConfigLike {
    labelId?: string;
    minZoom?: number;
    maxZoom?: number;
    [key: string]: unknown;
}

/**
 * The inline `labelConfig` accepted by `enableLabels()`. When the call prepares labels, it is
 * stored with the layer's label state and read at every render, until another `enableLabels()`
 * call or a re-initialisation of the layer's labels (the loader, a style change) replaces that
 * state. The core makes such a call itself when a layer whose declaration says
 * `visibleByDefault: true` is shown again: its labels are prepared anew with an empty
 * configuration, and what an earlier call passed here is no longer read.
 *
 * What is read from it depends on the layer:
 * - a layer that DECLARES no label configuration — neither its style's `label` object nor its
 *   definition's `labels` block: this object is the whole configuration. `enabled: true` and
 *   `labelId` (the feature property displayed) are required; `font.sizePt`, `color`, `opacity`,
 *   `buffer` and `offset` shape the text;
 * - a layer that declares one: the declaration decides whether labels exist and how they look.
 *   Only two things are still read here — `labelId`, when the declaration names no `field`, and
 *   `minZoom`/`maxZoom`, when the layer's current style sets no `labelScale`.
 *
 * `minZoom` and `maxZoom` apply only together. `styleFile` is refused.
 */
export interface LabelUserConfig {
    enabled?: boolean;
    labelId?: string;
    styleFile?: string;
    font?: LabelFontConfig;
    color?: string;
    opacity?: number;
    buffer?: LabelBufferConfig;
    background?: { enabled?: boolean; [key: string]: unknown };
    offset?: LabelOffsetConfig;
    minZoom?: number;
    maxZoom?: number;
    [key: string]: unknown;
}

// ─── Layer entry (subset of GeoJSON layer entry labels reads) ───────────────

/**
 * A declared label configuration — the `currentStyle.label` object, else the definition's
 * `labels` block — as the labels module reads it.
 */
export interface LayerStyleLabel {
    enabled?: boolean;
    visibleByDefault?: boolean;
    labelScale?: LabelScaleConfig;
    [key: string]: unknown;
}

/** The `currentStyle` object as the labels module reads it. */
interface LayerCurrentStyle {
    label?: LayerStyleLabel;
    labelScale?: LabelScaleConfig;
    [key: string]: unknown;
}

/**
 * Minimal structural view of a GeoJSON layer entry (from
 * `GeoJSONCore.getLayerById()`) as consumed by the labels module. Narrowed to
 * the fields actually read: visibility state, current style, the definition's
 * `labels` block (read when the style carries no label configuration) and loaded
 * features.
 */
export interface LabelLayerData {
    currentStyle?: LayerCurrentStyle | null;
    config?: { labels?: unknown; [key: string]: unknown } | null;
    _visibility?: { current?: boolean; [key: string]: unknown };
    features?: unknown[];
    [key: string]: unknown;
}

// ─── Per-layer label state (Labels module internal store) ───────────────────

/** One removable tooltip / symbol-layer handle stored per feature. */
export interface RemovableTooltip {
    remove?: () => void;
    [key: string]: unknown;
}

/** State the Labels module keeps per registered layer. */
export interface LayerLabelState {
    enabled: boolean;
    config: LabelUserConfig;
    labelStyle: LabelStyleLike;
    tooltips: Map<string, RemovableTooltip>;
}

// ─── Map handles (MapLibre native map) ──────────────────────────────────────

/**
 * Minimal structural view of the map handle returned by `Core.getMap()` as the
 * labels module uses it. Permissive: the adapter is consumed via `getNativeMap()`
 * / `getLayerRegistry()` for the symbol-layer path, plus `on()` / `off()` /
 * `getZoom()` for the zoom listener. Narrow at the boundary.
 */
export interface LabelsMapHandle {
    on(event: string, handler: (...args: unknown[]) => void): void;
    /**
     * Symmetric detach for {@link LabelsMapHandle.on}. Declared **optional**, like
     * `getNativeMap` / `getLayerRegistry` below and for the same reason: the real
     * MapLibre adapter implements it, but partial adapters and test doubles supply
     * only what they are asked for. Optionality is what forces the teardown path to
     * guard — without it the contract offered no way out at all, and `destroy()`
     * could not release its `zoomend` subscription (CAPACITÉS backlog B.35b).
     */
    off?(event: string, handler: (...args: unknown[]) => void): void;
    getZoom(): number;
    getNativeMap?: () => LabelsNativeMap;
    getLayerRegistry?: () => LabelsLayerRegistry | undefined;
    [key: string]: unknown;
}

/** Layer registry handle exposed by the MapLibre adapter (source-id lookup). */
interface LabelsLayerRegistry {
    getSourceId?: (layerId: string) => string | undefined;
    [key: string]: unknown;
}

/** A single layer entry inside a MapLibre style document. */
interface MapStyleLayer {
    type?: string;
    layout?: Record<string, unknown>;
    [key: string]: unknown;
}

/** Minimal MapLibre style document shape (`layers` for font-stack discovery). */
interface MapStyleLike {
    layers?: MapStyleLayer[];
    [key: string]: unknown;
}

/**
 * Minimal structural view of the MapLibre native map used by the renderer's
 * symbol-layer path. Only the methods labels calls are typed.
 */
export interface LabelsNativeMap {
    getStyle?: () => MapStyleLike | undefined;
    getSource: (id: string) => unknown;
    getLayer: (id: string) => unknown;
    addLayer: (layer: Record<string, unknown>) => void;
    removeLayer: (id: string) => void;
    [key: string]: unknown;
}

// ─── Module API surfaces (singletons + lite stubs) ──────────────────────────

/**
 * Public + internal surface of the `Labels` singleton. Used to type the `this`
 * receiver / `self` parameters in `labels.ts` and the `Labels | null` lite stub.
 */
export interface LabelsApi {
    /**
     * Lifecycle entry point of the module. It only logs.
     *
     * It subscribes to nothing: the `zoomend` listener is attached later, once a layer's labels
     * are prepared, and the loader drives labels by direct calls. The labels capability calls it
     * when it mounts; an integrator has no need to.
     *
     * @param options - Ignored.
     *
     * @example
     * ```js
     * GeoLeaf.Labels.init();
     * ```
     */
    init(options?: Record<string, unknown>): void;

    /**
     * Rebuilds a layer's labels from its declared label configuration, if it has one.
     *
     * Called by the loader as a layer comes up, and again on a style change. A layer's declared
     * configuration is the `label` object of its current style, else — the style carrying none,
     * or its file being missing — the `labels` block of its definition. The layer's label state
     * is purged first, so a layer that declares neither, or declares `enabled: false`, ends up
     * with none — labels an inline {@link LabelsApi.enableLabels} call had set included. This is
     * not the way to enable labels on such a layer: use `enableLabels()` with an inline config.
     *
     * @param layerId - Layer to initialise.
     *
     * @example
     * ```js
     * GeoLeaf.Labels.initializeLayerLabels("poi_restaurants");
     * ```
     */
    initializeLayerLabels(layerId: string): void;

    /**
     * Prepares a layer's labels — from its declared configuration, else from an inline one — and
     * shows them unless told otherwise.
     *
     * It returns a promise — `await` it. A `labelConfig.styleFile` rejects it: label style files
     * are obsolete, the label object carries the look.
     *
     * Labels set up from an inline configuration are switched on and off by your own calls to
     * this method and {@link LabelsApi.disableLabels}: {@link LabelsApi.toggleLabels} and the
     * layer manager's labels button act only on a layer whose style or definition declares
     * labels. Hiding the layer — the layer manager's visibility toggle, `GeoJSON.hideLayer()`, a
     * theme — turns them off as `disableLabels()` does, and showing it again does not bring them
     * back: call `enableLabels()` again.
     *
     * @param layerId - Layer to label.
     * @param labelConfig - On a layer that DECLARES no label configuration — neither its style's
     *   `label` object nor its definition's `labels` block — the whole configuration, which then
     *   requires `enabled: true` and `labelId` (the feature property displayed). On a layer that
     *   declares one, the declaration wins, and a declared `enabled: false` disables the labels
     *   whatever is passed here; only `labelId` (when the declaration names no `field`) and
     *   `minZoom`/`maxZoom` (together, when the current style sets no `labelScale`) are still
     *   read. See `LabelUserConfig`.
     * @param showImmediately - Show the labels once prepared; they render only while the layer
     *   is visible. Defaults to `true`. A declared `visibleByDefault` takes precedence over it,
     *   and a definition's `labels` block that omits it counts as `visibleByDefault: false`.
     *
     * @example
     * ```js
     * // A layer whose style or definition declares its labels: nothing else to pass
     * await GeoLeaf.Labels.enableLabels("poi_restaurants");
     *
     * // A layer that declares none: the inline configuration, shown at once
     * // (labels render only while the layer is visible)
     * await GeoLeaf.Labels.enableLabels("poi_hotels", { enabled: true, labelId: "name" });
     *
     * // ...and turned off again. toggleLabels() would change nothing on this layer.
     * GeoLeaf.Labels.disableLabels("poi_hotels");
     * ```
     */
    enableLabels(
        layerId: string,
        labelConfig?: LabelUserConfig,
        showImmediately?: boolean
    ): Promise<void> | void;

    /**
     * Turns labels off for a layer and removes the rendered ones.
     *
     * The prepared configuration is kept. On a layer that declares its labels,
     * {@link LabelsApi.toggleLabels} brings them back without re-supplying it; labels set up
     * from an inline configuration come back only through another `enableLabels()` call.
     *
     * @param layerId - Layer whose labels are removed.
     *
     * @example
     * ```js
     * GeoLeaf.Labels.disableLabels("poi_restaurants");
     * ```
     */
    disableLabels(layerId: string): void;
    _hideLabelsForLayer(layerId: string): void;

    /**
     * Flips a layer's labels and reports the state it settled on.
     *
     * Acts only on a layer whose declared configuration — its style's `label` object, else its
     * definition's `labels` block — enables labels, and whose labels are prepared; for any other
     * it returns `false` and changes nothing. Labels set up from an inline `enableLabels()`
     * configuration are not among them: drive those with `disableLabels()` / `enableLabels()`.
     *
     * @param layerId - Layer to toggle.
     * @returns `true` when labels are enabled after the call.
     *
     * @example
     * ```js
     * const isNowEnabled = GeoLeaf.Labels.toggleLabels("poi_restaurants");
     * ```
     */
    toggleLabels(layerId: string): boolean;

    /**
     * Whether a layer's labels are prepared — by the loader, or by an `enableLabels()` call.
     *
     * Distinct from {@link LabelsApi.areLabelsEnabled}: prepared labels can be off. The layer
     * manager's labels button does not read it: it reads the layer's declared configuration.
     *
     * @param layerId - Layer to inspect.
     * @returns `true` when the module holds label state for the layer.
     *
     * @example
     * ```js
     * if (GeoLeaf.Labels.hasLabelConfig("poi_restaurants")) {
     *     // config présente
     * }
     * ```
     */
    hasLabelConfig(layerId: string): boolean;

    /**
     * Whether a layer's labels are currently on.
     *
     * @param layerId - Layer to inspect.
     * @returns `true` when labels are enabled.
     *
     * @example
     * ```js
     * if (GeoLeaf.Labels.areLabelsEnabled("poi_restaurants")) {
     *     console.log("Labels actifs");
     * }
     * ```
     */
    areLabelsEnabled(layerId: string): boolean;

    /**
     * Rebuilds a layer's labels against its current data.
     *
     * Needed after the underlying features changed — enabling alone does not re-read them.
     *
     * @param layerId - Layer to rebuild.
     *
     * @example
     * ```js
     * GeoLeaf.Labels.refreshLabels("poi_restaurants");
     * ```
     */
    refreshLabels(layerId: string): void;
    _createLabelsForLayer(layerId: string): Promise<void>;
    _getLayerData(layerId: string): LabelLayerData | null;
    _ensureZoomListener(): void;
    _handleZoomChange(detail: { zoom?: number }): void;
    _calculateMapScale(map: LabelsMapHandle | null): number;
    _isScaleInRange(
        currentScale: number,
        minScale: number | null | undefined,
        maxScale: number | null | undefined
    ): boolean;
    destroy(): void;
}

/** Per-layer state snapshot computed by the label button manager. */
export interface LabelButtonSyncState {
    layerId: string;
    layerExists: boolean;
    layerVisible: boolean;
    labelEnabled: boolean;
    areLabelsActive: boolean;
}

/**
 * Surface of the `LabelButtonManager` singleton. Used by `label-button-manager.ts`
 * and the `LabelButtonManager | null` lite stub.
 */
/**
 * The 🏷️ toggle buttons the layer manager injects next to each labelled layer.
 *
 * Mounted on the global as `GeoLeaf._LabelButtonManager`. ⚠️ There is **no `sync()` member**,
 * despite what `docs/labels/LABEL_BUTTON_MANAGER.md` documents: the surface is
 * {@link LabelButtonManagerApi.syncImmediate} plus the private `_doSync`, and every real
 * caller uses the former. The phantom went unnoticed because the global declares
 * `_LabelButtonManager?: unknown`, so no call through it was type-checked — typed since.
 */
export interface LabelButtonManagerApi {
    /**
     * Builds the toggle button for a layer and attaches it to the controls container.
     *
     * Called by the layer manager on first render of a layer item.
     *
     * @param layerId - Layer the button drives.
     * @param controlsContainer - Element the button is appended to.
     * @returns The button — the container's existing one if it has one — or `null` when an
     *   argument is missing. It is built for every layer, disabled; `syncImmediate()` enables it
     *   while the layer declares labels and is visible.
     *
     * @example
     * ```js
     * // Called by Layer Manager during first render
     * const button = GeoLeaf._LabelButtonManager?.createButton("poi-restaurants", controlsContainer);
     * ```
     */
    createButton(layerId: string, controlsContainer: HTMLElement): HTMLElement | null;
    _doSync(layerId: string): void;
    _getState(layerId: string): LabelButtonSyncState;
    _applyState(button: HTMLButtonElement, state: LabelButtonSyncState): void;

    /**
     * Re-reads a layer's state and repaints its button, synchronously.
     *
     * ⚠️ This said "bypassing the debounce" and named `_doSync` as "the debounced
     * counterpart" until 04/09/2026. **There is no debounce** — this module holds no
     * timer and no pending-sync state, and `_doSync` repaints on the spot. The claim
     * came from the shipped `docs/labels/` page, which described a 300 ms timer and a
     * `_syncTimeouts` map that were never in the code; both are corrected.
     *
     * ⚠️ Internal. The public route is `GeoLeaf.Labels.syncLayerControl()`, which
     * delegates here — prefer it, and see the migration table under
     * `docs/reference/consumers/`.
     *
     * @param layerId - Layer whose button is repainted.
     *
     * @example
     * ```js
     * // Called after a layer visibility toggle.
     * GeoLeaf.Labels.syncLayerControl("poi-restaurants");
     * ```
     */
    syncImmediate(layerId: string): void;

    /**
     * Removes every injected button and releases their listeners.
     *
     * ⚠️ Not cosmetic: each button carries two listeners that nothing else releases, so a
     * destroy without this leaves clickable toggles wired to a torn-down singleton.
     */
    removeButtons(): void;
}

/**
 * Minimal structural view of the GeoJSON core accessor used by the labels module
 * and its button manager (`getLayerById`). Cast `Core.getMap()` / `GeoJSONCore`
 * to these at the boundary instead of `any`.
 */
export interface LabelsGeoJSONCore {
    getLayerById?: (layerId: string) => LabelLayerData | null;
    [key: string]: unknown;
}
