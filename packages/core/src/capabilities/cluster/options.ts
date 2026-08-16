/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Cluster capability — native MapLibre cluster option assembly.
 *
 * Single source of the GeoJSON per-layer cluster option resolution
 * (`applyGeoJSONClusterOptions`) — ported from the former
 * `geojson/loader/adapter-options._applyClusterOptions`, then wired (S6) so the
 * profile-global `modules.cluster.clusterRadius` / `disableClusteringAtZoom` feed the
 * defaults (they were read for the schema but never applied). Precedence:
 * per-layer def → profile-global config → the shared `DEFAULT_CLUSTER_*` constants.
 * The native primitives (clustered source creation, click-to-expand wiring) stay in
 * the MapLibre adapter; this module only owns the policy/defaults.
 */

import type { GeoJSONLoaderLog } from "../../kernel/geojson/loader/loader-types.js";
import type { ClusterLayerDef } from "./types.js";
import { getClusterConfig } from "./config.js";
import { DEFAULT_CLUSTER_RADIUS, DEFAULT_CLUSTER_MAX_ZOOM } from "./constants.js";

/** First finite number among the ordered candidates, else the fallback. */
function _firstNumber(a: unknown, b: unknown, fallback: number): number {
    if (typeof a === "number") return a;
    if (typeof b === "number") return b;
    return fallback;
}

/**
 * Applies clustering options (radius, max-zoom) to the GeoJSON adapter options in
 * place. The radius/max-zoom resolve per-layer def → `modules.cluster` config → the
 * shared defaults; the max-zoom is then clamped to `sourceMaxZoom - 1` so cluster
 * expansion always has a zoom to fly to.
 *
 * @param adapterOptions - The adapter option bag, mutated in place.
 * @param def - The GeoJSON layer definition (`clusterRadius` / `disableClusteringAtZoom`).
 * @param layerId - The layer id (log context).
 * @param Log - The GeoJSON loader logger.
 */
export function applyGeoJSONClusterOptions(
    adapterOptions: Record<string, unknown>,
    def: ClusterLayerDef,
    layerId: string,
    Log: GeoJSONLoaderLog
): void {
    const config = getClusterConfig();
    adapterOptions.cluster = true;
    adapterOptions.clusterRadius = _firstNumber(
        def.clusterRadius,
        config.clusterRadius,
        DEFAULT_CLUSTER_RADIUS
    );
    const rawClusterMaxZoom = _firstNumber(
        def.disableClusteringAtZoom,
        config.disableClusteringAtZoom,
        DEFAULT_CLUSTER_MAX_ZOOM
    );
    const sourceMaxZoom = typeof adapterOptions.maxzoom === "number" ? adapterOptions.maxzoom : 22;
    adapterOptions.clusterMaxZoom = Math.min(rawClusterMaxZoom, sourceMaxZoom - 1);
    Log.info("[GeoLeaf.Cluster] Clustering enabled for layer:", layerId, {
        clusterRadius: adapterOptions.clusterRadius,
        clusterMaxZoom: adapterOptions.clusterMaxZoom,
    });
}
