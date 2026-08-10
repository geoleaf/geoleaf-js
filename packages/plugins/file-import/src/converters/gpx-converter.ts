/*!
 * GeoLeaf File Import Plugin — GPX Converter
 * Converts GPX (GPS Exchange Format) XML to GeoJSON FeatureCollection.
 *
 * Supports: waypoints <wpt>, tracks <trk>, routes <rte>, elevation <ele>,
 * timestamps <time>, metadata <metadata>, fields <cmt>/<src>/<type>/<link>,
 * Garmin extensions (speed, cadence, heart rate).
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { Feature, Geometry, Point, LineString } from "geojson";
import type { IFileConverter, ConvertResult, GeoJSONFeatureCollection } from "./i-converter.js";
import { emptyFC } from "./i-converter.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _getOptionalText(parent: Element, tag: string): string | undefined {
    const el = parent.getElementsByTagName(tag)[0];
    return el?.textContent?.trim() || undefined;
}

function _getOptionalFloat(parent: Element, tag: string): number | undefined {
    const txt = _getOptionalText(parent, tag);
    if (txt == null) return undefined;
    const n = parseFloat(txt);
    return Number.isFinite(n) ? n : undefined;
}

/** Parse GPX <extensions> child elements into a flat record. */
function _parseExtensions(el: Element): Record<string, unknown> {
    const ext: Record<string, unknown> = {};
    // Guard the value rather than the collection length: same single branch, and it is the
    // one the compiler can follow (qualite Q5).
    const extEl = el.getElementsByTagName("extensions")[0];
    if (!extEl) return ext;

    const tags: string[] = [];

    for (const child of extEl.childNodes) {
        if (child.nodeType !== 1) continue;
        const childEl = child as Element;
        const localName = childEl.localName;
        const val = childEl.textContent?.trim() ?? "";

        // Garmin TrackPointExtension fields
        if (localName === "speed" || localName === "hr" || localName === "cad") {
            const n = parseFloat(val);
            if (Number.isFinite(n)) ext[localName] = n;
        } else if (localName === "tag" || localName === "tags") {
            if (val) tags.push(val);
        } else if (val) {
            ext[localName] = val;
        }
    }
    if (tags.length > 0) ext.tags = tags;
    return ext;
}

/** Parse <link> elements to an array of {href, text, type}. */
function _parseLinks(parent: Element): Array<{ href: string; text?: string; type?: string }> {
    const links: Array<{ href: string; text?: string; type?: string }> = [];
    const linkEls = parent.getElementsByTagName("link");
    for (const linkEl of linkEls) {
        const href = linkEl.getAttribute("href");
        if (!href) continue;
        const text = _getOptionalText(linkEl, "text");
        const type = _getOptionalText(linkEl, "type");
        links.push({
            href,
            ...(text !== undefined && { text }),
            ...(type !== undefined && { type }),
        });
    }
    return links;
}

/** Compute elevation profile stats from an array of elevations. */
function _computeElevationProfile(elevations: number[]): {
    min: number;
    max: number;
    gain: number;
    loss: number;
} {
    let min = Infinity;
    let max = -Infinity;
    let gain = 0;
    let loss = 0;

    // Pairwise walk: the previous elevation is carried, not re-read from an index.
    let prev: number | undefined;
    for (const e of elevations) {
        if (e < min) min = e;
        if (e > max) max = e;
        if (prev !== undefined) {
            const diff = e - prev;
            if (diff > 0) gain += diff;
            else loss += Math.abs(diff);
        }
        prev = e;
    }

    return {
        min: Number.isFinite(min) ? min : 0,
        max: Number.isFinite(max) ? max : 0,
        gain: Math.round(gain * 100) / 100,
        loss: Math.round(loss * 100) / 100,
    };
}

// ─── Track point parsing (shared between <trk> and <rte>) ────────────────────

interface ParsedTrackPoint {
    coord: number[];
    elevation?: number;
    time?: string;
    extensions: Record<string, unknown>;
}

function _parseTrackPoints(points: HTMLCollectionOf<Element>): ParsedTrackPoint[] {
    const result: ParsedTrackPoint[] = [];
    for (const pt of points) {
        const lat = parseFloat(pt.getAttribute("lat") || "");
        const lon = parseFloat(pt.getAttribute("lon") || "");
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        const ele = _getOptionalFloat(pt, "ele");
        const coord = ele != null ? [lon, lat, ele] : [lon, lat];
        const time = _getOptionalText(pt, "time");
        const extensions = _parseExtensions(pt);

        result.push({
            coord,
            ...(ele != null && { elevation: ele }),
            ...(time !== undefined && { time }),
            extensions,
        });
    }
    return result;
}

