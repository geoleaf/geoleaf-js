/*!
 * @geoleaf-plugins/geocoding — Public API facade
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 *
 * Façade only: exposes the plugin's public surface (INV-FACADE). Methods are
 * thin wrappers that delegate to the registry — no business logic here.
 *
 * Mounted on `GeoLeaf.Geocoding` by `entry.ts`.
 *
 * @example
 * // Programmatic search (no UI required)
 * const results = await GeoLeaf.Geocoding.search("Bordeaux");
 * if (results.length) GeoLeaf.Geocoding.selectResult(results[0]);
 *
 * @example
 * // Listen for user selections
 * document.addEventListener("geoleaf:geocoding:result", (e) => {
 *   const { label, lat, lng } = (e as CustomEvent).detail;
 *   console.log("Selected:", label, lat, lng);
 * });
 */

import { GeocodingRegistry } from "./registry.js";
import type { GeocodingResult } from "./types.js";

/**
 * Builds the object mounted on `GeoLeaf.Geocoding`.
 */
export function buildPublicApi() {
    return {
        /**
         * Returns `true` when `modules.geocoding.enabled` is set in the active profile.
         */
        isEnabled: (): boolean => GeocodingRegistry.isEnabled(),

        /**
         * Programmatically performs an address search.
         * Does not require the UI control to be visible.
         *
         * @param query - Address or place name to search (e.g. "Paris", "10 rue de Rivoli").
         * @param limit - Maximum number of results to return. Default 5.
         * @returns Promise resolving to an array of `GeocodingResult`.
         */
        search: (query: string, limit?: number): Promise<GeocodingResult[]> =>
            GeocodingRegistry.search(query, limit),

        /**
         * Programmatically selects a geocoding result.
         * Flies the map to the result location and dispatches `geoleaf:geocoding:result`.
         *
         * @param result - A `GeocodingResult` obtained from `.search()`.
         */
        selectResult: (result: GeocodingResult): void => GeocodingRegistry.selectResult(result),

        /**
         * Toggles the floating address pill on mobile and focuses the input.
         * Invoked by the toolbar geocoding button (action `"geocoding"`).
         *
         * @param button - Optional toolbar button to sync active state with.
         */
        open: (button?: HTMLElement | null): void => GeocodingRegistry.open(button),

        /**
         * Unmounts the geocoding control and releases all DOM listeners.
         */
        destroy: (): void => GeocodingRegistry.destroy(),
    };
}
