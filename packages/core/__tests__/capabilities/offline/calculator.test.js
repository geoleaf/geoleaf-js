/**
 * Unit tests — CacheCalculator
 * Covers: latLngToTile, buildTileUrl, getTileCoordsForBounds,
 *         estimateTileSize, calculateResourcesSize, formatDuration
 */

import { CacheCalculator } from "../../../src/capabilities/offline/cache/calculator.js";

describe("CacheCalculator", () => {
    // ----- latLngToTile -----

    describe("latLngToTile", () => {
        test("returns integers x and y", () => {
            const tile = CacheCalculator.latLngToTile(48.8566, 2.3522, 10);
            expect(Number.isInteger(tile.x)).toBe(true);
            expect(Number.isInteger(tile.y)).toBe(true);
        });

        test("at zoom 0 the whole world is one tile (0,0)", () => {
            const tile = CacheCalculator.latLngToTile(0, 0, 0);
            expect(tile.x).toBe(0);
            expect(tile.y).toBe(0);
        });

        test("at zoom 1 NW quadrant is tile (0,0)", () => {
            const tile = CacheCalculator.latLngToTile(45, -90, 1);
            expect(tile.x).toBe(0);
            expect(tile.y).toBe(0);
        });

        test("at zoom 1 SE quadrant is tile (1,1)", () => {
            const tile = CacheCalculator.latLngToTile(-45, 90, 1);
            expect(tile.x).toBe(1);
            expect(tile.y).toBe(1);
        });

        test("latitude above 85 is clamped", () => {
            const tileHigh = CacheCalculator.latLngToTile(90, 0, 5);
            const tileMax = CacheCalculator.latLngToTile(85.0511, 0, 5);
            // Both should produce the same y (clamped to webMercatorMaxLat)
            expect(tileHigh.y).toBe(tileMax.y);
        });

        test("latitude below -85 is clamped", () => {
            const tileLow = CacheCalculator.latLngToTile(-90, 0, 5);
            const tileMin = CacheCalculator.latLngToTile(-85.0511, 0, 5);
            expect(tileLow.y).toBe(tileMin.y);
        });

        test("longitude is clamped to [-180, 180]", () => {
            const tileOver = CacheCalculator.latLngToTile(0, 200, 5);
            const tileMax = CacheCalculator.latLngToTile(0, 180, 5);
            expect(tileOver.x).toBe(tileMax.x);
        });
    });

    // ----- buildTileUrl -----

    describe("buildTileUrl", () => {
        test("replaces {x}, {y}, {z} placeholders", () => {
            const url = CacheCalculator.buildTileUrl(
                "https://tile.example.com/{z}/{x}/{y}.png",
                5,
                3,
                12
            );
            expect(url).toBe("https://tile.example.com/12/5/3.png");
        });

        test("replaces {s} with 'a'", () => {
            const url = CacheCalculator.buildTileUrl(
                "https://{s}.tile.example.com/{z}/{x}/{y}.png",
                1,
                2,
                8
            );
            expect(url).toContain("https://a.tile.example.com/");
        });

        test("returns template unchanged when no placeholders", () => {
            const template = "https://static.example.com/tile.png";
            expect(CacheCalculator.buildTileUrl(template, 0, 0, 0)).toBe(template);
        });
    });

    // ----- getTileCoordsForBounds -----

    describe("getTileCoordsForBounds", () => {
        test("returns empty array for null bounds", () => {
            const coords = CacheCalculator.getTileCoordsForBounds(null, 10);
            expect(coords).toEqual([]);
        });

        test("returns empty array when north <= south", () => {
            const bounds = { north: 48, south: 48, east: 3, west: 2 };
            expect(CacheCalculator.getTileCoordsForBounds(bounds, 8)).toEqual([]);
        });

        test("returns empty array when east <= west", () => {
            const bounds = { north: 49, south: 48, east: 2, west: 2 };
            expect(CacheCalculator.getTileCoordsForBounds(bounds, 8)).toEqual([]);
        });

        test("returns tile coords array for valid small bounds at zoom 5", () => {
            // Small area around Paris
            const bounds = { north: 49, south: 48, east: 3, west: 2 };
            const coords = CacheCalculator.getTileCoordsForBounds(bounds, 5);
            expect(Array.isArray(coords)).toBe(true);
            expect(coords.length).toBeGreaterThan(0);
            // Each coord should have x and y
            coords.forEach((c) => {
                expect(c).toHaveProperty("x");
                expect(c).toHaveProperty("y");
            });
        });

        test("returns empty array when tile count exceeds maxTilesPerZoom", () => {
            // Huge bounds at high zoom would exceed limit
            const bounds = { north: 85, south: -85, east: 180, west: -180 };
            const coords = CacheCalculator.getTileCoordsForBounds(bounds, 12, {
                maxTilesPerZoom: 1,
            });
            expect(coords).toEqual([]);
        });
    });

    // ----- estimateTileSize -----

    describe("estimateTileSize", () => {
        test("returns tileCount * default avgTileSize (25 KB)", () => {
            const result = CacheCalculator.estimateTileSize(4);
            expect(result).toBe(4 * 25 * 1024);
        });

        test("uses custom avgSize when provided", () => {
            const result = CacheCalculator.estimateTileSize(3, 10000);
            expect(result).toBe(30000);
        });

        test("returns 0 for 0 tiles", () => {
            expect(CacheCalculator.estimateTileSize(0)).toBe(0);
        });
    });

    // ----- calculateResourcesSize -----

    describe("calculateResourcesSize", () => {
        test("sums size of all resources", () => {
            const resources = [{ size: 1024 }, { size: 2048 }, { size: 512 }];
            expect(CacheCalculator.calculateResourcesSize(resources)).toBe(3584);
        });

        test("treats missing size as 0", () => {
            const resources = [{ url: "a" }, { size: 500 }];
            expect(CacheCalculator.calculateResourcesSize(resources)).toBe(500);
        });
    });

    // ----- formatBytes -----
    //
    // Left untested until CAPACITÉS S1 — along with estimateVectorZone, and those were
    // precisely the two methods plugin-storage consumed. It is a thin delegation to
    // Formatters.formatFileSize; these tests pin the delegation, not the formatter.

    describe("formatBytes", () => {
        test("renders bytes without a decimal part", () => {
            expect(CacheCalculator.formatBytes(512)).toBe("512 B");
        });

        test("renders zero as 0 B", () => {
            expect(CacheCalculator.formatBytes(0)).toBe("0 B");
        });

        test("steps through the KB / MB / GB units", () => {
            expect(CacheCalculator.formatBytes(1024)).toMatch(/^1[.,]00 KB$/);
            expect(CacheCalculator.formatBytes(1024 * 1024)).toMatch(/^1[.,]00 MB$/);
            expect(CacheCalculator.formatBytes(1024 * 1024 * 1024)).toMatch(/^1[.,]00 GB$/);
        });

        test("honours the precision argument", () => {
            expect(CacheCalculator.formatBytes(1536, 0)).toMatch(/^2 KB$/);
            expect(CacheCalculator.formatBytes(1536, 1)).toMatch(/^1[.,]5 KB$/);
        });
    });

    // ----- formatDuration -----

    describe("formatDuration", () => {
        test("formats seconds only", () => {
            expect(CacheCalculator.formatDuration(45)).toBe("45s");
        });

        test("formats minutes and seconds", () => {
            expect(CacheCalculator.formatDuration(90)).toBe("1m 30s");
        });

        test("formats hours, minutes, seconds", () => {
            expect(CacheCalculator.formatDuration(3661)).toBe("1h 1m 1s");
        });

        test("formats zero seconds as '0s'", () => {
            expect(CacheCalculator.formatDuration(0)).toBe("0s");
        });
    });

    // ----- T23 — extractCoordinates (lines 237-280) -----

    describe("extractCoordinates()", () => {
        test("Point geometry returns single coordinate", () => {
            const coords = CacheCalculator.extractCoordinates({
                type: "Point",
                coordinates: [2.35, 48.85],
            });
            expect(coords).toEqual([[2.35, 48.85]]);
        });

        test("MultiPoint geometry returns all coordinates", () => {
            const coords = CacheCalculator.extractCoordinates({
                type: "MultiPoint",
                coordinates: [
                    [1, 2],
                    [3, 4],
                ],
            });
            expect(coords).toEqual([
                [1, 2],
                [3, 4],
            ]);
        });

        test("LineString geometry returns all coordinates", () => {
            const coords = CacheCalculator.extractCoordinates({
                type: "LineString",
                coordinates: [
                    [0, 0],
                    [1, 1],
                    [2, 2],
                ],
            });
            expect(coords).toEqual([
                [0, 0],
                [1, 1],
                [2, 2],
            ]);
        });

        test("MultiLineString geometry returns all coordinates", () => {
            const coords = CacheCalculator.extractCoordinates({
                type: "MultiLineString",
                coordinates: [
                    [
                        [0, 0],
                        [1, 1],
                    ],
                    [
                        [2, 2],
                        [3, 3],
                    ],
                ],
            });
            expect(coords).toEqual([
                [0, 0],
                [1, 1],
                [2, 2],
                [3, 3],
            ]);
        });

        test("Polygon geometry returns all ring coordinates", () => {
            const coords = CacheCalculator.extractCoordinates({
                type: "Polygon",
                coordinates: [
                    [
                        [0, 0],
                        [1, 0],
                        [1, 1],
                        [0, 0],
                    ],
                ],
            });
            expect(coords).toEqual([
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 0],
            ]);
        });

        test("MultiPolygon geometry returns all coordinates", () => {
            const coords = CacheCalculator.extractCoordinates({
                type: "MultiPolygon",
                coordinates: [
                    [
                        [
                            [0, 0],
                            [1, 0],
                        ],
                        [
                            [2, 2],
                            [3, 3],
                        ],
                    ],
                ],
            });
            expect(coords.length).toBe(4);
        });

        test("GeometryCollection extracts from all sub-geometries", () => {
            const coords = CacheCalculator.extractCoordinates({
                type: "GeometryCollection",
                geometries: [
                    { type: "Point", coordinates: [5, 6] },
                    { type: "Point", coordinates: [7, 8] },
                ],
            });
            expect(coords).toEqual([
                [5, 6],
                [7, 8],
            ]);
        });

        test("unknown geometry type returns empty array", () => {
            const coords = CacheCalculator.extractCoordinates({ type: "Unknown" });
            expect(coords).toEqual([]);
        });
    });

    // ----- T23 — expandBounds (lines 292-310) -----

    describe("expandBounds()", () => {
        test("returns null for empty coords array", () => {
            expect(CacheCalculator.expandBounds(null, [])).toBeNull();
        });

        test("initialises bounds from first coord when bounds is null", () => {
            const bounds = CacheCalculator.expandBounds(null, [[2.35, 48.85]]);
            expect(bounds).toEqual({ north: 48.85, south: 48.85, east: 2.35, west: 2.35 });
        });

        test("expands existing bounds with new coordinates", () => {
            const initial = { north: 48.85, south: 48.85, east: 2.35, west: 2.35 };
            const bounds = CacheCalculator.expandBounds(initial, [
                [3.0, 49.0],
                [1.0, 47.0],
            ]);
            expect(bounds.north).toBe(49.0);
            expect(bounds.south).toBe(47.0);
            expect(bounds.east).toBe(3.0);
            expect(bounds.west).toBe(1.0);
        });
    });

    // ----- T23 — estimateDownloadTime (lines 348-352) -----

    describe("estimateDownloadTime()", () => {
        test("calculates time with default 10 Mbps speed", () => {
            // 10MB at 10Mbps = 10*1024*1024*8 / 10000000 = 8.388... → ceil → 9s
            const t = CacheCalculator.estimateDownloadTime(10 * 1024 * 1024);
            expect(t).toBeGreaterThan(0);
        });

        test("uses custom speed", () => {
            // 100MB at 100Mbps
            const t100 = CacheCalculator.estimateDownloadTime(100 * 1024 * 1024, 100);
            const t10 = CacheCalculator.estimateDownloadTime(100 * 1024 * 1024, 10);
            expect(t10).toBeGreaterThan(t100);
        });
    });

    // ----- T23 — enumerateTiles (lines 382-448) -----

    describe("enumerateTiles()", () => {
        test("returns empty array when bounds is null", async () => {
            const tiles = await CacheCalculator.enumerateTiles(
                { url: "https://a/{z}/{x}/{y}.png" },
                "p1"
            );
            expect(tiles).toEqual([]);
        });

        test("returns empty array when URL template is null", async () => {
            const tiles = await CacheCalculator.enumerateTiles(
                {
                    bounds: { north: 49, south: 48, east: 3, west: 2 },
                },
                "p1"
            );
            expect(tiles).toEqual([]);
        });

        test("returns tile array for valid config with 2 zoom levels", async () => {
            const tiles = await CacheCalculator.enumerateTiles(
                {
                    bounds: { north: 49, south: 48, east: 3, west: 2 },
                    url: "https://tile.example.com/{z}/{x}/{y}.png",
                    cacheMinZoom: 5,
                    cacheMaxZoom: 6,
                },
                "profile1"
            );
            expect(Array.isArray(tiles)).toBe(true);
            expect(tiles.length).toBeGreaterThan(0);
            expect(tiles[0]).toMatchObject({
                type: "tile",
                url: expect.stringContaining("tile.example.com"),
            });
        });

        test("uses offlineBounds when bounds is undefined", async () => {
            const tiles = await CacheCalculator.enumerateTiles(
                {
                    offlineBounds: { north: 49, south: 48, east: 3, west: 2 },
                    url: "https://tile.example.com/{z}/{x}/{y}.png",
                    cacheMinZoom: 5,
                    cacheMaxZoom: 5,
                },
                "p1"
            );
            expect(tiles.length).toBeGreaterThan(0);
        });

        test("uses minZoom/maxZoom when cacheMinZoom/cacheMaxZoom not set", async () => {
            // cacheMinZoom/cacheMaxZoom undefined → falls back to minZoom/maxZoom
            const tiles = await CacheCalculator.enumerateTiles(
                {
                    bounds: { north: 49, south: 48, east: 3, west: 2 },
                    url: "https://tile.example.com/{z}/{x}/{y}.png",
                    minZoom: 5,
                    maxZoom: 5,
                },
                "p1"
            );
            expect(tiles.length).toBeGreaterThan(0);
        });

        test("uses fallbackUrl when url is undefined", async () => {
            const tiles = await CacheCalculator.enumerateTiles(
                {
                    bounds: { north: 49, south: 48, east: 3, west: 2 },
                    fallbackUrl: "https://fallback.example.com/{z}/{x}/{y}.png",
                    cacheMinZoom: 5,
                    cacheMaxZoom: 5,
                },
                "p1"
            );
            expect(tiles[0].url).toContain("fallback.example.com");
        });

        test("skips zoom level when getTileCoordsForBounds returns empty (line 427 continue)", async () => {
            // Use zoom 16-17 where Paris bounds exceed maxTilesPerZoom (30000) → skip
            // At zoom 16: ~184*280 = ~51520 tiles > 30000 → skip
            const tiles = await CacheCalculator.enumerateTiles(
                {
                    bounds: { north: 49, south: 48, east: 3, west: 2 },
                    url: "https://tile.example.com/{z}/{x}/{y}.png",
                    cacheMinZoom: 16,
                    cacheMaxZoom: 17,
                },
                "p1"
            );
            // Both zoom levels skip since count > 30000 → returns []
            expect(tiles).toEqual([]);
        });

        test("stops at maxTotalTiles limit (line 433-436 return early)", async () => {
            const origMax = CacheCalculator.defaults.maxTotalTiles;
            CacheCalculator.defaults.maxTotalTiles = 3; // very small limit
            const tiles = await CacheCalculator.enumerateTiles(
                {
                    bounds: { north: 49, south: 48, east: 3, west: 2 },
                    url: "https://tile.example.com/{z}/{x}/{y}.png",
                    cacheMinZoom: 5,
                    cacheMaxZoom: 8,
                },
                "p1"
            );
            expect(tiles.length).toBeLessThanOrEqual(3);
            CacheCalculator.defaults.maxTotalTiles = origMax;
        });
    });

    // ----- T23 — calculateProfileBounds (lines 164-212) -----

    describe("calculateProfileBounds()", () => {
        let originalFetch;

        beforeEach(() => {
            originalFetch = global.fetch;
        });

        afterEach(() => {
            global.fetch = originalFetch;
        });

        test("returns bounds for FeatureCollection with Point geometry", async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                headers: { get: () => "application/json" },
                json: () =>
                    Promise.resolve({
                        type: "FeatureCollection",
                        features: [
                            { geometry: { type: "Point", coordinates: [2.35, 48.85] } },
                            { geometry: { type: "Point", coordinates: [3.0, 49.0] } },
                        ],
                    }),
            });
            const bounds = await CacheCalculator.calculateProfileBounds({}, [
                { type: "layer", url: "https://example.com/layer.json" },
            ]);
            expect(bounds).not.toBeNull();
            expect(bounds.north).toBeGreaterThan(48.85);
            expect(bounds.south).toBeLessThan(48.85);
        });

        test("returns null when no layer resources provided", async () => {
            global.fetch = vi.fn();
            const bounds = await CacheCalculator.calculateProfileBounds({}, []);
            expect(bounds).toBeNull();
        });

        test("skips resources without url or not of type layer", async () => {
            global.fetch = vi.fn();
            const bounds = await CacheCalculator.calculateProfileBounds({}, [
                { type: "tile" }, // not a layer
                { type: "layer" }, // no url
            ]);
            expect(bounds).toBeNull();
            expect(global.fetch).not.toHaveBeenCalled();
        });

        test("handles fetch error gracefully and returns null", async () => {
            global.fetch = vi.fn().mockRejectedValue(new Error("network error"));
            const bounds = await CacheCalculator.calculateProfileBounds({}, [
                { type: "layer", url: "https://example.com/fail.json" },
            ]);
            expect(bounds).toBeNull();
        });

        test("skips non-ok response", async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                headers: { get: () => "application/json" },
            });
            const bounds = await CacheCalculator.calculateProfileBounds({}, [
                { type: "layer", url: "https://example.com/layer.json" },
            ]);
            expect(bounds).toBeNull();
        });

        test("skips layer JSON without geometry.coordinates", async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                headers: { get: () => "application/json" },
                json: () =>
                    Promise.resolve({
                        type: "FeatureCollection",
                        features: [
                            { geometry: null }, // no geometry
                            { geometry: { type: "Point" } }, // geometry but no coordinates
                        ],
                    }),
            });
            const bounds = await CacheCalculator.calculateProfileBounds({}, [
                { type: "layer", url: "https://example.com/empty.json" },
            ]);
            expect(bounds).toBeNull();
        });
    });
});
