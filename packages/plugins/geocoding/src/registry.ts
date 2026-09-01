/*!
 * @geoleaf-plugins/geocoding — Registry
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 *
 * Singleton registry that manages the geocoding control lifecycle.
 *
 * Lifecycle:
 * 1. `GeocodingRegistry.init()` is called by `entry.ts` at plugin load time.
 * 2. It subscribes to `geoleaf:map:ready` to mount the DOM control when the map is available.
 * 3. When a user selects a result, the map adapter's `flyTo()` or `fitBounds()` is called,
 *    and a `geoleaf:geocoding:result` CustomEvent is dispatched on `document`.
 *
 * Config is read lazily from `modules.geocoding.*` via {@link getPluginConfig}
 * so profile hot-reload is supported without re-initialising the registry
 * (Plugin Contract v1, INV-CONFIG).
 */

import type { GeocodingConfig, GeocodingResult } from "./types.js";
import { createProvider } from "./provider.js";
import { mountGeocodingControl, type GeocodingControlHandle } from "./control.js";
import { getPluginConfig } from "./config.js";

/**
 * Minimal map-adapter surface this registry drives. Kept local (a structural
 * subset of the full `IMapAdapter`) so geocoding stays decoupled from the
 * MapLibre adapter package.
 */
interface GeocodingMapAdapter {
    fitBounds(
        bounds: { north: number; south: number; east: number; west: number },
        options?: { padding?: { x: number; y: number }; animate?: boolean }
    ): void;
    flyTo(center: { lat: number; lng: number }, zoom?: number): void;
    getContainer?(): HTMLElement | null;
}

/** Structural view of the runtime global host used by this module. */
interface GeocodingGlobalHost {
    GeoLeaf?: {
        Core?: { getMap?(): GeocodingMapAdapter | null };
        getAllMaps?(): GeocodingMapAdapter[];
    };
}

const _g: GeocodingGlobalHost = (
    typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : {}
) as GeocodingGlobalHost;

// ── Module-level state ────────────────────────────────────────────────────────

let _initialized = false;
let _control: GeocodingControlHandle | null = null;

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Reads the geocoding config from the `modules.geocoding.*` namespace.
 * Returns defaults (disabled) when config is unavailable.
 * @internal
 */
function _getConfig(): GeocodingConfig {
    try {
        return getPluginConfig();
    } catch {
        return {};
    }
}

/**
 * Dispatches `geoleaf:geocoding:result` on `document`.
 * Payload matches `GeocodingResult` minus the `raw` field.
 * @internal
 */
function _dispatchResult(result: GeocodingResult): void {
    document.dispatchEvent(
        new CustomEvent("geoleaf:geocoding:result", {
            bubbles: true,
            detail: {
                label: result.label,
                lat: result.lat,
                lng: result.lng,
                bounds: result.bounds ?? null,
            },
        })
    );
}

/**
 * Handles a user-selected result: navigates the map and dispatches the event.
 * Uses `fitBounds` when the result has a bounding box, `flyTo` otherwise.
 * @internal
 */
function _onSelect(result: GeocodingResult, flyToZoom: number): void {
    // GeoLeaf.getMap(id) requires an explicit id — use Core.getMap() instead.
    const adapter = _g.GeoLeaf?.Core?.getMap?.() ?? _g.GeoLeaf?.getAllMaps?.()[0] ?? null;
    if (adapter) {
        if (result.bounds) {
            adapter.fitBounds(
                {
                    north: result.bounds.north,
                    south: result.bounds.south,
                    east: result.bounds.east,
                    west: result.bounds.west,
                },
                { padding: { x: 40, y: 40 }, animate: true }
            );
        } else {
            adapter.flyTo({ lat: result.lat, lng: result.lng }, flyToZoom);
        }
    }
    _dispatchResult(result);
}

/**
 * Mounts the geocoding control when the map is ready.
 * Only runs when `modules.geocoding.enabled` is true.
 * @internal
 */
