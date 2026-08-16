/*!
 * GeoLeaf Core - Cluster (public facade)
 * Released under the MIT License
 * © 2026 Mattieu Pottier
 * https://geoleaf.dev
 */

/**
 *
 * Public `GeoLeaf.Cluster` facade — point clustering (native MapLibre `cluster:true`)
 * for POI and GeoJSON point layers. In-core capability (revived S3).
 *
 * Clustering is opt-out: active unless `modules.cluster.enabled` is `false`. The
 * GeoJSON loader and POI module consume the capability's pure resolvers directly;
 * this facade exposes the read surface for integrators / no-code studio.
 *
 * ## Public API summary
 *
 * | Method | Description |
 * |---|---|
 * | `isEnabled()` | `true` when clustering is enabled |
 * | `getConfig()` | The resolved `modules.cluster` config |
 */
import { buildPublicApi } from "../capabilities/cluster/public-api.js";

/** The object mounted on `GeoLeaf.Cluster`. */
export const Cluster = buildPublicApi();
