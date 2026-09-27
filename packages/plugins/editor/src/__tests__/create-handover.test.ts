/*!
 * Tests — a drawn feature whose creation has been written is HANDED OVER to its host layer.
 *
 * 🛑 THE DEFECT: the shape stayed in the drawing layer after its save, selectable with no
 * identity — its moves were never persisted, and deleting it left its creation queued, back
 * at the next load. Once the host layer holds the feature (`addHost` → `true`), the drawing
 * copy goes, and the feature is selected through its layer like any other.
 *
 * ⚠️ Three ways the hand-over could hurt, each pinned here: a selection still naming the gone
 * shape (the next delete would throw), a redo while the form was open (the shape then carries
 * a NEW id, and the old one misses it), and a layer that could not take the feature (the
 * drawing is then all there is, and must stay).
 * Same Terra Draw mock harness as `discard-draft.test.ts`.
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
import { adapterCallbacks, initEventsBridge, type EditorWiringContext } from "../events.js";
import { discardDraft } from "../draft-state.js";
import {
    clearHistory,
    getRedoDepth,
    getUndoDepth,
    initUndoStack,
    redo,
    undo,
} from "../history/undo-stack.js";
import { clearSelection, getSelection, setSelection } from "../selection/selection-state.js";
import type { ModalOpenOptions } from "../modal/editor-form-modal.js";
import type { EditorConfig } from "../types.js";

function _cfg(): EditorConfig {
    return {
        enabled: true,
        enabledTools: ["point", "line", "polyline", "polygon", "select", "undo", "redo", "delete"],
        snapPx: 12,
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

const FEATURE = { id: "abc", geometry: { type: "Point", coordinates: [0, 0] } };
const SAVED = { id: "loc:1", layerId: "layer-1", geometry: FEATURE.geometry, properties: {} };

/** The drawing engine's store: the ids it holds, and a throw on any other — as Terra Draw. */
const _held = new Set<string>();

function _holdFeatures(): void {
    _held.clear();
    _held.add("abc");
    _mockDraw.getSnapshotFeature.mockImplementation((id: unknown) =>
        _held.has(String(id)) ? { ...FEATURE, id } : undefined
    );
    _mockDraw.removeFeatures.mockImplementation((ids: unknown[]) => {
        for (const id of ids) {
            if (!_held.delete(String(id))) throw new Error(`No feature with id ${String(id)}`);
        }
    });
    // A redo re-adds the shape, which the engine stores under a NEW id.
    _mockDraw.addFeatures.mockImplementation(() => {
        _held.add("td-42");
        return [{ id: "td-42" }];
    });
}

function _wiring(addHost?: EditorWiringContext["addHost"]): EditorWiringContext {
    return {
        adapter: { save: vi.fn(async () => SAVED), update: vi.fn() },
        strategy: "server-wins",
        hideHost: vi.fn(),
        showHost: vi.fn(),
        commitHost: vi.fn(),
        ...(addHost && { addHost }),
        removeHost: vi.fn(),
        reloadFeature: vi.fn(),
    } as unknown as EditorWiringContext;
}

/** Draws `abc`, and returns the options its form was opened with. */
function _draw(wiring: EditorWiringContext): ModalOpenOptions {
    const openForm = vi.fn();
    initEventsBridge(adapter, openForm, wiring);
    adapterCallbacks.onFinish("abc", "Point", "draw");
    return openForm.mock.calls[0]?.[0] as ModalOpenOptions;
}

let adapter: Awaited<ReturnType<typeof createTerraDrawAdapter>>;

beforeEach(async () => {
    vi.clearAllMocks();
    _mockDraw.getSnapshotFeature.mockReset();
    _mockDraw.removeFeatures.mockReset();
    _mockDraw.addFeatures.mockReset();
    clearSelection();
    discardDraft();
    adapter = await createTerraDrawAdapter(_mockMap(), _cfg(), adapterCallbacks);
    adapter.start();
    initUndoStack(adapter, _cfg());
    clearHistory();
    _holdFeatures();
});

describe("a created feature its layer now holds leaves the drawing", () => {
    it("🛑 the drawing copy goes, and nothing of it remains undoable", async () => {
        const addHost = vi.fn(() => true);
        const opts = _draw(_wiring(addHost));

        await opts.onSave?.({ name: "x" }, "layer-1");

        expect(addHost).toHaveBeenCalledWith("layer-1", SAVED);
        expect(_held.has("abc")).toBe(false);
        expect(getUndoDepth()).toBe(0);
    });

    it("a layer that could NOT take it keeps the drawing — it is all there is", async () => {
        const opts = _draw(_wiring(vi.fn(() => false)));
        await opts.onSave?.({ name: "x" }, "layer-1");
        expect(_held.has("abc")).toBe(true);
    });

    it("without `addHost` wired, the drawing stays — as before", async () => {
        const opts = _draw(_wiring());
        await opts.onSave?.({ name: "x" }, "layer-1");
        expect(_held.has("abc")).toBe(true);
    });

    it("🛑 a selection still naming the shape is cleared — the next delete would throw on it", async () => {
        const opts = _draw(_wiring(() => true));
        setSelection({
            terradrawId: "abc",
            featureId: "",
            layerId: "",
            originalGeom: FEATURE.geometry as never,
        });

        await opts.onSave?.({ name: "x" }, "layer-1");

        expect(getSelection()).toBeNull();
    });

    it("🛑 undo then redo while the form is open: the REDRAWN shape is the one handed over", async () => {
        const opts = _draw(_wiring(() => true));
        undo(); // the shape leaves the screen…
        redo(); // …and comes back as `td-42`
        expect(_held.has("td-42")).toBe(true);

        await opts.onSave?.({ name: "x" }, "layer-1");

        // Before: sealed and removed under `abc`, which no longer exists — the redrawn shape
        // stayed beside the feature its layer draws, and its `create` stayed undoable.
        expect(_held.size).toBe(0);
        expect(getUndoDepth()).toBe(0);
        expect(getRedoDepth()).toBe(0);
    });

    it("🛑 undo then redo, then CANCEL: the redrawn shape goes with its entries", () => {
        const opts = _draw(_wiring(() => true));
        undo();
        redo();

        expect(() => opts.onCancel?.()).not.toThrow();

        expect(_held.size).toBe(0);
        expect(getUndoDepth()).toBe(0);
    });

    it("the drawing engine failing on removal does not fail a write that has left", async () => {
        const opts = _draw(_wiring(() => true));
        _mockDraw.removeFeatures.mockImplementation(() => {
            throw new Error("engine stopped");
        });
        await expect(opts.onSave?.({ name: "x" }, "layer-1")).resolves.toBeUndefined();
    });
});
