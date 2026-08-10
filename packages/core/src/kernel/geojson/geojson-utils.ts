/*!
 * GeoLeaf Core — © 2026 Mattieu Pottier — MIT License — https://geoleaf.dev
 */
/**
 * @fileoverview GeoJSON utility functions for feature analysis, validation, and coordinate processing.
 * Previously part of the src/geojson/ legacy shim; moved here as canonical utilities.
 */

import { GeoJSONShared } from "./shared.ts";
import { FeatureValidator } from "./feature-validator.ts";

/** A condition object `{ field, operator, value }` (the 2-arg `evaluateStyleCondition` form). */
interface StyleConditionInput {
    field?: string;
    operator?: string;
    value?: unknown;
}

function _getStyleOperators(): Record<string, (a: unknown, b: unknown) => boolean> {
    return GeoJSONShared.STYLE_OPERATORS || {};
}

/**
 * Returns the geometry type string of a GeoJSON feature, or null if unavailable.
 * @param feature - The GeoJSON feature object.
 * @returns The geometry type string (e.g. `"Point"`, `"LineString"`), or null.
 */
export function getGeometryType(feature: unknown): string | null {
    return (feature as { geometry?: { type?: string } } | null | undefined)?.geometry?.type ?? null;
}

/**
 * Returns true if the feature has Point or MultiPoint geometry.
 * @param feature - The GeoJSON feature object.
 * @returns `true` if the geometry type is `"Point"` or `"MultiPoint"`.
 */
export function isPointGeometry(feature: unknown): boolean {
    const t = getGeometryType(feature);
    return t === "Point" || t === "MultiPoint";
}

/**
 * Returns true if the feature has LineString or MultiLineString geometry.
 * @param feature - The GeoJSON feature object.
 * @returns `true` if the geometry type is `"LineString"` or `"MultiLineString"`.
 */
export function isLineGeometry(feature: unknown): boolean {
    const t = getGeometryType(feature);
    return t === "LineString" || t === "MultiLineString";
}

/**
 * Returns true if the feature has Polygon or MultiPolygon geometry.
 * @param feature - The GeoJSON feature object.
 * @returns `true` if the geometry type is `"Polygon"` or `"MultiPolygon"`.
 */
export function isPolygonGeometry(feature: unknown): boolean {
    const t = getGeometryType(feature);
    return t === "Polygon" || t === "MultiPolygon";
}

/**
 * Retrieves a nested property from a GeoJSON feature using dot-notation key.
 * @param feature - The GeoJSON feature object.
 * @param key - Dot-notation property path (e.g. `"properties.name"`).
 * @returns The property value or null if not found.
 */
export function getFeatureProperty(feature: unknown, key: unknown): unknown {
    if (feature == null || key == null) return null;
    const parts = String(key).split(".");
    let v: unknown = feature;
    for (const p of parts) {
        v = (v as Record<string, unknown> | null | undefined)?.[p];
    }
    return v !== undefined ? v : null;
}

/**
 * Evaluates a style condition against a feature or two values.
 * Supports both `(leftValue, operator, rightValue)` and `(feature, { field, operator, value })` call signatures.
 * @param featureOrLeft - A GeoJSON feature (2-arg form) or a left-hand value (3-arg form).
 * @param conditionOrOp - A condition object `{ field, operator, value }` or an operator string.
 * @param rightValue - The right-hand comparison value (3-arg form only).
 * @returns `true` if the condition is satisfied, `false` otherwise.
 */
export function evaluateStyleCondition(
    featureOrLeft: unknown,
    conditionOrOp: StyleConditionInput | string,
    rightValue?: unknown
): boolean {
    const ops = _getStyleOperators();
    if (arguments.length >= 3 && typeof conditionOrOp === "string") {
        return ops[conditionOrOp] ? ops[conditionOrOp](featureOrLeft, rightValue) : false;
    }
    if (!conditionOrOp || !featureOrLeft) return false;
    const { field, operator, value } = conditionOrOp as StyleConditionInput;
    const prop = getFeatureProperty(featureOrLeft, field);
    return operator && ops[operator] ? ops[operator](prop, value) : prop === value;
}

/**
 * Validates a GeoJSON feature and returns a normalized result object.
 * @param args - Passed through to `FeatureValidator.validateFeature`.
 * @returns `{ valid, errors }` where errors is an array of strings.
 */
