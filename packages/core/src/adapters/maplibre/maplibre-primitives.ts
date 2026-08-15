/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Shared helpers for the MapLibre adapter.
 * Extracted to keep maplibre-adapter.ts under the 700-line limit.
 */

import type {
    GeoLeafLatLng,
    GeoLeafBounds,
    GeoLeafControlPosition,
} from "../../contracts/map-adapter.contract.ts";
import type { MaplibreMap, MaplibreLayerSpec, LngLatBounds } from "./maplibre-adapter-types.js";

// ─── Paint helpers ────────────────────────────────────────────────────────────

/**
 * Applies one paint property to a layer, from a dynamically-built paint record.
 *
 * MapLibre 6 types `setPaintProperty`'s second parameter as `keyof AllPaintProperties`
 * instead of the v5 `string`. Every caller here iterates `Object.entries()` over a
 * `Record<string, unknown>` produced by the style converters (`toFillPaint`,
 * `styleRulesToPaint`, …), whose keys come from PROFILE JSON at runtime — a nominal
 * key type cannot describe them, and no amount of typing upstream would, since the
 * profile is data and not code.
 *
 * The cast therefore lives HERE, once, rather than at each call site: a single named
 * seam that says why it exists beats two silent `as never` scattered in loops. MapLibre
 * itself validates the property name and warns on an unknown one — this narrows the
 * type, it does not bypass a check.
 */
export function setPaintAt(map: MaplibreMap, layerId: string, prop: string, value: unknown): void {
    (map.setPaintProperty as (id: string, p: string, v: unknown) => void)(layerId, prop, value);
}

// ─── Coordinate helpers ───────────────────────────────────────────────────────

/** Converts a GeoLeafLatLng to a MapLibre [lng, lat] tuple. */
export function toMapLibreLngLat(ll: GeoLeafLatLng): [number, number] {
    return [ll.lng, ll.lat];
}

/** Converts a MapLibre {lng, lat} result to a GeoLeafLatLng value object. */
export function fromMapLibreLngLat(ll: { lng: number; lat: number }): GeoLeafLatLng {
    return { lat: ll.lat, lng: ll.lng };
}

/**
 * Converts a GeoLeafBounds to MapLibre LngLatBoundsLike [[w,s],[e,n]].
 * Note the order: MapLibre expects [lng, lat] (longitude first, then latitude).
 */
export function toMapLibreBounds(b: GeoLeafBounds): [[number, number], [number, number]] {
    return [
        [b.west, b.south],
        [b.east, b.north],
    ];
}

/** Converts a MapLibre LngLatBounds to a GeoLeafBounds object. */
export function fromMapLibreBounds(b: LngLatBounds): GeoLeafBounds {
    const sw = b.getSouthWest();
    const ne = b.getNorthEast();
    return { south: sw.lat, west: sw.lng, north: ne.lat, east: ne.lng };
}

// ─── Control position mapping ─────────────────────────────────────────────────

/** Maps GeoLeaf control positions to MapLibre position strings. */
export const POSITION_MAP: Record<GeoLeafControlPosition, string> = {
    topleft: "top-left",
    topright: "top-right",
    bottomleft: "bottom-left",
    bottomright: "bottom-right",
};

// ─── Security constants ───────────────────────────────────────────────────────

/** @security SVG-only tag whitelist for marker icon sanitisation. */
export const SVG_ALLOWED_TAGS = [
    "svg",
    "path",
    "circle",
    "rect",
    "g",
    "use",
    "line",
    "polygon",
    "polyline",
    "ellipse",
    "defs",
    "clipPath",
];

// ─── GeoJSON helpers ──────────────────────────────────────────────────────────

import { toSubLayerId } from "./maplibre-layer-registry.js";
import type { SubLayerType } from "./maplibre-layer-registry.js";

import {
    toFillPaint,
    toFillExtrusionPaint,
    toLinePaint,
    toCirclePaint,
    toCasingPaint,
    collectHatchPatterns,
    styleRulesToPaint,
    type CasingConfig,
} from "./maplibre-style-converter.js";
import { applyPendingBadgePaint } from "./maplibre-sync-badge.js";
import { applyTaxonomyMarkerPaint, resolveIconSize } from "./maplibre-taxonomy-paint.js";
import { registerHatchPattern } from "./maplibre-hatch-patterns.js";
import type { GeoJSONStyleRule } from "../../kernel/geojson/geojson-types.js";

