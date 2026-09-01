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
 * Resolved label style passed to the renderer. Built either from an integrated
 * (style-embedded) label or from a free-standing `labelConfig`. Permissive on
 * purpose — profile authors add arbitrary keys.
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
    offset?: { distancePx?: number; [key: string]: unknown };
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
 * The free-form `labelConfig` bag accepted by `enableLabels()`. Mirrors the
 * profile-authored label options; everything is optional and permissive.
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
    offset?: { distancePx?: number; [key: string]: unknown };
    minZoom?: number;
    maxZoom?: number;
    [key: string]: unknown;
}

// ─── Layer entry (subset of GeoJSON layer entry labels reads) ───────────────

/** The `currentStyle.label` object as the labels module reads it. */
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
 * the fields actually read: visibility state, current style and loaded features.
 */
export interface LabelLayerData {
    currentStyle?: LayerCurrentStyle | null;
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
     * Brings the labels capability up and attaches its zoom listener.
     *
     * @param options - Capability options, merged over `modules.labels` from the profile.
     *
     * @example
     * ```js
     * GeoLeaf.Labels.init();
     * // ou avec options
     * GeoLeaf.Labels.init({ defaultEnabled: false });
     * ```
     */
    init(options?: Record<string, unknown>): void;

    /**
     * Applies a layer's declared label configuration, if it has one.
     *
     * Called by the loader as each layer comes up. A layer without a `label` block is left
     * alone — this is not the way to enable labels on a layer that declares none, use
     * {@link LabelsApi.enableLabels} with an inline config for that.
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
     * Turns labels on for a layer, optionally with an inline configuration.
     *
     * ⚠️ The return type is `Promise<void> | void`, not always a promise: the call only
     * becomes asynchronous when it has a `styleFile` to fetch. `await` it anyway — that is
     * the only form that is correct in both cases.
     *
     * @param layerId - Layer to label.
     * @param labelConfig - Inline configuration; omitted, the layer's declared `label` block
     *   is used. `property` names the feature field to display, and `template` supersedes it
     *   with a function over the whole properties object.
     * @param showImmediately - Render at once instead of waiting for the next zoom
     *   evaluation. Defaults to `false`.
     *
     * @example
     * ```js
     * // Activation simple
     * await GeoLeaf.Labels.enableLabels("poi_restaurants");
     *
     * // Avec config inline
     * await GeoLeaf.Labels.enableLabels("poi_restaurants", {
     *     property: "name",
     *     minZoom: 14,
     * });
     *
     * // Affichage immédiat
     * await GeoLeaf.Labels.enableLabels("poi_hotels", { property: "name" }, true);
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
     * The configuration is kept, so {@link LabelsApi.toggleLabels} can bring them back
     * without re-supplying it.
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
     * Whether a layer carries a label configuration at all.
     *
     * Distinct from {@link LabelsApi.areLabelsEnabled}: a layer can be configured and
     * currently off. This is the test that decides whether a label button is worth rendering.
     *
     * @param layerId - Layer to inspect.
     * @returns `true` when a configuration exists.
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
     * @returns The button, or `null` when the layer carries no label configuration.
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
     * Re-reads a layer's state and repaints its button now, bypassing the debounce.
     *
     * The urgent path, for changes the user just caused — a visibility toggle, a theme
     * switch. The debounced counterpart is the private `_doSync`.
     *
     * @param layerId - Layer whose button is repainted.
     *
     * @example
     * ```js
     * // Called after layer visibility toggle (urgent)
     * GeoLeaf._LabelButtonManager?.syncImmediate("poi-restaurants");
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
