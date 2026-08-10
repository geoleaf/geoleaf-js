/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Route capability — pure resolution (per-layer binding + endpoint config).
 *
 * Side-effect-free: resolves a layer's binding from `modules.route.layers` and
 * the effective start / end marker styles (built-in defaults applied).
 */
"use strict";

import type {
    RouteConfig,
    RouteLayerBinding,
    ResolvedEndpointConfig,
    RouteEndpointStyle,
} from "./types.js";

/** Default start-marker style (blue). */
const DEFAULT_START: RouteEndpointStyle = {
    radius: 6,
    color: "#ffffff",
    fillColor: "#2b7cff",
    fillOpacity: 1,
    weight: 2,
};

/** Default end-marker style (orange). */
const DEFAULT_END: RouteEndpointStyle = {
    radius: 6,
    color: "#ffffff",
    fillColor: "#ff7b32",
    fillOpacity: 1,
    weight: 2,
};

/** Returns the layer's binding, or `null` when the layer is not decorated. */
export function resolveLayerBinding(
    config: RouteConfig,
    layerId: string
): RouteLayerBinding | null {
    return config.layers?.[layerId] ?? null;
}

/** Resolves the effective endpoint config for a binding (defaults applied). */
export function resolveEndpointConfig(binding: RouteLayerBinding): ResolvedEndpointConfig {
    return {
        showStart: typeof binding.showStart === "boolean" ? binding.showStart : true,
        showEnd: typeof binding.showEnd === "boolean" ? binding.showEnd : true,
        startStyle: { ...DEFAULT_START, ...(binding.start ?? {}) },
        endStyle: { ...DEFAULT_END, ...(binding.end ?? {}) },
    };
}
