/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The property a style rule's `when.field` names, as the renderer reads it.
 *
 * One rule, two readers: the MapLibre style converter builds `["get", key]` from it, and the
 * load-time field diagnostic checks the data carries that key. Written once here so the two
 * cannot drift — a diagnostic judging with a laxer rule than the renderer would call a field
 * present that never paints.
 *
 * ⚠️ Lives under `utils/`, not beside its geojson readers, and imports nothing: the adapter and
 * `kernel/geojson/` sit in different chunks, and a shared module under `kernel/geojson/` would
 * close a chunk cycle (the motive of the `style-operators` rule in `rollup.config.mjs`).
 */

const PROPERTIES_PREFIX = "properties.";

/**
 * Strips ONE leading `properties.` from a style rule's field — MapLibre's `["get"]` already reads
 * under `feature.properties`. Nothing else is rewritten: `attributes.x` stays a literal key, and
 * so does a second `properties.`.
 *
 * @param field - The field as the style rule writes it.
 * @returns The key read under `feature.properties`.
 * @example
 * styleRuleFieldKey("properties.statut"); // "statut"
 * styleRuleFieldKey("statut"); // "statut"
 */
export function styleRuleFieldKey(field: string): string {
    return field.startsWith(PROPERTIES_PREFIX) ? field.substring(PROPERTIES_PREFIX.length) : field;
}
