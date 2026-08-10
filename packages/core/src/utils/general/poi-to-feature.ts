/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * `PoiLike` → `GeoJSON.Feature` conversion (host-layer render parity).
 *
 * A runtime POI — created by plugin-addpoi (S9 D4) or restored by plugin-storage
 * (S9 D5) — is written to its host GeoJSON layer via `GeoLeaf.Layers.addFeature`
 * / `mergeFeatures`, so the emitted Feature must render identically to a static
 * feature of that layer: icon (taxonomy-first), feature-info popup/tooltip/
 * sidepanel, and the generic attribute filter.
 *
 * Parity rules — stated as PROPERTIES of a host layer, never as a list of the
 * profiles that happened to exhibit them. A profile can leave the repository —
 * one did, and this block used to justify itself by naming it; the emitted shape
 * must not silently become unexplainable when that happens.
 * - Category / sub-category live FLAT in `properties`. feature-info reads
 *   `properties.X`; the filter reads them verbatim via `["get", field]` with no
 *   `attributes` fallback. The form nests them under `attributes` with an
 *   upper-case `subCategoryId`, while layer configs have been observed with the
 *   lower-case `subcategoryId` (still the case shipped today) → emit BOTH flat
 *   casings, which is the only shape that survives either convention.
 * - Rich content (photo, tags, descriptions) is kept verbatim under a nested
 *   `properties.attributes` bag (feature-info reads `attributes.*`, the tag
 *   filter reads `attributes.tags`) AND hoisted flat, for the layer configs that
 *   address it as `properties.<field>`.
 * - `id` is duplicated on `feature.id` (promoteId / `setFeatureState`
 *   prerequisite) and `properties.id` — mirroring `GeoLeaf.Layers.updateFeatureId`.
 *
 * @version 2.0.0
 */

/** Structural view of the form-produced POI consumed by {@link poiToFeature}. */
export interface PoiToFeatureInput {
    id?: string | number;
    title?: string;
    description?: string;
    geometry?: { type: string; coordinates: unknown };
    /** Legacy coordinate carrier — `[lat, lng]` tuple or `{ lat, lng }`. */
    latlng?: [number, number] | { lat?: number; lng?: number };
    attributes?: Record<string, unknown> & { categoryId?: unknown; subCategoryId?: unknown };
    [key: string]: unknown;
}

/** Category keys placed explicitly (with both casings) — excluded from the flat hoist. */
const _CATEGORY_KEYS = new Set(["categoryId", "subCategoryId"]);

/** Extracts a `[lng, lat]` GeoJSON position from a `[lat, lng]` tuple or `{ lat, lng }`. */
function _lngLatFromLatlng(latlng: PoiToFeatureInput["latlng"]): [number, number] | null {
    if (Array.isArray(latlng)) {
        const [lat, lng] = latlng;
        return typeof lat === "number" && typeof lng === "number" ? [lng, lat] : null;
    }
    if (latlng && typeof latlng === "object") {
        const { lat, lng } = latlng;
        return typeof lat === "number" && typeof lng === "number" ? [lng, lat] : null;
    }
    return null;
}

/**
 * Converts a form-produced POI into a GeoJSON Point Feature suitable for
 * `GeoLeaf.Layers.addFeature` / `mergeFeatures` on the host layer.
 *
 * Requires an `id` (promoteId / feature-state prerequisite); the add-form path
 * always assigns one (`user-poi-<ts>`). Returns `null` when `id` is missing or
 * no geometry/coordinates can be resolved.
 */
export function poiToFeature(poi: PoiToFeatureInput): GeoJSON.Feature | null {
    if (poi.id === undefined || poi.id === null || poi.id === "") return null;

    const geometry = _resolveGeometry(poi);
    if (!geometry) return null;

    const id = String(poi.id);
    const attrs = poi.attributes ?? {};

    // Hoist dynamic attributes flat (photo, gallery, …) for `properties.<field>`
    // configs. Category keys are excluded here — placed explicitly below with both
    // casings — and the explicit assignments after the loop win on any collision.
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(attrs)) {
        if (!_CATEGORY_KEYS.has(key)) properties[key] = value;
    }

    properties.id = id;
    if (poi.title !== undefined) {
        properties.name = poi.title; // tourism titleField "properties.name"
        properties.title = poi.title; // resolveTitle candidate safety net
    }
    if (poi.description !== undefined) properties.description = poi.description;
    if (attrs.categoryId !== undefined) properties.categoryId = attrs.categoryId;
    if (attrs.subCategoryId !== undefined) {
        properties.subcategoryId = attrs.subCategoryId; // flat lower-case (tourism GPU + popup)
        properties.subCategoryId = attrs.subCategoryId; // flat upper-case (form-side convention)
    }
    // Nested verbatim bag — feature-info "attributes.*" + tag filter "attributes.tags".
    properties.attributes = { ...attrs };

    return { type: "Feature", id, geometry, properties };
}

/** Prefers the form-built `geometry`; falls back to the legacy `latlng` carrier. */
function _resolveGeometry(poi: PoiToFeatureInput): GeoJSON.Geometry | null {
    if (poi.geometry) return poi.geometry as GeoJSON.Geometry;
    const position = _lngLatFromLatlng(poi.latlng);
    return position ? { type: "Point", coordinates: position } : null;
}
