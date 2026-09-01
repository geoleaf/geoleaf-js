/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Public barrel for the configuration sub-system's cross-boundary surface.
 *
 * Mediated entry point for the `capabilities/ → kernel/` boundary (backlog R.8).
 *
 * ⚠️ **`Config` itself is NOT re-exported here — use `./config-primitives.js`.** That
 * file predates this barrel, carries 17 of the boundary's imports, and documents itself
 * as the recommended route. Adding a second door to the same room would give the gate
 * two shapes to allow and readers two answers to the same question.
 */

export type { LayerLike, ProfileWithLayers } from "./profile-layers.js";

export { resolveProfileLayers } from "./profile-layers.js";

// EXPLICIT barrel widening, the gesture the boundary rule designates.
// `layerGeometry` resolves the `geometry`/`geometryType` alias, and three
// capabilities need it: `legend` and the two `vector-tiles`, which each redid it by
// hand.
// ⚠️ The deep import was TRIED first and ESLint refused it, rightly — the barrel
// route was added after seeing it red, not by anticipation.
export { layerGeometry } from "./layer-geometry.js";
