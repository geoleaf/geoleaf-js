/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */
/**
 * MapLibre layer construction — GeoJSON sub-layers, clustered or not.
 * Extracted from `maplibre-adapter.ts` (keeps the adapter under the 700-line
 * budget); the adapter delegates to these free functions, passing its `map`,
 * and layer registry.
 */
import type { GeoLeafLayerOptions } from "../../contracts/map-adapter.contract.ts";
import type { MaplibreMap, MaplibreFilter, MaplibreSourceSpec } from "./maplibre-adapter-types.js";
import { MaplibreLayerRegistry, toSourceId } from "./maplibre-layer-registry.js";
import { normalizeToFlat } from "./maplibre-style-converter.js";
import type { GeoJSONStyleRule } from "../../kernel/geojson/geojson-types.js";
import {
    resolveGeometryTypes,
    scanGeometryTypes,
    safeBeforeId,
    addSubLayers,
    toSubLayerId,
    withGeometryGuard,
    type SubLayerType,
} from "./maplibre-primitives.js";
import { addClusterSubLayers, bindGeoJSONClusterEvents } from "./maplibre-cluster-builders.js";
import { DEFAULT_CLUSTER_MAX_ZOOM, DEFAULT_CLUSTER_RADIUS } from "./maplibre-cluster.js";
import { dispatchGeoLeafEvent } from "../../kernel/events/event-bus.js";
import { sanitizeAttribution } from "../../kernel/security/map-credit.js";

/**
 * Builds the MapLibre GeoJSON source spec, applying clustering options when the
 * layer config requests it. Extracted to keep `buildGeoJSONLayer` ≤ 20 complexity.
 */
function buildSourceOptions(data: unknown, options?: GeoLeafLayerOptions): Record<string, unknown> {
    const sourceOptions: Record<string, unknown> = { type: "geojson", data };
    // Promote the `id` property to the feature id, so setFeatureState() (sync badge,
    // hover/selection) and `updateData` diffs can target a feature by its stable id.
    // Inert when the property is absent — `getFeatureId` then yields `undefined`.
    //
    // 🛑 UNCONDITIONAL, and it was `geomTypes.has("Point")` until R6. A line or polygon
    // layer therefore had no promoted id at all: `setFeatureState` resolved nothing on
    // it, and a partial source update was impossible by construction.
    //
    // ⚠️ **Do not "improve" this by conditioning it on the data's ids being unique.**
    // `promoteId` is part of the SOURCE SPEC — frozen at `addSource` and never replayed,
    // exactly like the sub-layer set (invariant K-06) — whereas uniqueness is a property
    // of the DATA, which changes on every write. Conditioning a creation-time spec on a
    // run-time-variable property would engrave the shape of the very first dataset into
    // the layer forever; that is the same failure K-06 already documents for
    // `geometryType`, where a narrow declaration would permanently drop the sub-layers a
    // later write needs. The spec says "if there is an id, it is `properties.id`"; whether
    // the features actually carry unique ids today is decided per write, by the kernel.
    sourceOptions.promoteId = "id";
    // The layer's credit, shown by the engine's attribution control — cleaned on the way, like a
    // basemap's: it is HTML a caller wrote. An option with nothing left to show sets nothing.
    const credit = sanitizeAttribution(options?.attribution ?? "");
    if (credit) sourceOptions.attribution = credit;
    if (options?.cluster === true) {
        sourceOptions.cluster = true;
        sourceOptions.clusterRadius =
            typeof options?.clusterRadius === "number"
                ? options.clusterRadius
                : DEFAULT_CLUSTER_RADIUS;
        sourceOptions.clusterMaxZoom =
            typeof options?.clusterMaxZoom === "number"
                ? options.clusterMaxZoom
                : DEFAULT_CLUSTER_MAX_ZOOM;
    }
    return sourceOptions;
}

/**
 * Reads the flat GeoLeaf layer options into the locals `buildGeoJSONLayer` needs.
 * `options` already carries the typed style fields plus the `[key: string]: unknown`
 * escape hatch, so we read from it directly (no `Record` laundering). Extracted to
 * keep `buildGeoJSONLayer` under the complexity budget (socle S4).
 */
function resolveLayerParams(options?: GeoLeafLayerOptions) {
    return {
        styleRules: options?.styleRules as GeoJSONStyleRule[] | undefined,
        flat: normalizeToFlat(options),
        zIndex: typeof options?.zIndex === "number" ? options.zIndex : 0,
        visible: options?.visible !== false,
        minZoom: typeof options?.minZoom === "number" ? options.minZoom : undefined,
        maxZoom: typeof options?.maxZoom === "number" ? options.maxZoom : undefined,
        showIconsOnMap: options?.showIconsOnMap === true,
        configGeometry: options?.geometry as string | undefined,
    };
}

