/*!
 * @geoleaf-plugins/geocoding — Types
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 *
 * Plugin-local type definitions for the Geocoding / address search plugin.
 *
 * `GeocodingConfig` was historically declared in core (`config-types.ts`) and
 * read from the root `geocodingConfig` profile key. Since the extraction it lives
 * here and is read from the `modules.geocoding.*` namespace (Plugin Contract v1,
 * INV-CONFIG).
 */

/**
 * Geocoding / address search configuration.
 *
 * Read from the active profile under `modules.geocoding.*`.
 * All keys are optional and merge with built-in defaults.
 */
export interface GeocodingConfig {
    /** Enable the address search control on the map. Default false. */
    enabled?: boolean;
    /**
     * Service(s) a search asks — one, or an ordered list of them (since 1.1.0).
     * - `"addok"` (default): French BAN (data.gouv.fr) — no API key required.
     * - `"nominatim"`: OpenStreetMap Nominatim — worldwide.
     * - `"photon"`: Photon by Komoot — worldwide, no API key.
     * - `"layers"`: the features the map holds, in the layers declaring `searchable`
     *   (`GeoLeaf.Layers.search`) — needs no network. Since 1.1.0.
     * - HTTPS URL string: custom endpoint returning a GeoJSON FeatureCollection.
     * - A name added with `GeoLeaf.Geocoding.registerProvider`.
     *
     * A list is asked in order and its results kept in that order; off-network, the
     * providers needing the network are skipped. An unknown single value falls back on
     * `"addok"` with a warning, and will be refused from the next minor version; an
     * unknown name inside a list is refused at once.
     */
    provider?: "addok" | "nominatim" | "photon" | "layers" | string | readonly string[];
    /** Debounce delay in milliseconds. Default 300. */
    debounceMs?: number;
    /** Minimum characters before triggering search. Default 3. */
    minChars?: number;
    /** Maximum results to display. Default 5. */
    resultLimit?: number;
    /** Control position on the map. Default "top-left". */
    position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
    /** Input placeholder text. Default "Rechercher une adresse…". */
    placeholder?: string;
    /** Zoom level when flying to a point result. Default 15. */
    flyToZoom?: number;
    /**
     * Bounding box restricting search results to a geographic area.
     * Format: `[west, south, east, north]` in WGS-84 decimal degrees.
     * - Nominatim: maps to `viewbox` + `bounded=1` (strict filter).
     * - Photon: maps to `bbox` (strict filter).
     * - Addok: maps to `lat`/`lon` proximity bias (centroid of the box).
     */
    bbox?: [number, number, number, number];
    /**
     * ISO 3166-1 alpha-2 country code(s) to restrict results.
     * Comma-separated for multiple countries (e.g. `"fr"`, `"ar"`, `"fr,ch"`).
     * Supported by Nominatim only — ignored by Addok and Photon.
     */
    countrycodes?: string;
}

/**
 * A normalized address search result returned by any provider.
 */
export interface GeocodingResult {
    /** Display label shown in the dropdown and set as input value on selection. */
    label: string;

    /** WGS-84 latitude of the result. */
    lat: number;

    /** WGS-84 longitude of the result. */
    lng: number;

    /**
     * Optional bounding box for broad results (cities, regions).
     * When present, `fitBounds` is used instead of `flyTo`.
     */
    bounds?: { north: number; south: number; east: number; west: number };

    /**
     * Layer of the feature this result names — set by the `layers` provider, absent for an
     * address. A result carrying it is focused (`GeoLeaf.Layers.focus`) when selected.
     */
    layerId?: string;

    /** Display label of that layer. */
    layerLabel?: string;

    /** Id of the feature, or `null` when it has none (it is then framed, not selected). */
    featureId?: string | null;

    /**
     * Raw provider response item.
     * Do not display directly — always use the normalized `label` field.
     * @internal
     */
    raw?: unknown;
}
