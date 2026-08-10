/*!
 * GeoLeaf COG Plugin — Tests: cog-loader
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock geotiff module before importing cog-loader
const mockReadRasters = vi.fn();
const mockGetBoundingBox = vi.fn(() => [-180, -90, 180, 90]);
const mockGetWidth = vi.fn(() => 512);
const mockGetHeight = vi.fn(() => 256);
const mockGetSamplesPerPixel = vi.fn(() => 3);
const mockGetGDALNoData = vi.fn(() => null);
const mockGetImage = vi.fn();
const mockGetImageCount = vi.fn(() => Promise.resolve(4)); // 1 full + 3 overviews

const mockTiff = {
    getImage: mockGetImage,
    getImageCount: mockGetImageCount,
};

vi.mock("geotiff", () => ({
    fromUrl: vi.fn(async (_url: string) => mockTiff),
}));

// Import after mocking
import { getCogInfo, loadViewportRasters, selectOverview } from "../cog-loader.js";
import { fromUrl } from "geotiff";

// ─── Setup ────────────────────────────────────────────────────────────────────

const mockImage = {
    getBoundingBox: mockGetBoundingBox,
    getWidth: mockGetWidth,
    getHeight: mockGetHeight,
    getSamplesPerPixel: mockGetSamplesPerPixel,
    getGDALNoData: mockGetGDALNoData,
    readRasters: mockReadRasters,
    fileDirectory: {},
};

beforeEach(() => {
    vi.clearAllMocks();
    mockGetImage.mockResolvedValue(mockImage);
    mockGetImageCount.mockResolvedValue(4);
    mockGetBoundingBox.mockReturnValue([-180, -90, 180, 90]);
    mockGetWidth.mockReturnValue(512);
    mockGetHeight.mockReturnValue(256);
    mockGetSamplesPerPixel.mockReturnValue(3);
    mockGetGDALNoData.mockReturnValue(null);
    mockReadRasters.mockResolvedValue([
        new Uint8Array(512 * 256).fill(128),
        new Uint8Array(512 * 256).fill(64),
        new Uint8Array(512 * 256).fill(200),
    ]);
});

// ─── getCogInfo ───────────────────────────────────────────────────────────────

describe("getCogInfo", () => {
    it("returns correct metadata from COG headers", async () => {
        const info = await getCogInfo("https://example.com/test.tif");
        expect(info.url).toBe("https://example.com/test.tif");
        expect(info.bounds).toEqual([-180, -90, 180, 90]);
        expect(info.width).toBe(512);
        expect(info.height).toBe(256);
        expect(info.bandCount).toBe(3);
        expect(info.nodata).toBeNull();
        expect(info.overviewCount).toBe(3); // imageCount - 1
        expect(fromUrl).toHaveBeenCalledWith("https://example.com/test.tif", {
            allowFullFile: false,
        });
    });

    it("reports nodata value when set", async () => {
        mockGetGDALNoData.mockReturnValue(-9999);
        const info = await getCogInfo("https://example.com/test.tif");
        expect(info.nodata).toBe(-9999);
    });

    it("returns overviewCount = 0 when only full resolution", async () => {
        mockGetImageCount.mockResolvedValue(1);
        const info = await getCogInfo("https://example.com/test.tif");
        expect(info.overviewCount).toBe(0);
    });

    it("extracts EPSG from GeoKeyDirectory", async () => {
        // GeoKeyDirectory with key 3072 = 32632 (UTM32N)
        // Header: [1,1,0,1] then key: [3072, 0, 1, 32632]
        mockGetImage.mockResolvedValue({
            ...mockImage,
            fileDirectory: {
                GeoKeyDirectory: [1, 1, 0, 1, 3072, 0, 1, 32632],
            },
        });
        const info = await getCogInfo("https://example.com/test.tif");
        expect(info.epsg).toBe(32632);
    });

    it("returns epsg=null when GeoKeyDirectory is absent", async () => {
        const info = await getCogInfo("https://example.com/test.tif");
        expect(info.epsg).toBeNull();
    });

    // geotiff >= 3: fileDirectory is an ImageFileDirectory (no raw GeoKeyDirectory
    // property) — geo keys are read via image.getGeoKeys(). These lock the fix for
    // the production path that the legacy raw-array mock above does not represent.
    it("extracts EPSG via geotiff>=3 getGeoKeys() (GeographicTypeGeoKey)", async () => {
        mockGetImage.mockResolvedValue({
            ...mockImage,
            getGeoKeys: () => ({ GeographicTypeGeoKey: 4326 }),
            fileDirectory: {},
        });
        const info = await getCogInfo("https://example.com/test.tif");
        expect(info.epsg).toBe(4326);
    });

    it("prefers ProjectedCSTypeGeoKey over GeographicTypeGeoKey in getGeoKeys()", async () => {
        mockGetImage.mockResolvedValue({
            ...mockImage,
            getGeoKeys: () => ({ GeographicTypeGeoKey: 4326, ProjectedCSTypeGeoKey: 32631 }),
            fileDirectory: {},
        });
        const info = await getCogInfo("https://example.com/test.tif");
        expect(info.epsg).toBe(32631);
    });

    it("falls back to raw GeoKeyDirectory when getGeoKeys() has no projection", async () => {
        mockGetImage.mockResolvedValue({
            ...mockImage,
            getGeoKeys: () => ({}),
            fileDirectory: { GeoKeyDirectory: [1, 1, 0, 1, 2048, 0, 1, 4326] },
        });
        const info = await getCogInfo("https://example.com/test.tif");
        expect(info.epsg).toBe(4326);
    });

    it("returns epsg=null when getGeoKeys() throws (deferred keys)", async () => {
        mockGetImage.mockResolvedValue({
            ...mockImage,
            getGeoKeys: () => {
                throw new Error("deferred geo key");
            },
            fileDirectory: {},
        });
        const info = await getCogInfo("https://example.com/test.tif");
        expect(info.epsg).toBeNull();
    });

    it("throws TypeError for invalid URL", async () => {
        await expect(getCogInfo("not-a-url")).rejects.toThrow(TypeError);
    });

    it("throws TypeError for non-http URL", async () => {
        await expect(getCogInfo("ftp://example.com/test.tif")).rejects.toThrow(TypeError);
    });

    it("propagates AbortError when signal is aborted", async () => {
        const controller = new AbortController();
        controller.abort();
        // Mock fromUrl to simulate hanging — abort should win via race
        vi.mocked(fromUrl).mockImplementationOnce(
            () => new Promise<never>(() => {}) // never resolves
        );
        await expect(
            getCogInfo("https://example.com/test.tif", { signal: controller.signal })
        ).rejects.toThrow(/aborted/i);
    });
});

// ─── selectOverview ───────────────────────────────────────────────────────────

describe("selectOverview", () => {
    const baseInfo = {
        url: "https://example.com/test.tif",
        bounds: [-180, -90, 180, 90] as [number, number, number, number],
        width: 4096,
        height: 2048,
        bandCount: 3,
        nodata: null,
        overviewCount: 3,
        epsg: null,
    };

    it("returns 0 when no overviews available", () => {
        expect(selectOverview({ ...baseInfo, overviewCount: 0 }, 512)).toBe(0);
    });

    it("returns highest overview for small viewport", () => {
        // target 256 → overview 3 (4096 / 8 = 512 ≥ 128)
        const idx = selectOverview(baseInfo, 256);
        expect(idx).toBeGreaterThan(0);
    });

    it("returns 0 for viewport matching full resolution", () => {
        // target 4096 → no overview fits — returns 0
        const idx = selectOverview(baseInfo, 4096);
        expect(idx).toBe(0);
    });

    it("returns 0 when target far exceeds full resolution width", () => {
        expect(selectOverview(baseInfo, 100_000)).toBe(0);
    });

    it("returns intermediate overview for medium viewport", () => {
        // target 1024 → expect overview 1 or 2 depending on ratio
        const idx = selectOverview(baseInfo, 1024);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThanOrEqual(3);
    });
});

// ─── loadViewportRasters ──────────────────────────────────────────────────────

describe("loadViewportRasters", () => {
    it("returns rasters, width, height, bounds", async () => {
        const result = await loadViewportRasters("https://example.com/test.tif");
        expect(result.rasters).toHaveLength(3);
        expect(result.width).toBe(512);
        expect(result.height).toBe(256);
        expect(result.bounds).toEqual([-180, -90, 180, 90]);
    });

    it("clamps overviewIdx to imageCount - 1", async () => {
        await loadViewportRasters("https://example.com/test.tif", {}, 99);
        // Should use image index = min(99, 3) = 3
        expect(mockGetImage).toHaveBeenCalledWith(3);
    });

    it("throws RangeError when estimated bytes exceed maxBytes", async () => {
        // 512 × 256 × 3 × 4 = 1,572,864 bytes — set maxBytes below that
        await expect(
            loadViewportRasters("https://example.com/test.tif", { maxBytes: 100_000 })
        ).rejects.toThrow(RangeError);
    });

    it("returns data when maxBytes is sufficient", async () => {
        const result = await loadViewportRasters("https://example.com/test.tif", {
            maxBytes: 10 * 1024 * 1024,
        });
        expect(result.rasters).toHaveLength(3);
    });

    it("reads rasters in non-interleaved (band-separated) mode", async () => {
        await loadViewportRasters("https://example.com/test.tif");
        expect(mockReadRasters).toHaveBeenCalledWith({ interleave: false });
    });

    it("throws TypeError for invalid URL", async () => {
        await expect(loadViewportRasters("bad-url")).rejects.toThrow(TypeError);
    });
});
