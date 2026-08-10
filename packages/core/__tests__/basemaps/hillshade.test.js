/**
 * @tests built-in/basemaps/hillshade
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/utils/general/utils-base.js", () => ({
    validateUrl: (url, _protocols) => {
        if (typeof url !== "string") return null;
        return url.startsWith("http://") || url.startsWith("https://") ? url : null;
    },
}));

// ─── Module under test ────────────────────────────────────────────────────────

let buildHillshadeSourceSpec;
let applyHillshadeBasemap;

beforeAll(async () => {
    const mod = await import("../../src/kernel/basemaps/hillshade.ts");
    buildHillshadeSourceSpec = mod.buildHillshadeSourceSpec;
    applyHillshadeBasemap = mod.applyHillshadeBasemap;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEM_URL = "https://tiles.example.com/{z}/{x}/{y}.png";

const VALID_DEF = {
    hillshade: {
        demUrl: DEM_URL,
        demEncoding: "terrarium",
        demMaxZoom: 14,
        shadowColor: "#333",
        illuminationAnchor: "viewport",
        exaggeration: 0.5,
    },
};

/**
 * Creates a mock MapLibre map. `hasTerrain` controls whether a `terrain-dem`
 * source is already present (for the DEM reuse test case).
 */
function makeMockMap({ hasTerrain = false, terrainUrl = DEM_URL, layers = [] } = {}) {
    return {
        addSource: vi.fn(),
        addLayer: vi.fn(),
        getStyle: vi.fn(() => ({ layers })),
        getSource: vi.fn((id) => {
            if (id === "terrain-dem" && hasTerrain) {
                return { tiles: [terrainUrl] };
            }
            if (id === "__geoleaf_basemap__") return null;
            return null;
        }),
    };
}

// ─── buildHillshadeSourceSpec ─────────────────────────────────────────────────

describe("buildHillshadeSourceSpec", () => {
    it("builds a raster-dem source spec from the hillshade sub-config", () => {
        const result = buildHillshadeSourceSpec(VALID_DEF);
        expect(result.type).toBe("raster-dem");
        expect(result.tiles).toEqual([DEM_URL]);
        expect(result.encoding).toBe("terrarium");
        expect(result.tileSize).toBe(256);
        expect(result.maxzoom).toBe(14);
    });

    it("uses sensible defaults for missing optional fields", () => {
        const result = buildHillshadeSourceSpec({ hillshade: { demUrl: DEM_URL } });
        expect(result.encoding).toBe("terrarium");
        expect(result.maxzoom).toBe(15);
    });

    it("reads demMaxZoom from top-level definition when hillshade sub-config lacks it", () => {
        // covers L.97 TRUE branch: definition.demMaxZoom is a number
        const result = buildHillshadeSourceSpec({ demMaxZoom: 12, hillshade: { demUrl: DEM_URL } });
        expect(result.maxzoom).toBe(12);
    });

    it("reads demUrl from top-level definition when hillshade sub-config is absent", () => {
        const result = buildHillshadeSourceSpec({ demUrl: DEM_URL });
        expect(result.tiles).toEqual([DEM_URL]);
    });
});

// ─── applyHillshadeBasemap — normal path ─────────────────────────────────────

