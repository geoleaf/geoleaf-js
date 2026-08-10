/**
 * Unit tests for the GeoJSON point-layer symbol injector (S10 F5 — pure taxonomy
 * bridge). The injector delegates entirely to the taxonomy resolver
 * (`GeoLeaf.Taxonomy.resolvePoiIcon`, via the layer's `modules.taxonomy` binding);
 * there is no legacy category fallback and no `Config` argument.
 *
 * Covers:
 *  - taxonomy resolves (useIcon:true) → symbolId injected
 *  - taxonomy declines (useIcon:false) → nothing injected
 *  - resolver absent (Lite bundle) → nothing injected
 *  - no layerId → resolver skipped → nothing injected
 *  - geometry filtering (Point/MultiPoint only)
 *  - the resolver receives a {layerId, properties} shim
 */

import { injectSymbolIds } from "../../src/kernel/geojson/loader/symbol-injector.js";

/** One GeoJSON Point feature carrying `categoryId`. */
function pointFeature(props = { categoryId: "cat" }) {
    return { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: props };
}

describe("symbol-injector — injectSymbolIds (S10 F5 pure taxonomy bridge)", () => {
    it("injects the taxonomy symbolId when the resolver returns useIcon:true", () => {
        const data = { features: [pointFeature()] };
        const taxonomyResolve = vi.fn(() => ({ useIcon: true, symbolId: "tax-icon" }));
        injectSymbolIds(data, "layer-1", taxonomyResolve);
        expect(data.features[0].properties.symbolId).toBe("tax-icon");
    });

    it("injects nothing when the taxonomy resolver returns useIcon:false", () => {
        const data = { features: [pointFeature()] };
        const taxonomyResolve = vi.fn(() => ({ useIcon: false, symbolId: null }));
        injectSymbolIds(data, "layer-1", taxonomyResolve);
        expect(data.features[0].properties.symbolId).toBeUndefined();
    });

    it("injects nothing when the taxonomy resolver is absent (Lite bundle)", () => {
        const data = { features: [pointFeature()] };
        injectSymbolIds(data, "layer-1"); // no resolver
        expect(data.features[0].properties.symbolId).toBeUndefined();
    });

    it("injects nothing (resolver skipped) when no layerId is provided", () => {
        const data = { features: [pointFeature()] };
        const taxonomyResolve = vi.fn(() => ({ useIcon: true, symbolId: "tax-icon" }));
        injectSymbolIds(data, undefined, taxonomyResolve);
        expect(taxonomyResolve).not.toHaveBeenCalled();
        expect(data.features[0].properties.symbolId).toBeUndefined();
    });

    it("ignores non-point geometries and processes MultiPoint", () => {
        const line = {
            type: "Feature",
            geometry: { type: "LineString", coordinates: [] },
            properties: { categoryId: "cat" },
        };
        const multi = {
            type: "Feature",
            geometry: { type: "MultiPoint", coordinates: [[0, 0]] },
            properties: { categoryId: "cat" },
        };
        const data = { features: [line, multi] };
        const taxonomyResolve = vi.fn(() => ({ useIcon: true, symbolId: "tax-icon" }));
        injectSymbolIds(data, "layer-1", taxonomyResolve);
        expect(line.properties.symbolId).toBeUndefined();
        expect(multi.properties.symbolId).toBe("tax-icon");
    });

    it("passes a {layerId, properties} shim to the taxonomy resolver", () => {
        const props = { categoryId: "cat", subCategoryId: "sub" };
        const data = { features: [pointFeature(props)] };
        const taxonomyResolve = vi.fn(() => ({ useIcon: true, symbolId: "tax-icon" }));
        injectSymbolIds(data, "layer-x", taxonomyResolve);
        expect(taxonomyResolve).toHaveBeenCalledWith({ layerId: "layer-x", properties: props });
    });
});
