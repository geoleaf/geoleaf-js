/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * MapLibre Style Converter
 *
 * Converts GeoLeaf style format (flat) to MapLibre GL paint/layout properties.
 * Pure module — no engine dependency, no side effects, fully testable in isolation.
 *
 * **Style input formats supported:**
 * 1. Flat: `{ fillColor, fillOpacity, color, weight, ... }`
 * 2. Native pass-through: `{ expressionPaint: { "fill-color": [...expression] } }`
 *
 * The legacy nested format `{ fill: { color }, stroke: { color, widthPx } }` is
 * no longer supported. Use the flat format instead.
 * `expressionPaint` bypasses GeoLeaf conversion and is injected as-is into the
 * MapLibre paint object, enabling zoom interpolations, match expressions, etc.
 */

import type {
    GeoJSONStyleRule,
    GeoJSONStyleRuleCondition,
} from "../../kernel/geojson/geojson-types.js";

import { buildHatchPatternId, type HatchConfig } from "./maplibre-hatch-patterns.js";
import { DEFAULT_FEATURE_COLOR } from "../../utils/constants/constants.js";
import { isUnsafeKey } from "../../utils/general/object-path-guard.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Flat normalized style — input to all converters. */
export interface FlatStyle {
    fillColor?: string;
    fillOpacity?: number;
    color?: string;
    weight?: number;
    opacity?: number;
    dashArray?: string;
    lineCap?: string;
    lineJoin?: string;
    radius?: number;
    /** fill-extrusion: face color (hex). */
    fillExtrusionColor?: string;
    /** fill-extrusion: global opacity (0–1). */
    fillExtrusionOpacity?: number;
    /** fill-extrusion: height in metres. Number = fixed, string = feature field name. */
    fillExtrusionHeight?: number | string;
    /** fill-extrusion: base height in metres. Number = fixed, string = feature field name. */
    fillExtrusionBase?: number | string;
    /**
     * Native MapLibre GL paint properties (literal form) passed through as-is.
     * Keys must be MapLibre paint property names (e.g. `"fill-color"`, `"circle-radius"`).
     * Merged into the layer paint, overriding GeoLeaf-derived keys for the same key;
     * `expressionPaint` (expression form) still wins last. (ANO-059 — finalized in Archi S2)
     */
    paint?: Record<string, unknown>;
    /**
     * Native MapLibre GL paint properties passed through as-is.
     * Keys must be MapLibre paint property names (e.g. `"fill-color"`, `"line-width"`).
     * Values can be scalars or MapLibre GL expression arrays.
     * These override any GeoLeaf-derived paint properties for the same key.
     */
    expressionPaint?: Record<string, unknown>;
    [key: string]: unknown;
}

/** MapLibre paint properties for a fill layer. */
export interface FillPaint {
    "fill-color"?: string | unknown[];
    "fill-opacity"?: number | unknown[];
    "fill-outline-color"?: string | unknown[];
    "fill-pattern"?: string;
    [key: string]: unknown;
}

/** MapLibre paint properties for a line layer. */
export interface LinePaint {
    "line-color"?: string | unknown[];
    "line-width"?: number | unknown[];
    "line-opacity"?: number | unknown[];
    "line-dasharray"?: number[];
    "line-cap"?: string;
    "line-join"?: string;
    "line-gap-width"?: number;
    [key: string]: unknown;
}

/** MapLibre paint properties for a circle layer. */
export interface CirclePaint {
    "circle-color"?: string | unknown[];
    "circle-opacity"?: number | unknown[];
    "circle-radius"?: number | unknown[];
    "circle-stroke-color"?: string | unknown[];
    "circle-stroke-width"?: number | unknown[];
    [key: string]: unknown;
}

/** MapLibre paint properties for a fill-extrusion layer. */
export interface FillExtrusionPaint {
    "fill-extrusion-color"?: string | unknown[];
    "fill-extrusion-opacity"?: number | unknown[];
    "fill-extrusion-height"?: number | unknown[];
    "fill-extrusion-base"?: number | unknown[];
    [key: string]: unknown;
}

/** Casing configuration (thick outline behind a line). */
export interface CasingConfig {
    enabled: boolean;
    color?: string;
    opacity?: number;
    widthPx?: number;
    dashArray?: string;
    lineCap?: string;
    lineJoin?: string;
}

