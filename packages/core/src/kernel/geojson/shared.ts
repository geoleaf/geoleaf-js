/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf GeoJSON Module - Shared State & Constants
 */

import { registerLifecycleTeardown } from "../shared/lifecycle.js";
import { STYLE_OPERATORS } from "./style-operators.js";
import type { GeoJSONAdapter, GeoJSONLayerEntry, GeoJSONNativeMap } from "./core-types.js";
import type { GeoJSONFeature } from "./geojson-types.js";

const _g =
    typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : {};

interface GeoLeafConstants {
    GEOJSON_MAX_ZOOM_ON_FIT?: number;
}
interface GeoLeafGlobal {
    GeoLeaf?: { CONSTANTS?: GeoLeafConstants; Log?: { warn?: (a: string, b?: unknown) => void } };
}

const defaultOptions = () => ({
    defaultStyle: {
        color: "#999999",
        weight: 2,
        opacity: 0.9,
        fillColor: "#cccccc",
        fillOpacity: 0.15,
    },
    defaultPointStyle: {
        radius: 6,
        color: "#999999",
        weight: 2,
        fillColor: "#cccccc",
        fillOpacity: 0.9,
    },
    onEachFeature: null as ((feature: unknown, layer: unknown) => void) | null,
    pointToLayer: null as ((feature: unknown, latlng: unknown) => unknown) | null,
    fitBoundsOnLoad: true,
    maxZoomOnFit: (_g as GeoLeafGlobal).GeoLeaf?.CONSTANTS?.GEOJSON_MAX_ZOOM_ON_FIT ?? 18,
});

const GeoJSONShared = {
    state: {
        map: null as GeoJSONNativeMap | null,
        layerGroup: null as unknown,
        geoJsonLayer: null as unknown,
        layers: new Map<string, GeoJSONLayerEntry>(),
        layerIdCounter: 0,
        options: defaultOptions(),
        /** IMapAdapter instance (set during init). */
        adapter: null as GeoJSONAdapter | null,
    },

    /** Comparison operators for conditional style rules — see style-operators.ts. */
    STYLE_OPERATORS,

    /** Default styles for each geometry type (polygon, line, point). */
    DEFAULT_STYLES: {
        polygon: {
            color: "#999999",
            weight: 2,
            opacity: 0.9,
            fillColor: "#cccccc",
            fillOpacity: 0.15,
        },
        line: {
            color: "#999999",
            weight: 2,
            opacity: 0.9,
            fillColor: "#cccccc",
            fillOpacity: 0.15,
        },
        point: { radius: 6, color: "#999999", weight: 2, fillColor: "#cccccc", fillOpacity: 0.9 },
    },

    reset(): void {
        const state = GeoJSONShared.state;
        state.map = null;
        state.layerGroup = null;
        state.geoJsonLayer = null;
        state.layers = new Map();
        state.layerIdCounter = 0;
        state.options = defaultOptions();
        state.adapter = null;
    },

    getLog(): typeof console | { warn?: (a: string, b?: unknown) => void } {
        return (_g as GeoLeafGlobal).GeoLeaf?.Log ?? console;
    },

    getLayers(): Map<string, GeoJSONLayerEntry> {
        return GeoJSONShared.state.layers;
    },

    getLayerById(layerId: string): GeoJSONLayerEntry | undefined {
        return GeoJSONShared.state.layers.get(layerId);
    },

    /**
     * Records, on the layer entry, the collection the map source now holds.
     *
     * 🛑 THE STORE IS THE TRUTH OF WHAT THE SOURCE CONTAINS, and this function is the
     * one place that says so. Every writer of a whole collection goes through it, so a
     * reader of `entry.features` never has to ask which of the two is ahead.
     *
     * ⚠️ **The invariant was not free before, it was merely SELF-HEALING.** A writer that
     * fed the source without recording it here left the store stale — and the next
     * `setData` re-pushed the whole store collection, so the two agreed again (the
     * store winning, the other write lost). That repair disappears the moment a
     * mutation is expressed as a DIFF: the source keeps what it was fed, the store
     * keeps what it had, and the two never re-converge. Measured case:
     * `applyOgcRefreshedData` fed the source an `autoRefresh` result straight off the
     * network, which the store never saw.
     *
     * Not exported as a free function on purpose — it belongs to the state it writes,
     * beside `getLayerById`, which is what readers of that state already reach for.
     */
    setLayerCollection(layerId: string, data: unknown): void {
        const entry = GeoJSONShared.state.layers.get(layerId);
        if (!entry) return;
        entry.geojson = data;
        const fc = data as { features?: GeoJSONFeature[] } | null | undefined;
        if (fc && Array.isArray(fc.features)) entry.features = fc.features;
    },
};

// Self-register the teardown so Core.destroy() clears GeoJSON layers/adapter.
registerLifecycleTeardown(() => GeoJSONShared.reset());

export { GeoJSONShared };
