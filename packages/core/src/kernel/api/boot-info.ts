/*!
 * GeoLeaf Core – API / Boot Info
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Displays a startup toast listing the GeoLeaf version and the optional
 * plugins that are loaded.
 *
 * Called automatically at the end of GeoLeaf.boot() unless disabled.
 */

import { VERSION_FALLBACK } from "../../utils/constants/constants.js";
import type { BootInfoNamespace, BootInfoOptions, BootMessage } from "./api-types.ts";

/** Narrows an unknown namespace member to a readable object bag. */
function _asBag(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * Detects loaded plugins by inspecting window.GeoLeaf.
 * @param {object} GeoLeaf - The global GeoLeaf namespace
 * @returns {string[]} List of active plugin names
 */

function _detectLoadedPlugins(GeoLeaf: BootInfoNamespace): string[] {
    // Primary source: PluginRegistry (reliable, self-registered by each plugin).
    // If the registry is available, it is fully trusted — even if the list is empty (Core only).
    // Do NOT fall back to duck-typing: the Core facades (Storage, Labels, LayerManager)
    // exist even without a plugin loaded, which would skew detection.
    if (GeoLeaf.plugins?.getLoadedPlugins) {
        return GeoLeaf.plugins.getLoadedPlugins().filter((n: string) => !["core"].includes(n));
    }

    // Duck-typing fallback when the registry is unavailable (backward compat)
    const plugins: string[] = [];
    const storage = _asBag(GeoLeaf.Storage);
    if (storage) {
        const hasDB = !!_asBag(storage.DB);
        plugins.push(hasDB ? "storage (offline + IndexedDB)" : "storage (cache)");
    }
    if (GeoLeaf._LayerManagerControl || GeoLeaf._LMRenderer) {
        plugins.push("layer-manager");
    }
    const labels = _asBag(GeoLeaf.Labels);
    if (labels && typeof labels.init === "function") {
        plugins.push("labels");
    }
    return plugins;
}

/**
 * Builds the startup toast message.
 * @param {object} GeoLeaf
 * @returns {{ title: string, message: string }}
 */
function _buildBootMessage(GeoLeaf: BootInfoNamespace): BootMessage {
    const version = GeoLeaf._version ?? VERSION_FALLBACK;
    const plugins = _detectLoadedPlugins(GeoLeaf);

    // There is one class of plugin, so the toast just lists what is loaded. It used
    // to partition them on a hard-coded ["storage", "addpoi"] prefix list, which
    // omitted `cog` entirely: it mis-labelled the plugins it knew and missed the one
    // it did not. Do not reintroduce a partition here — `_detectLoadedPlugins` is the
    // single source, and every plugin it returns is equal as far as the toast cares.
    const message = plugins.length > 0 ? plugins.join(" • ") : "open source";

    return {
        title: `GeoLeaf JS ${version}`,
        message,
    };
}

/**
 * Displays the startup toast.
 * Respects the `debug.showBootInfo` config (default: true in dev, false in prod).
 *
 * @param {object} GeoLeaf - The global GeoLeaf namespace
 * @param {object} [options]
 * @param {boolean} [options.force=false] - Force display even if disabled in config
 * @param {number} [options.duration=4000] - Display duration in ms
 */
export function showBootInfo(
    GeoLeaf: BootInfoNamespace | null | undefined,
    options: BootInfoOptions = {}
) {
    if (!GeoLeaf) return;

    // Config check — can be disabled via JSON profile: "debug": { "showBootInfo": false }
    if (!options.force) {
        try {
            const showFlag = GeoLeaf.Config?.get?.("debug.showBootInfo");
            // If explicitly disabled, do not display
            if (showFlag === false) return;
        } catch (_) {
            /* Config unavailable — display anyway */
        }
    }

    const { title, message } = _buildBootMessage(GeoLeaf);

    // Log only — toast deactivated (dev info only)
    console.info(`[GeoLeaf] ${title} | ${message}`);
}

/**
 * Public API exposed on GeoLeaf.bootInfo
 */
export const BootInfo = {
    show: showBootInfo,
    detectPlugins: _detectLoadedPlugins,
    buildMessage: _buildBootMessage,
};
