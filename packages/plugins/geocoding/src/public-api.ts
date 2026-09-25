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
import { registerProvider, type GeocodingProviderFactory } from "./provider-registry.js";
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
         * Programmatically searches the configured provider(s) — addresses, and the map's own
         * features when `provider` lists `"layers"`. Does not require the UI control to be
         * visible. Never rejects: a failing provider answers nothing.
         *
         * @param query - Text to search (e.g. "Paris", "10 rue de Rivoli", a feature reference).
         * @param limit - Maximum number of results to return. Default `resultLimit`, else 5.
         * @returns Promise resolving to an array of `GeocodingResult`.
         */
        search: (query: string, limit?: number): Promise<GeocodingResult[]> =>
            GeocodingRegistry.search(query, limit),

        /**
         * Programmatically selects a result, then dispatches `geoleaf:geocoding:result`.
         * A feature found by `"layers"` is framed and selected (`GeoLeaf.Layers.focus`); any
         * other result is flown to, or fitted when it carries `bounds`.
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
         * Makes a search service available under `name`, for `modules.geocoding.provider`
         * to list. Registering an existing name replaces it; an empty name, or a factory that
         * is not a function, is refused with a `TypeError`. Since 1.1.0.
         *
         * @param name - The name a profile will use.
         * @param factory - Builds the provider from the plugin's configuration; the provider's
         *   `search(query, limit)` resolves to results shaped `{ label, lat, lng, bounds? }`,
         *   and its `network: false` lets it be asked off-network.
         * @example
         * GeoLeaf.Geocoding.registerProvider("lieux-dits", () => ({
         *     network: false,
         *     search: async (query) => myIndex.find(query),
         * }));
         */
        registerProvider: (name: string, factory: GeocodingProviderFactory): void =>
            registerProvider(name, factory),

        /**
         * Unmounts the geocoding control and releases all DOM listeners.
         */
        destroy: (): void => GeocodingRegistry.destroy(),
    };
}
