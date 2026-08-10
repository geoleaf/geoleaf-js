/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Contract — Legend
 *
 * Pure type surface for the Legend module. Only the structural view of a layer
 * configuration lives here; the runtime guarded accessor (`LegendContract`)
 * lives in `capabilities/legend/legend-seam.ts`.
 */

/**
 * Structural view of a layer configuration object accepted by the Legend
 * facade. Kept permissive (all-optional + index signature) so callers can
 * forward any profile-driven `layer.config` bag without narrowing.
 */
export interface LegendLayerConfig {
    label?: string;
    geometryType?: string;
    geometry?: string;
    showIconsOnMap?: boolean;
    styles?: { directory?: string; available?: { id: string; file?: string }[]; default?: string };
    [key: string]: unknown;
}
