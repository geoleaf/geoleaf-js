/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Cluster capability — per-layer clustering strategy decision.
 *
 * Decides whether a GeoJSON layer should be clustered (and whether it joins the
 * shared POI cluster) from the layer def + `modules.cluster` config. Ported
 * behaviour-preserving from the former `geojson/clustering.ts`; the only changes
 * are the config source (`modules.cluster` via `getClusterConfig()` instead of
 * `poiConfig`) and the capability enable gate.
 */
"use strict";

import { getLog } from "../../utils/general/di-accessors.js";
import { getClusterConfig } from "./config.js";
import {
    DEFAULT_CLUSTER_RADIUS,
    DEFAULT_CLUSTER_MAX_ZOOM,
    DEFAULT_CLUSTER_STRATEGY,
} from "./constants.js";
import type {
    ClusterConfig,
    ClusterLayerDef,
    LayerClusteringConfig,
    ClusterGeoJSONData,
    ClusterStrategyResult,
} from "./types.js";

const _CLUSTER_NONE: ClusterStrategyResult = { shouldCluster: false, useSharedCluster: false };
const _CLUSTER_UNIFIED: ClusterStrategyResult = { shouldCluster: true, useSharedCluster: true };

function _resolveClusteringConfig(def: ClusterLayerDef): LayerClusteringConfig {
    if (typeof def.clustering === "object") return def.clustering;
    return { enabled: def.clustering as boolean };
}

function _resolveCustomClusterCheck(
    clusteringConfig: LayerClusteringConfig,
    def: ClusterLayerDef,
    config: ClusterConfig
): boolean {
    const clusterRadius =
        clusteringConfig.maxClusterRadius ??
        (typeof def.clusterRadius === "number" ? def.clusterRadius : null);
    const disableAtZoom =
        clusteringConfig.disableClusteringAtZoom ??
        (typeof def.disableClusteringAtZoom === "number" ? def.disableClusteringAtZoom : null);
    if (
        clusterRadius !== null &&
        clusterRadius !== (config.clusterRadius ?? DEFAULT_CLUSTER_RADIUS)
    )
        return true;
    if (disableAtZoom === null) return false;
    return disableAtZoom !== (config.disableClusteringAtZoom ?? DEFAULT_CLUSTER_MAX_ZOOM);
}

function _resolveStrategyResult(
    strategy: string,
    isClusteringEnabled: boolean,
    config: ClusterConfig
): ClusterStrategyResult {
    const Log = getLog();
    switch (strategy) {
        case "unified":
            return _CLUSTER_UNIFIED;
        case "by-layer":
            return { shouldCluster: isClusteringEnabled, useSharedCluster: false };
        case "by-source": {
            const sourceConfig = config.clusterStrategies?.["by-source"]?.sources ?? {};
            return { shouldCluster: sourceConfig.geojson !== false, useSharedCluster: false };
        }
        case "json-only": {
            const jsonOnlyConfig = config.clusterStrategies?.["json-only"] ?? {};
            return {
                shouldCluster: jsonOnlyConfig.geojsonClustering === true,
                useSharedCluster: false,
            };
        }
        default:
            Log.warn?.(
                "[GeoLeaf.Cluster] Unknown clustering strategy: " +
                    strategy +
                    ". Defaulting to 'unified'."
            );
            return _CLUSTER_UNIFIED;
    }
}

/**
 * Decides the clustering strategy for a single GeoJSON layer, returning
 * `{ shouldCluster, useSharedCluster }`. Reads the capability config
 * (`modules.cluster`); returns `_CLUSTER_NONE` when the capability is disabled.
 *
 * @param def - The GeoJSON layer definition (per-layer `clustering` override).
 * @param geojsonData - The layer's GeoJSON data (probed for Point features).
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
    const hasPoints =
        geojsonData.features?.some((f) => f?.geometry?.type?.includes("Point")) ?? false;
    if (!hasPoints) return _CLUSTER_NONE;
    if (isClusteringEnabled) {
        if (_resolveCustomClusterCheck(clusteringConfig, def, config))
            return { shouldCluster: true, useSharedCluster: false };
        const strategy = config.clusterStrategy ?? DEFAULT_CLUSTER_STRATEGY;
        return { shouldCluster: true, useSharedCluster: strategy === DEFAULT_CLUSTER_STRATEGY };
    }
    const strategy = config.clusterStrategy ?? DEFAULT_CLUSTER_STRATEGY;
    return _resolveStrategyResult(strategy, isClusteringEnabled, config);
}
