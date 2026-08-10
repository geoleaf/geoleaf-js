/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * MapLibre cluster constants.
 *
 * Shared clustering defaults consumed by both cluster-source builders:
 * `maplibre-poi-builders.ts` (`createClusteredSource`) and
 * `maplibre-layer-builders.ts` (`buildSourceOptions` / `buildClusterGroup`).
 * Pure data — no engine calls, no side effects — so any module can import it
 * without risking a dependency cycle.
 */

/**
 * Hard ceiling on a source's `clusterMaxZoom`, applied regardless of any caller
 * override, so clusters always break apart before the deepest zoom levels.
 */
export const MAPLIBRE_MAX_CLUSTER_ZOOM = 17;

/** Default `clusterMaxZoom` when the caller provides none. */
export const DEFAULT_CLUSTER_MAX_ZOOM = 14;

/** Default `clusterRadius` (px) when the caller provides none. */
export const DEFAULT_CLUSTER_RADIUS = 50;
