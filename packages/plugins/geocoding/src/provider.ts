/*!
 * @geoleaf-plugins/geocoding — Providers
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 *
 * Provider interface and the built-in NETWORK implementations (Addok BAN, Nominatim, Photon,
 * custom URL). Which of them a search asks is decided in `provider-registry.ts`.
 *
 * All providers normalize their responses into `GeocodingResult[]`.
 * User input is encoded with `encodeURIComponent` before being included in URLs.
 * Result labels are always set via `textContent` (never `innerHTML`) in the control.
 */

import type { GeocodingConfig, GeocodingResult } from "./types.js";
import { tLabel } from "@geoleaf/host-runtime";

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
    /**
     * `false` for a provider that never touches the network, which is therefore asked
     * off-network too. Absent means it needs the network.
     */
    readonly network?: boolean;
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

    _separateHomonyms(results);
    return results;
}

/**
 * Two results that still read the same — same label, same detail — get their administrative level
 * appended when the provider gives one (Nominatim `geocoding.admin`): a commune and the
 * arrondissement of the same name otherwise come back as two identical lines. The level is named
 * through `geocoding.detail.adminLevel<N>` (8 municipality, 7 district, 6 county); a level without
 * such a key falls back to the numbered `geocoding.detail.adminLevel`. Only the colliding results
 * get it, so the common case stays short.
 * @internal
 */
function _separateHomonyms(results: GeocodingResult[]): void {
    const groups = new Map<string, GeocodingResult[]>();
    for (const r of results) {
        const key = `${r.label}\u0000${r.detail ?? ""}`;
        const group = groups.get(key);
        if (group) group.push(r);
        else groups.set(key, [r]);
    }
    const template = tLabel("geocoding.detail.adminLevel", "");
    if (!template) return;
    for (const group of groups.values()) {
        if (group.length < 2) continue;
        const levels = group.map((r) => _ownAdminLevel(r.raw));
        if (new Set(levels).size < 2) continue;
        group.forEach((r, i) => {
            const level = levels[i];
            if (level === undefined) return;
            const part =
                tLabel(`geocoding.detail.adminLevel${level}`, "") ||
                template.replace("{level}", String(level));
            r.detail = (r.detail ? `${r.detail} · ${part}` : part).slice(0, 120);
        });
    }
}

/**
 * The administrative level a Nominatim result stands at: the deepest `geocoding.admin.levelN`
 * that carries the result's own name, else the deepest one given. Undefined without `admin`.
 * @internal
 */
function _ownAdminLevel(raw: unknown): number | undefined {
    const props = (raw as { properties?: Record<string, unknown> } | undefined)?.properties;
    const geo = props?.["geocoding"] as Record<string, unknown> | undefined;
    const admin = geo?.["admin"];
    if (!admin || typeof admin !== "object") return undefined;
    const name = geo?.["name"];
    let deepest: number | undefined;
    let named: number | undefined;
    for (const [k, v] of Object.entries(admin as Record<string, unknown>)) {
        const m = /^level(\d{1,2})$/.exec(k);
        if (!m || typeof v !== "string") continue;
        const n = Number(m[1]);
        if (deepest === undefined || n > deepest) deepest = n;
        if (v === name && (named === undefined || n > named)) named = n;
    }
    return named ?? deepest;
}

/**
 * The provider's kind (`type`, `osm_value`, `addresstype` — English words such as `municipality`
 * or `city`) in the active language, through the `geocoding.kind.<kind>` keys. A kind the
 * dictionaries do not translate is left out rather than shown raw.
 * @internal
 */
function _translatedKind(values: Array<unknown>): string | undefined {
    for (const v of values) {
        if (typeof v !== "string" || !/^[a-z_]{1,40}$/.test(v)) continue;
        const label = tLabel(`geocoding.kind.${v}`, "");
        if (label) return label;
    }
    return undefined;
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
    const detail = _resolveGeocodingDetail(properties, label);
    if (detail) result.detail = detail;

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
 * What distinguishes two results with the same label: « Saint-Denis » came back twice from BAN and
 * from Photon, « Saint-Denis, Réunion, France » twice from Nominatim, and nothing told them apart.
 * Built from what the three providers carry — postcode, kind (translated, or left out), then the
 * wider context — leaving out any part the label already says. Capped, and rendered as text only.
 * @internal
 */
function _resolveGeocodingDetail(
    properties: Record<string, unknown> | undefined,
    label: string
): string | undefined {
    const geo = (properties?.["geocoding"] as Record<string, unknown> | undefined) ?? {};
    const pick = (...keys: string[]): string | undefined => {
        for (const k of keys) {
            const v = properties?.[k] ?? geo[k];
            if (typeof v === "string" && v.trim() !== "") return v.trim();
            if (typeof v === "number") return String(v);
        }
        return undefined;
    };
    const kindKeys = ["type", "osm_value", "addresstype"];
    const parts = [
        pick("postcode"),
        _translatedKind(kindKeys.flatMap((k) => [properties?.[k], geo[k]])),
        pick("context", "county", "state", "city"),
    ].filter((p): p is string => !!p && !label.includes(p));
    const unique = [...new Set(parts)];
    return unique.length > 0 ? unique.join(" · ").slice(0, 120) : undefined;
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
