/**
 * Config-contract Phase C / C4 — B5 {id}_config.json data.vectorTiles.*.
 *
 * Read path: geojson/vector-tiles.ts VectorTiles exposes the exported seams that read
 * the data.vectorTiles block: shouldUseVectorTiles / _getVTConfig / _resolveTileUrl, and
 * loadVectorTileLayer builds the native MapLibre `vector` source (incl. the `scheme`
 * read at vector-tiles.ts:325). The remaining data.* keys (file/url/dataUrl routing —
 * loader/profile.ts:_resolveLayerUrl; headers/autoRefresh/ogcApi — single-layer.ts) are
 * file-local resolvers covered end-to-end by e2e/cfg-c4 and locked schema-side in
 * s13-layers-anomalies-lock (ogcApi ANO-056, scheme ANO-055).
 *
 * Consumer: packages/core/src/capabilities/vector-tiles/vector-tiles.ts. Inventory B5.
 * Source of truth: profiles/_reference/layers/reference-points/reference-points_config.json.
 */

import { VectorTiles } from "../../src/capabilities/vector-tiles/vector-tiles.js";
import { REFERENCE_LAYER_CONFIG, clone, deepMerge } from "./_helpers/config-harness.js";

const REF = REFERENCE_LAYER_CONFIG;

describe("config B5 — data.vectorTiles config reads (VectorTiles._getVTConfig)", () => {
    it("reference fixture: every vectorTiles leaf is read into the VT config block", () => {
        const vt = VectorTiles._getVTConfig(clone(REF));
        expect(vt).toMatchObject({
            enabled: false,
            tilesDirectory: "layers/reference-points/tiles",
            tilesUrl: "https://example.test/poi/{z}/{x}/{y}.pbf",
            layerName: "poi",
            minZoom: 0,
            maxNativeZoom: 14,
            maxZoom: 22,
            interactive: true,
        });
    });

    it("normalized root def.vectorTiles wins over def.data.vectorTiles", () => {
        const def = {
            vectorTiles: { tilesUrl: "https://x/{z}/{x}/{y}.pbf" },
            data: { vectorTiles: { tilesUrl: "ignored" } },
        };
        expect(VectorTiles._getVTConfig(def).tilesUrl).toBe("https://x/{z}/{x}/{y}.pbf");
    });

    it("no vectorTiles block → null", () => {
        expect(VectorTiles._getVTConfig({ data: {} })).toBeNull();
    });
});

describe("config B5 — data.vectorTiles.enabled gating (VectorTiles.shouldUseVectorTiles)", () => {
    it("reference fixture (enabled:false) → falls back to GeoJSON (false)", () => {
        expect(VectorTiles.shouldUseVectorTiles(clone(REF))).toBe(false);
    });

    it("enabled:true + absolute tilesUrl → true", () => {
        const def = deepMerge(REF, { data: { vectorTiles: { enabled: true } } });
        expect(VectorTiles.shouldUseVectorTiles(def)).toBe(true);
    });

    it("enabled:true but relative tilesUrl → false (PBF may not exist)", () => {
        const def = deepMerge(REF, {
            data: { vectorTiles: { enabled: true, tilesUrl: "tiles/{z}/{x}/{y}.pbf" } },
        });
        expect(VectorTiles.shouldUseVectorTiles(def)).toBe(false);
    });
});

describe("config B5 — data.vectorTiles.tilesUrl resolution (VectorTiles._resolveTileUrl)", () => {
    it("absolute tilesUrl returned verbatim", () => {
        const def = clone(REF);
        const vt = def.data.vectorTiles;
        expect(VectorTiles._resolveTileUrl(def, vt)).toBe(
            "https://example.test/poi/{z}/{x}/{y}.pbf"
        );
    });

    it("relative tilesUrl + profile metadata → built from tilesDirectory", () => {
        const def = {
            _profileId: "_reference",
            _layerDirectory: "layers/reference-points",
            data: {},
        };
        const vt = { tilesDirectory: "tiles" };
        expect(VectorTiles._resolveTileUrl(def, vt)).toBe(
            "profiles/_reference/layers/reference-points/tiles/{z}/{x}/{y}.pbf"
        );
    });
});

describe("config B5 — @anomaly ANO-055: data.vectorTiles.scheme consumed into the adapter spec", () => {
    let adapterMock;
    beforeEach(() => {
        // Socle B.1: VT delegates building to the adapter; scheme now flows through
        // the engine-agnostic spec (`spec.source.scheme`). The native-source assembly
        // (only "tms" is set on the MapLibre source) is covered by the adapter test.
        adapterMock = {
            addVectorTileLayer: vi.fn(() => []),
            getNativeMap: vi.fn(() => null),
        };
        globalThis.GeoLeaf = { Core: { getMap: () => adapterMock } };
    });
    afterEach(() => {
        delete globalThis.GeoLeaf;
        vi.restoreAllMocks();
    });

    // No `styles` block → _loadVtStyle returns null without fetch.
    const vtDef = (scheme) => ({
        id: "rp",
        geometry: "point",
        _profileId: "_reference",
        _layerDirectory: "layers/reference-points",
        data: {
            vectorTiles: {
                enabled: true,
                tilesUrl: "https://example.test/poi/{z}/{x}/{y}.pbf",
                layerName: "poi",
                ...(scheme ? { scheme } : {}),
            },
        },
    });

    it("live: scheme:'tms' → spec.source carries scheme:'tms'", async () => {
        await VectorTiles.loadVectorTileLayer("rp", "RP", vtDef("tms"), {});
        expect(adapterMock.addVectorTileLayer).toHaveBeenCalledTimes(1);
        expect(adapterMock.addVectorTileLayer.mock.calls[0][1].source).toMatchObject({
            scheme: "tms",
        });
    });

    it("live: no scheme → spec.source omits scheme (MapLibre xyz default)", async () => {
        await VectorTiles.loadVectorTileLayer("rp", "RP", vtDef(null), {});
        expect(adapterMock.addVectorTileLayer).toHaveBeenCalledTimes(1);
        expect(adapterMock.addVectorTileLayer.mock.calls[0][1].source.scheme).toBeUndefined();
    });
});
