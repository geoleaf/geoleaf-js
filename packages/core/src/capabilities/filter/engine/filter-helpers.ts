/*!
 * GeoLeaf Core — Filters / Filter Helpers
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 *
 * Helpers shared by poi-filter and route-filter (distance + tag normalisation).
 * Extracted verbatim to remove duplication.
 * https://geoleaf.dev
 */

import { haversineDistance } from "../../../utils/geo/haversine.js";

/**
 * Great-circle distance in **metres**, scalar-argument form.
 *
 * Thin adapter over the canonical {@link haversineDistance} — it exists only because the
 * filter predicates carry coordinates as loose scalars rather than `{lat, lng}` pairs.
 *
 * ⚠️ The unit is part of the contract. This used to be described as a "fallback for when
 * `GeoLeaf.Utils` is not loaded", and `route-filter` duly preferred `GeoLeaf.Utils.getDistance`
 * when present — but that one returns **kilometres**, so the proximity radius silently shifted
 * by a factor of 1000 depending on load order (KERNEL S11). Never make this interchangeable
 * with a kilometre-returning function.
 *
 * @param lat1 - Latitude of the first point, decimal degrees.
 * @param lng1 - Longitude of the first point, decimal degrees.
 * @param lat2 - Latitude of the second point, decimal degrees.
 * @param lng2 - Longitude of the second point, decimal degrees.
 * @returns The distance in metres.
 */
export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
    return haversineDistance({ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 });
}

/**
 * Normalises a tag collection (CSV string, array, or anything else).
 *
 * @param rawTags - The raw tag value read off a feature.
 * @returns The trimmed, non-empty tags.
 */
export function normalizeTags(rawTags: unknown): string[] {
    if (Array.isArray(rawTags)) return rawTags.map((t) => String(t).trim()).filter(Boolean);
    if (typeof rawTags === "string")
        return rawTags
            .split(/[,;]+/)
            .map((t) => t.trim())
            .filter(Boolean);
    return [];
}
