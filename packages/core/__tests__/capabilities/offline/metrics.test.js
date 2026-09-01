/**
 * Unit tests — CacheMetrics
 * Covers: _fallbackResourceSize, _fetchHeadContentLengths, getStorageQuota,
 *         estimateProfileSize, formatBytes.
 *
 * B.12 — seven describes left with their methods (`hasEnoughSpace`,
 * `getCachedResourcesSize`, `getCacheStatistics`, `calculateProgress`, `calculateSpeed`,
 * `formatSpeed`, `estimateRemainingTime`): zero production consumers, and for the last four
 * a DIVERGENT reimplementation had superseded them inside
 * `ProgressTracker._calculateProgress`, which is the path actually wired to the UI.
 *
 * ⚠️ One assertion did NOT leave with them: "caps at 100 when downloaded > total". It
 * carried the only thing the dead code still knew and the live path did not — the live
 * percentage was unclamped and reached 150 % / 200 % under a double count. It now lives on
 * the wired path, in `progress-tracker.test.js` → "percentage stays within [0, 100] (B.12)".
 * Purging on the "no caller" signal alone would have destroyed it.
 */

import { CacheMetrics } from "../../../src/capabilities/offline/cache/metrics.js";

describe("CacheMetrics", () => {
    let originalFetch;
    let originalStorage;

    beforeEach(() => {
        originalFetch = global.fetch;
        // Preserve original navigator.storage if it exists
        originalStorage = navigator.storage;
    });

    afterEach(() => {
        global.fetch = originalFetch;
        // Restore navigator.storage
        try {
            Object.defineProperty(navigator, "storage", {
                value: originalStorage,
                configurable: true,
                writable: true,
            });
        } catch (_) {
            /* ignore */
        }
        vi.useRealTimers();
    });

    // ----- _fallbackResourceSize() -----

    describe("_fallbackResourceSize()", () => {
        test("returns 10000 for resource with no type", () => {
            expect(CacheMetrics._fallbackResourceSize({})).toBe(10000);
        });

        test("returns 10000 when resource is null/undefined", () => {
            expect(CacheMetrics._fallbackResourceSize(null)).toBe(10000);
            expect(CacheMetrics._fallbackResourceSize(undefined)).toBe(10000);
        });

        test("returns 500000 for type=layer", () => {
            expect(CacheMetrics._fallbackResourceSize({ type: "layer" })).toBe(500000);
        });

        test("returns 50000 for type=theme", () => {
            expect(CacheMetrics._fallbackResourceSize({ type: "theme" })).toBe(50000);
        });

        test("returns 10000 for unknown type", () => {
            expect(CacheMetrics._fallbackResourceSize({ type: "tile" })).toBe(10000);
        });
    });

    describe("formatBytes()", () => {
        test("returns human-readable size string", () => {
            const result = CacheMetrics.formatBytes(1024 * 1024);
            expect(typeof result).toBe("string");
            expect(result.length).toBeGreaterThan(0);
        });

        test("returns formatted string for 0", () => {
            const result = CacheMetrics.formatBytes(0);
            expect(typeof result).toBe("string");
        });
    });

    describe("_fetchHeadContentLengths()", () => {
        function makeMockHeadResponse({ ok = true, headers = {} } = {}) {
            const headerMap = new Map(Object.entries(headers));
            return {
                ok,
                status: ok ? 200 : 503,
                headers: { get: (k) => headerMap.get(k) ?? null },
            };
        }

        test("returns results with contentLength when Content-Length header present", async () => {
            global.fetch = vi
                .fn()
                .mockResolvedValue(makeMockHeadResponse({ headers: { "Content-Length": "2048" } }));
            const results = await CacheMetrics._fetchHeadContentLengths([
                { url: "https://example.com/tile.png", type: "tile" },
            ]);
            expect(results).toHaveLength(1);
            expect(results[0].contentLength).toBe(2048);
            expect(results[0].ok).toBe(true);
        });

        test("sets contentLength to null when Content-Length is missing", async () => {
            global.fetch = vi.fn().mockResolvedValue(makeMockHeadResponse({}));
            const results = await CacheMetrics._fetchHeadContentLengths([
                { url: "https://example.com/tile.png", type: "tile" },
            ]);
            expect(results[0].contentLength).toBeNull();
        });

        test("sets contentLength to null for non-finite Content-Length (e.g. 'NaN')", async () => {
            global.fetch = vi
                .fn()
                .mockResolvedValue(
                    makeMockHeadResponse({ headers: { "Content-Length": "not-a-number" } })
                );
            const results = await CacheMetrics._fetchHeadContentLengths([
                { url: "https://example.com/x.png", type: "tile" },
            ]);
            expect(results[0].contentLength).toBeNull();
        });

        test("records ok=false when response is not ok", async () => {
            global.fetch = vi.fn().mockResolvedValue(makeMockHeadResponse({ ok: false }));
            const results = await CacheMetrics._fetchHeadContentLengths([
                { url: "https://example.com/x.png", type: "tile" },
            ]);
            expect(results[0].ok).toBe(false);
            expect(results[0].contentLength).toBeNull();
        });

        test("records ok=false when fetch throws", async () => {
            global.fetch = vi.fn().mockRejectedValue(new Error("net error"));
            const results = await CacheMetrics._fetchHeadContentLengths([
                { url: "https://example.com/x.png", type: "tile" },
            ]);
            expect(results[0].ok).toBe(false);
        });

        test("skips resources without url", async () => {
            global.fetch = vi.fn().mockResolvedValue(makeMockHeadResponse({}));
            const results = await CacheMetrics._fetchHeadContentLengths([
                { type: "tile" }, // no url
                { url: "https://example.com/ok.png", type: "tile" },
            ]);
            // Skipped resource is not added to results
            expect(results.some((r) => r.resource.url === "https://example.com/ok.png")).toBe(true);
        });

        test("handles empty resources array", async () => {
            global.fetch = vi.fn();
            const results = await CacheMetrics._fetchHeadContentLengths([]);
            expect(results).toEqual([]);
        });

        test("clamps concurrency to [1, 20]", async () => {
            global.fetch = vi.fn().mockResolvedValue(makeMockHeadResponse({}));
            // concurrency=0 should be clamped to 1
            const results = await CacheMetrics._fetchHeadContentLengths(
                [{ url: "https://example.com/a.png", type: "tile" }],
                0
            );
            expect(results).toHaveLength(1);
        });
    });

    // ----- getStorageQuota() -----

    // ⚠️ THE `getStorageQuota` BLOCK IS REMOVED — so is the method. It was one
    // of THREE wrappings of `navigator.storage.estimate()` in the same
    // capability, and one of the TWO without a production caller. 🛑 The three
    // returned DIFFERENT key vocabularies (`used` vs `usage`): picking the
    // wrong copy read `undefined` silently. The survivor,
    // `CacheManager.getStorageQuota()`, keeps its tests.

    describe("estimateProfileSize()", () => {
        test("returns estimation with byType and resourceCounts for empty resources", async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                headers: { get: () => null },
            });
            const result = await CacheMetrics.estimateProfileSize("profile1", []);
            expect(result).toHaveProperty("totalSize");
            expect(result).toHaveProperty("byType");
            expect(result).toHaveProperty("resourceCounts");
            expect(result.resourceCounts.total).toBe(0);
        });

        test("handles non-tile resources using HEAD results", async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                headers: { get: (k) => (k === "Content-Length" ? "5000" : null) },
            });
            const resources = [
                { url: "https://a.com/layer.json", type: "layer" },
                { url: "https://a.com/theme.json", type: "theme" },
                { url: "https://a.com/config.json", type: "config" },
            ];
            const result = await CacheMetrics.estimateProfileSize("p1", resources);
            expect(result.totalSize).toBeGreaterThan(0);
            expect(result.byType.layers).toBeGreaterThan(0);
        });

        test("uses _fallbackResourceSize when contentLength is null", async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 404,
                headers: { get: () => null },
            });
            const resources = [{ url: "https://a.com/other.json", type: "other" }];
            const result = await CacheMetrics.estimateProfileSize("p1", resources);
            // _fallbackResourceSize("other") returns 10000
            expect(result.byType.other).toBe(10000);
        });

        test("uses direct estimation for > 100000 tiles", async () => {
            global.fetch = vi.fn();
            // Build 100001 tile resources
            const tiles = Array.from({ length: 100001 }, (_, i) => ({
                url: `https://a.com/tile${i}.png`,
                type: "tile",
            }));
            const result = await CacheMetrics.estimateProfileSize("p1", tiles);
            // Should use direct estimation (25KB * 100001) without calling fetch
            expect(global.fetch).not.toHaveBeenCalled();
            expect(result.totalSize).toBe(25 * 1024 * 100001);
        });

        test("samples tiles and extrapolates for <= 100000 tiles", async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                headers: { get: (k) => (k === "Content-Length" ? "12000" : null) },
            });
            const tiles = Array.from({ length: 50 }, (_, i) => ({
                url: `https://a.com/tile${i}.png`,
                type: "tile",
            }));
            const result = await CacheMetrics.estimateProfileSize("p1", tiles);
            expect(result.totalSize).toBeGreaterThan(0);
            expect(result.byType.tiles).toBeGreaterThan(0);
        });

        test("uses maxSamples option for tiles sampling", async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                headers: { get: (k) => (k === "Content-Length" ? "8000" : null) },
            });
            const tiles = Array.from({ length: 100 }, (_, i) => ({
                url: `https://a.com/tile${i}.png`,
                type: "tile",
            }));
            // maxSamples=10 means only 10 HEAD requests for tiles
            await CacheMetrics.estimateProfileSize("p1", tiles, { maxSamples: 10 });
            // fetchHeadContentLengths called with slice of 10 tiles
            expect(global.fetch).toHaveBeenCalledTimes(10);
        });

        test("uses the shared default tile size when no HEAD content-length returned", async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                headers: { get: () => null }, // no Content-Length
            });
            const tiles = [{ url: "https://a.com/t.png", type: "tile" }];
            const result = await CacheMetrics.estimateProfileSize("p1", tiles);
            // sampleCount=0 → avgTileSize=AVG_TILE_SIZE_BYTES → total = 25600 * 1.
            // Was 15000: a second, undocumented guess for the same quantity the
            // >100k-tiles branch already guessed at 25 KB (CAPACITÉS B.16, unified).
            expect(result.totalSize).toBe(25 * 1024);
        });
    });
});
