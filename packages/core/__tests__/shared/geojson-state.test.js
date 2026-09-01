/**
 * @fileoverview Unit tests for shared/geojson-state — re-export of GeoJSONShared
 */

const mockGeoJSONShared = vi.hoisted(() => ({
    getLayers: vi.fn(() => new Map()),
    getLayerById: vi.fn(() => undefined),
    state: {
        map: null,
        layerGroup: null,
        layers: new Map(),
        layerIdCounter: 0,
    },
    resetState: vi.fn(),
}));

vi.mock("../../src/kernel/geojson/shared.ts", () => ({
    GeoJSONShared: mockGeoJSONShared,
}));
import { GeoJSONShared } from "../../src/kernel/shared/geojson-state.js";

describe("shared/geojson-state", () => {
    it("re-exports GeoJSONShared from geojson/shared", () => {
        expect(GeoJSONShared).toBeDefined();
        expect(GeoJSONShared).toBe(mockGeoJSONShared);
    });

    it("getLayers is callable and returns a Map", () => {
        const layers = GeoJSONShared.getLayers();
        expect(layers).toBeInstanceOf(Map);
    });

    it("getLayerById is callable", () => {
        expect(GeoJSONShared.getLayerById("layer-1")).toBeUndefined();
    });

    it("state object is accessible", () => {
        expect(GeoJSONShared.state).toBeDefined();
        expect(GeoJSONShared.state.map).toBeNull();
        expect(GeoJSONShared.state.layers).toBeInstanceOf(Map);
    });
});
