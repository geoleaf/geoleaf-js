/*!
 * @geoleaf-plugins/table — Lifecycle
 * © 2026 Mattieu Pottier — MIT License
 *
 * Self-initialises the table when the map is ready. Historically the core boot
 * called `Table.init({ map })`; the plugin now owns that wiring by subscribing to
 * `geoleaf:map:ready` and reading the map adapter from `GeoLeaf.Core.getMap()`
 * (falling back to `GeoLeaf.getAllMaps()[0]`).
 *
 * `init()` builds the panel DOM and attaches the map event listeners only — the
 * highlight overlay (`addGeoJSONLayer`) is created later on user action, by which
 * point the map is fully loaded.
 * https://geoleaf.dev
 */

import { Table } from "./table-api.js";
import { tableState } from "./table-state.js";
import { getPluginConfig } from "./config.js";
import type { TableMap } from "./types.js";

/** Structural view of the runtime host used to acquire the map adapter. */
interface TableMapHost {
    GeoLeaf?: {
        Core?: { getMap?(): TableMap | null };
        getAllMaps?(): TableMap[];
    };
}

const _g: TableMapHost = (
    typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : {}
) as TableMapHost;

let _initialized = false;

/** Acquires the active map adapter from the runtime host (null when unavailable). */
function _acquireMap(): TableMap | null {
    return _g.GeoLeaf?.Core?.getMap?.() ?? _g.GeoLeaf?.getAllMaps?.()[0] ?? null;
}

/**
 * Builds the table panel on demand (lazy). Idempotent: a no-op once the panel
 * container exists. Returns true when the table is built and usable.
 */
function ensureInitialized(): boolean {
    if (tableState._container) return true;
    if (!getPluginConfig().enabled) return false;
    const map = _acquireMap();
    if (!map) return false;
    Table.init({ map });
    return !!tableState._container;
}

/**
 * On map ready, build eagerly ONLY when `defaultVisible` requests an open-at-boot
 * table (init() then calls show()). Otherwise stay lazy — the panel is built on the
 * first toolbar activation via {@link ensureInitialized}.
 */
function _onMapReady(): void {
    if (!getPluginConfig().enabled) return;
    if (!getPluginConfig().defaultVisible) return;
    ensureInitialized();
}

/**
 * Mount, refresh and teardown of the table panel.
 *
 * Separated from the rendering so the panel can be rebuilt without re-registering its seams —
 * the same split the layer manager and the legend follow.
 */
export const TableLifecycle = {
    /**
     * Subscribes to `geoleaf:map:ready` so the table mounts when the map exists.
     * Idempotent — safe to call multiple times.
     */
    init(): void {
        if (_initialized) return;
        _initialized = true;
        if (typeof document !== "undefined") {
            document.addEventListener("geoleaf:map:ready", _onMapReady);
        }
    },

    /**
     * Lazily builds the table panel (no-op if already built). Returns true when
     * the table is ready to be toggled. Called by the toolbar action handler so the
     * panel is created on the first click rather than at boot.
     */
    ensureInitialized,
};
