/**
 * @tests built-in/basemaps/registry — new basemap type routing
 *
 * Tests for setBaseLayer() routing with the four new basemap types:
 * type: "image", "hillshade", "wms", "wmts"
 *
 * Kept separate from registry.test.js to allow independent mocking of
 * image-source, hillshade, and wmts-resolver modules.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

const Log = vi.hoisted(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}));
vi.mock("../../src/utils/log/index.js", () => ({ Log }));

const mockApplyImageBasemap = vi.hoisted(() => vi.fn());
vi.mock("../../src/kernel/basemaps/image-source.js", () => ({
    applyImageBasemap: mockApplyImageBasemap,
}));

const mockApplyHillshadeBasemap = vi.hoisted(() => vi.fn());
vi.mock("../../src/kernel/basemaps/hillshade.js", () => ({
    applyHillshadeBasemap: mockApplyHillshadeBasemap,
}));

const mockBuildWmsUrl = vi.hoisted(() =>
    vi.fn(() => "https://example.com/wms?SERVICE=WMS&BBOX={bbox-epsg-3857}")
);
const mockResolveWmtsTilesUrl = vi.hoisted(() =>
    vi.fn(() => Promise.resolve("https://example.com/wmts/{z}/{x}/{y}.png"))
);
vi.mock("../../src/kernel/basemaps/wmts-resolver.js", () => ({
    buildWmsUrl: mockBuildWmsUrl,
    resolveWmtsTilesUrl: mockResolveWmtsTilesUrl,
}));

vi.mock("../../src/kernel/basemaps/providers.js", () => ({
    DEFAULT_BASELAYERS: {},
    normalizeTilesArray: vi.fn((def) => {
        if (Array.isArray(def.tiles)) return def.tiles;
        if (def.url) return [def.url];
        return [];
    }),
    applyLibertyFilters: vi.fn(),
}));

vi.mock("../../src/kernel/basemaps/terrain.js", () => ({
    activateTerrain: vi.fn(),
    deactivateTerrain: vi.fn(),
    isTerrainActive: vi.fn(() => false),
    resolveTerrainConfig: vi.fn(() => null),
}));

vi.mock("../../src/kernel/events/event-bus.js", () => ({
    dispatchGeoLeafEvent: vi.fn(),
}));

// ─── Module under test ────────────────────────────────────────────────────────

import {
    setMap,
    registerBaseLayer,
    setBaseLayer,
    getActiveKey,
    _baseLayers,
    _resetStateForTesting,
} from "../../src/kernel/basemaps/registry.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASEMAP_SOURCE_ID = "__geoleaf_basemap__";
const BASEMAP_LAYER_ID = "__geoleaf_basemap_layer__";

globalThis.GeoLeaf = globalThis.GeoLeaf || {};
globalThis.GeoLeaf.Core = null;

function makeMockMap() {
    return {
        addSource: vi.fn(),
        addLayer: vi.fn(),
        removeLayer: vi.fn(),
        removeSource: vi.fn(),
        getLayer: vi.fn((id) => (id === BASEMAP_LAYER_ID ? {} : null)),
        getSource: vi.fn((id) => (id === BASEMAP_SOURCE_ID ? {} : null)),
        getStyle: vi.fn(() => ({ layers: [] })),
        setStyle: vi.fn(),
        once: vi.fn(),
        loaded: vi.fn(() => true),
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("basemaps/registry — new basemap types", () => {
    let mockMap;

    beforeEach(() => {
        vi.clearAllMocks();
        Object.keys(_baseLayers).forEach((k) => delete _baseLayers[k]);
        setMap(null);
        _resetStateForTesting();
        mockMap = makeMockMap();
        globalThis.GeoLeaf.Core = null;
    });

    // ─── registerBaseLayer — extended types ──────────────────────────────────

    it("registerBaseLayer accepts type:image without url/tiles/style", () => {
        const before = Object.keys(_baseLayers).length;
        registerBaseLayer("img", {
            id: "img",
            label: "Image",
            type: "image",
            imageSource: { url: "https://img.example.com/img.png" },
        });
        expect(Object.keys(_baseLayers)).toHaveLength(before + 1);
        expect(Log.warn).not.toHaveBeenCalled();
    });

    it("registerBaseLayer accepts type:hillshade without url/tiles/style", () => {
        const before = Object.keys(_baseLayers).length;
        registerBaseLayer("hs", {
            id: "hs",
            label: "Hillshade",
            type: "hillshade",
            hillshade: { demUrl: "https://dem.example.com/{z}/{x}/{y}.png" },
        });
        expect(Object.keys(_baseLayers)).toHaveLength(before + 1);
        expect(Log.warn).not.toHaveBeenCalled();
    });

    it("registerBaseLayer accepts type:wms without url/tiles/style", () => {
        const before = Object.keys(_baseLayers).length;
        registerBaseLayer("wms", {
            id: "wms",
            label: "WMS",
            type: "wms",
            wms: { url: "https://wms.example.com/wms", layers: "LAYER" },
        });
        expect(Object.keys(_baseLayers)).toHaveLength(before + 1);
        expect(Log.warn).not.toHaveBeenCalled();
    });

    it("registerBaseLayer accepts type:wmts without url/tiles/style", () => {
        const before = Object.keys(_baseLayers).length;
        registerBaseLayer("wmts", {
            id: "wmts",
            label: "WMTS",
            type: "wmts",
            wmts: { getCapabilitiesUrl: "https://wmts.example.com/caps.xml" },
        });
        expect(Object.keys(_baseLayers)).toHaveLength(before + 1);
        expect(Log.warn).not.toHaveBeenCalled();
    });

    // ─── setBaseLayer — type: "image" ─────────────────────────────────────────

    it("setBaseLayer calls applyImageBasemap for type:image", () => {
        setMap(mockMap);
        registerBaseLayer("img", {
            id: "img",
            label: "Image",
            type: "image",
            imageSource: { url: "https://img.example.com/img.png" },
        });
        setBaseLayer("img");
        expect(mockApplyImageBasemap).toHaveBeenCalledWith(
            mockMap,
            expect.objectContaining({ type: "image" })
        );
        expect(getActiveKey()).toBe("img");
    });

    it("setBaseLayer does not call setStyle for type:image (sync raster path)", () => {
        setMap(mockMap);
        registerBaseLayer("img", {
            id: "img",
            label: "Image",
            type: "image",
            imageSource: { url: "https://img.example.com/img.png" },
        });
        setBaseLayer("img");
        expect(mockMap.setStyle).not.toHaveBeenCalled();
    });

    it("setBaseLayer logs error when applyImageBasemap throws", () => {
        setMap(mockMap);
        mockApplyImageBasemap.mockImplementationOnce(() => {
            throw new Error("img apply failed");
        });
        registerBaseLayer("img", {
            id: "img",
            label: "Image",
            type: "image",
            imageSource: { url: "https://img.example.com/img.png" },
        });
        setBaseLayer("img");
        expect(Log.error).toHaveBeenCalledWith(
            "[GeoLeaf.Baselayers] Cannot apply basemap:",
            expect.any(Error)
        );
    });

    // ─── setBaseLayer — type: "hillshade" ─────────────────────────────────────

    it("setBaseLayer calls applyHillshadeBasemap for type:hillshade", () => {
        setMap(mockMap);
        registerBaseLayer("hs", {
            id: "hs",
            label: "Hillshade",
            type: "hillshade",
            hillshade: { demUrl: "https://dem.example.com/{z}/{x}/{y}.png" },
        });
        setBaseLayer("hs");
        expect(mockApplyHillshadeBasemap).toHaveBeenCalledWith(
            mockMap,
            expect.objectContaining({ type: "hillshade" })
        );
        expect(getActiveKey()).toBe("hs");
    });

    it("setBaseLayer does not call setStyle for type:hillshade (sync raster path)", () => {
        setMap(mockMap);
        registerBaseLayer("hs", {
            id: "hs",
            label: "HS",
            type: "hillshade",
            hillshade: { demUrl: "https://dem.example.com/{z}/{x}/{y}.png" },
        });
        setBaseLayer("hs");
        expect(mockMap.setStyle).not.toHaveBeenCalled();
    });

    it("setBaseLayer logs error when applyHillshadeBasemap throws", () => {
        setMap(mockMap);
        mockApplyHillshadeBasemap.mockImplementationOnce(() => {
            throw new Error("hillshade failed");
        });
        registerBaseLayer("hs", {
            id: "hs",
            label: "HS",
            type: "hillshade",
            hillshade: { demUrl: "https://dem.example.com/{z}/{x}/{y}.png" },
        });
        setBaseLayer("hs");
        expect(Log.error).toHaveBeenCalledWith(
            "[GeoLeaf.Baselayers] Cannot apply basemap:",
            expect.any(Error)
        );
    });

    // ─── setBaseLayer — type: "wms" ───────────────────────────────────────────

    it("setBaseLayer calls addSource for type:wms using buildWmsUrl result", () => {
        setMap(mockMap);
        registerBaseLayer("wms", {
            id: "wms",
            label: "WMS",
            type: "wms",
            wms: { url: "https://wms.example.com/wms", layers: "LAYER" },
        });
        setBaseLayer("wms");
        expect(mockBuildWmsUrl).toHaveBeenCalled();
        expect(mockMap.addSource).toHaveBeenCalledWith(
            BASEMAP_SOURCE_ID,
            expect.objectContaining({
                type: "raster",
                tiles: expect.arrayContaining([expect.any(String)]),
            })
        );
        expect(mockMap.addLayer).toHaveBeenCalled();
        expect(getActiveKey()).toBe("wms");
    });

    it("setBaseLayer type:wms uses wms.tileSize for the source spec", () => {
        setMap(mockMap);
        registerBaseLayer("wms", {
            id: "wms",
            label: "WMS",
            type: "wms",
            wms: { url: "https://wms.example.com/wms", layers: "LAYER", tileSize: 512 },
        });
        setBaseLayer("wms");
        const sourceCall = mockMap.addSource.mock.calls[0];
        expect(sourceCall[1].tileSize).toBe(512);
    });

    it("setBaseLayer type:wms logs error when buildWmsUrl returns null", () => {
        setMap(mockMap);
        mockBuildWmsUrl.mockReturnValueOnce(null);
        registerBaseLayer("wms", {
            id: "wms",
            label: "WMS",
            type: "wms",
            wms: { url: "https://wms.example.com/wms", layers: "LAYER" },
        });
        setBaseLayer("wms");
        expect(Log.error).toHaveBeenCalled();
        expect(mockMap.addSource).not.toHaveBeenCalled();
    });

    it("setBaseLayer type:wms includes minZoom and maxZoom in source spec", () => {
        setMap(mockMap);
        registerBaseLayer("wms", {
            id: "wms",
            label: "WMS",
            type: "wms",
            minZoom: 3,
            maxZoom: 18,
            wms: { url: "https://wms.example.com/wms", layers: "LAYER" },
        });
        setBaseLayer("wms");
        const sourceCall = mockMap.addSource.mock.calls[0];
        expect(sourceCall[1].minzoom).toBe(3);
        expect(sourceCall[1].maxzoom).toBe(18);
    });

    // ─── setBaseLayer — type: "wmts" (async) ─────────────────────────────────

    it("setBaseLayer type:wmts sets activeKey eagerly and resolves tiles async", async () => {
        setMap(mockMap);
        registerBaseLayer("wmts", {
            id: "wmts",
            label: "WMTS",
            type: "wmts",
            wmts: { getCapabilitiesUrl: "https://wmts.example.com/caps.xml" },
        });
        setBaseLayer("wmts");
        // Key is set eagerly before async resolution
        expect(getActiveKey()).toBe("wmts");
        // Wait for resolution
        await Promise.resolve();
        expect(mockResolveWmtsTilesUrl).toHaveBeenCalled();
        expect(mockMap.addSource).toHaveBeenCalledWith(
            BASEMAP_SOURCE_ID,
            expect.objectContaining({ type: "raster" })
        );
        expect(mockMap.addLayer).toHaveBeenCalled();
    });

    it("setBaseLayer type:wmts logs error when resolution returns null", async () => {
        setMap(mockMap);
        mockResolveWmtsTilesUrl.mockResolvedValueOnce(null);
        registerBaseLayer("wmts", {
            id: "wmts",
            label: "WMTS",
            type: "wmts",
            wmts: { getCapabilitiesUrl: "https://wmts.example.com/caps.xml" },
        });
        setBaseLayer("wmts");
        await Promise.resolve();
        expect(Log.error).toHaveBeenCalledWith(
            "[GeoLeaf.Baselayers] WMTS resolution failed for:",
            "wmts"
        );
        expect(mockMap.addSource).not.toHaveBeenCalled();
    });

    it("setBaseLayer type:wmts does not apply stale result after rapid switch", async () => {
        setMap(mockMap);
        let resolveFn;
        mockResolveWmtsTilesUrl.mockImplementationOnce(
            () =>
                new Promise((r) => {
                    resolveFn = r;
                })
        );
        mockResolveWmtsTilesUrl.mockResolvedValueOnce("https://example.com/wmts/{z}/{x}/{y}.png");

        registerBaseLayer("wmts", {
            id: "wmts",
            label: "WMTS",
            type: "wmts",
            wmts: { getCapabilitiesUrl: "https://wmts.example.com/caps.xml" },
        });
        registerBaseLayer("raster", {
            id: "raster",
            label: "Raster",
            url: "https://tile.example.com/{z}/{x}/{y}.png",
        });

        // Start WMTS (stale), then immediately switch to raster
        setBaseLayer("wmts");
        setBaseLayer("raster");

        // Resolve the stale WMTS request
        resolveFn("https://example.com/wmts/{z}/{x}/{y}.png");
        await Promise.resolve();

        // ⚠️ Backlog B.12 — this used to assert
        //     sourceTypes.filter(t => t === "raster").length >= 1
        // which discriminated NOTHING: the WMTS path also adds a source of type
        // "raster", so the count was ≥ 1 whether or not the stale result was applied.
        // The test passed while the bug it was written for was live.
        //
        // What actually has to hold: the sync raster switch supersedes the pending
        // WMTS resolution, so the stale tiles URL must never reach the map and the
        // active key must stay on the raster basemap.
        const addedTileUrls = mockMap.addSource.mock.calls.flatMap((c) => c[1]?.tiles ?? []);
        expect(addedTileUrls).toContain("https://tile.example.com/{z}/{x}/{y}.png");
        expect(addedTileUrls).not.toContain("https://example.com/wmts/{z}/{x}/{y}.png");
        expect(getActiveKey()).toBe("raster");

        // The fix has TWO halves and the assertions above only cover one: without the
        // generation bump the stale result applies (covered), but dropping the abort
        // still passed. The in-flight GetCapabilities must also be cancelled, otherwise
        // the request runs to completion for a basemap nobody is waiting for.
        const signal = mockResolveWmtsTilesUrl.mock.calls[0]?.[1];
        expect(signal).toBeDefined();
        expect(signal.aborted).toBe(true);
    });
});
