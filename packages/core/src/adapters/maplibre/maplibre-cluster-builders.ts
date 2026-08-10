/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */
/**
 * MapLibre cluster sub-layer builders for GeoJSON sources with native
 * Supercluster. Split out of `maplibre-helpers.ts` (socle B.2) so cluster
 * construction lives in one focused module next to `maplibre-cluster.ts`
 * (the shared cluster constants) — and keeps `maplibre-primitives.ts` comfortably
 * under the 700-line budget as it keeps absorbing helpers.
 */
import { trackMapCleanup } from "./maplibre-event-subscriptions.js";
import { toClusterCirclePaint } from "./maplibre-style-converter.js";
import { toSubLayerId } from "./maplibre-layer-registry.js";
import { buildZoomProps } from "./maplibre-primitives.js";
import type {
    MaplibreMap,
    MaplibreLayerSpec,
    MapLayerMouseEvent,
    ClusterSourceLike,
} from "./maplibre-adapter-types.js";

/**
 * Adds cluster circle + count label sub-layers for a GeoJSON source
 * that has `cluster: true`. Also patches the existing "circle" sub-layer
 * with a filter to exclude clustered points.
 *
 * @returns The sub-layer type keys added (`"clusters"` and `"cluster-count"`).
 */
export function addClusterSubLayers(
    map: MaplibreMap,
    id: string,
    sourceId: string,
    layoutBase: Record<string, string>,
    beforeId: string | undefined,
    options?: { minZoom?: number; maxZoom?: number }
): string[] {
    const clusterPaint = toClusterCirclePaint();
    // Same bounds as the other sub-layers: a cluster circle outliving its layer's zoom
    // range would keep drawing counts for features the engine no longer renders.
    const zoomProps = buildZoomProps(options);

    // Cluster circles
    const clustersId = toSubLayerId(id, "clusters");
    map.addLayer(
        {
            id: clustersId,
            type: "circle",
            source: sourceId,
            filter: ["has", "point_count"],
            paint: clusterPaint,
            layout: { ...layoutBase },
            ...zoomProps,
        } as MaplibreLayerSpec,
        beforeId
    );

    // Cluster count labels
    const clusterCountId = toSubLayerId(id, "cluster-count");
    map.addLayer(
        {
            id: clusterCountId,
            type: "symbol",
            source: sourceId,
            filter: ["has", "point_count"],
            layout: {
                ...layoutBase,
                "text-field": ["get", "point_count_abbreviated"],
                "text-font": ["Noto Sans Bold"],
                "text-size": 12,
            },
            paint: { "text-color": "#333333" },
            ...zoomProps,
        } as MaplibreLayerSpec,
        beforeId
    );

    return [clustersId, clusterCountId];
}

/**
 * Binds default cluster interactions on GeoJSON layers:
 * click on cluster → `getClusterExpansionZoom` + `flyTo`.
 */
export function bindGeoJSONClusterEvents(
    map: MaplibreMap,
    sourceId: string,
    clustersLayerId: string
): void {
    const onClusterClick = (e: MapLayerMouseEvent) => {
        const hit = e.features?.[0];
        if (!hit) return;
        const clusterId = hit.properties?.cluster_id as number | undefined;
        if (clusterId === undefined) return;
        const source = map.getSource(sourceId) as ClusterSourceLike | undefined;
        if (!source) return;
        source
            .getClusterExpansionZoom(clusterId)
            .then((zoom: number) => {
                map.flyTo({ center: e.lngLat, zoom });
            })
            .catch(() => {
                map.flyTo({ center: e.lngLat, zoom: map.getZoom() + 2 });
            });
    };
    // Cursor pointer on hover over clusters
    const setPointer = () => {
        map.getCanvas().style.cursor = "pointer";
    };
    const clearPointer = () => {
        map.getCanvas().style.cursor = "";
    };
    map.on("click", clustersLayerId, onClusterClick);
    map.on("mouseenter", clustersLayerId, setPointer);
    map.on("mouseleave", clustersLayerId, clearPointer);
    trackMapCleanup(map, () => {
        map.off("click", clustersLayerId, onClusterClick);
        map.off("mouseenter", clustersLayerId, setPointer);
        map.off("mouseleave", clustersLayerId, clearPointer);
    });
}
