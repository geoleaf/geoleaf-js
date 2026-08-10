/*!
 * GeoLeaf Core - Core (facade public)
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

"use strict";
/**
 * @description Facade public of the module Core.
 * Exposes {@link Core} comprising the low-level map functions:
 * `init` (MapLibre map creation), `setTheme`, `getTheme`,
 * `getMapInstance`, `destroy` and internal map utilities.
 *
 * @see {@link ../kernel/map/facade.ts} for the full implementation
 *
 * @example
 * ```ts
 * const map = GeoLeaf.Core.init({ mapId: "map", center: [45.76, 4.83], zoom: 13 });
 * GeoLeaf.Core.setTheme("dark");
 * ```
 */
export { Core } from "../kernel/map/facade.js";
