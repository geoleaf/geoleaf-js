/*!
 * GeoLeaf COG Plugin — Tests: public-api
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── vi.hoisted: declare mock fns before vi.mock hoisting ─────────────────────

const {
    mockGetCogInfo,
    mockSelectOverview,
    mockLoadViewportRasters,
    mockRastersToCanvas,
    mockCanvasToDataUrl,
    mockInjectImageSource,
    mockRemoveImageSource,
} = vi.hoisted(() => ({
    mockGetCogInfo: vi.fn(),
    mockSelectOverview: vi.fn(() => 0),
    mockLoadViewportRasters: vi.fn(),
    mockRastersToCanvas: vi.fn(),
    mockCanvasToDataUrl: vi.fn(),
    mockInjectImageSource: vi.fn(),
    mockRemoveImageSource: vi.fn(),
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../cog-loader.js", () => ({
    getCogInfo: mockGetCogInfo,
    selectOverview: mockSelectOverview,
    loadViewportRasters: mockLoadViewportRasters,
}));

vi.mock("../cog-renderer.js", () => ({
    rastersToCanvas: mockRastersToCanvas,
    canvasToDataUrl: mockCanvasToDataUrl,
    injectImageSource: mockInjectImageSource,
    removeImageSource: mockRemoveImageSource,
}));

// Import after mocking
import { addLayer, getInfo, removeLayer } from "../public-api.js";

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_INFO = {
    url: "https://example.com/test.tif",
    bounds: [-10, -5, 10, 5] as [number, number, number, number],
    width: 512,
    height: 256,
    bandCount: 3,
    nodata: null,
    overviewCount: 2,
    epsg: 4326,
};

const MOCK_RASTER_DATA = {
    rasters: [new Uint8Array(512 * 256).fill(100)],
    width: 512,
    height: 256,
    bounds: [-10, -5, 10, 5] as [number, number, number, number],
};

const MOCK_CANVAS = {} as HTMLCanvasElement;
const MOCK_DATA_URL = "data:image/png;base64,MOCK";

function makeMockMap() {
    return {
        addSource: vi.fn(),
        addLayer: vi.fn(),
        removeLayer: vi.fn(),
        removeSource: vi.fn(),
        getLayer: vi.fn(() => ({})),
        getSource: vi.fn(() => ({})),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mockGetCogInfo.mockResolvedValue(MOCK_INFO);
    mockSelectOverview.mockReturnValue(1);
    mockLoadViewportRasters.mockResolvedValue(MOCK_RASTER_DATA);
    mockRastersToCanvas.mockReturnValue(MOCK_CANVAS);
    mockCanvasToDataUrl.mockResolvedValue(MOCK_DATA_URL);
});

// ─── addLayer ─────────────────────────────────────────────────────────────────

describe("addLayer", () => {
    it("calls the full pipeline: getCogInfo → selectOverview → loadViewportRasters → rastersToCanvas → canvasToDataUrl → injectImageSource", async () => {
        const map = makeMockMap();
        await addLayer("https://example.com/test.tif", map);

        expect(mockGetCogInfo).toHaveBeenCalledWith(
            "https://example.com/test.tif",
            expect.objectContaining({})
        );
        expect(mockSelectOverview).toHaveBeenCalledWith(MOCK_INFO, expect.any(Number));
        expect(mockLoadViewportRasters).toHaveBeenCalledWith(
            "https://example.com/test.tif",
            expect.any(Object),
            1
        );
        expect(mockRastersToCanvas).toHaveBeenCalledWith(MOCK_RASTER_DATA, expect.any(Object));
        expect(mockCanvasToDataUrl).toHaveBeenCalledWith(MOCK_CANVAS);
        expect(mockInjectImageSource).toHaveBeenCalledWith(
            map,
            expect.stringContaining("cog-layer-"),
            MOCK_DATA_URL,
            MOCK_RASTER_DATA.bounds,
            expect.any(Object)
        );
    });

    it("returns a handle with id, remove, and update", async () => {
        const map = makeMockMap();
        const handle = await addLayer("https://example.com/test.tif", map);

        expect(handle.id).toMatch(/^cog-layer-/);
        expect(typeof handle.remove).toBe("function");
        expect(typeof handle.update).toBe("function");
    });

    it("uses provided id option", async () => {
        const map = makeMockMap();
        const handle = await addLayer("https://example.com/test.tif", map, { id: "my-custom-id" });
        expect(handle.id).toBe("my-custom-id");
        expect(mockInjectImageSource).toHaveBeenCalledWith(
            map,
            "my-custom-id",
            expect.any(String),
            expect.any(Array),
            expect.any(Object)
        );
    });

    it("handle.remove() calls removeImageSource", async () => {
        const map = makeMockMap();
        const handle = await addLayer("https://example.com/test.tif", map);
        handle.remove();
        expect(mockRemoveImageSource).toHaveBeenCalledWith(map, handle.id);
    });

    it("handle.update() re-runs the pipeline with merged options", async () => {
        const map = makeMockMap();
        const handle = await addLayer("https://example.com/test.tif", map, { opacity: 0.5 });
        vi.clearAllMocks();
        mockGetCogInfo.mockResolvedValue(MOCK_INFO);
        mockSelectOverview.mockReturnValue(0);
        mockLoadViewportRasters.mockResolvedValue(MOCK_RASTER_DATA);
        mockRastersToCanvas.mockReturnValue(MOCK_CANVAS);
        mockCanvasToDataUrl.mockResolvedValue(MOCK_DATA_URL);

        await handle.update({ opacity: 0.9 });

        expect(mockRemoveImageSource).toHaveBeenCalled();
        expect(mockLoadViewportRasters).toHaveBeenCalled();
        expect(mockInjectImageSource).toHaveBeenCalledWith(
            map,
            handle.id,
            MOCK_DATA_URL,
            MOCK_RASTER_DATA.bounds,
            expect.objectContaining({ opacity: 0.9 })
        );
    });

    it("respects explicit overview index option", async () => {
        const map = makeMockMap();
        await addLayer("https://example.com/test.tif", map, { overview: 2 });
        expect(mockSelectOverview).not.toHaveBeenCalled();
        expect(mockLoadViewportRasters).toHaveBeenCalledWith(
            "https://example.com/test.tif",
            expect.any(Object),
            2
        );
    });

    it("passes AbortSignal through the pipeline", async () => {
        const controller = new AbortController();
        const map = makeMockMap();
        await addLayer("https://example.com/test.tif", map, { signal: controller.signal });
        expect(mockGetCogInfo).toHaveBeenCalledWith(
            "https://example.com/test.tif",
            expect.objectContaining({ signal: controller.signal })
        );
    });

    it("propagates rejection from getCogInfo", async () => {
        mockGetCogInfo.mockRejectedValue(new TypeError("Invalid URL"));
        const map = makeMockMap();
        await expect(addLayer("bad-url", map)).rejects.toThrow(TypeError);
    });

    it("treats overview:'auto' as automatic overview selection", async () => {
        const map = makeMockMap();
        await addLayer("https://example.com/test.tif", map, { overview: "auto" });
        expect(mockSelectOverview).toHaveBeenCalledWith(MOCK_INFO, expect.any(Number));
    });

    it("handle.update() reuses cached CogInfo (does not re-fetch headers)", async () => {
        const map = makeMockMap();
        const handle = await addLayer("https://example.com/test.tif", map);
        expect(mockGetCogInfo).toHaveBeenCalledTimes(1);
        await handle.update({ opacity: 0.7 });
        // update() must reuse the CogInfo captured at addLayer() — no second header fetch
        expect(mockGetCogInfo).toHaveBeenCalledTimes(1);
    });
});

// ─── removeLayer ──────────────────────────────────────────────────────────────

describe("removeLayer", () => {
    it("delegates to removeImageSource", () => {
        const map = makeMockMap();
        removeLayer(map, "my-layer");
        expect(mockRemoveImageSource).toHaveBeenCalledWith(map, "my-layer");
    });
});

// ─── getInfo ──────────────────────────────────────────────────────────────────

describe("getInfo", () => {
    it("returns CogInfo from getCogInfo", async () => {
        const info = await getInfo("https://example.com/test.tif");
        expect(info).toEqual(MOCK_INFO);
        expect(mockGetCogInfo).toHaveBeenCalledWith("https://example.com/test.tif", {});
    });

    it("passes options to getCogInfo", async () => {
        const signal = new AbortController().signal;
        await getInfo("https://example.com/test.tif", { signal, maxBytes: 1000 });
        expect(mockGetCogInfo).toHaveBeenCalledWith("https://example.com/test.tif", {
            signal,
            maxBytes: 1000,
        });
    });
});
