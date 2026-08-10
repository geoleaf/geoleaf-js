/**
 * Branch-coverage companion for src/table-layer.ts
 * Covers: getLayerFeatures, getAvailableLayers, getAvailableVisibleLayers, attachMapEvents
 *
 * Ported from the core suite (`__tests__/table/table-layer-branches.test.js`).
 * Adaptation: import paths point at the plugin's flat `src/` layout; the GeoJSON /
 * visibility seams are driven on the mocked `_g.GeoLeaf.*` (unchanged — the core
 * already read these through the runtime seam).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@geoleaf/host-runtime", async (importActual) => ({
    ...(await importActual<typeof import("@geoleaf/host-runtime")>()),
    Log: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock("../table-state.js", () => ({
    tableState: {
        _config: null,
        _map: null,
        _isVisible: false,
        _currentLayerId: null,
    },
    _g: { GeoLeaf: {} },
}));

vi.mock("../panel.js", () => ({
    TablePanel: { refreshLayerSelector: vi.fn() },
}));

import {
    getLayerFeatures,
    getAvailableLayers,
    getAvailableVisibleLayers,
    attachMapEvents,
} from "../table-layer.js";
import { tableState, _g } from "../table-state.js";
import { TablePanel } from "../panel.js";

describe("table/table-layer.ts — branch coverage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        _g.GeoLeaf = {};
        tableState._config = null;
        tableState._map = null;
        tableState._isVisible = false;
        tableState._currentLayerId = null;
    });

    // ── getLayerFeatures ──────────────────────────────────────────

    describe("getLayerFeatures", () => {
        it("returns [] when GeoJSON is missing", () => {
            _g.GeoLeaf.GeoJSON = undefined;
            expect(getLayerFeatures("x")).toEqual([]);
        });

        it("returns [] when getLayerData is not a function", () => {
            _g.GeoLeaf.GeoJSON = { getLayerData: "not-fn" };
            expect(getLayerFeatures("x")).toEqual([]);
        });

        it("returns [] when layerData is null", () => {
            _g.GeoLeaf.GeoJSON = { getLayerData: vi.fn(() => null) };
            expect(getLayerFeatures("x")).toEqual([]);
        });

        it("returns [] when layerData.features is missing", () => {
            _g.GeoLeaf.GeoJSON = { getLayerData: vi.fn(() => ({})) };
            expect(getLayerFeatures("x")).toEqual([]);
        });

        it("returns all features when under maxRows", () => {
            const features = [{ id: 1 }, { id: 2 }];
            _g.GeoLeaf.GeoJSON = { getLayerData: vi.fn(() => ({ features })) };
            expect(getLayerFeatures("x")).toEqual(features);
        });

        it("slices features when exceeding default maxRows (1000)", () => {
            const features = Array.from({ length: 1500 }, (_, i) => ({ id: i }));
            _g.GeoLeaf.GeoJSON = { getLayerData: vi.fn(() => ({ features })) };
            expect(getLayerFeatures("x")).toHaveLength(1000);
        });

        it("uses config maxRowsPerLayer when set", () => {
            tableState._config = { maxRowsPerLayer: 5 };
            const features = Array.from({ length: 10 }, (_, i) => ({ id: i }));
            _g.GeoLeaf.GeoJSON = { getLayerData: vi.fn(() => ({ features })) };
            expect(getLayerFeatures("x")).toHaveLength(5);
        });

        it("uses config maxRowsPerLayer = 0 falls back to 1000 (falsy)", () => {
            tableState._config = { maxRowsPerLayer: 0 };
            const features = Array.from({ length: 10 }, (_, i) => ({ id: i }));
            _g.GeoLeaf.GeoJSON = { getLayerData: vi.fn(() => ({ features })) };
            expect(getLayerFeatures("x")).toHaveLength(10);
        });
    });

    // ── getAvailableLayers ────────────────────────────────────────

    describe("getAvailableLayers", () => {
        it("returns [] when GeoJSON is missing", () => {
            _g.GeoLeaf.GeoJSON = undefined;
            expect(getAvailableLayers()).toEqual([]);
        });

        it("returns [] when getAllLayers is not a function", () => {
            _g.GeoLeaf.GeoJSON = { getAllLayers: "not-fn" };
            expect(getAvailableLayers()).toEqual([]);
        });

        it("returns layers with table.enabled = true", () => {
            _g.GeoLeaf.GeoJSON = {
                getAllLayers: vi.fn(() => [{ id: "a", label: "A" }, { id: "b" }]),
                getLayerData: vi.fn((id) => {
                    if (id === "a") return { config: { table: { enabled: true } } };
                    return { config: {} };
                }),
            };
            const result = getAvailableLayers();
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe("a");
        });

        it("uses layer.id when label is missing", () => {
            _g.GeoLeaf.GeoJSON = {
                getAllLayers: vi.fn(() => [{ id: "b" }]),
                getLayerData: vi.fn(() => ({ config: { table: { enabled: true } } })),
            };
            expect(getAvailableLayers()[0].label).toBe("b");
        });

        it("skips layers with null layerData", () => {
            _g.GeoLeaf.GeoJSON = {
                getAllLayers: vi.fn(() => [{ id: "x" }]),
                getLayerData: vi.fn(() => null),
            };
            expect(getAvailableLayers()).toEqual([]);
        });

        it("skips layers with no config", () => {
            _g.GeoLeaf.GeoJSON = {
                getAllLayers: vi.fn(() => [{ id: "x" }]),
                getLayerData: vi.fn(() => ({ config: null })),
            };
            expect(getAvailableLayers()).toEqual([]);
        });

        it("skips layers with table.enabled = false", () => {
            _g.GeoLeaf.GeoJSON = {
                getAllLayers: vi.fn(() => [{ id: "x" }]),
                getLayerData: vi.fn(() => ({ config: { table: { enabled: false } } })),
            };
            expect(getAvailableLayers()).toEqual([]);
        });
    });

    // ── getAvailableVisibleLayers ─────────────────────────────────

    describe("getAvailableVisibleLayers", () => {
        function setupLayers() {
            _g.GeoLeaf.GeoJSON = {
                getAllLayers: vi.fn(() => [{ id: "a", label: "A" }]),
                getLayerData: vi.fn((id) => {
                    if (id === "a")
                        return {
                            config: { table: { enabled: true } },
                            _visibility: { current: true },
                        };
                    return null;
                }),
            };
        }

        it("uses VisibilityManager when available", () => {
            setupLayers();
            _g.GeoLeaf._LayerVisibilityManager = {
                getVisibilityState: vi.fn(() => ({ current: true })),
            };
            expect(getAvailableVisibleLayers()).toHaveLength(1);
        });

        it("filters out invisible layers via VisibilityManager", () => {
            setupLayers();
            _g.GeoLeaf._LayerVisibilityManager = {
                getVisibilityState: vi.fn(() => ({ current: false })),
            };
            expect(getAvailableVisibleLayers()).toHaveLength(0);
        });

        it("handles null from VisibilityManager", () => {
            setupLayers();
            _g.GeoLeaf._LayerVisibilityManager = {
                getVisibilityState: vi.fn(() => null),
            };
            expect(getAvailableVisibleLayers()).toHaveLength(0);
        });

        it("falls back to layerData._visibility when no VisibilityManager", () => {
            setupLayers();
            _g.GeoLeaf._LayerVisibilityManager = undefined;
            expect(getAvailableVisibleLayers()).toHaveLength(1);
        });

        it("falls back: hidden when _visibility.current is false", () => {
            _g.GeoLeaf.GeoJSON = {
                getAllLayers: vi.fn(() => [{ id: "a", label: "A" }]),
                getLayerData: vi.fn(() => ({
                    config: { table: { enabled: true } },
                    _visibility: { current: false },
                })),
            };
            _g.GeoLeaf._LayerVisibilityManager = undefined;
            expect(getAvailableVisibleLayers()).toHaveLength(0);
        });

        it("falls back: hidden when layerData is null", () => {
            let getLayerDataCallCount = 0;
            _g.GeoLeaf.GeoJSON = {
                getAllLayers: vi.fn(() => [{ id: "a", label: "A" }]),
                getLayerData: vi.fn(() => {
                    // First call in getAvailableLayers returns table-enabled
                    // Second call in filter should return null
                    if (getLayerDataCallCount++ === 0)
                        return { config: { table: { enabled: true } } };
                    return null;
                }),
            };
            _g.GeoLeaf._LayerVisibilityManager = undefined;
            expect(getAvailableVisibleLayers()).toHaveLength(0);
        });
    });

    // ── attachMapEvents ───────────────────────────────────────────

    describe("attachMapEvents", () => {
        it("returns early when map is null", () => {
            tableState._map = null;
            const refresh = vi.fn();
            const setLayer = vi.fn();
            attachMapEvents(refresh, setLayer);
            // No error
        });

        it("attaches event listeners on map", () => {
            const onFn = vi.fn();
            tableState._map = { on: onFn };
            attachMapEvents(vi.fn(), vi.fn());
            expect(onFn).toHaveBeenCalledTimes(3);
        });

        it("filters:changed calls refresh when visible and has layerId", () => {
            const onFn = vi.fn();
            tableState._map = { on: onFn };
            tableState._isVisible = true;
            tableState._currentLayerId = "layer1";
            const refreshCb = vi.fn();
            attachMapEvents(refreshCb, vi.fn());
            // Find the filters:changed handler
            const filtersHandler = onFn.mock.calls.find(
                (c) => c[0] === "geoleaf:filters:changed"
            )[1];
            filtersHandler();
            expect(refreshCb).toHaveBeenCalled();
        });

        it("filters:changed does not call refresh when not visible", () => {
            const onFn = vi.fn();
            tableState._map = { on: onFn };
            tableState._isVisible = false;
            const refreshCb = vi.fn();
            attachMapEvents(refreshCb, vi.fn());
            const filtersHandler = onFn.mock.calls.find(
                (c) => c[0] === "geoleaf:filters:changed"
            )[1];
            filtersHandler();
            expect(refreshCb).not.toHaveBeenCalled();
        });

        it("filters:changed does not call refresh when no currentLayerId", () => {
            const onFn = vi.fn();
            tableState._map = { on: onFn };
            tableState._isVisible = true;
            tableState._currentLayerId = null;
            const refreshCb = vi.fn();
            attachMapEvents(refreshCb, vi.fn());
            const filtersHandler = onFn.mock.calls.find(
                (c) => c[0] === "geoleaf:filters:changed"
            )[1];
            filtersHandler();
            expect(refreshCb).not.toHaveBeenCalled();
        });

        it("visibility-changed calls refresh when layer becomes visible", () => {
            const onFn = vi.fn();
            tableState._map = { on: onFn };
            tableState._currentLayerId = "layer1";
            const refreshCb = vi.fn();
            attachMapEvents(refreshCb, vi.fn());
            const visHandler = onFn.mock.calls.find(
                (c) => c[0] === "geoleaf:geojson:visibility-changed"
            )[1];
            visHandler({ layerId: "layer1", visible: true });
            expect(refreshCb).toHaveBeenCalled();
        });

        it("visibility-changed switches to alternative layer when current becomes hidden", () => {
            vi.useFakeTimers();
            const onFn = vi.fn();
            tableState._map = { on: onFn };
            tableState._currentLayerId = "layer1";
            // Setup getAvailableVisibleLayers to return something
            _g.GeoLeaf.GeoJSON = {
                getAllLayers: vi.fn(() => [{ id: "alt", label: "Alt" }]),
                getLayerData: vi.fn(() => ({
                    config: { table: { enabled: true } },
                    _visibility: { current: true },
                })),
            };
            _g.GeoLeaf._LayerVisibilityManager = {
                getVisibilityState: vi.fn(() => ({ current: true })),
            };
            const setLayerCb = vi.fn();
            attachMapEvents(vi.fn(), setLayerCb);
            const visHandler = onFn.mock.calls.find(
                (c) => c[0] === "geoleaf:geojson:visibility-changed"
            )[1];
            visHandler({ layerId: "layer1", visible: false });
            vi.advanceTimersByTime(300);
            expect(setLayerCb).toHaveBeenCalledWith("alt");
            vi.useRealTimers();
        });

        it("visibility-changed sets empty layer when no alternatives", () => {
            vi.useFakeTimers();
            const onFn = vi.fn();
            tableState._map = { on: onFn };
            tableState._currentLayerId = "layer1";
            _g.GeoLeaf.GeoJSON = {
                getAllLayers: vi.fn(() => []),
                getLayerData: vi.fn(() => null),
            };
            _g.GeoLeaf._LayerVisibilityManager = undefined;
            const setLayerCb = vi.fn();
            attachMapEvents(vi.fn(), setLayerCb);
            const visHandler = onFn.mock.calls.find(
                (c) => c[0] === "geoleaf:geojson:visibility-changed"
            )[1];
            visHandler({ layerId: "layer1", visible: false });
            vi.advanceTimersByTime(300);
            expect(setLayerCb).toHaveBeenCalledWith("");
            vi.useRealTimers();
        });

        it("layers-loaded triggers debounced refreshLayerSelector", () => {
            vi.useFakeTimers();
            const onFn = vi.fn();
            tableState._map = { on: onFn };
            attachMapEvents(vi.fn(), vi.fn());
            const loadedHandler = onFn.mock.calls.find(
                (c) => c[0] === "geoleaf:geojson:layers-loaded"
            )[1];
            loadedHandler();
            vi.advanceTimersByTime(200);
            expect(TablePanel.refreshLayerSelector).toHaveBeenCalled();
            vi.useRealTimers();
        });

        it("debounce cancels previous timer", () => {
            vi.useFakeTimers();
            const onFn = vi.fn();
            tableState._map = { on: onFn };
            attachMapEvents(vi.fn(), vi.fn());
            const loadedHandler = onFn.mock.calls.find(
                (c) => c[0] === "geoleaf:geojson:layers-loaded"
            )[1];
            loadedHandler();
            loadedHandler(); // second call should clear first timer
            vi.advanceTimersByTime(200);
            expect(TablePanel.refreshLayerSelector).toHaveBeenCalledTimes(1);
            vi.useRealTimers();
        });

        it("visibility-changed ignores other layers", () => {
            const onFn = vi.fn();
            tableState._map = { on: onFn };
            tableState._currentLayerId = "layer1";
            const refreshCb = vi.fn();
            const setLayerCb = vi.fn();
            attachMapEvents(refreshCb, setLayerCb);
            const visHandler = onFn.mock.calls.find(
                (c) => c[0] === "geoleaf:geojson:visibility-changed"
            )[1];
            visHandler({ layerId: "other", visible: false });
            expect(refreshCb).not.toHaveBeenCalled();
            expect(setLayerCb).not.toHaveBeenCalled();
        });
    });
});