// ─── Security helpers ────────────────────────────────────────────────────────

/**
 * Safe shallow copy: copies own enumerable keys from `source` to `target`,
 * skipping prototype-polluting ones.
 *
 * @security Uses the canonical blocklist
 * ({@link module:utils/general/object-path-guard}). This file used to hold a fourth
 * private copy of the list — as a `Set`, where the other three were Arrays.
 * `JSON.parse` can produce objects where `__proto__` is an own property; copying such
 * an object key by key would invoke the `__proto__` setter and silently re-parent the
 * target. Style JSON is exactly that kind of input.
 */
function _safeCopy(target: Record<string, unknown>, source: Record<string, unknown>): void {
    for (const key of Object.keys(source)) {
        if (!isUnsafeKey(key)) {
            target[key] = source[key];
        }
    }
}

/**
 * Valid MapLibre paint/layout property name: kebab-case with letter-led segments
 * (e.g. `"fill-color"`, `"line-width"`). Anchored; hoisted to module scope so it
 * is compiled once rather than per key on every layer build.
 */
// Linear-time: the `-` separator is unambiguous, so the inner `[a-z0-9]*` and the
// outer `(?:-[a-z][a-z0-9]*)+` can never overlap — no catastrophic backtracking.
// Input is bounded (object keys). The detector is conservative here; false positive.
// eslint-disable-next-line security/detect-unsafe-regex -- false positive: unambiguous `-` delimiter, no overlapping quantifiers, bounded input
const _PAINT_KEY_RE = /^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)+$/;

/**
 * Merges native MapLibre paint properties (literal `paint` or expression-form
 * `expressionPaint`) into a MapLibre paint object, accepting only keys that look
 * like valid MapLibre paint/layout property names (kebab-case, letter-only
 * segments). Silently ignores invalid or dangerous keys.
 *
 * Valid examples: `"fill-color"`, `"line-width"`, `"circle-radius"`, `"text-size"`.
 */
function _mergeNativePaint(paint: Record<string, unknown>, source: Record<string, unknown>): void {
    for (const key of Object.keys(source)) {
        // Reject prototype-polluting keys and anything that doesn't look like a
        // MapLibre property (must be kebab-case, e.g. "fill-color", "line-width").
        // `_PAINT_KEY_RE` is an ALLOWLIST and is strictly narrower than the blocklist
        // — it already rejects the three unsafe keys, none of which contain a `-`.
        // The `isUnsafeKey` call is therefore redundant and kept deliberately: it is
        // defence in depth, and it keeps this sink legible to the write-sink gate,
        // which recognises a guarded write by the canonical guard being called in the
        // enclosing function.
        if (isUnsafeKey(key) || !_PAINT_KEY_RE.test(key)) {
            continue;
        }
        paint[key] = source[key];
    }
}

/**
 * Applies the native paint passthrough shared by every `to*Paint` converter:
 * literal `style.paint` first, then `style.expressionPaint` (last-wins, so the
 * data-driven expression channel stays authoritative). Both are key-validated by
 * {@link _mergeNativePaint}. See ANO-059.
 */
function _applyNativePaintOverrides(paint: Record<string, unknown>, style: FlatStyle): void {
    if (style.paint) _mergeNativePaint(paint, style.paint);
    if (style.expressionPaint) _mergeNativePaint(paint, style.expressionPaint);
}

// ─── Normalization ────────────────────────────────────────────────────────────

/**
 * Returns a shallow copy of a flat GeoLeaf style. All properties are copied
 * as-is — `radius` is the canonical point-size key.
 *
 * The nested `fill`/`stroke` format is no longer supported — profile style
 * files should use flat keys (`fillColor`, `fillOpacity`, `color`, `weight`…).
 *
 * Safe against prototype-pollution attacks: keys `__proto__`, `constructor`
 * and `prototype` are never copied.
 */
export function normalizeToFlat(style: Record<string, unknown> | null | undefined): FlatStyle {
    if (!style || typeof style !== "object") return {};

    const flat: FlatStyle = {};
    _safeCopy(flat, style);

    return flat;
}

// ─── Paint converters ────────────────────────────────────────────────────────

