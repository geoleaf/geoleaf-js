/*!
 * __PLUGIN_PKG__ — Public API facade
 * © 2026 Mattieu Pottier — MIT License
 *
 * Façade only: exposes the plugin's public surface (INV-FACADE). Methods are
 * thin wrappers that delegate to internal modules — no business logic here.
 * https://geoleaf.dev
 */

import { open__PLUGIN_NAMESPACE__ } from "./__PLUGIN_NAME__-api.js";

/**
 * Builds the object mounted on `GeoLeaf.__PLUGIN_NAMESPACE__`.
 */
export function buildPublicApi() {
    return {
        /**
         * Opens the plugin — the scaffold's one method; add the real public surface beside it.
         *
         * @returns `false` when the profile switched the plugin off, `true` once it is open.
         */
        open(): boolean {
            return open__PLUGIN_NAMESPACE__();
        },
    };
}