/**
 * Creates a GeoJSON source + fill/line/circle sub-layers (and cluster layers
 * when `options.cluster` is set) for the given data, then registers them.
 *
 * @param map - The underlying `maplibregl.Map`.
 * @param registry - The adapter's layer registry.
 * @param ensureSentinel - Callback that guarantees the POI sentinel layer exists.
 * @param id - GeoLeaf layer id.
 * @param data - GeoJSON FeatureCollection.
 * @param options - Layer/style options.
 */
export function buildGeoJSONLayer(
    map: MaplibreMap,
    registry: MaplibreLayerRegistry,
    ensureSentinel: () => void,
    id: string,
    data: unknown,
    options?: GeoLeafLayerOptions
): void {
    if (registry.has(id)) {
        throw new Error(`MaplibreAdapter: layer "${id}" already exists.`);
    }

    const sourceId = toSourceId(id);
    const fc = data as { type: string; features?: { geometry?: { type: string } }[] };
    // The declared kind is UNITED with what the data shows — the sub-layer set is decided
    // here, and only a later WRITE completes it (`growGeoJSONLayer`): a layer served empty
    // and never written must still get the sub-layers it says it will need.
    // Both spellings are read: `geometry` is the one most profiles use, and it used to
    // bring nothing to this union.
    const geomTypes = resolveGeometryTypes(fc, [options?.geometryType, options?.geometry]);

    // Add GeoJSON source (with or without clustering)
    const shouldCluster = options?.cluster === true;
    map.addSource(sourceId, buildSourceOptions(data, options) as MaplibreSourceSpec);

    // Resolve style + zoom/geometry params (extracted to resolveLayerParams to keep
    // this function under the complexity budget). Values feed the sub-layer builders.
    const { styleRules, flat, zIndex, visible, minZoom, maxZoom, showIconsOnMap, configGeometry } =
        resolveLayerParams(options);
    const layoutBase = visible
        ? { visibility: "visible" as const }
        : { visibility: "none" as const };
    const beforeId = registry.getInsertBeforeId(zIndex);

    ensureSentinel();
    const effectiveBeforeId = safeBeforeId(map, beforeId);
    const createdSubLayers = addSubLayers(
        map,
        id,
        sourceId,
        geomTypes,
        flat,
        layoutBase,
        effectiveBeforeId,
        {
            ...(styleRules !== undefined && { styleRules }),
            ...(minZoom !== undefined && { minZoom }),
            ...(maxZoom !== undefined && { maxZoom }),
            ...(showIconsOnMap && { showIconsOnMap }),
            ...(configGeometry !== undefined && { configGeometry }),
        }
    );

    // If clustering enabled: add cluster layers + filter unclustered circle layer
    let extraSubLayerIds: string[] = [];
    if (shouldCluster && geomTypes.has("Point")) {
        // Patch existing circle layer to only show unclustered points. Composed with the
        // geometry guard: `setFilter` replaces, so assigning the cluster predicate alone
        // would drop the guard on every clustered layer.
        const circleLayerId = toSubLayerId(id, "circle");
        if (map.getLayer(circleLayerId)) {
            map.setFilter(
                circleLayerId,
                withGeometryGuard("circle", ["!", ["has", "point_count"]]) as MaplibreFilter
            );
        }

        // Add cluster circle + count label layers — same zoom bounds as the rest
        extraSubLayerIds = addClusterSubLayers(map, id, sourceId, layoutBase, effectiveBeforeId, {
            ...(minZoom !== undefined && { minZoom }),
            ...(maxZoom !== undefined && { maxZoom }),
        });

        // Bind click-to-zoom interaction on clusters
        const clustersLayerId = extraSubLayerIds[0];
        if (clustersLayerId) bindGeoJSONClusterEvents(map, sourceId, clustersLayerId);
    }

    registry.register(id, createdSubLayers, zIndex, {
        ...(extraSubLayerIds.length && {
            customSubLayerIds: [
                ...createdSubLayers.map((t) => toSubLayerId(id, t)),
                ...extraSubLayerIds,
            ],
        }),
        geometryTypes: geomTypes,
    });
    if (!visible) registry.setVisible(id, false);

    // Signal capability plugins (taxonomy, …) that a layer is ready to be styled.
    dispatchGeoLeafEvent("geoleaf:layer:added", {
        layerId: id,
        sourceId,
        geometryTypes: Array.from(geomTypes),
    });
}

