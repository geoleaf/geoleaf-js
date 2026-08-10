/*!
 * GeoLeaf Core – Config / Loaders
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import { Log } from "../../../utils/log/index.js";
import { Config } from "./config-core.js";
import { ConfigLoader } from "../loader.js";
import { ProfileManager } from "../profile.js";
import type { GeoLeafConfig, LoadUrlOptions } from "./config-types.js";

// No local interface, no cast — see config-accessors.ts.
const C = Config;

C.loadUrl = function (url: string, options: LoadUrlOptions = {}): Promise<GeoLeafConfig> {
    const Loader = ConfigLoader;
    if (!Loader) {
        Log.error("[GeoLeaf.Config] Loader module not available.");
        return Promise.reject(new Error("Loader module not available"));
    }
    return Loader.loadUrl(url, options)
        .then((jsonCfg) => {
            this._applyConfig(jsonCfg as Record<string, unknown>, "url");
            this._maybeFireLoadedEvent();
            return this._config;
        })
        .catch((err) => {
            Log.error("[GeoLeaf.Config] Error loading config:", err);
            return this._config;
        });
};

C.loadActiveProfileResources = function (
    options: { headers?: Record<string, string>; strictContentType?: boolean } = {}
): Promise<GeoLeafConfig> {
    const Profile = ProfileManager;
    if (!Profile) {
        Log.error("[GeoLeaf.Config] Profile module not available.");
        return Promise.reject(new Error("Profile module not available"));
    }
    return Profile.loadActiveProfileResources(options);
};

export { Config };
