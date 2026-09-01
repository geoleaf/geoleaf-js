/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf GeoJSON Module - Feature Validator
 */

import { getLog } from "../../utils/general/di-accessors.js";
import { isHexColor } from "../../utils/validators/general-validators.js";
import { validateUrl } from "../security/index.js";

import type { GeoJSONFeature } from "./geojson-types.js";

interface ValidationError {
    featureId: string | number;
    field: string;
    message: string;
    severity: string;
}

function _resolveFeatureId(
    feat: { id?: unknown; properties?: Record<string, unknown> } | null | undefined,
    index?: number
): string | number {
    const rawId = feat?.properties?.id ?? feat?.id ?? index ?? "unknown";
    return typeof rawId === "string" || typeof rawId === "number" ? rawId : "unknown";
}

function _validateNumericField(
    props: Record<string, unknown>,
    featureId: string | number,
    field: string,
    min: number,
    max?: number
): ValidationError[] {
    const errors: ValidationError[] = [];
    const val = props[field];
    if (val === undefined) return errors;
    if (typeof val !== "number") {
        errors.push({
            featureId,
            field: `properties.${field}`,
            message: `${field} must be a number`,
            severity: "warning",
        });
        return errors;
    }
    const n = val;
    if (n < min) {
        errors.push({
            featureId,
            field: `properties.${field}`,
            message:
                max !== undefined
                    ? `${field} must be between ${min} and ${max}`
                    : `${field} must be >= ${min}`,
            severity: "warning",
        });
    }
    if (max !== undefined && n > max) {
        errors.push({
            featureId,
            field: `properties.${field}`,
            message: `${field} must be between ${min} and ${max}`,
            severity: "warning",
        });
    }
    return errors;
}

function _validateColorField(
    props: Record<string, unknown>,
    featureId: string | number
): ValidationError[] {
    const errors: ValidationError[] = [];
    // Shorthand `#RGB` is accepted here (unlike style JSON) — the message below promises it.
    if (
        typeof props.color !== "undefined" &&
        typeof props.color === "string" &&
        !isHexColor(props.color, { shorthand: true })
    ) {
        errors.push({
            featureId,
            field: "properties.color",
            message: `invalid color '${props.color}'. Expected format: #RGB or #RRGGBB`,
            severity: "warning",
        });
    }
    return errors;
}

/** Feature properties validated as URLs. */
const _URL_FIELDS = ["link", "photo", "url"];

/**
 * Relative path shapes accepted as-is: "/a", "./a", "../a", "//host/a".
 * Written flat (`\.{0,2}` rather than `(\.\.?)?`) so `security/detect-unsafe-regex`
 * sees no nested quantifier — the two forms match exactly the same inputs.
 */
const _RELATIVE_URL_RE = /^\.{0,2}\//;

/** RFC 3986 scheme prefix, e.g. "https:", "mailto:", "javascript:". */
const _SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** Contact schemes valid as feature links but outside the security whitelist. */
const _ALLOWED_SCHEMES = ["mailto:", "tel:"];

/** Fixed resolution base — keeps the check independent of the ambient `location`. */
const _URL_BASE = "https://localhost";

/** Email shape check (same pattern as utils/validators/general-validators). */
const _EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Check whether a feature property value is usable as a link.
 *
 * Scheme-bearing URLs are delegated to the canonical security validator, which
 * enforces the protocol whitelist (http/https/data:image) and therefore rejects
 * `javascript:`, `vbscript:` and `data:text/html`. Relative paths and contact
 * schemes are accepted by shape: they carry no injection risk here, and the
 * previous inline implementation accepted them.
 *
 * @param value - Raw property value, already narrowed to a string.
 * @returns True when the value may be used as a link.
 */
function _isAcceptableUrl(value: string): boolean {
    const url = value.trim();
    if (!url) return false;
    if (_RELATIVE_URL_RE.test(url)) return true;
    const lower = url.toLowerCase();
    if (_ALLOWED_SCHEMES.some((scheme) => lower.startsWith(scheme))) return true;
    // Neither relative nor scheme-bearing ("example.com") — a missing-protocol typo.
    if (!_SCHEME_RE.test(url)) return false;
    try {
        validateUrl(url, _URL_BASE);
        return true;
    } catch {
        return false;
    }
}

function _validateUrlEmailFields(
    props: Record<string, unknown>,
    featureId: string | number
): ValidationError[] {
    const errors: ValidationError[] = [];
    for (const field of _URL_FIELDS) {
        const v = props[field];
        if (typeof v === "string" && !_isAcceptableUrl(v)) {
            errors.push({
                featureId,
                field: `properties.${field}`,
                message: `${field} is not a valid URL`,
                severity: "warning",
            });
        }
    }
    if (typeof props.email === "string" && !_EMAIL_RE.test(props.email)) {
        errors.push({
            featureId,
            field: "properties.email",
            message: "invalid email",
            severity: "warning",
        });
    }
    return errors;
}

function _validateTagsAndStructure(
    props: Record<string, unknown>,
    featureId: string | number
): ValidationError[] {
    const errors: ValidationError[] = [];
    if (typeof props.tags !== "undefined") {
        if (!Array.isArray(props.tags)) {
            errors.push({
                featureId,
                field: "properties.tags",
                message: "tags must be an array",
                severity: "warning",
            });
        } else {
            (props.tags as unknown[]).forEach((tag, idx) => {
                if (typeof tag !== "string") {
                    errors.push({
                        featureId,
                        field: `properties.tags[${idx}]`,
                        message: "tag must be a string",
                        severity: "warning",
                    });
                }
            });
        }
    }
    for (const [key, value] of Object.entries(props)) {
        if (value !== null && typeof value === "object" && !Array.isArray(value)) {
            errors.push({
                featureId,
                field: `properties.${key}`,
                message: "Nested property detected. Properties must be flat.",
                severity: "error",
            });
        }
    }
    return errors;
}

