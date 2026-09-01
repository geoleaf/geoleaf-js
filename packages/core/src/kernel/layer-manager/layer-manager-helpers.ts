/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf LayerManager — Pure Helper Functions
 * Extracted from layer-manager-api.ts.
 * Contains stateless helpers used during LayerManager initialization.
 */

import { Log } from "../../utils/log/index.js";
import { getLabel } from "../../utils/i18n/i18n.js";

/** An item displayed inside a LayerManager section (layer / basemap / category entry). */
export interface LMItem {
    id: string;
    label?: string;
    order?: number;
    toggleable?: boolean;
    themes?: unknown;
    styles?: unknown;
    labels?: unknown;
    /**
     * Complementary info rendered as a plain value row by `renderItems` for
     * id-less entries. Covered by the index signature, but declared explicitly
     * so the rendering branch stays visible to readers.
     */
    value?: unknown;
    [key: string]: unknown;
}

/** Options accepted by `GeoLeaf._LayerManagerControl.create()`. */
export interface LMControlOptions {
    position?: string;
    title?: string;
    collapsible?: boolean;
    collapsed?: boolean;
    collapsedByDefault?: boolean;
    sections?: LMSection[];
}

/**
 * The control object returned by `GeoLeaf._LayerManagerControl.create()`.
 *
 * Declared here rather than in `control.ts` so that `layer-manager-api.ts` can
 * name it without importing the control module — `control.ts` sits on a chain
 * that loops back through `theme-applier`, and that import would close a cycle.
 */
export interface LMControlInstance {
    _map: unknown;
    /** Null until `_buildLMBody()` runs (i.e. before `addTo()`). */
    _bodyEl: HTMLElement | null;
    _container: HTMLElement | null;
    _glOptions: LMControlOptions & { sections?: LMSection[] };
    _controlHandle: { remove(): void } | null;
    _cleanups: (() => void)[];
    addTo(map: unknown): LMControlInstance;
    remove(): void;
    _buildStructure(): void;
    _renderSections(sections: LMSection[]): void;
    _toggleCollapsed(): void;
    updateSections(sections: LMSection[]): void;
    refresh(): void;
}

/** A LayerManager section grouping a set of {@link LMItem}s. */
export interface LMSection {
    id: string;
    label?: string;
    order?: number;
    collapsedByDefault?: boolean;
    items: LMItem[];
    [key: string]: unknown;
}

/** The LayerManager module options object that the helpers mutate. */
interface LMOptions {
    title?: string;
    collapsed?: boolean;
    sections?: LMSection[];
    map?: unknown;
    [key: string]: unknown;
}

/** A single layerManagerConfig section descriptor (config-time shape). */
interface LMConfigSection {
    id: string;
    label?: string;
    order?: number;
    collapsedByDefault?: boolean;
    [key: string]: unknown;
}

/** The `layerManagerConfig` configuration block consumed by {@link _applyLayerManagerConfig}. */
export interface LMConfig {
    title?: string;
    collapsedByDefault?: boolean;
    sections?: LMConfigSection[];
    [key: string]: unknown;
}

/** Options carried by a layer entry registered into the LayerManager. */
export interface LMLayerEntryOptions {
    label?: string;
    themes?: unknown;
    styles?: unknown;
    labels?: unknown;
    [key: string]: unknown;
}

/** A basemap definition entry (subset read while building basemap sections). */
interface BasemapDef {
    id?: string;
    label?: string;
    [key: string]: unknown;
}

/** The `GeoLeaf` namespace members read by the LayerManager helpers. */
export interface LMGlobalNamespace {
    Baselayers?: { getBaseLayers?: () => Record<string, BasemapDef> | null | undefined };
    Config?: { get?: (key: string) => unknown };
    Core?: { getMap?: () => unknown };
    [key: string]: unknown;
}

/** Minimal host surface (globalThis / window) accessed by the LayerManager helpers. */
export interface LMGlobalLike {
    GeoLeaf?: LMGlobalNamespace;
    [key: string]: unknown;
}

/**
 * Merges a layerManagerConfig object into the module options.
 *
 * A section declared in the config is inserted when absent, and otherwise
 * **overwrites** the `label`, `order` and `collapsedByDefault` of the section
 * already present — the config is authoritative. This matters because layers
 * register before `init()` folds the config in, so the sections they created
 * implicitly (generic i18n label, order 10, no accordion flag) are exactly the
 * ones the config has to correct. `items` is never touched.
 *
 * Sections absent from the config keep whatever they were created with.
 * The whole set is sorted by ascending `order` on the way out.
 * @internal
 */
