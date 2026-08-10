/*!
 * @geoleaf-plugins/geocoding — Providers
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 *
 * Provider interface and built-in implementations (Addok BAN, Nominatim, Photon, custom).
 *
 * All providers normalize their responses into `GeocodingResult[]`.
 * User input is encoded with `encodeURIComponent` before being included in URLs.
 * Result labels are always set via `textContent` (never `innerHTML`) in the control.
 */

import type { GeocodingConfig, GeocodingResult } from "./types.js";

// ── Provider interface ────────────────────────────────────────────────────────

/**
 * Common interface every geocoding provider must implement.
 */
export interface IGeocodingProvider {
    /**
     * Searches for addresses matching the query.
     * @param query - Raw user input. Will be encoded internally.
     * @param limit - Maximum number of results to return.
     * @returns Normalized result array (empty array on error or no match).
     */
    search(query: string, limit: number): Promise<GeocodingResult[]>;
}

// ── Addok BAN (data.gouv.fr) ──────────────────────────────────────────────────

/**
 * Addok BAN provider — French national address database.
 * Free, no API key required, no quota for reasonable traffic.
 * When `config.bbox` is set, the centroid is passed as `lat`/`lon` for
 * proximity-score boosting (BAN has no strict bbox filter).
 * @see https://adresse.data.gouv.fr/api-doc/adresse
 */
export class AddokProvider implements IGeocodingProvider {
    constructor(private readonly _config: GeocodingConfig = {}) {}

    async search(query: string, limit: number): Promise<GeocodingResult[]> {
        let url =
            `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}` +
            `&limit=${limit}`;
        if (this._config.bbox) {
            const [west, south, east, north] = this._config.bbox;
            const lat = ((south + north) / 2).toFixed(5);
            const lon = ((west + east) / 2).toFixed(5);
            url += `&lat=${lat}&lon=${lon}`;
        }
        return _fetchAndParseGeoJSON(url);
    }
}

// ── Nominatim (OpenStreetMap) ─────────────────────────────────────────────────

/**
 * Nominatim provider — OpenStreetMap geocoder. Worldwide coverage.
 * Supports `countrycodes` (ISO 3166-1 alpha-2) and `bbox` for geographic filtering.
 * Must comply with OSM Nominatim usage policy: max 1 request/second.
 * @see https://nominatim.org/release-docs/latest/api/Search/
 */
export class NominatimProvider implements IGeocodingProvider {
    constructor(private readonly _config: GeocodingConfig = {}) {}

    async search(query: string, limit: number): Promise<GeocodingResult[]> {
        const lang = (typeof navigator !== "undefined" ? navigator.language : "fr") ?? "fr";
        let url =
            `https://nominatim.openstreetmap.org/search` +
            `?q=${encodeURIComponent(query)}&format=geocodejson&limit=${limit}&addressdetails=1`;
        if (this._config.countrycodes) {
            url += `&countrycodes=${encodeURIComponent(this._config.countrycodes)}`;
        }
        if (this._config.bbox) {
            // Nominatim viewbox format: left(west),top(north),right(east),bottom(south)
            const [west, south, east, north] = this._config.bbox;
            url += `&viewbox=${west},${north},${east},${south}&bounded=1`;
        }
        try {
            const res = await fetch(url, {
                headers: {
                    "Accept-Language": lang,
                    "User-Agent": "GeoLeaf/2 (https://geoleaf.dev)",
                },
            });
            if (!res.ok) return [];
            return _parseGeoJSON(await res.json());
        } catch {
            return [];
        }
    }
}

// ── Photon (Komoot) ───────────────────────────────────────────────────────────

/**
 * Photon provider — worldwide geocoder by Komoot. No API key required.
 * Supports `bbox` for geographic filtering (format: west,south,east,north).
 * @see https://photon.komoot.io/
 */
export class PhotonProvider implements IGeocodingProvider {
    constructor(private readonly _config: GeocodingConfig = {}) {}

    async search(query: string, limit: number): Promise<GeocodingResult[]> {
        const lang =
            (typeof navigator !== "undefined" ? navigator.language : "fr")
                ?.slice(0, 2)
                .toLowerCase() ?? "fr";
        let url =
            `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}` +
            `&limit=${limit}&lang=${encodeURIComponent(lang)}`;
        if (this._config.bbox) {
            // Photon bbox format: minLon,minLat,maxLon,maxLat (west,south,east,north)
            const [west, south, east, north] = this._config.bbox;
            url += `&bbox=${west},${south},${east},${north}`;
        }
        return _fetchAndParseGeoJSON(url);
    }
}

// ── Custom URL provider ───────────────────────────────────────────────────────

