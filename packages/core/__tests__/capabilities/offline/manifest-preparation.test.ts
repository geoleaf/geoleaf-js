/**
 * The offline preparation leaves a trace it can be read back from — what was asked, and what
 * was left out.
 *
 * Before this, a zoom skipped because it held too many tiles, or an enumeration stopped at the
 * total cap, was only LOGGED: the console of a device in the field is read by nobody, and the
 * pre-departure check (`Storage.preflight`) could not say "zooms 15 and 16 of this basemap are
 * not on the device". The trace travels in the manifest the preparation already writes.
 *
 * Found on the way: `getCacheStatus().cachedAt` was always `null` — it read a field the
 * manifest never wrote (`generatedAt` was written instead).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TilePreparationTrace } from "../../../src/contracts/sync.contract.js";

const { CacheCalculator } = await import("../../../src/capabilities/offline/cache/calculator.js");
const { CacheStorage } = await import("../../../src/capabilities/offline/cache/storage.js");
const { CacheManager } = await import("../../../src/capabilities/offline/cache/cache-manager.js");
const { clearMockStore } = await import("../../__mocks__/indexeddb.js");

const saved = { ...CacheCalculator.defaults };

function freshTrace(): TilePreparationTrace {
    return { zone: null, skippedZooms: [], capped: false };
}

/** A small area, so the per-zoom cap below bites at a known zoom. */
const LAYER = {
    id: "fond",
    url: "https://tiles.example/{z}/{x}/{y}.png",
    bounds: { north: -32.9, south: -33.0, east: -60.6, west: -60.7 },
    cacheMinZoom: 10,
    cacheMaxZoom: 16,
};

beforeEach(() => {
    clearMockStore();
});

afterEach(() => {
    Object.assign(CacheCalculator.defaults, saved);
    vi.restoreAllMocks();
});

describe("the tile enumeration records what it leaves out", () => {
    it("a zoom skipped for its tile count is recorded, with its source", async () => {
        CacheCalculator.defaults.maxTilesPerZoom = 20;
        const trace = freshTrace();
        await CacheCalculator.enumerateTiles(LAYER, "tourism", trace);
        const skipped = trace.skippedZooms.map((s) => s.zoom);
        expect(skipped.length).toBeGreaterThan(0);
        expect(skipped).toContain(16);
        expect(skipped).not.toContain(10);
        expect(trace.skippedZooms.every((s) => s.source === "fond")).toBe(true);
    });

    it("an enumeration stopped by the total cap says so", async () => {
        CacheCalculator.defaults.maxTotalTiles = 3;
        const trace = freshTrace();
        await CacheCalculator.enumerateTiles(LAYER, "tourism", trace);
        expect(trace.capped).toBe(true);
    });

    it("without a trace, nothing changes for the caller", async () => {
        const tiles = await CacheCalculator.enumerateTiles(LAYER, "tourism");
        expect(tiles.length).toBeGreaterThan(0);
    });
});

describe("the manifest keeps the trace, and when it was written", () => {
    it("the trace is read back, and `cachedAt` is a number", async () => {
        const trace = freshTrace();
        trace.skippedZooms.push({ source: "fond", zoom: 16, tiles: 99 });
        await CacheStorage.saveManifest("tourism", {
            cached: ["u1"],
            failed: [],
            totalSize: 1,
            resourcesCount: 1,
            duration: 1,
            preparation: trace,
        });
        const manifest = (await CacheStorage.getManifest("tourism")) as Record<string, unknown>;
        expect(manifest["preparation"]).toEqual(trace);
        expect(typeof manifest["cachedAt"]).toBe("number");
        const status = await CacheManager.getCacheStatus("tourism");
        expect(typeof status.cachedAt).toBe("number");
    });
});
