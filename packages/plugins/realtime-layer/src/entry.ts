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
import { bootFromProfile, stopAll } from "./realtime-runtime.js";
import { registerPluginModule, type GeoLeafHost } from "@geoleaf/host-runtime";

// Re-export extension points for plugin consumers (e.g. @geoleaf-plugins/realtime-positions)
export type { IDecoder, DecodedUpdate } from "./decoders/i-decoder.js";
export type { IRealtimeSource } from "./sources/i-realtime-source.js";
export type { StaleActionHandler } from "./stale-tracking.js";

// ─── GeoLeaf global type augmentation ─────────────────────────────────────────

const _g = globalThis as {
    GeoLeaf?: GeoLeafHost;
};

// ─── Mount GeoLeaf.RealtimeLayer ──────────────────────────────────────────────

/** The API this plugin mounts as `GeoLeaf.RealtimeLayer`. */
export type RealtimeLayerApi = ReturnType<typeof buildPublicApi>;

// The core declares `GeoLeaf.RealtimeLayer` and cannot type it: it never imports a plugin. The type
// comes from here, through the registry the core reads — for whoever installs this package.
declare global {
    interface GeoLeafPluginApis {
        RealtimeLayer: RealtimeLayerApi;
    }
}

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

// ─── Unmount: stop every source with the application ──────────────────────────
//
// `GeoLeaf.mount()`'s unmount tears the core's module registry down: this module is how the
// plugin hears it. Without it the sources kept polling after `unmount()` — for layers that no
// longer existed — and the auto-boot below started a second set at the next mount. `init()` has
// nothing to do: the sources start on `geoleaf:app:ready`, below.
//
// 🛑 ON BOTH LOADING PATHS. The module used to be registered only before the first boot, so a
// host loading this plugin on demand got neither: measured, the feed still polled after the
// unmount, and twice as often after the next mount. `registerPluginModule` tells the two paths
// apart (`@geoleaf/host-runtime`); a module registered late is torn down by a core ≥ 3.14.2.
registerPluginModule({ id: "realtime-layer", destroy: () => stopAll() });

// ─── Auto-boot: scan layers with data.realtime.enabled: true ─────────────────
//
// "geoleaf:app:ready" is dispatched from app/init.ts revealApp() in boot phase 11.

document.addEventListener("geoleaf:app:ready", () => {
    bootFromProfile();
});
