/**
 * Unit tests — one assumed average tile size, not three (CAPACITÉS B.16).
 *
 * `estimateProfileSize` guesses a per-tile size whenever it has no measurement. It did
 * so with TWO different magic numbers, both introduced by the same commit (f14249056):
 *   - `metrics.ts`  25 KB, on the >100k-tiles path where no HEAD is attempted at all
 *     ("based on empirical data" — the only one carrying a justification);
 *   - `metrics.ts`  15000, on the sampled path when every HEAD came back without a
 *     Content-Length, i.e. the SAME epistemic situation: no measurement, guess.
 * A third copy sat in `calculator.ts` (`defaults.avgTileSize`, 25 KB).
 *
 * Same quantity, same situation, three literals. They are unified on the exported
 * `AVG_TILE_SIZE_BYTES`, and 25 KB wins because it is the documented one.
 *
 * ⚠️ NOT unified: `cache/tile-math.ts` `AVG_PBF_BYTES` (30 KB). That file is
 * delegated to the PLUGINS roadmap and is out of this lot's perimeter — and it sizes
 * VECTOR .pbf tiles, not the raster tiles this estimator walks.
 */

import { CacheMetrics } from "../../../src/capabilities/offline/cache/metrics.js";
import {
    CacheCalculator,
    AVG_TILE_SIZE_BYTES,
} from "../../../src/capabilities/offline/cache/calculator.js";

describe("estimateProfileSize — a single assumed tile size", () => {
    let realFetch;

    beforeAll(() => {
        realFetch = global.fetch;
    });

    afterAll(() => {
        global.fetch = realFetch;
    });

    test("the constant is exported and is the documented 25 KB", () => {
        expect(AVG_TILE_SIZE_BYTES).toBe(25 * 1024);
    });

    test("CacheCalculator.defaults.avgTileSize IS that constant, not a copy of its value", () => {
        expect(CacheCalculator.defaults.avgTileSize).toBe(AVG_TILE_SIZE_BYTES);
    });

    test("the unsampled path (>100k tiles) uses it", async () => {
        global.fetch = vi.fn();
        const tiles = Array.from({ length: 100001 }, (_, i) => ({
            url: `https://a.test/tile${i}.png`,
            type: "tile",
        }));

        const result = await CacheMetrics.estimateProfileSize("p1", tiles);

        expect(global.fetch).not.toHaveBeenCalled();
        expect(result.totalSize).toBe(AVG_TILE_SIZE_BYTES * 100001);
    });

    test("the sampled path falls back to the SAME constant when no HEAD yields a size", async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            headers: { get: () => null }, // no Content-Length anywhere
        });
        const tiles = [{ url: "https://a.test/t.png", type: "tile" }];

        const result = await CacheMetrics.estimateProfileSize("p1", tiles);

        expect(result.totalSize).toBe(AVG_TILE_SIZE_BYTES);
    });

    test("a real measurement still wins over the assumption", async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            headers: { get: (k) => (k === "Content-Length" ? "4096" : null) },
        });
        const tiles = [{ url: "https://a.test/t.png", type: "tile" }];

        const result = await CacheMetrics.estimateProfileSize("p1", tiles);

        expect(result.totalSize).toBe(4096);
        expect(result.sampleCount).toBe(1);
    });
});
