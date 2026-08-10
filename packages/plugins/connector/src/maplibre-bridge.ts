/*!
 * GeoLeaf Connector — MapLibre Bridge
 * Installs map.setTransformRequest() to inject Authorization headers for
 * MVT and PMTiles tile requests. Uses TokenStore RAM cache (sync-only path).
 *
 * Resolution strategy:
 * 1. Immediate install when configure() is called after geoleaf:map:ready.
 * 2. Deferred via geoleaf:map:ready listener when map is not yet available.
 * 3. Re-install on geoleaf:basemap:change (defensive safety net for setStyle).
 *
 * Map access: globalThis.GeoLeaf.Core.getMap().getNativeMap()
 * No imports from @geoleaf/core — rule no-plugin-in-core applies in reverse.
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import type { ConnectorConfig } from "./config.js";
import { TokenStore } from "./token-store.js";

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Duck-type guard: accepts any object that has setTransformRequest(). */
function _isMaplibreMap(
    m: unknown
): m is { setTransformRequest: (fn: (url: string) => unknown) => void } {
    return m != null && typeof (m as Record<string, unknown>)["setTransformRequest"] === "function";
}

/**
 * Resolves the native maplibregl.Map via globalThis.GeoLeaf.Core.getMap().getNativeMap().
 * Returns null if not available yet.
 * No @geoleaf/core import — access through the global namespace only.
 */
function _resolveNativeMap(): unknown {
    const g = globalThis as Record<string, unknown>;
    const GeoLeaf = g["GeoLeaf"] as Record<string, unknown> | undefined;
    if (!GeoLeaf) return null;
    const Core = GeoLeaf["Core"] as Record<string, unknown> | undefined;
    if (!Core || typeof Core["getMap"] !== "function") return null;
    const adapter = (Core["getMap"] as () => unknown)() as
        | Record<string, unknown>
        | null
        | undefined;
    if (!adapter || typeof adapter["getNativeMap"] !== "function") return null;
    return (adapter["getNativeMap"] as () => unknown)();
}

/**
 * Applies map.setTransformRequest() with the token injection callback.
 * Returns true on success, false if m is not a valid MapLibre instance.
 *
 * The callback uses TokenStore.getTokenSync() (RAM cache only) because
 * transformRequest is synchronous in MapLibre GL JS.
 * getTokenAsync() is called non-blocking to keep the RAM cache warm.
 */
function _install(m: unknown, config: ConnectorConfig): boolean {
    if (!_isMaplibreMap(m)) return false;

    m.setTransformRequest((url: string) => {
        if (!url.startsWith(config.baseUrl)) return undefined;

        const token = TokenStore.getTokenSync(config.baseUrl);

        // Non-blocking proactive refresh — updates RAM cache before expiry.
        // The return value is discarded; connector:auth-error is emitted on failure.
        TokenStore.getTokenAsync(config.baseUrl).catch(() => {});

        if (!token) return undefined;
        return { url, headers: { Authorization: `Bearer ${token}` } };
    });

    return true;
}

// ─── Basemap change listener ──────────────────────────────────────────────────

/**
 * Re-installs setTransformRequest whenever the active basemap changes.
 * Defensive measure: map.setStyle() replaces the tile pipeline but not the
 * transformRequest hook in MapLibre GL JS 5.x. This listener is a safety net
 * for edge cases where the hook might be cleared by a basemap provider switch.
 *
 * Uses detail.map from the geoleaf:basemap:change event (populated by
 * registry._dispatchBasemapChange, line 281) as a fast path. Falls back to
 * globalThis.GeoLeaf.Core.getMap().getNativeMap() when detail.map is absent.
 */
function _registerBasemapChangeListener(config: ConnectorConfig): void {
    if (typeof document === "undefined") return;

    document.addEventListener("geoleaf:basemap:change", (e: Event) => {
        const detail = (e as CustomEvent).detail as Record<string, unknown> | undefined;
        // Fast path: detail.map is the native map instance from the registry event
        const mapFromDetail = detail?.["map"];
        const m = _isMaplibreMap(mapFromDetail) ? mapFromDetail : _resolveNativeMap();
        _install(m, config);
    });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Installs the MapLibre transformRequest hook to inject Authorization headers
 * into MVT and PMTiles tile requests.
 *
 * Handles two timing scenarios:
 * - Scenario A: configure() called AFTER geoleaf:map:ready → immediate install.
 * - Scenario B: configure() called BEFORE geoleaf:map:ready → deferred install
 *   via a one-shot document event listener.
 *
 * In both cases, a geoleaf:basemap:change listener is registered to re-install
 * the hook on basemap switches.
 *
 * @param config - Connector configuration (baseUrl used for URL matching)
 */
export function installMapLibreBridge(config: ConnectorConfig): void {
    // Scenario A: map already available (configure() called post-init)
    const map = _resolveNativeMap();
    if (_install(map, config)) {
        _registerBasemapChangeListener(config);
        return;
    }

    // Scenario B: map not ready yet (common case — configure() called during boot)
    if (typeof document !== "undefined") {
        document.addEventListener(
            "geoleaf:map:ready",
            () => {
                _install(_resolveNativeMap(), config);
                _registerBasemapChangeListener(config);
            },
            { once: true }
        );
    }
}
