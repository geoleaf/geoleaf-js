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
import type {
    MaplibreMap,
    MaplibreLayerSpec,
    MaplibreFilter,
    LngLatBounds,
} from "./maplibre-adapter-types.js";

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
import { geometryKindToGeoJSONTypes } from "../../kernel/config/layer-geometry.js";

/**
 * What a source of unknown content is assumed to hold.
 *
 * A layer whose data ships empty and is written at runtime says nothing about its geometry,
 * so every sub-layer is built. That over-rendering is HARMLESS — and only harmless — because
 * each sub-layer carries its own geometry guard: see {@link geometryGuard}. Narrowing this
 * would silently drop the sub-layer a later `setData` needs, since the sub-layer set is
 * decided once, at creation, and `updateLayerData` never revisits it.
 */
const _UNKNOWN_GEOMETRY = ["Point", "LineString", "Polygon"] as const;

/** Reads the geometry types actually present in the data. Empty when there are none. */
function _scanGeometryTypes(data: unknown): Set<string> {
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
    return types;
}

/**
 * Resolves the geometry-type set a layer's sub-layers are built for: what the data shows,
 * UNION what the config declares.
 *
 * 🛑 A declared kind ADDS, it never restricts — and this is not a convenience. A profile
 * declares ONE lowercase kind, which is the layer's SEMANTIC kind (the legend, the editor's
 * dropdown and the theme applier all read the same field). A layer whose kind is narrower
 * than its content — a computed itinerary is a `polyline` that also carries its stops —
 * would lose the sub-layers a restrictive reading leaves out, and lose them permanently,
 * since the set is decided at creation and `updateLayerData` never revisits it.
 *
 * 🛑 Corollary, and it is the half that is easy to get wrong: **only the DATA may say
 * "unknown".** The three-type fallback is keyed on an empty SCAN, never on the absence of a
 * declaration — otherwise declaring `polyline` on a layer that ships empty would narrow it
 * to lines alone, which is precisely how the itinerary's stops would stop being drawn. The
 * declaration's whole effect is to guarantee a sub-layer for what the boot data cannot show.
 *
 * ⚠️ This function accepted GeoJSON names ONLY until 27/08/2026, while the profile schema
 * allows nothing but the lowercase vocabulary — so no profile ever reached it. Both
 * vocabularies are now understood, in {@link geometryKindToGeoJSONTypes}.
 *
 * @param data - The layer's GeoJSON, possibly empty.
 * @param declared - The config-declared kind, in either vocabulary. A list is accepted.
 * @returns The geometry types to build sub-layers for. Never empty.
 */
export function resolveGeometryTypes(data: unknown, declared: unknown): Set<string> {
    const types = _scanGeometryTypes(data);
    if (types.size === 0) for (const t of _UNKNOWN_GEOMETRY) types.add(t);
    for (const t of geometryKindToGeoJSONTypes(declared)) types.add(t);
    return types;
}

/**
 * Scans GeoJSON data and returns the set of geometry types present.
 *
 * @param data - The GeoJSON to scan.
 * @returns The types found, or {@link _UNKNOWN_GEOMETRY} when the data shows none.
 */
export function detectGeometryTypes(data: unknown): Set<string> {
    return resolveGeometryTypes(data, undefined);
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
    // Present carrying `undefined`, like `beforeId` above — not `options?:`: the only
    // constructor of this context (`addSubLayers`) always sets it; the value may be empty
    // but the key never is. Internal interface, not exported.
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

/**
 * GeoJSON geometry types each sub-layer family is allowed to paint.
 *
 * 🛑 MapLibre checks NO geometry type when it populates a bucket. `FillBucket` triangulates
 * whatever rings it is handed — a `LineString` included, which it closes into a filled polygon —
 * and `CircleBucket` walks every point of every ring, so a line contributes one circle per
 * vertex. A source carrying more than one geometry kind, or one that ships EMPTY and is written
 * at runtime, therefore renders each of its features in every sub-layer it owns. The filter is
 * what confines a sub-layer to the geometry it was built for.
 *
 * `Multi*` names are listed although a bucket only ever sees the singular form (the tile encoder
 * collapses them): `queryRenderedFeatures` re-evaluates the same filter against raw GeoJSON,
 * where the multi names DO appear, and a picker that disagrees with the renderer is worse than
 * no picker.
 */
const _GUARDED_GEOMETRY: Readonly<Partial<Record<SubLayerType, readonly string[]>>> = {
    fill: ["Polygon", "MultiPolygon"],
    "fill-extrusion": ["Polygon", "MultiPolygon"],
    // Lines also draw polygon OUTLINES — the same widening the geometry test below applies.
    line: ["LineString", "MultiLineString", "Polygon", "MultiPolygon"],
    casing: ["LineString", "MultiLineString", "Polygon", "MultiPolygon"],
    circle: ["Point", "MultiPoint"],
    symbol: ["Point", "MultiPoint"],
};

/**
 * The geometry filter a sub-layer must carry, or `null` when it needs none.
 *
 * `clusters` / `cluster-count` answer `null`: a clustered source is point-only by construction,
 * and the `point_count` filters are the ones that matter there.
 *
 * ⚠️ NOT exported, and it should stay that way: every caller outside this module goes
 * through {@link withGeometryGuard}, which is what keeps a re-set filter from silently
 * REPLACING the guard instead of composing with it. Exporting the bare guard would offer
 * the wrong door.
 *
 * @param type - The sub-layer family.
 * @returns A MapLibre filter expression, or `null`.
 */
function geometryGuard(type: SubLayerType): MaplibreFilter | null {
    const allowed = _GUARDED_GEOMETRY[type];
    return allowed
        ? (["match", ["geometry-type"], [...allowed], true, false] as MaplibreFilter)
        : null;
}

/**
 * Combines a sub-layer's geometry guard with a caller-supplied filter.
 *
 * ⚠️ Every path that (re-)sets a filter must go through this. `setLayerFilter` and the cluster
 * patch both REPLACE a layer's filter wholesale; either one dropping the guard would bring the
 * defect back for exactly as long as a filter is active.
 *
 * @param type - The sub-layer family.
 * @param filter - The caller's filter, or `null` / `undefined` for none.
 * @returns The composed filter, one of the two alone, or `null` when neither exists.
 */
export function withGeometryGuard(type: SubLayerType, filter: unknown): MaplibreFilter | null {
    const guard = geometryGuard(type);
    if (filter === null || filter === undefined) return guard;
    if (!guard) return filter as MaplibreFilter;
    // Built as `unknown[]` on purpose. MapLibre's filter type is a union of an expression
    // form and a legacy form, and an `["all", …]` whose members straddle the two fits
    // neither branch — although MapLibre itself evaluates exactly that. Every branch of
    // the union IS an array, so `unknown[]` overlaps it and ONE conversion suffices; the
    // inline literal needed two, and an assertion must never be born as debt.
    const composed: unknown[] = ["all", guard, filter];
    return composed as MaplibreFilter;
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
                filter: geometryGuard("fill-extrusion"),
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
            filter: geometryGuard("fill"),
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
        const mainWeight = typeof flat.weight === "number" ? flat.weight : 1;
        map.addLayer(
            {
                id: toSubLayerId(id, "casing"),
                type: "line",
                source: sourceId,
                filter: geometryGuard("casing"),
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
            filter: geometryGuard("line"),
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
            filter: geometryGuard("circle"),
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
                filter: withGeometryGuard("symbol", ["has", "symbolId"]),
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