// ─── Waypoints ────────────────────────────────────────────────────────────────

function _processWaypoints(
    gpxDoc: Document,
    features: Feature<Geometry>[],
    warnings: string[]
): void {
    const waypoints = gpxDoc.getElementsByTagName("wpt");

    // `.entries()` keeps the index the warnings and generated ids need, without paying a second
    // indexed read for the element itself (qualite Q5).
    for (const [i, wpt] of [...waypoints].entries()) {
        const lat = parseFloat(wpt.getAttribute("lat") || "");
        const lon = parseFloat(wpt.getAttribute("lon") || "");

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            warnings.push(`Waypoint ${i}: invalid coordinates, skipped`);
            continue;
        }

        const ele = _getOptionalFloat(wpt, "ele");
        const coord = ele != null ? [lon, lat, ele] : [lon, lat];
        const ext = _parseExtensions(wpt);
        const links = _parseLinks(wpt);
        const name = _getOptionalText(wpt, "name");
        const id = (ext.id as string) || name || `wpt-${i}`;

        const properties: Record<string, unknown> = {
            id,
            title: name || `Waypoint ${i + 1}`,
            description: _getOptionalText(wpt, "desc") ?? "",
            symbol: _getOptionalText(wpt, "sym") ?? "",
            featureType: "waypoint",
            ...ext,
        };

        // Optional GPX standard fields
        const cmt = _getOptionalText(wpt, "cmt");
        if (cmt) properties.comment = cmt;
        const src = _getOptionalText(wpt, "src");
        if (src) properties.source = src;
        const type = _getOptionalText(wpt, "type");
        if (type) properties.type = type;
        if (links.length > 0) properties.links = links;
        if (ele != null) properties.elevation = ele;

        const time = _getOptionalText(wpt, "time");
        if (time) properties.timestamp = time;

        const geometry: Point = { type: "Point", coordinates: coord };
        features.push({ type: "Feature", id, geometry, properties });
    }
}

// ─── Tracks ───────────────────────────────────────────────────────────────────

