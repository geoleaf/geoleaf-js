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
};

// Self-register the teardown so Core.destroy() clears GeoJSON layers/adapter.
registerLifecycleTeardown(() => GeoJSONShared.reset());

export { GeoJSONShared };
