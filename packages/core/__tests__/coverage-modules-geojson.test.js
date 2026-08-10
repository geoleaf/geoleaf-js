/**
 * Campagne tests unitaires — geojson (shared)
 */

import { GeoJSONShared } from "../src/kernel/geojson/shared.js";

describe("Coverage — GeoJSONShared", () => {
    it("state has layers Map and options", () => {
        expect(GeoJSONShared.state).toBeDefined();
        expect(GeoJSONShared.state.layers).toBeInstanceOf(Map);
        expect(GeoJSONShared.state.options).toBeDefined();
    });
    it("STYLE_OPERATORS has comparison operators", () => {
        expect(GeoJSONShared.STYLE_OPERATORS[">"](2, 1)).toBe(true);
        expect(GeoJSONShared.STYLE_OPERATORS["=="](1, 1)).toBe(true);
        expect(GeoJSONShared.STYLE_OPERATORS.contains("hello", "ell")).toBe(true);
    });
    it("getLayers returns state.layers", () => {
        expect(GeoJSONShared.getLayers()).toBe(GeoJSONShared.state.layers);
    });

    it("getLog returns GeoLeaf.Log when defined", () => {
        const log = GeoJSONShared.getLog();
        expect(log).toBeDefined();
    });

    it("getLog falls back to console when GeoLeaf.Log is null", () => {
        const g = globalThis;
        const origLog = g.GeoLeaf?.Log;
        if (g.GeoLeaf) g.GeoLeaf.Log = null;
        const log = GeoJSONShared.getLog();
        expect(log).toBe(console);
        if (g.GeoLeaf) g.GeoLeaf.Log = origLog;
    });
    it("getLayerById returns undefined for missing id", () => {
        expect(GeoJSONShared.getLayerById("missing")).toBeUndefined();
    });
    it("reset clears state", () => {
        GeoJSONShared.state.layers.set("x", {});
        GeoJSONShared.reset();
        expect(GeoJSONShared.state.layers.size).toBe(0);
        expect(GeoJSONShared.state.map).toBeNull();
    });
});