/** Canonical GeoJSON geometry-type names accepted as a config-declared override. */
const _GEOJSON_TYPES = new Set([
    "Point",
    "MultiPoint",
    "LineString",
    "MultiLineString",
    "Polygon",
    "MultiPolygon",
    "GeometryCollection",
]);

/**
 * Resolves the geometry-type set for a layer, preferring a config-declared type
 * (GeoJSON vocabulary, e.g. `"Polygon"` or `["Point", "LineString"]`) to skip
 * the per-feature scan. Falls back to {@link detectGeometryTypes} when no valid
 * GeoJSON type is declared — so lowercase render hints (`"point"`/`"line"`/
 * `"polygon"`) and unknown values are ignored and behaviour is unchanged for
 * profiles that don't declare a type.
 *
 * A declared type is a caller promise: a genuinely mixed-geometry layer must not
 * declare a single type (it would be under-rendered). Leaving it undeclared
 * keeps the robust scan.
 */
export function resolveGeometryTypes(data: unknown, declared: unknown): Set<string> {
    const decl = Array.isArray(declared) ? declared : declared != null ? [declared] : [];
    const valid = decl.filter((t): t is string => typeof t === "string" && _GEOJSON_TYPES.has(t));
    return valid.length > 0 ? new Set(valid) : detectGeometryTypes(data);
}

/** Scans GeoJSON data and returns the set of geometry types present. */
export function detectGeometryTypes(data: unknown): Set<string> {
    const types = new Set<string>();
    const d = data as
        | {
              type?: string;
              features?: { geometry?: { type?: string } }[];
              geometry?: { type?: string };
          }
        | null
        | undefined;
    if (d?.type === "FeatureCollection" && Array.isArray(d.features)) {
        for (const f of d.features) {
            if (f?.geometry?.type) types.add(f.geometry.type);
        }
    } else if (d?.type === "Feature" && d.geometry?.type) {
        types.add(d.geometry.type);
    }
    if (types.size === 0) {
        types.add("Point");
        types.add("LineString");
        types.add("Polygon");
    }
    return types;
}

/** Returns `beforeId` if the layer exists, otherwise `undefined`. */
export function safeBeforeId(map: MaplibreMap, beforeId: string): string | undefined {
    return map.getLayer(beforeId) ? beforeId : undefined;
}

interface AddSubLayersOptions {
    styleRules?: GeoJSONStyleRule[];
    minZoom?: number;
    maxZoom?: number;
    showIconsOnMap?: boolean;
    /** Config-driven geometry override (e.g. "fill-extrusion"). */
    configGeometry?: string;
}

/** Shared rendering context passed to the per-geometry sub-layer builders. */
interface SubLayerCtx {
    map: MaplibreMap;
    id: string;
    sourceId: string;
    flat: Record<string, unknown>;
    layoutBase: Record<string, string>;
    beforeId: string | undefined;
    zoomProps: Record<string, number>;
    // Présent portant `undefined`, comme `beforeId` ci-dessus — et non `options?:` : le seul
    // constructeur de ce contexte (`addSubLayers`) le renseigne toujours, la valeur pouvant être
    // absente de contenu mais jamais la clé. Interface interne, non exportée.
    options: AddSubLayersOptions | undefined;
}

/**
 * Builds the `minzoom`/`maxzoom` props applied to every sub-layer of a layer.
 *
 * Shared with the cluster builder so it posts the SAME bounds: it was the only builder
 * without them, which left cluster circles rendering outside their layer's zoom range.
 */
export function buildZoomProps(options?: {
    minZoom?: number;
    maxZoom?: number;
}): Record<string, number> {
    const zoomProps: Record<string, number> = {};
    if (typeof options?.minZoom === "number") zoomProps.minzoom = options.minZoom;
    if (typeof options?.maxZoom === "number") zoomProps.maxzoom = options.maxZoom;
    return zoomProps;
}

