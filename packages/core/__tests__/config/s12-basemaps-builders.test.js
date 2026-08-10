/**
 * Config-contract Phase C / C3 — B4 basemaps.json: per-value builders/helpers.
 *
 * Complements s12-basemaps-types (the per-type dispatch) with value-by-value
 * assertions on the pure factories each type funnels through:
 *   - providers.normalizeTilesArray   (url/{s}/subdomains/tiles + {apikey})
 *   - image-source.buildImageSourceSpec (coordinates / opacity clamp)
 *   - hillshade.buildHillshadeSourceSpec (demEncoding / demMaxZoom defaults)
 *   - wmts-resolver.buildWmsUrl + parseWmtsCapabilities (WMS/WMTS params)
 *   - terrain.resolveTerrainConfig + activateTerrain (3D defaults)
 *
 * Consumers: packages/core/src/kernel/basemaps/*. Inventory B4.
 */

import { normalizeTilesArray } from "../../src/kernel/basemaps/providers.js";
import { buildImageSourceSpec } from "../../src/kernel/basemaps/image-source.js";
import { buildHillshadeSourceSpec } from "../../src/kernel/basemaps/hillshade.js";
import { buildWmsUrl, parseWmtsCapabilities } from "../../src/kernel/basemaps/wmts-resolver.js";
import {
    resolveTerrainConfig,
    activateTerrain,
    isTerrainActive,
    _resetTerrainStateForTesting,
} from "../../src/kernel/basemaps/terrain.js";

// ── providers.normalizeTilesArray ───────────────────────────────────────────
describe("config B4 — basemaps[].url/{s}/subdomains/tiles (providers.ts)", () => {
    it("url with {s} + subdomains string → one tile per subdomain", () => {
        const tiles = normalizeTilesArray({
            url: "https://{s}.t.io/{z}/{x}/{y}.png",
            subdomains: "abcd",
        });
        expect(tiles).toEqual([
            "https://a.t.io/{z}/{x}/{y}.png",
            "https://b.t.io/{z}/{x}/{y}.png",
            "https://c.t.io/{z}/{x}/{y}.png",
            "https://d.t.io/{z}/{x}/{y}.png",
        ]);
    });

    it("url with {s} and no subdomains → default a/b/c", () => {
        expect(normalizeTilesArray({ url: "https://{s}.t.io/{z}/{x}/{y}.png" })).toHaveLength(3);
    });

    it("url without {s} → single-element array", () => {
        expect(normalizeTilesArray({ url: "https://t.io/{z}/{x}/{y}.png" })).toEqual([
            "https://t.io/{z}/{x}/{y}.png",
        ]);
    });

    it("explicit tiles[] wins over url", () => {
        const tiles = ["https://x.io/{z}/{x}/{y}.png"];
        expect(normalizeTilesArray({ url: "https://{s}.t.io/a", tiles })).toEqual(tiles);
    });

    it("no url and no tiles → empty array", () => {
        expect(normalizeTilesArray({})).toEqual([]);
    });

    // ── {apikey} resolution (ANO-042 surface: apiKey/apiKeyRequired read live) ──
    it("{apikey} + apiKey provided → key injected", () => {
        const tiles = normalizeTilesArray({ url: "https://t.io/{z}?k={apikey}", apiKey: "SECRET" });
        expect(tiles[0]).toBe("https://t.io/{z}?k=SECRET");
    });

    it("{apikey} + apiKeyRequired and no key → disabled (empty array)", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const tiles = normalizeTilesArray({
            id: "needs-key",
            url: "https://t.io/{z}?k={apikey}",
            apiKeyRequired: true,
        });
        expect(tiles).toEqual([]);
        expect(warn).toHaveBeenCalled();
    });

    it("{apikey} optional (no required, no key) → placeholder param stripped", () => {
        const tiles = normalizeTilesArray({ url: "https://t.io/{z}?k={apikey}" });
        expect(tiles[0]).toBe("https://t.io/{z}");
    });
});

// ── image-source.buildImageSourceSpec ───────────────────────────────────────
describe("config B4 — basemaps[].imageSource (image-source.ts)", () => {
    const coords = [
        [-5, 51],
        [9, 51],
        [9, 41],
        [-5, 41],
    ];

    it("valid config → image source + raster layer with clamped opacity", () => {
        const specs = buildImageSourceSpec(
            { imageSource: { url: "https://i.io/x.png", coordinates: coords, opacity: 0.4 } },
            "src",
            "lyr"
        );
        expect(specs.sourceSpec).toMatchObject({
            type: "image",
            url: "https://i.io/x.png",
            coordinates: coords,
        });
        expect(specs.layerSpec).toMatchObject({ type: "raster", paint: { "raster-opacity": 0.4 } });
    });

    it("opacity > 1 → clamped to 1", () => {
        const specs = buildImageSourceSpec(
            { imageSource: { url: "https://i.io/x.png", coordinates: coords, opacity: 5 } },
            "src",
            "lyr"
        );
        expect(specs.layerSpec.paint["raster-opacity"]).toBe(1);
    });

    it("invalid coordinates → falls back to world bounds (still builds)", () => {
        const specs = buildImageSourceSpec(
            { imageSource: { url: "https://i.io/x.png", coordinates: [[0, 0]] } },
            "src",
            "lyr"
        );
        expect(specs.sourceSpec.coordinates).toHaveLength(4);
    });

    it("missing url → null (cannot build)", () => {
        expect(buildImageSourceSpec({ imageSource: {} }, "src", "lyr")).toBeNull();
    });
});

