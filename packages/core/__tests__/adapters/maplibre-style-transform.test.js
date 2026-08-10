/**
 * Unit tests for maplibre-style-transform — the basemap-switch `transformStyle`
 * builder that preserves GeoLeaf-owned sources/layers across `map.setStyle()`.
 *
 * RM-P1b fix (c): instead of tearing down and re-injecting the GeoLeaf data
 * layers on every vector basemap switch (the former `geoleaf:style:rebuild`
 * dance), the adapter merges the owned sources/layers of the current style into
 * the incoming one via `transformStyle` (depuis MapLibre v5). These tests lock the
 * merge: owned layers survive on top of the new basemap, their sources are
 * carried (including sources only referenced by an owned layer), non-owned
 * (basemap) layers come from `next`, and nothing is duplicated.
 */

import { buildGeoLeafStyleTransform } from "../../src/adapters/maplibre/maplibre-style-transform.js";

/** A minimal previous style: one basemap layer + GeoLeaf GeoJSON + POI + sentinel. */
function previousStyle() {
    return {
        version: 8,
        sources: {
            "old-basemap": { type: "raster", tiles: ["https://old/{z}/{x}/{y}.png"] },
            "gl-src-cities": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
            "gl-poi-src-poi": { type: "geojson", data: {}, cluster: true },
        },
        layers: [
            { id: "old-basemap-layer", type: "raster", source: "old-basemap" },
            { id: "gl-cities-circle", type: "circle", source: "gl-src-cities" },
            { id: "gl-sentinel-poi", type: "background" },
            { id: "gl-poi-poi-unclustered", type: "circle", source: "gl-poi-src-poi" },
        ],
    };
}

/** A minimal incoming vector basemap style. */
function nextStyle() {
    return {
        version: 8,
        sources: { "new-basemap": { type: "vector", url: "https://new/tiles.json" } },
        layers: [{ id: "new-basemap-water", type: "fill", source: "new-basemap" }],
    };
}

const OWNED = {
    layerIds: new Set(["gl-cities-circle", "gl-sentinel-poi", "gl-poi-poi-unclustered"]),
    sourceIds: new Set(["gl-src-cities", "gl-poi-src-poi"]),
};

describe("buildGeoLeafStyleTransform", () => {
    test("returns next unchanged when there is no previous style", () => {
        const transform = buildGeoLeafStyleTransform(OWNED);
        const next = nextStyle();
        expect(transform(undefined, next)).toBe(next);
    });

    test("returns next unchanged when nothing is owned", () => {
        const transform = buildGeoLeafStyleTransform({
            layerIds: new Set(),
            sourceIds: new Set(),
        });
        const next = nextStyle();
        expect(transform(previousStyle(), next)).toBe(next);
    });

    test("returns next when no owned layer is present in previous", () => {
        const transform = buildGeoLeafStyleTransform({
            layerIds: new Set(["gl-absent"]),
            sourceIds: new Set(["gl-src-absent"]),
        });
        const next = nextStyle();
        expect(transform(previousStyle(), next)).toBe(next);
    });

    test("carries owned layers on top of the new basemap, in original order", () => {
        const transform = buildGeoLeafStyleTransform(OWNED);
        const merged = transform(previousStyle(), nextStyle());
        const ids = merged.layers.map((l) => l.id);
        expect(ids).toEqual([
            "new-basemap-water", // incoming basemap stays at the bottom
            "gl-cities-circle",
            "gl-sentinel-poi",
            "gl-poi-poi-unclustered",
        ]);
    });

    test("merges owned sources with the incoming basemap sources; drops the old basemap", () => {
        const transform = buildGeoLeafStyleTransform(OWNED);
        const merged = transform(previousStyle(), nextStyle());
        expect(Object.keys(merged.sources).sort()).toEqual([
            "gl-poi-src-poi",
            "gl-src-cities",
            "new-basemap",
        ]);
        expect(merged.sources["old-basemap"]).toBeUndefined();
        // Preserved source keeps its original spec (including data).
        expect(merged.sources["gl-src-cities"]).toEqual({
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
        });
    });

    test("carries a source referenced by an owned layer even if absent from sourceIds", () => {
        // sourceIds intentionally omits gl-src-cities; the owned layer references it.
        const transform = buildGeoLeafStyleTransform({
            layerIds: new Set(["gl-cities-circle"]),
            sourceIds: new Set(),
        });
        const merged = transform(previousStyle(), nextStyle());
        expect(merged.sources["gl-src-cities"]).toBeDefined();
    });

    test("preserves a background (source-less) owned layer without inventing a source", () => {
        const transform = buildGeoLeafStyleTransform({
            layerIds: new Set(["gl-sentinel-poi"]),
            sourceIds: new Set(),
        });
        const merged = transform(previousStyle(), nextStyle());
        expect(merged.layers.map((l) => l.id)).toContain("gl-sentinel-poi");
        expect(Object.keys(merged.sources)).toEqual(["new-basemap"]);
    });

    test("does not duplicate a layer id already defined by the incoming style", () => {
        const next = nextStyle();
        next.layers.push({ id: "gl-cities-circle", type: "circle", source: "new-basemap" });
        const transform = buildGeoLeafStyleTransform(OWNED);
        const merged = transform(previousStyle(), next);
        const occurrences = merged.layers.filter((l) => l.id === "gl-cities-circle").length;
        expect(occurrences).toBe(1);
    });

    test("does not mutate the incoming style object", () => {
        const next = nextStyle();
        const nextLayersBefore = next.layers.length;
        buildGeoLeafStyleTransform(OWNED)(previousStyle(), next);
        expect(next.layers.length).toBe(nextLayersBefore);
    });
});