/**
 * Parses a CSS dash-array string (`"5, 10"`) into a number array (`[5, 10]`).
 * Returns `undefined` for invalid or empty input.
 */
export function parseDashArray(dashArray: string | undefined): number[] | undefined {
    if (!dashArray || typeof dashArray !== "string") return undefined;
    const parts = dashArray
        .split(/[\s,]+/)
        .map(Number)
        .filter((n) => Number.isFinite(n) && n >= 0);
    return parts.length > 0 ? parts : undefined;
}

/** Converts a flat GeoLeaf style to MapLibre fill paint properties. */
export function toFillPaint(style: FlatStyle, layerId?: string): FillPaint {
    const paint: FillPaint = {};
    if (style.fillColor) paint["fill-color"] = style.fillColor;
    if (typeof style.fillOpacity === "number") paint["fill-opacity"] = style.fillOpacity;
    if (style.color) paint["fill-outline-color"] = style.color;

    const hatch = style.hatch as HatchConfig | undefined;
    if (hatch?.enabled && layerId) {
        paint["fill-pattern"] = buildHatchPatternId(layerId, hatch);
        if (hatch.renderMode === "pattern_only") {
            paint["fill-color"] = "transparent";
            paint["fill-opacity"] = 1;
        }
    }
    _applyNativePaintOverrides(paint as Record<string, unknown>, style);
    return paint;
}

/** Converts a flat GeoLeaf style to MapLibre line paint properties. */
export function toLinePaint(style: FlatStyle): LinePaint {
    const paint: LinePaint = {};
    if (style.color) paint["line-color"] = style.color;
    if (typeof style.weight === "number") paint["line-width"] = style.weight;
    if (typeof style.opacity === "number") paint["line-opacity"] = style.opacity;
    const dash = parseDashArray(style.dashArray);
    if (dash) paint["line-dasharray"] = dash;
    if (style.lineCap) paint["line-cap"] = style.lineCap;
    if (style.lineJoin) paint["line-join"] = style.lineJoin;
    _applyNativePaintOverrides(paint as Record<string, unknown>, style);
    return paint;
}

/** Converts a flat GeoLeaf style to MapLibre circle paint properties. */
export function toCirclePaint(style: FlatStyle): CirclePaint {
    const paint: CirclePaint = {};
    if (style.fillColor) paint["circle-color"] = style.fillColor;
    if (typeof style.fillOpacity === "number") paint["circle-opacity"] = style.fillOpacity;
    if (typeof style.radius === "number") paint["circle-radius"] = style.radius;
    if (style.color) paint["circle-stroke-color"] = style.color;
    if (typeof style.weight === "number") paint["circle-stroke-width"] = style.weight;
    _applyNativePaintOverrides(paint as Record<string, unknown>, style);
    return paint;
}

/** Resolves extrusion height/base: string → `["coalesce", ["get", field], fallback]` expression; number → direct value. */
function _resolveExtrusionValue(
    value: number | string | undefined,
    fallback: number
): number | unknown[] {
    if (typeof value === "string") return ["coalesce", ["get", value], fallback];
    if (typeof value === "number") return value;
    return fallback;
}

/** Converts a flat GeoLeaf style to MapLibre fill-extrusion paint properties. */
export function toFillExtrusionPaint(style: FlatStyle): FillExtrusionPaint {
    const paint: FillExtrusionPaint = {};
    if (style.fillExtrusionColor) paint["fill-extrusion-color"] = style.fillExtrusionColor;
    paint["fill-extrusion-opacity"] =
        typeof style.fillExtrusionOpacity === "number" ? style.fillExtrusionOpacity : 1.0;
    paint["fill-extrusion-height"] = _resolveExtrusionValue(style.fillExtrusionHeight, 0);
    paint["fill-extrusion-base"] = _resolveExtrusionValue(style.fillExtrusionBase, 0);
    _applyNativePaintOverrides(paint as Record<string, unknown>, style);
    return paint;
}

/**
 * Converts a flat GeoLeaf style to MapLibre paint for a casing line layer.
 * Casing = thicker line rendered behind the main line for outline effect.
 */
