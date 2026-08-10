import { describe, it, expect } from "vitest";
import { gpxConverter } from "../../converters/gpx-converter.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function gpxWrap(inner: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1">${inner}</gpx>`;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("gpx-converter", () => {
    // ── Basics ────────────────────────────────────────────────────────────

    it("returns empty FC + warning for empty string", () => {
        const result = gpxConverter.convert("");
        expect(result.data.features).toHaveLength(0);
        expect(result.warnings?.length).toBeGreaterThan(0);
    });

    it("returns empty FC + warning for whitespace-only string", () => {
        const result = gpxConverter.convert("   ");
        expect(result.data.features).toHaveLength(0);
        expect(result.warnings).toContain("Empty GPX input");
    });

    it("returns empty FC + warning for invalid XML", () => {
        const result = gpxConverter.convert("<gpx><unclosed");
        expect(result.data.features).toHaveLength(0);
        expect(result.warnings?.some((w) => w.includes("XML parsing error"))).toBe(true);
    });

    it("accepts ArrayBuffer input", () => {
        const gpx = gpxWrap('<wpt lat="48" lon="2"><name>A</name></wpt>');
        const buf = new TextEncoder().encode(gpx).buffer;
        const result = gpxConverter.convert(buf);
        expect(result.data.features).toHaveLength(1);
    });

    it("formatName is GPX", () => {
        expect(gpxConverter.formatName).toBe("GPX");
    });

    // ── Waypoints ─────────────────────────────────────────────────────────

    it("converts waypoints to Point features", () => {
        const gpx = gpxWrap(`
            <wpt lat="48.85" lon="2.35"><name>Paris</name><desc>Capital</desc></wpt>
            <wpt lat="45.76" lon="4.84"><name>Lyon</name></wpt>
        `);
        const result = gpxConverter.convert(gpx);
        expect(result.data.features).toHaveLength(2);

        const p = result.data.features[0];
        expect(p.geometry.type).toBe("Point");
        expect((p.geometry as GeoJSON.Point).coordinates).toEqual([2.35, 48.85]);
        expect(p.properties?.title).toBe("Paris");
        expect(p.properties?.description).toBe("Capital");
        expect(p.properties?.featureType).toBe("waypoint");

        const l = result.data.features[1];
        expect((l.geometry as GeoJSON.Point).coordinates).toEqual([4.84, 45.76]);
        expect(l.properties?.title).toBe("Lyon");
    });

    it("skips waypoints with invalid coordinates", () => {
        const gpx = gpxWrap('<wpt lat="abc" lon="2.35"><name>Bad</name></wpt>');
        const result = gpxConverter.convert(gpx);
        expect(result.data.features).toHaveLength(0);
        expect(result.warnings?.some((w) => w.includes("invalid coordinates"))).toBe(true);
    });

    it("includes elevation as Z coordinate when <ele> present", () => {
        const gpx = gpxWrap('<wpt lat="48" lon="2"><ele>150.5</ele><name>H</name></wpt>');
        const result = gpxConverter.convert(gpx);
        const coords = (result.data.features[0].geometry as GeoJSON.Point).coordinates;
        expect(coords).toEqual([2, 48, 150.5]);
        expect(result.data.features[0].properties?.elevation).toBe(150.5);
    });

    it("parses optional fields: cmt, src, type, link, time, sym", () => {
        const gpx = gpxWrap(`
            <wpt lat="48" lon="2">
                <name>WP</name>
                <cmt>A comment</cmt>
                <src>Survey</src>
                <type>Campsite</type>
                <sym>Flag</sym>
                <time>2026-01-15T10:30:00Z</time>
                <link href="https://example.com"><text>More info</text></link>
            </wpt>
        `);
        const result = gpxConverter.convert(gpx);
        const props = result.data.features[0].properties!;
        expect(props.comment).toBe("A comment");
        expect(props.source).toBe("Survey");
        expect(props.type).toBe("Campsite");
        expect(props.symbol).toBe("Flag");
        expect(props.timestamp).toBe("2026-01-15T10:30:00Z");
        expect(props.links).toEqual([
            { href: "https://example.com", text: "More info", type: undefined },
        ]);
    });

    // ── Tracks ────────────────────────────────────────────────────────────

    it("converts track segments to LineString features", () => {
        const gpx = gpxWrap(`
            <trk>
                <name>Trail</name>
                <trkseg>
                    <trkpt lat="48" lon="2"></trkpt>
                    <trkpt lat="48.1" lon="2.1"></trkpt>
                    <trkpt lat="48.2" lon="2.2"></trkpt>
                </trkseg>
            </trk>
        `);
        const result = gpxConverter.convert(gpx);
        expect(result.data.features).toHaveLength(1);

        const f = result.data.features[0];
        expect(f.geometry.type).toBe("LineString");
        expect((f.geometry as GeoJSON.LineString).coordinates).toEqual([
            [2, 48],
            [2.1, 48.1],
            [2.2, 48.2],
        ]);
        expect(f.properties?.title).toBe("Trail");
        expect(f.properties?.featureType).toBe("track");
        expect(f.properties?.pointCount).toBe(3);
    });

    it("creates separate features for multiple track segments", () => {
        const gpx = gpxWrap(`
            <trk>
                <name>Multi</name>
                <trkseg>
                    <trkpt lat="48" lon="2"></trkpt>
                    <trkpt lat="48.1" lon="2.1"></trkpt>
                </trkseg>
                <trkseg>
                    <trkpt lat="49" lon="3"></trkpt>
                    <trkpt lat="49.1" lon="3.1"></trkpt>
                </trkseg>
            </trk>
        `);
        const result = gpxConverter.convert(gpx);
        expect(result.data.features).toHaveLength(2);
        expect(result.data.features[0].id).toBe("Multi-seg0");
        expect(result.data.features[1].id).toBe("Multi-seg1");
    });

    it("warns and skips track segment with no valid points", () => {
        const gpx = gpxWrap(`
            <trk><name>Empty</name>
                <trkseg></trkseg>
            </trk>
        `);
        const result = gpxConverter.convert(gpx);
        expect(result.data.features).toHaveLength(0);
        expect(result.warnings?.some((w) => w.includes("no valid points"))).toBe(true);
    });

    it("computes elevation profile for tracks", () => {
        const gpx = gpxWrap(`
            <trk><name>Hill</name><trkseg>
                <trkpt lat="48" lon="2"><ele>100</ele></trkpt>
                <trkpt lat="48.1" lon="2.1"><ele>200</ele></trkpt>
                <trkpt lat="48.2" lon="2.2"><ele>150</ele></trkpt>
            </trkseg></trk>
        `);
        const result = gpxConverter.convert(gpx);
        const prof = result.data.features[0].properties?.elevationProfile as {
            min: number;
            max: number;
            gain: number;
            loss: number;
        };
        expect(prof).toBeDefined();
        expect(prof.min).toBe(100);
        expect(prof.max).toBe(200);
        expect(prof.gain).toBe(100);
        expect(prof.loss).toBe(50);
    });

    it("includes startTime/endTime for track points with <time>", () => {
        const gpx = gpxWrap(`
            <trk><name>Timed</name><trkseg>
                <trkpt lat="48" lon="2"><time>2026-01-15T08:00:00Z</time></trkpt>
                <trkpt lat="48.1" lon="2.1"><time>2026-01-15T09:30:00Z</time></trkpt>
            </trkseg></trk>
        `);
        const result = gpxConverter.convert(gpx);
        const props = result.data.features[0].properties!;
        expect(props.startTime).toBe("2026-01-15T08:00:00Z");
        expect(props.endTime).toBe("2026-01-15T09:30:00Z");
    });

    // ── Routes ────────────────────────────────────────────────────────────

    it("converts routes <rte> to LineString features", () => {
        const gpx = gpxWrap(`
            <rte>
                <name>Route A</name>
                <desc>A planned route</desc>
                <rtept lat="48" lon="2"></rtept>
                <rtept lat="48.5" lon="2.5"></rtept>
            </rte>
        `);
        const result = gpxConverter.convert(gpx);
        expect(result.data.features).toHaveLength(1);

        const f = result.data.features[0];
        expect(f.geometry.type).toBe("LineString");
        expect(f.properties?.title).toBe("Route A");
        expect(f.properties?.description).toBe("A planned route");
        expect(f.properties?.featureType).toBe("route");
        expect(f.properties?.pointCount).toBe(2);
    });

    it("warns and skips route with no valid points", () => {
        const gpx = gpxWrap("<rte><name>Empty</name></rte>");
        const result = gpxConverter.convert(gpx);
        expect(result.data.features).toHaveLength(0);
        expect(result.warnings?.some((w) => w.includes("Route 0: no valid points"))).toBe(true);
    });

    // ── Garmin extensions ─────────────────────────────────────────────────

    it("aggregates Garmin per-point extensions (speed, hr, cad)", () => {
        const gpx = gpxWrap(`
            <trk><name>Bike</name><trkseg>
                <trkpt lat="48" lon="2">
                    <extensions><speed>5.0</speed><hr>120</hr><cad>80</cad></extensions>
                </trkpt>
                <trkpt lat="48.1" lon="2.1">
                    <extensions><speed>7.0</speed><hr>140</hr><cad>90</cad></extensions>
                </trkpt>
            </trkseg></trk>
        `);
        const result = gpxConverter.convert(gpx);
        const props = result.data.features[0].properties!;
        expect(props.avgSpeed).toBe(6);
        expect(props.maxSpeed).toBe(7);
        expect(props.avgHeartRate).toBe(130);
        expect(props.maxHeartRate).toBe(140);
        expect(props.avgCadence).toBe(85);
    });

    // ── Metadata ──────────────────────────────────────────────────────────

    it("parses <metadata> into a foreign member on FeatureCollection", () => {
        const gpx = gpxWrap(`
            <metadata>
                <name>My Tracks</name>
                <desc>Hiking trails</desc>
                <author><name>John</name></author>
                <time>2026-04-13T00:00:00Z</time>
                <link href="https://geoleaf.dev"><text>Site</text></link>
            </metadata>
            <wpt lat="48" lon="2"><name>A</name></wpt>
        `);
        const result = gpxConverter.convert(gpx);
        const meta = (result.data as Record<string, unknown>).metadata as Record<string, unknown>;
        expect(meta).toBeDefined();
        expect(meta.name).toBe("My Tracks");
        expect(meta.description).toBe("Hiking trails");
        expect(meta.author).toBe("John");
        expect(meta.time).toBe("2026-04-13T00:00:00Z");
        expect(meta.links).toEqual([
            { href: "https://geoleaf.dev", text: "Site", type: undefined },
        ]);
    });

    it("does not attach metadata when <metadata> is empty", () => {
        const gpx = gpxWrap('<metadata></metadata><wpt lat="48" lon="2"><name>B</name></wpt>');
        const result = gpxConverter.convert(gpx);
        expect((result.data as Record<string, unknown>).metadata).toBeUndefined();
    });

    // ── Mixed content ─────────────────────────────────────────────────────

    it("handles mixed waypoints, tracks and routes in one GPX", () => {
        const gpx = gpxWrap(`
            <wpt lat="48" lon="2"><name>WP1</name></wpt>
            <trk><name>T1</name><trkseg>
                <trkpt lat="49" lon="3"></trkpt>
                <trkpt lat="49.1" lon="3.1"></trkpt>
            </trkseg></trk>
            <rte><name>R1</name>
                <rtept lat="50" lon="4"></rtept>
                <rtept lat="50.1" lon="4.1"></rtept>
            </rte>
        `);
        const result = gpxConverter.convert(gpx);
        expect(result.data.features).toHaveLength(3);
        const types = result.data.features.map((f) => f.properties?.featureType);
        expect(types).toEqual(["waypoint", "track", "route"]);
    });

    // ── Edge cases ────────────────────────────────────────────────────────

    it("returns empty FC for valid GPX with no features", () => {
        const gpx = gpxWrap("");
        const result = gpxConverter.convert(gpx);
        expect(result.data.type).toBe("FeatureCollection");
        expect(result.data.features).toHaveLength(0);
        expect(result.warnings).toHaveLength(0);
    });
});
