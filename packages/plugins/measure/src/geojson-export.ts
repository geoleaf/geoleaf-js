/*!
 * @geoleaf-plugins/measure — GeoJSON export
 * © 2026 Mattieu Pottier — MIT License
 *
 * Builds a RFC 7946 FeatureCollection with enriched properties and hands it to the
 * shared `downloadBlob` of @geoleaf/host-runtime (navigator.share on iOS → <a download>
 * elsewhere). STRUCT S2 (F5): this file carried a near-literal fork of that strategy
 * (`_triggerDownload`), differing from plugin-print's only by its log prefix.
 * https://geoleaf.dev
 */
import { downloadBlob } from "@geoleaf/host-runtime";

import type { MeasureConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Blob builder
// ---------------------------------------------------------------------------

/**
 * Builds a GeoJSON Blob from the given FeatureCollection.
 * Each feature's properties are normalised so all enriched fields are present
 * (missing values serialise as null).
 */
export function buildGeoJSONBlob(collection: GeoJSON.FeatureCollection): Blob {
    const ENRICHED_KEYS = [
        "measureType",
        "lengthM",
        "perimeterM",
        "areaM2",
        "radiusM",
        "label",
        "annotationKind",
        "widthPx",
        "heightPx",
        "createdAt",
    ];
    const enriched: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: collection.features.map((f) => {
            const defaults: Record<string, null> = {};
            for (const k of ENRICHED_KEYS) defaults[k] = null;
            return {
                ...f,
                properties: { ...defaults, ...(f.properties ?? {}) },
            };
        }),
    };
    return new Blob([JSON.stringify(enriched, null, 2)], { type: "application/geo+json" });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Exports the FeatureCollection as GeoJSON.
 * By default triggers a file download; pass `download: false` to skip.
 * Always returns the generated Blob.
 */
export async function exportGeoJSON(
    collection: GeoJSON.FeatureCollection,
    opts?: { download?: boolean; fileName?: string },
    cfg?: MeasureConfig
): Promise<Blob> {
    const blob = buildGeoJSONBlob(collection);
    if (opts?.download !== false) {
        const name = opts?.fileName ?? cfg?.exportFileName ?? "mesures.geojson";
        await downloadBlob(blob, name);
    }
    return blob;
}