export function toCasingPaint(casing: CasingConfig, mainWeight: number): LinePaint {
    const paint: LinePaint = {};
    paint["line-color"] = casing.color || "#000000";
    // Casing = main stroke + configurable border on each side
    paint["line-width"] = mainWeight + (casing.widthPx ?? 1) * 2;
    if (typeof casing.opacity === "number") paint["line-opacity"] = casing.opacity;
    const dash = parseDashArray(casing.dashArray);
    if (dash) paint["line-dasharray"] = dash;
    if (casing.lineCap) paint["line-cap"] = casing.lineCap;
    if (casing.lineJoin) paint["line-join"] = casing.lineJoin;
    return paint;
}

// ─── Hatch pattern collection ────────────────────────────────────────────────

/**
 * Collects unique hatch patterns from a default style and optional styleRules.
 * Returns `{ patternId, hatchConfig }` pairs to register on the map.
 */
export function collectHatchPatterns(
    defaultStyle: FlatStyle,
    styleRules: GeoJSONStyleRule[] | undefined,
    layerId: string
): { patternId: string; hatchConfig: HatchConfig }[] {
    const patterns: Map<string, HatchConfig> = new Map();

    const defaultHatch = defaultStyle.hatch as HatchConfig | undefined;
    if (defaultHatch?.enabled) {
        patterns.set(buildHatchPatternId(layerId, defaultHatch), defaultHatch);
    }

    if (styleRules?.length) {
        for (const rule of styleRules) {
            if (!rule.style) continue;
            const ruleFlat = normalizeToFlat(rule.style as Record<string, unknown>);
            const h = ruleFlat.hatch as HatchConfig | undefined;
            if (h?.enabled) {
                patterns.set(buildHatchPatternId(layerId, h), h);
            }
        }
    }

    return [...patterns.entries()].map(([patternId, hatchConfig]) => ({ patternId, hatchConfig }));
}

// ─── Data-driven style expressions ──────────────────────────────────────────

/** Comparison operators (==, !=, >, >=, <, <=) → MapLibre expression, or null if unhandled. */
function _comparisonExpression(
    operator: string,
    getter: unknown[],
    value: unknown
): unknown[] | null {
    switch (operator) {
        case "==":
        case "===":
        case "eq":
            return ["==", getter, value];

        case "!=":
        case "!==":
        case "neq":
            return ["!=", getter, value];

        case ">":
            return [">", getter, value];
        case ">=":
            return [">=", getter, value];
        case "<":
            return ["<", getter, value];
        case "<=":
            return ["<=", getter, value];

        default:
            return null;
    }
}

/** String/array operators (contains, startsWith, endsWith, in, notIn, between) → expression, or null. */
function _stringArrayExpression(
    operator: string,
    getter: unknown[],
    value: unknown
): unknown[] | null {
    switch (operator) {
        case "contains": {
            const lowerVal = String(value).toLowerCase();
            // MapLibre: check if lowercase string contains the substring
            return ["in", lowerVal, ["downcase", ["to-string", getter]]];
        }

        case "startsWith": {
            const lowerVal = String(value).toLowerCase();
            const len = lowerVal.length;
            return ["==", ["slice", ["downcase", ["to-string", getter]], 0, len], lowerVal];
        }

        case "endsWith": {
            const lowerVal = String(value).toLowerCase();
            const len = lowerVal.length;
            return [
                "==",
                [
                    "slice",
                    ["downcase", ["to-string", getter]],
                    ["-", ["length", ["to-string", getter]], len],
                ],
                lowerVal,
            ];
        }

        case "in": {
            if (!Array.isArray(value)) return null;
            return ["in", getter, ["literal", value]];
        }

        case "notIn": {
            if (!Array.isArray(value)) return null;
            return ["!", ["in", getter, ["literal", value]]];
        }

        case "between": {
            if (!Array.isArray(value) || value.length !== 2) return null;
            return ["all", [">=", getter, value[0]], ["<=", getter, value[1]]];
        }

        default:
            return null;
    }
}

/**
 * Converts a single GeoLeaf style condition to a MapLibre filter expression.
 *
 * @param condition - `{ field, operator, value }` or `{ all: [...] }`
 * @returns MapLibre expression array, e.g. `["==", ["get", "type"], "park"]`
 */
