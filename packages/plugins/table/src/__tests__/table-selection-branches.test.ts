/**
 * Branch-coverage companion for src/table-selection.ts
 * Covers: getSelectedIds, setSelection, clearSelection, zoomToSelection, exportSelection
 *
 * Ported from the core suite (`__tests__/table/table-selection-branches.test.js`).
 * Adaptation: import paths point at the plugin's flat `src/` layout. No GeoJSON /
 * visibility seams are exercised here (the source mocks `table-state` wholesale), so
 * test logic, data, titles and assertions are unchanged.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@geoleaf/host-runtime", async (importActual) => ({
    ...(await importActual<typeof import("@geoleaf/host-runtime")>()),
    Log: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock("../table-state.js", () => ({
    tableState: {
        _selectedIds: new Set(),
        _currentLayerId: null,
        _container: null,
        _map: null,
    },
    fireEvent: vi.fn(),
    getSelectedFeatures: vi.fn(() => []),
}));

vi.mock("../export.js", () => ({
    buildGeoJSONCollection: vi.fn((f) => ({ type: "FeatureCollection", features: f })),
    downloadGeoJSON: vi.fn(),
    downloadFeatures: vi.fn(() => Promise.resolve()),
}));

vi.mock("../table-layer.js", () => ({
    getAllLayerFeatures: vi.fn(() => []),
}));

vi.mock("../renderer.js", () => ({
    TableRenderer: { updateSelection: vi.fn() },
}));

import {
    getSelectedIds,
    setSelection,
    clearSelection,
    zoomToSelection,
    exportSelection,
} from "../table-selection.js";
import { tableState, fireEvent, getSelectedFeatures } from "../table-state.js";
import { downloadFeatures } from "../export.js";
import { TableRenderer } from "../renderer.js";

describe("table/table-selection.ts — branch coverage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        tableState._selectedIds = new Set();
        tableState._currentLayerId = null;
        tableState._container = document.createElement("div");
        tableState._map = null;
    });

    // ── getSelectedIds ────────────────────────────────────────────

    describe("getSelectedIds", () => {
        it("returns empty array when no selection", () => {
            expect(getSelectedIds()).toEqual([]);
        });

        it("returns array of selected ids", () => {
            tableState._selectedIds.add("a");
            tableState._selectedIds.add("b");
            expect(getSelectedIds()).toEqual(["a", "b"]);
        });
    });

    // ── setSelection ──────────────────────────────────────────────

    describe("setSelection", () => {
        it("replaces selection when add=false (default)", () => {
            tableState._selectedIds.add("old");
            setSelection(["new"]);
            expect(Array.from(tableState._selectedIds)).toEqual(["new"]);
        });

        it("adds to selection when add=true", () => {
            tableState._selectedIds.add("old");
            setSelection(["new"], true);
            expect(Array.from(tableState._selectedIds)).toEqual(["old", "new"]);
        });

        it("fires selectionChanged event", () => {
            setSelection(["a"]);
            expect(fireEvent).toHaveBeenCalledWith(
                "geoleaf:table:selectionChanged",
                expect.any(Object)
            );
        });

        it("calls TableRenderer.updateSelection when available", () => {
            setSelection(["a"]);
            expect(TableRenderer.updateSelection).toHaveBeenCalled();
        });

        it("converts ids to strings", () => {
            setSelection([1, 2]);
            expect(Array.from(tableState._selectedIds)).toEqual(["1", "2"]);
        });
    });

    // ── clearSelection ────────────────────────────────────────────

    describe("clearSelection", () => {
        it("clears all selected ids", () => {
            tableState._selectedIds.add("a");
            clearSelection();
            expect(tableState._selectedIds.size).toBe(0);
        });

        it("fires selectionChanged event", () => {
            clearSelection();
            expect(fireEvent).toHaveBeenCalledWith(
                "geoleaf:table:selectionChanged",
                expect.objectContaining({ selectedIds: [] })
            );
        });

        it("calls TableRenderer.updateSelection", () => {
            clearSelection();
            expect(TableRenderer.updateSelection).toHaveBeenCalled();
        });
    });

    // ── zoomToSelection ───────────────────────────────────────────

    describe("zoomToSelection", () => {
        it("returns early when no selection", () => {
            zoomToSelection();
            expect(getSelectedFeatures).not.toHaveBeenCalled();
        });

        it("returns early when getSelectedFeatures returns empty", () => {
            tableState._selectedIds.add("a");
            getSelectedFeatures.mockReturnValue([]);
            zoomToSelection();
            expect(fireEvent).not.toHaveBeenCalled();
        });

        it("zooms to Point geometry", () => {
            tableState._selectedIds.add("a");
            tableState._map = { fitBounds: vi.fn() };
            getSelectedFeatures.mockReturnValue([
                { geometry: { type: "Point", coordinates: [2.35, 48.85] } },
            ]);
            zoomToSelection();
            expect(tableState._map.fitBounds).toHaveBeenCalled();
            expect(fireEvent).toHaveBeenCalledWith(
                "geoleaf:table:zoomToSelection",
                expect.any(Object)
            );
        });

        it("zooms to LineString geometry", () => {
            tableState._selectedIds.add("a");
            tableState._map = { fitBounds: vi.fn() };
            getSelectedFeatures.mockReturnValue([
                {
                    geometry: {
                        type: "LineString",
                        coordinates: [
                            [2.0, 48.0],
                            [3.0, 49.0],
                        ],
                    },
                },
            ]);
            zoomToSelection();
            expect(tableState._map.fitBounds).toHaveBeenCalled();
        });

        it("zooms to Polygon geometry", () => {
            tableState._selectedIds.add("a");
            tableState._map = { fitBounds: vi.fn() };
            getSelectedFeatures.mockReturnValue([
                {
                    geometry: {
                        type: "Polygon",
                        coordinates: [
                            [
                                [2.0, 48.0],
                                [3.0, 49.0],
                                [2.5, 48.5],
                                [2.0, 48.0],
                            ],
                        ],
                    },
                },
            ]);
            zoomToSelection();
            expect(tableState._map.fitBounds).toHaveBeenCalled();
        });

        it("zooms to MultiPoint geometry", () => {
            tableState._selectedIds.add("a");
            tableState._map = { fitBounds: vi.fn() };
            getSelectedFeatures.mockReturnValue([
                {
                    geometry: {
                        type: "MultiPoint",
                        coordinates: [
                            [1, 47],
                            [3, 49],
                        ],
                    },
                },
            ]);
            zoomToSelection();
            expect(tableState._map.fitBounds).toHaveBeenCalled();
        });

        it("zooms to MultiLineString geometry", () => {
            tableState._selectedIds.add("a");
            tableState._map = { fitBounds: vi.fn() };
            getSelectedFeatures.mockReturnValue([
                {
                    geometry: {
                        type: "MultiLineString",
                        coordinates: [
                            [
                                [1, 47],
                                [2, 48],
                            ],
                            [
                                [3, 49],
                                [4, 50],
                            ],
                        ],
                    },
                },
            ]);
            zoomToSelection();
            expect(tableState._map.fitBounds).toHaveBeenCalled();
        });

        it("zooms to MultiPolygon geometry", () => {
            tableState._selectedIds.add("a");
            tableState._map = { fitBounds: vi.fn() };
            getSelectedFeatures.mockReturnValue([
                {
                    geometry: {
                        type: "MultiPolygon",
                        coordinates: [
                            [
                                [
                                    [1, 47],
                                    [2, 48],
                                    [1.5, 47.5],
                                    [1, 47],
                                ],
                            ],
                        ],
                    },
                },
            ]);
            zoomToSelection();
            expect(tableState._map.fitBounds).toHaveBeenCalled();
        });

        it("warns when no valid coordinates found", () => {
            tableState._selectedIds.add("a");
            getSelectedFeatures.mockReturnValue([{ geometry: { type: "GeometryCollection" } }]);
            zoomToSelection();
            expect(fireEvent).not.toHaveBeenCalled();
        });

        it("skips features without geometry", () => {
            tableState._selectedIds.add("a");
            tableState._map = { fitBounds: vi.fn() };
            getSelectedFeatures.mockReturnValue([
                { geometry: null },
                { geometry: { type: "Point", coordinates: [2.35, 48.85] } },
            ]);
            zoomToSelection();
            expect(tableState._map.fitBounds).toHaveBeenCalled();
        });

        it("skips features without geometry.coordinates", () => {
            tableState._selectedIds.add("a");
            getSelectedFeatures.mockReturnValue([{ geometry: { type: "Point" } }]);
            zoomToSelection();
        });

        it("does not fitBounds when map has no fitBounds method", () => {
            tableState._selectedIds.add("a");
            tableState._map = {};
            getSelectedFeatures.mockReturnValue([
                { geometry: { type: "Point", coordinates: [2.35, 48.85] } },
            ]);
            zoomToSelection();
            expect(fireEvent).toHaveBeenCalledWith(
                "geoleaf:table:zoomToSelection",
                expect.any(Object)
            );
        });
    });

    // ── exportSelection ───────────────────────────────────────────

    describe("exportSelection", () => {
        it("returns early when no selection", () => {
            exportSelection();
            expect(downloadFeatures).not.toHaveBeenCalled();
        });

        it("returns early when getSelectedFeatures returns empty", () => {
            tableState._selectedIds.add("a");
            getSelectedFeatures.mockReturnValue([]);
            exportSelection();
            expect(downloadFeatures).not.toHaveBeenCalled();
        });

        it("calls downloadFeatures for selected features", () => {
            tableState._selectedIds.add("a");
            tableState._currentLayerId = "layer1";
            getSelectedFeatures.mockReturnValue([{ id: "a" }]);
            exportSelection();
            expect(downloadFeatures).toHaveBeenCalledWith(
                expect.any(Array),
                "geojson",
                "layer1",
                "selection",
                expect.any(Object)
            );
            expect(fireEvent).toHaveBeenCalledWith(
                "geoleaf:table:exportSelection",
                expect.any(Object)
            );
        });

        it("uses empty string when currentLayerId is null", () => {
            tableState._selectedIds.add("a");
            tableState._currentLayerId = null;
            getSelectedFeatures.mockReturnValue([{ id: "a" }]);
            exportSelection();
            expect(downloadFeatures).toHaveBeenCalledWith(
                expect.any(Array),
                "geojson",
                "",
                "selection",
                expect.any(Object)
            );
        });

        it("catches downloadFeatures errors without throwing", () => {
            tableState._selectedIds.add("a");
            getSelectedFeatures.mockReturnValue([{ id: "a" }]);
            downloadFeatures.mockReturnValue(Promise.reject(new Error("fail")));
            // Should not throw synchronously
            expect(() => exportSelection()).not.toThrow();
            expect(fireEvent).toHaveBeenCalledWith(
                "geoleaf:table:exportSelection",
                expect.any(Object)
            );
        });
    });
});
