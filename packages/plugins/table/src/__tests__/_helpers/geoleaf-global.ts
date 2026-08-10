/**
 * @geoleaf-plugins/table — test helper
 *
 * Drives the `globalThis.GeoLeaf` runtime seams the table plugin reads at call
 * time (GeoJSON / visibility / Config / Core). Replaces the core suite's
 * `__tests__/config/_helpers/config-harness.js`: the plugin must not depend on
 * core test fixtures (Plugin Contract v1 isolation, INV-CONFIG).
 *
 * The plugin reads its config exclusively under the `modules.table` namespace
 * via `GeoLeaf.Config.get("modules.table", …)` (core read `Config.get("tableConfig")`).
 */

/** Live view of the runtime host — the same object the plugin modules read. */
export const g = globalThis as unknown as { GeoLeaf: Record<string, unknown> };

/** Resets the `GeoLeaf` namespace to a bare object. Call in `beforeEach`. */
export function resetGeoLeaf(): void {
    g.GeoLeaf = {};
}

/**
 * Wires `GeoLeaf.Config.get` to return `cfg` for the `modules.table` key
 * (the only config seam the plugin reads). Any other key returns the default.
 */
export function setTableConfig(cfg: unknown): void {
    g.GeoLeaf.Config = {
        get: (k: string, d?: unknown) => (k === "modules.table" ? cfg : d),
    };
}

/**
 * Installs the `GeoLeaf.GeoJSON` accessor surface.
 * Shape (TableGeoJSONApi): `getLayerData(id)`, `getLayerById(id)`, `getAllLayers()`.
 */
export function setGeoJSON(api: unknown): void {
    g.GeoLeaf.GeoJSON = api;
}

/**
 * Installs the `GeoLeaf._LayerVisibilityManager` surface.
 * Shape (TableVisibilityManager): `getVisibilityState(id) -> { current?: boolean }`.
 */
export function setVisibility(mgr: unknown): void {
    g.GeoLeaf._LayerVisibilityManager = mgr;
}

/** Merges extra members (Core, I18n, Log, plugins, registry…) into the namespace. */
export function setGeoLeaf(members: Record<string, unknown>): void {
    Object.assign(g.GeoLeaf, members);
}
