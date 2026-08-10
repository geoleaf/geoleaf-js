import { describe, it, expect, vi, beforeEach } from "vitest";
import { convert, getSupportedFormats, registerConverter, importAsLayer } from "../public-api.js";
import type { IFileConverter } from "../converters/i-converter.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFile(name: string, content: string): File {
    const blob = new Blob([content], { type: "application/octet-stream" });
    return new File([blob], name);
}

// NOTE: the binary KMZ (ZIP) path is intentionally NOT unit-tested here.
// fflate's zipSync mis-encodes binary under happy-dom (test-env artifact); the
// KMZ extraction unit is covered in node env (kmz-extractor.test.ts) and
// the full KMZ→File→convert path in a real browser (e2e/15-file-import.spec.js).

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("public-api", () => {
    beforeEach(() => {
        (globalThis as Record<string, unknown>).GeoLeaf = undefined;
    });

    // ── convert ───────────────────────────────────────────────────────────

    it("convert returns warning for null-ish file", async () => {
        const result = await convert(null as unknown as File);
        expect(result.data.features).toHaveLength(0);
        expect(result.warnings).toContain("No file provided");
    });

    it("convert returns warning for unsupported format", async () => {
        const result = await convert(makeFile("test.xyz", "data"));
        expect(result.data.features).toHaveLength(0);
        expect(result.warnings?.some((w) => w.includes("Unsupported"))).toBe(true);
    });

    it("convert GPX file succeeds", async () => {
        const gpx = `<?xml version="1.0"?><gpx version="1.1"><wpt lat="48" lon="2"><name>A</name></wpt></gpx>`;
        const result = await convert(makeFile("track.gpx", gpx));
        expect(result.data.features).toHaveLength(1);
        expect(result.data.features[0].geometry.type).toBe("Point");
    });

    it("convert KML file succeeds", async () => {
        const kml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>A</name><Point><coordinates>2,48,0</coordinates></Point></Placemark></Document></kml>`;
        const result = await convert(makeFile("places.kml", kml));
        expect(result.data.features).toHaveLength(1);
    });

    it("convert CSV file succeeds", async () => {
        const csv = "name,lat,lng\nParis,48.85,2.35";
        const result = await convert(makeFile("data.csv", csv));
        expect(result.data.features).toHaveLength(1);
    });

    it("convert TopoJSON file succeeds", async () => {
        const topo = JSON.stringify({
            type: "Topology",
            arcs: [],
            objects: {
                pts: {
                    type: "GeometryCollection",
                    geometries: [{ type: "Point", coordinates: [2, 48] }],
                },
            },
        });
        const result = await convert(makeFile("map.topojson", topo));
        expect(result.data.features).toHaveLength(1);
    });

    // ── getSupportedFormats ───────────────────────────────────────────────

    it("getSupportedFormats returns an array of extensions", () => {
        const formats = getSupportedFormats();
        expect(formats).toContain(".gpx");
        expect(formats).toContain(".kml");
        expect(formats).toContain(".csv");
    });

    // ── registerConverter ─────────────────────────────────────────────────

    it("registerConverter works and convert uses it", async () => {
        const custom: IFileConverter = {
            formatName: "GeoPackage",
            convert: () => ({
                data: {
                    type: "FeatureCollection",
                    features: [
                        {
                            type: "Feature",
                            geometry: { type: "Point", coordinates: [0, 0] },
                            properties: {},
                        },
                    ],
                },
                warnings: [],
            }),
        };
        registerConverter(".gpkg", custom);
        const result = await convert(makeFile("test.gpkg", "binary"));
        expect(result.data.features).toHaveLength(1);
    });

    // ── importAsLayer ─────────────────────────────────────────────────────

    it("importAsLayer throws when no features extracted", async () => {
        await expect(
            importAsLayer(makeFile("empty.gpx", `<?xml version="1.0"?><gpx version="1.1"></gpx>`))
        ).rejects.toThrow("No features extracted");
    });

    it("importAsLayer throws when the map adapter is unavailable", async () => {
        (globalThis as Record<string, unknown>).GeoLeaf = {};
        const gpx = `<?xml version="1.0"?><gpx version="1.1"><wpt lat="48" lon="2"><name>A</name></wpt></gpx>`;
        await expect(importAsLayer(makeFile("track.gpx", gpx))).rejects.toThrow(
            "Map adapter unavailable"
        );
    });

    it("importAsLayer renders via adapter.addGeoJSONLayer and returns a layer id", async () => {
        const addGeoJSONLayer = vi.fn();
        (globalThis as Record<string, unknown>).GeoLeaf = {
            Core: { getMap: () => ({ addGeoJSONLayer }) },
        };

        const gpx = `<?xml version="1.0"?><gpx version="1.1"><wpt lat="48" lon="2"><name>A</name></wpt></gpx>`;
        const layerId = await importAsLayer(makeFile("track.gpx", gpx), {
            layerName: "My Track",
            visible: false,
        });

        expect(typeof layerId).toBe("string");
        expect(layerId).toMatch(/^fileimport-/);
        expect(addGeoJSONLayer).toHaveBeenCalledOnce();
        const [id, data, opts] = addGeoJSONLayer.mock.calls[0];
        expect(id).toBe(layerId);
        expect(data.type).toBe("FeatureCollection");
        expect(data.features.length).toBeGreaterThan(0);
        expect(opts.layerName).toBe("My Track");
        expect(opts.visible).toBe(false);
    });

    it("importAsLayer honours an explicit layerId", async () => {
        const addGeoJSONLayer = vi.fn();
        (globalThis as Record<string, unknown>).GeoLeaf = {
            Core: { getMap: () => ({ addGeoJSONLayer }) },
        };
        const gpx = `<?xml version="1.0"?><gpx version="1.1"><wpt lat="48" lon="2"><name>A</name></wpt></gpx>`;
        const layerId = await importAsLayer(makeFile("track.gpx", gpx), { layerId: "my-layer" });
        expect(layerId).toBe("my-layer");
        expect(addGeoJSONLayer.mock.calls[0][0]).toBe("my-layer");
    });
});
