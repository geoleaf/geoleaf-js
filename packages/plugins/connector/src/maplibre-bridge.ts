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

import { bearer, isSameOrigin } from "@geoleaf/host-runtime";
import type { ConnectorConfig } from "./config.js";
import { TokenStore } from "./token-store.js";
import { isThenable, pullHostToken } from "./host-token.js";

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
        Record<string, unknown> | null | undefined;
    if (!adapter || typeof adapter["getNativeMap"] !== "function") return null;
    return (adapter["getNativeMap"] as () => unknown)();
}

/** Warned once per page: an engine too old for an asynchronous provider stays so. */
let _oldEngineReported = false;

/**
 * True when the engine AWAITS what `transformRequest` returns — MapLibre 5.21 and later.
 *
 * ⚠️ Before 5.21 the returned value WAS the request: a promise there breaks every same-origin
 * resource, authenticated or not. The core's peer range once admitted MapLibre 5, so the engine
 * is read, not assumed. Unreadable counts as too old.
 */
function _engineAwaitsTransform(): boolean {
    const version = (
        globalThis as { maplibregl?: { getVersion?: () => string } }
    ).maplibregl?.getVersion?.();
    const [major = 0, minor = 0] = String(version ?? "")
        .split(".")
        .map(Number);
    return major > 5 || (major === 5 && minor >= 21);
}

/**
 * The tile request carrying the HOST's token — `getToken` mode.
 *
 * Pulled at each tile, never kept. A synchronous provider answers synchronously; an asynchronous
 * one yields a promise of the request, which always resolves to one (`{ url }` without a token):
 * MapLibre's `|| { url }` fallback applies to the returned value, not to what a promise resolves
 * to.
 */
function _hostTokenRequest(
    url: string,
    getToken: NonNullable<ConnectorConfig["getToken"]>
): unknown {
    const pulled = pullHostToken(getToken);
    if (!isThenable(pulled)) {
        return pulled ? { url, headers: { Authorization: bearer(pulled) } } : undefined;
    }
    if (!_engineAwaitsTransform()) {
        if (!_oldEngineReported) {
            _oldEngineReported = true;
            console.warn(
                "[GeoLeaf Connector] An asynchronous getToken cannot reach the tiles on this " +
                    "MapLibre version (5.21 or later awaits them): tiles go without a token."
            );
        }
        return undefined;
    }
    return pulled.then((token) =>
        token ? { url, headers: { Authorization: bearer(token) } } : { url }
    );
}

/**
 * Applies map.setTransformRequest() with the token injection callback.
 * Returns true on success, false if m is not a valid MapLibre instance.
 *
 * - `auth.endpoint` mode: TokenStore.getTokenSync() (RAM cache only), with a non-blocking
 *   getTokenAsync() to keep that cache warm and renew it before expiry.
 * - `getToken` mode: the host's token, pulled at each tile — see {@link _hostTokenRequest}. The
 *   store is not read: in this mode the host never fills it.
 */
function _install(m: unknown, config: ConnectorConfig): boolean {
    if (!_isMaplibreMap(m)) return false;

    m.setTransformRequest((url: string) => {
        // Same origin guard shared with the fetch/worker paths — NOT startsWith,
        // which leaked the bearer to a suffix host (bug no. 4). See isSameOrigin.
        if (!isSameOrigin(url, config.baseUrl)) return undefined;

        if (config.getToken) return _hostTokenRequest(url, config.getToken);

        const token = TokenStore.getTokenSync(config.baseUrl);

        // Non-blocking proactive refresh — updates RAM cache before expiry.
        // The return value is discarded; a refusal is handled where the session is decided.
        TokenStore.getTokenAsync(config.baseUrl).catch(() => {});

        if (!token) return undefined;
        return { url, headers: { Authorization: bearer(token) } };
    });

    return true;
}

// ─── Re-install on the events that hand a map over ──────────────────────────

/** The configuration the hook is installed with — the one of the latest `configure()`. */
let _bridgeConfig: ConnectorConfig | null = null;

/**
 * A map became ready: put the hook on it.
 *
 * It covers `configure()` called before the map exists, AND every map that comes after: an
 * application unmounted and mounted again (`GeoLeaf.mount()`) has a NEW engine map, and the
 * hook of the previous one went with it. The listener was one-shot, and was not even attached
 * when `configure()` found a map: the connector stayed configured, `window.fetch` kept its
 * token, and the tiles of the second map left without one until a basemap switch happened to
 * put the hook back.
 */
function _onMapReady(): void {
    if (_bridgeConfig) _install(_resolveNativeMap(), _bridgeConfig);
}

/**
 * The active basemap changed: put the hook back.
 *
 * Defensive: `map.setStyle()` replaces the tile pipeline but not the hook; this is a safety net
 * for a provider switch that would clear it. Uses `detail.map` (the native map, set by the
 * core's basemap registry) as a fast path, and falls back to
 * `GeoLeaf.Core.getMap().getNativeMap()`.
 */
function _onBasemapChange(e: Event): void {
    if (!_bridgeConfig) return;
    const detail = (e as CustomEvent).detail as Record<string, unknown> | undefined;
    // Fast path: detail.map is the native map instance from the registry event
    const mapFromDetail = detail?.["map"];
    const m = _isMaplibreMap(mapFromDetail) ? mapFromDetail : _resolveNativeMap();
    _install(m, _bridgeConfig);
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Installs the MapLibre transformRequest hook to inject Authorization headers
 * into MVT and PMTiles tile requests.
 *
 * Installed at once when a map exists, and on every map that becomes ready afterwards —
 * `configure()` called before the boot, and an application mounted again on a new map, are the
 * same case. A basemap switch re-installs it too.
 *
 * The two listeners stay for the life of the page and read the configuration of the LATEST
 * call when they fire: a second `configure()` replaces what they install. They are the same two
 * functions at every call, so the document holds each once however many times this runs.
 *
 * @param config - Connector configuration (baseUrl used for URL matching)
 */
export function installMapLibreBridge(config: ConnectorConfig): void {
    _bridgeConfig = config;
    _install(_resolveNativeMap(), config);
    if (typeof document === "undefined") return;
    document.addEventListener("geoleaf:map:ready", _onMapReady);
    document.addEventListener("geoleaf:basemap:change", _onBasemapChange);
}
