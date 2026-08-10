/*!
 * GeoLeaf Core - Validators (facade public)
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

"use strict";
/**
 * @description Facade public of the module Validators.
 * Exposes {@link Validators} grouping: `validateUrl`, `validateCoordinates`,
 * `validateEmail`, `validateGeoJSON`, `validateColor`, `validateBatch`
 * and the style validation utilities.
 *
 * @see {@link ./utils/validators/index.ts} for the full implementation
 *
 * @example
 * ```ts
 * const result = GeoLeaf.Validators.validateCoordinates(45.76, 4.83);
 * const urlOk = GeoLeaf.Validators.validateUrl("https://example.com");
 * ```
 */
export { Validators } from "../utils/validators/index.js";
