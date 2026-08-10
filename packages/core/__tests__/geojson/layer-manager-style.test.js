/**
 */
const state = vi.hoisted(() => ({ layers: new Map() }));
vi.mock("../../src/kernel/geojson/shared.js", () => ({ GeoJSONShared: { state } }));
vi.mock("../../src/utils/general/di-accessors.js", () => ({
    getLog: () => ({ warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
import { LayerManagerStyle } from "../../src/kernel/geojson/layers/style.js";

const _g = typeof globalThis !== "undefined" ? globalThis : window;

describe("geojson/layers/style", () => {
    afterEach(() => {
        state.layers.clear();
        state.adapter = undefined;
        _g.GeoLeaf = undefined;
    });

    describe("setLayerStyle", () => {
        it("returns false when layer not found", () => {
            state.layers.clear();
            expect(LayerManagerStyle.setLayerStyle("missing", { style: {} })).toBe(false);
        });

        it("returns false when no adapter available", () => {
            state.layers.set("lyr1", { layer: {}, config: {} });
            expect(LayerManagerStyle.setLayerStyle("lyr1", { style: {} })).toBe(false);
        });

        it("delegates to VectorTiles.updateLayerStyle when layer isVectorTile", () => {
            const updateLayerStyle = vi.fn();
            _g.GeoLeaf = { _VectorTiles: { updateLayerStyle } };
            state.layers.set("vt1", { layer: {}, config: {}, isVectorTile: true });
            const result = LayerManagerStyle.setLayerStyle("vt1", { style: {} });
            expect(result).toBe(true);
            expect(updateLayerStyle).toHaveBeenCalledWith("vt1", { style: {} });
        });

        it("delegates to adapter.setLayerStyle when adapter available", () => {
            const setLayerStyle = vi.fn();
            state.adapter = { setLayerStyle };
            state.layers.set("lyr1", { layer: null, config: {} });
            const styleConfig = { style: { fill: { color: "#f00" } } };
            const result = LayerManagerStyle.setLayerStyle("lyr1", styleConfig);
            expect(result).toBe(true);
            expect(setLayerStyle).toHaveBeenCalledWith("lyr1", styleConfig);
        });

        it("updates layerData.currentStyle after applying", () => {
            state.adapter = { setLayerStyle: vi.fn() };
            const layerData = { layer: null, config: {} };
            state.layers.set("lyr2", layerData);
            const styleConfig = { style: { fill: { color: "#0f0" } } };
            LayerManagerStyle.setLayerStyle("lyr2", styleConfig);
            expect(layerData.currentStyle).toBe(styleConfig);
        });

        it("uses GeoLeaf.Core.getMap() as adapter fallback", () => {
            const setLayerStyle = vi.fn();
            _g.GeoLeaf = { Core: { getMap: () => ({ setLayerStyle }) } };
            state.layers.set("lyr3", { layer: null, config: {} });
            const result = LayerManagerStyle.setLayerStyle("lyr3", { style: {} });
            expect(result).toBe(true);
            expect(setLayerStyle).toHaveBeenCalled();
        });

        it("returns false when adapter has no setLayerStyle method", () => {
            state.adapter = {}; // adapter without setLayerStyle
            state.layers.set("lyr4", { layer: null, config: {} });
            expect(LayerManagerStyle.setLayerStyle("lyr4", { style: {} })).toBe(false);
        });
    });
});
