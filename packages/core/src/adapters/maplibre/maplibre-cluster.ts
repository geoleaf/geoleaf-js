/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * MapLibre cluster constants.
 *
 * The clustering defaults a clustered GeoJSON source falls back to when the
 * caller gives none — `maplibre-layer-builders.ts` (`buildSourceOptions`).
 * Pure data — no engine calls, no side effects — so any module can import it
 * without risking a dependency cycle.
 */

/** Default `clusterMaxZoom` when the caller provides none. */
export const DEFAULT_CLUSTER_MAX_ZOOM = 14;

/** Default `clusterRadius` (px) when the caller provides none. */
export const DEFAULT_CLUSTER_RADIUS = 50;