// ── hillshade.buildHillshadeSourceSpec ──────────────────────────────────────
describe("config B4 — basemaps[].hillshade (hillshade.ts)", () => {
    it("reads hillshade.demUrl + demEncoding + demMaxZoom", () => {
        const spec = buildHillshadeSourceSpec({
            hillshade: {
                demUrl: "https://d.io/{z}/{x}/{y}.png",
                demEncoding: "mapbox",
                demMaxZoom: 12,
            },
        });
        expect(spec).toMatchObject({
            type: "raster-dem",
            tiles: ["https://d.io/{z}/{x}/{y}.png"],
            encoding: "mapbox",
            maxzoom: 12,
        });
    });

    it("demEncoding defaults to terrarium, demMaxZoom defaults to 15", () => {
        const spec = buildHillshadeSourceSpec({ hillshade: { demUrl: "https://d.io/x.png" } });
        expect(spec.encoding).toBe("terrarium");
        expect(spec.maxzoom).toBe(15);
    });
});

// ── wmts-resolver.buildWmsUrl (WMS GetMap template) ─────────────────────────
describe("config B4 — basemaps[].wms (wmts-resolver.ts)", () => {
    it("builds a WMS GetMap url with version/layers/format/transparent", () => {
        const url = buildWmsUrl({
            wms: {
                url: "https://w.io/ows",
                layers: "ref:o",
                version: "1.3.0",
                format: "image/png",
                transparent: true,
            },
        });
        expect(url).toContain("SERVICE=WMS");
        expect(url).toContain("VERSION=1.3.0");
        expect(url).toContain("LAYERS=ref%3Ao");
        expect(url).toContain("FORMAT=image%2Fpng");
        expect(url).toContain("TRANSPARENT=TRUE");
        expect(url).toContain("BBOX={bbox-epsg-3857}");
    });

    it("CRS defaults to EPSG:3857 when wms.crs absent", () => {
        const url = buildWmsUrl({ wms: { url: "https://w.io/ows", layers: "a" } });
        expect(url).toContain("CRS=EPSG%3A3857");
    });

    it("missing wms.url or wms.layers → null", () => {
        expect(buildWmsUrl({ wms: { layers: "a" } })).toBeNull();
        expect(buildWmsUrl({ wms: { url: "https://w.io/ows" } })).toBeNull();
    });
});

// ── wmts-resolver.parseWmtsCapabilities (RESTful ResourceURL → XYZ) ──────────
describe("config B4 — basemaps[].wmts GetCapabilities parsing (wmts-resolver.ts)", () => {
    const CAPS = `<?xml version="1.0"?>
<Capabilities xmlns="http://www.opengis.net/wmts/1.0">
  <Contents>
    <Layer>
      <Identifier>ORTHO</Identifier>
      <Style isDefault="true"><Identifier>normal</Identifier></Style>
      <TileMatrixSetLink><TileMatrixSet>PM</TileMatrixSet></TileMatrixSetLink>
      <ResourceURL format="image/jpeg" resourceType="tile"
        template="https://wmts.io/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpg"/>
    </Layer>
  </Contents>
</Capabilities>`;

    it("resolves the RESTful template to a MapLibre XYZ url", () => {
        const url = parseWmtsCapabilities(CAPS, "ORTHO", "PM", "image/jpeg");
        expect(url).toBe("https://wmts.io/normal/PM/{z}/{y}/{x}.jpg");
    });

    it("unknown layer name → null", () => {
        expect(parseWmtsCapabilities(CAPS, "MISSING", "PM", "image/jpeg")).toBeNull();
    });
});

// ── terrain.resolveTerrainConfig + activateTerrain ──────────────────
describe("config B4 — basemaps[].terrain (terrain.ts)", () => {
    beforeEach(() => _resetTerrainStateForTesting());
    afterEach(() => vi.restoreAllMocks());

    it("enabled + demUrl → returns the terrain config", () => {
        const terrain = { enabled: true, demUrl: "https://d.io/x.png", demEncoding: "terrarium" };
        expect(resolveTerrainConfig({ terrain }, "k")).toBe(terrain);
    });

    it("enabled WITHOUT demUrl → null (boot-time error)", () => {
        expect(resolveTerrainConfig({ terrain: { enabled: true } }, "k")).toBeNull();
    });

    it("terrain.enabled:false → null", () => {
        expect(resolveTerrainConfig({ terrain: { enabled: false, demUrl: "x" } }, "k")).toBeNull();
    });

    it("activateTerrain applies setTerrain + raster-dem source + camera defaults", () => {
        const map = {
            getSource: vi.fn(() => undefined),
            addSource: vi.fn(),
            setTerrain: vi.fn(),
            easeTo: vi.fn(),
            on: vi.fn(),
        };
        activateTerrain(map, { enabled: true, demUrl: "https://d.io/x.png" }, "k");
        expect(map.addSource).toHaveBeenCalledWith(
            "terrain-dem",
            expect.objectContaining({ type: "raster-dem", encoding: "terrarium", maxzoom: 15 })
        );
        // defaults: exaggeration 1.5, pitch 45, bearing 0
        expect(map.setTerrain).toHaveBeenCalledWith({ source: "terrain-dem", exaggeration: 1.5 });
        expect(map.easeTo).toHaveBeenCalledWith({ pitch: 45, bearing: 0 });
        expect(isTerrainActive()).toBe(true);
    });
});
