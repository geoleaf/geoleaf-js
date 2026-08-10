/*!
 * Tests — fgb-loader.ts
 * Full-file FlatGeobuf loading via async iterator.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadFgb } from "../fgb-loader.js";

// ─── Mock flatgeobuf/lib/mjs/geojson.js ───────────────────────────────────────

const mockDeserialize = vi.fn();

vi.mock("flatgeobuf/lib/mjs/geojson.js", () => ({
    deserialize: (...args: unknown[]) => mockDeserialize(...args),
}));

// ─── Mock global fetch ────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFeature(id: number) {
    return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [id, id] },
        properties: { id, name: `feature-${id}` },
    };
}

async function* asyncIterator(features: unknown[]) {
    for (const f of features) yield f;
}

function mockFetchOk(body: unknown = "stream") {
    mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        body,
    });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("loadFgb", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset GeoLeaf.Utils.validateUrl
        (globalThis as any).GeoLeaf = undefined;
    });

    it("loads features from a FlatGeobuf URL", async () => {
        const features = [makeFeature(1), makeFeature(2), makeFeature(3)];
        mockFetchOk();
        mockDeserialize.mockReturnValue(asyncIterator(features));

        const result = await loadFgb("https://example.com/data.fgb");

        expect(result.featureCount).toBe(3);
        expect(result.data.type).toBe("FeatureCollection");
        expect(result.data.features).toHaveLength(3);
        expect(result.data.features[0].properties).toEqual({ id: 1, name: "feature-1" });
    });

    it("respects maxFeatures limit", async () => {
        const features = Array.from({ length: 20 }, (_, i) => makeFeature(i));
        mockFetchOk();
        mockDeserialize.mockReturnValue(asyncIterator(features));

        const result = await loadFgb("https://example.com/data.fgb", { maxFeatures: 5 });

        expect(result.featureCount).toBe(5);
        expect(result.data.features).toHaveLength(5);
    });

    it("propagates AbortSignal to fetch", async () => {
        const controller = new AbortController();
        const features = [makeFeature(1)];
        mockFetchOk();
        mockDeserialize.mockReturnValue(asyncIterator(features));

        await loadFgb("https://example.com/data.fgb", { signal: controller.signal });

        expect(mockFetch).toHaveBeenCalledWith(
            "https://example.com/data.fgb",
            expect.objectContaining({ signal: controller.signal })
        );
    });

    it("rejects invalid URLs", async () => {
        await expect(loadFgb("ftp://bad.com/data.fgb")).rejects.toThrow(
            "Invalid or disallowed URL"
        );
    });

    it("rejects already-aborted signal", async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(
            loadFgb("https://example.com/data.fgb", { signal: controller.signal })
        ).rejects.toThrow("aborted before start");
    });

    it("throws on HTTP error response", async () => {
        mockFetch.mockResolvedValue({ ok: false, status: 404 });

        await expect(loadFgb("https://example.com/missing.fgb")).rejects.toThrow("HTTP 404");
    });

    it("returns empty FeatureCollection for 0 features", async () => {
        mockFetchOk();
        mockDeserialize.mockReturnValue(asyncIterator([]));

        const result = await loadFgb("https://example.com/empty.fgb");

        expect(result.featureCount).toBe(0);
        expect(result.data.features).toHaveLength(0);
        expect(result.data.type).toBe("FeatureCollection");
    });

    it("calls onHeader callback", async () => {
        const features = [makeFeature(1)];
        mockFetchOk();
        const iterObj = asyncIterator(features);
        (iterObj as any).header = { geometryType: "Point", featuresCount: 1 };
        mockDeserialize.mockReturnValue(iterObj);

        const onHeader = vi.fn();
        await loadFgb("https://example.com/data.fgb", { onHeader });

        expect(onHeader).toHaveBeenCalledTimes(1);
        expect(onHeader).toHaveBeenCalledWith(expect.objectContaining({ geometryType: "Point" }));
    });

    it("stops on AbortSignal during iteration", async () => {
        const controller = new AbortController();

        async function* abortingIterator() {
            for (let i = 0; i < 100; i++) {
                if (i === 3) controller.abort();
                yield makeFeature(i);
            }
        }

        mockFetchOk();
        mockDeserialize.mockReturnValue(abortingIterator());

        const result = await loadFgb("https://example.com/data.fgb", {
            signal: controller.signal,
        });

        // Should have collected features before abort was detected
        expect(result.featureCount).toBeLessThanOrEqual(5);
        expect(result.featureCount).toBeGreaterThan(0);
    });

    it("preserves feature properties intact", async () => {
        const feature = {
            type: "Feature",
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [0, 0],
                        [1, 0],
                        [1, 1],
                        [0, 0],
                    ],
                ],
            },
            properties: { name: "test-zone", area: 42.5, tags: ["a", "b"] },
        };
        mockFetchOk();
        mockDeserialize.mockReturnValue(asyncIterator([feature]));

        const result = await loadFgb("https://example.com/zones.fgb");

        expect(result.data.features[0].properties).toEqual({
            name: "test-zone",
            area: 42.5,
            tags: ["a", "b"],
        });
    });

    it("uses core validateUrl when available", async () => {
        const coreValidate = vi.fn().mockReturnValue("https://example.com/data.fgb");
        (globalThis as any).GeoLeaf = { Utils: { validateUrl: coreValidate } };

        mockFetchOk();
        mockDeserialize.mockReturnValue(asyncIterator([makeFeature(1)]));

        await loadFgb("https://example.com/data.fgb");

        expect(coreValidate).toHaveBeenCalledWith("https://example.com/data.fgb");
    });
});
