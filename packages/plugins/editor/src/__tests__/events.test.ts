/*!
 * Tests — events bridge (initEventsBridge) : onFinish / onChange / onSelect / onDeselect.
 * Split out of drawing.test.ts (700-line cap). Shares the same Terra Draw mock harness.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before imports that trigger terra-draw loading
// ---------------------------------------------------------------------------

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
    // Vitest 4: `new TerraDraw()` needs a constructable mock (function returning the fake).
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

import { createTerraDrawAdapter } from "../drawing/terra-draw-adapter.js";
import {
    adapterCallbacks,
    initEventsBridge,
    dispatchFeatureConflict,
    EDIT_ACTION_OP,
    type EditorWiringContext,
} from "../events.js";
import { setSelection, clearSelection, getSelection } from "../selection/selection-state.js";
import { getUndoDepth, clearHistory } from "../history/undo-stack.js";
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
// events bridge
// ---------------------------------------------------------------------------

describe("events bridge — initEventsBridge", () => {
    let adapter: Awaited<ReturnType<typeof createTerraDrawAdapter>>;
    const openForm = vi.fn();

    beforeEach(async () => {
        vi.clearAllMocks();
        // Reset module-global state so undo depth / selection don't leak between tests.
        clearSelection();
        clearHistory();
        adapter = await createTerraDrawAdapter(_mockMap(), _cfg(), adapterCallbacks);
        adapter.start();
        initEventsBridge(adapter, openForm);
    });

    it("onFinish — gets feature and calls openForm with geometryType (action 'draw')", () => {
        const feature = {
            id: "abc",
            geometry: {
                type: "LineString",
                coordinates: [
                    [0, 0],
                    [1, 1],
                ],
            },
        };
        _mockDraw.getSnapshotFeature.mockReturnValueOnce(feature);
        adapterCallbacks.onFinish("abc", "LineString", "draw");
        expect(openForm).toHaveBeenCalledOnce();
        const opts = openForm.mock.calls[0][0];
        expect(opts.geometryType).toBe("LineString");
    });

    it("onFinish — calls adapter.setMode(null) to reset cursor (action 'draw')", () => {
        const feature = { id: "abc", geometry: { type: "Point", coordinates: [0, 0] } };
        _mockDraw.getSnapshotFeature.mockReturnValueOnce(feature);
        adapterCallbacks.onFinish("abc", "Point", "draw");
        expect(_mockDraw.setMode).toHaveBeenCalledWith("static");
    });

    it("onFinish — skips openForm if feature has no geometry", () => {
        _mockDraw.getSnapshotFeature.mockReturnValueOnce(null);
        adapterCallbacks.onFinish("missing-id", "Point", "draw");
        expect(openForm).not.toHaveBeenCalled();
    });

    it("onFinish — onCancel callback removes the drawn feature", () => {
        const feature = { id: "abc", geometry: { type: "Point", coordinates: [0, 0] } };
        _mockDraw.getSnapshotFeature.mockReturnValueOnce(feature);
        adapterCallbacks.onFinish("abc", "Point", "draw");
        // Simulate user cancelling the form
        const opts = openForm.mock.calls[0][0];
        opts.onCancel?.();
        expect(_mockDraw.removeFeatures).toHaveBeenCalledWith(["abc"]);
    });

    // Edit gestures in select mode also emit "finish" (with a non-"draw" action).
    // Those must NOT open the creation form nor reset the mode — they are recorded
    // as undo operations by _handleEdit. With no active selection (cleared in
    // beforeEach) the edit path no-ops, so only the "no form / no setMode" contract
    // is asserted here. Regression guard for the empty-modal-on-vertex-drag bug.
    it.each([
        "dragCoordinate",
        "insertMidpoint",
        "deleteCoordinate",
        "dragFeature",
        "dragCoordinateResize",
    ])("onFinish — action '%s' (select-mode edit) does not open the form", (action) => {
        const feature = {
            id: "abc",
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [0, 0],
                        [1, 0],
                        [1, 1],
                        [0, 0],
                    ],
                ],
            },
        };
        _mockDraw.getSnapshotFeature.mockReturnValue(feature);
        adapterCallbacks.onFinish("abc", "Polygon", action);
        expect(openForm).not.toHaveBeenCalled();
    });

    it("onFinish — a select-mode edit action does not reset the mode to static", () => {
        const feature = {
            id: "abc",
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [0, 0],
                        [1, 0],
                        [1, 1],
                        [0, 0],
                    ],
                ],
            },
        };
        _mockDraw.getSnapshotFeature.mockReturnValue(feature);
        adapterCallbacks.onFinish("abc", "Polygon", "dragCoordinate");
        expect(_mockDraw.setMode).not.toHaveBeenCalledWith("static");
    });

    // Undo is finish-driven: the "change" event (type "update", fired per
    // coordinate update during a drag) is intentionally a no-op. Feeding it any
    // store-change type must neither dispatch a public event nor push an undo op.
    it("onChange — is a no-op (does not dispatch nor push)", () => {
        setSelection({
            terradrawId: "td-x",
            featureId: "f-x",
            layerId: "l-x",
            originalGeom: { type: "Point", coordinates: [0, 0] },
        });
        const listener = vi.fn();
        document.addEventListener("geoleaf:editor:feature-moved", listener);
        adapterCallbacks.onChange(["td-x"], "update");
        adapterCallbacks.onChange(["td-x"], "create");
        document.removeEventListener("geoleaf:editor:feature-moved", listener);
        expect(listener).not.toHaveBeenCalled();
        expect(getUndoDepth()).toBe(0);
    });

    it("onSelect — no existing selection creates bare snapshot", () => {
        clearSelection();
        _mockDraw.getSnapshotFeature.mockReturnValueOnce({
            id: "td-99",
            geometry: { type: "Point", coordinates: [1, 2] },
        });
        adapterCallbacks.onSelect("td-99");
        const snap = getSelection();
        expect(snap?.terradrawId).toBe("td-99");
        expect(snap?.featureId).toBe("");
        expect(snap?.layerId).toBe("");
    });

    it("onSelect — existing selection keeps featureId/layerId", () => {
        setSelection({
            terradrawId: "old",
            featureId: "host-feat-1",
            layerId: "my-layer",
            originalGeom: { type: "Point", coordinates: [0, 0] },
        });
        _mockDraw.getSnapshotFeature.mockReturnValueOnce({
            id: "td-55",
            geometry: { type: "Point", coordinates: [3, 4] },
        });
        adapterCallbacks.onSelect("td-55");
        const snap = getSelection();
        expect(snap?.terradrawId).toBe("td-55");
        expect(snap?.featureId).toBe("host-feat-1");
        expect(snap?.layerId).toBe("my-layer");
    });

    it("onDeselect — clears the selection", () => {
        setSelection({
            terradrawId: "td-1",
            featureId: "f1",
            layerId: "l1",
            originalGeom: { type: "Point", coordinates: [0, 0] },
        });
        adapterCallbacks.onDeselect("td-1");
        expect(getSelection()).toBeNull();
    });

    // Edit gestures are recorded on the "finish" event (one event per completed
    // gesture → one undo entry), keyed off the FinishActions vocabulary.

    it("onFinish 'dragFeature' — pushes a move op + dispatches feature-moved", () => {
        const geom = {
            type: "LineString" as const,
            coordinates: [
                [0, 0],
                [1, 1],
            ],
        };
        setSelection({
            terradrawId: "td-line",
            featureId: "f-line",
            layerId: "l-line",
            originalGeom: geom,
        });
        _mockDraw.getSnapshotFeature.mockReturnValueOnce({
            geometry: {
                type: "LineString",
                coordinates: [
                    [0, 0],
                    [2, 2],
                ],
            },
        });
        const listener = vi.fn();
        document.addEventListener("geoleaf:editor:feature-moved", listener);
        adapterCallbacks.onFinish("td-line", "LineString", "dragFeature");
        document.removeEventListener("geoleaf:editor:feature-moved", listener);
        expect(listener).toHaveBeenCalledOnce();
        expect(listener.mock.calls[0][0].detail.featureId).toBe("f-line");
        expect(getUndoDepth()).toBe(1);
    });

    it("onFinish 'dragCoordinate' — single-vertex drag also records a move op", () => {
        const geom = {
            type: "LineString" as const,
            coordinates: [
                [0, 0],
                [1, 1],
            ],
        };
        setSelection({ terradrawId: "td-c", featureId: "f-c", layerId: "l-c", originalGeom: geom });
        _mockDraw.getSnapshotFeature.mockReturnValueOnce({
            geometry: {
                type: "LineString",
                coordinates: [
                    [0, 0],
                    [1.5, 1.5],
                ],
            },
        });
        adapterCallbacks.onFinish("td-c", "LineString", "dragCoordinate");
        expect(getUndoDepth()).toBe(1);
    });

    it("onFinish 'insertMidpoint' — pushes a vertex-add op + dispatches vertex-added", () => {
        const geom = {
            type: "LineString" as const,
            coordinates: [
                [0, 0],
                [1, 1],
            ],
        };
        setSelection({ terradrawId: "td-m", featureId: "f-m", layerId: "l-m", originalGeom: geom });
        _mockDraw.getSnapshotFeature.mockReturnValueOnce({
            geometry: {
                type: "LineString",
                coordinates: [
                    [0, 0],
                    [0.5, 0.5],
                    [1, 1],
                ],
            },
        });
        const listener = vi.fn();
        document.addEventListener("geoleaf:editor:vertex-added", listener);
        adapterCallbacks.onFinish("td-m", "LineString", "insertMidpoint");
        document.removeEventListener("geoleaf:editor:vertex-added", listener);
        expect(listener).toHaveBeenCalledOnce();
        expect(getUndoDepth()).toBe(1);
    });

    it("onFinish 'deleteCoordinate' — pushes a vertex-del op + dispatches vertex-deleted", () => {
        const geom = {
            type: "LineString" as const,
            coordinates: [
                [0, 0],
                [1, 1],
                [2, 2],
            ],
        };
        setSelection({ terradrawId: "td-d", featureId: "f-d", layerId: "l-d", originalGeom: geom });
        _mockDraw.getSnapshotFeature.mockReturnValueOnce({
            geometry: {
                type: "LineString",
                coordinates: [
                    [0, 0],
                    [2, 2],
                ],
            },
        });
        const listener = vi.fn();
        document.addEventListener("geoleaf:editor:vertex-deleted", listener);
        adapterCallbacks.onFinish("td-d", "LineString", "deleteCoordinate");
        document.removeEventListener("geoleaf:editor:vertex-deleted", listener);
        expect(listener).toHaveBeenCalledOnce();
        expect(getUndoDepth()).toBe(1);
    });

    it("garde-fou — deleteCoordinate sous minVerticesLineString : rollback + aucune entrée undo", () => {
        const origCoords = [
            [0, 0],
            [1, 1],
        ]; // 2 vertices = minimum
        const geom = { type: "LineString" as const, coordinates: origCoords };
        setSelection({ terradrawId: "td-g", featureId: "fg", layerId: "lg", originalGeom: geom });
        // Terra Draw reports 1 vertex after the deletion attempt.
        _mockDraw.getSnapshotFeature.mockReturnValueOnce({
            geometry: { type: "LineString", coordinates: [[0, 0]] },
        });
        adapterCallbacks.onFinish("td-g", "LineString", "deleteCoordinate");
        // Rollback to the snapshot geometry, and no undo entry recorded.
        expect(_mockDraw.updateFeatureGeometry).toHaveBeenCalledWith("td-g", geom);
        expect(getUndoDepth()).toBe(0);
    });

    it("onFinish edit — no active selection → no dispatch, no push", () => {
        clearSelection();
        const listener = vi.fn();
        document.addEventListener("geoleaf:editor:feature-moved", listener);
        adapterCallbacks.onFinish("td-x", "LineString", "dragFeature");
        document.removeEventListener("geoleaf:editor:feature-moved", listener);
        expect(listener).not.toHaveBeenCalled();
        expect(getUndoDepth()).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Persistence wiring (Sprint S10) — create save, deselect commit/restore, conflict event
// ---------------------------------------------------------------------------

describe("events bridge — persistence wiring (S10)", () => {
    let adapter: Awaited<ReturnType<typeof createTerraDrawAdapter>>;
    const openForm = vi.fn();
    let persist: { save: any; update: any; delete: any; isOnline: any };
    let wiring: EditorWiringContext;
    const flush = () => new Promise((r) => setTimeout(r, 0));

    beforeEach(async () => {
        vi.clearAllMocks();
        clearSelection();
        clearHistory();
        adapter = await createTerraDrawAdapter(_mockMap(), _cfg(), adapterCallbacks);
        adapter.start();
        persist = {
            save: vi.fn().mockResolvedValue({
                id: "srv1",
                layerId: "L",
                geometry: { type: "Point", coordinates: [0, 0] },
                properties: {},
            }),
            update: vi.fn().mockResolvedValue({
                id: "f1",
                layerId: "L",
                geometry: { type: "Point", coordinates: [9, 9] },
                properties: {},
            }),
            delete: vi.fn().mockResolvedValue(undefined),
            isOnline: vi.fn(() => true),
        };
        wiring = {
            adapter: persist as any,
            strategy: "prompt",
            hideHost: vi.fn(),
            showHost: vi.fn(),
            commitHost: vi.fn(),
            removeHost: vi.fn(),
            reloadFeature: vi.fn(),
        };
        initEventsBridge(adapter, openForm, wiring);
    });

    it("create save → adapter.save with the drawn geometry and form values", async () => {
        _mockDraw.getSnapshotFeature.mockReturnValue({
            id: "abc",
            geometry: { type: "Point", coordinates: [1, 2] },
        });
        adapterCallbacks.onFinish("abc", "Point", "draw");
        const opts = openForm.mock.calls[0][0];
        await opts.onSave({ name: "X" }, "L");
        expect(persist.save).toHaveBeenCalledOnce();
        const [ef, layerId] = persist.save.mock.calls[0];
        expect(ef.geometry).toEqual({ type: "Point", coordinates: [1, 2] });
        expect(ef.properties).toEqual({ name: "X" });
        expect(layerId).toBe("L");
    });

    it("deselect of an EDITED host feature → update (host props, no mode) + commit + drop copy", async () => {
        setSelection({
            terradrawId: "td1",
            featureId: "f1",
            layerId: "L",
            originalGeom: {
                type: "LineString",
                coordinates: [
                    [0, 0],
                    [1, 1],
                ],
            },
        });
        _mockDraw.getSnapshotFeature.mockReturnValue({
            geometry: {
                type: "LineString",
                coordinates: [
                    [0, 0],
                    [2, 2],
                ],
            },
            properties: { id: "f1", mode: "polyline", name: "n" },
        });
        adapterCallbacks.onFinish("td1", "LineString", "dragFeature"); // marks dirty
        adapterCallbacks.onDeselect("td1");

        expect(persist.update).toHaveBeenCalledOnce();
        const [ef] = persist.update.mock.calls[0];
        expect(ef.id).toBe("f1");
        expect(ef.properties).toEqual({ id: "f1", name: "n" });
        await flush();
        expect(wiring.commitHost).toHaveBeenCalledWith("L", "f1", {
            type: "Point",
            coordinates: [9, 9],
        });
        expect(_mockDraw.removeFeatures).toHaveBeenCalledWith(["td1"]);
    });

    it("deselect of a CLEAN host feature → restore + drop copy, no update", () => {
        setSelection({
            terradrawId: "td2",
            featureId: "f2",
            layerId: "L2",
            originalGeom: { type: "Point", coordinates: [0, 0] },
        });
        _mockDraw.getSnapshotFeature.mockReturnValue({
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: {},
        });
        adapterCallbacks.onDeselect("td2");
        expect(persist.update).not.toHaveBeenCalled();
        expect(wiring.showHost).toHaveBeenCalledWith("L2");
        expect(_mockDraw.removeFeatures).toHaveBeenCalledWith(["td2"]);
    });

    it("deselect of a session-drawn feature (no host id) → keep the feature", () => {
        setSelection({
            terradrawId: "td3",
            featureId: "",
            layerId: "",
            originalGeom: { type: "Point", coordinates: [0, 0] },
        });
        adapterCallbacks.onDeselect("td3");
        expect(persist.update).not.toHaveBeenCalled();
        expect(wiring.showHost).not.toHaveBeenCalled();
        expect(_mockDraw.removeFeatures).not.toHaveBeenCalled();
        expect(getSelection()).toBeNull();
    });

    it("dispatchFeatureConflict emits geoleaf:editor:feature-conflict", () => {
        const listener = vi.fn();
        document.addEventListener("geoleaf:editor:feature-conflict", listener);
        dispatchFeatureConflict({
            featureId: "f1",
            layerId: "L",
            localFeature: { geometry: { type: "Point", coordinates: [0, 0] }, properties: {} },
            serverData: {},
        });
        document.removeEventListener("geoleaf:editor:feature-conflict", listener);
        expect(listener).toHaveBeenCalledOnce();
    });
});

// ---------------------------------------------------------------------------
// Anti-drift — EDIT_ACTION_OP must cover Terra Draw's finish-action vocabulary
// ---------------------------------------------------------------------------

// Canonical FinishActions, mirrored from terra-draw (dist/common.d.ts:59-67).
// terra-draw does NOT re-export FinishActions from its package root, so the list
// is duplicated here. On a terra-draw upgrade, re-check that file and update BOTH
// this list AND EDIT_ACTION_OP (events.ts) — this test fails if they diverge,
// which is what guards against the change-type-vs-finish-action confusion that
// silently broke undo for geometry edits.
const TERRA_DRAW_FINISH_ACTIONS = [
    "draw",
    "edit",
    "deleteCoordinate",
    "insertMidpoint",
    "dragCoordinate",
    "dragFeature",
    "dragCoordinateResize",
] as const;

describe("EDIT_ACTION_OP — anti-drift vs Terra Draw FinishActions", () => {
    const editActions = TERRA_DRAW_FINISH_ACTIONS.filter((a) => a !== "draw");

    it("maps every edit gesture to an undo operation type", () => {
        for (const action of editActions) {
            expect(EDIT_ACTION_OP[action], `'${action}' must map to an op type`).toBeDefined();
        }
    });

    it("excludes 'draw' (handled by the creation flow, not the edit map)", () => {
        expect(EDIT_ACTION_OP["draw"]).toBeUndefined();
    });

    it("has no keys beyond the documented gesture vocabulary", () => {
        expect(Object.keys(EDIT_ACTION_OP).sort()).toEqual([...editActions].sort());
    });
});
