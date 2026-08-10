/*!
 * @geoleaf-plugins/offline-ui
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Storage - Layer Selector / Selection & Cache
 * @version 3.0.1
 */

import { Log, fetchWithTimeout } from "@geoleaf/host-runtime";
import { coreConfigGet as configGet } from "@geoleaf/host-runtime";
// API publique S4.4 — via la carte `exports` publiée du core, plus par un alias vers ses
// SOURCES. Fonction PURE et sans aucun import : l'embarquer dans le bundle est sûr (aucune
// identité à partager, contrairement aux singletons qui passent par le namespace).
import { resolveProfileLayers } from "@geoleaf/core/kernel/config/profile-layers.js";
import { DOMSecurity } from "../../utils/core-utils.js";
import { StorageContract } from "../../shared/storage-contract.js";
import { estimateVectorZone } from "../../sync/vector-zone-estimate.js";
import { LS } from "./core.js";
import { tLabel as t } from "@geoleaf/host-runtime";
import { beginCacheStatusPass, getCacheStatusOnce } from "./config-cache.js";
import { renderCacheCell } from "./cache-cell.js";
import {
    basemapUrlPrefixes,
    matchesBasemap,
    matchesLayer,
    normalizeResourceUrl,
} from "./cache-match.js";
import type {
    LayerLike,
    BasemapLike,
    SavedSelection,
    VectorZone,
    LayerSelectorAPI,
} from "./layer-selector-types.js";

/**
 * Download-size tiers driving the warning banner.
 *
 * ⚠️ PLUGINS S7 — these used to be THREE constants for TWO tiers: a module-level
 * `QUOTA_CRITICAL` and a function-local `WIFI_SIZE_BYTES`, both worth exactly
 * 1 GB. The critical branch was entered on `totalSize > WIFI_SIZE_BYTES` and
 * then re-tested `totalSize > QUOTA_CRITICAL` to pick between two renderings —
 * a test that could not be false, since both sides were the same number. Its
 * whole "else" arm (the `ATTENTION: … MB` / `WiFi recommended` variant) was
 * therefore UNREACHABLE, and duplicated what the tier below already renders.
 * Collapsed to the two tiers the numbers actually describe; no visible change.
 */
const CACHE_SIZE_CRITICAL = 1 * 1024 * 1024 * 1024;
const CACHE_SIZE_WARNING = 300 * 1024 * 1024;

/** One rendered warning banner: icon, bold lead, optional inline detail, sub-line. */
interface WarningSpec {
    /**
     * ⚠️ Full, LITERAL class list — never assembled from a variant suffix.
     * `verify-purgecss` reads the sources to decide which selectors are alive,
     * and a name built by template is invisible to it (PLUGINS S2).
     */
    variantClass: string;
    icon: string;
    title: string;
    detail?: string;
    hint: string;
}

/** Replaces the banner's content with a single warning item and reveals it. */
function _renderWarning(warningEl: HTMLElement, spec: WarningSpec): void {
    DOMSecurity.clearElementFast(warningEl);

    const warningItem = document.createElement("div");
    warningItem.className = spec.variantClass;

    const iconSpan = document.createElement("span");
    iconSpan.className = "gl-cache-warning__icon";
    iconSpan.textContent = spec.icon;
    warningItem.appendChild(iconSpan);

    const textSpan = document.createElement("span");
    textSpan.className = "gl-cache-warning__text";

    const strong = document.createElement("strong");
    strong.textContent = spec.title;
    textSpan.appendChild(strong);

    if (spec.detail) textSpan.appendChild(document.createTextNode(spec.detail));
    textSpan.appendChild(document.createElement("br"));

    const small = document.createElement("small");
    small.textContent = spec.hint;
    textSpan.appendChild(small);

    warningItem.appendChild(textSpan);
    warningEl.appendChild(warningItem);
    warningEl.style.display = "block";
}

