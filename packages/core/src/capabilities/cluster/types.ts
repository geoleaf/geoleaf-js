/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Cluster capability — public types.
 *
 * Point clustering policy (native MapLibre `cluster:true`), consolidated from the
 * former `geojson/clustering.ts` decision brain + the scattered `poiConfig.cluster*`
 * reads into a single in-core capability (revived S3). Config now lives under
 * `modules.cluster`.
 */

/** A `modules.cluster.clusterStrategies` entry — source toggles + json-only flag. */
interface ClusterStrategyEntry {
    sources?: { geojson?: boolean };
    geojsonClustering?: boolean;
}

/** The full `modules.cluster` config block. */
export interface ClusterConfig {
    /**
     * Capability gate — clustering is inert when `false`. Opt-out (`enableWhenAbsent:
     * true`): absent → active, preserving the pre-migration default-on behaviour.
     */
    enabled: boolean;
    /**
     * Global cluster default for GeoJSON point layers (was `poiConfig.clustering`).
     * @default false — a per-layer `clustering:{enabled:true}` override still clusters
     * regardless (this doc previously said `true`, which never matched the runtime
     * default).
     */
    clustering?: boolean;
    /**
     * Default cluster radius (px) for GeoJSON point layers; a per-layer `clusterRadius`
     * overrides it (was `poiConfig.clusterRadius`). Falls back to `DEFAULT_CLUSTER_RADIUS`
     * (see `constants.ts`). @default 80
     */
    clusterRadius?: number;
    /**
     * Default zoom at/above which GeoJSON point clustering stops (`clusterMaxZoom`); a
     * per-layer `disableClusteringAtZoom` overrides it (was
     * `poiConfig.disableClusteringAtZoom`). Falls back to `DEFAULT_CLUSTER_MAX_ZOOM`. @default 14
     */
    disableClusteringAtZoom?: number;
    /** GeoJSON clustering strategy (was `poiConfig.clusterStrategy`). @default "unified" */
    clusterStrategy?: string;
    /** Per-strategy config (was `poiConfig.clusterStrategies`). */
    clusterStrategies?: Record<string, ClusterStrategyEntry>;
}

/** Result of the per-layer clustering decision. */
export interface ClusterStrategyResult {
    shouldCluster: boolean;
    useSharedCluster: boolean;
}

/** Per-layer clustering sub-config (`def.clustering` object form). */
export interface LayerClusteringConfig {
    enabled?: boolean;
    maxClusterRadius?: number;
    disableClusteringAtZoom?: number;
}

/** Minimal per-layer def surface read by the strategy / options resolvers. */
export interface ClusterLayerDef {
    clustering?: boolean | LayerClusteringConfig;
    clusterRadius?: number;
    disableClusteringAtZoom?: number;
}

/** GeoJSON data surface probed for Point features. */
export interface ClusterGeoJSONData {
    features?: { geometry?: { type?: string } }[];
}
