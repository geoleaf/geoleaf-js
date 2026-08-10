/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * MapLibre POI Renderer
 *
 * Encapsulates MapLibre-specific logic for creating and managing POI
 * cluster sources, render layers, and interaction events. Extracted from
 * the adapter to keep it under the 700-line limit.
 *
 * **Architecture — GPU only.** A GeoJSON source with `cluster:true` feeds the
 * render layers (clusters circle, cluster-count symbol, unclustered-point
 * circle). Everything is drawn by the engine; there is no `maplibregl.Marker`
 * and no DOM path. Clicks are answered by `feature-info`, which mounts a native
 * `maplibregl.Popup` — the marker-per-POI design predates the S9 dissolution and
 * never survived it.
 */
"use strict";

import { toClusterCirclePaint } from "./maplibre-style-converter.js";
import { SYNC_PENDING } from "./maplibre-sync-badge.js";
import { trackMapCleanup } from "./maplibre-event-subscriptions.js";
import {
    MAPLIBRE_MAX_CLUSTER_ZOOM,
    DEFAULT_CLUSTER_MAX_ZOOM,
    DEFAULT_CLUSTER_RADIUS,
} from "./maplibre-cluster.js";
import type {
    MaplibreMap,
    MaplibreFilter,
    MapLayerMouseEvent,
    MapGeoJSONFeature,
    ClusterSourceLike,
} from "./maplibre-adapter-types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Suffix for the cluster circles layer. */
const CLUSTERS_SUFFIX = "-clusters";

/** Suffix for the cluster count label layer. */
const CLUSTER_COUNT_SUFFIX = "-cluster-count";

/** Suffix for the unclustered individual points layer. */
const UNCLUSTERED_SUFFIX = "-unclustered";

/** Suffix for the unclustered icon symbol layer (stacked above the circle layer). */
const UNCLUSTERED_ICONS_SUFFIX = "-unclustered-icons";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Clustering parameters for a POI source.
 *
 * `clusterMaxZoom` is the zoom at which clustering **stops**: past it every point is drawn
 * individually. Setting it too high is the usual reason markers never separate.
 */
export interface ClusterSourceOptions {
    /** Cluster radius in pixels. @default 50 */
    clusterRadius?: number;
    /** Max zoom at which clusters are generated. @default 14 */
    clusterMaxZoom?: number;
    /** Initial data. Defaults to empty FeatureCollection. */
    data?: GeoJSON.FeatureCollection;
    /** Cluster paint config (color/radius stops). */
    clusterPaint?: {
        colorStops?: [number, string][];
        radiusStops?: [number, number][];
    };
    /** Default unclustered point paint overrides. */
    unclusteredPaint?: Record<string, unknown>;
}

/**
 * The MapLibre source and layer ids that {@link createClusteredSource} created.
 *
 * A clustered POI source is **five** MapLibre objects, not one — clusters, their count
 * labels, unclustered circles and the icon symbol layer above them. `allLayerIds` is what a
 * teardown must iterate: removing the source alone leaves the layers orphaned.
 */
export interface ClusterLayerIds {
    sourceId: string;
    clustersLayerId: string;
    clusterCountLayerId: string;
    unclusteredLayerId: string;
    /** Symbol layer for GPU-rendered icons stacked above the circle layer. */
    unclusteredIconsLayerId: string;
    allLayerIds: string[];
}

/**
 * Click handlers for a clustered POI source.
 *
 * The two cases are distinct on purpose: clicking a cluster usually zooms in, clicking a
 * point opens a feature. Both receive the coordinates so a popup can be anchored without a
 * second lookup.
 */
export interface PoiEventHandlers {
    /** Called when an unclustered point is clicked. Receives the feature and coordinates. */
    onPointClick?: (feature: MapGeoJSONFeature, lngLat: { lng: number; lat: number }) => void;
    /** Called when a cluster is clicked. Receives the cluster feature and coordinates. */
    onClusterClick?: (feature: MapGeoJSONFeature, lngLat: { lng: number; lat: number }) => void;
}

// ─── Layer ID builders ───────────────────────────────────────────────────────

/** Builds the MapLibre source ID for a POI cluster source. */
export function toClusterSourceId(id: string): string {
    return "gl-poi-src-" + id;
}

/** Builds sub-layer IDs for a POI cluster group. */
export function toClusterLayerIds(id: string): ClusterLayerIds {
    const prefix = "gl-poi-" + id;
    const sourceId = toClusterSourceId(id);
    const clustersLayerId = prefix + CLUSTERS_SUFFIX;
    const clusterCountLayerId = prefix + CLUSTER_COUNT_SUFFIX;
    const unclusteredLayerId = prefix + UNCLUSTERED_SUFFIX;
    const unclusteredIconsLayerId = prefix + UNCLUSTERED_ICONS_SUFFIX;
    return {
        sourceId,
        clustersLayerId,
        clusterCountLayerId,
        unclusteredLayerId,
        unclusteredIconsLayerId,
        allLayerIds: [
            clustersLayerId,
            clusterCountLayerId,
            unclusteredLayerId,
            unclusteredIconsLayerId,
        ],
    };
}

