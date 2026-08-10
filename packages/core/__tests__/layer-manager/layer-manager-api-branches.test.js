/**
 * Deep branch-coverage tests for layer-manager-api.ts
 * Covers: init, _loadConfigSections, _autoPopulateBasemap, _autoPopulateSections,
 * _registerGeoJsonLayer, _updateContent, refresh (immediate/debounced),
 * _mergeOptions.
 */
vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../src/kernel/layer-manager/layer-manager-helpers.js", () => ({
    _applyLayerManagerConfig: vi.fn(),
    _resolveBasemapDefs: vi.fn(() => ({})),
    _buildAutoBasemapSections: vi.fn(() => []),
    _createLayerEntry: vi.fn((id, opts) => ({ id, label: opts.label || id, type: "toggle" })),
    _resolveMap: vi.fn(() => null),
}));

import { LayerManager } from "../../src/kernel/layer-manager/layer-manager-api.js";
import * as helpers from "../../src/kernel/layer-manager/layer-manager-helpers.js";

const _g = typeof globalThis !== "undefined" ? globalThis : window;

describe("layer-manager-api — branch coverage", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        _g.GeoLeaf = _g.GeoLeaf || {};
        _g.GeoLeaf._LayerManagerControl = undefined;
        _g.GeoLeaf.Config = undefined;
        // Reset LayerManager state
        LayerManager._map = null;
        LayerManager._control = null;
        LayerManager._refreshTimeout = null;
        LayerManager._options = {
            position: "bottomright",
            title: "Gestionnaire de layers",
            collapsible: true,
            collapsed: false,
            sections: [],
        };
    });

    // ── init ──────────────────────────────────────────────────────────────
    it("init returns null when no map", () => {
        helpers._resolveMap.mockReturnValue(null);
        expect(LayerManager.init()).toBeNull();
    });

    it("init returns null when no _LayerManagerControl module", () => {
        helpers._resolveMap.mockReturnValue({});
        _g.GeoLeaf._LayerManagerControl = undefined;
        expect(LayerManager.init()).toBeNull();
    });

    it("init returns null when control creation fails", () => {
        helpers._resolveMap.mockReturnValue({});
        _g.GeoLeaf._LayerManagerControl = { create: vi.fn(() => null) };
        expect(LayerManager.init()).toBeNull();
    });

    it("init returns control when all ok", () => {
        const mockControl = { addTo: vi.fn(), updateSections: vi.fn(), refresh: vi.fn() };
        helpers._resolveMap.mockReturnValue({});
        _g.GeoLeaf._LayerManagerControl = { create: vi.fn(() => mockControl) };
        const result = LayerManager.init();
        expect(result).toBe(mockControl);
        expect(mockControl.addTo).toHaveBeenCalled();
    });

    // ── _loadConfigSections ──────────────────────────────────────────────
    it("_loadConfigSections skips when no Config", () => {
        _g.GeoLeaf.Config = undefined;
        LayerManager._loadConfigSections();
        expect(helpers._applyLayerManagerConfig).not.toHaveBeenCalled();
    });

    it("_loadConfigSections applies config when available", () => {
        _g.GeoLeaf.Config = { get: vi.fn(() => ({ title: "Custom" })) };
        _g.GeoLeaf.Log = { debug: vi.fn() };
        LayerManager._loadConfigSections();
        expect(helpers._applyLayerManagerConfig).toHaveBeenCalled();
    });

    it("_loadConfigSections skips when Config.get returns null", () => {
        _g.GeoLeaf.Config = { get: vi.fn(() => null) };
        LayerManager._loadConfigSections();
        expect(helpers._applyLayerManagerConfig).not.toHaveBeenCalled();
    });

    // ── _autoPopulateBasemap ─────────────────────────────────────────────
    it("_autoPopulateBasemap fills empty basemap section", () => {
        LayerManager._options.sections = [{ id: "basemap", items: [] }];
        helpers._resolveBasemapDefs.mockReturnValue({ osm: { id: "osm", label: "OpenStreetMap" } });
        LayerManager._autoPopulateBasemap();
        expect(LayerManager._options.sections[0].items.length).toBe(1);
    });

    it("_autoPopulateBasemap skips when basemap has items", () => {
        LayerManager._options.sections = [{ id: "basemap", items: [{ id: "existing" }] }];
        LayerManager._autoPopulateBasemap();
        expect(LayerManager._options.sections[0].items.length).toBe(1);
    });

    it("_autoPopulateBasemap skips when no basemap section", () => {
        LayerManager._options.sections = [{ id: "other", items: [] }];
        LayerManager._autoPopulateBasemap();
    });

    it("_autoPopulateBasemap skips when sections not array", () => {
        LayerManager._options.sections = null;
        LayerManager._autoPopulateBasemap();
    });

    it("_autoPopulateBasemap handles error in _resolveBasemapDefs", () => {
        LayerManager._options.sections = [{ id: "basemap", items: [] }];
        helpers._resolveBasemapDefs.mockImplementation(() => {
            throw new Error("fail");
        });
        LayerManager._autoPopulateBasemap(); // Should not throw
    });

    // ── _autoPopulateSections ────────────────────────────────────────────
    it("_autoPopulateSections skips when sections exist", () => {
        LayerManager._options.sections = [{ id: "x" }];
        LayerManager._autoPopulateSections();
        expect(helpers._buildAutoBasemapSections).not.toHaveBeenCalled();
    });

    it("_autoPopulateSections auto-populates from Baselayers", () => {
        LayerManager._options.sections = [];
        helpers._buildAutoBasemapSections.mockReturnValue([{ id: "auto", items: [] }]);
        LayerManager._autoPopulateSections();
        expect(LayerManager._options.sections.length).toBe(1);
    });

    it("_autoPopulateSections warns when no auto-sections", () => {
        LayerManager._options.sections = [];
        helpers._buildAutoBasemapSections.mockReturnValue([]);
        LayerManager._autoPopulateSections();
    });

    it("_autoPopulateSections handles exception in _buildAutoBasemapSections", () => {
        LayerManager._options.sections = [];
        helpers._buildAutoBasemapSections.mockImplementation(() => {
            throw new Error("boom");
        });
        LayerManager._autoPopulateSections(); // Should not throw
    });

    // ── _registerGeoJsonLayer ────────────────────────────────────────────
    it("_registerGeoJsonLayer creates new section", () => {
        LayerManager._options.sections = [];
        LayerManager._control = { updateSections: vi.fn() };
        LayerManager._registerGeoJsonLayer("lyr1", { label: "Layer 1" });
        expect(LayerManager._options.sections.length).toBe(1);
        expect(LayerManager._options.sections[0].id).toBe("geojson-default");
    });

    it("_registerGeoJsonLayer uses layerManagerId option", () => {
        LayerManager._options.sections = [];
        LayerManager._control = { updateSections: vi.fn() };
        LayerManager._registerGeoJsonLayer("lyr1", { layerManagerId: "custom" });
        expect(LayerManager._options.sections[0].id).toBe("custom");
    });

    it("_registerGeoJsonLayer uses legendSection fallback", () => {
        LayerManager._options.sections = [];
        LayerManager._control = { updateSections: vi.fn() };
        LayerManager._registerGeoJsonLayer("lyr1", { legendSection: "legSec" });
        expect(LayerManager._options.sections[0].id).toBe("legSec");
    });

    it("_registerGeoJsonLayer does not add duplicate item", () => {
        LayerManager._options.sections = [{ id: "geojson-default", items: [{ id: "lyr1" }] }];
        LayerManager._control = { updateSections: vi.fn() };
        LayerManager._registerGeoJsonLayer("lyr1", {});
        expect(LayerManager._options.sections[0].items.length).toBe(1);
    });

    it("_registerGeoJsonLayer initialises sections array if null", () => {
        LayerManager._options.sections = null;
        LayerManager._control = { updateSections: vi.fn() };
        LayerManager._registerGeoJsonLayer("lyr1", {});
        expect(Array.isArray(LayerManager._options.sections)).toBe(true);
    });

    // ── _unregisterGeoJsonLayer ──────────────────────────────────────────
    it("_updateContent delegates to control.updateSections", () => {
        const updateFn = vi.fn();
        LayerManager._control = { updateSections: updateFn };
        LayerManager._options.sections = [{ id: "x" }];
        LayerManager._updateContent();
        expect(updateFn).toHaveBeenCalledWith([{ id: "x" }]);
    });

    it("_updateContent does nothing when no control", () => {
        LayerManager._control = null;
        LayerManager._updateContent(); // Should not throw
    });

    // ── refresh ──────────────────────────────────────────────────────────
    it("refresh immediate mode calls control.refresh", () => {
        const refreshFn = vi.fn();
        LayerManager._control = { refresh: refreshFn };
        LayerManager.refresh(true);
        expect(refreshFn).toHaveBeenCalled();
    });

    it("refresh debounced mode schedules timeout", () => {
        const refreshFn = vi.fn();
        LayerManager._control = { refresh: refreshFn };
        LayerManager.refresh();
        // Debounced — not called immediately
        expect(refreshFn).not.toHaveBeenCalled();
        expect(LayerManager._refreshTimeout).not.toBeNull();
        clearTimeout(LayerManager._refreshTimeout);
        LayerManager._refreshTimeout = null;
    });

    it("refresh does nothing when no control", () => {
        LayerManager._control = null;
        LayerManager.refresh(); // Should not throw
    });

    it("refresh immediate cancels pending debounce", () => {
        const refreshFn = vi.fn();
        LayerManager._control = { refresh: refreshFn };
        LayerManager._refreshTimeout = setTimeout(() => {}, 1000);
        LayerManager.refresh(true);
        expect(refreshFn).toHaveBeenCalledTimes(1);
    });

    // ── _mergeOptions ────────────────────────────────────────────────────
    it("_mergeOptions shallow merges simple values", () => {
        const result = LayerManager._mergeOptions({ a: 1 }, { b: 2 });
        expect(result).toEqual({ a: 1, b: 2 });
    });

    it("_mergeOptions deep merges objects one level", () => {
        const result = LayerManager._mergeOptions(
            { nested: { a: 1, b: 2 } },
            { nested: { b: 3, c: 4 } }
        );
        expect(result.nested).toEqual({ a: 1, b: 3, c: 4 });
    });

    it("_mergeOptions overwrites arrays", () => {
        const result = LayerManager._mergeOptions({ arr: [1, 2] }, { arr: [3] });
        expect(result.arr).toEqual([3]);
    });

    it("_mergeOptions handles null override", () => {
        const result = LayerManager._mergeOptions({ a: 1 }, null);
        expect(result).toEqual({ a: 1 });
    });

    it("_mergeOptions handles null base", () => {
        const result = LayerManager._mergeOptions(null, { a: 1 });
        expect(result).toEqual({ a: 1 });
    });
});
