/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Capability declaration for the in-core `cluster` capability.
 *
 * Registered in `boot.ts` so that `GeoLeaf.Introspection.getAllCapabilities()` and
 * `getCapabilitySchema('cluster')` work at runtime. Revived S3 — point clustering
 * consolidated in-core (native MapLibre `cluster:true`; no external supercluster
 * dependency).
 *
 * Config gate: `modules.cluster.enabled`. `enableWhenAbsent: true` — opt-out
 * (active unless a profile sets it to `false`), preserving the pre-migration
 * default-on behaviour.
 *
 * Cluster is a *policy* capability: the GeoJSON loader queries its pure resolver
 * (`getClusteringStrategy`) on demand, so it needs no `ICoreModule` lifecycle —
 * there are no event listeners to wire. The gate
 * is enforced by the config reader (`getClusterConfig().enabled`).
 */
"use strict";

import type { ICapabilityDeclaration } from "../../contracts/capability.contract.js";
import { clusterConfigDefaults } from "./constants.js";

/**
 * The advertised defaults ARE the applied ones: this is the very object
 * `getClusterConfig()` merges the profile block over (B.24 — the schema used to
 * advertise five defaults no accessor materialised).
 */
const DEFAULTS = clusterConfigDefaults();

/** In-core capability declaration for point clustering. */
export const CLUSTER_CAPABILITY: ICapabilityDeclaration = {
    id: "cluster",
    label: "Cluster",
    description:
        "Point clustering for POI and GeoJSON point layers (native MapLibre cluster:true).",
    gate: { configPath: "modules.cluster.enabled", enableWhenAbsent: true },
    configSchema: {
        enabled: {
            type: "boolean",
            default: DEFAULTS.enabled,
            description: "Enable point clustering globally (opt-out).",
        },
        clustering: {
            type: "boolean",
            default: DEFAULTS.clustering,
            description:
                "Default clustering on/off for GeoJSON point layers when absent from " +
                "modules.cluster. A per-layer clustering:{enabled:true} override still " +
                "clusters regardless of this default (roadmap nettoyage Sprint 3, PA-3 — " +
                "the runtime default was already false; this schema/type doc was wrong).",
        },
        clusterRadius: {
            type: "number",
            default: DEFAULTS.clusterRadius,
            description:
                "Cluster radius (px) for GeoJSON point layers when a layer sets none. A " +
                "per-layer clusterRadius overrides it. (POI shared-cluster radius is fixed " +
                "adapter-side at 50, not driven by this key.)",
        },
        disableClusteringAtZoom: {
            type: "number",
            default: DEFAULTS.disableClusteringAtZoom,
            description:
                "Zoom at/above which GeoJSON point clustering stops (clusterMaxZoom, clamped " +
                "to sourceMaxZoom-1). A per-layer disableClusteringAtZoom overrides it.",
        },
        clusterStrategy: {
            type: "string",
            default: DEFAULTS.clusterStrategy,
            enum: ["unified", "by-layer", "by-source", "json-only"],
            description: "How GeoJSON point layers cluster relative to the shared POI cluster.",
        },
        clusterStrategies: {
            type: "object",
            default: DEFAULTS.clusterStrategies,
            description:
                "Per-strategy options, keyed by clusterStrategy name — only two entries are " +
                "read (strategy.ts): `by-source.sources.geojson` (false ⇒ GeoJSON point layers " +
                "are not clustered under the `by-source` strategy; any other value ⇒ they are) " +
                "and `json-only.geojsonClustering` (must be exactly true for `json-only` to " +
                "cluster). Ignored under `unified` / `by-layer`. Both read sites fall back to " +
                "an empty object, so absent ≡ {}.",
        },
    },
    // No loader: cluster is inline (universal, config-driven thin). Gated via config.
};