/**
 * Applies a zoom range to each sub-layer that exists on the map.
 *
 * `null` clears a bound: MapLibre wants numbers, and its own defaults for an unbounded
 * layer are exactly [0 ; 24] — so they ARE "no bound".
 */
export function applyLayerZoomRange(
    map: MaplibreMap,
    subLayerIds: string[],
    minZoom: number | null,
    maxZoom: number | null
): void {
    for (const subId of subLayerIds) {
        if (map.getLayer(subId)) map.setLayerZoomRange(subId, minZoom ?? 0, maxZoom ?? 24);
    }
}

/** Creates fill/line/circle sub-layers for detected geometry types. */
export function addSubLayers(
    map: MaplibreMap,
    id: string,
    sourceId: string,
    geomTypes: Set<string>,
    flat: Record<string, unknown>,
    layoutBase: Record<string, string>,
    beforeId: string | undefined,
    options?: AddSubLayersOptions
): SubLayerType[] {
    const has = (...t: string[]) => t.some((v) => geomTypes.has(v));
    const cfgGeom = options?.configGeometry?.toLowerCase();

    // Zoom constraints applied to every sub-layer
    const zoomProps = buildZoomProps(options);

    const ctx: SubLayerCtx = { map, id, sourceId, flat, layoutBase, beforeId, zoomProps, options };
    const created: SubLayerType[] = [];

    if (has("Polygon", "MultiPolygon")) {
        created.push(..._addPolygonSubLayers(ctx, cfgGeom));
    }
    if (
        has("LineString", "MultiLineString", "Polygon", "MultiPolygon") &&
        cfgGeom !== "fill-extrusion"
    ) {
        created.push(..._addLineSubLayers(ctx));
    }
    if (has("Point", "MultiPoint")) {
        created.push(..._addPointSubLayers(ctx));
    }
    return created;
}

/** Adds the fill (or fill-extrusion) sub-layer for polygon geometries. */
function _addPolygonSubLayers(ctx: SubLayerCtx, cfgGeom: string | undefined): SubLayerType[] {
    const { map, id, sourceId, flat, layoutBase, beforeId, zoomProps, options } = ctx;
    if (cfgGeom === "fill-extrusion") {
        // fill-extrusion: extruded 3D polygons
        const extPaint = toFillExtrusionPaint(flat);
        map.addLayer(
            {
                id: toSubLayerId(id, "fill-extrusion"),
                type: "fill-extrusion",
                source: sourceId,
                paint: extPaint,
                layout: { ...layoutBase },
                ...zoomProps,
            } as MaplibreLayerSpec,
            beforeId
        );
        return ["fill-extrusion"];
    }
    // Register hatch patterns before creating the fill layer
    const hatchPatterns = collectHatchPatterns(flat, options?.styleRules, id);
    for (const { patternId, hatchConfig } of hatchPatterns) {
        registerHatchPattern(map, patternId, hatchConfig);
    }

    const fillPaint = options?.styleRules?.length
        ? styleRulesToPaint(options.styleRules, flat, "fill", id)
        : toFillPaint(flat, id);

    map.addLayer(
        {
            id: toSubLayerId(id, "fill"),
            type: "fill",
            source: sourceId,
            paint: fillPaint,
            layout: { ...layoutBase },
            ...zoomProps,
        } as MaplibreLayerSpec,
        beforeId
    );
    return ["fill"];
}

/** Adds the optional casing + main line sub-layers for line/polygon outlines. */
function _addLineSubLayers(ctx: SubLayerCtx): SubLayerType[] {
    const { map, id, sourceId, flat, layoutBase, beforeId, zoomProps, options } = ctx;
    const created: SubLayerType[] = [];

    // Casing: thicker line behind the main stroke for outline effect
    const casing = flat.casing as CasingConfig | undefined;
    if (casing?.enabled) {
        const mainWeight = typeof flat.weight === "number" ? (flat.weight as number) : 1;
        map.addLayer(
            {
                id: toSubLayerId(id, "casing"),
                type: "line",
                source: sourceId,
                paint: toCasingPaint(casing, mainWeight),
                layout: { ...layoutBase },
                ...zoomProps,
            } as MaplibreLayerSpec,
            beforeId
        );
        created.push("casing");
    }

    const linePaint = options?.styleRules?.length
        ? styleRulesToPaint(options.styleRules, flat, "line")
        : toLinePaint(flat);
    map.addLayer(
        {
            id: toSubLayerId(id, "line"),
            type: "line",
            source: sourceId,
            paint: linePaint,
            layout: { ...layoutBase },
            ...zoomProps,
        } as MaplibreLayerSpec,
        beforeId
    );
    created.push("line");
    return created;
}

