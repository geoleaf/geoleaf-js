/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Cluster capability — public API surface.
 *
 * Thin read wrappers over the config reader — no business logic here. Mounted on
 * `GeoLeaf.Cluster` via `geoleaf.cluster.ts`. Exposed for integrators / no-code
 * studio; core consumers (GeoJSON loader, POI) import the pure resolvers directly.
 *
 * @example
 * // Integrator checks whether clustering is active
 * if (GeoLeaf.Cluster.isEnabled()) { … }
 */
"use strict";

import { getClusterConfig } from "./config.js";
import type { ClusterConfig } from "./types.js";

/** Builds the object mounted on `GeoLeaf.Cluster`. */
export function buildPublicApi() {
    return {
        /** Returns `true` when clustering is enabled (`modules.cluster.enabled !== false`). */
        isEnabled: (): boolean => getClusterConfig().enabled !== false,

        /** Returns the resolved `modules.cluster` config (merged over the built-in defaults). */
        getConfig: (): ClusterConfig => getClusterConfig(),
    };
}