export function conditionToExpression(condition: GeoJSONStyleRuleCondition): unknown[] | null {
    if (condition.all && Array.isArray(condition.all)) {
        const subs = condition.all
            .map((c) => conditionToExpression(c))
            .filter((e): e is unknown[] => e !== null);
        if (subs.length === 0) return null;
        if (subs.length === 1) return subs[0] ?? null;
        return ["all", ...subs];
    }

    const { field, operator, value } = condition;
    if (!field || !operator) return null;

    // Strip "properties." prefix — MapLibre ["get"] operates implicitly on feature.properties
    const cleanField = field.startsWith("properties.") ? field.substring(11) : field;
    const getter: unknown[] = ["get", cleanField];

    return (
        _comparisonExpression(operator, getter, value) ??
        _stringArrayExpression(operator, getter, value)
    );
}

/** Strips the `"extends": "base"` marker from a style object before normalization. */
function _resolveRuleStyle(style: Record<string, unknown>): Record<string, unknown> {
    if (style.extends !== "base") return style;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(style)) {
        if (key !== "extends" && !isUnsafeKey(key)) {
            result[key] = style[key];
        }
    }
    return result;
}

/** Collects all paint keys and builds static or case-expression values per key. */
function _buildPaintFromRules(
    basePaint: Record<string, unknown>,
    ruleEntries: { expression: unknown[]; paint: Record<string, unknown> }[]
): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const allKeys = new Set<string>(Object.keys(basePaint));
    for (const entry of ruleEntries) {
        for (const k of Object.keys(entry.paint)) allKeys.add(k);
    }
    for (const key of allKeys) {
        // `allKeys` is built from the keys of `basePaint` and of every rule's `paint`,
        // both of which come from style JSON. The three sibling sinks in this file
        // were guarded; this one was not (S13.2) — the two writes below are dynamic
        // and would otherwise accept `__proto__` straight from a style rule.
        if (isUnsafeKey(key)) continue;
        const defaultVal = basePaint[key];
        const varies = ruleEntries.some(
            (e) => e.paint[key] !== undefined && e.paint[key] !== defaultVal
        );
        if (!varies) {
            if (defaultVal !== undefined) result[key] = defaultVal;
            continue;
        }
        result[key] = _buildCaseExpr(key, ruleEntries, defaultVal);
    }
    return result;
}

/** Builds a `["case", cond, val, ..., default]` expression for one paint key. */
function _buildCaseExpr(
    key: string,
    ruleEntries: { expression: unknown[]; paint: Record<string, unknown> }[],
    defaultVal: unknown
): unknown[] {
    const caseExpr: unknown[] = ["case"];
    for (const entry of ruleEntries) {
        const v = entry.paint[key];
        if (v !== undefined) caseExpr.push(entry.expression, Array.isArray(v) ? ["literal", v] : v);
    }
    const fallback = defaultVal ?? _getPaintDefault(key);
    caseExpr.push(Array.isArray(fallback) ? ["literal", fallback] : fallback);
    return caseExpr;
}

/**
 * Converts GeoLeaf `styleRules` + `defaultStyle` to MapLibre data-driven
 * paint expressions.
 *
 * For each paint property that varies across rules, builds a
 * `["case", cond1, val1, cond2, val2, ..., defaultVal]` expression.
 *
 * If `defaultStyle.expressionPaint` is set, those native MapLibre paint
 * properties are injected last, overriding any GeoLeaf-derived or
 * case-expression values for the same keys.
 *
 * @param styleRules - Array of `{ when, style }` rules from the profile
 * @param defaultStyle - Default style (flat) applied when no rule matches
 * @param geometryType - Target geometry type ('fill' | 'line' | 'circle' | 'fill-extrusion')
 * @param layerId - Layer the paint is built for; used to resolve per-layer style overrides.
 *   Omitted, only the profile-level defaults apply.
 * @returns Paint object with expression values where needed
 */
