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

// B-161 — élargissement EXPLICITE du baril, qui est le geste que la règle R.8 désigne.
// `layerGeometry` résout l'alias `geometry`/`geometryType` (ANO-007), et trois capacités en
// ont besoin : `legend` et les deux `vector-tiles`, qui le refaisaient chacune à la main.
// ⚠️ L'import profond a été TENTÉ d'abord et ESLint l'a refusé, à raison — c'est en le voyant
// rouge que le passage par ce baril a été posé, pas par anticipation.
export { layerGeometry } from "./layer-geometry.js";
