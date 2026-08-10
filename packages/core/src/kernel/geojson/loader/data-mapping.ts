/*!
 * GeoLeaf Core — GeoJSON loader: per-source data mapping (ANO-083 / B.6).
 * © 2026 Mattieu Pottier — MIT License — https://geoleaf.dev
 */

/**
 * Bridges an external raw data source (e.g. the GBIF Occurrence API) to the GeoLeaf POI
 * shape when a layer declares `data.mapping`, so the downstream converter renders points.
 */

import { ConfigNormalizer } from "../../config/normalization.js";
import type { GeoJSONLoaderLog, LayerDataConfig } from "./loader-types.js";

/**
 * Resolves the items array to normalize: the raw data itself when it is an array, else the
 * array found at `itemsPath` (dot-path, e.g. "results") inside the response object.
 */
function _extractItemsArray(rawData: unknown, itemsPath?: string): unknown[] | null {
    if (Array.isArray(rawData)) return rawData as unknown[];
    if (itemsPath && rawData && typeof rawData === "object") {
        const found = itemsPath.split(".").reduce<unknown>((acc, key) => {
            if (acc && typeof acc === "object" && !Array.isArray(acc)) {
                return (acc as Record<string, unknown>)[key];
            }
            return undefined;
        }, rawData);
        if (Array.isArray(found)) return found as unknown[];
    }
    return null;
}

/**
 * Normalizes raw fetched data to the GeoLeaf POI shape when the layer declares
 * `data.mapping` (a per-source block id, e.g. "gbif"). Returns the raw data unchanged
 * when no mapping is declared, no mapping.json is loaded, or no items array is found.
 *
 * @param rawData       - The raw fetched response (array, or object wrapping the array).
 * @param data          - The layer's `data` config block.
 * @param layerId       - Layer id (for logging).
 * @param Log           - Loader logger.
 * @param mappingConfig - The active profile's mapping.json config (named per-source blocks).
 */
export function applyDataMapping(
    rawData: unknown,
    data: LayerDataConfig | undefined,
    layerId: string,
    Log: GeoJSONLoaderLog,
    mappingConfig: Record<string, unknown> | null
): unknown {
    const sourceKey = data?.mapping;
    if (typeof sourceKey !== "string" || !sourceKey) return rawData;
    if (!mappingConfig) {
        Log.warn(
            `[GeoLeaf.GeoJSON] Layer "${layerId}" declares data.mapping="${sourceKey}" but no mapping.json is loaded — raw data used as-is.`
        );
        return rawData;
    }
    const items = _extractItemsArray(rawData, data?.itemsPath);
    if (!items) {
        Log.warn(
            `[GeoLeaf.GeoJSON] Layer "${layerId}" data.mapping set but no items array found` +
                (data?.itemsPath ? ` at itemsPath="${data.itemsPath}"` : "") +
                " — raw data used as-is."
        );
        return rawData;
    }
    const normalized = ConfigNormalizer.normalizePoiWithMapping(
        items as Parameters<typeof ConfigNormalizer.normalizePoiWithMapping>[0],
        mappingConfig,
        sourceKey
    );
    Log.info(
        `[GeoLeaf.GeoJSON] Layer "${layerId}" — mapping "${sourceKey}" applied: ${items.length} raw → ${normalized.length} normalized POI`
    );
    return normalized;
}