// ─── Source & layer creation ─────────────────────────────────────────────────

/**
 * Creates a clustered GeoJSON source and its 3 render layers on the map.
 *
 * @param map - Native MapLibre map instance.
 * @param id - GeoLeaf cluster group identifier (e.g. `"gl-cluster"`).
 * @param options - Clustering and paint options.
 * @returns The layer IDs created.
 */
/** Stroke colours for the hover / selection halo (feature-state driven — RM-P1b(d)). */
const POI_HOVER_STROKE = "#42a5f5";
const POI_SELECTED_STROKE = "#1565c0";

// SYNC_PENDING — the `coalesce(feature-state, property)` pending-sync test — is
// shared with the generic point sub-layer builder (imported from the style
// converter) so the badge paint stays identical across both render pipelines.

/** Default paint for unclustered POI circles. Reacts to selection / hover / pending. */
const DEFAULT_UNCLUSTERED_PAINT: Record<string, unknown> = {
    "circle-color": ["coalesce", ["get", "colorFill"], "#4a90e5"],
    "circle-radius": ["coalesce", ["get", "radius"], 6],
    "circle-stroke-width": [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        3,
        ["boolean", ["feature-state", "hover"], false],
        2.5,
        SYNC_PENDING,
        2.5,
        1.5,
    ],
    "circle-stroke-color": [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        POI_SELECTED_STROKE,
        ["boolean", ["feature-state", "hover"], false],
        POI_HOVER_STROKE,
        SYNC_PENDING,
        "#ff9800",
        ["coalesce", ["get", "colorStroke"], "#ffffff"],
    ],
};

/** Adds the 3 cluster render layers (circles, count labels, unclustered points). */
function _addClusterLayers(
    map: MaplibreMap,
    ids: ClusterLayerIds,
    clusterPaint: Record<string, unknown>,
    unclusteredPaint: Record<string, unknown>
): void {
    map.addLayer({
        id: ids.clustersLayerId,
        type: "circle",
        source: ids.sourceId,
        filter: ["has", "point_count"],
        paint: clusterPaint,
    });
    map.addLayer({
        id: ids.clusterCountLayerId,
        type: "symbol",
        source: ids.sourceId,
        filter: ["has", "point_count"],
        layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": ["Noto Sans Bold"],
            "text-size": 12,
        },
        paint: { "text-color": "#333333" },
    });
    map.addLayer({
        id: ids.unclusteredLayerId,
        type: "circle",
        source: ids.sourceId,
        filter: ["!", ["has", "point_count"]],
        paint: unclusteredPaint,
    });
    // Icon symbol layer — stacked above circle layer; only shown for points with a registered image.
    map.addLayer({
        id: ids.unclusteredIconsLayerId,
        type: "symbol",
        source: ids.sourceId,
        filter: ["all", ["!", ["has", "point_count"]], ["has", "symbolId"]],
        layout: {
            "icon-image": ["get", "symbolId"],
            "icon-size": 1,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
        },
    });
}

/**
 * Creates a clustered POI source and its four layers on the map.
 *
 * ⚠️ Awaits the style before touching it: MapLibre rejects `addSource`/`addLayer` until the
 * style has loaded, and the failure is asynchronous, so a caller that skips the wait gets a
 * source that silently never appears.
 *
 * @param map - The native MapLibre map.
 * @param id - Logical POI id; the source and layer ids are derived from it.
 * @param options - Clustering and paint parameters.
 * @returns The ids created, for later update or teardown.
 */
export async function createClusteredSource(
    map: MaplibreMap,
    id: string,
    options?: ClusterSourceOptions
): Promise<ClusterLayerIds> {
    // MapLibre requires the style to be fully loaded before addSource/addLayer.
    // Use the same guard pattern as registerSpriteIcons (maplibre-poi-icons.ts).
    if (!map.isStyleLoaded()) {
        await new Promise<void>((resolve) => {
            // `once(type, listener)` returns the map, not a promise — MapLibre unions
            // both in a single signature (maplibre-gl.d.ts:12010).
            void map.once("styledata", resolve);
        });
    }
    const ids = toClusterLayerIds(id);
    const data = options?.data ?? { type: "FeatureCollection", features: [] };
    map.addSource(ids.sourceId, {
        type: "geojson",
        data,
        // Promote the POI `id` property to the feature id so setFeatureState()
        // (sync badge, hover/selection halo) can target a POI by its stable id.
        promoteId: "id",
        cluster: true,
        clusterRadius: options?.clusterRadius ?? DEFAULT_CLUSTER_RADIUS,
        clusterMaxZoom: Math.min(
            options?.clusterMaxZoom ?? DEFAULT_CLUSTER_MAX_ZOOM,
            MAPLIBRE_MAX_CLUSTER_ZOOM
        ),
    });
    const clusterPaint = toClusterCirclePaint(options?.clusterPaint);
    const unclusteredPaint = options?.unclusteredPaint ?? DEFAULT_UNCLUSTERED_PAINT;
    _addClusterLayers(map, ids, clusterPaint, unclusteredPaint);
    return ids;
}

