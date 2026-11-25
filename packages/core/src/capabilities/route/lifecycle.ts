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

import { getRouteConfig } from "./config.js";
import { applyToLayer, clearEndpoints, followVisibility } from "./apply.js";
import type { RouteMapAdapter } from "./types.js";
import { Core } from "../../api/geoleaf.core.js";
import { whenAppReady } from "../../kernel/shared/index.js";

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
/** `geoleaf:layer:toggle` — the endpoint markers follow their layer's visibility. */
function onLayerToggle(e: Event): void {
    const detail = (e as CustomEvent<{ layerId?: string; visible?: boolean }>).detail;
    if (!detail || typeof detail.layerId !== "string") return;
    const adapter = getAdapter();
    if (adapter) followVisibility(adapter, detail.layerId, detail.visible === true);
}

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
        document.addEventListener("geoleaf:layer:toggle", onLayerToggle);
        document.addEventListener("geoleaf:map:ready", sweep);
        // ⚠️ The sweep that decorates the boot's layers is THIS one. `geoleaf:map:ready` fires on
        // the engine's `load`, before the layers are loaded, and the `layer:added` path runs
        // before the layer's features reach the store. Until 3.20.6 the boot dispatched
        // `geoleaf:map:ready` a second time at the reveal, and that duplicate is what decorated
        // the layers; announced once per map since, the route lost its markers — measured, no
        // spec covered it. `geoleaf:app:ready` comes after every layer of the boot.
        whenAppReady(sweep);
    },

    /** Detaches listeners and clears derived endpoint layers (destroy / test). */
    _reset(): void {
        // `_started` resets whatever the teardown throws: left `true`, the next `init()` —
        // an application mounted again — would return at once, and this capability would
        // never come back.
        try {
            if (typeof document !== "undefined") {
                document.removeEventListener("geoleaf:layer:added", onLayerAdded);
                document.removeEventListener("geoleaf:layer:toggle", onLayerToggle);
                document.removeEventListener("geoleaf:map:ready", sweep);
                document.removeEventListener("geoleaf:app:ready", sweep);
            }
            const adapter = getAdapter();
            const registry = adapter?.getLayerRegistry?.();
            if (adapter && registry) {
                for (const layerId of registry.getAllLayerIds()) clearEndpoints(adapter, layerId);
            }
        } finally {
            _started = false;
        }
    },
};
