/*!
 * @geoleaf-plugins/offline-ui
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Storage - Layer Selector / Row Rendering
 * @version 3.0.1
 */

import { Log } from "@geoleaf/host-runtime";
import { toMB, toGB } from "../../utils/core-utils.js";
import { LS } from "./core.js";
import { getLayerConfig } from "./config-cache.js";
import type {
    LayerLike,
    BasemapLike,
    SavedSelection,
    LayerSelectorAPI,
} from "./layer-selector-types.js";

import { createElement } from "../../utils/dom-helpers.js";
import { tLabel as t } from "@geoleaf/host-runtime";
import { renderCacheCell } from "./cache-cell.js";

Object.assign(LS, {
    _createTableHeader(this: LayerSelectorAPI, table: HTMLTableElement) {
        const thead = createElement("thead", "", table) as HTMLTableSectionElement;
        const headerRow = createElement("tr", "", thead) as HTMLTableRowElement;

        const th1 = createElement(
            "th",
            "gl-cache-layers__th-checkbox",
            headerRow
        ) as HTMLTableCellElement;
        this._selectAllCheckbox = createElement(
            "input",
            "gl-cache-layers__select-all",
            th1
        ) as HTMLInputElement;
        this._selectAllCheckbox.type = "checkbox";
        this._selectAllCheckbox.id = "geoleaf-cache-select-all";
        this._selectAllCheckbox.name = "geoleaf-cache-select-all";
        this._selectAllCheckbox.checked = true;
        this._selectAllCheckbox.title = t("storage.layers.selectAll");

        // Sync wrapper: the listener must return void (it is also stored below for
        // removeEventListener, so the reference has to stay stable).
        const selectAllHandler = () => {
            this.handleSelectAllChange().catch((e: unknown) =>
                Log?.error("[LayerSelector] Error handling select-all change:", e)
            );
        };
        this._selectAllCheckbox.addEventListener("change", selectAllHandler);
        this._eventListeners.push({
            element: this._selectAllCheckbox,
            event: "change",
            handler: selectAllHandler,
        });

        const th2 = createElement(
            "th",
            "gl-cache-layers__th-name",
            headerRow
        ) as HTMLTableCellElement;
        th2.textContent = t("storage.layers.col.name");

        const th3 = createElement(
            "th",
            "gl-cache-layers__th-geometry",
            headerRow
        ) as HTMLTableCellElement;
        th3.textContent = t("storage.layers.col.geometry");
        th3.style.textAlign = "center";
        th3.style.width = "90px";

        const th4 = createElement(
            "th",
            "gl-cache-layers__th-style",
            headerRow
        ) as HTMLTableCellElement;
        th4.textContent = t("storage.layers.col.style");

        const th5 = createElement(
            "th",
            "gl-cache-layers__th-size",
            headerRow
        ) as HTMLTableCellElement;
        th5.textContent = t("storage.layers.col.size");
        th5.style.textAlign = "right";
        th5.style.width = "80px";

        const th6 = createElement(
            "th",
            "gl-cache-layers__th-cache",
            headerRow
        ) as HTMLTableCellElement;
        th6.textContent = t("storage.layers.col.cache");
        th6.style.textAlign = "center";
        th6.style.width = "60px";
    },

    async createLayerRow(
        this: LayerSelectorAPI,
        tbody: HTMLTableSectionElement,
        layer: LayerLike,
        savedSelection: SavedSelection | null,
        profileCacheEnabled = true
    ) {
        const row = createElement("tr", "gl-cache-layers__row", tbody) as HTMLTableRowElement;
        const layerId = layer.id ?? "";

        if (!profileCacheEnabled) {
            row.style.opacity = "0.5";
            row.title = t("storage.layers.profileCacheOff");
        }

        const td1 = createElement(
            "td",
            "gl-cache-layers__td-checkbox",
            row
        ) as HTMLTableCellElement;
        const checkbox = createElement("input", "", td1) as HTMLInputElement;
        checkbox.type = "checkbox";
        checkbox.id = `geoleaf-cache-layer-${layerId}`;
        checkbox.name = `geoleaf-cache-layer-${layerId}`;
        checkbox.dataset.layerId = layerId;
        checkbox.dataset.type = "layer";

        if (!profileCacheEnabled) {
            checkbox.disabled = true;
            checkbox.checked = false;
        } else {
            if (savedSelection?.layers) {
                checkbox.checked = savedSelection.layers.includes(layerId);
            } else {
                checkbox.checked = true;
            }

            const applyChange = async () => {
                Log?.debug(
                    `[LayerSelector] Checkbox change event for ${layerId}: now ${checkbox.checked}`
                );
                await this.saveSelection();
                this.updateSelectAllCheckbox();
                await this.updateWarning();
            };
            const changeHandler = () => {
                applyChange().catch((e: unknown) =>
                    Log?.error(`[LayerSelector] Error applying change for ${layerId}:`, e)
                );
            };

            checkbox.addEventListener("change", changeHandler);
            this._eventListeners.push({
                element: checkbox,
                event: "change",
                handler: changeHandler,
            });
        }

        const td2 = createElement("td", "gl-cache-layers__td-name", row) as HTMLTableCellElement;
        const nameSpan = createElement("span", "gl-cache-layers__name", td2) as HTMLSpanElement;
        nameSpan.textContent = "~";

        this.getLayerLabel(layer)
            .then((label) => {
                nameSpan.textContent = label || layerId;
            })
            .catch(() => {
                nameSpan.textContent = layerId;
            });

        const td3 = createElement(
            "td",
            "gl-cache-layers__td-geometry",
            row
        ) as HTMLTableCellElement;
        td3.style.textAlign = "center";
        td3.style.color = "#94a3b8";
        // 🛑 B-161 — CETTE TABLE ÉTAIT KEYÉE SUR LE MAUVAIS VOCABULAIRE, DONC MORTE.
        //
        // Ses 7 clés étaient celles de **GeoJSON** (`Point`, `LineString`, `MultiPolygon`…),
        // capitalisées. Or une config de couche déclare le vocabulaire **PROFIL** —
        // `point`, `polyline`, `polygon`… en minuscules, et `polyline` n'existe même pas en
        // GeoJSON. Aucune valeur réelle ne matchait : le repli `|| geometryType` rendait la
        // valeur BRUTE, non traduite, pour **toutes** les couches. Vérifié en navigateur
        // avant correctif — la colonne affichait `point` et `polyline`, jamais « Point » ni
        // « Ligne ». Une table de traduction que rien n'atteint est indiscernable d'une table
        // juste : c'est le même angle mort que les deux clés que B-161 corrige au-dessus.
        //
        // La normalisation en minuscules couvre les DEUX vocabulaires d'un seul index, ce qui
        // évite d'avoir à trancher lequel est canonique ici — cet arbitrage est celui du
        // schéma (ANO-007 : ce sont des alias), pas celui d'une cellule de tableau.
        const GEOMETRY_LABEL_KEY: Record<string, string> = {
            point: "storage.geometry.point",
            multipoint: "storage.geometry.point",
            line: "storage.geometry.line",
            polyline: "storage.geometry.line",
            multiline: "storage.geometry.line",
            linestring: "storage.geometry.line",
            multilinestring: "storage.geometry.line",
            polygon: "storage.geometry.polygon",
            multipolygon: "storage.geometry.polygon",
            "fill-extrusion": "storage.geometry.polygon",
            geometrycollection: "storage.geometry.collection",
        };
        td3.textContent = "~";

        this.getLayerGeometryType(layer)
            .then((geometryType) => {
                if (geometryType) {
                    const key = GEOMETRY_LABEL_KEY[geometryType.toLowerCase()];
                    // Repli sur la valeur brute conservé : une géométrie hors des deux
                    // vocabulaires reste LISIBLE plutôt que de disparaître en `-`.
                    td3.textContent = key ? t(key) : geometryType;
                } else {
                    td3.textContent = "-";
                }
            })
            .catch(() => {
                td3.textContent = "-";
            });

        const td4 = createElement("td", "gl-cache-layers__td-style", row) as HTMLTableCellElement;
        await this.createStyleSelector(td4, layer, savedSelection);

        const td5 = createElement("td", "gl-cache-layers__td-size", row) as HTMLTableCellElement;
        td5.style.textAlign = "right";
        td5.style.color = "#94a3b8";
        td5.textContent = "~";
        this.estimateLayerSize(layer)
            .then((size) => {
                if (size > 0) {
                    const sizeMB = toMB(size) || (size / 1024 / 1024).toFixed(2);
                    td5.textContent = `${sizeMB} MB`;
                }
            })
            // Estimation is best-effort: on failure the "~" placeholder set above
            // stays, which is the intended degraded display. Same idiom as the
            // getLayerLabel() chain earlier in this file.
            .catch((e: unknown) => Log?.debug("[LayerSelector] Layer size estimation failed:", e));

        const td6 = createElement("td", "gl-cache-layers__td-cache", row) as HTMLTableCellElement;
        td6.style.textAlign = "center";
        const isCached = await this.isLayerCached(layer);
        renderCacheCell(
            td6,
            isCached ? "cached" : "missing",
            isCached ? t("storage.layers.cached") : t("storage.layers.notCached")
        );

        if (Log) Log.debug(`[LayerSelector] Layer ${layerId}: isCached=${isCached}`);
    },

    async createBasemapRow(
        this: LayerSelectorAPI,
        tbody: HTMLTableSectionElement,
        basemap: BasemapLike,
        savedSelection: SavedSelection | null,
        tileCacheEnabled = true
    ) {
        const row = createElement("tr", "gl-cache-layers__row", tbody) as HTMLTableRowElement;
        const basemapId = basemap.id ?? "";

        if (!tileCacheEnabled) {
            row.style.opacity = "0.5";
            row.title = t("storage.layers.tileCacheOff");
        }

        const td1 = createElement(
            "td",
            "gl-cache-layers__td-checkbox",
            row
        ) as HTMLTableCellElement;
        const checkbox = createElement("input", "", td1) as HTMLInputElement;
        checkbox.type = "checkbox";
        checkbox.id = `geoleaf-cache-basemap-${basemapId}`;
        checkbox.name = `geoleaf-cache-basemap-${basemapId}`;
        checkbox.dataset.basemapId = basemapId;
        checkbox.dataset.type = "basemap";

        if (!tileCacheEnabled) {
            checkbox.disabled = true;
            checkbox.checked = false;
        } else {
            if (savedSelection?.basemaps) {
                checkbox.checked = savedSelection.basemaps.includes(basemapId);
            } else {
                checkbox.checked = true;
            }

            const applyChange = async () => {
                await this.saveSelection();
                this.updateSelectAllCheckbox();
                await this.updateWarning();
            };
            const changeHandler = () => {
                applyChange().catch((e: unknown) =>
                    Log?.error(`[LayerSelector] Error applying change for ${basemapId}:`, e)
                );
            };

            checkbox.addEventListener("change", changeHandler);
            this._eventListeners.push({
                element: checkbox,
                event: "change",
                handler: changeHandler,
            });
        }

        const td2 = createElement("td", "gl-cache-layers__td-name", row) as HTMLTableCellElement;
        const nameSpan = createElement("span", "gl-cache-layers__name", td2) as HTMLSpanElement;
        nameSpan.textContent = basemap.label || basemapId;

        const td3 = createElement(
            "td",
            "gl-cache-layers__td-geometry",
            row
        ) as HTMLTableCellElement;
        td3.style.textAlign = "center";
        td3.style.color = "#94a3b8";
        td3.textContent = t("storage.layers.raster");

        const td4 = createElement("td", "gl-cache-layers__td-style", row) as HTMLTableCellElement;
        td4.textContent = "-";

        const td5 = createElement("td", "gl-cache-layers__td-size", row) as HTMLTableCellElement;
        td5.style.textAlign = "right";
        td5.style.color = "#94a3b8";
        td5.textContent = "~";
        td5.title = "";

        if (basemap.offlineBounds && basemap.cacheMinZoom != null && basemap.cacheMaxZoom != null) {
            Log?.debug(`[LayerSelector] Estimating size for basemap ${basemapId}:`, basemap);
            const estimate = this.estimateBasemapSize(basemap);
            Log?.debug(
                `[LayerSelector] Estimate result: ${estimate.tileCount} tiles, ${estimate.estimatedSize} bytes`
            );
            if (estimate.estimatedSize > 0) {
                const sizeMB =
                    toMB(estimate.estimatedSize, 1) ||
                    (estimate.estimatedSize / 1024 / 1024).toFixed(1);
                const sizeGB =
                    toGB(estimate.estimatedSize) ||
                    (estimate.estimatedSize / 1024 / 1024 / 1024).toFixed(2);
                const sizeGBNum = parseFloat(sizeGB);
                if (sizeGBNum >= 1) {
                    td5.textContent = `~${sizeGB} GB`;
                } else {
                    td5.textContent = `~${sizeMB} MB`;
                }
                const tileCountFormatted = estimate.tileCount.toLocaleString();
                const sizeFormatted = sizeGBNum >= 1 ? `${sizeGB} GB` : `${sizeMB} MB`;
                td5.title = `${tileCountFormatted} ${t("storage.zone.tiles")}\n${sizeFormatted}\nZoom ${basemap.cacheMinZoom}-${basemap.cacheMaxZoom}`;
            } else {
                td5.textContent = "-";
            }
        } else {
            td5.textContent = "-";
        }

        const td6 = createElement("td", "gl-cache-layers__td-cache", row) as HTMLTableCellElement;
        td6.style.textAlign = "center";

        const hasOfflineConfig = basemap.offline || basemap.offlineBounds;
        if (hasOfflineConfig && tileCacheEnabled) {
            const isCached = await this.isBasemapCached(basemap);
            renderCacheCell(
                td6,
                isCached ? "cached" : "missing",
                isCached ? t("storage.layers.tilesCached") : t("storage.layers.tilesNotCached")
            );
        } else if (hasOfflineConfig && !tileCacheEnabled) {
            renderCacheCell(td6, "missing", t("storage.layers.tileCacheDisabled"));
        } else {
            renderCacheCell(td6, "none", t("storage.layers.noCacheConfig"));
        }
    },

    async createStyleSelector(
        this: LayerSelectorAPI,
        parentEl: HTMLElement,
        layer: LayerLike,
        savedSelection: SavedSelection | null
    ) {
        try {
            const layerFullConfig = await getLayerConfig(layer);
            if (!layerFullConfig) {
                parentEl.textContent = "-";
                return;
            }

            const styles = layerFullConfig.styles?.available || [];

            Log?.debug(`[LayerSelector] Styles for ${layer.id}:`, styles);

            if (styles.length === 0) {
                parentEl.textContent = "-";
                return;
            }

            if (Log) Log.debug(`[LayerSelector] Available styles for ${layer.id}:`, styles);

            const select = createElement(
                "select",
                "gl-cache-layers__style-select",
                parentEl
            ) as HTMLSelectElement;

            const savedStyleId =
                (layer.id && savedSelection?.styles?.[layer.id]) ||
                layerFullConfig.styles?.default ||
                styles[0]?.id;

            styles.forEach((style) => {
                const option = document.createElement("option");
                option.value = style.id ?? "";
                option.textContent = style.label || (style.id ?? "");
                if (style.id === savedStyleId) {
                    option.selected = true;
                }
                select.appendChild(option);
            });

            const applyStyleChange = async () => {
                await this.saveSelection();
                await this.updateWarning();
            };
            select.addEventListener("change", () => {
                applyStyleChange().catch((e: unknown) =>
                    Log?.error("[LayerSelector] Error applying style change:", e)
                );
            });
        } catch (error) {
            if (Log)
                Log.error(
                    `[LayerSelector] Failed to create style selector: ${(error as Error).message}`
                );
            parentEl.textContent = "-";
        }
    },
});

if (Log) {
    Log.info("[LayerSelector] Row-rendering module loaded");
}
