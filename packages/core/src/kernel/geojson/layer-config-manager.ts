/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf GeoJSON Module - Layer Configuration Manager
 * Layer configuration and option handling
 */

import { getLog } from "../../utils/general/di-accessors.js";
import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";
import { loadAndValidateStyle } from "../../utils/loaders/style-loader-core.js";
import type { GeoJSONFeature } from "./geojson-types.js";
import type { GeoJSONLoaderLog } from "./loader/loader-types.js";

/** Minimal profile shape consumed by the layer-config helpers. */
interface ProfileLike {
    id: string;
    basePath?: string;
    [key: string]: unknown;
}

/** Legends config block on a layer definition. */
interface LegendsConfig {
    directory?: string;
    default?: string;
    [key: string]: unknown;
}

/** Minimal layer-definition view consumed by the layer-config helpers. */
interface LayerDefLike {
    id: string;
    geometryType?: string;
    style?: string;
    legends?: LegendsConfig;
    styles?: { default?: string; directory?: string; [key: string]: unknown };
    _profileId?: string;
    _layerDirectory?: string;
    [key: string]: unknown;
}

/** Loose FeatureCollection view used for geometry-type inference. */
interface FeatureCollectionLike {
    features?: GeoJSONFeature[];
    [key: string]: unknown;
}

/** Public surface of the layer-config manager (assembled below). */
interface LayerConfigManagerShape {
    resolveDataFilePath(dataFile: string, profile: ProfileLike, layerDirectory?: string): string;
    inferGeometryType(def: LayerDefLike | null, geojsonData: FeatureCollectionLike | null): string;
    loadLayerLegend(profile: ProfileLike, layerDef: LayerDefLike | null): void;
    loadDefaultStyle(layerId: string, layerDef: LayerDefLike): Promise<Record<string, unknown>>;
}

const LayerConfigManager = {} as LayerConfigManagerShape;

/**
 * Reads the two coordinates every profile-relative path is built from: the profiles root and
 * the active profile id.
 *
 * Both prefer the runtime `data` configuration over the profile that was passed in — the
 * integrator's `activeProfile` wins over `profile.id`, so a profile object obtained before a
 * switch cannot resolve paths against the previous profile. `profile.id` is the fallback, and
 * `"profiles"` the default root.
 *
 * ⚠️ This helper was extracted from {@link LayerConfigManager.resolveDataFilePath}, and its
 * TSDoc did not follow: until 29/07/2026 it carried that function's block, describing three
 * parameters and a `string` return that this signature never had.
 *
 * @param profile - Active profile; only its `id` is read, and only as a fallback.
 * @returns The profiles root path and the resolved profile id.
 */
function _resolveProfileBasePath(profile: ProfileLike): {
    profilesBasePath: string;
    profileId: string;
} {
    const Config = getGeoLeaf()?.Config;
    const dataCfg = Config && Config.get ? (Config.get("data") as Record<string, unknown>) : null;
    return {
        profilesBasePath: (dataCfg?.profilesBasePath as string | undefined) || "profiles",
        profileId: (dataCfg?.activeProfile as string | undefined) || profile.id,
    };
}

/**
 * Resolves the style **id** a layer's `styles.default` designates.
 *
 * `styles.default` names a FILE (`"defaut.json"`) while the theme engine addresses styles by
 * ID (`"defaut"`), and the shared style cache is keyed `profileId:layerId:styleId`. Resolving
 * one to the other is what lets the boot preload and the theme apply hit the same cache entry
 * instead of fetching the same URL twice — measured at 16 fetches for 8 layers before S5.2.
 *
 * ⚠️ The `available` lookup is the authority; the extension-stripped filename is only a
 * fallback for layers that declare no `available` block. All 24 layers shipped in `profiles/`
 * resolve through `available`, each matching exactly one entry.
 *
 * @param styles - The layer's `styles` block.
 * @returns The resolved style id.
 */
function _resolveDefaultStyleId(styles: NonNullable<LayerDefLike["styles"]>): string {
    const file = styles.default;
    const available = Array.isArray(styles.available)
        ? (styles.available as { id?: string; file?: string }[])
        : [];
    const match = available.find((s) => s && s.file === file);
    if (match?.id) return match.id;
    return String(file).replace(/\.json$/i, "");
}

/**
 * Resolves the absolute path of a data file relative to the active profile.
 *
 * A `dataFile` beginning with `../` escapes the layer sub-directory and resolves against the
 * profile folder instead — that is the documented way to share one dataset between several
 * layers of the same profile without duplicating it.
 *
 * @param dataFile - Data file name, or a path relative to the layer directory.
 * @param profile - Active profile; used only to resolve the profile id.
 * @param layerDirectory - Layer sub-directory within the profile, when the file lives in one.
 * @returns The resolved path, rooted at the configured profiles directory.
 */