/** The sub-layer families of one layer, in the order they are drawn — bottom first. */
const _STACK: readonly SubLayerType[] = [
    "fill",
    "fill-extrusion",
    "casing",
    "line",
    "circle",
    "symbol",
];

/** True once a layer holds a sub-layer for each of the three geometry families. */
function _drawsEveryFamily(types: ReadonlySet<SubLayerType>): boolean {
    return (
        (types.has("fill") || types.has("fill-extrusion")) &&
        types.has("line") &&
        types.has("circle")
    );
}

/**
 * Gives a GeoJSON layer the sub-layers of a geometry it is about to receive and has none
 * for, and returns the families added.
 *
 * 🛑 A layer's sub-layers were decided once, from its first batch: a layer created with
 * points had nothing to draw a polygon with, so a polygon written to it later was stored,
 * listed in the table, counted by the filter — and never drawn. The decision is still made
 * at creation; it is now COMPLETED when the data shows a family the layer does not draw.
 *
 * Each new sub-layer is built by the builders of a creation, from the options the layer was
 * created with, and inserted where a creation would have drawn it: below the sub-layers of
 * this layer that come after it in the stack, else right above the layer's own top. It takes
 * the layer's current visibility and the zoom range its sub-layers carry now.
 *
 * ⚠️ What this does NOT replay, and the caller owns: a style set since the creation, and the
 * filters the layer carries — both are per-adapter state (`MaplibreAdapter.updateLayerData`).
 *
 * ⚠️ Two layers are left as they are. A vector-tile layer, which is not built here. And a
 * CLUSTERED layer: its source indexes points alone, so a sub-layer for
 * lines or polygons would have nothing to draw.
 *
 * @param map - The underlying `maplibregl.Map`.
 * @param registry - The adapter's layer registry.
 * @param id - GeoLeaf layer id.
 * @param data - The GeoJSON about to be written — a whole collection, or the features a diff adds.
 * @param options - The options the layer was created with.
 * @returns The sub-layer families added; empty when the layer already drew what it receives.
 */
export function growGeoJSONLayer(
    map: MaplibreMap,
    registry: MaplibreLayerRegistry,
    id: string,
    data: unknown,
    options?: GeoLeafLayerOptions
): SubLayerType[] {
    const entry = registry.get(id);
    if (!entry || entry.isVectorTile || _drawsEveryFamily(entry.subLayerTypes)) return [];
    if (entry.subLayerIds.some((subId) => subId.endsWith("-clusters"))) return [];
    // What the data SHOWS: an empty write, or features without a geometry, add nothing.
    const collection = Array.isArray((data as { features?: unknown })?.features)
        ? { type: "FeatureCollection", features: (data as { features: unknown[] }).features }
        : data;
    const known = entry.geometryTypes ?? new Set<string>();
    const fresh = [...scanGeometryTypes(collection)].filter((type) => !known.has(type));
    if (fresh.length === 0) return [];

    const { styleRules, flat, showIconsOnMap, configGeometry } = resolveLayerParams(options);
    const sibling = entry.subLayerIds.find((subId) => map.getLayer(subId));
    const range = sibling ? map.getLayer(sibling) : undefined;
    const own = new Set(_STACK.map((type) => toSubLayerId(id, type)));
    const placeBefore = (type: SubLayerType): string | undefined => {
        // Below the first sub-layer of THIS layer that the stack draws above it…
        const above = _STACK
            .slice(_STACK.indexOf(type) + 1)
            .map((later) => toSubLayerId(id, later))
            .find((subId) => map.getLayer(subId));
        if (above) return above;
        // …else right above this layer's own top: before whatever the style draws next.
        const order = map.getLayersOrder();
        let top = order.length - 1;
        while (top >= 0 && !own.has(order[top] ?? "")) top--;
        return top === -1
            ? safeBeforeId(map, registry.getInsertBeforeId(entry.zIndex, id))
            : order[top + 1];
    };

    const created = addSubLayers(
        map,
        id,
        entry.sourceId,
        new Set(fresh),
        flat,
        { visibility: entry.visible ? "visible" : "none" },
        undefined,
        {
            ...(styleRules !== undefined && { styleRules }),
            ...(typeof range?.minzoom === "number" && { minZoom: range.minzoom }),
            ...(typeof range?.maxzoom === "number" && { maxZoom: range.maxzoom }),
            ...(showIconsOnMap && { showIconsOnMap }),
            ...(configGeometry !== undefined && { configGeometry }),
            placeBefore,
        }
    );
    registry.extend(id, created, fresh, map.getLayersOrder());
    return created;
}