export function _applyLayerManagerConfig(lmConfig: LMConfig, options: LMOptions): void {
    if (lmConfig.title) options.title = lmConfig.title;

    if (typeof lmConfig.collapsedByDefault === "boolean")
        options.collapsed = lmConfig.collapsedByDefault;

    if (!(Array.isArray(lmConfig.sections) && lmConfig.sections.length > 0)) return;

    const configSections: LMSection[] = lmConfig.sections
        .slice()
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map((s) => ({
            id: s.id,
            // Same idiom as the guarded assignments of
            // `options.title`/`options.collapsed` a few lines above in this file.
            ...(s.label !== undefined && { label: s.label }),
            ...(s.order !== undefined && { order: s.order }),
            ...(s.collapsedByDefault !== undefined && {
                collapsedByDefault: s.collapsedByDefault,
            }),
            items: [],
        }));

    if (!Array.isArray(options.sections)) options.sections = [];

    configSections.forEach((configSection) => {
        const existingSection = options.sections!.find((s) => s.id === configSection.id);
        if (!existingSection) {
            options.sections!.push(configSection);
            return;
        }
        // The config is authoritative over a section that
        // `_registerGeoJsonLayer` created implicitly (generic i18n label, hardcoded
        // order 10, no accordion flag) because layers register before init() folds
        // the config in. Guarding on `!existingSection.label` used to make this a
        // no-op, and `order`/`collapsedByDefault` were copied by no branch at all —
        // dropping the configured titles, the ordering, and every accordion.
        // `items` is never touched: layers already registered stay in place.
        if (configSection.label !== undefined) existingSection.label = configSection.label;
        if (configSection.order !== undefined) existingSection.order = configSection.order;
        if (configSection.collapsedByDefault !== undefined) {
            existingSection.collapsedByDefault = configSection.collapsedByDefault;
        }
    });

    options.sections.sort((a, b) => (a.order || 0) - (b.order || 0));

    Log?.info("[GeoLeaf.LayerManager] Sections merged with layerManagerConfig");
}

/**
 * Resolves the current basemap definitions from Baselayers or Config.
 * @internal
 */
export function _resolveBasemapDefs(g: LMGlobalLike): Record<string, BasemapDef> | null {
    if (g.GeoLeaf?.Baselayers && typeof g.GeoLeaf.Baselayers.getBaseLayers === "function") {
        return g.GeoLeaf.Baselayers.getBaseLayers() || {};
    }
    if (g.GeoLeaf?.Config && typeof g.GeoLeaf.Config.get === "function") {
        return (g.GeoLeaf.Config.get("basemaps") as Record<string, BasemapDef> | null) || {};
    }
    return null;
}

/**
 * Builds the auto-populated basemap section items from the basemap definitions.
 * @internal
 */
export function _buildAutoBasemapSections(g: LMGlobalLike): LMSection[] {
    const defs = _resolveBasemapDefs(g);
    if (!defs || Object.keys(defs).length === 0) return [];
    const baseItems: LMItem[] = Object.keys(defs).map((k) => ({
        id: k,
        label: (defs[k] || {}).label || k,
    }));
    return baseItems.length
        ? [{ id: "basemap", label: getLabel("ui.layer_manager.basemap_section"), items: baseItems }]
        : [];
}

/**
 * Creates a layer entry descriptor for the layer manager.
 * @internal
 */
export function _createLayerEntry(layerId: string, options: LMLayerEntryOptions): LMItem {
    return {
        id: layerId,
        label: options.label || layerId,
        toggleable: true,
        themes: options.themes || null,
        styles: options.styles || null,
        labels: options.labels || null,
    };
}

/**
 * Resolves the map instance from options or GeoLeaf.Core.
 * @internal
 */
export function _resolveMap(options: LMOptions, g: LMGlobalLike): unknown {
    let map: unknown = options.map || null;
    if (!map && g.GeoLeaf?.Core && typeof g.GeoLeaf.Core.getMap === "function") {
        map = g.GeoLeaf.Core.getMap();
    }
    return map;
}