/**
 * Adds the circle (and optional icon symbol) sub-layers for point geometries.
 *
 * ⚠️ **Points are circles, and `style.shape` does not change that** (backlog B.20).
 * The key exists in the style schema but is **inert — nothing reads it here** — and is
 * now restricted to `"circle"` by the schema, because it used to advertise `"square"`
 * while the engine never rendered one. MapLibre's `circle` layer draws circles only;
 * a square needs a whole second render path: a `symbol` layer over a generated SDF
 * icon, with `radius`→`icon-size`, `fillColor`→`icon-color` and the stroke emulated by
 * a halo (which does not look like a bordered circle).
 *
 * The expensive part is not the shape, it is everything wired onto the circle paint
 * below and which a second path would silently lose: `styleRules` expressions,
 * {@link applyTaxonomyMarkerPaint} and {@link applyPendingBadgePaint}. Plus
 * `kernel/geojson/feature-interaction.ts` selects the sub-layers that carry **both**
 * interaction gestures — click and hover — through `_interactionSubLayerIds`, whose
 * precedence reaches points by the `-circle` suffix; a square sub-layer would receive
 * neither gesture until declared there.
 *
 * Treat it as a feature with its own CDC, not as a style option to slot in.
 */
function _addPointSubLayers(ctx: SubLayerCtx): SubLayerType[] {
    const { map, id, sourceId, flat, layoutBase, beforeId, zoomProps, options } = ctx;
    const created: SubLayerType[] = [];

    const circlePaint = options?.styleRules?.length
        ? styleRulesToPaint(options.styleRules, flat, "circle")
        : toCirclePaint(flat);

    // ⚠ Order matters, and the two steps are not commutative.
    // 1. Taxonomy replaces the DEFAULT branch of the circle paint with its marker
    //    expression — the layer's own style rules keep their branches and keep
    //    winning. No-op when no taxonomy is bound to this layer.
    applyTaxonomyMarkerPaint(circlePaint, id);
    // 2. The pending-sync badge then WRAPS the resolved stroke in a `case`, taking
    //    whatever step 1 left as its fallback. Swapping these two would overwrite
    //    the badge. Visually neutral for features with no `_syncStatus` flag.
    applyPendingBadgePaint(circlePaint);

    map.addLayer(
        {
            id: toSubLayerId(id, "circle"),
            type: "circle",
            source: sourceId,
            paint: circlePaint,
            layout: { ...layoutBase },
            ...zoomProps,
        } as MaplibreLayerSpec,
        beforeId
    );
    created.push("circle");

    if (options?.showIconsOnMap) {
        map.addLayer(
            {
                id: toSubLayerId(id, "symbol"),
                type: "symbol",
                source: sourceId,
                // Only features the symbol injector actually tagged carry an icon;
                // without this filter MapLibre allocates a symbol bucket for every
                // feature in the layer and evaluates `icon-image` to null on most.
                filter: ["has", "symbolId"],
                layout: {
                    ...layoutBase,
                    "icon-image": ["get", "symbolId"],
                    "icon-size": resolveIconSize(),
                    "icon-allow-overlap": true,
                    "icon-ignore-placement": true,
                },
                paint: {},
                ...zoomProps,
            } as MaplibreLayerSpec,
            beforeId
        );
        created.push("symbol");
    }
    return created;
}

// Re-export for adapter convenience
export { toFillPaint, toLinePaint, toCirclePaint } from "./maplibre-style-converter.js";
export { toSubLayerId } from "./maplibre-layer-registry.js";
export type { SubLayerType } from "./maplibre-layer-registry.js";
