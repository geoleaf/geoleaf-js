/*!
 * Tests — public-api.ts
 * Public API: load, loadBbox, loadAsLayer, loadBboxAsLayer.
 *
 * Rendering routes through the core MapLibre adapter (`GeoLeaf.Core.getMap()`):
 * `addGeoJSONLayer` to create the layer, `updateLayerData` for auto-refresh.
 * (`GeoLeaf.GeoJSON.addData` is a no-op in MapLibre mode — not used.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { load, loadBbox, loadAsLayer, loadBboxAsLayer } from "../public-api.js";
import type { FgbBbox } from "../types.js";

// ─── Mock underlying modules ──────────────────────────────────────────────────

const mockLoadFgb = vi.fn();
const mockLoadFgbBbox = vi.fn();
const mockSetupAutoRefresh = vi.fn();

vi.mock("../fgb-loader.js", () => ({
    loadFgb: (...args: unknown[]) => mockLoadFgb(...args),
}));

vi.mock("../fgb-bbox-filter.js", () => ({
    loadFgbBbox: (...args: unknown[]) => mockLoadFgbBbox(...args),
    setupAutoRefresh: (...args: unknown[]) => mockSetupAutoRefresh(...args),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_BBOX: FgbBbox = { minX: -1, minY: -1, maxX: 1, maxY: 1 };

function makeFgbResult(count = 3) {
    return {
        data: {
            type: "FeatureCollection",
            features: Array.from({ length: count }, (_, i) => ({
                type: "Feature",
                geometry: { type: "Point", coordinates: [i, i] },
                properties: { id: i },
            })),
        },
        featureCount: count,
    };
}

/** Installs a stub GeoLeaf with a map adapter and returns the adapter spies. */
function installAdapter(nativeMap: unknown = null) {
    const addGeoJSONLayer = vi.fn();
    const updateLayerData = vi.fn();
    const adapter = {
        addGeoJSONLayer,
        updateLayerData,
        getNativeMap: () => nativeMap,
    };
    (globalThis as any).GeoLeaf = { Core: { getMap: () => adapter } };
    return { adapter, addGeoJSONLayer, updateLayerData };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("public-api", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (globalThis as any).GeoLeaf = undefined;
    });

    describe("load", () => {
        it("delegates to loadFgb and returns result", async () => {
            const expected = makeFgbResult();
            mockLoadFgb.mockResolvedValue(expected);

            const result = await load("https://example.com/data.fgb");

            expect(mockLoadFgb).toHaveBeenCalledWith("https://example.com/data.fgb", undefined);
            expect(result).toBe(expected);
        });

        it("forwards options to loadFgb", async () => {
            mockLoadFgb.mockResolvedValue(makeFgbResult());

            const opts = { maxFeatures: 500 };
            await load("https://example.com/data.fgb", opts);

            expect(mockLoadFgb).toHaveBeenCalledWith("https://example.com/data.fgb", opts);
        });
    });

    describe("loadBbox", () => {
        it("delegates to loadFgbBbox with bbox", async () => {
            const expected = makeFgbResult(2);
            mockLoadFgbBbox.mockResolvedValue(expected);

            const result = await loadBbox("https://example.com/data.fgb", VALID_BBOX);

            expect(mockLoadFgbBbox).toHaveBeenCalledWith(
                "https://example.com/data.fgb",
                VALID_BBOX,
                undefined
            );
            expect(result).toBe(expected);
        });
    });

    describe("loadAsLayer", () => {
        it("renders via adapter.addGeoJSONLayer with the explicit layer id", async () => {
            const fgbResult = makeFgbResult();
            mockLoadFgb.mockResolvedValue(fgbResult);
            const { addGeoJSONLayer } = installAdapter();

            const layerId = await loadAsLayer("https://example.com/data.fgb", {
                layerId: "my-layer",
                layerName: "Test FGB",
                visible: true,
                cluster: true,
                geometry: "polygon",
                zIndex: 7,
            });

            expect(layerId).toBe("my-layer");
            expect(addGeoJSONLayer).toHaveBeenCalledWith(
                "my-layer",
                fgbResult.data,
                expect.objectContaining({
                    layerName: "Test FGB",
                    visible: true,
                    cluster: true,
                    geometry: "polygon",
                    zIndex: 7,
                })
            );
        });

        it("auto-generates a layer id when none is supplied", async () => {
            mockLoadFgb.mockResolvedValue(makeFgbResult());
            const { addGeoJSONLayer } = installAdapter();

            const layerId = await loadAsLayer("https://example.com/data.fgb");

            expect(layerId).toMatch(/^flatgeobuf-\d+$/);
            expect(addGeoJSONLayer).toHaveBeenCalledWith(
                layerId,
                expect.anything(),
                expect.anything()
            );
        });

        it("throws when the map adapter is unavailable", async () => {
            mockLoadFgb.mockResolvedValue(makeFgbResult());
            (globalThis as any).GeoLeaf = {};

            await expect(loadAsLayer("https://example.com/data.fgb")).rejects.toThrow(
                "Map adapter unavailable"
            );
        });
    });

    describe("loadBboxAsLayer", () => {
        it("renders bbox-filtered data via adapter.addGeoJSONLayer", async () => {
            const fgbResult = makeFgbResult(1);
            mockLoadFgbBbox.mockResolvedValue(fgbResult);
            const { addGeoJSONLayer } = installAdapter();

            const layerId = await loadBboxAsLayer("https://example.com/data.fgb", VALID_BBOX, {
                layerId: "bbox-layer",
            });

            expect(layerId).toBe("bbox-layer");
            expect(addGeoJSONLayer).toHaveBeenCalledWith(
                "bbox-layer",
                fgbResult.data,
                expect.any(Object)
            );
        });

        it("sets up auto-refresh when option is enabled and map is available", async () => {
            mockLoadFgbBbox.mockResolvedValue(makeFgbResult(1));
            const nativeMap = { on: vi.fn(), off: vi.fn(), getBounds: vi.fn() };
            installAdapter(nativeMap);

            await loadBboxAsLayer("https://example.com/data.fgb", VALID_BBOX, {
                layerId: "auto-layer",
                autoRefresh: true,
            });

            expect(mockSetupAutoRefresh).toHaveBeenCalledWith(
                nativeMap,
                "https://example.com/data.fgb",
                expect.objectContaining({ autoRefresh: true }),
                expect.any(Function)
            );
        });

        it("auto-refresh callback replaces data in place via adapter.updateLayerData", async () => {
            const initial = makeFgbResult(1);
            const refreshed = makeFgbResult(5);
            mockLoadFgbBbox.mockResolvedValueOnce(initial).mockResolvedValueOnce(refreshed);
            const nativeMap = { on: vi.fn(), off: vi.fn(), getBounds: vi.fn() };
            const { updateLayerData } = installAdapter(nativeMap);

            await loadBboxAsLayer("https://example.com/data.fgb", VALID_BBOX, {
                layerId: "auto-layer",
                autoRefresh: true,
            });

            // Invoke the reloadFn captured by the mocked setupAutoRefresh.
            const reloadFn = mockSetupAutoRefresh.mock.calls[0][3] as (b: FgbBbox) => void;
            reloadFn(VALID_BBOX);

            await vi.waitFor(() =>
                expect(updateLayerData).toHaveBeenCalledWith("auto-layer", refreshed.data)
            );
        });

        // The three cases below drive the REAL refresh callback: the mocked
        // `setupAutoRefresh` only hands it over and returns the cleanup it was asked for.
        it("draws only the answer to the latest refresh when two answer out of order", async () => {
            const first = makeFgbResult(2);
            const second = makeFgbResult(7);
            let answerFirst: (v: unknown) => void = () => {};
            let answerSecond: (v: unknown) => void = () => {};
            mockLoadFgbBbox
                .mockResolvedValueOnce(makeFgbResult(1))
                .mockReturnValueOnce(new Promise((r) => (answerFirst = r)))
                .mockReturnValueOnce(new Promise((r) => (answerSecond = r)));
            const nativeMap = { on: vi.fn(), off: vi.fn(), getBounds: vi.fn() };
            const { updateLayerData } = installAdapter(nativeMap);

            await loadBboxAsLayer("https://example.com/data.fgb", VALID_BBOX, {
                layerId: "race-layer",
                autoRefresh: true,
            });
            const reloadFn = mockSetupAutoRefresh.mock.calls[0][3] as (b: FgbBbox) => void;
            reloadFn(VALID_BBOX);
            reloadFn(VALID_BBOX);

            // The newer request answers first, the older one last.
            answerSecond(second);
            await vi.waitFor(() => expect(updateLayerData).toHaveBeenCalledTimes(1));
            answerFirst(first);
            await new Promise((r) => setTimeout(r, 0));

            expect(updateLayerData).toHaveBeenCalledTimes(1);
            expect(updateLayerData).toHaveBeenCalledWith("race-layer", second.data);
        });

        it("removes its listener, and fetches nothing, once the layer has left the map", async () => {
            mockLoadFgbBbox.mockResolvedValue(makeFgbResult(1));
            const stop = vi.fn();
            mockSetupAutoRefresh.mockReturnValue(stop);
            const nativeMap = { on: vi.fn(), off: vi.fn(), getBounds: vi.fn() };
            const { adapter, updateLayerData } = installAdapter(nativeMap);
            let present = true;
            (adapter as { hasLayer?: (id: string) => boolean }).hasLayer = () => present;

            await loadBboxAsLayer("https://example.com/data.fgb", VALID_BBOX, {
                layerId: "gone-layer",
                autoRefresh: true,
            });
            const reloadFn = mockSetupAutoRefresh.mock.calls[0][3] as (b: FgbBbox) => void;
            const fetchesBefore = mockLoadFgbBbox.mock.calls.length;

            present = false;
            reloadFn(VALID_BBOX);

            expect(stop).toHaveBeenCalledTimes(1);
            expect(mockLoadFgbBbox.mock.calls.length).toBe(fetchesBefore);
            expect(updateLayerData).not.toHaveBeenCalled();
        });

        it("does not draw an answer that arrives after the layer has left the map", async () => {
            let answer: (v: unknown) => void = () => {};
            mockLoadFgbBbox
                .mockResolvedValueOnce(makeFgbResult(1))
                .mockReturnValueOnce(new Promise((r) => (answer = r)));
            const stop = vi.fn();
            mockSetupAutoRefresh.mockReturnValue(stop);
            const nativeMap = { on: vi.fn(), off: vi.fn(), getBounds: vi.fn() };
            const { adapter, updateLayerData } = installAdapter(nativeMap);
            let present = true;
            (adapter as { hasLayer?: (id: string) => boolean }).hasLayer = () => present;

            await loadBboxAsLayer("https://example.com/data.fgb", VALID_BBOX, {
                layerId: "late-layer",
                autoRefresh: true,
            });
            const reloadFn = mockSetupAutoRefresh.mock.calls[0][3] as (b: FgbBbox) => void;
            reloadFn(VALID_BBOX);
            present = false;
            answer(makeFgbResult(4));
            await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));

            expect(updateLayerData).not.toHaveBeenCalled();
        });

        it("does not set up auto-refresh when option is false", async () => {
            mockLoadFgbBbox.mockResolvedValue(makeFgbResult(1));
            installAdapter();

            await loadBboxAsLayer("https://example.com/data.fgb", VALID_BBOX, {
                layerId: "no-auto",
                autoRefresh: false,
            });

            expect(mockSetupAutoRefresh).not.toHaveBeenCalled();
        });
    });
});