LayerConfigManager.resolveDataFilePath = function (
    dataFile: string,
    profile: ProfileLike,
    layerDirectory?: string
) {
    const { profilesBasePath, profileId } = _resolveProfileBasePath(profile);

    // A dataFile starting with ../ resolves relative to the profile folder
    if (dataFile.startsWith("../")) {
        // dataFile = "../raw/file.json" -> "profiles/tourism/raw/file.json"
        const relativePath = dataFile.replace("../", "");
        return `${profilesBasePath}/${profileId}/${relativePath}`;
    }

    // A dataFile starting with / is an absolute path
    if (dataFile.startsWith("/")) {
        return dataFile;
    }

    // Otherwise it is relative to the layer folder (layers/tourism_poi_all/data/file.json)
    if (layerDirectory) {
        return `${profilesBasePath}/${profileId}/${layerDirectory}/${dataFile}`;
    }

    // Fallback: relative to the profile folder
    return `${profilesBasePath}/${profileId}/${dataFile}`;
};

/**
 * Infers the geometry type of a layer from its definition or its GeoJSON features.
 *
 * @param {Object} def - Layer definition (may contain a `geometryType` field).
 * @param {Object} geojsonData - GeoJSON data.
 * @returns {string} Geometry type: `'point'`, `'line'`, `'polygon'`, or `'unknown'`.
 */
LayerConfigManager.inferGeometryType = function (
    def: LayerDefLike | null,
    geojsonData: FeatureCollectionLike | null
) {
    if (def && typeof def.geometryType === "string") return def.geometryType;
    const features = geojsonData && Array.isArray(geojsonData.features) ? geojsonData.features : [];
    const first = features.find((f) => f && f.geometry && f.geometry.type);
    if (!first) return "unknown";
    const geometryType = first.geometry.type.toLowerCase();
    if (geometryType.includes("point")) return "point";
    if (geometryType.includes("line")) return "line";
    if (geometryType.includes("polygon")) return "polygon";
    return "unknown";
};

/**
 * Builds the URL of a layer's legend file, from the profile and layer layout.
 *
 * Pure string assembly — it reaches neither the network nor the Legend module. The shape is
 * `<profileBasePath>/<layerDirectory>/<legendsDirectory>/<file>`, where each segment falls
 * back to a convention when the profile does not state it: `./profiles/<id>` for the profile
 * base, `layers/<id>` for the layer directory, `legends` for the legend directory.
 *
 * The file is `<activeStyle>.legend.json`, except for the `default` style when the config
 * names an explicit `default` file.
 *
 * ⚠️ This block previously described `loadLayerLegend` — a different function, on the public
 * surface, which does trigger the Legend module. It stayed here when the path builder was
 * extracted (see `LayerConfigManager.loadLayerLegend` below, which now carries it).
 *
 * @param profile - Active profile; `basePath` overrides the `./profiles/<id>` convention.
 * @param layerDef - Layer definition; `_layerDirectory` overrides the `layers/<id>` convention.
 * @param legendsConfig - The layer's `legends` block: `directory` and an optional `default` file.
 * @param activeStyle - Style whose legend is wanted; `"default"` selects the explicit file
 *   when one is configured.
 * @returns The assembled legend path.
 */
function _buildLegendPath(
    profile: ProfileLike,
    layerDef: LayerDefLike,
    legendsConfig: LegendsConfig,
    activeStyle: string
): string {
    const legendDirectory = legendsConfig.directory || "legends";
    const legendFile =
        activeStyle === "default" && legendsConfig.default
            ? legendsConfig.default
            : `${activeStyle}.legend.json`;
    const profileBasePath = profile.basePath || "./profiles/" + profile.id;
    const layerDirectory = layerDef._layerDirectory || "layers/" + layerDef.id;
    return `${profileBasePath}/${layerDirectory}/${legendDirectory}/${legendFile}`;
}

/** Legend module surface used here (the `loadLayerLegend` member is on the global's `unknown` tail). */
interface LegendModuleLike {
    loadLayerLegend?: (layerId: string, activeStyle: string, layerDef: LayerDefLike) => void;
}

function _invokeLegendModule(
    layerDef: LayerDefLike,
    activeStyle: string,
    Log: GeoJSONLoaderLog
): void {
    const Legend = getGeoLeaf()?.Legend as LegendModuleLike | undefined;
    if (Legend && typeof Legend.loadLayerLegend === "function") {
        try {
            Legend.loadLayerLegend(layerDef.id, activeStyle, layerDef);
            if (Log)
                Log.info(
                    `[GeoLeaf.GeoJSON] Legend shown for ${layerDef.id} (style: ${activeStyle})`
                );
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            if (Log) Log.warn(`[GeoLeaf.GeoJSON] Error loading legend: ${message}`);
        }
    } else {
        if (Log) Log.warn("[GeoLeaf.GeoJSON] Legend module not available");
    }
}

