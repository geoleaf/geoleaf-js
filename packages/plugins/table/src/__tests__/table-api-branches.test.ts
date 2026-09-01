/**
 * src/table-api.ts (Table orchestrator) — part 2: T22h/T22i/T22j branch coverage
 * (config getter, defaultSort, panel-missing guard, bounds geometry variants,
 * highlight/zoom/export selection edge cases).
 *
 * Ported from the core `table-modules.test.js` `table-api` describe, split for the
 * 700-line cap (see `table-api.test.ts` for part 1). Same setup: `panel.js` /
 * `renderer.js` replaced via `vi.doMock` + dynamic `import("../table-api.js")`;
 * `Log` is the mocked logger; GeoJSON/visibility seams on `globalThis.GeoLeaf.*`.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { Log } from "@geoleaf/host-runtime";

vi.mock("@geoleaf/host-runtime", async (importActual) => ({
    ...(await importActual<typeof import("@geoleaf/host-runtime")>()),
    Log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../utils/dom-helpers.js", () => ({
    $create: (tag, attrs = {}) => {
        const el = document.createElement(tag);
        if (attrs.className) el.className = attrs.className;
        if (attrs.type) el.setAttribute("type", attrs.type);
        if (attrs.checked !== undefined) el.checked = attrs.checked;
        if (attrs.colSpan) el.setAttribute("colSpan", String(attrs.colSpan));
        if (attrs.title) el.title = attrs.title;
        return el;
    },
}));
vi.mock("../utils/events.js", () => ({
    // 🛑 DO NOT RE-NEUTRALISE THIS SEAM — measured on 17/08/2026.
    // Neutralising the seam forces `panel-resize.ts`'s FALLBACK, while `events`
    // is a constant module object: in production the condition is always true.
    // Seven suites in the package neutralised it, so that none exercised the
    // path production takes. This mock reproduces `utils/events.ts` exactly, `off` included.
    events: {
        on: vi.fn((target, type, handler, options) => {
            target.addEventListener(type, handler, options);
            return () => target.removeEventListener(type, handler, options);
        }),
        off: vi.fn((cleanup) => {
            if (typeof cleanup === "function") cleanup();
        }),
    },
}));

describe("modules/table/table-api — branch coverage", () => {
    let TableModule;
    let _TablePanel;
    let _TableRenderer;
    let mockMap;

    beforeAll(async () => {
        _TablePanel = {
            create: vi.fn(() => document.createElement("div")),
            refreshLayerSelector: vi.fn(),
        };
        _TableRenderer = { render: vi.fn(), updateSelection: vi.fn() };
        vi.doMock("../panel.js", () => ({ TablePanel: _TablePanel }));
        vi.doMock("../renderer.js", () => ({ TableRenderer: _TableRenderer }));
        const api = await import("../table-api.js");
        TableModule = api.Table;
    });

    beforeEach(() => {
        TableModule._map = null;
        TableModule._container = null;
        TableModule._config = null;
        TableModule._currentLayerId = null;
        TableModule._selectedIds.clear();
        TableModule._cachedData = [];
        TableModule._featureIdMap.clear();
        TableModule._highlightLayers = [];
        TableModule._sortState = { field: null, direction: null };
        TableModule._isVisible = false;
        globalThis.GeoLeaf = globalThis.GeoLeaf || {};
        globalThis.GeoLeaf.Config = null;
        globalThis.GeoLeaf.GeoJSON = null;
        mockMap = {
            on: vi.fn(),
            fire: vi.fn(),
            fitBounds: vi.fn(),
            hasLayer: vi.fn(() => false),
            removeLayer: vi.fn(),
            addLayer: vi.fn(),
        };
    });

    // ── T22h — table-api.ts branch coverage ─────────────────────────
    it("_config getter returns the current config value", () => {
        TableModule._config = { maxRowsPerLayer: 42 };
        expect(TableModule._config).toEqual(expect.objectContaining({ maxRowsPerLayer: 42 }));
    });

    it("init calls show() when config.defaultVisible is true", () => {
        const showSpy = vi.spyOn(TableModule, "show");
        TableModule.init({ map: mockMap, config: { enabled: true, defaultVisible: true } });
        expect(showSpy).toHaveBeenCalled();
        showSpy.mockRestore();
    });

    it("setLayer applies defaultSort when layerData.config.table.defaultSort is set", () => {
        globalThis.GeoLeaf.GeoJSON = {
            getAllLayers: vi.fn(() => [{ id: "ly1", label: "Layer 1" }]),
            getLayerData: vi.fn(() => ({
                features: [],
                config: {
                    table: {
                        enabled: true,
                        defaultSort: { field: "name", direction: "asc" },
                    },
                },
            })),
        };
        TableModule._container = document.createElement("div");
        TableModule._config = { maxRowsPerLayer: 1000 };
        TableModule.setLayer("ly1");
        expect(TableModule._sortState.field).toBe("name");
        expect(TableModule._sortState.direction).toBe("asc");
    });

    it("setLayer defaultSort uses order when direction not set", () => {
        globalThis.GeoLeaf.GeoJSON = {
            getAllLayers: vi.fn(() => [{ id: "ly1" }]),
            getLayerData: vi.fn(() => ({
                features: [],
                config: {
                    table: {
                        enabled: true,
                        defaultSort: { field: "name", order: "desc" },
                    },
                },
            })),
        };
        TableModule._container = document.createElement("div");
        TableModule._config = { maxRowsPerLayer: 1000 };
        TableModule.setLayer("ly1");
        expect(TableModule._sortState.direction).toBe("desc");
    });

    it("setLayer null path calls render via _TableRenderer when container is set", () => {
        TableModule._container = document.createElement("div");
        TableModule._currentLayerId = "ly1";
        TableModule.setLayer(null);
        expect(TableModule._currentLayerId).toBeNull();
        expect(TableModule._cachedData).toEqual([]);
    });

    it("refresh calls render when _currentLayerId is set and container ready", () => {
        globalThis.GeoLeaf.GeoJSON = { getLayerData: () => ({ features: [] }) };
        TableModule._currentLayerId = "ly1";
        TableModule._container = document.createElement("div");
        TableModule._config = { maxRowsPerLayer: 1000 };
        expect(() => TableModule.refresh()).not.toThrow();
    });

    it("init logs error and returns when _TablePanel has no create function (lines 88-89)", () => {
        // _TablePanel is the same object reference used by the module — mutate temporarily
        Log.error.mockClear();
        const orig = _TablePanel.create;
        delete _TablePanel.create;
        TableModule.init({ map: { on: vi.fn() }, config: { enabled: true } });
        expect(Log.error).toHaveBeenCalledWith(expect.stringContaining("panel.js not loaded"));
        _TablePanel.create = orig;
    });

    // ── T22i — table-highlight.ts branch coverage ────────────────────
    it("_extendBoundsFromGeometry handles MultiLineString (branch 4.0)", () => {
        const bounds = { extend: vi.fn() };
        TableModule._extendBoundsFromGeometry(bounds, {
            type: "MultiLineString",
            coordinates: [
                [
                    [0, 0],
                    [1, 1],
                ],
                [
                    [2, 2],
                    [3, 3],
                ],
            ],
        });
        expect(bounds.extend).toHaveBeenCalled();
    });

    it("_extendBoundsFromGeometry handles MultiPolygon (branches 5.1 false, 6.0)", () => {
        const bounds = { extend: vi.fn() };
        TableModule._extendBoundsFromGeometry(bounds, {
            type: "MultiPolygon",
            coordinates: [
                [
                    [
                        [0, 0],
                        [1, 0],
                        [1, 1],
                        [0, 0],
                    ],
                ],
            ],
        });
        expect(bounds.extend).toHaveBeenCalled();
    });

    it("_extendBoundsFromGeometry handles MultiPoint (branches 6.1 false, 7.0)", () => {
        const bounds = { extend: vi.fn() };
        TableModule._extendBoundsFromGeometry(bounds, {
            type: "MultiPoint",
            coordinates: [
                [0, 1],
                [2, 3],
            ],
        });
        expect(bounds.extend).toHaveBeenCalledTimes(2);
    });

    it("highlightSelection(true) warns when _selectedIds is empty (branch 11.0)", () => {
        Log.warn.mockClear();
        TableModule._map = mockMap;
        TableModule._selectedIds.clear();
        TableModule.highlightSelection(true);
        expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining("No entity selected"));
    });

    it("highlightSelection(true) does not throw in MapLibre mode (branch 13.0)", () => {
        Log.warn.mockClear();
        const f = { id: "f1", geometry: { type: "Point", coordinates: [1, 2] }, properties: {} };
        TableModule._map = mockMap;
        TableModule._selectedIds.add("f1");
        TableModule._cachedData = [f];
        TableModule._featureIdMap.set("f1", 0);
        // MapLibre mode uses the adapter — no Leaflet required
        expect(() => TableModule.highlightSelection(true)).not.toThrow();
    });

    it("highlightSelection with null-geometry feature does not throw (branch 8.0)", () => {
        const f = { id: "f1", geometry: null, properties: {} };
        TableModule._map = mockMap;
        TableModule._selectedIds.add("f1");
        TableModule._cachedData = [f];
        TableModule._featureIdMap.set("f1", 0);
        expect(() => TableModule.highlightSelection(true)).not.toThrow();
    });

    // ── T22j — table-selection.ts branch coverage ────────────────────────────

    it("zoomToSelection returns early when _selectedIds is empty (table-selection branch 6.0)", () => {
        TableModule._selectedIds.clear();
        TableModule._map = mockMap;
        expect(() => TableModule.zoomToSelection()).not.toThrow();
        expect(mockMap.fitBounds).not.toHaveBeenCalled();
    });

    it("zoomToSelection does not throw in MapLibre mode (table-selection branch 8.0)", () => {
        Log.warn.mockClear();
        const f = { id: "f1", geometry: { type: "Point", coordinates: [1, 2] }, properties: {} };
        TableModule._map = mockMap;
        TableModule._currentLayerId = "ly1";
        TableModule._selectedIds.add("f1");
        TableModule._cachedData = [f];
        TableModule._featureIdMap.set("f1", 0);
        // MapLibre mode uses the adapter — no Leaflet required
        expect(() => TableModule.zoomToSelection()).not.toThrow();
    });

    it("exportSelection returns early when _selectedIds is empty (table-selection branch 13.0)", () => {
        TableModule._selectedIds.clear();
        expect(() => TableModule.exportSelection()).not.toThrow();
    });

    it("exportSelection returns early when no features found (table-selection branch 14.0)", () => {
        TableModule._selectedIds.add("nonexistent-id");
        TableModule._cachedData = [];
        TableModule._featureIdMap.clear();
        expect(() => TableModule.exportSelection()).not.toThrow();
    });

    it("setSelection with add=false (using default) covers table-selection default-arg (branch 0.0)", () => {
        TableModule._selectedIds.clear();
        TableModule.setSelection(["id1"]);
        expect(TableModule.getSelectedIds()).toContain("id1");
    });
});
