/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Legend capability — shared runtime constants.
 */

/**
 * Name of the taxonomy the legend reads its categories from, under
 * `modules.taxonomy.taxonomies.*`.
 *
 * ⚠ **This is a known limitation, not a design choice (backlog B.36d).** The right
 * taxonomy for a layer is `modules.taxonomy.layers.<layerId>.use`, and the taxonomy
 * capability already exposes the seam that resolves it
 * (`GeoLeaf.Taxonomy.getLayerCategories(layerId)`). The legend cannot use it yet for
 * two reasons:
 *
 *  1. `LegendGenerator.generateLegendFromStyle(styleData, geometryType, taxonomyData)`
 *     — the documented `GeoLeaf._LegendGenerator` entry point — carries no `layerId`,
 *     so the generator has nothing to resolve a binding with;
 *  2. the legend also needs the taxonomy's `fieldMappings` (the `fclass → category`
 *     translation two shipped layers depend on), and the seam has no
 *     `getLayerFieldMappings(layerId)` counterpart — only `getFieldMappings(ref)`,
 *     which needs the very name we are trying to stop hardcoding.
 *
 * Measured impact TODAY: **nil**. Every `layers.*.use` in every shipped profile
 * (9 profiles, 22 bindings) names `poi-cat`, and the only three layers whose style
 * rules are taxonomy-keyed (`tourism/cultures`, `tourism/hebergements`,
 * `_reference/reference-points`) are all bound. The defect is latent: it bites the
 * first profile that names its taxonomy anything else.
 *
 * Single-sourced here so the two read sites (`legend-generator._getCategories`,
 * `Legend._loadTaxonomy`) cannot drift, and so lifting the limitation is one edit.
 */
export const LEGEND_TAXONOMY_REF = "poi-cat";
