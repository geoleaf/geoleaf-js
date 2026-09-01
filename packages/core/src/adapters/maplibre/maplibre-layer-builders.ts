/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */
/**
 * MapLibre layer construction — GeoJSON sub-layers and POI cluster groups.
 * Extracted from `maplibre-adapter.ts` (keeps the adapter under the 700-line
 * budget); the adapter delegates to these free functions, passing its `map`,
 * layer registry and cluster-id map.
 */
import type { GeoLeafLayerOptions } from "../../contracts/map-adapter.contract.ts";
import type { MaplibreMap, MaplibreFilter, MaplibreSourceSpec } from "./maplibre-adapter-types.js";
import { MaplibreLayerRegistry, toSourceId } from "./maplibre-layer-registry.js";
import { normalizeToFlat } from "./maplibre-style-converter.js";
import type { GeoJSONStyleRule } from "../../kernel/geojson/geojson-types.js";
import {
    resolveGeometryTypes,
    safeBeforeId,
    addSubLayers,
    toSubLayerId,
    withGeometryGuard,
} from "./maplibre-primitives.js";
import { addClusterSubLayers, bindGeoJSONClusterEvents } from "./maplibre-cluster-builders.js";
import {
    createClusteredSource,
    bindPoiEvents,
    getClusterExpansionZoom,
    type ClusterLayerIds,
} from "./maplibre-poi-builders.js";
import { DEFAULT_CLUSTER_MAX_ZOOM, DEFAULT_CLUSTER_RADIUS } from "./maplibre-cluster.js";
import { dispatchGeoLeafEvent } from "../../kernel/events/event-bus.js";

/**
 * Builds the MapLibre GeoJSON source spec, applying clustering options when the
 * layer config requests it. Extracted to keep `buildGeoJSONLayer` ≤ 20 complexity.
 */
function buildSourceOptions(
    data: unknown,
    options?: GeoLeafLayerOptions,
    geomTypes?: ReadonlySet<string>
): Record<string, unknown> {
    const sourceOptions: Record<string, unknown> = { type: "geojson", data };
    // Promote the `id` property to the feature id on POINT sources so
    // setFeatureState() (sync badge, hover/selection) and GPU id-filters can
    // target a feature by its stable id. Inert until a consumer sets state.
    if (geomTypes?.has("Point")) sourceOptions.promoteId = "id";
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
    // Prefer a config-declared geometry type (GeoJSON vocabulary) to skip the
    // per-feature scan; falls back to scanning when undeclared (the common case).
    const geomTypes = resolveGeometryTypes(fc, options?.geometryType);

    // Add GeoJSON source (with or without clustering)
    const shouldCluster = options?.cluster === true;
    map.addSource(sourceId, buildSourceOptions(data, options, geomTypes) as MaplibreSourceSpec);

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

/**
 * Creates a clustered GeoJSON source with cluster circle/symbol layers and
 * wires the default click-to-expand interaction.
 *
 * @param map - The underlying `maplibregl.Map`.
 * @param registry - The adapter's layer registry.
 * @param clusterIds - The adapter's cluster-id map (mutated: id → layer ids).
 * @param id - GeoLeaf cluster group id.
 * @param options - Cluster options (`clusterRadius`, `clusterMaxZoom`).
 */
export async function buildClusterGroup(
    map: MaplibreMap,
    registry: MaplibreLayerRegistry,
    clusterIds: Map<string, ClusterLayerIds>,
    id: string,
    options?: Record<string, unknown>
): Promise<void> {
    if (clusterIds.has(id)) {
        throw new Error(`MaplibreAdapter: cluster group "${id}" already exists.`);
    }

    const ids = await createClusteredSource(map, id, {
        clusterRadius: (options?.clusterRadius as number) ?? DEFAULT_CLUSTER_RADIUS,
        clusterMaxZoom: (options?.clusterMaxZoom as number) ?? DEFAULT_CLUSTER_MAX_ZOOM,
    });

    clusterIds.set(id, ids);

    // Register in layer registry with custom IDs for unified layer management
    registry.register(id, ["circle", "symbol"], 100, {
        customSubLayerIds: ids.allLayerIds,
        customSourceId: ids.sourceId,
        geometryTypes: new Set(["Point"]),
    });

    // Wire default cluster interaction: click on cluster → expansion zoom
    bindPoiEvents(map, id, {
        onClusterClick: (feature, lngLat) => {
            const clusterId = feature.properties?.cluster_id as number | undefined;
            if (clusterId === undefined) return;
            getClusterExpansionZoom(map, id, clusterId)
                .then((zoom: number) => {
                    map.flyTo({ center: [lngLat.lng, lngLat.lat], zoom });
                })
                .catch(() => {
                    // Fallback: zoom in +2 levels on click if expansion zoom fails
                    map.flyTo({ center: [lngLat.lng, lngLat.lat], zoom: map.getZoom() + 2 });
                });
        },
    });

    // Signal capability plugins (taxonomy, …) that a point/cluster layer is ready.
    dispatchGeoLeafEvent("geoleaf:layer:added", {
        layerId: id,
        sourceId: ids.sourceId,
        geometryTypes: ["Point"],
    });
}
