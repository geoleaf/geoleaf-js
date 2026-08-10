/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Route capability — lifecycle / event wiring.
 *
 * Subscribes to the core layer / map events and (re)applies endpoint markers as
 * bound polyline layers appear: `geoleaf:layer:added` fires per layer;
 * `geoleaf:map:ready` triggers a one-shot sweep so layers present before the
 * capability initialised are decorated too. Mirrors the taxonomy capability.
 *
 * The listeners are registered during the synchronous `registry.init()` (via
 * `RouteModule.init`), before the map's async `load` fires `geoleaf:map:ready`,
 * so the initial sweep is caught.
 */
"use strict";

import { getRouteConfig } from "./config.js";
import { applyToLayer, clearEndpoints } from "./apply.js";
import type { RouteMapAdapter } from "./types.js";
import { Core } from "../../api/geoleaf.core.js";

/** Detail payload of `geoleaf:layer:added` (mirrors the core contract). */
interface LayerAddedDetail {
    layerId: string;
    sourceId: string;
    geometryTypes: readonly string[];
}

/** Reads the active MapLibre adapter via the canonical `Core.getMap()`. */
function getAdapter(): RouteMapAdapter | null {
    return (Core.getMap() as unknown as RouteMapAdapter | null) ?? null;
}

/** Decorates a single layer when it is added, if bound and route is enabled. */
function onLayerAdded(e: Event): void {
    const detail = (e as CustomEvent<LayerAddedDetail>).detail;
    if (!detail || typeof detail.layerId !== "string") return;
    const layerId = detail.layerId;
    const geometryTypes = detail.geometryTypes ?? [];
    // `geoleaf:layer:added` is dispatched by the adapter *while* building the layer
    // (maplibre-layer-builders), i.e. BEFORE the loader writes the layer's features
    // into the `Layers` seam (single-layer.ts stores them right after the synchronous
    // `addGeoJSONLayer` returns). Endpoint derivation reads those features, so defer
    // to a microtask: by then the store is populated and a layer loaded AFTER boot
    // (theme switch / manual enable) gets its endpoints too — not only the boot-time
    // layers caught by the `geoleaf:map:ready` sweep.
    queueMicrotask(() => {
        const config = getRouteConfig();
        if (!config.enabled) return;
        const adapter = getAdapter();
        if (adapter) applyToLayer(adapter, config, layerId, geometryTypes);
    });
}

/** Re-applies endpoint markers across every currently-registered layer. */
function sweep(): void {
    const config = getRouteConfig();
    if (!config.enabled) return;
    const adapter = getAdapter();
    const registry = adapter?.getLayerRegistry?.();
    if (!adapter || !registry) return;
    for (const layerId of registry.getAllLayerIds()) {
        const geom = registry.getGeometryTypes(layerId);
        applyToLayer(adapter, config, layerId, geom ? Array.from(geom) : []);
    }
}

let _started = false;

/** Idempotent event wiring for the Route capability. Safe to call repeatedly. */
export const RouteLifecycle = {
    init(): void {
        if (_started || typeof document === "undefined") return;
        _started = true;
        document.addEventListener("geoleaf:layer:added", onLayerAdded);
        document.addEventListener("geoleaf:map:ready", sweep);
    },

    /** Detaches listeners and clears derived endpoint layers (destroy / test). */
    _reset(): void {
        if (typeof document !== "undefined") {
            document.removeEventListener("geoleaf:layer:added", onLayerAdded);
            document.removeEventListener("geoleaf:map:ready", sweep);
        }
        const adapter = getAdapter();
        const registry = adapter?.getLayerRegistry?.();
        if (adapter && registry) {
            for (const layerId of registry.getAllLayerIds()) clearEndpoints(adapter, layerId);
        }
        _started = false;
    },
};