describe("applyHillshadeBasemap — new DEM source", () => {
    it("adds a raster-dem source and hillshade layer", () => {
        const map = makeMockMap();
        applyHillshadeBasemap(map, VALID_DEF);
        expect(map.addSource).toHaveBeenCalledOnce();
        const [srcId, srcSpec] = map.addSource.mock.calls[0];
        expect(srcId).toBe("__geoleaf_basemap__");
        expect(srcSpec.type).toBe("raster-dem");

        expect(map.addLayer).toHaveBeenCalledOnce();
        const [layerSpec] = map.addLayer.mock.calls[0];
        expect(layerSpec.type).toBe("hillshade");
        expect(layerSpec.source).toBe("__geoleaf_basemap__");
    });

    it("inserts hillshade layer below first existing layer", () => {
        const map = makeMockMap({ layers: [{ id: "base" }] });
        applyHillshadeBasemap(map, VALID_DEF, "__hlayer__");
        const addLayerCall = map.addLayer.mock.calls[0];
        expect(addLayerCall[1]).toBe("base");
    });

    it("sets shadowColor in paint when specified", () => {
        const map = makeMockMap();
        applyHillshadeBasemap(map, VALID_DEF);
        const [layerSpec] = map.addLayer.mock.calls[0];
        expect(layerSpec.paint["hillshade-shadow-color"]).toBe("#333");
    });

    it("clamps exaggeration within [0, 1]", () => {
        const map = makeMockMap();
        const def = { hillshade: { demUrl: DEM_URL, exaggeration: 3 } };
        applyHillshadeBasemap(map, def);
        const [layerSpec] = map.addLayer.mock.calls[0];
        expect(layerSpec.paint["hillshade-exaggeration"]).toBe(1);
    });

    it("sets illuminationDirection when specified", () => {
        const map = makeMockMap();
        const def = { hillshade: { demUrl: DEM_URL, illuminationDirection: 270 } };
        applyHillshadeBasemap(map, def);
        const [layerSpec] = map.addLayer.mock.calls[0];
        expect(layerSpec.paint["hillshade-illumination-direction"]).toBe(270);
    });

    it("sets highlightColor and accentColor when specified", () => {
        const map = makeMockMap();
        const def = {
            hillshade: { demUrl: DEM_URL, highlightColor: "#fff", accentColor: "#888" },
        };
        applyHillshadeBasemap(map, def);
        const [layerSpec] = map.addLayer.mock.calls[0];
        expect(layerSpec.paint["hillshade-highlight-color"]).toBe("#fff");
        expect(layerSpec.paint["hillshade-accent-color"]).toBe("#888");
    });

    it("returns source ID used", () => {
        const map = makeMockMap();
        const sourceId = applyHillshadeBasemap(map, VALID_DEF);
        expect(sourceId).toBe("__geoleaf_basemap__");
    });

    it("skips addSource when hillshade source already exists on the map", () => {
        // Covers L.147-149: else-if FALSE branch (source already present)
        const map = {
            addSource: vi.fn(),
            addLayer: vi.fn(),
            getStyle: vi.fn(() => ({ layers: [] })),
            getSource: vi.fn((id) => {
                if (id === "__geoleaf_basemap__") return { tiles: [DEM_URL] };
                return null;
            }),
        };
        applyHillshadeBasemap(map, VALID_DEF);
        expect(map.addSource).not.toHaveBeenCalled();
        expect(map.addLayer).toHaveBeenCalledOnce();
    });

    it("falls back to empty layers when getStyle() returns null", () => {
        // Covers L.152: getStyle()?.layers ?? [] fallback
        const map = {
            addSource: vi.fn(),
            addLayer: vi.fn(),
            getStyle: vi.fn(() => null),
            getSource: vi.fn(() => null),
        };
        expect(() => applyHillshadeBasemap(map, VALID_DEF)).not.toThrow();
        // No firstLayerId → addLayer called without beforeId
        expect(map.addLayer).toHaveBeenCalledWith(expect.any(Object));
    });

    it("applies hillshade using bare definition (no hillshade sub-config)", () => {
        // Covers L.127: definition?.hillshade is absent → config = {}
        const map = makeMockMap();
        applyHillshadeBasemap(map, { demUrl: DEM_URL });
        expect(map.addLayer).toHaveBeenCalledOnce();
    });
});

// ─── applyHillshadeBasemap — terrain-dem reuse ───────────────────────────────

describe("applyHillshadeBasemap — reuse terrain-dem source", () => {
    it("reuses terrain-dem source when it covers the same demUrl", () => {
        const map = makeMockMap({ hasTerrain: true, terrainUrl: DEM_URL });
        const sourceId = applyHillshadeBasemap(map, VALID_DEF);

        // Should NOT add a new source — terrain-dem is reused
        expect(map.addSource).not.toHaveBeenCalled();
        expect(sourceId).toBe("terrain-dem");

        // Layer should reference terrain-dem
        const [layerSpec] = map.addLayer.mock.calls[0];
        expect(layerSpec.source).toBe("terrain-dem");
    });

    it("adds a new source when terrain-dem has a different URL", () => {
        const map = makeMockMap({
            hasTerrain: true,
            terrainUrl: "https://other-tiles.example.com/{z}/{x}/{y}.png",
        });
        const sourceId = applyHillshadeBasemap(map, VALID_DEF);

        expect(map.addSource).toHaveBeenCalledOnce();
        expect(sourceId).toBe("__geoleaf_basemap__");
    });
});

// ─── applyHillshadeBasemap — validation ──────────────────────────────────────

describe("applyHillshadeBasemap — error cases", () => {
    it("does not add layer when demUrl is missing", () => {
        const map = makeMockMap();
        applyHillshadeBasemap(map, { hillshade: {} });
        expect(map.addSource).not.toHaveBeenCalled();
        expect(map.addLayer).not.toHaveBeenCalled();
    });

    it("does not add layer when demUrl fails security validation", () => {
        const map = makeMockMap();
        applyHillshadeBasemap(map, { hillshade: { demUrl: "ftp://bad.url/dem.png" } });
        expect(map.addSource).not.toHaveBeenCalled();
    });
});
