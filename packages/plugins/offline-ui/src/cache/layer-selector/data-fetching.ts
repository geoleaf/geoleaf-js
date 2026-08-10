/*!
 * @geoleaf-plugins/offline-ui
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Storage - Layer Selector / Data Fetching
 * @version 3.0.1
 */

import { Log, fetchWithTimeout } from "@geoleaf/host-runtime";
import { coreConfigGet as configGet } from "@geoleaf/host-runtime";
import { LS } from "./core.js";
import { getLayerConfig } from "./config-cache.js";
// B-161 — sous-chemin PUBLIÉ du core, même mécanisme que `profile-layers.js` : le plugin n'a
// aucun droit d'import profond (baseline PCB à `[]`), et redériver l'alias ici en ferait une
// 4ᵉ copie libre de diverger.
import { layerGeometry } from "@geoleaf/core/kernel/config/layer-geometry.js";
import type {
    LayerLike,
    BasemapLike,
    BasemapSizeEstimate,
    LayerSelectorAPI,
} from "./layer-selector-types.js";

Object.assign(LS, {
    async getLayerGeometryType(layer: LayerLike): Promise<string | null> {
        const layerConfig = await getLayerConfig(layer);
        if (!layerConfig) return null;

        // 🛑 B-161 — CETTE LIGNE NE LISAIT QUE `geometryType`, LA CLÉ MINORITAIRE.
        // Le schéma pose `geometryType` comme « alias of `geometry` » et interdit de migrer
        // (ANO-007) ; or **18 des 24** configs du dépôt ne déclarent que `geometry`, et
        // **aucune** ne déclare `geometryType` seul. Mesuré en navigateur : 38 des 42 lignes
        // du sélecteur de `tourism` rendaient `-`, dont 14 couches DIRECTES — la symétrie qui
        // prouve que la cause n'était pas l'`inlineConfig` de B-152.
        const geometryType = layerGeometry(layerConfig);
        Log?.debug(`[LayerSelector] Geometry type for ${layer.id}: ${geometryType}`);
        return geometryType;
    },

    async getLayerLabel(layer: LayerLike): Promise<string | null> {
        const layerConfig = await getLayerConfig(layer);
        if (!layerConfig) return null;

        const label = layerConfig.label;
        Log?.debug(`[LayerSelector] Label for ${layer.id}: ${label}`);
        return label || null;
    },

    async estimateLayerSize(layer: LayerLike): Promise<number> {
        try {
            const profileId = configGet("data.activeProfile", "") as string;
            if (!profileId) return 0;

            const profilesBasePath = configGet("data.profilesBasePath", "profiles") as string;

            let dataUrl: string | null = null;

            if (layer.layerDir && layer.dataFile) {
                dataUrl = `${profilesBasePath}/${profileId}/${layer.layerDir}/${layer.dataFile}`;
            } else if (layer.dataFile) {
                dataUrl = `${profilesBasePath}/${profileId}/${layer.dataFile}`;
            } else if (layer.url) {
                dataUrl = layer.url;
            } else {
                return 0;
            }

            if (!dataUrl) return 0;

            if (Log) Log.debug(`[LayerSelector] Estimating size for ${layer.id}: ${dataUrl}`);

            const response = await fetchWithTimeout(fetch, dataUrl, { method: "HEAD" }, 8000);
            if (!response.ok) return 0;

            const contentLength = response.headers.get("content-length");
            return contentLength ? Number.parseInt(contentLength, 10) : 0;
        } catch (error) {
            if (Log)
                Log.debug(
                    `[LayerSelector] Could not estimate size for ${layer.id}: ${(error as Error).message}`
                );
            return 0;
        }
    },

    estimateBasemapSize(this: LayerSelectorAPI, basemap: BasemapLike): BasemapSizeEstimate {
        try {
            if (
                !basemap.offlineBounds ||
                basemap.cacheMinZoom == null ||
                basemap.cacheMaxZoom == null
            ) {
                console.warn(
                    `[LayerSelector] Basemap ${basemap.id} missing bounds or zoom levels`,
                    {
                        hasBounds: !!basemap.offlineBounds,
                        minZoom: basemap.cacheMinZoom,
                        maxZoom: basemap.cacheMaxZoom,
                    }
                );
                return { tileCount: 0, estimatedSize: 0 };
            }

            const bounds = basemap.offlineBounds;
            const minZoom = basemap.cacheMinZoom;
            const maxZoom = basemap.cacheMaxZoom;

            let totalTiles = 0;

            for (let zoom = minZoom; zoom <= maxZoom; zoom++) {
                const minTile = this.latLngToTile(bounds.south, bounds.west, zoom);
                const maxTile = this.latLngToTile(bounds.north, bounds.east, zoom);

                const startX = Math.min(minTile.x, maxTile.x);
                const endX = Math.max(minTile.x, maxTile.x);
                const startY = Math.min(minTile.y, maxTile.y);
                const endY = Math.max(minTile.y, maxTile.y);

                const tilesAtZoom = (endX - startX + 1) * (endY - startY + 1);
                totalTiles += tilesAtZoom;
            }

            const avgTileSizeKB = 25;
            const estimatedSizeBytes = totalTiles * avgTileSizeKB * 1024;

            return { tileCount: totalTiles, estimatedSize: estimatedSizeBytes };
        } catch (error) {
            console.error(`[LayerSelector] Error estimating basemap size:`, error);
            return { tileCount: 0, estimatedSize: 0 };
        }
    },

    latLngToTile(
        this: LayerSelectorAPI,
        lat: number,
        lng: number,
        zoom: number
    ): { x: number; y: number } {
        const maxLat = 85.051129;
        lat = Math.max(-maxLat, Math.min(maxLat, lat));
        lng = Math.max(-180, Math.min(180, lng));

        const n = Math.pow(2, zoom);
        const x = Math.floor(((lng + 180) / 360) * n);

        const latRad = (lat * Math.PI) / 180;
        const y = Math.floor(
            ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
        );

        return { x, y };
    },
});

if (Log) {
    Log.info("[LayerSelector] Data-fetching module loaded");
}