export function styleRulesToPaint(
    styleRules: GeoJSONStyleRule[],
    defaultStyle: FlatStyle,
    geometryType: "fill" | "line" | "circle" | "fill-extrusion",
    layerId?: string
): Record<string, unknown> {
    if (!styleRules || styleRules.length === 0) {
        return _getBasePaint(defaultStyle, geometryType, layerId);
    }

    // Collect all paint property keys that appear in any rule
    const basePaint = _getBasePaint(defaultStyle, geometryType, layerId);
    const ruleEntries: { expression: unknown[]; paint: Record<string, unknown> }[] = [];

    for (const rule of styleRules) {
        if (!rule.when || !rule.style) continue;
        const expr = conditionToExpression(rule.when);
        if (!expr) continue;
        // _resolveRuleStyle strips the "extends": "base" marker; the merge below
        // provides full inheritance from defaultStyle, so the marker is only syntactic.
        const ruleFlat = normalizeToFlat(_resolveRuleStyle(rule.style as Record<string, unknown>));
        const mergedFlat: FlatStyle = { ...defaultStyle, ...ruleFlat };
        ruleEntries.push({
            expression: expr,
            paint: _getBasePaint(mergedFlat, geometryType, layerId),
        });
    }

    if (ruleEntries.length === 0) return basePaint;

    const result = _buildPaintFromRules(basePaint, ruleEntries);

    // Apply expressionPaint from default style as final overrides — bypass case builder,
    // keys are validated to prevent prototype pollution. (style.paint is already merged
    // into basePaint and each rule's paint via _getBasePaint → to*Paint.)
    if (defaultStyle.expressionPaint) {
        _mergeNativePaint(result, defaultStyle.expressionPaint);
    }

    return result;
}

// ─── Private helpers ─────────────────────────────────────────────────────────

/** Returns the base (static) paint for a geometry type. */
function _getBasePaint(
    style: FlatStyle,
    geometryType: "fill" | "line" | "circle" | "fill-extrusion",
    layerId?: string
): Record<string, unknown> {
    switch (geometryType) {
        case "fill":
            return toFillPaint(style, layerId) as Record<string, unknown>;
        case "fill-extrusion":
            return toFillExtrusionPaint(style) as Record<string, unknown>;
        case "line":
            return toLinePaint(style) as Record<string, unknown>;
        case "circle":
            return toCirclePaint(style) as Record<string, unknown>;
    }
}

/** Returns a sensible paint default for a given MapLibre property key. */
function _getPaintDefault(key: string): unknown {
    switch (key) {
        case "fill-color":
        case "line-color":
        case "circle-color":
        case "circle-stroke-color":
        case "fill-outline-color":
            return DEFAULT_FEATURE_COLOR;
        case "fill-extrusion-color":
            return DEFAULT_FEATURE_COLOR;
        case "fill-opacity":
        case "line-opacity":
        case "circle-opacity":
        case "fill-extrusion-opacity":
            return 1;
        case "line-width":
        case "circle-stroke-width":
            return 1;
        case "circle-radius":
            return 6;
        case "fill-pattern":
            return "";
        case "fill-extrusion-height":
        case "fill-extrusion-base":
            return 0;
        case "line-dasharray":
            return [1, 0];
        default:
            return 0;
    }
}

// ─── Cluster paint converter ─────────────────────────────────────────────────

/**
 * Cluster config → MapLibre circle paint with step expressions based on `point_count`.
 *
 * @param config - Optional color/size stops. Sensible defaults provided.
 */
export function toClusterCirclePaint(config?: {
    colorStops?: [number, string][];
    radiusStops?: [number, number][];
}): CirclePaint {
    const colorStops = config?.colorStops ?? [
        [0, "#51bbd6"],
        [100, "#f1f075"],
        [750, "#f28cb1"],
    ];
    const radiusStops = config?.radiusStops ?? [
        [0, 18],
        [100, 24],
        [750, 32],
    ];

    // Build step expressions: ["step", ["get", "point_count"], default, stop1, val1, ...]
    // Destructuring the stop tuples inside `for..of` types both members; the indexed form
    // widened each of the four reads for nothing (qualite Q5).
    const colorExpr: unknown[] = ["step", ["get", "point_count"], colorStops[0]?.[1]];
    for (const [stop, val] of colorStops.slice(1)) {
        colorExpr.push(stop, val);
    }

    const radiusExpr: unknown[] = ["step", ["get", "point_count"], radiusStops[0]?.[1]];
    for (const [stop, val] of radiusStops.slice(1)) {
        radiusExpr.push(stop, val);
    }

    return {
        "circle-color": colorExpr,
        "circle-radius": radiusExpr,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
    } as CirclePaint;
}