function _processTracks(gpxDoc: Document, features: Feature<Geometry>[], warnings: string[]): void {
    const tracks = gpxDoc.getElementsByTagName("trk");

    for (const [i, trk] of [...tracks].entries()) {
        const trkName = _getOptionalText(trk, "name");
        const trkDesc = _getOptionalText(trk, "desc");
        const ext = _parseExtensions(trk);
        const links = _parseLinks(trk);
        const segments = trk.getElementsByTagName("trkseg");

        for (const [j, segment] of [...segments].entries()) {
            const trkpts = segment.getElementsByTagName("trkpt");
            const parsed = _parseTrackPoints(trkpts);

            if (parsed.length === 0) {
                warnings.push(`Track ${i} segment ${j}: no valid points, skipped`);
                continue;
            }

            const coordinates = parsed.map((p) => p.coord);
            const elevations = parsed.filter((p) => p.elevation != null).map((p) => p.elevation!);
            const timestamps = parsed.filter((p) => p.time != null).map((p) => p.time!);
            const fid = trkName ? `${trkName}-seg${j}` : `trk-${i}-seg${j}`;

            const properties: Record<string, unknown> = {
                id: fid,
                title: trkName || `Track ${i + 1}`,
                description: trkDesc ?? "",
                featureType: "track",
                segmentIndex: j,
                pointCount: parsed.length,
                ...ext,
            };

            if (elevations.length > 0) {
                properties.elevationProfile = _computeElevationProfile(elevations);
            }
            if (timestamps.length > 0) {
                properties.startTime = timestamps[0];
                properties.endTime = timestamps[timestamps.length - 1];
            }
            if (links.length > 0) properties.links = links;

            // Aggregate per-point Garmin extensions
            _aggregatePointExtensions(parsed, properties);

            const geometry: LineString = { type: "LineString", coordinates };
            features.push({ type: "Feature", id: fid, geometry, properties });
        }
    }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

function _processRoutes(gpxDoc: Document, features: Feature<Geometry>[], warnings: string[]): void {
    const routes = gpxDoc.getElementsByTagName("rte");

    for (const [i, rte] of [...routes].entries()) {
        const rteName = _getOptionalText(rte, "name");
        const rteDesc = _getOptionalText(rte, "desc");
        const ext = _parseExtensions(rte);
        const links = _parseLinks(rte);
        const rtepts = rte.getElementsByTagName("rtept");
        const parsed = _parseTrackPoints(rtepts);

        if (parsed.length === 0) {
            warnings.push(`Route ${i}: no valid points, skipped`);
            continue;
        }

        const coordinates = parsed.map((p) => p.coord);
        const elevations = parsed.filter((p) => p.elevation != null).map((p) => p.elevation!);
        const timestamps = parsed.filter((p) => p.time != null).map((p) => p.time!);
        const fid = rteName || `rte-${i}`;

        const properties: Record<string, unknown> = {
            id: fid,
            title: rteName || `Route ${i + 1}`,
            description: rteDesc ?? "",
            featureType: "route",
            pointCount: parsed.length,
            ...ext,
        };

        if (elevations.length > 0) {
            properties.elevationProfile = _computeElevationProfile(elevations);
        }
        if (timestamps.length > 0) {
            properties.startTime = timestamps[0];
            properties.endTime = timestamps[timestamps.length - 1];
        }
        if (links.length > 0) properties.links = links;

        const geometry: LineString = { type: "LineString", coordinates };
        features.push({ type: "Feature", id: fid, geometry, properties });
    }
}

// ─── Garmin extensions aggregation ────────────────────────────────────────────

function _aggregatePointExtensions(
    parsed: ParsedTrackPoint[],
    properties: Record<string, unknown>
): void {
    const speeds: number[] = [];
    const hrs: number[] = [];
    const cads: number[] = [];

    for (const pt of parsed) {
        if (typeof pt.extensions.speed === "number") speeds.push(pt.extensions.speed);
        if (typeof pt.extensions.hr === "number") hrs.push(pt.extensions.hr);
        if (typeof pt.extensions.cad === "number") cads.push(pt.extensions.cad);
    }

    if (speeds.length > 0) {
        properties.avgSpeed =
            Math.round((speeds.reduce((a, b) => a + b, 0) / speeds.length) * 100) / 100;
        properties.maxSpeed = Math.max(...speeds);
    }
    if (hrs.length > 0) {
        properties.avgHeartRate = Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length);
        properties.maxHeartRate = Math.max(...hrs);
    }
    if (cads.length > 0) {
        properties.avgCadence = Math.round(cads.reduce((a, b) => a + b, 0) / cads.length);
    }
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

function _parseMetadata(gpxDoc: Document): Record<string, unknown> | undefined {
    const metaEl = gpxDoc.getElementsByTagName("metadata")[0];
    if (!metaEl) return undefined;

    const meta: Record<string, unknown> = {};
    const name = _getOptionalText(metaEl, "name");
    if (name) meta.name = name;
    const desc = _getOptionalText(metaEl, "desc");
    if (desc) meta.description = desc;
    const author = metaEl.getElementsByTagName("author")[0];
    if (author) meta.author = _getOptionalText(author, "name");
    const time = _getOptionalText(metaEl, "time");
    if (time) meta.time = time;
    const links = _parseLinks(metaEl);
    if (links.length > 0) meta.links = links;

    return Object.keys(meta).length > 0 ? meta : undefined;
}

// ─── Main converter ───────────────────────────────────────────────────────────

/**
 * GPX → GeoJSON converter.
 * Parses waypoints, tracks and routes with full enrichment:
 * elevation profiles, timestamps, metadata, Garmin extensions.
 */
export const gpxConverter: IFileConverter = {
    formatName: "GPX",

    convert(input: string | ArrayBuffer): ConvertResult {
        const gpxString = typeof input === "string" ? input : new TextDecoder().decode(input);

        if (!gpxString || gpxString.trim().length === 0) {
            return { data: emptyFC(), warnings: ["Empty GPX input"] };
        }

        const warnings: string[] = [];

        try {
            const parser = new DOMParser();
            const gpxDoc = parser.parseFromString(gpxString, "text/xml");

            const parseError = gpxDoc.getElementsByTagName("parsererror")[0];
            if (parseError) {
                return {
                    data: emptyFC(),
                    warnings: [`XML parsing error: ${parseError.textContent}`],
                };
            }

            const features: Feature<Geometry>[] = [];

            _processWaypoints(gpxDoc, features, warnings);
            _processTracks(gpxDoc, features, warnings);
            _processRoutes(gpxDoc, features, warnings);

            const metadata = _parseMetadata(gpxDoc);
            const fc: GeoJSONFeatureCollection = { type: "FeatureCollection", features };

            // Attach metadata as a foreign member (valid per RFC 7946 §6.1)
            if (metadata) (fc as unknown as Record<string, unknown>).metadata = metadata;

            return { data: fc, warnings };
        } catch (err) {
            return {
                data: emptyFC(),
                warnings: [`GPX parsing error: ${(err as Error).message}`],
            };
        }
    },
};
