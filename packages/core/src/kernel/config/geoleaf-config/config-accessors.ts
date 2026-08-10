/*!
 * GeoLeaf Core – Config / Accessors
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import { Log } from "../../../utils/log/index.js";
import { Config } from "./config-core.js";
import { resolveModuleConfig } from "./module-config.js";
import { ConfigStore } from "../storage.js";
import { ProfileManager } from "../profile.js";
import type { GeoLeafConfig } from "./config-types.js";

// No local interface, no cast: `Config` is already typed as the complete `ConfigFacade`
// (config-types.ts), which declares the members this module grafts. Adding one here means
// declaring it there first — that is the point.
const C = Config;

C.getAll = function (): GeoLeafConfig {
    if (!this._isLoaded) {
        this._initSubModules();
    }
    const Storage = ConfigStore;
    return (Storage?.getAll ? Storage.getAll() : this._config) as GeoLeafConfig;
};

C.get = function <T = unknown>(path: string, defaultValue?: T): T {
    if (!this._isLoaded) {
        this._initSubModules();
    }
    const Storage = ConfigStore;
    const value = Storage?.get ? Storage.get(path, defaultValue) : defaultValue;
    return value as T;
};

/**
 * Reads a plugin module configuration value from the `modules.<moduleId>`
 * block (Plugin Contract v1, INV-CONFIG — the only supported form). Canonical
 * read path for plugins: e.g.
 * `GeoLeaf.Config.getModuleConfig("storage", "cache.enableProfileCache", true)`.
 */
C.getModuleConfig = function <T = unknown>(moduleId: string, key?: string, defaultValue?: T): T {
    if (!this._isLoaded) {
        this._initSubModules();
    }
    return resolveModuleConfig(ConfigStore, moduleId, key, defaultValue);
};

C.set = function (path: string, value: unknown): void {
    const Storage = ConfigStore;
    if (Storage?.set) {
        Storage.set(path, value);
    } else {
        Log.warn("[GeoLeaf.Config] Storage module unavailable for set().");
    }
};

C.getSection = function (sectionName: string, defaultValue?: unknown): unknown {
    const Storage = ConfigStore;
    return Storage?.getSection ? Storage.getSection(sectionName, defaultValue) : defaultValue;
};

C.getActiveProfileId = function (): string | null {
    const Profile = ProfileManager;
    return Profile?.getActiveProfileId ? Profile.getActiveProfileId() : null;
};

C.getActiveProfile = function (): Record<string, unknown> | null {
    const Profile = ProfileManager;
    return Profile?.getActiveProfile ? Profile.getActiveProfile() : null;
};

C.getActiveProfileMapping = function (): Record<string, unknown> | null {
    const Profile = ProfileManager;
    return Profile?.getActiveProfileMapping ? Profile.getActiveProfileMapping() : null;
};

C.isProfilePoiMappingEnabled = function (): boolean {
    const Profile = ProfileManager;
    return Profile?.isProfilePoiMappingEnabled ? Profile.isProfilePoiMappingEnabled() : true;
};

export { Config };