/**
 * Triggers the Legend module to display the legend for a layer.
 *
 * A no-op — logged at debug, never thrown — when the layer definition is absent or carries no
 * `legends` block, and a warning when the Legend module itself is not mounted. Displaying a
 * legend is therefore never a hard failure of layer loading.
 *
 * @param profile - Active profile.
 * @param layerDef - Layer definition (must include a `legends` config).
 *
 * @example
 * ```js
 * GeoLeaf._GeoJSONLayerConfig.loadLayerLegend(
 *     { id: "tourism", basePath: "../profiles/tourism" },
 *     { id: "poi_all", style: "par_categorie", legends: { directory: "legends" } }
 * );
 * ```
 */
LayerConfigManager.loadLayerLegend = function (
    profile: ProfileLike,
    layerDef: LayerDefLike | null
) {
    const Log = getLog();

    if (!layerDef) {
        if (Log) Log.debug("[GeoLeaf.GeoJSON] No layer definition");
        return;
    }

    const layerConfig = layerDef.legends ? layerDef : null;

    if (!layerConfig || !layerConfig.legends) {
        if (Log) Log.debug("[GeoLeaf.GeoJSON] No legend config for this layer");
        return;
    }

    const activeStyle = layerDef.style || "default";
    const legendPath = _buildLegendPath(profile, layerDef, layerConfig.legends, activeStyle);

    if (Log)
        Log.debug(`[GeoLeaf.GeoJSON] Loading legend for style "${activeStyle}": ${legendPath}`);

    _invokeLegendModule(layerDef, activeStyle, Log);
};

/**
 * Loads the default style for a layer from its `styles/*.json` file.
 *
 * Since S5.2 this delegates to {@link loadAndValidateStyle} rather than issuing its own
 * `fetch()`. Two consequences, both intended:
 *
 * - **One request per style instead of two.** The theme engine asks for the same file over
 *   its own path; sharing that function's cache — keyed `profileId:layerId:styleId` — is what
 *   collapses the pair. `layerId` is therefore no longer decorative: it is half the key.
 * - **The style is now validated here too.** This path used to apply whatever it parsed. A
 *   file that fails the GeoLeaf schema now throws, and the caller
 *   (`loader/single-layer._preloadStyle`) degrades the layer to neutral styling with a notice.
 *
 * @async
 * @param layerId - Layer id. Half of the shared style-cache key, so it must be the same id
 *   the theme engine uses for this layer.
 * @param {Object} layerDef - Layer definition.
 * @param {Object} layerDef.styles - Styles config.
 * @param {string} layerDef.styles.default - Default style **filename**; the matching
 *   `styles.available[].id` is what keys the cache.
 * @param {string} layerDef.styles.directory - Style sub-directory. Defaults to `styles`.
 * @param {string} layerDef._profileId - Profile ID (internal metadata).
 * @param {string} layerDef._layerDirectory - Layer directory (internal metadata).
 * @returns {Promise<Object>} Parsed style JSON — the raw file, unwrapped from the
 *   `{ styleData, labelConfig, metadata }` envelope the shared loader returns.
 * @throws {Error} When `styles.default` is missing, metadata is absent, the fetch fails, or
 *   the file does not match the GeoLeaf style schema.
 * @example
 * const style = await GeoLeaf._GeoJSONLayerConfig.loadDefaultStyle(
 *   'provincia_ar',
 *   { styles: { default: 'default.json' }, _profileId: 'tourism', _layerDirectory: 'layers/provincia_ar' }
 * );
 */
LayerConfigManager.loadDefaultStyle = async function (layerId: string, layerDef: LayerDefLike) {
    const Log = getLog();

    if (!layerDef.styles || !layerDef.styles.default) {
        throw new Error("No default style defined");
    }

    const profileId = layerDef._profileId;
    const layerDirectory = layerDef._layerDirectory;

    if (!profileId || !layerDirectory) {
        throw new Error("Missing metadata (profileId or layerDirectory)");
    }

    const { profileId: resolvedProfileId } = _resolveProfileBasePath({ id: profileId });
    const styleId = _resolveDefaultStyleId(layerDef.styles);

    Log.debug("[GeoLeaf.GeoJSON] Loading default style:", `${layerId}/${styleId}`);

    const result = (await loadAndValidateStyle(
        resolvedProfileId,
        layerId,
        styleId,
        layerDef.styles.default,
        layerDirectory,
        layerDef.styles.directory || "styles"
    )) as { styleData?: unknown } | undefined;

    // `loadAndValidateStyle` wraps the parsed file as `{ styleData, labelConfig, metadata }`;
    // this function's callers consume the raw style object, so unwrap and keep the contract.
    const styleData = result?.styleData;
    if (!styleData) throw new Error("Style loaded but empty");
    Log.debug("[GeoLeaf.GeoJSON] Style loaded:", styleData);
    return styleData as Record<string, unknown>;
};

export { LayerConfigManager };
