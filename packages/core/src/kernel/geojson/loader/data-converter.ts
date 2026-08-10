/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import { Log } from "../../../utils/log/index.js";

/** GeoJSON Feature (minimum shape used by this module) */

interface GeoJSONFeature {
    type: "Feature";
    id?: string;
    geometry: { type: string; coordinates: number[] | number[][] | number[][][] };
    properties: Record<string, unknown>;
}

/** GeoJSON FeatureCollection */

export interface GeoJSONFeatureCollection {
    type: "FeatureCollection";
    features: GeoJSONFeature[];
}

/** POI-like input for conversion */

interface PoiInput {
    id?: string;
    title?: string;
    description?: string;
    latlng?: [number, number];
    location?: { lat: number; lng: number };
    attributes?: Record<string, unknown>;
    [key: string]: unknown;
}

/** Route-like input */

interface RouteInput {
    id?: string;
    title?: string;
    description?: string;
    categoryId?: string;
    subCategoryId?: string;
    geometry?: { type: string; coordinates?: number[][] };
    attributes?: Record<string, unknown>;
    [key: string]: unknown;
}

/** Zone-like input */

interface ZoneInput {
    id?: string;
    title?: string;
    siteName?: string;
    description?: string;
    geometry?: { type: string; coordinates?: number[][][] };
    attributes?: Record<string, unknown>;
    [key: string]: unknown;
}

const emptyFC = (): GeoJSONFeatureCollection => ({ type: "FeatureCollection", features: [] });

// ---------------------------------------------------------

// Module-level helpers (reduce cyclomatic complexity)

// ---------------------------------------------------------

function _resolvePoiCoordinates(poi: PoiInput): [number, number] | null {
    if (Array.isArray(poi.latlng) && poi.latlng.length === 2) return [poi.latlng[1], poi.latlng[0]];
    if (
        poi.location &&
        typeof poi.location.lat === "number" &&
        typeof poi.location.lng === "number"
    )
        return [poi.location.lng, poi.location.lat];
    return null;
}

function _checkEarlyGeoJson(data: unknown): GeoJSONFeatureCollection | null {
    const d = data as { type?: string; features?: unknown[]; geometry?: unknown };
    if (d.type === "FeatureCollection" && Array.isArray(d.features)) {
        Log.debug("[DataConverter.autoConvert] Data already in GeoJSON, passing through");
        return data as GeoJSONFeatureCollection;
    }
    if (d.type === "Feature" && d.geometry) {
        Log.debug("[DataConverter.autoConvert] Single feature, converting to FeatureCollection");
        return { type: "FeatureCollection", features: [data as GeoJSONFeature] };
    }
    return null;
}

/** Common shape the generic converter relies on. */
interface ConvertibleInput {
    id?: string;
    title?: string;
    description?: string;
    attributes?: Record<string, unknown>;
}

/**
 * Per-kind differences between the three array converters. Everything else — the
 * not-an-array guard, the missing-id skip, the map/filter, the summary debug log and the
 * `"Sans titre"` default — is shared.
 */
interface ConversionSpec<T extends ConvertibleInput> {
    /** Method name, used verbatim as the log prefix so console output is unchanged. */
    label: string;
    /** Item noun as it appears in the skip messages ("POI", "Route", "Zone"). */
    noun: string;
    /** Message logged when `buildGeometry` rejects the item. */
    geometryError: string;
    /** Returns the feature geometry, or null when the item must be skipped. */
    buildGeometry(item: T): GeoJSONFeature["geometry"] | null;
    /** Title override — only zones have a secondary source (`siteName`). */
    resolveTitle?(item: T): string | undefined;
    /** Extra properties, merged BEFORE `attributes` so an attribute can still win. */
    extraProperties?(item: T): Record<string, unknown>;
}

/**
 * Shared body of convert{Poi,Route,Zone}ArrayToGeoJSON.
 * Console output is byte-identical to the three hand-rolled versions it replaces.
 */
function _convertArrayToGeoJSON<T extends ConvertibleInput>(
    input: unknown,
    spec: ConversionSpec<T>
): GeoJSONFeatureCollection {
    if (!Array.isArray(input)) {
        Log.warn(
            `[DataConverter.${spec.label}] Input is not an array, returning empty FeatureCollection`
        );
        return emptyFC();
    }
    const features = (input as T[])
        .map((item) => {
            if (!item || typeof item !== "object") return null;
            if (!item.id) {
                Log.warn(`[DataConverter.${spec.label}] ${spec.noun} without ID, skipped`, item);
                return null;
            }
            const geometry = spec.buildGeometry(item);
            if (!geometry) {
                Log.warn(`[DataConverter.${spec.label}] ${spec.geometryError}`, { id: item.id });
                return null;
            }
            return {
                type: "Feature",
                id: item.id,
                geometry,
                properties: {
                    id: item.id,
                    title: spec.resolveTitle?.(item) || item.title || "Sans titre",
                    description: item.description || "",
                    ...(spec.extraProperties?.(item) ?? {}),
                    ...(item.attributes as Record<string, unknown>),
                },
            } as GeoJSONFeature;
        })
        .filter((f): f is GeoJSONFeature => f !== null);
    Log.debug(`[DataConverter.${spec.label}] Converted`, {
        input: input.length,
        output: features.length,
    });
    return { type: "FeatureCollection", features };
}