Object.assign(LS, {
    async loadSelection(this: LayerSelectorAPI, profileId: string): Promise<SavedSelection | null> {
        try {
            const Storage = StorageContract.Cache?.Storage;
            if (!Storage) return null;
            return (await Storage.loadLayerSelection(profileId)) as SavedSelection | null;
        } catch (error) {
            if (Log)
                Log.error(`[LayerSelector] Failed to load selection: ${(error as Error).message}`);
            return null;
        }
    },

    async saveSelection(this: LayerSelectorAPI) {
        if (!this._layersContent) return;

        try {
            const profileId = configGet("data.activeProfile", "") as string;
            if (!profileId) return;

            // Preserve the download zone chosen in the ZONE accordion (S3): this
            // writer rebuilds the selection from the DOM and would otherwise drop it.
            const prior = await this.loadSelection(profileId);
            const vectorZone = prior?.vectorZone;

            const checkboxes = this._layersContent.querySelectorAll('input[type="checkbox"]');
            const selection: SavedSelection & {
                layers: string[];
                basemaps: string[];
                styles: Record<string, string>;
            } = {
                layers: [],
                basemaps: [],
                styles: {},
                includeTiles: configGet("modules.offline.cache.enableTileCache", true) as boolean,
                timestamp: Date.now(),
                totalEstimatedSize: 0,
                ...(vectorZone ? { vectorZone } : {}),
            };

            const selectedLayers: string[] = [];
            const selectedBasemaps: string[] = [];

            checkboxes.forEach((cb: Element) => {
                const input = cb as HTMLInputElement;
                if (input.checked) {
                    if (input.dataset.layerId) {
                        selection.layers.push(input.dataset.layerId);
                        selectedLayers.push(input.dataset.layerId);
                    } else if (input.dataset.basemapId) {
                        selection.basemaps.push(input.dataset.basemapId);
                        selectedBasemaps.push(input.dataset.basemapId);
                    }
                }
            });

            const styleSelects = this._layersContent.querySelectorAll(
                ".gl-cache-layers__style-select"
            );
            styleSelects.forEach((select: Element) => {
                const row = (select as HTMLElement).closest(".gl-cache-layers__row");
                const checkbox = row?.querySelector(
                    "input[data-layer-id]"
                ) as HTMLInputElement | null;
                if (checkbox?.checked && checkbox.dataset.layerId) {
                    selection.styles[checkbox.dataset.layerId] = (
                        select as HTMLSelectElement
                    ).value;
                }
            });

            let totalBytes = 0;

            for (const layerId of selectedLayers) {
                const layer = this._layers.find((l: LayerLike) => l.id === layerId);
                if (layer) {
                    const layerSize = await this.estimateLayerSize(layer);
                    totalBytes += layerSize;
                }
            }

            for (const basemapId of selectedBasemaps) {
                const basemap = this._basemaps.find((b: BasemapLike) => b.id === basemapId);
                if (
                    basemap &&
                    basemap.offlineBounds &&
                    basemap.cacheMinZoom != null &&
                    basemap.cacheMaxZoom != null
                ) {
                    const estimate = this.estimateBasemapSize(basemap);
                    totalBytes += estimate.estimatedSize;
                }
            }

            // Add the vector basemap download estimate when a zone is set and a
            // MapLibre (vector) basemap is selected.
            if (vectorZone) {
                const hasVectorBasemap = selectedBasemaps.some((id) => {
                    const bm = this._basemaps.find((b: BasemapLike) => b.id === id) as
                        | (BasemapLike & { type?: string; style?: string; url?: string })
                        | undefined;
                    return !!bm && (bm.type === "maplibre" || (!!bm.style && !bm.url));
                });
                if (hasVectorBasemap) {
                    totalBytes += estimateVectorZone(vectorZone as VectorZone).bytes;
                }
            }

            selection.totalEstimatedSize = totalBytes;

            const Storage = StorageContract.Cache?.Storage;
            if (Storage) {
                await (
                    Storage as {
                        saveLayerSelection: (id: string, s: SavedSelection) => Promise<void>;
                    }
                ).saveLayerSelection(profileId, selection);
            }

            if (Log)
                Log.debug(
                    `[LayerSelector] Selection saved: ${selection.layers.length} layers, ${selection.basemaps.length} basemaps, ${(totalBytes / 1024 / 1024 / 1024).toFixed(2)} GB`
                );
        } catch (error) {
            console.error("[LayerSelector] saveSelection error:", error);
            if (Log)
                Log.error(`[LayerSelector] Failed to save selection: ${(error as Error).message}`);
        }
    },

    async handleSelectAllChange(this: LayerSelectorAPI) {
        if (!this._layersContent || !this._selectAllCheckbox) return;

        const checkboxes = this._layersContent.querySelectorAll(
            'input[type="checkbox"]:not(.gl-cache-layers__select-all):not(:disabled)'
        );
        checkboxes.forEach((cb) => {
            (cb as HTMLInputElement).checked = this._selectAllCheckbox!.checked;
        });

        await this.saveSelection();
        await this.updateWarning();
    },

    updateSelectAllCheckbox(this: LayerSelectorAPI) {
        if (!this._layersContent || !this._selectAllCheckbox) return;

        const checkboxes = this._layersContent.querySelectorAll(
            'input[type="checkbox"]:not(.gl-cache-layers__select-all):not(:disabled)'
        );
        const checkedCount = Array.from(checkboxes).filter(
            (cb) => (cb as HTMLInputElement).checked
        ).length;

        this._selectAllCheckbox.checked =
            checkboxes.length > 0 && checkedCount === checkboxes.length;
        this._selectAllCheckbox.indeterminate =
            checkedCount > 0 && checkedCount < checkboxes.length;
    },

    async isLayerCached(this: LayerSelectorAPI, layer: LayerLike) {
        try {
            const profileId = configGet("data.activeProfile", "") as string;
            if (!profileId) return false;

            const status = await getCacheStatusOnce(profileId);
            if (!status || !status.resources || status.resources.length === 0) {
                Log.debug(`[LayerSelector] No cached resources for profile ${profileId}`);
                return false;
            }

            Log.debug(
                `[LayerSelector] Checking ${layer.id} against ${status.resources.length} cached resources`
            );

            const profilesBasePath = configGet("data.profilesBasePath", "profiles") as string;
            const searchUrls: string[] = [];

            // 🛑 B-152 — CE BLOC N'A PAS BESOIN D'UNE BRANCHE `inlineConfig`, ET C'EST
            // DÉLIBÉRÉ.
            //
            // Il était le TROISIÈME site aveugle aux couches templatées, mais par
            // conséquence et non par cause : `layerDir` et `dataFile` n'étaient jamais posés
            // pour elles, donc `searchUrls` restait vide et le `return false` plus bas
            // s'appliquait à chaque passage — l'utilisateur pouvait télécharger, l'icône ne
            // passait jamais au vert.
            //
            // Depuis que `core.populate()` dérive les deux champs pour les deux provenances,
            // cette branche-ci les couvre toutes les deux telles quelles. Lui ajouter un
            // `else if (layer.inlineConfig)` reconstruirait la MÊME URL une seconde fois :
            // un doublon structurel (compteur C4) et un second endroit libre de diverger de
            // la convention `layers/<id>` de `resource-enumerator`.
            //
            // ⚠️ La contrepartie, à savoir avant de toucher à `core.populate()` : ce site
            // n'a plus de défense propre. Si la dérivation y disparaît, l'état de cache
            // redevient faux **en silence**. C'est ce que la garde
            // `templated-layer-selector.guard.test.ts` tient — elle a été vue rouge sur ce
            // point précis avant le correctif.
            if (layer.layerDir && layer.dataFile) {
                searchUrls.push(
                    `${profilesBasePath}/${profileId}/${layer.layerDir}/${layer.dataFile}`
                );
                searchUrls.push(
                    `../${profilesBasePath}/${profileId}/${layer.layerDir}/${layer.dataFile}`
                );
            }
            if (layer.configFile) {
                searchUrls.push(`${profilesBasePath}/${profileId}/${layer.configFile}`);
                searchUrls.push(`../${profilesBasePath}/${profileId}/${layer.configFile}`);
            }

            if (searchUrls.length === 0) {
                Log.debug(`[LayerSelector] No URLs to search for layer ${layer.id}`);
                return false;
            }

            const normalizedSearchUrls = searchUrls.map(normalizeResourceUrl);
            Log.debug(`[LayerSelector] Search URLs for ${layer.id}:`, normalizedSearchUrls);

            const resourceUrls = status.resources.map((r) => normalizeResourceUrl(r.url));
            const isCached = matchesLayer(resourceUrls, normalizedSearchUrls);

            Log.debug(`[LayerSelector] Layer ${layer.id}: isCached=${isCached}`);
            return isCached;
        } catch (error) {
            console.error(`[LayerSelector] Error checking cache for ${layer.id}:`, error);
            if (Log)
                Log.error(
                    `[LayerSelector] Error checking cache for ${layer.id}: ${(error as Error).message}`
                );
            return false;
        }
    },

    async isBasemapCached(this: LayerSelectorAPI, basemap: BasemapLike) {
        try {
            const profileId = configGet("data.activeProfile", "") as string;
            if (!profileId) return false;

            const status = await getCacheStatusOnce(profileId);
            if (!status || !status.resources || status.resources.length === 0) {
                return false;
            }

            const prefixes = basemapUrlPrefixes(basemap);
            if (prefixes.length === 0) {
                // No url and no style: nothing in the manifest can be attributed to
                // this basemap. Reporting "not cached" is the honest answer — the
                // former `includes("tile")` fallback reported the opposite for ALL
                // of them at once.
                Log.debug(`[LayerSelector] Basemap ${basemap.id}: no url or style to match on`);
                return false;
            }

            const resourceUrls = status.resources.map((r) => normalizeResourceUrl(r.url));
            const isCached = matchesBasemap(resourceUrls, prefixes);

            Log.debug(`[LayerSelector] Basemap ${basemap.id}: isCached=${isCached}`);
            return isCached;
        } catch (error) {
            console.error(`[LayerSelector] Error checking cache for basemap ${basemap.id}:`, error);
            return false;
        }
    },

    async refreshCacheIcons(this: LayerSelectorAPI) {
        if (!this._layersContent) return;

        try {
            const cacheCells = this._layersContent.querySelectorAll(".gl-cache-layers__td-cache");
            if (!cacheCells || cacheCells.length === 0) return;

            const profileId = configGet("data.activeProfile", "") as string;
            if (!profileId) return;

            // MANDATORY: this method runs right after a download or a clear, so the
            // manifest it reads must be the new one. Without this the ✓/✗ icons would
            // keep serving the pre-download pass and never turn green.
            beginCacheStatusPass();

            const profilesBasePath = configGet("data.profilesBasePath", "profiles") as string;
            const profileResponse = await fetchWithTimeout(
                fetch,
                `${profilesBasePath}/${profileId}/profile.json`,
                {},
                10000
            );
            if (!profileResponse.ok) return;
            const profile = (await profileResponse.json()) as {
                layers?: LayerLike[];
                Files?: { layersFile?: string };
            };

            // profile.json does not inline layers; resolve from Files.layersFile.
            profile.layers = await resolveProfileLayers(profile, profileId, profilesBasePath, {
                onWarn: (message) => Log.warn(message),
            });
            if (!profile.layers || profile.layers.length === 0) return;

            const rows = this._layersContent.querySelectorAll(".gl-cache-layers__row");
            Log.debug(`[LayerSelector] Refreshing cache icons for ${rows.length} rows`);

            for (const row of rows) {
                const checkbox = row.querySelector("input[data-layer-id]");
                if (!checkbox) continue;

                const layerId = (checkbox as HTMLInputElement).dataset.layerId;
                const layer = profile.layers.find((l) => l.id === layerId);
                if (!layer) continue;

                Log.debug(`[LayerSelector] Checking cache status for ${layerId}`);
                const isCached = await this.isLayerCached(layer);
                Log.debug(`[LayerSelector] ${layerId} isCached: ${isCached}`);

                const cacheCell = row.querySelector(
                    ".gl-cache-layers__td-cache"
                ) as HTMLElement | null;
                if (cacheCell) {
                    DOMSecurity.clearElement(cacheCell);
                    renderCacheCell(
                        cacheCell,
                        isCached ? "cached" : "missing",
                        isCached ? t("storage.layers.cached") : t("storage.layers.notCached")
                    );
                }
            }

            if (Log) Log.debug(`[LayerSelector] Cache icons refreshed for ${rows.length} rows`);
        } catch (error) {
            console.error(`[LayerSelector] Failed to refresh cache icons:`, error);
            if (Log)
                Log.error(
                    `[LayerSelector] Failed to refresh cache icons: ${(error as Error).message}`
                );
        }
    },

    async updateWarning(this: LayerSelectorAPI) {
        const warningEl = document.getElementById("gl-cache-warning");
        const downloadBtn = document.getElementById("gl-cache-download");
        if (!warningEl || !downloadBtn) return;

        try {
            const profileId = configGet("data.activeProfile", "") as string;
            if (!profileId) {
                warningEl.style.display = "none";
                return;
            }

            const selection = await this.loadSelection(profileId);
            if (!selection) {
                warningEl.style.display = "none";
                return;
            }

            const totalSize = selection.totalEstimatedSize || 0;
            const totalSizeGB = (totalSize / 1024 / 1024 / 1024).toFixed(2);
            const totalSizeMB = (totalSize / 1024 / 1024).toFixed(1);

            let quotaInfo: { quota?: number; usage?: number } | null = null;
            let isInsufficientStorage = false;

            try {
                if (navigator.storage?.estimate) {
                    quotaInfo = await navigator.storage.estimate();
                }
            } catch (e) {
                console.warn("[LayerSelector] Could not get storage quota:", e);
            }

            if (quotaInfo && quotaInfo.quota != null && quotaInfo.usage != null) {
                const availableSpace = quotaInfo.quota - quotaInfo.usage;
                if (totalSize > availableSpace) {
                    isInsufficientStorage = true;
                }
            }

            let isError = false;

            if (
                isInsufficientStorage &&
                quotaInfo &&
                quotaInfo.quota != null &&
                quotaInfo.usage != null
            ) {
                isError = true;
                const availableSpace = quotaInfo.quota - quotaInfo.usage;
                const shortageGB = ((totalSize - availableSpace) / 1024 / 1024 / 1024).toFixed(2);
                _renderWarning(warningEl, {
                    variantClass: "gl-cache-warning__item gl-cache-warning__error",
                    icon: "❌",
                    title: t("storage.warn.insufficient"),
                    hint: `${t("storage.warn.required")} : ${totalSizeGB} GB. ${t("storage.warn.missing")} : ${shortageGB} GB`,
                });
            } else if (totalSize > CACHE_SIZE_CRITICAL) {
                _renderWarning(warningEl, {
                    variantClass: "gl-cache-warning__item gl-cache-warning__critical",
                    icon: "⚠️",
                    title: t("storage.warn.critical"),
                    detail: ` ${t("storage.warn.largeDownload")} (${totalSizeGB} GB)`,
                    hint: t("storage.warn.wifiStrong"),
                });
            } else if (totalSize > CACHE_SIZE_WARNING) {
                _renderWarning(warningEl, {
                    variantClass: "gl-cache-warning__item gl-cache-warning__warning",
                    icon: "⚠️",
                    title: t("storage.warn.attention"),
                    detail: ` ${t("storage.warn.significantDownload")} (${totalSizeMB} MB)`,
                    hint: t("storage.warn.wifiAdvised"),
                });
            } else {
                warningEl.style.display = "none";
            }

            const btn = downloadBtn as HTMLButtonElement;
            if (isError) {
                btn.disabled = true;
                btn.style.opacity = "0.5";
                btn.style.cursor = "not-allowed";
                btn.title = t("storage.warn.btn.blocked");
            } else {
                btn.disabled = false;
                btn.style.opacity = "1";
                btn.style.cursor = "pointer";
                btn.title = t("storage.warn.btn.ready");
            }
        } catch (error) {
            console.error("[LayerSelector] Error in updateWarning:", error);
        }
    },
});

if (Log) {
    Log.info("[LayerSelector] Selection-cache module loaded");
}
