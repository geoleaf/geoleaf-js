/*!
 * __PLUGIN_PKG__ — Public API facade
 * © 2026 Mattieu Pottier — MIT License
 *
 * Façade only: exposes the plugin's public surface (INV-FACADE). Methods are
 * thin wrappers that delegate to internal modules — no business logic here.
 * https://geoleaf.dev
 */

/**
 * Builds the object mounted on `GeoLeaf.__PLUGIN_NAMESPACE__`.
 */
export function buildPublicApi() {
    return {
        /** Plugin entry point — replace with the real public methods. */
        open(): void {
            // TODO: delegate to the plugin's internal logic.
        },
    };
}