function _onMapReady(): void {
    const config = _getConfig();
    if (!config.enabled) return;

    // Core.getMap() holds the adapter created by the main init path.
    // GeoLeaf.getMap(id) requires an explicit id and returns null without one.
    const adapter = _g.GeoLeaf?.Core?.getMap?.() ?? _g.GeoLeaf?.getAllMaps?.()[0] ?? null;
    const container: HTMLElement | null = adapter?.getContainer?.() ?? null;
    if (!container) return;

    // Tear down any previously mounted control (e.g. after config reload)
    _control?.destroy();

    const provider = createProvider(config);
    const flyToZoom = config.flyToZoom ?? 15;

    _control = mountGeocodingControl(container, provider, config, (result) => {
        _onSelect(result, flyToZoom);
    });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Singleton Geocoding registry.
 * Exposed through the plugin facade (`public-api.ts`).
 */
export const GeocodingRegistry = {
    /**
     * Subscribes to `geoleaf:map:ready` and prepares the control.
     * Idempotent — safe to call multiple times.
     *
     * ⚠️ The subscription alone is NOT enough, and the gap was silent. Until
     * 08/08/2026 this method only added the listener: loaded after `geoleaf:map:ready` had
     * already fired, the plugin posted a listener for an event that would never come again,
     * and the search bar never mounted. No error, no warning — `isEnabled()` even returned
     * `true`, so every observable said the capability was on.
     *
     * The primary fix lives in the app (`beforeBoot` preloads this plugin when the profile
     * enables it, so the listener is in place before the map exists). This fallback closes
     * the ordering hole itself: whatever loads the plugin, and whenever, the control mounts
     * if the map is already there. A fix that lives only in the caller leaves the trap armed
     * for the next caller.
     */
    init(): void {
        if (_initialized) return;
        _initialized = true;
        document.addEventListener("geoleaf:map:ready", _onMapReady);
        // Late load — the map may already be ready, in which case the event is behind us.
        // `_onMapReady` re-reads the adapter and returns early when there is no container,
        // so calling it here is safe when the map does not exist yet.
        const adapter = _g.GeoLeaf?.Core?.getMap?.() ?? _g.GeoLeaf?.getAllMaps?.()?.[0] ?? null;
        if (adapter?.getContainer?.()) _onMapReady();
    },

    /**
     * Returns `true` when `modules.geocoding.enabled` is set in the active profile.
     */
    isEnabled(): boolean {
        return _getConfig().enabled === true;
    },

    /**
     * Programmatically performs an address search without requiring the UI control.
     * Useful for scripts or integration tests.
     *
     * @param query - Address or place name to search.
     * @param limit - Maximum number of results. Defaults to `resultLimit` or 5.
     */
    async search(query: string, limit?: number): Promise<GeocodingResult[]> {
        const trimmed = query.trim();
        if (trimmed.length === 0) return [];
        const config = _getConfig();
        const provider = createProvider(config);
        return provider.search(trimmed, limit ?? config.resultLimit ?? 5);
    },

    /**
     * Programmatically selects a result — flies the map to the location
     * and dispatches `geoleaf:geocoding:result`.
     *
     * @param result - A `GeocodingResult` obtained from `.search()`.
     */
    selectResult(result: GeocodingResult): void {
        const config = _getConfig();
        _onSelect(result, config.flyToZoom ?? 15);
    },

    /**
     * Toggles the floating pill on mobile and focuses the input when revealing.
     * Invoked by the toolbar `geoleaf:toolbar:action` handler (action `"geocoding"`).
     * No-op until the control is mounted (map ready + `enabled`).
     *
     * @param button - Optional toolbar button element to sync active state with.
     */
    open(button?: HTMLElement | null): void {
        _control?.reveal(button);
    },

    /**
     * Unmounts the geocoding control and cleans up all listeners.
     * The control can be re-mounted by calling `init()` and triggering `geoleaf:map:ready`.
     */
    destroy(): void {
        _control?.destroy();
        _control = null;
    },
};
