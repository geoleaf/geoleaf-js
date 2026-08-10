/*!
 * GeoLeaf Core – Baselayers / URL Utilities
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import { Log } from "../../utils/log/index.js";
import type { BasemapDefinition, NativeMap } from "./basemaps-types.js";

/**
 * Default basemap definitions (no API key required).
 * Each entry includes a legacy `url` field and a pre-expanded `tiles` array (MapLibre-compatible).
 */
export const DEFAULT_BASELAYERS: Record<string, BasemapDefinition> = {
    street: {
        label: "Street",
        url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        tiles: [
            "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
            "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
        ],
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
    },
    topo: {
        label: "Topo",
        url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
        tiles: [
            "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
            "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
            "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
        ],
        maxZoom: 17,
        attribution:
            "Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap",
    },
    satellite: {
        label: "Satellite",
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        tiles: [
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        maxZoom: 19,
        attribution:
            "Tiles &copy; Esri — Source: Esri, Earthstar Geographics, and the GIS user community",
    },
};

/**
 * Strips a `{apikey}` placeholder and its surrounding query separator from a URL.
 * Handles both `?param={apikey}` (sole param) and `&param={apikey}` (additional param).
 * @internal
 */
function _stripApiKeyParam(url: string): string {
    // Remove "&param={apikey}" or "?param={apikey}" (the latter becomes just the base URL)
    return url.replace(/[&?][^&?]*=\{apikey\}/g, "").replace(/[?&]$/, ""); // clean trailing separator if any
}

/**
 * Expands a `{s}` subdomain URL template into an array of
 * explicit tile URLs suitable for MapLibre raster sources.
 *
 * Rules:
 * - If `definition.tiles` is a non-empty array → returned as-is (highest priority),
 *   then `{apikey}` placeholders are resolved using `definition.apiKey`.
 * - If `definition.url` starts with `pmtiles://` → returned as single-element array (no expansion).
 * - If `definition.url` contains `{s}` → expanded using `definition.subdomains`
 *   (string `"abc"` or array `["a","b","c"]`; defaults to `["a","b","c"]`).
 * - If `definition.url` is present without `{s}` → returned as single-element array.
 * - Otherwise → empty array.
 *
 * API key injection:
 * - If any resolved URL contains `{apikey}` and `definition.apiKey` is provided,
 *   `{apikey}` is replaced with the key value for all URLs.
 * - If `apiKey` is absent and `definition.apiKeyRequired` is `true`,
 *   a warning is emitted and an empty array is returned (basemap disabled).
 * - If `apiKey` is absent and `apiKeyRequired` is not set (optional key, e.g. Stadia),
 *   the `{apikey}` placeholder and its query param are stripped — the URL remains valid
 *   for unauthenticated access.
 *
 * @param definition - Basemap configuration object.
 * @returns Array of resolved tile URL strings.
 */
export function normalizeTilesArray(definition: BasemapDefinition): string[] {
    let urls: string[];

    if (Array.isArray(definition.tiles) && definition.tiles.length > 0) {
        urls = definition.tiles as string[];
    } else {
        const url: string | undefined = definition.url;
        if (!url) return [];

        // PMTiles protocol — do not expand; MapLibre handles it natively
        if (url.startsWith("pmtiles://")) return [url];

        if (url.includes("{s}")) {
            const raw = definition.subdomains;
            const subs: string[] =
                typeof raw === "string"
                    ? raw.split("")
                    : Array.isArray(raw) && raw.length > 0
                      ? (raw as string[])
                      : ["a", "b", "c"];
            urls = subs.map((s) => url.replace("{s}", s));
        } else {
            urls = [url];
        }
    }

    // Inject API key if any URL contains the {apikey} placeholder
    const hasApiKeyPlaceholder = urls.some((u) => u.includes("{apikey}"));
    if (!hasApiKeyPlaceholder) return urls;

    const apiKey: string | undefined =
        typeof definition.apiKey === "string" ? definition.apiKey : undefined;

    if (apiKey) {
        return urls.map((u) => u.replace(/\{apikey\}/g, apiKey));
    }

    if (definition.apiKeyRequired) {
        // Key required but not provided — disable to avoid silent HTTP 403.
        const id: string = definition.id ?? definition.label ?? "(unknown)";
        Log.warn(
            `[GeoLeaf.Baselayers] Provider "${id}" requires an API key (apiKey field). Basemap disabled.`
        );
        return [];
    }

    // Key optional — strip the {apikey} query param so the URL remains valid
    // for unauthenticated access (e.g. Stadia Maps free tier).
    return urls.map(_stripApiKeyParam);
}

/**
 * Silence MapLibre GL v5 "Expected value to be of type number, but found null"
 * warnings emitted by the Liberty (OpenFreeMap) basemap style.
 * Applies fixed filters via setFilter() — no tile reloading.
 * @param glMap - Live MapLibre Map instance.
 */
export function applyLibertyFilters(glMap: NativeMap) {
    const PATCHES: Record<string, Record<string, number>> = {
        boundary_3: { admin_level: -1, maritime: 0, disputed: 0 },
        road_motorway_link: { ramp: 0 },
        road_motorway_link_casing: { ramp: 0 },
        road_link: { ramp: 0 },
        road_link_casing: { ramp: 0 },
        bridge_motorway_link: { ramp: 0 },
        bridge_motorway_link_casing: { ramp: 0 },
        tunnel_motorway_link: { ramp: 0 },
        tunnel_motorway_link_casing: { ramp: 0 },
        tunnel_link: { ramp: 0 },
        tunnel_link_casing: { ramp: 0 },
        road_one_way_arrow: { oneway: 0 },
        road_one_way_arrow_opposite: { oneway: 0 },
        label_city: { capital: 0 },
        label_city_capital: { capital: 0 },
        poi_r1: { rank: 0 },
        poi_r7: { rank: 0 },
        poi_r20: { rank: 0 },
        label_country_1: { rank: 0 },
        label_country_2: { rank: 0 },
        label_country_3: { rank: 0 },
    };

    function _patchExpr(expr: unknown, propMap: Record<string, number>): unknown {
        if (!Array.isArray(expr)) return expr;
        const arr = expr as unknown[];
        if (arr[0] === "get" && arr.length === 2 && typeof arr[1] === "string") {
            if (Object.prototype.hasOwnProperty.call(propMap, arr[1])) {
                return ["coalesce", arr, propMap[arr[1]]];
            }
        }
        return arr.map((item) => (Array.isArray(item) ? _patchExpr(item, propMap) : item));
    }

    for (const [layerId, propMap] of Object.entries(PATCHES)) {
        try {
            if (!glMap.getLayer(layerId)) continue;
            const currentFilter = glMap.getFilter(layerId);
            if (!currentFilter) continue;
            glMap.setFilter(layerId, _patchExpr(currentFilter, propMap));
        } catch (_e) {
            // layer absent from this style — skip silently
        }
    }
}
