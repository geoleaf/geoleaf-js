/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Route capability — endpoint derivation.
 *
 * Derives the start / end point of each line feature in a bound layer. The line
 * itself is rendered by the GeoJSON engine; this only builds the endpoint marker
 * geometry (`Point` features) to hand to `addGeoJSONLayer`.
 */

/** Endpoint role carried on the derived point features. */
type EndpointRole = "start" | "end";

/** First / last positions of a line geometry. */
interface Ends {
    start: GeoJSON.Position;
    end: GeoJSON.Position;
}

/** Extracts the first / last positions of a LineString / MultiLineString, else `null`. */
function firstLastPositions(geometry: GeoJSON.Geometry | null): Ends | null {
    if (!geometry) return null;
    if (geometry.type === "LineString") {
        const c = geometry.coordinates;
        const start = c[0];
        const end = c[c.length - 1];
        if (!start || !end) return null;
        return { start, end };
    }
    if (geometry.type === "MultiLineString") {
        const segs = geometry.coordinates;
        const first = segs.find((s) => s.length > 0);
        let lastSeg: GeoJSON.Position[] | undefined;
        for (let i = segs.length - 1; i >= 0; i--) {
            const s = segs[i];
            if (s && s.length > 0) {
                lastSeg = s;
                break;
            }
        }
        const start = first?.[0];
        const end = lastSeg?.[lastSeg.length - 1];
        if (!start || !end) return null;
        return { start, end };
    }
    return null;
}

/** Reads a stable route id from a feature (top-level `id` then `properties.id`). */
function featureRouteId(feature: GeoJSON.Feature): string | number | null {
    if (feature.id != null) return feature.id;
    const props = feature.properties as Record<string, unknown> | null;
    const pid = props?.id;
    return typeof pid === "string" || typeof pid === "number" ? pid : null;
}

/** Builds one endpoint point feature (`pos` is reused verbatim as `[lng, lat]`). */
function endpointFeature(
    pos: GeoJSON.Position,
    role: EndpointRole,
    routeId: string | number | null
): GeoJSON.Feature {
    return {
        type: "Feature",
        geometry: { type: "Point", coordinates: pos },
        properties: { role, routeId },
    };
}

/**
 * Derives the endpoint point features for a set of line features. Only
 * LineString / MultiLineString features contribute; others are skipped.
 *
 * @param features - The bound layer's features.
 * @param role - Which endpoint to emit (`start` or `end`).
 * @returns A `FeatureCollection` of `Point` features (may be empty).
 */
export function deriveEndpoints(
    features: readonly GeoJSON.Feature[],
    role: EndpointRole
): GeoJSON.FeatureCollection {
    const out: GeoJSON.Feature[] = [];
    for (const f of features) {
        const ends = firstLastPositions(f.geometry ?? null);
        if (!ends) continue;
        out.push(
            endpointFeature(role === "start" ? ends.start : ends.end, role, featureRouteId(f))
        );
    }
    return { type: "FeatureCollection", features: out };
}
