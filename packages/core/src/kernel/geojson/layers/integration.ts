/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf GeoJSON Layer Manager - Integration
 * Layer Manager UI registration, legend loading, populate with all configs
 */
"use strict";

import { GeoJSONShared } from "../shared.js";
import { getAllLayerConfigs } from "../../shared/layer-configs-state.js";
import { getLog } from "../../../utils/general/di-accessors.js";
import { getGeoLeaf } from "../../../utils/general/geoleaf-global.js";
import type { GeoJSONLayerEntry } from "../core-types.js";

const getState = () => GeoJSONShared.state;

/** Logger surface used across this module. */
type Logger = ReturnType<typeof getLog>;

/** Layer config payload registered into the host LayerManager module. */
interface LayerManagerRegisterPayload {
    layerManagerId: string;
    label?: string;
    themes?: unknown;
    styles?: unknown;
    labels?: unknown;
    checked?: boolean;
}

/** Minimal structural view of the host `GeoLeaf.LayerManager` module. */
interface LayerManagerModule {
    _registerGeoJsonLayer(id: string, payload: LayerManagerRegisterPayload): void;
    _updateContent?(): void;
    refresh?(): void;
}

/** A prepared layer item gathered into a section before registration. */
interface SectionItem {
    id: string;
    label?: string;
    zIndex: number;
    themes: unknown;
    styles: unknown;
    labels: unknown;
    isActive?: boolean;
}

/** A LayerManager section bucket keyed by `layerManagerId`. */
interface Section {
    id: string;
    order?: number;
    items: SectionItem[];
}

/** A layer config entry from the shared layer-configs store. */
interface AllLayerConfigEntry {
    id: string;
    label?: string;
    layerManagerId?: string;
    themes?: unknown;
    zIndex?: number;
    styles?: unknown;
    labels?: unknown;
}

/** `layerData` argument accepted by `_loadLayerLegend`. */
interface LegendLayerData {
    config?: unknown;
    currentStyleMetadata?: { id?: string };
}

/** Public surface assembled onto `_GeoJSONLayerManager` by this slice. */
interface LayerManagerIntegrationShape {
    registerWithLayerManager(): void;
    _loadLayerLegend(layerId: string, layerData: LegendLayerData): void;
    populateLayerManagerWithAllConfigs(activeThemeConfig: unknown): void;
}

const LayerManager = {} as LayerManagerIntegrationShape;

function _resolveLayerLabels(layerData: GeoJSONLayerEntry): {
    hasLabels: boolean;
    labelsConfig: unknown;
} {
    const labels = layerData.config.labels as { enabled?: boolean } | undefined;
    if (labels && labels.enabled) {
        return { hasLabels: true, labelsConfig: labels };
    }
    // `currentStyle.label` is polymorphic (`string | GeoJSONStyleLabelConfig`);
    // here we read the label-config object form (`{ enabled }`).
    const styleLabel = layerData.currentStyle?.label as { enabled?: boolean } | undefined;
    if (styleLabel?.enabled) {
        return { hasLabels: true, labelsConfig: { enabled: true } };
    }
    return { hasLabels: false, labelsConfig: null };
}

function _logLayerPreparation(id: string, layerData: GeoJSONLayerEntry, Log: Logger): void {
    if (!Log) return;
    Log.info(`[GeoJSON LayerManager] Preparing layer item ${id}:`, {
        hasConfig: !!layerData.config,
        hasStyles: !!(layerData.config && layerData.config.styles),
        styles: layerData.config ? layerData.config.styles : "NO CONFIG",
        configKeys: layerData.config ? Object.keys(layerData.config).sort() : [],
    });
}

function _processLayerForSection(
    layerData: GeoJSONLayerEntry,
    id: string,
    sectionMap: Map<string, Section>,
    Log: Logger
): void {
    const sectionId = (layerData.config.layerManagerId as string) || "geojson-default";
    let section = sectionMap.get(sectionId);
    if (!section) {
        section = { id: sectionId, order: 99, items: [] };
        sectionMap.set(sectionId, section);
    }
    const { hasLabels, labelsConfig } = _resolveLayerLabels(layerData);
    _logLayerPreparation(id, layerData, Log);
    section.items.push({
        id: id,
        // Le défaut appartient au PRODUCTEUR : l'identité d'une couche. Trois consommateurs
        // en aval le ré-appliquaient (`options.label || layerId`, `layer.label || layer.id`) —
        // le hisser ici évite de propager `undefined` dans un objet qui part en registre.
        label: layerData.label ?? id,
        zIndex: layerData.config.zIndex || 0,
        themes: layerData.config.themes || null,
        labels: hasLabels ? labelsConfig : null,
        styles: layerData.config.styles || null,
    });
}

