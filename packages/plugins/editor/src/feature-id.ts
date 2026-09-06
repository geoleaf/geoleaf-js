/*!
 * @geoleaf-plugins/editor — Feature identity
 * © 2026 Mattieu Pottier — MIT License
 *
 * Resolves the host identity of a GeoJSON feature, whatever surface it came from
 * (`queryRenderedFeatures`, `GeoLeaf.Layers`, a server response).
 *
 * 🛑 WHY THIS MODULE EXISTS, AND WHY IT IS NOT IN THE CORE. The core's convention is
 * `properties.id`: `promoteId` is set on POINT sources only
 * (`adapters/maplibre/maplibre-layer-builders.ts`), so on a line or polygon layer
 * MapLibre hands back NO top-level `feature.id` at all. Reading `hit.id` alone therefore
 * resolved to nothing on every non-point layer, and every downstream gate is guarded on
 * that identity — the edit was dropped in silence. The core carries six private
 * implementations of this same fallback (`kernel/geojson/feature-interaction.ts`,
 * `layers-public-api.ts`, `feature-validator.ts`, `capabilities/route/endpoint-deriver.ts`…)
 * and exports NONE of them; `kernel/shared/` has no entry in the package's `exports` map.
 * There is thus nothing to import, and the plugin `table` already keeps its own
 * (`packages/plugins/table/src/feature-id.ts`) — this is the same posture, not a new one.
 * https://geoleaf.dev
 */

/**
 * Minimal feature shape needed to resolve an identity. Satisfied by
 * `EditorRenderedFeature` (a `queryRenderedFeatures` hit), by a raw GeoJSON feature and by
 * a server payload alike — none of which carries an index signature that would conflict.
 */
export interface FeatureIdentity {
    id?: string | number;
    properties?: Record<string, unknown> | null;
}

/**
 * Resolves a feature's host identity — pure, and the single reading order in this plugin.
 *
 * The order is `feature.id` **then** `properties.id`, and not the reverse: when MapLibre
 * does promote an id, it promotes it FROM `properties.id`, so the two agree; when a server
 * response carries both, the top-level one is the one it was addressed by.
 *
 * @param feature - Any feature-shaped value; `null`/`undefined` is accepted.
 * @returns The identity as a string, or `""` when the feature carries none. The empty
 *   string is the "no identity" value the whole plugin already tests for
 *   (`selection-state`, `host-reconcile`, `submit`) — returning `null` here would add a
 *   second spelling of the same absence.
 * @example
 * const id = resolveFeatureId({ properties: { id: 42 } }); // "42"
 */
export function resolveFeatureId(feature: FeatureIdentity | null | undefined): string {
    const raw = feature?.id ?? feature?.properties?.["id"];
    return raw == null ? "" : String(raw);
}