function _detectPoiType(firstItem: Record<string, unknown>): "poi" | "route" | "zone" | "unknown" {
    if (
        firstItem.latlng ||
        (firstItem.location && typeof (firstItem.location as { lat?: number }).lat === "number")
    )
        return "poi";
    const geom = firstItem.geometry as { type?: string; coordinates?: unknown } | undefined;
    if (geom?.type === "LineString" && Array.isArray(geom.coordinates)) return "route";
    if (geom?.type === "Polygon" && Array.isArray(geom.coordinates)) return "zone";
    return "unknown";
}

const DataConverterModule = {
    /**
     * Convert an array of POI objects to a GeoJSON FeatureCollection.
     * @param poiArray - Array of POI objects with `id`, `latlng` (or `location`), and optional `attributes`.
     * @returns A GeoJSON FeatureCollection. Items without an id or valid coordinates are skipped.
     */
    convertPoiArrayToGeoJSON(poiArray: unknown): GeoJSONFeatureCollection {
        return _convertArrayToGeoJSON<PoiInput>(poiArray, {
            label: "convertPoiArrayToGeoJSON",
            noun: "POI",
            geometryError: "POI without valid coordinates, skipped",
            // The only kind that DERIVES its geometry (from latlng/location) instead of
            // reading an already-formed `geometry` block.
            buildGeometry: (poi) => {
                const coordinates = _resolvePoiCoordinates(poi);
                return coordinates ? { type: "Point", coordinates } : null;
            },
        });
    },
    /**
     * Convert an array of route objects to a GeoJSON FeatureCollection (LineString features).
     * @param routeArray - Array of route objects with `id` and a `geometry.type === "LineString"`.
     * @returns A GeoJSON FeatureCollection. Items without valid LineString geometry are skipped.
     */
    convertRouteArrayToGeoJSON(routeArray: unknown): GeoJSONFeatureCollection {
        return _convertArrayToGeoJSON<RouteInput>(routeArray, {
            label: "convertRouteArrayToGeoJSON",
            noun: "Route",
            geometryError: "Route without valid LineString geometry, skipped",
            buildGeometry: (route) =>
                route.geometry?.type === "LineString" && Array.isArray(route.geometry.coordinates)
                    ? { type: "LineString", coordinates: route.geometry.coordinates }
                    : null,
            extraProperties: (route) => ({
                categoryId: route.categoryId,
                subCategoryId: route.subCategoryId,
            }),
        });
    },
    /**
     * Convert an array of zone objects to a GeoJSON FeatureCollection (Polygon features).
     * @param zoneArray - Array of zone objects with `id` and a `geometry.type === "Polygon"`.
     * @returns A GeoJSON FeatureCollection. Items without valid Polygon geometry are skipped.
     */
    convertZoneArrayToGeoJSON(zoneArray: unknown): GeoJSONFeatureCollection {
        return _convertArrayToGeoJSON<ZoneInput>(zoneArray, {
            label: "convertZoneArrayToGeoJSON",
            noun: "Zone",
            geometryError: "Zone without valid Polygon geometry, skipped",
            buildGeometry: (zone) =>
                zone.geometry?.type === "Polygon" && Array.isArray(zone.geometry.coordinates)
                    ? { type: "Polygon", coordinates: zone.geometry.coordinates }
                    : null,
            // Zones are the only kind with a secondary title source.
            resolveTitle: (zone) => zone.title || zone.siteName,
        });
    },
    /**
     * Auto-detect the input data type and convert to a GeoJSON FeatureCollection.
     * Handles: existing GeoJSON pass-through, POI arrays, route arrays, zone arrays.
     * @param data - The input data. Can be a GeoJSON object or an array of POI/route/zone items.
     * @returns A GeoJSON FeatureCollection, or an empty one if the type cannot be determined.
     */
    autoConvert(data: unknown): GeoJSONFeatureCollection {
        if (!data) {
            Log.warn("[DataConverter.autoConvert] Null data, returning empty FeatureCollection");
            return emptyFC();
        }
        const early = _checkEarlyGeoJson(data);
        if (early) return early;
        if (!Array.isArray(data) || data.length === 0) {
            Log.warn("[DataConverter.autoConvert] Data is not an array or is empty");
            return emptyFC();
        }
        const firstItem = data[0] as Record<string, unknown>;
        if (!firstItem || typeof firstItem !== "object") {
            Log.warn("[DataConverter.autoConvert] First element is invalid");
            return emptyFC();
        }
        const type = _detectPoiType(firstItem);
        if (type === "poi") {
            Log.debug("[DataConverter.autoConvert] Detected as POI array");
            return this.convertPoiArrayToGeoJSON(data);
        }
        if (type === "route") {
            Log.debug("[DataConverter.autoConvert] Detected as route array");
            return this.convertRouteArrayToGeoJSON(data);
        }
        if (type === "zone") {
            Log.debug("[DataConverter.autoConvert] Detected as zone array");
            return this.convertZoneArrayToGeoJSON(data);
        }
        Log.warn("[DataConverter.autoConvert] Unrecognized data type");
        return emptyFC();
    },
};

const DataConverter = DataConverterModule;

export { DataConverter };
