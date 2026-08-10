/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Cluster capability — shared GeoJSON cluster defaults (radius / max-zoom).
 *
 * Before this module the same two defaults lived as bare literals in three places that
 * had already drifted apart: the introspection schema (`cluster-capability.ts`) advertised
 * `clusterRadius: 50` and left `disableClusteringAtZoom` with no default, while the code
 * actually applied **80 / 14** to GeoJSON layers (`options.ts`) and the override comparison
 * (`strategy.ts`) used yet another baseline (**80 / 18**). A profile author reading
 * `getCapabilitySchema('cluster')` therefore could not predict the radius they would get,
 * and a layer explicitly set to the real applied max-zoom (14) was wrongly classed as a
 * custom override.
 *
 * Centralising the two numbers here — imported by the schema (advertised value), the applied
 * defaults (`options.applyGeoJSONClusterOptions`) and the override comparison
 * (`strategy._resolveCustomClusterCheck`) — makes the advertised value and the enforced value
 * the same *by construction*: the 50 / 80 / 18 drift can no longer reopen.
 *
 * POI shared-cluster defaults are deliberately NOT here: they live adapter-side
 * (`adapters/maplibre/maplibre-cluster.ts`, radius 50) because the MapLibre adapter must not
 * import `capabilities/`. This module owns only the GeoJSON per-layer policy.
 *
 * B.24 widened the same idea from two literals to the WHOLE default set: the schema used to
 * advertise five defaults (`clustering` / `clusterRadius` / `disableClusteringAtZoom` /
 * `clusterStrategy` / `clusterStrategies`) that `getClusterConfig()` did not materialise —
 * each consumer re-applied its own `?? …` fallback instead. The values agreed, but nothing
 * held them together. `clusterConfigDefaults()` below is now the single source both the
 * declaration and the reader derive from.
 */
"use strict";

import type { ClusterConfig } from "./types.js";

/**
 * Default cluster radius (px) for a GeoJSON point layer when neither the layer def nor
 * `modules.cluster.clusterRadius` sets one. Also the baseline `strategy.ts` compares a
 * per-layer radius against to decide whether a layer needs its own (non-shared) cluster.
 */
export const DEFAULT_CLUSTER_RADIUS = 80;

/**
 * Default `clusterMaxZoom` for a GeoJSON point layer when neither the layer def nor
 * `modules.cluster.disableClusteringAtZoom` sets one — `applyGeoJSONClusterOptions` clamps
 * it to `sourceMaxZoom - 1`. Also the strategy's override-comparison baseline (was `18`
 * there, which never matched this applied value — the S6 alignment).
 */
export const DEFAULT_CLUSTER_MAX_ZOOM = 14;

/**
 * Default clustering strategy for GeoJSON point layers — the value `strategy.ts` falls back
 * to at both of its `config.clusterStrategy ?? …` sites (`getClusteringStrategy`).
 */
export const DEFAULT_CLUSTER_STRATEGY = "unified";

/**
 * The complete built-in `modules.cluster` default set — the ONE source
 * `CLUSTER_CAPABILITY.configSchema` advertises and `getClusterConfig()` merges a profile
 * block over. Kept a factory (not a shared const) so the mutable `clusterStrategies` map
 * handed to a caller can never be the one the next call starts from.
 *
 * `clustering: false` is not a stylistic choice: `getClusteringStrategy` gates on
 * `!config.clustering` (strategy.ts:110), for which an absent key and `false` are the same
 * thing — GeoJSON point layers are NOT clustered unless the layer opts in or this flag does.
 */
export function clusterConfigDefaults(): ClusterConfig {
    return {
        enabled: true,
        clustering: false,
        clusterRadius: DEFAULT_CLUSTER_RADIUS,
        disableClusteringAtZoom: DEFAULT_CLUSTER_MAX_ZOOM,
        clusterStrategy: DEFAULT_CLUSTER_STRATEGY,
        clusterStrategies: {},
    };
}
