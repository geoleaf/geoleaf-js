/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Filter engine — public surface (S5, F1).
 *
 * The geometry-agnostic predicate core of the `filter` capability. Consumed by the
 * mapping-driven panel (F2) and the source binding (F3); replaces the former
 * POI/Route-centric `built-in/filters` engine.
 */
"use strict";

export {
    getFieldValue,
    getFieldTags,
    featureCentroid,
    haversine,
    normalizeTags,
} from "./field-access.js";
export { fieldPredicate, featurePasses, fieldAppliesToLayer } from "./predicate.js";
export { expandCategorySelection, distinctFieldValues } from "./options.js";
export type { ActiveField, FeatureLike, ProximitySelection, RangeSelection } from "./types.js";
