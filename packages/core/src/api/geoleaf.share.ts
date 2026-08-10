/*!
 * GeoLeaf Core – Share (public facade)
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Public facade for the Share / view-permalink subsystem (§A.7).
 *
 * Exposes {@link Share} as `GeoLeaf.Share.*` and as a named ESM export.
 *
 * Activation: the share button is shown by default (opt-out). Hide it via the
 * active profile:
 * ```json
 * { "modules": { "permalink": { "share": { "enabled": false } } } }
 * ```
 *
 * @see {@link ../capabilities/permalink/share/public-api.ts} for the full implementation
 *
 * @example
 * ```ts
 * GeoLeaf.Share.openShareDialog();
 * const url = GeoLeaf.Share.getShareUrl();
 * ```
 */
export { Share } from "../capabilities/permalink/share/public-api.js";
