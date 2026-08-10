/**
 * @tests built-in/basemaps/image-source
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// validateUrl returns null for invalid URLs, the url itself for valid ones
vi.mock("../../src/utils/general/utils-base.js", () => ({
    validateUrl: (url, _protocols) => {
        if (typeof url !== "string") return null;
        if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:"))
            return url;
        return null;
    },
}));

// ─── Module under test ────────────────────────────────────────────────────────

let buildImageSourceSpec;
let applyImageBasemap;

beforeAll(async () => {
    const mod = await import("../../src/kernel/basemaps/image-source.ts");
    buildImageSourceSpec = mod.buildImageSourceSpec;
    applyImageBasemap = mod.applyImageBasemap;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_COORDS = [
    [-10, 45],
    [10, 45],
    [10, 30],
    [-10, 30],
];

const VALID_DEF = {
    imageSource: {
        url: "https://example.com/ortho.png",
        coordinates: VALID_COORDS,
        opacity: 0.8,
    },
    attribution: "© Test",
};

function makeMockMap(layers = []) {
    return {
        addSource: vi.fn(),
        addLayer: vi.fn(),
        getStyle: vi.fn(() => ({ layers })),
    };
}

// ─── buildImageSourceSpec ─────────────────────────────────────────────────────

describe("buildImageSourceSpec", () => {
    it("returns correct sourceSpec and layerSpec for valid definition", () => {
        const result = buildImageSourceSpec(VALID_DEF, "__src__", "__lyr__");
        expect(result).not.toBeNull();
        expect(result.sourceSpec.type).toBe("image");
        expect(result.sourceSpec.url).toBe("https://example.com/ortho.png");
        expect(result.sourceSpec.coordinates).toEqual(VALID_COORDS);
        expect(result.layerSpec.type).toBe("raster");
        expect(result.layerSpec.id).toBe("__lyr__");
        expect(result.layerSpec.source).toBe("__src__");
        expect(result.layerSpec.paint["raster-opacity"]).toBe(0.8);
    });

    it("returns null when imageSource.url is missing", () => {
        const result = buildImageSourceSpec({ imageSource: {} }, "s", "l");
        expect(result).toBeNull();
    });

    it("returns null when url fails security validation", () => {
        const result = buildImageSourceSpec(
            { imageSource: { url: "javascript:alert(1)" } },
            "s",
            "l"
        );
        expect(result).toBeNull();
    });

    it("falls back to world bounds when coordinates are invalid", () => {
        const def = { imageSource: { url: "https://example.com/img.png", coordinates: [[0, 0]] } };
        const result = buildImageSourceSpec(def, "s", "l");
        expect(result).not.toBeNull();
        // World bounds: topLeft = [-180, 85.051129]
        expect(result.sourceSpec.coordinates[0][0]).toBe(-180);
    });

    it("defaults opacity to 1 when not specified", () => {
        const def = { imageSource: { url: "https://example.com/img.png" } };
        const result = buildImageSourceSpec(def, "s", "l");
        expect(result.layerSpec.paint["raster-opacity"]).toBe(1);
    });

    it("clamps opacity to valid range [0, 1]", () => {
        const over = {
            imageSource: { url: "https://example.com/img.png", opacity: 5 },
        };
        const under = {
            imageSource: { url: "https://example.com/img.png", opacity: -1 },
        };
        expect(buildImageSourceSpec(over, "s", "l").layerSpec.paint["raster-opacity"]).toBe(1);
        expect(buildImageSourceSpec(under, "s", "l").layerSpec.paint["raster-opacity"]).toBe(0);
    });

    it("accepts data: URIs for embedded images", () => {
        const def = {
            imageSource: { url: "data:image/png;base64,abc123", coordinates: VALID_COORDS },
        };
        const result = buildImageSourceSpec(def, "s", "l");
        expect(result).not.toBeNull();
        expect(result.sourceSpec.url).toBe("data:image/png;base64,abc123");
    });
});

// ─── applyImageBasemap ────────────────────────────────────────────────────────

describe("applyImageBasemap", () => {
    it("calls addSource and addLayer on the map", () => {
        const map = makeMockMap();
        applyImageBasemap(map, VALID_DEF);
        expect(map.addSource).toHaveBeenCalledOnce();
        expect(map.addLayer).toHaveBeenCalledOnce();
    });

    it("inserts layer above first existing layer (below all others)", () => {
        const map = makeMockMap([{ id: "existing-layer" }]);
        applyImageBasemap(map, VALID_DEF, "__src__", "__lyr__");
        const addLayerCall = map.addLayer.mock.calls[0];
        // Second argument is the beforeId — should equal the first existing layer ID
        expect(addLayerCall[1]).toBe("existing-layer");
    });

    it("adds layer without beforeId when no existing layers", () => {
        const map = makeMockMap([]);
        applyImageBasemap(map, VALID_DEF);
        const addLayerCall = map.addLayer.mock.calls[0];
        expect(addLayerCall[1]).toBeUndefined();
    });

    it("does not call addSource when definition is invalid", () => {
        const map = makeMockMap();
        applyImageBasemap(map, { imageSource: { url: "ftp://bad" } });
        expect(map.addSource).not.toHaveBeenCalled();
    });
});
