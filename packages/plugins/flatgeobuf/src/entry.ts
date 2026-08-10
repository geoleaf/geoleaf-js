/*!
 * GeoLeaf FlatGeobuf Plugin — Entry Point
 * Mounts GeoLeaf.FlatGeobuf on the global GeoLeaf namespace and registers the plugin.
 * ESM only — no UMD, no CommonJS.
 *
 * Boot order: this script must be loaded AFTER @geoleaf/core and BEFORE GeoLeaf.boot().
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import { load, loadBbox, loadAsLayer, loadBboxAsLayer } from "./public-api.js";
import { loadLayerFromConfig } from "./config-loader.js";
import type { FgbLayerJsonConfig } from "./config-loader.js";
import type { GeoLeafHost } from "@geoleaf/host-runtime";

// Re-export types for plugin consumers
export type {
    FgbBbox,
    FgbLoadOptions,
    FgbBboxOptions,
    FgbLayerOptions,
    FgbLoadResult,
} from "./types.js";
export type { FgbLayerJsonConfig } from "./config-loader.js";

// ─── GeoLeaf global type augmentation ─────────────────────────────────────────

const _g = globalThis as {
    GeoLeaf?: GeoLeafHost;
};

// ─── Build public API object ──────────────────────────────────────────────────

function buildPublicApi() {
    return {
        load,
        loadBbox,
        loadAsLayer,
        loadBboxAsLayer,
        loadLayerFromConfig,
    };
}

// ─── Mount GeoLeaf.FlatGeobuf ─────────────────────────────────────────────────

if (_g.GeoLeaf) {
    _g.GeoLeaf.FlatGeobuf = buildPublicApi();
}

// ─── Register plugin ──────────────────────────────────────────────────────────

if (_g.GeoLeaf?.plugins?.register) {
    _g.GeoLeaf.plugins.register("flatgeobuf", {
        version: "__GEOLEAF_VERSION__",
        requires: [],
        optional: [],
        label: "FlatGeobuf (spatial binary vector)",
        healthCheck: () => typeof _g.GeoLeaf?.FlatGeobuf === "object",
    });
}

// ─── Register declarative layer loader ────────────────────────────────────────
// Lets the core profile loader render `"plugin": "flatgeobuf"` layers declared in
// a profile config (no imperative code), via GeoLeaf.plugins.getLayerLoader.
if (_g.GeoLeaf?.plugins?.registerLayerLoader) {
    _g.GeoLeaf.plugins.registerLayerLoader("flatgeobuf", (def) =>
        loadLayerFromConfig(def as unknown as FgbLayerJsonConfig)
    );
}