// ─── Filtering ───────────────────────────────────────────────────────────────

/**
 * Applies a MapLibre filter expression to the unclustered-point layer.
 *
 * @param map - Native MapLibre map instance.
 * @param id - Cluster group identifier.
 * @param filter - MapLibre filter expression, or `null` to reset to default.
 */
export function applyPoiFilter(map: MaplibreMap, id: string, filter: unknown): void {
    const ids = toClusterLayerIds(id);
    if (filter === null || filter === undefined) {
        // Reset to default: show all unclustered points
        map.setFilter(ids.unclusteredLayerId, ["!", ["has", "point_count"]] as MaplibreFilter);
        map.setFilter(ids.unclusteredIconsLayerId, [
            "all",
            ["!", ["has", "point_count"]],
            ["has", "symbolId"],
        ] as MaplibreFilter);
    } else {
        // Combine with the base filter (must NOT be a cluster).
        // `filter` is opaque (unknown) at this boundary, so route through `unknown`.
        map.setFilter(ids.unclusteredLayerId, [
            "all",
            ["!", ["has", "point_count"]],
            filter,
        ] as unknown as MaplibreFilter);
        map.setFilter(ids.unclusteredIconsLayerId, [
            "all",
            ["!", ["has", "point_count"]],
            ["has", "symbolId"],
            filter,
        ] as unknown as MaplibreFilter);
    }
}

// ─── Events ──────────────────────────────────────────────────────────────────

/**
 * Binds click and hover events on the cluster layers.
 *
 * @param map - Native MapLibre map instance.
 * @param id - Cluster group identifier.
 * @param handlers - Event handler callbacks.
 */
export function bindPoiEvents(map: MaplibreMap, id: string, handlers: PoiEventHandlers): void {
    const ids = toClusterLayerIds(id);

    // Click on unclustered point. The icon layer is topmost, so both the circle
    // and icon layers forward to the same `onPointClick` handler.
    if (handlers.onPointClick) {
        const onPointClick = (e: MapLayerMouseEvent) => {
            const hit = e.features?.[0];
            if (!hit) return;
            handlers.onPointClick!(hit, e.lngLat);
        };
        map.on("click", ids.unclusteredLayerId, onPointClick);
        map.on("click", ids.unclusteredIconsLayerId, onPointClick);
        trackMapCleanup(map, () => {
            map.off("click", ids.unclusteredLayerId, onPointClick);
            map.off("click", ids.unclusteredIconsLayerId, onPointClick);
        });
    }

    // Click on cluster → expansion zoom
    if (handlers.onClusterClick) {
        const onClusterClick = (e: MapLayerMouseEvent) => {
            const hit = e.features?.[0];
            if (!hit) return;
            handlers.onClusterClick!(hit, e.lngLat);
        };
        map.on("click", ids.clustersLayerId, onClusterClick);
        trackMapCleanup(map, () => map.off("click", ids.clustersLayerId, onClusterClick));
    }

    // Cursor pointer on hover — unclustered points, their icons, and clusters.
    const setPointer = () => {
        map.getCanvas().style.cursor = "pointer";
    };
    const clearPointer = () => {
        map.getCanvas().style.cursor = "";
    };
    const hoverLayerIds = [
        ids.unclusteredLayerId,
        ids.unclusteredIconsLayerId,
        ids.clustersLayerId,
    ];
    for (const layerId of hoverLayerIds) {
        map.on("mouseenter", layerId, setPointer);
        map.on("mouseleave", layerId, clearPointer);
    }
    trackMapCleanup(map, () => {
        for (const layerId of hoverLayerIds) {
            map.off("mouseenter", layerId, setPointer);
            map.off("mouseleave", layerId, clearPointer);
        }
    });
}

/**
 * Returns the expansion zoom level for a cluster.
 *
 * @param map - Native MapLibre map instance.
 * @param id - Cluster group identifier.
 * @param clusterId - The `cluster_id` property from the clicked feature.
 * @returns Promise resolving to the zoom level.
 */
export function getClusterExpansionZoom(
    map: MaplibreMap,
    id: string,
    clusterId: number
): Promise<number> {
    const sourceId = toClusterSourceId(id);
    // `getSource` yields the `Source` union; the clustered GeoJSON source exposes
    // `getClusterExpansionZoom` — narrow through `unknown` to the structural view.
    const source = map.getSource(sourceId) as unknown as ClusterSourceLike;
    return source.getClusterExpansionZoom(clusterId);
}
