import { describe, it, expect } from "vitest";
import { kmlConverter } from "../../converters/kml-converter.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function kmlWrap(inner: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>${inner}</Document>
</kml>`;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("kml-converter", () => {
    it("formatName is KML", () => {
        expect(kmlConverter.formatName).toBe("KML");
    });

    it("returns empty FC + warning for empty string", () => {
        const result = kmlConverter.convert("");
        expect(result.data.features).toHaveLength(0);
        expect(result.warnings).toContain("Empty KML input");
    });

    it("returns empty FC + warning for invalid XML", () => {
        const result = kmlConverter.convert("<kml><unclosed");
        expect(result.data.features).toHaveLength(0);
        expect(result.warnings?.some((w) => w.includes("XML parsing error"))).toBe(true);
    });

    it("converts a simple Placemark with Point geometry", () => {
        const kml = kmlWrap(`
            <Placemark>
                <name>Paris</name>
                <description>Capital of France</description>
                <Point><coordinates>2.35,48.85,0</coordinates></Point>
            </Placemark>
        `);
        const result = kmlConverter.convert(kml);
        expect(result.data.features).toHaveLength(1);
        const f = result.data.features[0];
        expect(f.geometry.type).toBe("Point");
        expect(f.properties?.name).toBe("Paris");
    });

    it("converts a Placemark with LineString geometry", () => {
        const kml = kmlWrap(`
            <Placemark>
                <name>Route</name>
                <LineString><coordinates>2,48,0 2.1,48.1,0 2.2,48.2,0</coordinates></LineString>
            </Placemark>
        `);
        const result = kmlConverter.convert(kml);
        expect(result.data.features).toHaveLength(1);
        expect(result.data.features[0].geometry.type).toBe("LineString");
    });

    it("converts a Placemark with Polygon geometry", () => {
        const kml = kmlWrap(`
            <Placemark>
                <name>Zone</name>
                <Polygon>
                    <outerBoundaryIs><LinearRing>
                        <coordinates>0,0,0 1,0,0 1,1,0 0,1,0 0,0,0</coordinates>
                    </LinearRing></outerBoundaryIs>
                </Polygon>
            </Placemark>
        `);
        const result = kmlConverter.convert(kml);
        expect(result.data.features).toHaveLength(1);
        expect(result.data.features[0].geometry.type).toBe("Polygon");
    });

    it("extracts folder path for nested Placemarks", () => {
        const kml = kmlWrap(`
            <Folder>
                <name>Europe</name>
                <Folder>
                    <name>France</name>
                    <Placemark>
                        <name>Paris</name>
                        <Point><coordinates>2.35,48.85,0</coordinates></Point>
                    </Placemark>
                </Folder>
            </Folder>
        `);
        const result = kmlConverter.convert(kml);
        expect(result.data.features[0].properties?.folder).toBe("Europe/France");
    });

    it("extracts TimeSpan temporal info", () => {
        const kml = kmlWrap(`
            <Placemark>
                <name>Event</name>
                <TimeSpan>
                    <begin>2026-01-01</begin>
                    <end>2026-12-31</end>
                </TimeSpan>
                <Point><coordinates>2,48,0</coordinates></Point>
            </Placemark>
        `);
        const result = kmlConverter.convert(kml);
        expect(result.data.features[0].properties?.timeStart).toBe("2026-01-01");
        expect(result.data.features[0].properties?.timeEnd).toBe("2026-12-31");
    });

    it("extracts TimeStamp temporal info", () => {
        const kml = kmlWrap(`
            <Placemark>
                <name>Snapshot</name>
                <TimeStamp><when>2026-06-15T12:00:00Z</when></TimeStamp>
                <Point><coordinates>2,48,0</coordinates></Point>
            </Placemark>
        `);
        const result = kmlConverter.convert(kml);
        expect(result.data.features[0].properties?.timestamp).toBe("2026-06-15T12:00:00Z");
    });

    it("extracts ExtendedData (Data elements)", () => {
        const kml = kmlWrap(`
            <Placemark>
                <name>POI</name>
                <ExtendedData>
                    <Data name="population"><value>2161000</value></Data>
                    <Data name="country"><value>France</value></Data>
                </ExtendedData>
                <Point><coordinates>2.35,48.85,0</coordinates></Point>
            </Placemark>
        `);
        const result = kmlConverter.convert(kml);
        const props = result.data.features[0].properties!;
        expect(props.population).toBe("2161000");
        expect(props.country).toBe("France");
    });

    it("extracts ExtendedData (SchemaData/SimpleData)", () => {
        const kml = kmlWrap(`
            <Placemark>
                <name>POI</name>
                <ExtendedData>
                    <SchemaData schemaUrl="#mySchema">
                        <SimpleData name="rating">4.5</SimpleData>
                    </SchemaData>
                </ExtendedData>
                <Point><coordinates>2,48,0</coordinates></Point>
            </Placemark>
        `);
        const result = kmlConverter.convert(kml);
        expect(result.data.features[0].properties?.rating).toBe("4.5");
    });

    it("strips HTML from description", () => {
        const kml = kmlWrap(`
            <Placemark>
                <name>POI</name>
                <description>&lt;b&gt;Bold&lt;/b&gt; text and &lt;a href="x"&gt;link&lt;/a&gt;</description>
                <Point><coordinates>2,48,0</coordinates></Point>
            </Placemark>
        `);
        const result = kmlConverter.convert(kml);
        const desc = result.data.features[0].properties?.description;
        expect(desc).not.toContain("<b>");
        expect(desc).not.toContain("<a");
    });

    it("warns about GroundOverlay elements", () => {
        const kml = kmlWrap(`
            <GroundOverlay>
                <name>Overlay</name>
                <Icon><href>image.png</href></Icon>
            </GroundOverlay>
            <Placemark>
                <name>POI</name>
                <Point><coordinates>2,48,0</coordinates></Point>
            </Placemark>
        `);
        const result = kmlConverter.convert(kml);
        expect(result.warnings?.some((w) => w.includes("GroundOverlay"))).toBe(true);
    });

    it("handles multiple Placemarks", () => {
        const kml = kmlWrap(`
            <Placemark>
                <name>A</name>
                <Point><coordinates>2,48,0</coordinates></Point>
            </Placemark>
            <Placemark>
                <name>B</name>
                <Point><coordinates>3,49,0</coordinates></Point>
            </Placemark>
        `);
        const result = kmlConverter.convert(kml);
        expect(result.data.features).toHaveLength(2);
    });

    it("accepts ArrayBuffer input", () => {
        const kml = kmlWrap(
            "<Placemark><name>X</name><Point><coordinates>2,48,0</coordinates></Point></Placemark>"
        );
        const buf = new TextEncoder().encode(kml).buffer;
        const result = kmlConverter.convert(buf);
        expect(result.data.features).toHaveLength(1);
    });

    it("returns empty FC for valid KML with no Placemarks", () => {
        const kml = kmlWrap("");
        const result = kmlConverter.convert(kml);
        expect(result.data.type).toBe("FeatureCollection");
        expect(result.data.features).toHaveLength(0);
    });
});