export function validateFeature(...args: Parameters<typeof FeatureValidator.validateFeature>): {
    valid: boolean;
    errors: string[];
} {
    const r = FeatureValidator.validateFeature?.(...args);
    if (!r) return { valid: false, errors: ["Validator unavailable"] };
    return {
        valid: r.valid,
        errors: (r.errors || []).map((e) => (typeof e === "string" ? e : e.message)),
    };
}

/**
 * Validates a GeoJSON FeatureCollection and returns a normalized result object.
 * @param collection - The GeoJSON FeatureCollection or array to validate.
 * @param rest - Additional arguments passed through to the underlying validator.
 * @returns `{ valid, errors, featureCount }`.
 */
export function validateFeatureCollection(
    collection: unknown,
    ...rest: unknown[]
): { valid: boolean; errors: string[]; featureCount: number } {
    const validate = FeatureValidator.validateFeatureCollection as
        | ((collection: unknown, ...rest: unknown[]) => { errors?: { message: string }[] })
        | undefined;
    const r = validate?.(collection, ...rest);
    if (!r) return { valid: false, errors: ["Validator unavailable"], featureCount: 0 };
    const coll = collection as { type?: string; features?: unknown[] } | null | undefined;
    const features =
        coll?.type === "FeatureCollection"
            ? coll.features
            : Array.isArray(collection)
              ? collection
              : [];
    const wrongType = coll && coll.type !== undefined && coll.type !== "FeatureCollection";
    const missingFeatures = coll?.type === "FeatureCollection" && !Array.isArray(coll?.features);
    const errors = (r.errors || []).map((e) => (typeof e === "string" ? e : e.message));
    if (wrongType) errors.push('GeoJSON type must be "FeatureCollection"');
    if (missingFeatures) errors.push("GeoJSON must have features array");
    return {
        valid: errors.length === 0,
        errors,
        featureCount: Array.isArray(features) ? features.length : 0,
    };
}

function _toLatLng(coord: unknown): [number, number] | null {
    return Array.isArray(coord) && coord.length >= 2 ? [coord[1], coord[0]] : null;
}

/**
 * Extracts coordinates from a GeoJSON feature, converting [lng, lat] → [lat, lng].
 * @param feature - The GeoJSON feature to extract coordinates from.
 * @returns Array of [lat, lng] pairs, or null if no valid coordinates are found.
 */
export function extractCoordinates(feature: unknown): [number, number][] | null {
    if (feature == null) return null;
    const geom = (feature as { geometry?: { type?: string; coordinates?: unknown } }).geometry;
    if (!geom || !geom.coordinates) return null;
    const c = geom.coordinates as unknown[];
    if (!Array.isArray(c)) return null;
    switch (geom.type) {
        case "Point":
            return _toLatLng(c) ? [_toLatLng(c) as [number, number]] : null;
        case "MultiPoint":
            return c.map(_toLatLng).filter(Boolean) as [number, number][];
        case "LineString":
            return c.map(_toLatLng).filter(Boolean) as [number, number][];
        case "MultiLineString":
            return c.flat().map(_toLatLng).filter(Boolean) as [number, number][];
        case "Polygon": {
            const ring = c[0] as unknown[] | undefined;
            return ring?.length
                ? (ring.map(_toLatLng).filter(Boolean) as [number, number][])
                : null;
        }
        case "MultiPolygon":
            return c.flat(2).map(_toLatLng).filter(Boolean) as [number, number][];
        default:
            return null;
    }
}

/**
 * Computes the bounding box [[minLat, minLng], [maxLat, maxLng]] from an array of GeoJSON features.
 * @param features - Array of GeoJSON features to compute bounds from. Defaults to `[]`.
 * @returns A `[[minLat, minLng], [maxLat, maxLng]]` bounding box, or null if no valid coordinates.
 */
export function calculateBounds(
    features: unknown[] = []
): [[number, number], [number, number]] | null {
    if (!features || !Array.isArray(features)) return null;
    const coords = features
        .flatMap((f) => extractCoordinates(f))
        .filter(
            (c): c is [number, number] =>
                c != null && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])
        );
    if (!coords.length) return null;
    const lats = coords.map((c) => c[0]);
    const lngs = coords.map((c) => c[1]);
    const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
    const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];
    if (!Number.isFinite(minLat) || !Number.isFinite(maxLng)) return null;
    return [
        [minLat, minLng],
        [maxLat, maxLng],
    ];
}
