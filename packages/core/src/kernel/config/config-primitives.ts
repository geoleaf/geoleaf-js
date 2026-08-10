/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Re-export of the public Config interface, for consumption
 * by the business modules (POI, Storage, UI, Labels, Themes…).
 *
 * Phase 10-C — Pattern B: replaces the runtime coupling with a direct ESM import of Config.
 *
 * RECOMMENDED USAGE:
 *   import { Config } from './config-primitives.js';
 *
 * DIRECT EQUIVALENT:
 *   import { Config } from './geoleaf-config/config-core.js';
 */

export { Config } from "./geoleaf-config/config-core.js";
