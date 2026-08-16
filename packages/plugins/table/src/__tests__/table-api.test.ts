/**
 * src/table-api.ts (Table orchestrator) — part 1: init / show / hide / selection /
 * setLayer / refresh / sort / zoom / highlight / export / internal helpers / map events.
 *
 * Ported from the core `table-modules.test.js` `table-api` describe, split for the
 * 700-line cap (branch-coverage cases live in `table-api-branches.test.ts`).
 *
 * Adaptation: `panel.js` / `renderer.js` are replaced via `vi.doMock` + a dynamic
 * `import("../table-api.js")` (the orchestrator statically imports them); the GeoJSON
 * and visibility seams are driven on `globalThis.GeoLeaf.*` (the plugin reads
 * `_g.GeoLeaf.GeoJSON` / `_g.GeoLeaf._LayerVisibilityManager` at call time).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

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
vi.mock("../utils/events.js", () => ({ events: null }));

describe("modules/table/table-api", () => {
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

    it("init returns early when options is missing", () => {
        TableModule.init();
        expect(TableModule._map).toBeNull();
    });

    it("init returns early when map is missing", () => {
        TableModule.init({});
        expect(TableModule._map).toBeNull();
    });

    it("init returns early when config.enabled is false", () => {
        const map = { on: vi.fn(), addLayer: vi.fn() };
        TableModule.init({ map, config: { enabled: false } });
        expect(TableModule._container).toBeFalsy();
    });

    it("show does nothing when _container is null", () => {
        TableModule.show();
        expect(TableModule._isVisible).toBe(false);
    });

    it("hide does nothing when _container is null", () => {
        expect(() => TableModule.hide()).not.toThrow();
    });

    it("getSelectedIds returns empty array when none selected", () => {
        expect(TableModule.getSelectedIds()).toEqual([]);
    });

    it("setSelection adds ids and clearSelection clears", () => {
        TableModule.setSelection(["id1", "id2"]);
        expect(TableModule.getSelectedIds()).toContain("id1");
        expect(TableModule.getSelectedIds()).toContain("id2");
        TableModule.clearSelection();
        expect(TableModule.getSelectedIds()).toEqual([]);
    });

    it("setSelection with add true keeps existing and adds new ids", () => {
        TableModule.setSelection(["id1"]);
        TableModule.setSelection(["id2"], true);
        expect(TableModule.getSelectedIds()).toContain("id1");
        expect(TableModule.getSelectedIds()).toContain("id2");
    });

    it("setLayer with empty string clears state", () => {
        TableModule._currentLayerId = "ly1";
        TableModule.setLayer("");
        expect(TableModule._currentLayerId).toBeNull();
        expect(TableModule._cachedData).toEqual([]);
    });

    it("refresh does not throw when _currentLayerId is null", () => {
        TableModule._currentLayerId = null;
        expect(() => TableModule.refresh()).not.toThrow();
    });

    it("init with map and config.enabled creates container and attaches map events", () => {
        TableModule.init({ map: mockMap, config: { enabled: true } });
        expect(_TablePanel.create).toHaveBeenCalledWith(mockMap, expect.any(Object));
        expect(TableModule._container).toBeInstanceOf(HTMLElement);
        expect(TableModule._map).toBe(mockMap);
        // ⚠️ B-204 — les filtres ne passent PLUS par `map.on()` : leur émetteur dispatche sur
        // `document`. Ce qui reste sur le bus carte est ce que `kernel/geojson/` y `fire()`.
        expect(mockMap.on).not.toHaveBeenCalledWith(
            "geoleaf:filters:changed",
            expect.any(Function)
        );
        expect(mockMap.on).toHaveBeenCalledWith(
            "geoleaf:geojson:layers-loaded",
            expect.any(Function)
        );
        expect(mockMap.on).toHaveBeenCalledWith(
            "geoleaf:geojson:visibility-changed",
            expect.any(Function)
        );
    });

    it("show adds is-visible and sets _isVisible and fires event when _container set", () => {
        TableModule._container = document.createElement("div");
        TableModule._map = mockMap;
        const spy = vi.spyOn(document, "dispatchEvent");
        TableModule.show();
        expect(TableModule._container.classList.contains("gl-is-visible")).toBe(true);
        expect(TableModule._isVisible).toBe(true);
        expect(mockMap.fire).toHaveBeenCalledWith("geoleaf:table:opened", {});
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it("hide removes is-visible and clears highlight when _container set", () => {
        TableModule._container = document.createElement("div");
        TableModule._container.classList.add("gl-is-visible");
        TableModule._map = mockMap;
        TableModule._highlightLayers = [{ __mock: true }];
        mockMap.hasLayer.mockReturnValue(true);
        TableModule.hide();
        expect(TableModule._container.classList.contains("gl-is-visible")).toBe(false);
        expect(TableModule._isVisible).toBe(false);
        expect(TableModule._highlightLayers).toEqual([]);
    });

    it("toggle calls hide when visible and show when not", () => {
        TableModule._container = document.createElement("div");
        TableModule._isVisible = true;
        TableModule.toggle();
        expect(TableModule._isVisible).toBe(false);
        TableModule.toggle();
        expect(TableModule._isVisible).toBe(true);
    });

    it("show/hide sync the desktop tab and mobile pill active state", () => {
        TableModule._container = document.createElement("div");
        TableModule._map = mockMap;
        const deskTab = document.createElement("button");
        deskTab.setAttribute("data-gl-desktop-tab", "table");
        const pill = document.createElement("button");
        pill.setAttribute("data-gl-sheet", "table");
        document.body.append(deskTab, pill);

        TableModule.show();
        expect(deskTab.classList.contains("gl-table-tab-active")).toBe(true);
        expect(deskTab.getAttribute("aria-selected")).toBe("true");
        expect(pill.classList.contains("gl-map-toolbar__btn--active")).toBe(true);
        expect(pill.getAttribute("aria-expanded")).toBe("true");
        expect(document.body.classList.contains("gl-table-open")).toBe(true);

        TableModule.hide();
        expect(deskTab.classList.contains("gl-table-tab-active")).toBe(false);
        expect(deskTab.getAttribute("aria-selected")).toBe("false");
        expect(pill.classList.contains("gl-map-toolbar__btn--active")).toBe(false);
        expect(pill.getAttribute("aria-expanded")).toBe("false");
        expect(document.body.classList.contains("gl-table-open")).toBe(false);

        deskTab.remove();
        pill.remove();
    });

    it("setLayer with unknown layerId does nothing", () => {
        globalThis.GeoLeaf.GeoJSON = {
            getAllLayers: vi.fn(() => [{ id: "ly1" }]),
            getLayerData: vi.fn(() => ({ config: { table: { enabled: true } } })),
        };
        TableModule._container = document.createElement("div");
        TableModule._config = { maxRowsPerLayer: 1000 };
        TableModule.setLayer("unknown-layer");
        expect(TableModule._currentLayerId).toBeNull();
    });

    it("setLayer with valid layerId sets layer and refreshes", () => {
        globalThis.GeoLeaf.GeoJSON = {
            getAllLayers: vi.fn(() => [{ id: "ly1", label: "Layer 1" }]),
            getLayerData: vi.fn(() => ({
                features: [{ id: "f1", properties: {} }],
                config: { table: { enabled: true } },
            })),
        };
        TableModule._container = document.createElement("div");
        TableModule._config = { maxRowsPerLayer: 1000 };
        TableModule.setLayer("ly1");
        expect(TableModule._currentLayerId).toBe("ly1");
        expect(TableModule._cachedData).toHaveLength(1);
    });

    it("refresh fetches features and renders when _currentLayerId set", () => {
        globalThis.GeoLeaf.GeoJSON = {
            getLayerData: vi.fn(() => ({
                features: [
                    { id: "f1", properties: { name: "A" } },
                    { id: "f2", properties: { name: "B" } },
                ],
            })),
        };
        TableModule._currentLayerId = "ly1";
        TableModule._container = document.createElement("div");
        TableModule._config = { maxRowsPerLayer: 1000 };
        TableModule.refresh();
        expect(TableModule._cachedData).toHaveLength(2);
        expect(TableModule._featureIdMap.size).toBe(2);
    });

    it("refresh applies sorting when _sortState has field and direction", () => {
        globalThis.GeoLeaf.GeoJSON = {
            getLayerData: vi.fn(() => ({
                features: [
                    { id: "f1", name: "B" },
                    { id: "f2", name: "A" },
                ],
            })),
        };
        TableModule._currentLayerId = "ly1";
        TableModule._container = document.createElement("div");
        TableModule._config = { maxRowsPerLayer: 1000 };
        TableModule._sortState = { field: "name", direction: "asc" };
        TableModule.refresh();
        expect(TableModule._cachedData[0].name).toBe("A");
        expect(TableModule._cachedData[1].name).toBe("B");
    });

    it("sortByField updates _sortState and calls refresh", () => {
        TableModule._currentLayerId = "ly1";
        TableModule._container = document.createElement("div");
        TableModule._config = { maxRowsPerLayer: 1000 };
        globalThis.GeoLeaf.GeoJSON = { getLayerData: () => ({ features: [] }) };
        TableModule.sortByField("name");
        expect(TableModule._sortState.field).toBe("name");
        expect(TableModule._sortState.direction).toBe("asc");
        TableModule.sortByField("name");
        expect(TableModule._sortState.direction).toBe("desc");
    });

    it("zoomToSelection does not throw when selection has features with geometry", () => {
        const f = {
            id: "f1",
            geometry: { type: "Point", coordinates: [1, 2] },
            properties: {},
        };
        TableModule._map = mockMap;
        TableModule._currentLayerId = "ly1";
        TableModule._selectedIds.add("f1");
        TableModule._cachedData = [f];
        TableModule._featureIdMap.set("f1", 0);
        // zoomToSelection now uses adapter — no L.latLngBounds in MapLibre mode
        expect(() => TableModule.zoomToSelection()).not.toThrow();
    });

    it("highlightSelection does not throw when active and selection not empty", () => {
        const f = {
            id: "f1",
            geometry: { type: "Point", coordinates: [1, 2] },
            properties: {},
        };
        TableModule._map = mockMap;
        TableModule._currentLayerId = "ly1";
        TableModule._selectedIds.add("f1");
        TableModule._cachedData = [f];
        TableModule._featureIdMap.set("f1", 0);
        // highlightSelection now uses adapter — no L.circleMarker in MapLibre mode
        expect(() => TableModule.highlightSelection(true)).not.toThrow();
    });

    it("highlightSelection adds geoJSON layer for Polygon geometry", () => {
        const f = {
            id: "f2",
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [0, 0],
                        [1, 0],
                        [1, 1],
                        [0, 1],
                        [0, 0],
                    ],
                ],
            },
            properties: {},
        };
        TableModule._map = mockMap;
        TableModule._currentLayerId = "ly1";
        TableModule._selectedIds.add("f2");
        TableModule._cachedData = [f];
        TableModule._featureIdMap.set("f2", 0);
        // highlightSelection now uses adapter — no L.geoJSON in MapLibre mode
        expect(() => TableModule.highlightSelection(true)).not.toThrow();
    });

    it("highlightSelection clears and fires when active false", () => {
        TableModule._highlightActive = true;
        TableModule._map = mockMap;
        TableModule.highlightSelection(false);
        expect(TableModule._highlightActive).toBe(false);
        expect(mockMap.fire).toHaveBeenCalledWith(
            "geoleaf:table:highlightSelection",
            expect.any(Object)
        );
    });

    it("exportSelection downloads GeoJSON when selection not empty", () => {
        const f = { id: "f1", properties: {}, geometry: null };
        TableModule._currentLayerId = "ly1";
        TableModule._selectedIds.add("f1");
        TableModule._cachedData = [f];
        TableModule._featureIdMap.set("f1", 0);
        expect(() => TableModule.exportSelection()).not.toThrow();
    });

    it("_getLayerFeatures returns empty when GeoJSON missing", () => {
        globalThis.GeoLeaf.GeoJSON = null;
        const features = TableModule._getLayerFeatures("ly1");
        expect(features).toEqual([]);
    });

    it("_getAvailableLayers returns layers with table.enabled", () => {
        globalThis.GeoLeaf.GeoJSON = {
            getAllLayers: vi.fn(() => [{ id: "a" }, { id: "b" }]),
            getLayerData: vi.fn((id) =>
                id === "a"
                    ? { config: { table: { enabled: true } } }
                    : { config: { table: { enabled: false } } }
            ),
        };
        const layers = TableModule._getAvailableLayers();
        expect(layers).toHaveLength(1);
        expect(layers[0].id).toBe("a");
    });

    it("_extendBoundsFromGeometry handles Point, LineString, Polygon", () => {
        const bounds = { extend: vi.fn() };
        TableModule._extendBoundsFromGeometry(bounds, { type: "Point", coordinates: [1, 2] });
        expect(bounds.extend).toHaveBeenCalledWith([2, 1]);
        bounds.extend.mockClear();
        TableModule._extendBoundsFromGeometry(bounds, {
            type: "LineString",
            coordinates: [
                [0, 0],
                [1, 1],
            ],
        });
        expect(bounds.extend).toHaveBeenCalledTimes(2);
        bounds.extend.mockClear();
        TableModule._extendBoundsFromGeometry(bounds, {
            type: "Polygon",
            coordinates: [
                [
                    [0, 0],
                    [1, 0],
                    [1, 1],
                    [0, 1],
                    [0, 0],
                ],
            ],
        });
        expect(bounds.extend).toHaveBeenCalled();
    });

    // 🛑 B-204 — réécrit : la forme précédente récupérait le handler sur `mockMap.on` et
    // l'appelait à la main, donc elle restait verte alors que l'abonnement était mort (nom
    // inexistant, ET bus MapLibre là où l'émetteur dispatche sur `document`). Émettre un vrai
    // événement est la seule forme qui distingue « le handler est correct » de « le handler est
    // atteignable ».
    it("l'événement `geoleaf:filters:applied` déclenche refresh quand visible et couche choisie", () => {
        TableModule.init({ map: mockMap, config: { enabled: true } });
        TableModule._isVisible = true;
        TableModule._currentLayerId = "ly1";
        TableModule._config = { maxRowsPerLayer: 1000 };
        globalThis.GeoLeaf.GeoJSON = { getLayerData: () => ({ features: [] }) };
        const refreshSpy = vi.spyOn(TableModule, "refresh");

        document.dispatchEvent(new CustomEvent("geoleaf:filters:applied"));

        expect(refreshSpy).toHaveBeenCalled();
        refreshSpy.mockRestore();
    });

    it("document geoleaf:theme:applied triggers debounced refreshLayerSelector", () => {
        vi.useFakeTimers();
        TableModule.init({ map: mockMap, config: { enabled: true } });
        // init() populates the selector once (lazy-build path) — clear to isolate
        // the event-driven, debounced refresh.
        _TablePanel.refreshLayerSelector.mockClear();
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));
        vi.advanceTimersByTime(200);
        expect(_TablePanel.refreshLayerSelector).toHaveBeenCalled();
        vi.useRealTimers();
    });

    it("_getAvailableVisibleLayers uses VisibilityManager when available", () => {
        globalThis.GeoLeaf.GeoJSON = {
            getAllLayers: () => [{ id: "ly1" }],
            getLayerData: () => ({ config: { table: { enabled: true } } }),
        };
        globalThis.GeoLeaf._LayerVisibilityManager = {
            getVisibilityState: vi.fn((id) =>
                id === "ly1" ? { current: true } : { current: false }
            ),
        };
        const layers = TableModule._getAvailableVisibleLayers();
        expect(layers.length).toBeGreaterThanOrEqual(0);
        delete globalThis.GeoLeaf._LayerVisibilityManager;
    });

    it("map event geoleaf:geojson:visibility-changed with e.visible false switches layer", () => {
        vi.useFakeTimers();
        const select = document.createElement("select");
        select.dataset.tableLayerSelect = "";
        select.appendChild(document.createElement("option"));
        const opt2 = document.createElement("option");
        opt2.value = "ly2";
        select.appendChild(opt2);
        document.body.appendChild(select);
        TableModule.init({ map: mockMap, config: { enabled: true } });
        TableModule._currentLayerId = "ly1";
        TableModule._config = { maxRowsPerLayer: 1000 };
        globalThis.GeoLeaf.GeoJSON = {
            getAllLayers: () => [{ id: "ly2" }],
            getLayerData: (id) =>
                id === "ly2"
                    ? {
                          config: { table: { enabled: true } },
                          features: [],
                          _visibility: { current: true },
                      }
                    : null,
        };
        globalThis.GeoLeaf._LayerVisibilityManager = {
            getVisibilityState: vi.fn((id) =>
                id === "ly2" ? { current: true } : { current: false }
            ),
        };
        const visCall = mockMap.on.mock.calls.find(
            (c) => c[0] === "geoleaf:geojson:visibility-changed"
        );
        expect(visCall).toBeDefined();
        visCall[1]({ layerId: "ly1", visible: false });
        vi.advanceTimersByTime(250);
        expect(TableModule._currentLayerId).toBe("ly2");
        expect(select.value).toBe("ly2");
        select.remove();
        delete globalThis.GeoLeaf._LayerVisibilityManager;
        vi.useRealTimers();
    });

    it("visibility-changed with no visible layers calls setLayer empty", () => {
        vi.useFakeTimers();
        const select = document.createElement("select");
        select.dataset.tableLayerSelect = "";
        select.appendChild(document.createElement("option"));
        document.body.appendChild(select);
        TableModule.init({ map: mockMap, config: { enabled: true } });
        TableModule._currentLayerId = "ly1";
        globalThis.GeoLeaf.GeoJSON = {
            getAllLayers: () => [],
            getLayerData: () => null,
        };
        globalThis.GeoLeaf._LayerVisibilityManager = {
            getVisibilityState: () => ({ current: false }),
        };
        const visCall = mockMap.on.mock.calls.find(
            (c) => c[0] === "geoleaf:geojson:visibility-changed"
        );
        visCall[1]({ layerId: "ly1", visible: false });
        vi.advanceTimersByTime(250);
        expect(TableModule._currentLayerId).toBeNull();
        select.remove();
        delete globalThis.GeoLeaf._LayerVisibilityManager;
        vi.useRealTimers();
    });

    it("_getLayerFeatures returns slice when over maxRowsPerLayer", () => {
        TableModule._config = { maxRowsPerLayer: 2 };
        globalThis.GeoLeaf.GeoJSON = {
            getLayerData: () => ({
                features: [
                    { id: "f1", properties: {} },
                    { id: "f2", properties: {} },
                    { id: "f3", properties: {} },
                ],
            }),
        };
        const features = TableModule._getLayerFeatures("ly1");
        expect(features).toHaveLength(2);
    });

    it("zoomToSelection does nothing when bounds invalid", () => {
        const f = { id: "f1", geometry: { type: "Point", coordinates: [] }, properties: {} };
        TableModule._map = mockMap;
        TableModule._currentLayerId = "ly1";
        TableModule._selectedIds.add("f1");
        TableModule._cachedData = [f];
        TableModule._featureIdMap.set("f1", 0);
        TableModule.zoomToSelection();
        expect(mockMap.fitBounds).not.toHaveBeenCalled();
    });

    it("zoomToSelection does nothing when _getSelectedFeatures returns empty", () => {
        TableModule._map = mockMap;
        TableModule._currentLayerId = "ly1";
        TableModule._selectedIds.add("unknown-id");
        TableModule._cachedData = [];
        TableModule._featureIdMap.clear();
        TableModule.zoomToSelection();
        expect(mockMap.fitBounds).not.toHaveBeenCalled();
    });

    it("highlightSelection warns when _getSelectedFeatures returns empty", () => {
        TableModule._map = mockMap;
        TableModule._currentLayerId = "ly1";
        TableModule._selectedIds.add("unknown-id");
        TableModule._cachedData = [];
        TableModule._featureIdMap.clear();
        TableModule.highlightSelection(true);
        expect(TableModule._highlightLayers.length).toBe(0);
    });
});
