/*!
 * GeoLeaf File Import Plugin — KML Converter
 * Converts KML (Keyhole Markup Language) XML to GeoJSON FeatureCollection.
 *
 * Uses @tmcw/togeojson for base conversion, then enriches:
 * - ExtendedData/SchemaData → custom properties
 * - Style stroke/fill → style properties
 * - Folders → folder property
 * - TimeSpan/TimeStamp → temporal properties
 * - Description HTML → stripped to plain text
 * - GroundOverlay → warning (not convertible to vector)
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import type { Geometry, FeatureCollection } from "geojson";
import type { IFileConverter, ConvertResult, GeoJSONFeatureCollection } from "./i-converter.js";
import { emptyFC } from "./i-converter.js";

// @tmcw/togeojson — built-in TypeScript typings, zero runtime dependencies
import { kml as kmlToGeoJSON } from "@tmcw/togeojson";

// ─── Enrichment helpers ───────────────────────────────────────────────────────

/** Strip HTML tags from a description string (simple regex approach — no DOM). */
function _stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, "").trim();
}

/** Extract folder path for a Placemark by walking up parent <Folder> elements. */
function _extractFolderPath(placemark: Element): string | undefined {
    const parts: string[] = [];
    let parent = placemark.parentElement;
    while (parent) {
        if (parent.tagName === "Folder") {
            const nameEl = parent.getElementsByTagName("name")[0];
            const name = nameEl?.textContent?.trim();
            if (name) parts.unshift(name);
        }
        parent = parent.parentElement;
    }
    return parts.length > 0 ? parts.join("/") : undefined;
}

/** Extract TimeSpan or TimeStamp from a Placemark. */
function _extractTimeInfo(placemark: Element): {
    timeStart?: string;
    timeEnd?: string;
    timestamp?: string;
} {
    const result: { timeStart?: string; timeEnd?: string; timestamp?: string } = {};

    const timeSpan = placemark.getElementsByTagName("TimeSpan")[0];
    if (timeSpan) {
        const begin = timeSpan.getElementsByTagName("begin")[0]?.textContent?.trim();
        const end = timeSpan.getElementsByTagName("end")[0]?.textContent?.trim();
        if (begin) result.timeStart = begin;
        if (end) result.timeEnd = end;
    }

    const timeStamp = placemark.getElementsByTagName("TimeStamp")[0];
    if (timeStamp) {
        const when = timeStamp.getElementsByTagName("when")[0]?.textContent?.trim();
        if (when) result.timestamp = when;
    }

    return result;
}

/** Extract ExtendedData key-value pairs. */
function _extractExtendedData(placemark: Element): Record<string, string> {
    const props: Record<string, string> = {};
    const extData = placemark.getElementsByTagName("ExtendedData")[0];
    if (!extData) return props;

    // SimpleData (within SchemaData)
    for (const simple of extData.getElementsByTagName("SimpleData")) {
        const name = simple.getAttribute("name");
        const val = simple.textContent?.trim();
        if (name && val) props[name] = val;
    }

    // Data elements (name + value pattern)
    for (const dataEl of extData.getElementsByTagName("Data")) {
        const name = dataEl.getAttribute("name");
        const valEl = dataEl.getElementsByTagName("value")[0];
        const val = valEl?.textContent?.trim();
        if (name && val) props[name] = val;
    }

    return props;
}

// ─── Main converter ───────────────────────────────────────────────────────────

/**
 * KML → GeoJSON converter.
 * Uses @tmcw/togeojson for geometry extraction, then enriches with
 * ExtendedData, folders, temporal info, and sanitized descriptions.
 */
export const kmlConverter: IFileConverter = {
    formatName: "KML",

    convert(input: string | ArrayBuffer): ConvertResult {
        const kmlString = typeof input === "string" ? input : new TextDecoder().decode(input);

        if (!kmlString || kmlString.trim().length === 0) {
            return { data: emptyFC(), warnings: ["Empty KML input"] };
        }

        const warnings: string[] = [];

        try {
            const parser = new DOMParser();
            const kmlDoc = parser.parseFromString(kmlString, "text/xml");

            const parseError = kmlDoc.getElementsByTagName("parsererror")[0];
            if (parseError) {
                return {
                    data: emptyFC(),
                    warnings: [`XML parsing error: ${parseError.textContent}`],
                };
            }

            // Check for GroundOverlay (not convertible to vector)
            const overlays = kmlDoc.getElementsByTagName("GroundOverlay");
            if (overlays.length > 0) {
                warnings.push(
                    `${overlays.length} GroundOverlay(s) found — raster overlays are not supported and were skipped`
                );
            }

            // Base conversion via @tmcw/togeojson
            const fc = kmlToGeoJSON(kmlDoc) as FeatureCollection<Geometry>;

            // Enrich features with folder paths, temporal info, extended data
            const placemarksArr = [...kmlDoc.getElementsByTagName("Placemark")];

            // Walk the features and pair each with its placemark; the pairing is positional,
            // so a missing counterpart ends the walk exactly as the old length guard did.
            for (const [i, feature] of fc.features.entries()) {
                const placemark = placemarksArr[i];
                if (!placemark) break;

                if (!feature.properties) feature.properties = {};

                // Folder path
                const folder = _extractFolderPath(placemark);
                if (folder) feature.properties.folder = folder;

                // Temporal info
                const timeInfo = _extractTimeInfo(placemark);
                if (timeInfo.timeStart) feature.properties.timeStart = timeInfo.timeStart;
                if (timeInfo.timeEnd) feature.properties.timeEnd = timeInfo.timeEnd;
                if (timeInfo.timestamp) feature.properties.timestamp = timeInfo.timestamp;

                // ExtendedData
                const extData = _extractExtendedData(placemark);
                Object.assign(feature.properties, extData);

                // Sanitize description (strip HTML)
                if (typeof feature.properties.description === "string") {
                    feature.properties.description = _stripHtml(feature.properties.description);
                }
            }

            return { data: fc as GeoJSONFeatureCollection, warnings };
        } catch (err) {
            return {
                data: emptyFC(),
                warnings: [`KML parsing error: ${(err as Error).message}`],
            };
        }
    },
};
