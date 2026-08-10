/*!
 * GeoLeaf COG Plugin — Entry Point
 * Mounts GeoLeaf.COG on the global GeoLeaf namespace and registers the plugin.
 * ESM only — no UMD, no CommonJS.
 *
 * Boot order: this script must be loaded AFTER @geoleaf/core and BEFORE GeoLeaf.boot().
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import { addLayer, getInfo, removeLayer } from "./public-api.js";

// Re-export types for plugin consumers
export type {
    CogInfo,
    CogLayerHandle,
    CogLayerOptions,
    CogLoadOptions,
    CogRasterData,
} from "./types.js";
import type { GeoLeafHost } from "@geoleaf/host-runtime";

// ─── GeoLeaf global type augmentation ─────────────────────────────────────────

const _g = globalThis as {
    GeoLeaf?: GeoLeafHost;
};

// Build-time injected by Rollup (@rollup/plugin-replace, bare value).
const _VERSION = "__GEOLEAF_VERSION__";

// ─── Build public API object ──────────────────────────────────────────────────

function buildPublicApi() {
    return {
        addLayer,
        removeLayer,
        getInfo,
    };
}

// ─── Mount GeoLeaf.COG ────────────────────────────────────────────────────────

if (_g.GeoLeaf) {
    _g.GeoLeaf.COG = buildPublicApi();
}

// ─── Register plugin ──────────────────────────────────────────────────────────

if (_g.GeoLeaf?.plugins?.register) {
    _g.GeoLeaf.plugins.register("cog", {
        version: _VERSION,
        requires: [],
        optional: [],
        label: "Cloud Optimized GeoTIFF (satellite/aerial imagery)",
        healthCheck: () => typeof _g.GeoLeaf?.COG === "object",
    });
}
