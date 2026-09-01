/*!
 * @geoleaf-plugins/offline-ui
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Storage - Layer Selector / Core
 * @version 3.0.1
 */

import { Log, fetchWithTimeout } from "@geoleaf/host-runtime";
import { coreConfigGet as configGet } from "@geoleaf/host-runtime";
// Through the core's published `exports` map, no longer via an alias to its
// SOURCES. PURE, import-free function: embedding it in the bundle is safe (no
// identity to share, unlike the singletons that go through the namespace).
import { resolveProfileLayers } from "@geoleaf/core/kernel/config/profile-layers.js";
import { DOMSecurity } from "../../utils/core-utils.js";
import { beginCacheStatusPass, getLayerConfig } from "./config-cache.js";
import type { LayerSelectorAPI, LayerLike, BasemapLike } from "./layer-selector-types.js";
// Plugin helper — signature (tag, className, parent). The core helper's signature
// is (tag, props, ...children): passing the parent as the 3rd arg there would
// append it AS A CHILD of the new element, detaching the layers container.
import { createElement } from "../../utils/dom-helpers.js";
import { tLabel as t } from "@geoleaf/host-runtime";

const LS = {} as LayerSelectorAPI;
// —— State properties (shared across all sub-modules via 'this') ——

LS._control = null as unknown;
LS._selectAllCheckbox = null;
LS._layersContent = null;
LS._eventListeners = [];
LS._layers = [];
LS._basemaps = [];

// —— Methods ——

