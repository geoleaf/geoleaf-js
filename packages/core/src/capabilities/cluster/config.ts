/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Cluster capability — config reader.
 *
 * Reads `modules.cluster.*` from the core Config singleton (typed import — the
 * in-core equivalent of the former `GeoLeaf.Config.get` runtime seam) and merges
 * it over the built-in defaults. Consolidates the former scattered reads
 * (`poiConfig.clustering` / `poiConfig.clusterRadius` / `poiConfig.clusterStrategy`
 * / `poiConfig.clusterStrategies` / `poiConfig.disableClusteringAtZoom`) into one
 * namespace.
 */

import type { ClusterConfig } from "./types.js";
import { clusterConfigDefaults } from "./constants.js";
import { Config } from "../../kernel/config/config-primitives.js";

/** Subset of `Config` consumed here (`get` is augmented onto Config at runtime). */
interface ConfigLike {
    get?<T = unknown>(path: string, defaultValue?: T): T;
}
const _Config = Config as ConfigLike;

/**
 * Reads `modules.cluster.*` from the running core config and merges it over the
 * built-in defaults (`clusterConfigDefaults()`, the same source
 * `CLUSTER_CAPABILITY.configSchema` advertises — B.24). `enabled` is `true`:
 * clustering is opt-out (active unless a profile sets `modules.cluster.enabled:
 * false`), preserving the pre-migration behaviour where point clustering was on by
 * default.
 *
 * Behaviour-preserving: every value materialised here is the one each consumer used
 * to re-apply through its own `?? …` fallback (`strategy.ts`, `options.ts`). Those
 * fallbacks stay as defence-in-depth for callers that build a `ClusterConfig` by
 * hand (tests, per-layer merges) rather than through this reader.
 */
export function getClusterConfig(): ClusterConfig {
    const raw = _Config.get?.<Partial<ClusterConfig>>("modules.cluster", {}) ?? {};
    return { ...clusterConfigDefaults(), ...raw };
}
