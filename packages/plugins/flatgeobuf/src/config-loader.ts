/*!
 * GeoLeaf FlatGeobuf Plugin — Declarative JSON Config Loader
 *
 * Parses a declarative layer config object (as found in profiles JSON)
 * and delegates to loadAsLayer / loadBboxAsLayer accordingly.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

import type { FgbBbox, FgbLayerOptions } from "./types.js";
import { loadAsLayer, loadBboxAsLayer } from "./public-api.js";

// ─── Declarative config schema ────────────────────────────────────────────────

/**
 * Declarative JSON configuration for a FlatGeobuf layer, as used in profile
 * layer config files (e.g. `zones_desserte_config.json`).
 *
 * @example
 * ```json
 * {
 *   "id": "zones_desserte",
 *   "label": "Zones de desserte SNCF",
 *   "plugin": "flatgeobuf",
 *   "data": {
 *     "url": "data/zones_desserte_sncf.fgb",
 *     "bbox": [2.225, 41.362, 8.227, 51.089],
 *     "limit": 1000,
 *     "autoRefresh": true,
 *     "debounceMs": 500
 *   }
 * }
 * ```
 */
export interface FgbLayerJsonConfig {
    /** Layer identifier, used as MapLibre source/layer ID. */
    id: string;
    /** Human-readable layer name shown in the UI. */
    label?: string;
    /** Must be `"flatgeobuf"` — used by the profile loader to route to this plugin. */
    plugin: "flatgeobuf";
    data: {
        /** URL of the `.fgb` file (absolute or relative to the deployed profile root). */
        url: string;
        /**
         * Optional bounding box filter `[W, S, E, N]` (minLng, minLat, maxLng, maxLat).
         * When present, uses FGB R-tree spatial index + HTTP Range requests.
         */
        bbox?: [number, number, number, number];
        /** Maximum number of features to load (anti-DoS). Default: 100 000. */
        limit?: number;
        /** Re-fetch features when the map viewport changes (`moveend`). Default: false. */
        autoRefresh?: boolean;
        /** Debounce delay in ms for auto-refresh. Default: 300. */
        debounceMs?: number;
    };
    /** Initial layer visibility. Default: true. */
    defaultVisible?: boolean;
    /** Enable point clustering. Default: false. */
    cluster?: boolean;
    /** Geometry hint (`point` / `line` / `polygon`) — forwarded to the adapter for sub-layer creation. */
    geometry?: string;
    /** Stacking order — forwarded to the adapter for layer ordering. */
    zIndex?: number;
    /**
     * Profile id, injected by the core profile loader when dispatching a declarative
     * `plugin: "flatgeobuf"` layer. Used to resolve a profile-relative `data.url`.
     * @internal
     */
    _profileId?: string;
}

// ─── URL resolution ───────────────────────────────────────────────────────────

/**
 * Resolves a profile-relative `data.url` (e.g. `data/zones.fgb`) to an absolute URL
 * rooted at the active profile, so the core URL validator (which requires an absolute
 * URL) accepts it and `fetch` targets the right path.
 *
 * Absolute (`http(s)://`) and `data:` URLs pass through unchanged. Profile-relative
 * URLs are prefixed with `<profilesBasePath>/<profileId>/` then made absolute against
 * the document origin. Mirrors the core `_resolveProfileBasePath` convention.
 * @internal
 */
function resolveProfileUrl(url: string, profileId?: string): string {
    if (/^https?:\/\//i.test(url) || url.startsWith("data:")) return url;
    const dataCfg = (
        globalThis as { GeoLeaf?: { Config?: { get?: (k: string) => unknown } } }
    ).GeoLeaf?.Config?.get?.("data") as { profilesBasePath?: string } | undefined;
    const basePath = dataCfg?.profilesBasePath || "profiles";
    const rooted = url.startsWith("/") || !profileId ? url : `${basePath}/${profileId}/${url}`;
    if (typeof location !== "undefined" && location.origin) {
        try {
            return new URL(rooted, location.origin).href;
        } catch {
            /* fall through to the rooted path */
        }
    }
    return rooted;
}

// ─── loadLayerFromConfig ──────────────────────────────────────────────────────

/**
 * Loads a FlatGeobuf layer from a declarative JSON configuration object.
 *
 * - If `config.data.bbox` is defined, delegates to `loadBboxAsLayer` with HTTP Range
 *   spatial filtering and optional auto-refresh on viewport change.
 * - Otherwise, delegates to `loadAsLayer` to load the complete file.
 *
 * @param config - Declarative layer configuration (e.g. parsed from a profile JSON file).
 * @returns The created MapLibre layer ID.
 *
 * @example
 * ```typescript
 * const layerId = await GeoLeaf.FlatGeobuf.loadLayerFromConfig({
 *   id: "eco_regions_fgb",
 *   label: "Éco-régions (FlatGeobuf)",
 *   plugin: "flatgeobuf",
 *   data: { url: "layers/eco_regions_fgb/data/eco_regions.fgb", limit: 50000 }
 * });
 * ```
 */
export async function loadLayerFromConfig(config: FgbLayerJsonConfig): Promise<string> {
    const { id, label, data, defaultVisible, cluster, geometry, zIndex } = config;
    const url = resolveProfileUrl(data.url, config._profileId);

    // Construction conditionnelle, et pas seulement pour satisfaire le compilateur : cet
    // objet est ETALE treize lignes plus bas (`...layerOpts`). Y poser six cles valant
    // `undefined` reviendrait a ecraser dans la cible ce que l'absence aurait laisse intact.
    const layerOpts: FgbLayerOptions = {
        layerId: id,
        ...(label !== undefined && { layerName: label }),
        ...(data.limit !== undefined && { maxFeatures: data.limit }),
        ...(defaultVisible !== undefined && { visible: defaultVisible }),
        ...(cluster !== undefined && { cluster }),
        ...(geometry !== undefined && { geometry }),
        ...(zIndex !== undefined && { zIndex }),
    };

    if (data.bbox) {
        const [minX, minY, maxX, maxY] = data.bbox;
        const bbox: FgbBbox = { minX, minY, maxX, maxY };
        return loadBboxAsLayer(url, bbox, {
            ...layerOpts,
            autoRefresh: data.autoRefresh ?? false,
            ...(data.debounceMs !== undefined && { debounceMs: data.debounceMs }),
        });
    }

    return loadAsLayer(url, layerOpts);
}