/**
 * Custom HTTPS endpoint provider.
 * The URL must return a GeoJSON FeatureCollection when called with `?q=` and `?limit=`.
 */
export class CustomProvider implements IGeocodingProvider {
    constructor(private readonly _baseUrl: string) {}

    async search(query: string, limit: number): Promise<GeocodingResult[]> {
        const separator = this._baseUrl.includes("?") ? "&" : "?";
        const url = `${this._baseUrl}${separator}q=${encodeURIComponent(query)}&limit=${limit}`;
        return _fetchAndParseGeoJSON(url);
    }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Creates the appropriate provider from a `GeocodingConfig`.
 * Defaults to `AddokProvider` for an unknown or missing provider value.
 * @internal
 */
export function createProvider(config: GeocodingConfig): IGeocodingProvider {
    const provider = config.provider ?? "addok";

    switch (provider) {
        case "addok":
            return new AddokProvider(config);
        case "nominatim":
            return new NominatimProvider(config);
        case "photon":
            return new PhotonProvider(config);
        default:
            // Custom HTTPS URL — validate scheme before accepting
            if (typeof provider === "string" && provider.startsWith("https://")) {
                return new CustomProvider(provider);
            }
            // Unknown / unsafe value: fall back to Addok
            return new AddokProvider(config);
    }
}

// ── Shared fetch + parse helpers ──────────────────────────────────────────────

/**
 * Fetches `url` and delegates to `_parseGeoJSON`.
 * Returns an empty array on any network or parsing error.
 * @internal
 */
async function _fetchAndParseGeoJSON(url: string): Promise<GeocodingResult[]> {
    try {
        const res = await fetch(url);
        if (!res.ok) return [];
        return _parseGeoJSON(await res.json());
    } catch {
        return [];
    }
}

/**
 * Normalizes a GeoJSON FeatureCollection from any supported provider
 * into a flat `GeocodingResult[]`.
 *
 * Security notes:
 * - All string values are coerced via `String()` — no dynamic property injection.
 * - Labels are length-capped at 200 characters to prevent oversized strings.
 * - `lat` / `lng` are validated with `isFinite` before inclusion.
 * - The raw feature is stored as-is but never rendered directly.
 * @internal
 */
function _parseGeoJSON(data: unknown): GeocodingResult[] {
    if (!data || typeof data !== "object") return [];

    const fc = data as Record<string, unknown>;
    if (!Array.isArray(fc["features"])) return [];

    const results: GeocodingResult[] = [];
    for (const feature of fc["features"] as unknown[]) {
        const result = _parseGeocodingFeature(feature);
        if (result) results.push(result);
    }

    return results;
}

/**
 * Parses a single GeoCodeJSON feature into a GeocodingResult, or null when the
 * feature is not a valid point Feature. Label is textContent only (never HTML).
 * @internal
 */
function _parseGeocodingFeature(feature: unknown): GeocodingResult | null {
    const f = feature as Record<string, unknown>;
    if (f["type"] !== "Feature") return null;

    const geometry = f["geometry"] as Record<string, unknown> | undefined;
    const properties = f["properties"] as Record<string, unknown> | undefined;
    const coords = geometry?.["coordinates"] as unknown[] | undefined;

    if (!Array.isArray(coords) || coords.length < 2) return null;

    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!isFinite(lat) || !isFinite(lng)) return null;

    // Build label — textContent only, never rendered as HTML.
    const label = _resolveGeocodingLabel(properties, lat, lng);

    const result: GeocodingResult = { label, lat, lng, raw: feature };

    // Optional bounding box for broad results (cities, departments, etc.)
    const bbox = f["bbox"] as number[] | undefined;
    if (Array.isArray(bbox) && bbox.length === 4) {
        // NaN defaults rather than four guards: a short bbox falls through the `isFinite`
        // test that already stands here, so the existing check does the work (qualite Q5).
        const [west = NaN, south = NaN, east = NaN, north = NaN] = bbox.map(Number);
        if ([west, south, east, north].every(isFinite)) {
            result.bounds = { north, south, east, west };
        }
    }

    return result;
}

/**
 * Resolves a geocoding label from a feature's properties (GeoCodeJSON / Nominatim
 * nest it under `geocoding.label`), capped at 200 chars. Falls back to "lat, lng".
 * @internal
 */
function _resolveGeocodingLabel(
    properties: Record<string, unknown> | undefined,
    lat: number,
    lng: number
): string {
    const geocodingMeta = properties?.["geocoding"] as Record<string, unknown> | undefined;
    const rawLabel =
        properties?.["label"] ??
        geocodingMeta?.["label"] ??
        properties?.["display_name"] ??
        geocodingMeta?.["name"] ??
        properties?.["name"] ??
        `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    return String(rawLabel).slice(0, 200);
}
