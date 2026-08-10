import { detectFormat } from "../format-detector.js";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("detectFormat", () => {
    describe("extension-based detection (highest priority)", () => {
        it("detects flatgeobuf from .fgb extension", () => {
            expect(detectFormat("https://api.example.com/data/layer.fgb")).toBe("flatgeobuf");
        });

        it("detects kml from .kml extension", () => {
            expect(detectFormat("https://api.example.com/export.kml")).toBe("kml");
        });

        it("detects csv from .csv extension", () => {
            expect(detectFormat("https://api.example.com/data.csv")).toBe("csv");
        });

        it("detects pmtiles from .pmtiles extension", () => {
            expect(detectFormat("https://tiles.example.com/map.pmtiles")).toBe("pmtiles");
        });

        it("detects mvt from .mvt extension", () => {
            expect(detectFormat("https://tiles.example.com/14/8012/5456.mvt")).toBe("mvt");
        });

        it("detects mvt from .pbf extension", () => {
            expect(detectFormat("https://tiles.example.com/14/8012/5456.pbf")).toBe("mvt");
        });

        it("is case-insensitive for extension detection", () => {
            expect(detectFormat("https://api.example.com/DATA.FGB")).toBe("flatgeobuf");
            expect(detectFormat("https://tiles.example.com/TILE.PBF")).toBe("mvt");
        });
    });

    describe("query parameter stripping", () => {
        it("ignores query params when detecting by extension", () => {
            expect(detectFormat("https://api.example.com/data.fgb?token=abc&v=2")).toBe(
                "flatgeobuf"
            );
        });

        it("ignores query params containing misleading extensions", () => {
            // The .geojson in query param should not affect detection of .kml
            expect(detectFormat("https://api.example.com/export.kml?format=geojson")).toBe("kml");
        });
    });

    describe("OGC API Features path detection", () => {
        it("detects oapif from /collections/ in path", () => {
            expect(detectFormat("https://api.example.com/ogc/collections/pois/items")).toBe(
                "oapif"
            );
        });

        it("detects oapif even with query params after /collections/", () => {
            expect(
                detectFormat("https://api.example.com/collections/roads/items?bbox=1,2,3,4")
            ).toBe("oapif");
        });
    });

    describe("Content-Type fallback detection", () => {
        it("detects flatgeobuf from Content-Type application/flatgeobuf", () => {
            expect(detectFormat("https://api.example.com/data", "application/flatgeobuf")).toBe(
                "flatgeobuf"
            );
        });

        it("detects csv from Content-Type text/csv", () => {
            expect(detectFormat("https://api.example.com/data", "text/csv")).toBe("csv");
        });

        it("detects kml from Content-Type application/vnd.google-earth.kml+xml", () => {
            expect(
                detectFormat("https://api.example.com/data", "application/vnd.google-earth.kml+xml")
            ).toBe("kml");
        });

        it("detects mvt from Content-Type application/vnd.mapbox-vector-tile", () => {
            expect(
                detectFormat("https://api.example.com/tile", "application/vnd.mapbox-vector-tile")
            ).toBe("mvt");
        });
    });

    describe("default geojson fallback", () => {
        it("returns geojson for unknown extension", () => {
            expect(detectFormat("https://api.example.com/layer.json")).toBe("geojson");
        });

        it("returns geojson for .geojson extension via fallback", () => {
            expect(detectFormat("https://api.example.com/layer.geojson")).toBe("geojson");
        });

        it("returns geojson for bare URL with no extension", () => {
            expect(detectFormat("https://api.example.com/api/layer")).toBe("geojson");
        });

        it("returns geojson when no Content-Type matches", () => {
            expect(detectFormat("https://api.example.com/data", "application/json")).toBe(
                "geojson"
            );
        });

        it("returns geojson when URL is empty string", () => {
            expect(detectFormat("")).toBe("geojson");
        });
    });

    describe("extension priority over Content-Type", () => {
        it("prefers .fgb extension over a geojson Content-Type", () => {
            expect(detectFormat("https://api.example.com/data.fgb", "application/json")).toBe(
                "flatgeobuf"
            );
        });

        it("prefers .pmtiles extension over a mapbox Content-Type", () => {
            expect(
                detectFormat(
                    "https://tiles.example.com/map.pmtiles",
                    "application/vnd.mapbox-vector-tile"
                )
            ).toBe("pmtiles");
        });
    });
});