const FeatureValidator = {
    validateFeatureCollection(collection: { type?: string; features?: unknown[] } | unknown[]): {
        validFeatures: unknown[];
        errors: ValidationError[];
    } {
        const Log = getLog();
        const errors: ValidationError[] = [];
        const validFeatures: unknown[] = [];
        if (!collection || typeof collection !== "object") {
            Log.warn?.("[GeoLeaf.GeoJSON.Validator] Invalid collection: invalid type");
            return {
                validFeatures: [],
                errors: [
                    {
                        featureId: "?",
                        field: "",
                        message: "invalid collection",
                        severity: "error",
                    },
                ],
            };
        }
        const coll = collection as { type?: string; features?: unknown[] };
        const features =
            coll.type === "FeatureCollection"
                ? coll.features
                : Array.isArray(collection)
                  ? collection
                  : [collection];
        if (!Array.isArray(features)) {
            Log.warn?.("[GeoLeaf.GeoJSON.Validator] No features to validate");
            return { validFeatures: [], errors: [] };
        }
        for (let i = 0; i < features.length; i++) {
            const result = FeatureValidator.validateFeature(features[i] as GeoJSONFeature, i);
            if (result.valid) {
                validFeatures.push(features[i]);
            } else {
                errors.push(...result.errors);
            }
        }
        return { validFeatures, errors };
    },
    validateFeature(
        feature: GeoJSONFeature | unknown,
        index?: number
    ): { valid: boolean; errors: ValidationError[] } {
        const Log = getLog();
        const errors: ValidationError[] = [];
        const feat = feature as GeoJSONFeature & { properties?: Record<string, unknown> };
        const featureId: string | number = _resolveFeatureId(feat, index);
        if (!feat || (feat as { type?: string }).type !== "Feature") {
            errors.push({
                featureId,
                field: "type",
                message: "feature must have type='Feature'",
                severity: "error",
            });
            Log.warn?.("[GeoLeaf.GeoJSON.Validator] Feature " + featureId + ": invalid type");
            return { valid: false, errors };
        }
        const geomResult = FeatureValidator.validateGeometry(
            (feat as GeoJSONFeature).geometry,
            featureId
        );
        if (!geomResult.valid) errors.push(...geomResult.errors);
        const propsResult = FeatureValidator.validateProperties(
            (feat as GeoJSONFeature).properties,
            featureId
        );
        if (!propsResult.valid) errors.push(...propsResult.errors);
        if (errors.length > 0) {
            Log.warn?.(
                "[GeoLeaf.GeoJSON.Validator] Feature " +
                    featureId +
                    " rejected: " +
                    errors.map((e) => e.message).join("; ")
            );
            return { valid: false, errors };
        }
        return { valid: true, errors: [] };
    },
    validateGeometry(
        geometry: unknown,
        featureId: string | number
    ): { valid: boolean; errors: ValidationError[] } {
        const errors: ValidationError[] = [];
        const validTypes = ["Point", "LineString", "MultiLineString", "Polygon", "MultiPolygon"];
        if (!geometry || typeof geometry !== "object") {
            errors.push({
                featureId,
                field: "geometry",
                message: "geometry is required and must be an object",
                severity: "error",
            });
            return { valid: false, errors };
        }
        const geom = geometry as { type?: string; coordinates?: unknown };
        if (!geom.type) {
            errors.push({
                featureId,
                field: "geometry.type",
                message: "geometry.type required",
                severity: "error",
            });
            return { valid: false, errors };
        }
        if (!validTypes.includes(geom.type)) {
            errors.push({
                featureId,
                field: "geometry.type",
                message: `Invalid geometry type '${geom.type}'. Must be: ${validTypes.join(", ")}`,
                severity: "error",
            });
            return { valid: false, errors };
        }
        if (!Array.isArray(geom.coordinates) || geom.coordinates.length === 0) {
            errors.push({
                featureId,
                field: "geometry.coordinates",
                message: "geometry.coordinates must be a non-empty array",
                severity: "error",
            });
            return { valid: false, errors };
        }
        return { valid: errors.length === 0, errors };
    },
    validateProperties(
        properties: Record<string, unknown> | null | undefined,
        featureId: string | number
    ): { valid: boolean; errors: ValidationError[] } {
        const errors: ValidationError[] = [];
        if (!properties || typeof properties !== "object") {
            errors.push({
                featureId,
                field: "properties",
                message: "properties is required and must be an object",
                severity: "error",
            });
            return { valid: false, errors };
        }
        const hasName = properties.name || properties.title || properties.label;
        if (!hasName) {
            errors.push({
                featureId,
                field: "properties.name",
                message: "properties must contain at least one of name, title or label",
                severity: "error",
            });
        }
        errors.push(..._validateNumericField(properties, featureId, "distance_km", 0));
        errors.push(..._validateNumericField(properties, featureId, "duration_min", 0));
        errors.push(..._validateNumericField(properties, featureId, "rating", 0, 5));
        errors.push(..._validateColorField(properties, featureId));
        errors.push(..._validateNumericField(properties, featureId, "opacity", 0, 1));
        errors.push(..._validateNumericField(properties, featureId, "weight", 0));
        errors.push(..._validateUrlEmailFields(properties, featureId));
        errors.push(..._validateTagsAndStructure(properties, featureId));
        const hasErrors = errors.some((e) => e.severity === "error");
        return { valid: !hasErrors, errors };
    },
};

export { FeatureValidator };
