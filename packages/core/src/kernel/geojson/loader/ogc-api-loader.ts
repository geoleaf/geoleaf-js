/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf OGC API Features Loader
 *
 * Fetches GeoJSON features from an OGC API Features endpoint with support for:
 * - Automatic pagination via `next` link relations
 * - Bounding-box (`bbox`) query filtering
 * - Hard `maxFeatures` cap (memory anti-DoS)
 * - Cooperative cancellation via `AbortSignal`
 * - WKT geometry fallback (detects string geometry → converts via wktToGeoJSON)
 * - Auto-refresh on map `moveend` events with debouncing
 */

import { validateUrl } from "../../../utils/general/utils-base.js";
import { debounce } from "../../../utils/general/utils-base.js";
import { wktToGeoJSON } from "../../../utils/geo/wkt-parser.js";
import { getLog } from "../../../utils/general/di-accessors.js";
import type { OgcApiConfig } from "./loader-types.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface OgcLink {
    href: string;
    rel?: string;
    type?: string;
}

interface OgcFeatureCollection {
    type: string;
    features?: unknown[];
    links?: OgcLink[];
    numberReturned?: number;
    numberMatched?: number;
}

interface GeoJSONFeature {
    type: "Feature";
    geometry: unknown;
    properties: Record<string, unknown> | null;
    [key: string]: unknown;
}

interface GeoJSONFeatureCollection {
    type: "FeatureCollection";
    features: GeoJSONFeature[];
}

