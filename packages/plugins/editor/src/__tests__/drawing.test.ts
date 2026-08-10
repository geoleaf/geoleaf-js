/*!
 * Tests — Sprint S7 : geo-compute, styles, snap, modes, terra-draw-adapter, events
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before imports that trigger terra-draw loading
// ---------------------------------------------------------------------------

const _mockModes: { mode: string }[] = [];

const _mockDraw = {
    start: vi.fn(),
    stop: vi.fn(),
    setMode: vi.fn(),
    getMode: vi.fn(() => "static"),
    on: vi.fn(),
    off: vi.fn(),
    getSnapshot: vi.fn(() => []),
    getSnapshotFeature: vi.fn(),
    removeFeatures: vi.fn(),
    addFeatures: vi.fn(() => [{ id: "td-42" }]),
    selectFeature: vi.fn(),
    deselectFeature: vi.fn(),
    updateFeatureGeometry: vi.fn(),
    updateModeOptions: vi.fn(),
    canUndo: vi.fn(() => false),
    canRedo: vi.fn(() => false),
    undo: vi.fn(),
    redo: vi.fn(),
    clear: vi.fn(),
};

vi.mock("terra-draw", () => ({
    // Vitest 4: `new TerraDraw()` needs a constructable mock — a function returning
    // the fake instance (an object return overrides `this`; arrows are not constructors).
    TerraDraw: vi.fn(function () {
        return _mockDraw;
    }),
    TerraDrawPointMode: vi.fn(function (this: { mode: string }, opts?: { modeName?: string }) {
        this.mode = opts?.modeName ?? "point";
    }),
    TerraDrawLineStringMode: vi.fn(function (this: { mode: string }, opts?: { modeName?: string }) {
        this.mode = opts?.modeName ?? "linestring";
    }),
    TerraDrawPolygonMode: vi.fn(function (this: { mode: string }, opts?: { modeName?: string }) {
        this.mode = opts?.modeName ?? "polygon";
    }),
    TerraDrawSelectMode: vi.fn(function (this: { mode: string }, opts?: { modeName?: string }) {
        this.mode = opts?.modeName ?? "select";
    }),
}));

vi.mock("terra-draw-maplibre-gl-adapter", () => ({
    // Vitest 4: constructable mock (function returning the fake adapter).
    TerraDrawMapLibreGLAdapter: vi.fn(function () {
        return { __adapter: true };
    }),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import {
    haversineDistance,
    haversineLength,
    shoelaceArea,
    centroid,
    vertexCount,
    geoCompute,
    applyComputedFields,
} from "../drawing/geo-compute.js";
import type { FieldConfig } from "@geoleaf/field-renderer";

import {
    readThemeColors,
    buildPointStyles,
    buildLineStyles,
    buildPolygonStyles,
    buildSelectStyles,
    watchThemeChanges,
} from "../drawing/styles.js";

import { buildSnappingConfig } from "../drawing/snap.js";

import {
    getModeNameForTool,
    buildTerraDrawModes,
    geometryTypeForMode,
    MODE_POINT,
    MODE_LINE,
    MODE_POLYLINE,
    MODE_POLYGON,
    MODE_SELECT,
} from "../drawing/modes.js";

import { createTerraDrawAdapter } from "../drawing/terra-draw-adapter.js";

import type { EditorConfig } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _cfg(overrides?: Partial<EditorConfig>): EditorConfig {
    return {
        enabled: true,
        enabledTools: ["point", "line", "polyline", "polygon", "select", "undo", "redo", "delete"],
        snapPx: 12,
        ...overrides,
    } as EditorConfig;
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
// geo-compute
// ---------------------------------------------------------------------------

describe("geo-compute", () => {
    it("haversineDistance — same point is 0", () => {
        expect(haversineDistance([2.35, 48.85], [2.35, 48.85])).toBe(0);
    });

    it("haversineDistance — approx 1° lat ≈ 111 km at equator", () => {
        const d = haversineDistance([0, 0], [0, 1]);
        expect(d).toBeCloseTo(111_195, -2); // ±100 m
    });

    it("haversineLength — single segment", () => {
        const len = haversineLength([
            [0, 0],
            [0, 1],
        ]);
        expect(len).toBeGreaterThan(100_000);
        expect(len).toBeLessThan(115_000);
    });

    it("haversineLength — empty array returns 0", () => {
        expect(haversineLength([])).toBe(0);
    });

    it("shoelaceArea — unit square ~1.23e10 m²", () => {
        // 1° × 1° at equator ≈ 12,300 km²
        const area = shoelaceArea([
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
        ]);
        expect(area).toBeGreaterThan(10e9);
        expect(area).toBeLessThan(15e9);
    });

    it("shoelaceArea — fewer than 3 points returns 0", () => {
        expect(
            shoelaceArea([
                [0, 0],
                [1, 0],
            ])
        ).toBe(0);
    });

    it("centroid — symmetric square", () => {
        const [lng, lat] = centroid([
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 2],
        ]);
        expect(lng).toBeCloseTo(1);
        expect(lat).toBeCloseTo(1);
    });

    it("vertexCount — Point is 1", () => {
        expect(vertexCount({ type: "Point", coordinates: [0, 0] })).toBe(1);
    });

    it("vertexCount — LineString", () => {
        expect(
            vertexCount({
                type: "LineString",
                coordinates: [
                    [0, 0],
                    [1, 1],
                    [2, 2],
                ],
            })
        ).toBe(3);
    });

    it("vertexCount — Polygon ring (including closing vertex)", () => {
        expect(
            vertexCount({
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
            })
        ).toBe(5);
    });

    it("geoCompute vertices on Point", () => {
        expect(geoCompute("vertices", { type: "Point", coordinates: [0, 0] })).toBe(1);
    });

    it("geoCompute length on LineString", () => {
        const result = geoCompute("length", {
            type: "LineString",
            coordinates: [
                [0, 0],
                [0, 1],
            ],
        });
        expect(result as number).toBeGreaterThan(100_000);
    });

    it("geoCompute area on Polygon", () => {
        const poly = {
            type: "Polygon" as const,
            coordinates: [
                [
                    [0, 0],
                    [1, 0],
                    [1, 1],
                    [0, 1],
                    [0, 0],
                ],
            ],
        };
        expect(geoCompute("area", poly) as number).toBeGreaterThan(0);
    });

    it("geoCompute area on non-polygon returns null", () => {
        expect(
            geoCompute("area", {
                type: "LineString",
                coordinates: [
                    [0, 0],
                    [1, 0],
                ],
            })
        ).toBeNull();
    });

    it("geoCompute centroid on LineString", () => {
        const result = geoCompute("centroid", {
            type: "LineString",
            coordinates: [
                [0, 0],
                [2, 0],
            ],
        });
        expect(result).toEqual([1, 0]);
    });
});

// ---------------------------------------------------------------------------
// styles
// ---------------------------------------------------------------------------

describe("styles", () => {
    beforeEach(() => {
        // Mock getComputedStyle to return a test accent color.
        vi.spyOn(globalThis, "getComputedStyle").mockReturnValue({
            getPropertyValue: (v: string) => (v === "--gl-color-accent" ? "#f97316" : ""),
        } as unknown as CSSStyleDeclaration);
    });
    afterEach(() => vi.restoreAllMocks());

    it("readThemeColors returns accent from CSS var", () => {
        const c = readThemeColors();
        expect(c.accent).toBe("#f97316");
        expect(c.white).toBe("#ffffff");
    });

    it("readThemeColors falls back to #2563eb on invalid color", () => {
        vi.spyOn(globalThis, "getComputedStyle").mockReturnValue({
            getPropertyValue: () => "not-a-hex",
        } as unknown as CSSStyleDeclaration);
        const c = readThemeColors();
        expect(c.accent).toBe("#2563eb");
    });

    it("buildPointStyles returns required fields", () => {
        const s = buildPointStyles({ accent: "#f97316", white: "#ffffff" });
        expect(s).toHaveProperty("pointColor", "#f97316");
        expect(s).toHaveProperty("pointWidth");
        expect(s).toHaveProperty("pointOutlineColor", "#ffffff");
    });

    it("buildLineStyles returns lineStringColor", () => {
        const s = buildLineStyles({ accent: "#f97316", white: "#ffffff" });
        expect(s).toHaveProperty("lineStringColor", "#f97316");
    });

    it("buildPolygonStyles includes fillOpacity < 1", () => {
        const s = buildPolygonStyles({ accent: "#f97316", white: "#ffffff" });
        expect(s.fillOpacity).toBeLessThan(1);
    });

    it("buildSelectStyles includes selectionPoint props", () => {
        const s = buildSelectStyles({ accent: "#f97316", white: "#ffffff" });
        expect(s).toHaveProperty("selectionPointColor");
        expect(s).toHaveProperty("midPointColor");
    });

    it("watchThemeChanges returns cleanup function", () => {
        const cb = vi.fn();
        const stop = watchThemeChanges(cb);
        expect(typeof stop).toBe("function");
        stop(); // should not throw
    });

    it("watchThemeChanges calls onUpdate on class change", async () => {
        const cb = vi.fn();
        const stop = watchThemeChanges(cb);
        document.documentElement.classList.add("gl-theme-dark");
        await new Promise((r) => setTimeout(r, 10));
        document.documentElement.classList.remove("gl-theme-dark");
        stop();
        expect(cb).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// snap
// ---------------------------------------------------------------------------

describe("snap", () => {
    it("buildSnappingConfig returns toLine and toCoordinate", () => {
        const cfg = buildSnappingConfig();
        expect(cfg.toLine).toBe(true);
        expect(cfg.toCoordinate).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// modes
// ---------------------------------------------------------------------------

describe("modes", () => {
    it("getModeNameForTool — all drawing tools", () => {
        expect(getModeNameForTool("point")).toBe(MODE_POINT);
        expect(getModeNameForTool("line")).toBe(MODE_LINE);
        expect(getModeNameForTool("polyline")).toBe(MODE_POLYLINE);
        expect(getModeNameForTool("polygon")).toBe(MODE_POLYGON);
        expect(getModeNameForTool("select")).toBe(MODE_SELECT);
    });

    it("getModeNameForTool — action tools return null", () => {
        expect(getModeNameForTool("undo")).toBeNull();
        expect(getModeNameForTool("redo")).toBeNull();
        expect(getModeNameForTool("delete")).toBeNull();
    });

    it("buildTerraDrawModes — all tools enabled returns 5 modes", () => {
        const modes = buildTerraDrawModes(_cfg());
        expect(modes).toHaveLength(5);
    });

    it("buildTerraDrawModes — subset of tools", () => {
        const modes = buildTerraDrawModes(_cfg({ enabledTools: ["point", "polygon"] }));
        expect(modes).toHaveLength(2);
    });

    it("buildTerraDrawModes — no duplicate modes", () => {
        const modes = buildTerraDrawModes(_cfg());
        const names = modes.map((m) => (m as { mode: string }).mode);
        expect(new Set(names).size).toBe(names.length);
    });

    it("geometryTypeForMode — maps mode names to GeoJSON types", () => {
        expect(geometryTypeForMode("point")).toBe("Point");
        expect(geometryTypeForMode("line")).toBe("LineString");
        expect(geometryTypeForMode("polyline")).toBe("LineString");
        expect(geometryTypeForMode("polygon")).toBe("Polygon");
    });
});

// ---------------------------------------------------------------------------
// terra-draw-adapter
// ---------------------------------------------------------------------------

describe("terra-draw-adapter", () => {
    let adapter: Awaited<ReturnType<typeof createTerraDrawAdapter>>;
    const callbacks = {
        onFinish: vi.fn(),
        onChange: vi.fn(),
        onSelect: vi.fn(),
        onDeselect: vi.fn(),
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        adapter = await createTerraDrawAdapter(_mockMap(), _cfg(), callbacks);
    });

    it("start() calls draw.start()", () => {
        adapter.start();
        expect(_mockDraw.start).toHaveBeenCalledOnce();
    });

    it("stop() calls draw.stop()", () => {
        adapter.start();
        adapter.stop();
        expect(_mockDraw.stop).toHaveBeenCalledOnce();
    });

    it("setMode(tool) calls draw.setMode with mapped mode name", () => {
        adapter.start();
        adapter.setMode("point");
        expect(_mockDraw.setMode).toHaveBeenCalledWith(MODE_POINT);
    });

    it("setMode(null) calls draw.setMode('static')", () => {
        adapter.start();
        adapter.setMode(null);
        expect(_mockDraw.setMode).toHaveBeenCalledWith("static");
    });

    it("setMode changes cursor on map canvas", async () => {
        const map = _mockMap();
        const a = await createTerraDrawAdapter(map, _cfg(), callbacks);
        a.start();
        a.setMode("polygon");
        expect((map.getCanvas() as HTMLCanvasElement).style.cursor).toBe("crosshair");
        a.setMode(null);
        expect((map.getCanvas() as HTMLCanvasElement).style.cursor).toBe("");
    });

    it("getActiveTool() returns last set tool", () => {
        adapter.start();
        adapter.setMode("polyline");
        expect(adapter.getActiveTool()).toBe("polyline");
        adapter.setMode(null);
        expect(adapter.getActiveTool()).toBeNull();
    });

    it("getFeature delegates to draw.getSnapshotFeature", () => {
        const fakeFeature = { id: "abc", geometry: { type: "Point", coordinates: [0, 0] } };
        _mockDraw.getSnapshotFeature.mockReturnValueOnce(fakeFeature);
        const result = adapter.getFeature("abc");
        expect(result).toBe(fakeFeature);
    });

    it("removeFeatures delegates to draw.removeFeatures", () => {
        adapter.start();
        adapter.removeFeatures(["id1", "id2"]);
        expect(_mockDraw.removeFeatures).toHaveBeenCalledWith(["id1", "id2"]);
    });

    it("canUndo / canRedo delegate to draw", () => {
        _mockDraw.canUndo.mockReturnValueOnce(true);
        _mockDraw.canRedo.mockReturnValueOnce(false);
        expect(adapter.canUndo()).toBe(true);
        expect(adapter.canRedo()).toBe(false);
    });

    it("undo / redo delegate to draw", () => {
        adapter.undo();
        expect(_mockDraw.undo).toHaveBeenCalledOnce();
        adapter.redo();
        expect(_mockDraw.redo).toHaveBeenCalledOnce();
    });

    it("destroy() calls draw.stop and resets cursor", async () => {
        const map = _mockMap();
        const a = await createTerraDrawAdapter(map, _cfg(), callbacks);
        a.start();
        a.setMode("point");
        a.destroy();
        expect(_mockDraw.stop).toHaveBeenCalled();
        expect((map.getCanvas() as HTMLCanvasElement).style.cursor).toBe("");
    });

    it("draw.on is called for all event types", () => {
        const eventNames = (_mockDraw.on.mock.calls as [string, unknown][]).map(([name]) => name);
        expect(eventNames).toContain("finish");
        expect(eventNames).toContain("change");
        expect(eventNames).toContain("select");
        expect(eventNames).toContain("deselect");
    });

    it("onFinish callback is called when draw emits finish, relaying ctx.action", () => {
        const finishCall = (_mockDraw.on.mock.calls as [string, Function][]).find(
            ([name]) => name === "finish"
        );
        finishCall?.[1]("id-123", { mode: "point", action: "draw" });
        expect(callbacks.onFinish).toHaveBeenCalledWith("id-123", "Point", "draw");
    });
});

// ---------------------------------------------------------------------------
// terra-draw-adapter — S8 extensions
// ---------------------------------------------------------------------------

describe("terra-draw-adapter S8 extensions", () => {
    let adapter: Awaited<ReturnType<typeof createTerraDrawAdapter>>;
    const callbacks = {
        onFinish: vi.fn(),
        onChange: vi.fn(),
        onSelect: vi.fn(),
        onDeselect: vi.fn(),
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        _mockDraw.addFeatures.mockReturnValue([{ id: "td-42" }]);
        adapter = await createTerraDrawAdapter(_mockMap(), _cfg(), callbacks);
    });

    it("addFeature — calls draw.addFeatures and returns string id", () => {
        const feat = {
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [0, 0] as [number, number] },
            properties: { mode: "point" },
        };
        const id = adapter.addFeature(feat);
        expect(_mockDraw.addFeatures).toHaveBeenCalledWith([feat]);
        expect(id).toBe("td-42");
    });

    it("addFeature — returns null when Terra Draw rejects (no id)", () => {
        _mockDraw.addFeatures.mockReturnValueOnce([{ id: undefined as unknown as string }]);
        const feat = {
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [0, 0] as [number, number] },
            properties: { mode: "point" },
        };
        expect(adapter.addFeature(feat)).toBeNull();
    });

    it("selectFeature — delegates to draw.selectFeature with MODE_SELECT", () => {
        adapter.selectFeature("td-42");
        expect(_mockDraw.selectFeature).toHaveBeenCalledWith("td-42", "select");
    });

    it("deselectFeature — delegates to draw.deselectFeature", () => {
        adapter.deselectFeature("td-42");
        expect(_mockDraw.deselectFeature).toHaveBeenCalledWith("td-42");
    });

    it("updateFeatureGeometry — delegates to draw.updateFeatureGeometry", () => {
        const geom = { type: "Point" as const, coordinates: [1, 2] as [number, number] };
        adapter.updateFeatureGeometry("td-42", geom);
        expect(_mockDraw.updateFeatureGeometry).toHaveBeenCalledWith("td-42", geom);
    });
});

// ---------------------------------------------------------------------------
// applyComputedFields — the producer for field-renderer's `computed` contract.
// Added at PLUGINS S4: the contract, the read-only rendering and this dispatcher
// all existed, but nothing ever joined them, so a documented feature rendered
// permanently blank. These cases pin the join.
// ---------------------------------------------------------------------------

const LINE = {
    type: "LineString" as const,
    coordinates: [
        [0, 0],
        [0, 1],
    ] as [number, number][],
};
const SQUARE = {
    type: "Polygon" as const,
    coordinates: [
        [
            [0, 0],
            [0, 0.1],
            [0.1, 0.1],
            [0.1, 0],
            [0, 0],
        ],
    ] as [number, number][][],
};

const field = (id: string, computed?: string): FieldConfig =>
    ({ id, type: "text", label: id, ...(computed ? { computed } : {}) }) as FieldConfig;

describe("applyComputedFields", () => {
    it("resolves each of the four geometry.* tokens", () => {
        const out = applyComputedFields(
            [
                field("len", "geometry.length"),
                field("area", "geometry.area"),
                field("mid", "geometry.centroid"),
                field("n", "geometry.vertexCount"),
            ],
            SQUARE
        );
        expect(out["len"]).toBeGreaterThan(0);
        expect(out["area"]).toBeGreaterThan(0);
        expect(out["mid"]).toHaveLength(2);
        expect(out["n"]).toBe(5);
    });

    it("ignores fields with no computed key", () => {
        expect(
            applyComputedFields([field("plain"), field("n", "geometry.vertexCount")], LINE)
        ).toEqual({ n: 2 });
    });

    it("omits a token the geometry cannot answer instead of writing null", () => {
        // Area is polygon-only: the field must stay absent, not become null,
        // so the input renders empty rather than showing "null".
        const out = applyComputedFields([field("area", "geometry.area")], LINE);
        expect(out).not.toHaveProperty("area");
    });

    it("omits an unknown computed token", () => {
        expect(applyComputedFields([field("x", "geometry.perimeter")], SQUARE)).toEqual({});
    });

    it("returns an empty map for an empty schema", () => {
        expect(applyComputedFields([], SQUARE)).toEqual({});
    });

    it("keys the map by field id, not by token", () => {
        const out = applyComputedFields(
            [field("a", "geometry.vertexCount"), field("b", "geometry.vertexCount")],
            LINE
        );
        expect(out).toEqual({ a: 2, b: 2 });
    });
});
