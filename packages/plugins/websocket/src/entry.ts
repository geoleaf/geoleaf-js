/*!
 * GeoLeaf WebSocket Plugin — Entry Point
 * Mounts GeoLeaf.Ws on the global GeoLeaf namespace and registers the plugin.
 * ESM only — no UMD, no CommonJS.
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import { buildPublicApi } from "./public-api.js";
import { registerTransport } from "./transports/transport-registry.js";
import type { GeoLeafHost } from "@geoleaf/host-runtime";

// Re-export registerTransport for consumers who want to add custom transports
export { registerTransport };

// The auth shapes travel with `registerTransport`: they are the CONFIG half of the same
// custom-transport contract, and `TransportConfig.auth` is typed `JwtAuth | CredentialsAuth`.
//
// ⚠️ Added 31/07/2026 — this was a CODE defect surfaced by a documentation gate, not a doc
// defect. `README.md` has taught `import type { JwtAuth } from "@geoleaf-plugins/websocket"`
// since v1.0; the entry point never re-exported it, so the import resolved to nothing at the
// consumer (TS2305). The README was right about the intent and the entry point was the copy
// that had drifted — exporting one member without its union sibling would have rebuilt the
// same trap for anyone typing an auth object.
export type { JwtAuth, CredentialsAuth } from "./transports/i-ws-transport.js";

// ─── GeoLeaf global type augmentation ─────────────────────────────────────────

const _g = globalThis as {
    GeoLeaf?: GeoLeafHost;
};

// ─── Mount GeoLeaf.Ws ─────────────────────────────────────────────────────────

if (_g.GeoLeaf) {
    _g.GeoLeaf.Ws = buildPublicApi();
}

// ─── Register plugin ──────────────────────────────────────────────────────────

if (_g.GeoLeaf?.plugins?.register) {
    _g.GeoLeaf.plugins.register("websocket", {
        version: "__GEOLEAF_VERSION__",
        requires: [], // only @geoleaf/core
        label: "WebSocket Transport",
        healthCheck: () => {
            const ws = _g.GeoLeaf?.Ws as { state?: string } | undefined;
            return ws?.state === "connected";
        },
    });
}