/**
 * Registers the layers with the LayerManager module.
 */
LayerManager.registerWithLayerManager = function () {
    const state = getState();
    const Log = getLog();
    const LMgr = getGeoLeaf()?.LayerManager as LayerManagerModule | undefined;

    Log.info(
        `[GeoLeaf.GeoJSON] registerWithLayerManager() called with ${state.layers.size} layer(s)`
    );

    if (!LMgr || typeof LMgr._registerGeoJsonLayer !== "function") {
        Log.warn("[GeoLeaf.GeoJSON] Module LayerManager unavailable, no layer manager integration");
        return;
    }

    // Group the layers by section id
    const sectionMap = new Map<string, Section>();

    state.layers.forEach((layerData, id) => {
        _processLayerForSection(layerData, id, sectionMap, Log);
    });

    // Add each section to the layer manager
    sectionMap.forEach((section) => {
        // Sort items by descending zIndex (high zIndex = on top = displayed above)
        section.items.sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));

        // Register each layer with the LayerManager
        section.items.forEach((item) => {
            Log.debug(
                `[GeoLeaf.GeoJSON] Registering layer "${item.id}" in section "${section.id}"`
            );
            LMgr._registerGeoJsonLayer(item.id, {
                layerManagerId: section.id,
                label: item.label ?? item.id,
                themes: item.themes,
                styles: item.styles,
                labels: item.labels,
            });
        });

        Log.debug(
            "[GeoLeaf.GeoJSON] Layer section '" +
                section.id +
                "' created with " +
                section.items.length +
                " layer(s)"
        );
    });
};

/**
 * Loads a layer's legend when available
 * @param {string} layerId - Layer id
 * @param {Object} layerData - Layer data
 * @private
 */
/** A style entry inside `config.styles.available`. */
interface StyleAvailableEntry {
    id?: string;
    file?: string;
}

/** Minimal view of a layer config's `styles` block used for legend resolution. */
interface LayerStyleConfig {
    styles?: {
        available?: StyleAvailableEntry[];
        default?: string;
    };
}

function _resolveStyleIdFromAvailable(config: LayerStyleConfig): string | null {
    if (!config.styles) return null;
    if (!Array.isArray(config.styles.available)) return null;
    const available = config.styles.available;
    const defaultFile = config.styles.default;
    const defaultByFile = defaultFile ? available.find((s) => s.file === defaultFile) : null;
    if (defaultByFile && defaultByFile.id) return defaultByFile.id;
    if (available[0] && available[0].id) return available[0].id;
    return "default";
}

/** Style selector module exposed on the global namespace. */
interface StyleSelectorModule {
    getCurrentStyle(layerId: string): string | null | undefined;
}

/** Legend module exposed on the global namespace. */
interface LegendModule {
    loadLayerLegend(layerId: string, styleId: string, config: unknown): void;
}

function _resolveStyleId(
    layerId: string,
    layerData: { currentStyleMetadata?: { id?: string } },
    config: LayerStyleConfig
): string {
    const styleSelector = getGeoLeaf()?._LayerManagerStyleSelector as
        StyleSelectorModule | undefined;
    if (styleSelector && typeof styleSelector.getCurrentStyle === "function") {
        const sid = styleSelector.getCurrentStyle(layerId);
        if (sid) return sid;
    }
    if (layerData.currentStyleMetadata && layerData.currentStyleMetadata.id) {
        return layerData.currentStyleMetadata.id;
    }
    return _resolveStyleIdFromAvailable(config) || "default";
}

LayerManager._loadLayerLegend = function (layerId, layerData) {
    const config = (layerData.config || {}) as LayerStyleConfig;
    const GeoLeaf = getGeoLeaf();
    if (!GeoLeaf) return;
    const Legend = GeoLeaf.Legend as LegendModule | undefined;
    if (!Legend) return;
    if (typeof Legend.loadLayerLegend !== "function") return;
    const styleId = _resolveStyleId(layerId, layerData, config);
    Legend.loadLayerLegend(layerId, styleId, config);
};

/**
 * Populates the LayerManager with EVERY available layer configuration.
 * Unlike registerWithLayerManager(), which only shows the loaded layers (active theme),
 * this one lists EVERY layer and sets the checked state from the active theme.
 *
 * @param {Object} activeThemeConfig - Active theme configuration (holds the visible layer list)
 * @returns {void}
 */
