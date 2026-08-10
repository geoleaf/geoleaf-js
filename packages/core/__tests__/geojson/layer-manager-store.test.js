/**
 */
vi.mock("../../src/kernel/geojson/shared.js", () => {
    const layers = new Map();
    return {
        GeoJSONShared: {
            state: { layers },
        },
    };
});
vi.mock("../../src/utils/log/index.js", () => ({
    Log: { warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
vi.mock("../../src/utils/general/di-accessors.js", () => ({
    getLog: () => ({ warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

import { GeoJSONShared } from "../../src/kernel/geojson/shared.js";
import { LayerManagerStore } from "../../src/kernel/geojson/layers/store.js";

describe("geojson/layers/store", () => {
    let layers;
    beforeEach(() => {
        layers = GeoJSONShared.state.layers;
        layers.clear();
    });

    it("getLayerById returns null when layer missing", () => {
        expect(LayerManagerStore.getLayerById("x")).toBeNull();
    });

    it("getLayerById returns layer data when present", () => {
        const data = { id: "lyr1", label: "L1", layer: {} };
        layers.set("lyr1", data);
        expect(LayerManagerStore.getLayerById("lyr1")).toBe(data);
    });

    it("getLayerData returns null when layer missing", () => {
        expect(LayerManagerStore.getLayerData("x")).toBeNull();
    });

    it("getLayerData returns geojson, geometryType, config when layer exists", () => {
        const data = {
            id: "lyr1",
            features: [],
            geometryType: "point",
            config: { a: 1 },
            layer: {},
        };
        layers.set("lyr1", data);
        const result = LayerManagerStore.getLayerData("lyr1");
        expect(result.geometryType).toBe("point");
        expect(result.config).toEqual({ a: 1 });
    });

    it("getAllLayers returns empty array when no layers", () => {
        expect(LayerManagerStore.getAllLayers()).toEqual([]);
    });

    it("detectLayerType returns mixed when layer is null", () => {
        expect(LayerManagerStore.detectLayerType(null)).toBe("mixed");
    });

    it("getAllLayers returns layer with _visibility.logicalState and featureCount", () => {
        const layer = { getLayers: () => [] };
        layers.set("lyr1", {
            id: "lyr1",
            label: "L1",
            layer,
            _visibility: { logicalState: true },
            geometryType: "poi",
            features: [{}],
        });
        const result = LayerManagerStore.getAllLayers();
        expect(result).toHaveLength(1);
        expect(result[0].visible).toBe(true);
        expect(result[0].type).toBe("poi");
        expect(result[0].featureCount).toBe(1);
    });

    // KERNEL S6: the "poi" / "route" / "area" cases used to be asserted here through
    // an `eachLayer` mock — a Leaflet `L.LayerGroup` API. No MapLibre layer handle has
    // it, so in production the guard always short-circuited and only "mixed" was ever
    // returned; the tests were green solely because the mock re-created a Leaflet shape.
    // The dominant type now comes from the cached `layerData.geometryType`, asserted in
    // "getAllLayers returns layer with _visibility.logicalState and featureCount" above.
    it("detectLayerType always returns mixed (Leaflet detection removed)", () => {
        expect(LayerManagerStore.detectLayerType({ eachLayer: () => {} })).toBe("mixed");
    });

    it("removeLayer removes layer when visible is false (no hideLayer)", () => {
        const layer = { clearLayers: vi.fn() };
        const clusterGroup = { clearLayers: vi.fn() };
        layers.set("lyr1", {
            id: "lyr1",
            visible: false,
            layer,
            clusterGroup,
        });
        LayerManagerStore.removeLayer("lyr1");
        expect(layers.has("lyr1")).toBe(false);
    });
});

// ── T21 — store.ts branch coverage ──────────────────────────────────────────
describe("geojson/layers/store — T21 branch coverage", () => {
    let layers;
    beforeEach(() => {
        layers = GeoJSONShared.state.layers;
        layers.clear();
        GeoJSONShared.state.map = null;
    });

    // Lines 127-128: removeLayer when layer not found
    it("removeLayer does not throw when layer not found", () => {
        expect(() => LayerManagerStore.removeLayer("nonexistent")).not.toThrow();
    });

    // Line 133: removeLayer calls hideLayer when visible=true
    it("removeLayer calls hideLayer when layer is visible", () => {
        LayerManagerStore.hideLayer = vi.fn();
        const layer = { clearLayers: vi.fn() };
        layers.set("lyr1", { id: "lyr1", visible: true, layer });
        LayerManagerStore.removeLayer("lyr1");
        expect(LayerManagerStore.hideLayer).toHaveBeenCalledWith("lyr1");
        expect(layers.has("lyr1")).toBe(false);
    });

    // getAllLayers — _visibility fallback to layerData.visible
    it("getAllLayers uses layerData.visible when _visibility not set", () => {
        layers.set("lyr1", {
            id: "lyr1",
            label: "L1",
            visible: true,
            layer: { getLayers: () => [] },
        });
        const result = LayerManagerStore.getAllLayers();
        expect(result[0].visible).toBe(true);
    });

    // KERNEL S6: this used to assert `featureCount` fell back to `layer.getLayers().length`
    // — another Leaflet `L.LayerGroup` API. Against a real MapLibre handle that branch threw
    // a TypeError; it only ever passed because the mock supplied a Leaflet-shaped object.
    // `features` is now the single source, and a layer without it counts 0.
    it("getAllLayers returns featureCount 0 when features not set (no Leaflet fallback)", () => {
        layers.set("lyr1", {
            id: "lyr1",
            label: "L1",
            visible: false,
            layer: { someMapLibreHandle: true },
        });
        const result = LayerManagerStore.getAllLayers();
        expect(result[0].featureCount).toBe(0);
    });

    // getAllLayers — featureCount = 0 when no features and no layer
    it("getAllLayers returns featureCount 0 when no features and no layer", () => {
        layers.set("lyr1", { id: "lyr1", label: "L1", visible: false });
        const result = LayerManagerStore.getAllLayers();
        expect(result[0].featureCount).toBe(0);
    });
});
