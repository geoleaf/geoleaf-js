/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Cluster capability — per-layer clustering strategy decision.
 *
 * Decides whether a GeoJSON layer should be clustered, from the layer def and the
 * `modules.cluster` config. A clustered layer always gets its own clustered source. Ported
 * behaviour-preserving from the former `geojson/clustering.ts`; the only changes
 * are the config source (`modules.cluster` via `getClusterConfig()` instead of
 * `poiConfig`) and the capability enable gate.
 */

import { getLog } from "../../utils/general/di-accessors.js";
import { getClusterConfig } from "./config.js";
import { geometryFamily } from "../../kernel/config/index.js";
import { DEFAULT_CLUSTER_STRATEGY } from "./constants.js";
import type {
    ClusterConfig,
    ClusterLayerDef,
    LayerClusteringConfig,
    ClusterGeoJSONData,
    ClusterStrategyResult,
} from "./types.js";

const _CLUSTER_NONE: ClusterStrategyResult = { shouldCluster: false };
const _CLUSTER_ALL: ClusterStrategyResult = { shouldCluster: true };

function _resolveClusteringConfig(def: ClusterLayerDef): LayerClusteringConfig {
    if (typeof def.clustering === "object") return def.clustering;
    return { enabled: def.clustering as boolean };
}

function _resolveStrategyResult(
    strategy: string,
    isClusteringEnabled: boolean,
    config: ClusterConfig
): ClusterStrategyResult {
    const Log = getLog();
    switch (strategy) {
        case "unified":
            return _CLUSTER_ALL;
        case "by-layer":
            return { shouldCluster: isClusteringEnabled };
        case "by-source": {
            const sourceConfig = config.clusterStrategies?.["by-source"]?.sources ?? {};
            return { shouldCluster: sourceConfig.geojson !== false };
        }
        case "json-only": {
            const jsonOnlyConfig = config.clusterStrategies?.["json-only"] ?? {};
            return { shouldCluster: jsonOnlyConfig.geojsonClustering === true };
        }
        default:
            Log.warn?.(
                "[GeoLeaf.Cluster] Unknown clustering strategy: " +
                    strategy +
                    ". Defaulting to 'unified'."
            );
            return _CLUSTER_ALL;
    }
}

/**
 * Whether the layer's source is to be built for points: its data shows some, or — the data
 * showing NOTHING — the layer declares them.
 *
 * 🛑 A source is clustered or not for good, at creation, and this used to read the first batch
 * alone: a point layer created empty and filled afterwards was never clustered, whatever its
 * configuration asked for. An empty collection says nothing about what the layer will hold, so
 * the declaration answers for it.
 *
 * ⚠️ Only a declared POINT family answers yes, and the narrowness is the point: a clustered
 * source indexes points alone, so the lines and polygons written to it later are not drawn.
 * A layer that ships empty and declares no geometry — or another one — stays unclustered,
 * as before. And data that shows features is believed over the declaration, as before.
 */
function _mayHoldPoints(def: ClusterLayerDef, geojsonData: ClusterGeoJSONData): boolean {
    const features = geojsonData.features;
    if (features?.length) return features.some((f) => f?.geometry?.type?.includes("Point"));
    return [def.geometry, def.geometryType].some((kind) => geometryFamily(kind) === "point");
}

/**
 * Decides the clustering strategy for a single GeoJSON layer, returning
 * `{ shouldCluster }`. Reads the capability config
 * (`modules.cluster`); returns `_CLUSTER_NONE` when the capability is disabled.
 *
 * @param def - The GeoJSON layer definition (per-layer `clustering` override, and the
 *   declared geometry, which answers for a layer that ships empty).
 * @param geojsonData - The layer's GeoJSON data (probed for Point features). Empty, the
 *   layer is clustered only if it declares a point geometry.
 */
export function getClusteringStrategy(
    def: ClusterLayerDef,
    geojsonData: ClusterGeoJSONData
): ClusterStrategyResult {
    const config = getClusterConfig();
    if (!config.enabled) return _CLUSTER_NONE;
    const clusteringConfig = _resolveClusteringConfig(def);
    const isClusteringEnabled = clusteringConfig.enabled === true;
    const isClusteringDisabled = clusteringConfig.enabled === false;
    if (isClusteringDisabled) return _CLUSTER_NONE;
    if (!config.clustering && !isClusteringEnabled) return _CLUSTER_NONE;
    if (!_mayHoldPoints(def, geojsonData)) return _CLUSTER_NONE;
    // A layer that asks for clustering gets it, whatever the strategy: the strategy only
    // decides for the layers that say nothing.
    if (isClusteringEnabled) return _CLUSTER_ALL;
    const strategy = config.clusterStrategy ?? DEFAULT_CLUSTER_STRATEGY;
    return _resolveStrategyResult(strategy, isClusteringEnabled, config);
}
