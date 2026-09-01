/**
 * Config-contract Phase C / C3 — B4 basemaps.json: per-`type` layer creation.
 *
 * Proves the S12 objective for basemaps: each `type` enum value
 * (tile/raster/maplibre/image/hillshade/wmts/wms) reaches the correct registry
 * dispatch and a real MapLibre source/layer is created — plus 3D terrain.
 *
 * Read path: registry.setBaseLayer() resolves the type (registry.ts
 * `_resolveBasemapType` + `_applySyncBasemapByType` dispatch, :144-166,:539-631)
 * and delegates to the leaf appliers (providers / image-source / hillshade /
 * wmts-resolver / terrain). A fake native maplibregl.Map captures the
 * addSource/addLayer/setStyle/setTerrain calls — no WebGL, no DOM rendering.
 *
 * S6 anti-mislabel: the 7 types are ALL mapped (registre §S6, ANO-017 résolu) —
 * this file confirms the mapping positively, it does not hunt for a gap.
 * Inventory B4. Source of truth: profiles/_reference/config/core/basemaps.json.
 */

import {
    registerBaseLayer,
    setBaseLayer,
    setMap,
    getActiveKey,
    _resetStateForTesting,
} from "../../src/kernel/basemaps/registry.js";
import { _resetTerrainStateForTesting } from "../../src/kernel/basemaps/terrain.js";
import { REFERENCE_BASEMAPS } from "./_helpers/config-harness.js";

const SOURCE_ID = "__geoleaf_basemap__";
const BM = REFERENCE_BASEMAPS.basemaps;

/** Minimal native maplibregl.Map double — captures source/layer/terrain calls. */
function makeNativeMap(overrides = {}) {
    return {
        addSource: vi.fn(),
        addLayer: vi.fn(),
        getStyle: vi.fn(() => ({ layers: [] })),
        getLayer: vi.fn(() => undefined),
        getSource: vi.fn(() => undefined),
        removeLayer: vi.fn(),
        removeSource: vi.fn(),
        loaded: vi.fn(() => true),
        once: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        setStyle: vi.fn(),
        setTerrain: vi.fn(),
        easeTo: vi.fn(),
        ...overrides,
    };
}

