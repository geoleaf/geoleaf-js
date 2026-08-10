/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf GeoJSON Loader — Clustering normalisation (single source of truth)
 * Turns a layer's source `clustering` object into the flat fields the renderers read.
 */

import type { ClusteringConfig } from "./loader-types.js";

/**
 * Flat clustering fields written onto a normalised layer definition.
 *
 * `clustering` is deliberately a boolean here: normalisation *replaces* the source
 * configuration object with an on/off flag, and the radius/zoom overrides are hoisted
 * to siblings. `maxClusterRadius` and `clusterRadius` are both emitted on purpose —
 * they are two names for the same value, read by different consumers.
 */
export interface ClusteringNormalizationPatch {
    clustering: boolean;
    maxClusterRadius?: number;
    clusterRadius?: number;
    disableClusteringAtZoom?: number;
}

/**
 * Resolve the normalisation patch for a layer's raw `clustering` value.
 *
 * Returns `null` when the value is absent or not an object, which callers treat as
 * "leave the definition untouched" — an absent `clustering` block is not the same as
 * `clustering: false`.
 *
 * ⚠️ This is a **pure, single-argument** function by design. It replaces two
 * mutating helpers that carried the same logic under opposite parameter orders —
 * `_applyClusteringConfig(destination, source)` in `./profile.ts` and
 * `_applyDeferredClusteringNorm(source, destination)` in
 * `../../themes/theme-applier/deferred.ts`. Merging them into a two-argument
 * `(source, destination)` helper would have type-checked in both directions, since
 * both parameters are structurally loose — so an inverted call would have compiled
 * and silently written the wrong way round. Returning a patch removes that failure
 * mode by construction rather than by vigilance (R.40, backlog résiduel S5).
 *
 * @param clustering - The layer definition's raw `clustering` value, of unknown shape.
 * @returns The fields to merge onto the normalised definition, or `null` for a no-op.
 */
export function resolveClusteringNormalization(
    clustering: unknown
): ClusteringNormalizationPatch | null {
    if (!clustering || typeof clustering !== "object") return null;
    const cfg = clustering as ClusteringConfig;
    const patch: ClusteringNormalizationPatch = { clustering: cfg.enabled !== false };
    if (typeof cfg.maxClusterRadius === "number") {
        patch.maxClusterRadius = cfg.maxClusterRadius;
        patch.clusterRadius = cfg.maxClusterRadius;
    }
    if (typeof cfg.disableClusteringAtZoom === "number") {
        patch.disableClusteringAtZoom = cfg.disableClusteringAtZoom;
    }
    return patch;
}
