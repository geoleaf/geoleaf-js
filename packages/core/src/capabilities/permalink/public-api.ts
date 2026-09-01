/*!
 * GeoLeaf Core – Permalink / Deep Linking — Internal Facade
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 *
 * @description
 * Stateful public facade for the Permalink capability (bound to `GeoLeaf.Permalink`).
 *
 * Wraps the stateless functions from `permalink-sync.ts` with a module-level
 * config and stored-state slot, matching the lifecycle used by all GeoLeaf modules:
 *   1. `init(config)`         — called once by initApp before map creation.
 *   2. `readAndStore()`       — parses the current URL; result cached in `_storedState`.
 *   3. `applyStoredState(map)` — restores the view after map + modules are ready.
 *   4. `startSync(map)`       — begins continuous URL synchronisation.
 *
 * Additional helpers:
 *   - `getState()` — returns the last captured / restored state (read-only snapshot).
 *   - `buildUrl(state?)` — serialises a state object (or the current stored state).
 *   - `reset()` — clears config and stored state (used by tests).
 *
 * @see permalink-sync for the underlying stateless logic
 * @see geoleaf.permalink for the public GeoLeaf.Permalink facade
 */

import {
    readUrl,
    buildUrl as _buildUrl,
    applyState,
    startSync as _startSync,
} from "./permalink-sync.js";
import { getPermalinkConfig } from "./config.js";
import type { PermalinkConfig } from "../../kernel/config/geoleaf-config/config-types.js";
import type { PermalinkState } from "./permalink-sync.js";
import type { IMapAdapter } from "../../contracts/map-adapter.contract.js";

let _config: PermalinkConfig = {};
let _storedState: PermalinkState | null = null;
/** Teardown for the active sync session (map + document listeners), or null when idle. */
let _stopSync: (() => void) | null = null;

/**
 * Public Permalink facade — bound to `GeoLeaf.Permalink`.
 */
export const Permalink = {
    /**
     * Initialise the Permalink module with the config extracted from the active profile.
     * Must be called before `readAndStore()`.
     *
     * @param config - Permalink section of `ui.permalink` or an empty object.
     *
     * @example
     * ```js
     * GeoLeaf.Permalink.init({ enabled: true, mode: "hash" });
     * ```
     */
    init(config: PermalinkConfig): void {
        _config = config ?? {};
    },

    /**
     * Read the current URL and cache the parsed state.
     * Call this **before** map creation so the stored state is available for `applyStoredState`.
     */
    readAndStore(): void {
        _storedState = readUrl(_config);
    },

    /**
     * Apply the stored state (from `readAndStore`) to the given map instance.
     * Must be called **after** the map and all modules are initialised.
     *
     * @param map - MapLibre map adapter instance.
     */
    applyStoredState(map: IMapAdapter): void {
        if (_storedState) {
            applyState(_storedState, map);
        }
    },

    /**
     * Begin continuous URL synchronisation on map move/zoom events.
     * Call this **after** `applyStoredState` to avoid overwriting the restored state.
     *
     * @param map - MapLibre map adapter instance.
     */
    startSync(map: IMapAdapter): void {
        // Idempotent: tear down any previous session first so a re-init (SPA / new map)
        // never leaves the old map + document listeners attached.
        if (_stopSync) _stopSync();
        _stopSync = _startSync(map, _config);
    },

    /**
     * Stop URL synchronisation started by {@link Permalink.startSync}, removing every
     * listener it attached (map `moveend` + the three `document` listeners). Safe to call
     * when no sync is active.
     */
    stopSync(): void {
        if (_stopSync) {
            _stopSync();
            _stopSync = null;
        }
    },

    /**
     * Return the currently cached permalink state (read-only).
     * Returns null if `readAndStore` was not called or found no permalink in the URL.
     *
     * ⚠️ A `null` therefore means two different things — the page was not opened through a
     * permalink, or {@link Permalink.readAndStore} has not run yet. Only the boot order tells
     * them apart.
     *
     * @example
     * ```js
     * const state = GeoLeaf.Permalink.getState();
     * // → { lat: 48.857, lng: 2.347, zoom: 13, layers: [], filter: "café" }
     * // → null
     * ```
     */
    getState(): PermalinkState | null {
        return _storedState;
    },

    /**
     * Serialise `state` (or the cached stored state) to a URL fragment / query string.
     *
     * @param state - Optional explicit state. Falls back to `_storedState`.
     * @returns URL string starting with `#` or `?`, or empty string if no state.
     *
     * @example
     * ```js
     * // Current stored state
     * const url = GeoLeaf.Permalink.buildUrl();
     * // → "#gl_lat=48.857445&gl_lng=2.347211&gl_zoom=13"
     * ```
     *
     * @example
     * ```js
     * // A complete shareable link — the fragment alone is not enough.
     * const permalinkUrl =
     *     window.location.origin + window.location.pathname + GeoLeaf.Permalink.buildUrl();
     * ```
     */
    buildUrl(state?: PermalinkState | null): string {
        return _buildUrl(state ?? _storedState, _config);
    },

    /** Returns `true` when permalink is enabled (`modules.permalink.enabled !== false`). */
    isEnabled(): boolean {
        return getPermalinkConfig().enabled !== false;
    },

    /** Returns the resolved `modules.permalink` config (merged over the built-in defaults). */
    getConfig(): PermalinkConfig {
        return getPermalinkConfig();
    },

    /**
     * Reset internal state.
     * Intended for use in test environments only.
     * @internal
     */
    _reset(): void {
        if (_stopSync) {
            _stopSync();
            _stopSync = null;
        }
        _config = {};
        _storedState = null;
    },
};
