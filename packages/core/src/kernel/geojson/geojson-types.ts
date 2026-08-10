/*!
 * GeoLeaf Core – GeoJSON types
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/** GeoJSON Feature (geometry + properties) */
export interface GeoJSONFeature {
    type: "Feature";
    id?: string | number;
    geometry: GeoJSONGeometry;
    properties?: Record<string, unknown> | null;
}

/** GeoJSON geometry (minimum union for layer handling) */
export type GeoJSONGeometry =
    | { type: "Point"; coordinates: [number, number] | [number, number, number] }
    | { type: "LineString"; coordinates: [number, number][] | [number, number, number][] }
    | { type: "Polygon"; coordinates: [number, number][][] | [number, number, number][][] }
    | { type: "MultiPoint"; coordinates: ([number, number] | [number, number, number])[] }
    | { type: "MultiLineString"; coordinates: ([number, number][] | [number, number, number][])[] }
    | {
          type: "MultiPolygon";
          coordinates: ([number, number][][] | [number, number, number][][])[];
      };

/** GeoJSON FeatureCollection */
export interface GeoJSONFeatureCollection {
    type: "FeatureCollection";
    features: GeoJSONFeature[];
}

/** Style rule condition (when) */
export interface GeoJSONStyleRuleCondition {
    field?: string;
    operator?: string;
    value?: unknown;
    all?: GeoJSONStyleRuleCondition[];
}

/** Style rule (when + style) */
export interface GeoJSONStyleRule {
    when: GeoJSONStyleRuleCondition;
    style: GeoJSONStyle;
}

/** GeoJSON layer style (flat format) */
export interface GeoJSONStyle {
    /** Fill color (hex/CSS). */
    fillColor?: string;
    /** Fill opacity (0–1). */
    fillOpacity?: number;
    /** Stroke / line color (hex/CSS). */
    color?: string;
    /** Stroke width in pixels. */
    weight?: number;
    /** Stroke opacity (0–1). */
    opacity?: number;
    /** Dash pattern, e.g. `"5 10"`. */
    dashArray?: string;
    lineCap?: string;
    lineJoin?: string;
    /** Point radius in pixels. */
    radius?: number;
    /** Point shape (`"circle"`, `"square"`, …). */
    shape?: string;
    hatch?: { enabled?: boolean; renderMode?: string; [key: string]: unknown };
    /**
     * Native MapLibre GL paint properties passed through as-is.
     * Keys must be MapLibre paint property names (e.g. `"fill-color"`, `"line-width"`).
     * Values can be scalars or MapLibre GL expression arrays.
     * These override any GeoLeaf-derived paint properties for the same key.
     *
     * @example
     * ```json
     * { "expressionPaint": { "fill-color": ["interpolate", ["linear"], ["zoom"], 5, "#ffffcc", 12, "#800026"] } }
     * ```
     */
    expressionPaint?: Record<string, unknown>;
    /**
     * Inherit all unspecified properties from the file's root `style` object (the default style).
     * Only `"base"` is supported. When set, only the properties that differ from the base need
     * to be declared in this rule's style object.
     *
     * @example
     * ```json
     * { "when": { "field": "class_id", "operator": "==", "value": 2 },
     *   "style": { "extends": "base", "hatch": { "spacingPx": 14 } } }
     * ```
     */
    extends?: "base";
    [key: string]: unknown;
}

/** Options for a GeoJSON layer (config layer entry) */
export interface GeoJSONLayerOptions {
    id?: string;
    label?: string;
    url?: string;
    data?: unknown;
    defaultStyle?: GeoJSONStyle;
    defaultPointStyle?: Record<string, unknown>;
    styleRules?: GeoJSONStyleRule[];
    pointToLayer?: (feature: GeoJSONFeature, latlng: unknown) => unknown;
    onEachFeature?: (feature: GeoJSONFeature, layer: unknown) => void;
    interactiveShape?: boolean;
    fitBoundsOnLoad?: boolean;
    maxZoomOnFit?: number;
    [key: string]: unknown;
}