Object.assign(LS, {
    init(this: LayerSelectorAPI, control: unknown, layersContent: HTMLElement) {
        this._control = control;
        this._layersContent = layersContent;
        this._eventListeners = [];
    },

    async populate(this: LayerSelectorAPI) {
        if (!this._layersContent) return;

        try {
            const profileId = configGet("data.activeProfile", "") as string;
            if (!profileId) return;

            // One fresh manifest read for the whole table instead of one per row.
            beginCacheStatusPass();

            const profilesBasePath = configGet("data.profilesBasePath", "profiles") as string;
            // Relative path (no leading slash): profilesBasePath is itself relative
            // (e.g. "./profiles"), so the app works whether served at the origin
            // root or under a sub-directory. Matches the core + download path.
            const profileUrl = `${profilesBasePath}/${profileId}/profile.json`;
            const profileResponse = await fetchWithTimeout(fetch, profileUrl, {}, 10000);
            if (!profileResponse.ok) {
                if (Log)
                    Log.error(
                        `[LayerSelector] Failed to load profile (${profileResponse.status}): ${profileUrl}`
                    );
                return;
            }
            const profile = (await profileResponse.json()) as {
                layers?: LayerLike[];
                Files?: { layersFile?: string };
            };

            // The served profile.json does not inline `layers`; they live in the
            // file referenced by Files.layersFile (layers.json). Resolve them so
            // the selector can list the profile's layers.
            profile.layers = await resolveProfileLayers(profile, profileId, profilesBasePath, {
                onWarn: (message) => Log.warn(message),
            });

            const savedSelection = await this.loadSelection(profileId);

            DOMSecurity.clearElementFast(this._layersContent);

            const table = createElement("table", "gl-cache-layers__table", this._layersContent);

            this._createTableHeader(table);

            const tbody = createElement("tbody", "", table);

            // ANO-078: fallback aligned to the cache subsystem default (true/true).
            // The cache engine (cache-manager/downloader/selection-cache + core init)
            // defaults these flags to true, so the UI must display rows as enabled when
            // the key is absent — otherwise rows render greyed-out while caching is ON.
            const profileCacheEnabled = configGet(
                "modules.offline.cache.enableProfileCache",
                true
            ) as boolean;
            const tileCacheEnabled = configGet(
                "modules.offline.cache.enableTileCache",
                true
            ) as boolean;

            this._layers = [];
            this._basemaps = [];

            if (profile.layers && Array.isArray(profile.layers)) {
                for (const layer of profile.layers) {
                    // ⚠️ `hasInlineConfig` ADDED to the trace: the trace is what
                    // allowed diagnosing the defect, and it then said ONLY
                    // `hasConfigFile`. On a templated layer it printed `false`
                    // everywhere, without distinguishing "no config" from "config
                    // of another provenance".
                    Log?.debug(`[LayerSelector] Processing layer ${layer.id}:`, {
                        hasConfigFile: !!layer.configFile,
                        configFile: layer.configFile,
                        hasInlineConfig: !!layer.inlineConfig,
                        hasLayerDir: !!layer.layerDir,
                    });

                    // 🛑 TWO PROVENANCES FOR `layerDir`, NOT ONE.
                    //
                    // This block only knew `configFile`, from which it derived the
                    // directory by string slicing. A templated layer has none:
                    // neither `layerDir` nor `dataFile` were set,
                    // `estimateLayerSize` had no URL for its HEAD, and
                    // `isLayerCached` (`selection-cache.ts`) ended up with an
                    // EMPTY `searchUrls` — hence "not cached", definitively and
                    // whatever gets downloaded.
                    //
                    // For an inline config the directory is not sliced, it is
                    // DEDUCED: `layers/<id>`, the convention `resource-enumerator`
                    // applies when it caches the layer
                    // (`_addInlineConfigResource`). Reusing its convention rather
                    // than inventing one is what guarantees the URL looked up here
                    // and the URL written there are the same.
                    if (!layer.layerDir) {
                        if (layer.configFile) {
                            layer.layerDir = layer.configFile.substring(
                                0,
                                layer.configFile.lastIndexOf("/")
                            );
                        } else if (layer.inlineConfig && layer.id) {
                            layer.layerDir = `layers/${layer.id}`;
                        }

                        if (layer.layerDir) {
                            Log?.debug(`[LayerSelector] Set layerDir to: ${layer.layerDir}`);

                            // Side effect kept deliberately: `estimateLayerSize` builds its
                            // HEAD url from `layer.dataFile`, which only this pass fills in.
                            // ⚠️ `getLayerConfig` serves the inline config from
                            // memory, so this `dataFile` comes from
                            // `expandLayerTemplates`, which normalises it via
                            // `layerDataPath` — one derivation in the whole repo,
                            // and the plugin does not have to redo it.
                            const layerConfig = await getLayerConfig(layer);
                            if (layerConfig?.dataFile) {
                                layer.dataFile = layerConfig.dataFile;
                                Log?.debug(
                                    `[LayerSelector] Set dataFile to: ${layerConfig.dataFile}`
                                );
                            }
                        }
                    }
                    this._layers.push(layer);
                    await this.createLayerRow(tbody, layer, savedSelection, profileCacheEnabled);
                }
            }

            const basemaps = configGet("basemaps", {}) as Record<string, BasemapLike>;
            Log?.debug(`[LayerSelector] All basemaps from Config:`, basemaps);
            const offlineBasemaps = Object.values(basemaps).filter((bm) => bm.offline === true);
            Log?.debug(`[LayerSelector] Offline basemaps:`, offlineBasemaps);

            if (offlineBasemaps.length > 0) {
                for (const basemap of offlineBasemaps) {
                    Log?.debug(`[LayerSelector] Processing basemap for row:`, {
                        id: basemap.id,
                        offline: basemap.offline,
                        hasBounds: !!basemap.offlineBounds,
                        boundsValue: basemap.offlineBounds,
                    });
                    this._basemaps.push(basemap);
                    await this.createBasemapRow(tbody, basemap, savedSelection, tileCacheEnabled);
                }
            }

            if (!savedSelection || (!savedSelection.layers && !savedSelection.basemaps)) {
                if (Log) Log.info("[LayerSelector] No saved selection, saving initial state");
                await this.saveSelection();
            }
        } catch (error) {
            if (Log) Log.error(`[LayerSelector] Failed to populate: ${(error as Error).message}`);
            DOMSecurity.clearElementFast(this._layersContent);
            const errorDiv = document.createElement("div");
            errorDiv.className = "gl-cache-layers__error";
            errorDiv.textContent = t("storage.layers.loadError");
            this._layersContent.appendChild(errorDiv);
        }
    },

    cleanup(this: LayerSelectorAPI) {
        if (!this._eventListeners) return;

        for (const listener of this._eventListeners) {
            try {
                listener.element.removeEventListener(listener.event, listener.handler);
            } catch (error) {
                console.warn("[LayerSelector] Error removing listener:", error);
            }
        }

        this._eventListeners = [];
        Log.debug("[LayerSelector] Cleanup completed - all listeners removed");
    },
});

if (Log) {
    Log.info("[LayerSelector] Core module loaded");
}

const LayerSelectorCore = LS;

export { LayerSelectorCore, LS };
