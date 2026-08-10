/*!
 * GeoLeaf Core - Baselayers (facade public)
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

"use strict";
/**
 * @description Facade public of the module BaseLayers.
 * Exposes {@link Baselayers} for registering, activating, and managing
 * base tile layers (raster tiles and MapLibre GL JS vector tiles).
 *
 * @see {@link ../kernel/basemaps/facade.ts} for the full implementation
 *
 * @example
 * ```ts
 * GeoLeaf.Baselayers.init({ map, activeKey: "osm" });
 * GeoLeaf.Baselayers.setBaseLayer("satellite");
 * ```
 */
export { Baselayers } from "../kernel/basemaps/facade.js";