function _getActiveThemeLayers(activeThemeConfig: unknown): string[] {
    const cfg = activeThemeConfig as { layers?: unknown } | null | undefined;
    if (!cfg) return [];
    if (!Array.isArray(cfg.layers)) return [];
    return cfg.layers.map((l: { id?: string } | string) =>
        typeof l === "string" ? l : l.id || (l as unknown as string)
    );
}

function _triggerLayerManagerUIUpdate(LMgr: LayerManagerModule, Log: Logger): void {
    if (typeof LMgr._updateContent === "function") {
        Log.debug("[GeoLeaf.GeoJSON] Calling LayerManager._updateContent()");
        LMgr._updateContent();
    } else if (typeof LMgr.refresh === "function") {
        Log.debug("[GeoLeaf.GeoJSON] Calling LayerManager.refresh()");
        LMgr.refresh();
    }
}

function _buildPopulateConfigSectionMap(
    allConfigs: AllLayerConfigEntry[],
    activeThemeLayers: string[]
): Map<string, Section> {
    const sectionMap = new Map<string, Section>();

    allConfigs.forEach((config) => {
        const sectionId = config.layerManagerId || "geojson-default";

        let section = sectionMap.get(sectionId);
        if (!section) {
            section = { id: sectionId, items: [] };
            sectionMap.set(sectionId, section);
        }

        const isActive = activeThemeLayers.includes(config.id);

        section.items.push({
            id: config.id,
            label: config.label ?? config.id,
            themes: config.themes || null,
            isActive: isActive,
            zIndex: config.zIndex || 0,
            styles: config.styles || null,
            labels: config.labels || null,
        });
    });

    return sectionMap;
}

function _registerPopulateSectionMap(
    sectionMap: Map<string, Section>,
    LMgr: LayerManagerModule,
    Log: Logger
): void {
    sectionMap.forEach((section) => {
        section.items.sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));

        section.items.forEach((item) => {
            Log.debug(
                `[GeoLeaf.GeoJSON] Registering layer "${item.id}" in section "${section.id}" (active: ${item.isActive})`
            );
            LMgr._registerGeoJsonLayer(item.id, {
                layerManagerId: section.id,
                label: item.label ?? item.id,
                themes: item.themes,
                checked: item.isActive ?? false,
                styles: item.styles,
                labels: item.labels,
            });
        });

        Log.debug(
            `[GeoLeaf.GeoJSON] Section "${section.id}" populated with ${section.items.length} layer(s)`
        );
    });
}

LayerManager.populateLayerManagerWithAllConfigs = function (activeThemeConfig) {
    const Log = getLog();
    const GeoLeaf = getGeoLeaf();
    const LMgr = GeoLeaf?.LayerManager as LayerManagerModule | undefined;

    if (!LMgr || typeof LMgr._registerGeoJsonLayer !== "function") {
        Log.warn(
            "[GeoLeaf.GeoJSON] populateLayerManagerWithAllConfigs: LayerManager module unavailable"
        );
        return;
    }

    // API S4.3e — lu au store partagé, plus sur le namespace. Ce module est sous `kernel/`,
    // il importe donc le fichier directement (la médiation par le baril ne s'impose qu'aux
    // `capabilities/`, cf. R.8).
    const allLayerConfigs = getAllLayerConfigs();
    if (!GeoLeaf || !allLayerConfigs || !Array.isArray(allLayerConfigs)) {
        Log.warn(
            "[GeoLeaf.GeoJSON] populateLayerManagerWithAllConfigs: configs de couches indisponibles"
        );
        return;
    }

    const configs = allLayerConfigs as AllLayerConfigEntry[];

    Log.info(`[GeoLeaf.GeoJSON] Populating LayerManager with ${configs.length} layer configs...`);

    const activeThemeLayers = _getActiveThemeLayers(activeThemeConfig);

    Log.debug(`[GeoLeaf.GeoJSON] Active layers for theme: ${activeThemeLayers.join(", ")}`);

    const sectionMap = _buildPopulateConfigSectionMap(configs, activeThemeLayers);

    _registerPopulateSectionMap(sectionMap, LMgr, Log);

    // Load legend data for layers active (visible) in the current theme
    if (typeof LayerManager._loadLayerLegend === "function") {
        configs.forEach((config) => {
            if (!activeThemeLayers.includes(config.id)) return;
            LayerManager._loadLayerLegend(config.id, { config });
        });
    }

    Log.info(`[GeoLeaf.GeoJSON] LayerManager populated successfully`);

    _triggerLayerManagerUIUpdate(LMgr, Log);
};
export { LayerManager as LayerManagerIntegration };