describe("config B4 — basemaps[].type → layer created (basemaps/registry.ts)", () => {
    let map;
    beforeEach(() => {
        _resetStateForTesting();
        _resetTerrainStateForTesting();
        map = makeNativeMap();
        setMap(map);
    });
    afterEach(() => {
        setMap(null);
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    // ── tile / raster → MapLibre raster source + raster layer ─────────────────
    it("type tile → raster source + raster layer (subdomain-expanded tiles)", () => {
        registerBaseLayer("street", BM.street);
        setBaseLayer("street", { silent: true });
        expect(map.addSource).toHaveBeenCalledWith(
            SOURCE_ID,
            expect.objectContaining({ type: "raster", tileSize: 256 })
        );
        const [, sourceSpec] = map.addSource.mock.calls[0];
        expect(sourceSpec.tiles).toHaveLength(4); // {s} over subdomains "abcd"
        expect(map.addLayer).toHaveBeenCalledWith(
            expect.objectContaining({ type: "raster", source: SOURCE_ID })
        );
        expect(getActiveKey()).toBe("street");
    });

    it("type raster → raster source from explicit tiles[] array", () => {
        registerBaseLayer("carto-raster", BM["carto-raster"]);
        setBaseLayer("carto-raster", { silent: true });
        const [id, sourceSpec] = map.addSource.mock.calls[0];
        expect(id).toBe(SOURCE_ID);
        expect(sourceSpec).toMatchObject({ type: "raster", tileSize: 512 });
        expect(sourceSpec.tiles).toEqual(BM["carto-raster"].tiles);
    });

    // ── maplibre → vector style replacement via setStyle ──────────────────────
    it("type maplibre → setStyle(style url), no raster source added", () => {
        registerBaseLayer("vector", BM.vector);
        setBaseLayer("vector", { silent: true });
        expect(map.setStyle).toHaveBeenCalledWith(BM.vector.style, undefined);
        expect(map.once).toHaveBeenCalledWith("style.load", expect.any(Function));
        expect(map.addSource).not.toHaveBeenCalled();
    });

    // ── image → MapLibre image source + raster layer (opacity) ────────────────
    it("type image → image source + raster layer with raster-opacity", () => {
        registerBaseLayer("overlay", BM.overlay);
        setBaseLayer("overlay", { silent: true });
        expect(map.addSource).toHaveBeenCalledWith(
            SOURCE_ID,
            expect.objectContaining({ type: "image", coordinates: expect.any(Array) })
        );
        expect(map.addLayer).toHaveBeenCalledWith(
            expect.objectContaining({ type: "raster", paint: { "raster-opacity": 0.75 } })
        );
    });

    // ── hillshade → raster-dem source + hillshade layer ───────────────────────
    it("type hillshade → raster-dem source (encoding) + hillshade layer", () => {
        registerBaseLayer("relief", BM.relief);
        setBaseLayer("relief", { silent: true });
        expect(map.addSource).toHaveBeenCalledWith(
            SOURCE_ID,
            expect.objectContaining({ type: "raster-dem", encoding: "terrarium" })
        );
        expect(map.addLayer).toHaveBeenCalledWith(
            expect.objectContaining({ type: "hillshade", source: SOURCE_ID })
        );
    });

    // ── wms → raster source from a built WMS GetMap url ───────────────────────
    it("type wms → raster source whose tiles are a built WMS GetMap url", () => {
        registerBaseLayer("geoserver-wms", BM["geoserver-wms"]);
        setBaseLayer("geoserver-wms", { silent: true });
        const [, sourceSpec] = map.addSource.mock.calls[0];
        expect(sourceSpec.type).toBe("raster");
        expect(sourceSpec.tiles[0]).toContain("SERVICE=WMS");
        expect(sourceSpec.tiles[0]).toContain("LAYERS=reference%3Aorthophoto");
    });

    // ── wmts → routed to the async GetCapabilities path ───────────────────────
    it("type wmts → routed to async WMTS path (eager active key, no sync source)", () => {
        // Stub fetch so resolveWmtsTilesUrl resolves to null without real network.
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" })
        );
        registerBaseLayer("ign-wmts", BM["ign-wmts"]);
        setBaseLayer("ign-wmts", { silent: true });
        // _applyWmtsBasemap sets the active key eagerly (registry.ts).
        expect(getActiveKey()).toBe("ign-wmts");
        // GetCapabilities is async → no source is injected synchronously.
        expect(map.addSource).not.toHaveBeenCalled();
    });

    // ── terrain 3D → setTerrain + raster-dem terrain source ───────────────────
    it("terrain.default3D:true → 3D terrain activated (setTerrain + terrain-dem)", () => {
        registerBaseLayer("terrain-3d", BM["terrain-3d"]);
        setBaseLayer("terrain-3d", { silent: true });
        // The raster basemap itself is applied first…
        expect(map.addSource).toHaveBeenCalledWith(
            SOURCE_ID,
            expect.objectContaining({ type: "raster" })
        );
        // …then terrain is auto-activated from terrain.{demUrl,demEncoding,exaggeration}.
        expect(map.addSource).toHaveBeenCalledWith(
            "terrain-dem",
            expect.objectContaining({ type: "raster-dem", encoding: "terrarium" })
        );
        expect(map.setTerrain).toHaveBeenCalledWith(
            expect.objectContaining({ source: "terrain-dem", exaggeration: 1.5 })
        );
        expect(map.easeTo).toHaveBeenCalledWith({ pitch: 60, bearing: 0 });
    });

    // ── defaultBasemap flag is carried into the registry entry ────────────────
    it("registry: registered entry keeps its definition (defaultBasemap on street)", () => {
        registerBaseLayer("street", BM.street);
        registerBaseLayer("vector", BM.vector);
        setBaseLayer("street", { silent: true });
        expect(getActiveKey()).toBe("street");
        expect(BM.street.defaultBasemap).toBe(true);
    });
});
