/*!
 * GeoLeaf Core – Permalink (public facade)
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Public facade for URL Permalink / Deep Linking (S13 in-core capability).
 *
 * Exposes {@link Permalink} as `GeoLeaf.Permalink.*` and as a named ESM export.
 * Opt-out — active unless disabled. Activation / config via a profile:
 * ```json
 * { "modules": { "permalink": { "enabled": true, "mode": "hash" } } }
 * ```
 *
 * @see {@link ../capabilities/permalink/public-api.ts} for the full implementation
 *
 * @example
 * ```ts
 * if (GeoLeaf.Permalink.isEnabled()) {
 *   const fragment = GeoLeaf.Permalink.buildUrl(); // current state as a URL fragment
 * }
 * ```
 */
export { Permalink } from "../capabilities/permalink/public-api.js";
