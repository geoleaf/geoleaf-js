/*!
 * Tests — fgb-bbox-filter.ts
 * Bbox-filtered FlatGeobuf loading + auto-refresh.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadFgbBbox, setupAutoRefresh } from "../fgb-bbox-filter.js";
import type { FgbBbox } from "../types.js";

// ─── Mock flatgeobuf ──────────────────────────────────────────────────────────

const mockDeserialize = vi.fn();

vi.mock("flatgeobuf/lib/mjs/geojson.js", () => ({
    deserialize: (...args: unknown[]) => mockDeserialize(...args),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFeature(id: number) {
    return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [id, id] },
        properties: { id },
    };
}

async function* asyncIterator(features: unknown[]) {
    for (const f of features) yield f;
}

const VALID_BBOX: FgbBbox = { minX: -1, minY: -1, maxX: 1, maxY: 1 };

// ─── Tests — loadFgbBbox ──────────────────────────────────────────────────────

describe("loadFgbBbox", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (globalThis as any).GeoLeaf = undefined;
    });

    it("loads features within a bounding box", async () => {
        const features = [makeFeature(1), makeFeature(2)];
        mockDeserialize.mockReturnValue(asyncIterator(features));

        const result = await loadFgbBbox("https://example.com/data.fgb", VALID_BBOX);

        expect(result.featureCount).toBe(2);
        expect(result.data.type).toBe("FeatureCollection");
        expect(mockDeserialize).toHaveBeenCalledWith(
            "https://example.com/data.fgb",
            expect.objectContaining({ minX: -1, minY: -1, maxX: 1, maxY: 1 })
        );
    });

    it("returns empty collection when no features in bbox", async () => {
        mockDeserialize.mockReturnValue(asyncIterator([]));

        const result = await loadFgbBbox("https://example.com/data.fgb", VALID_BBOX);

        expect(result.featureCount).toBe(0);
        expect(result.data.features).toHaveLength(0);
    });

    it("respects maxFeatures limit", async () => {
        const features = Array.from({ length: 50 }, (_, i) => makeFeature(i));
        mockDeserialize.mockReturnValue(asyncIterator(features));

        const result = await loadFgbBbox("https://example.com/data.fgb", VALID_BBOX, {
            maxFeatures: 10,
        });

        expect(result.featureCount).toBe(10);
    });

    it("stops iteration on abort", async () => {
        const controller = new AbortController();

        async function* abortingIterator() {
            for (let i = 0; i < 100; i++) {
                if (i === 5) controller.abort();
                yield makeFeature(i);
            }
        }

        mockDeserialize.mockReturnValue(abortingIterator());

        const result = await loadFgbBbox("https://example.com/data.fgb", VALID_BBOX, {
            signal: controller.signal,
        });

        expect(result.featureCount).toBeLessThanOrEqual(7);
        expect(result.featureCount).toBeGreaterThan(0);
    });

    it("rejects invalid bbox (minX > maxX)", async () => {
        const badBbox: FgbBbox = { minX: 10, minY: -1, maxX: -10, maxY: 1 };

        await expect(loadFgbBbox("https://example.com/data.fgb", badBbox)).rejects.toThrow(
            "Invalid bbox"
        );
    });

    it("rejects bbox with NaN values", async () => {
        const badBbox: FgbBbox = { minX: NaN, minY: -1, maxX: 1, maxY: 1 };

        await expect(loadFgbBbox("https://example.com/data.fgb", badBbox)).rejects.toThrow(
            "Invalid bbox"
        );
    });

    it("rejects invalid URL", async () => {
        await expect(loadFgbBbox("ftp://example.com/data.fgb", VALID_BBOX)).rejects.toThrow(
            "Invalid or disallowed URL"
        );
    });

    it("calls onHeader callback", async () => {
        const iterObj = asyncIterator([makeFeature(1)]);
        (iterObj as any).header = { geometryType: "Point" };
        mockDeserialize.mockReturnValue(iterObj);

        const onHeader = vi.fn();
        await loadFgbBbox("https://example.com/data.fgb", VALID_BBOX, { onHeader });

        expect(onHeader).toHaveBeenCalledTimes(1);
    });

    it("rejects already-aborted signal", async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(
            loadFgbBbox("https://example.com/data.fgb", VALID_BBOX, {
                signal: controller.signal,
            })
        ).rejects.toThrow("aborted before start");
    });
});

// ─── Tests — setupAutoRefresh ─────────────────────────────────────────────────

describe("setupAutoRefresh", () => {
    it("registers moveend listener and returns cleanup", () => {
        const listeners: Record<string, Function> = {};
        const mockMap = {
            on: vi.fn((evt: string, fn: Function) => {
                listeners[evt] = fn;
            }),
            off: vi.fn(),
            getBounds: () => ({
                getWest: () => -10,
                getSouth: () => -10,
                getEast: () => 10,
                getNorth: () => 10,
            }),
        };

        const reloadFn = vi.fn();
        const cleanup = setupAutoRefresh(mockMap, "https://example.com/data.fgb", {}, reloadFn);

        expect(mockMap.on).toHaveBeenCalledWith("moveend", expect.any(Function));
        expect(typeof cleanup).toBe("function");

        cleanup();
        expect(mockMap.off).toHaveBeenCalledWith("moveend", expect.any(Function));
    });

    it("debounces and calls reload with bbox on moveend", async () => {
        vi.useFakeTimers();

        const listeners: Record<string, Function> = {};
        const mockMap = {
            on: vi.fn((evt: string, fn: Function) => {
                listeners[evt] = fn;
            }),
            off: vi.fn(),
            getBounds: () => ({
                getWest: () => -5,
                getSouth: () => -5,
                getEast: () => 5,
                getNorth: () => 5,
            }),
        };

        const reloadFn = vi.fn();
        setupAutoRefresh(mockMap, "https://example.com/data.fgb", { debounceMs: 100 }, reloadFn);

        // Trigger moveend multiple times rapidly
        listeners["moveend"]();
        listeners["moveend"]();
        listeners["moveend"]();

        // Not yet called (debounced)
        expect(reloadFn).not.toHaveBeenCalled();

        // Advance past debounce
        vi.advanceTimersByTime(150);

        expect(reloadFn).toHaveBeenCalledTimes(1);
        expect(reloadFn).toHaveBeenCalledWith({
            minX: -5,
            minY: -5,
            maxX: 5,
            maxY: 5,
        });

        vi.useRealTimers();
    });
});
