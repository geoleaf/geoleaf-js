/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Filter engine — feature field access (S5, F1).
 *
 * Reads attribute values by dotted path, geometry-agnostic. Reuses the
 * `getNestedValue` / `haversine` / `normalizeTags` helpers now co-located in the
 * capability (`../filters/`, relocated from the former `built-in/filters` in F4.4)
 * so the behaviour is byte-identical and no logic is duplicated.
 */

import { getNestedValue } from "./nested-value.js";
import { haversine, normalizeTags } from "./filter-helpers.js";
import type { FeatureLike } from "./types.js";

export { haversine, normalizeTags };

/**
 * Reads a feature's value at `field` (dotted path). Tries the feature root first
 * (handles `"properties.name"`, `"title"`, `"attributes.tags"`), then the
 * `properties` bag (handles a bare `"fclass"` that lives under `properties`).
 * Returns `null` when absent.
 */
export function getFieldValue(feature: FeatureLike, field: string): unknown {
    if (!field) return null;
    const direct = getNestedValue(feature, field);
    if (direct !== null && direct !== undefined) return direct;
    const props = feature.properties;
    if (props && typeof props === "object") {
        const fromProps = getNestedValue(props, field);
        if (fromProps !== null && fromProps !== undefined) return fromProps;
    }
    return null;
}

/** Reads a feature's field as a normalised tag list (array / CSV / scalar). */
export function getFieldTags(feature: FeatureLike, field: string): string[] {
    return normalizeTags(getFieldValue(feature, field));
}

/** Recursively finds the first `[number, number]` pair in a coordinates tree. */
function _firstPair(coords: unknown): [number, number] | null {
    if (!Array.isArray(coords)) return null;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
        return [coords[0], coords[1]];
    }
    for (const c of coords) {
        const p = _firstPair(c);
        if (p) return p;
    }
    return null;
}

/**
 * Resolves a representative `{ lat, lng }` for proximity, geometry-agnostic:
 * GeoJSON `geometry.coordinates` (first vertex, `[lng, lat]`) first, then POI-style
 * `lat`/`lng` fields. Returns `null` when no coordinate is found.
 */
export function featureCentroid(feature: FeatureLike): { lat: number; lng: number } | null {
    const pair = feature.geometry ? _firstPair(feature.geometry.coordinates) : null;
    if (pair) return { lng: pair[0], lat: pair[1] };
    const lat = _numOrNull(feature.lat ?? feature.latitude ?? feature.properties?.latitude);
    const lng = _numOrNull(feature.lng ?? feature.longitude ?? feature.properties?.longitude);
    if (lat !== null && lng !== null) return { lat, lng };
    return null;
}

/** Coerces a value to a finite number, or `null`. */
function _numOrNull(v: unknown): number | null {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
