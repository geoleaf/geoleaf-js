/*!
 * GeoLeaf Core – Config / Validation
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import { Log } from "../../../utils/log/index.js";
import { Config } from "./config-core.js";
import type { GeoLeafConfig, MapConfig } from "./config-types.js";

function _validateCenter(center: unknown): void {
    if (
        !Array.isArray(center) ||
        center.length !== 2 ||
        typeof center[0] !== "number" ||
        typeof center[1] !== "number"
    ) {
        throw new Error("[GeoLeaf.Config] map.center must be an array of 2 numbers [lat, lng].");
    }
}

function _validateZoom(zoom: unknown): void {
    if (typeof zoom !== "number" || zoom < 0 || zoom > 20) {
        throw new Error("[GeoLeaf.Config] map.zoom must be a number between 0 and 20.");
    }
}

function _validateInitialMaxZoom(v: unknown): void {
    if (typeof v !== "number" || v < 1 || v > 20) {
        throw new Error("[GeoLeaf.Config] map.initialMaxZoom must be a number between 1 and 20.");
    }
}

function _validateBoundsMargin(v: unknown): void {
    if (typeof v !== "number" || v < 0 || v > 1) {
        throw new Error(
            "[GeoLeaf.Config] map.boundsMargin must be a number between 0 and 1 (e.g. 0.3 = 30% margin)."
        );
    }
}

function _validateMapSection(map: MapConfig): void {
    if (map.center !== undefined) _validateCenter(map.center);
    if (map.zoom !== undefined) _validateZoom(map.zoom);
    if (map.positionFixed !== undefined) {
        if (typeof map.positionFixed !== "boolean") {
            throw new Error("[GeoLeaf.Config] map.positionFixed must be a boolean (true/false).");
        }
    }
    if (map.initialMaxZoom !== undefined) _validateInitialMaxZoom(map.initialMaxZoom);
    if (map.boundsMargin !== undefined) _validateBoundsMargin(map.boundsMargin);
}

function _validateTopLevelFields(cfg: GeoLeafConfig): void {
    if (cfg.basemaps !== undefined) {
        // `typeof null === "object"`, hence the explicit null arm — it was a separate `if`
        // throwing the exact same message.
        if (typeof cfg.basemaps !== "object" || cfg.basemaps === null)
            throw new Error("[GeoLeaf.Config] basemaps must be an object.");
    }
}

function validateConfig(cfg: GeoLeafConfig | null | undefined): void {
    if (!cfg) return;
    if (typeof cfg !== "object") return;
    if (cfg.map) _validateMapSection(cfg.map);
    _validateTopLevelFields(cfg);
    Log.debug("[GeoLeaf.Config] Structure validation successful.");
}

// No cast — see config-accessors.ts. `_validateConfig` is optional on `ConfigFacade`
// precisely because it does not exist until this module is imported for its side effect.
Config._validateConfig = validateConfig;

export { Config };
