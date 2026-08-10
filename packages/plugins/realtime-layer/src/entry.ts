/*!
 * GeoLeaf Realtime Layer Plugin — Entry Point
 * Mounts GeoLeaf.RealtimeLayer on the global GeoLeaf namespace and registers the plugin.
 * ESM only — no UMD, no CommonJS.
 *
 * Boot order: this script must be loaded AFTER @geoleaf-plugins/websocket (if using
 * WebSocket sources) and BEFORE GeoLeaf.boot().
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import { buildPublicApi } from "./public-api.js";
import { bootFromProfile } from "./realtime-runtime.js";
import type { GeoLeafHost } from "@geoleaf/host-runtime";

// Re-export extension points for plugin consumers (e.g. @geoleaf-plugins/realtime-positions)
export type { IDecoder, DecodedUpdate } from "./decoders/i-decoder.js";
export type { IRealtimeSource } from "./sources/i-realtime-source.js";
export type { StaleActionHandler } from "./stale-tracking.js";

// ─── GeoLeaf global type augmentation ─────────────────────────────────────────

const _g = globalThis as {
    GeoLeaf?: GeoLeafHost;
};

// ─── Mount GeoLeaf.RealtimeLayer ──────────────────────────────────────────────

if (_g.GeoLeaf) {
    _g.GeoLeaf.RealtimeLayer = buildPublicApi();
}

// ─── Register plugin ──────────────────────────────────────────────────────────

if (_g.GeoLeaf?.plugins?.register) {
    _g.GeoLeaf.plugins.register("realtime-layer", {
        version: "__GEOLEAF_VERSION__",
        requires: [], // only @geoleaf/core
        optional: ["websocket"], // required only for source: "websocket" layers
        label: "GeoLeaf Realtime Layer",
        healthCheck: () => !!_g.GeoLeaf?.RealtimeLayer,
    });
}

// ─── Auto-boot: scan layers with data.realtime.enabled: true ─────────────────
//
// "geoleaf:app:ready" is dispatched from app/init.ts revealApp() in boot phase 11.

document.addEventListener("geoleaf:app:ready", () => {
    bootFromProfile();
});
