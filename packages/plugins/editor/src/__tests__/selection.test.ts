/*!
 * Tests — Sprint S8 : selection-state, layer-picker
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks for terra-draw (layer-picker imports mode constants from drawing/modes)
// ---------------------------------------------------------------------------

vi.mock("terra-draw", () => ({
    TerraDraw: vi.fn(),
    TerraDrawPointMode: vi.fn(),
    TerraDrawLineStringMode: vi.fn(),
    TerraDrawPolygonMode: vi.fn(),
    TerraDrawSelectMode: vi.fn(),
}));

vi.mock("terra-draw-maplibre-gl-adapter", () => ({
    TerraDrawMapLibreGLAdapter: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import {
    setSelection,
    clearSelection,
    getSelection,
    type SelectionSnapshot,
} from "../selection/selection-state.js";

import { initLayerPicker, destroyLayerPicker } from "../selection/layer-picker.js";

import type { TerraDrawAdapterInstance } from "../drawing/terra-draw-adapter.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _snap(overrides?: Partial<SelectionSnapshot>): SelectionSnapshot {
    return {
        terradrawId: "td-1",
        featureId: "feat-abc",
        layerId: "my-layer",
        originalGeom: { type: "Point", coordinates: [2.35, 48.85] },
        ...overrides,
    };
}

import type { EditorTool } from "../types.js";

function _mockAdapter(overrides?: Partial<TerraDrawAdapterInstance>): TerraDrawAdapterInstance {
    return {
        start: vi.fn(),
        stop: vi.fn(),
        setMode: vi.fn(),
        getActiveTool: vi.fn((): EditorTool | null => null),
        getFeature: vi.fn(),
        removeFeatures: vi.fn(),
        addFeature: vi.fn((): string | null => "td-new"),
        selectFeature: vi.fn(),
        deselectFeature: vi.fn(),
        updateFeatureGeometry: vi.fn(),
        canUndo: vi.fn(() => false),
        canRedo: vi.fn(() => false),
        undo: vi.fn(),
        redo: vi.fn(),
        destroy: vi.fn(),
        ...overrides,
    } as unknown as TerraDrawAdapterInstance;
}

function _mockMap() {
    const canvas = document.createElement("canvas");
    return {
        getCanvas: vi.fn(() => canvas),
        getContainer: vi.fn(() => document.createElement("div")),
        on: vi.fn(),
        off: vi.fn(),
        once: vi.fn(),
        loaded: vi.fn(() => true),
        queryRenderedFeatures: vi.fn(() => []),
    };
}

// ---------------------------------------------------------------------------
// selection-state
// ---------------------------------------------------------------------------

describe("selection-state", () => {
    beforeEach(() => clearSelection());

    it("getSelection() is null initially", () => {
        expect(getSelection()).toBeNull();
    });

    it("setSelection() stores the snapshot", () => {
        const snap = _snap();
        setSelection(snap);
        expect(getSelection()).toBe(snap);
    });

    it("clearSelection() resets to null", () => {
        setSelection(_snap());
        clearSelection();
        expect(getSelection()).toBeNull();
    });

    it("setSelection() replaces an existing snapshot", () => {
        setSelection(_snap({ terradrawId: "td-old" }));
        setSelection(_snap({ terradrawId: "td-new" }));
        expect(getSelection()?.terradrawId).toBe("td-new");
    });

    it("originalGeom is preserved correctly", () => {
        const geom = {
            type: "Polygon" as const,
            coordinates: [
                [
                    [0, 0],
                    [1, 0],
                    [1, 1],
                    [0, 0],
                ],
            ],
        };
        setSelection(_snap({ originalGeom: geom }));
        expect(getSelection()?.originalGeom).toEqual(geom);
    });
});

// ---------------------------------------------------------------------------
// layer-picker — initLayerPicker / destroyLayerPicker
// ---------------------------------------------------------------------------

describe("layer-picker — lifecycle", () => {
    beforeEach(() => {
        destroyLayerPicker();
        clearSelection();
    });

    it("initLayerPicker registers click + mousemove handlers on map", () => {
        const adapter = _mockAdapter();
        const map = _mockMap();
        initLayerPicker(adapter, map);
        expect(map.on).toHaveBeenCalledWith("click", expect.any(Function));
        expect(map.on).toHaveBeenCalledWith("mousemove", expect.any(Function));
        destroyLayerPicker();
    });

    it("destroyLayerPicker removes listeners after init", () => {
        const adapter = _mockAdapter();
        const map = _mockMap();
        initLayerPicker(adapter, map);
        destroyLayerPicker();
        expect(map.off).toHaveBeenCalledWith("click", expect.any(Function));
        expect(map.off).toHaveBeenCalledWith("mousemove", expect.any(Function));
    });

    it("destroyLayerPicker is safe to call without init", () => {
        expect(() => destroyLayerPicker()).not.toThrow();
    });
});

describe("layer-picker — click handler", () => {
    beforeEach(() => {
        destroyLayerPicker();
        clearSelection();
    });

    function _getClickHandler(map: ReturnType<typeof _mockMap>): (e: unknown) => void {
        const clickCall = (map.on.mock.calls as [string, (e: unknown) => void][]).find(
            ([name]) => name === "click"
        );
        return clickCall![1];
    }

    it("ignores click when active tool is not 'select'", () => {
        const adapter = _mockAdapter({ getActiveTool: vi.fn((): EditorTool | null => "point") });
        const map = _mockMap();
        initLayerPicker(adapter, map);
        const handler = _getClickHandler(map);
        handler({ point: { x: 100, y: 100 } });
        expect(adapter.addFeature).not.toHaveBeenCalled();
        destroyLayerPicker();
    });

    it("ignores click when no feature is found at the point", () => {
        const adapter = _mockAdapter({ getActiveTool: vi.fn((): EditorTool | null => "select") });
        const map = _mockMap();
        map.queryRenderedFeatures.mockReturnValue([]);
        initLayerPicker(adapter, map);
        const handler = _getClickHandler(map);
        handler({ point: { x: 100, y: 100 } });
        expect(adapter.addFeature).not.toHaveBeenCalled();
        destroyLayerPicker();
    });

    it("ignores terra-draw internal layers (td- prefix)", () => {
        // Set up an editable layer in GeoLeaf global
        const g = globalThis as unknown as Record<string, unknown>;
        g["GeoLeaf"] = {
            Config: {
                getActiveProfile: () => ({
                    layers: [{ id: "my-layer", edition: { create: true, update: true } }],
                }),
            },
        };

        const adapter = _mockAdapter({ getActiveTool: vi.fn((): EditorTool | null => "select") });
        const map = _mockMap();
        (map.queryRenderedFeatures as ReturnType<typeof vi.fn>).mockReturnValue([
            // terra-draw layer — must be ignored
            {
                id: "td-99",
                layer: { id: "td-point" },
                geometry: { type: "Point", coordinates: [0, 0] },
                properties: {},
            },
        ]);
        initLayerPicker(adapter, map);
        const handler = _getClickHandler(map);
        handler({ point: { x: 100, y: 100 } });
        expect(adapter.addFeature).not.toHaveBeenCalled();

        delete g["GeoLeaf"];
        destroyLayerPicker();
    });

    it("loads editable host feature into Terra Draw and sets selection", () => {
        const g = globalThis as unknown as Record<string, unknown>;
        g["GeoLeaf"] = {
            Config: {
                getActiveProfile: () => ({
                    layers: [{ id: "poi-layer", edition: { create: true, update: true } }],
                }),
            },
        };

        const adapter = _mockAdapter({
            getActiveTool: vi.fn((): EditorTool | null => "select"),
            addFeature: vi.fn((): string | null => "td-loaded"),
        });
        const map = _mockMap();
        const hostFeature = {
            id: "feature-1",
            layer: { id: "poi-layer" },
            geometry: { type: "Point", coordinates: [2.35, 48.85] },
            properties: { name: "Test POI" },
        };
        (map.queryRenderedFeatures as ReturnType<typeof vi.fn>).mockReturnValue([hostFeature]);

        initLayerPicker(adapter, map);
        const handler = _getClickHandler(map);
        handler({ point: { x: 100, y: 100 } });

        // Feature must be added to Terra Draw with correct mode
        expect(adapter.addFeature).toHaveBeenCalledOnce();
        const added = (adapter.addFeature as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(added.properties.mode).toBe("point");

        // Must select in Terra Draw
        expect(adapter.selectFeature).toHaveBeenCalledWith("td-loaded");

        // Selection state must be populated
        const snap = getSelection();
        expect(snap?.terradrawId).toBe("td-loaded");
        expect(snap?.featureId).toBe("feature-1");
        expect(snap?.layerId).toBe("poi-layer");

        delete g["GeoLeaf"];
        destroyLayerPicker();
    });

    it("does not load feature when Terra Draw rejects it (addFeature returns null)", () => {
        const g = globalThis as unknown as Record<string, unknown>;
        g["GeoLeaf"] = {
            Config: {
                getActiveProfile: () => ({
                    layers: [{ id: "poi-layer", edition: { create: true, update: true } }],
                }),
            },
        };

        const adapter = _mockAdapter({
            getActiveTool: vi.fn((): EditorTool | null => "select"),
            addFeature: vi.fn((): string | null => null),
        });
        const map = _mockMap();
        (map.queryRenderedFeatures as ReturnType<typeof vi.fn>).mockReturnValue([
            {
                id: "f2",
                layer: { id: "poi-layer" },
                geometry: { type: "Point", coordinates: [0, 0] },
                properties: {},
            },
        ]);
        initLayerPicker(adapter, map);
        const handler = _getClickHandler(map);
        handler({ point: { x: 100, y: 100 } });
        expect(adapter.selectFeature).not.toHaveBeenCalled();
        expect(getSelection()).toBeNull();

        delete g["GeoLeaf"];
        destroyLayerPicker();
    });

    it("resolves a prefixed MapLibre sub-layer id (gl-{id}-{type}) to its editable profile layer", () => {
        const g = globalThis as unknown as Record<string, unknown>;
        g["GeoLeaf"] = {
            Config: {
                getActiveProfile: () => ({
                    layers: [{ id: "parcours", edition: { create: true, update: true } }],
                }),
            },
        };

        const adapter = _mockAdapter({
            getActiveTool: vi.fn((): EditorTool | null => "select"),
            addFeature: vi.fn((): string | null => "td-line"),
        });
        const map = _mockMap();
        (map.queryRenderedFeatures as ReturnType<typeof vi.fn>).mockReturnValue([
            // Rendered sub-layer id is "gl-parcours-line", not the bare profile id "parcours".
            {
                id: "p1",
                layer: { id: "gl-parcours-line" },
                geometry: {
                    type: "LineString",
                    coordinates: [
                        [0, 0],
                        [1, 1],
                    ],
                },
                properties: {},
            },
        ]);
        initLayerPicker(adapter, map);
        const handler = _getClickHandler(map);
        handler({ point: { x: 10, y: 10 } });

        expect(adapter.addFeature).toHaveBeenCalledOnce();
        expect(adapter.selectFeature).toHaveBeenCalledWith("td-line");
        // Snapshot layerId must be the resolved profile id, not the rendered sub-layer id.
        expect(getSelection()?.layerId).toBe("parcours");

        delete g["GeoLeaf"];
        destroyLayerPicker();
    });

    it("maps LineString geometry to polyline mode", () => {
        const g = globalThis as unknown as Record<string, unknown>;
        g["GeoLeaf"] = {
            Config: {
                getActiveProfile: () => ({
                    layers: [{ id: "route-layer", edition: { create: true, update: true } }],
                }),
            },
        };

        const adapter = _mockAdapter({
            getActiveTool: vi.fn((): EditorTool | null => "select"),
            addFeature: vi.fn((): string | null => "td-line"),
        });
        const map = _mockMap();
        (map.queryRenderedFeatures as ReturnType<typeof vi.fn>).mockReturnValue([
            {
                id: "r1",
                layer: { id: "route-layer" },
                geometry: {
                    type: "LineString",
                    coordinates: [
                        [0, 0],
                        [1, 1],
                    ],
                },
                properties: {},
            },
        ]);
        initLayerPicker(adapter, map);
        const handler = _getClickHandler(map);
        handler({ point: { x: 0, y: 0 } });
        const added = (adapter.addFeature as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(added.properties.mode).toBe("polyline");

        delete g["GeoLeaf"];
        destroyLayerPicker();
    });
});