// Minimal map interface for autoRefresh (avoids direct MapLibre import)
interface MapLike {
    on: (event: string, handler: () => void) => void;
    off: (event: string, handler: () => void) => void;
    getBounds?: () => {
        getWest: () => number;
        getSouth: () => number;
        getEast: () => number;
        getNorth: () => number;
    };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_FEATURES = 10_000;
const DEFAULT_LIMIT = 1_000;
const DEFAULT_DEBOUNCE_MS = 300;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _buildItemsUrl(config: OgcApiConfig): string {
    let base = config.url.trim().replace(/\/$/, "");
    if (config.collectionId && !base.endsWith("/items")) {
        base = `${base}/collections/${config.collectionId}/items`;
    }
    return base;
}

function _buildRequestUrl(
    base: string,
    config: OgcApiConfig,
    bbox?: [number, number, number, number],
    offset?: number
): string {
    // Use URL constructor to correctly merge any existing query params in base
    const url = new URL(base);
    url.searchParams.set("f", "json");
    const limit = config.limit ?? DEFAULT_LIMIT;
    url.searchParams.set("limit", String(limit));
    const effectiveBbox = bbox ?? config.bbox;
    if (effectiveBbox) {
        url.searchParams.set("bbox", effectiveBbox.join(","));
    }
    if (offset && offset > 0) {
        url.searchParams.set("offset", String(offset));
    }
    return url.toString();
}

function _extractNextUrl(response: OgcFeatureCollection): string | null {
    if (!Array.isArray(response.links)) return null;
    const next = response.links.find(
        (l) => l.rel === "next" && typeof l.href === "string" && l.href.length > 0
    );
    return next ? next.href : null;
}

/**
 * Resolves WKT string geometries in a GeoJSON feature to proper GeoJSON geometry objects.
 * Some OGC API Features implementations return WKT strings instead of GeoJSON geometry.
 */
function _resolveWktGeometry(features: unknown[]): GeoJSONFeature[] {
    return features.map((rawFeature) => {
        const f = rawFeature as GeoJSONFeature;
        if (typeof f.geometry === "string") {
            const converted = wktToGeoJSON(f.geometry);
            return { ...f, geometry: converted };
        }
        return f;
    });
}

/**
 * Validates that `data` is an OGC API Features-compatible response object.
 */
function _validateOgcResponse(data: unknown): data is OgcFeatureCollection {
    if (!data || typeof data !== "object") return false;
    const d = data as Record<string, unknown>;
    if (d["type"] !== "FeatureCollection") return false;
    if (d["features"] !== undefined && !Array.isArray(d["features"])) return false;
    return true;
}

// ─── Core fetch function ──────────────────────────────────────────────────────

/**
 * Fetches and validates a single page from an OGC API Features endpoint.
 * @returns The validated OGC response, or `null` if the request was aborted or the URL is invalid.
 * @throws Error on network failure or malformed response.
 * @internal
 */
async function _fetchPage(
    url: string,
    signal: AbortSignal | undefined,
    headers: Record<string, string>
): Promise<OgcFeatureCollection | null> {
    const Log = getLog();

    const safeUrl = validateUrl(url);
    if (!safeUrl) {
        Log.warn("[OgcApiLoader] Skipping invalid URL:", url.substring(0, 100));
        return null;
    }

    let response: Response;
    try {
        response = await fetch(safeUrl, { signal: signal ?? null, headers });
    } catch (err) {
        if ((err as Error).name === "AbortError") {
            Log.info("[OgcApiLoader] Fetch aborted by signal");
            return null;
        }
        throw new Error(
            `[OgcApiLoader] Network error fetching "${safeUrl}": ${(err as Error).message}`,
            { cause: err }
        );
    }

    if (!response.ok) {
        throw new Error(`[OgcApiLoader] HTTP ${response.status} from "${safeUrl}"`);
    }

    let data: unknown;
    try {
        data = await response.json();
    } catch (err) {
        throw new Error(`[OgcApiLoader] Failed to parse JSON response: ${(err as Error).message}`, {
            cause: err,
        });
    }

    if (!_validateOgcResponse(data)) {
        throw new Error(
            `[OgcApiLoader] Response is not a valid FeatureCollection (type="${(data as { type?: unknown })?.type}")`
        );
    }

    return data;
}

/**
 * Fetches all features from an OGC API Features endpoint, following `next` pagination links.
 *
 * Security controls applied:
 * - URL validated via `validateUrl()` before any network request
 * - All requests carry the provided `AbortSignal` for cooperative cancellation
 * - `maxFeatures` limit enforced to prevent memory exhaustion
 * - Response `type` field validated before data consumption
 *
 * @param config - OGC API source configuration.
 * @param signal - AbortSignal for cooperative cancellation.
 * @param bbox - Override bounding box (used by autoRefresh to inject viewport bbox).
 * @returns A GeoJSON FeatureCollection.
 * @throws Error if the URL is invalid, the network request fails, or the response is malformed.
 */
export async function fetchOgcApiFeatures(
    config: OgcApiConfig,
    signal?: AbortSignal,
    bbox?: [number, number, number, number]
): Promise<GeoJSONFeatureCollection> {
    const Log = getLog();
    const maxFeatures = config.maxFeatures ?? DEFAULT_MAX_FEATURES;

    const validatedUrl = validateUrl(config.url);
    if (!validatedUrl) {
        throw new Error(`[OgcApiLoader] Invalid or disallowed URL: "${config.url}"`);
    }

    const baseItemsUrl = _buildItemsUrl(config);
    const accumulated: GeoJSONFeature[] = [];
    let nextUrl: string | null = _buildRequestUrl(baseItemsUrl, config, bbox);
    const headers = config.headers ?? {};

    while (nextUrl !== null) {
        if (signal?.aborted) {
            Log.info("[OgcApiLoader] Request aborted");
            break;
        }

        const page = await _fetchPage(nextUrl, signal, headers);
        if (!page) break;

        const resolved = _resolveWktGeometry(page.features ?? []);
        accumulated.push(...resolved);

        Log.debug(
            `[OgcApiLoader] Page loaded: ${resolved.length} features (total: ${accumulated.length})`
        );

        if (accumulated.length >= maxFeatures) {
            Log.warn(
                `[OgcApiLoader] maxFeatures limit reached (${maxFeatures}). Stopping pagination.`
            );
            break;
        }

        nextUrl = _extractNextUrl(page);
    }

    return { type: "FeatureCollection", features: accumulated };
}

// ─── Auto-refresh ─────────────────────────────────────────────────────────────

/**
 * Registers a `moveend` listener on the map to re-fetch OGC features when
 * the viewport changes. The listener is debounced to avoid flooding the server.
 *
 * @param map - MapLibre map instance (minimal interface).
 * @param config - OGC API source configuration.
 * @param reloadFn - Callback invoked with the current viewport bbox on each refresh.
 * @returns A cleanup function that removes the listener. Call it on layer removal.
 */
export function setupAutoRefresh(
    map: MapLike,
    config: OgcApiConfig,
    reloadFn: (bbox: [number, number, number, number]) => void
): () => void {
    const Log = getLog();
    const ms = config.autoRefreshDebounce ?? DEFAULT_DEBOUNCE_MS;

    const handler = debounce(() => {
        const bounds = map.getBounds?.();
        if (!bounds) return;
        const bbox: [number, number, number, number] = [
            bounds.getWest(),
            bounds.getSouth(),
            bounds.getEast(),
            bounds.getNorth(),
        ];
        Log.debug("[OgcApiLoader] autoRefresh triggered, bbox:", bbox);
        reloadFn(bbox);
    }, ms);

    map.on("moveend", handler as () => void);
    return () => map.off("moveend", handler as () => void);
}
