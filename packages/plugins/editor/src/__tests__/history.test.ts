/*!
 * Tests — Sprint S9 : undo-stack, shortcuts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
    initUndoStack,
    pushOperation,
    undo,
    redo,
    canUndo,
    canRedo,
    clearHistory,
    discardLastOperation,
    topUndoType,
    topRedoType,
    getUndoDepth,
    getRedoDepth,
    type Operation,
} from "../history/undo-stack.js";

import { attachShortcuts, detachShortcuts } from "../history/shortcuts.js";

import { setSelection, clearSelection, getSelection } from "../selection/selection-state.js";

import type { TerraDrawAdapterInstance } from "../drawing/terra-draw-adapter.js";
import type { EditorTool, EditorConfig } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const _POINT = { type: "Point", coordinates: [2.35, 48.85] } as never;
const _POINT2 = { type: "Point", coordinates: [3.0, 49.0] } as never;

function _op(over: Partial<Operation>): Operation {
    return { type: "create", terradrawId: "td-1", ts: 1, ...over } as Operation;
}

function _cfg(over?: Partial<EditorConfig>): EditorConfig {
    return { undoStackSize: 100, ...over } as EditorConfig;
}

// ---------------------------------------------------------------------------
// undo-stack — core behaviour
// ---------------------------------------------------------------------------

describe("undo-stack — push / undo / redo", () => {
    beforeEach(() => {
        clearSelection();
        initUndoStack(_mockAdapter(), _cfg());
    });

    it("is empty after init", () => {
        expect(canUndo()).toBe(false);
        expect(canRedo()).toBe(false);
        expect(getUndoDepth()).toBe(0);
    });

    it("push makes undo available and clears redo", () => {
        pushOperation(_op({ feature: _POINT }));
        expect(canUndo()).toBe(true);
        expect(canRedo()).toBe(false);
        expect(topUndoType()).toBe("create");
    });

    it("undo moves the op to the redo stack", () => {
        pushOperation(_op({ feature: _POINT }));
        undo();
        expect(canUndo()).toBe(false);
        expect(canRedo()).toBe(true);
        expect(topRedoType()).toBe("create");
    });

    it("redo moves the op back to the undo stack", () => {
        pushOperation(_op({ feature: _POINT }));
        undo();
        redo();
        expect(canUndo()).toBe(true);
        expect(canRedo()).toBe(false);
    });

    it("a fresh push clears the redo branch", () => {
        pushOperation(_op({ feature: _POINT }));
        undo();
        expect(canRedo()).toBe(true);
        pushOperation(_op({ terradrawId: "td-2", feature: _POINT2 }));
        expect(canRedo()).toBe(false);
    });

    it("undo / redo on empty stacks are no-ops", () => {
        expect(() => undo()).not.toThrow();
        expect(() => redo()).not.toThrow();
        expect(getUndoDepth()).toBe(0);
        expect(getRedoDepth()).toBe(0);
    });

    it("clearHistory empties both stacks", () => {
        pushOperation(_op({ feature: _POINT }));
        undo();
        clearHistory();
        expect(canUndo()).toBe(false);
        expect(canRedo()).toBe(false);
    });

    it("discardLastOperation pops without applying an inverse", () => {
        const adapter = _mockAdapter();
        initUndoStack(adapter, _cfg());
        pushOperation(_op({ feature: _POINT }));
        discardLastOperation();
        expect(canUndo()).toBe(false);
        expect(adapter.removeFeatures).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// undo-stack — size cap
// ---------------------------------------------------------------------------

describe("undo-stack — undoStackSize cap", () => {
    it("drops the oldest operation beyond the cap", () => {
        initUndoStack(_mockAdapter(), _cfg({ undoStackSize: 3 }));
        for (let i = 0; i < 5; i++) pushOperation(_op({ terradrawId: `td-${i}`, feature: _POINT }));
        expect(getUndoDepth()).toBe(3);
    });

    it("clamps a zero/invalid size to 1", () => {
        initUndoStack(_mockAdapter(), _cfg({ undoStackSize: 0 }));
        pushOperation(_op({ terradrawId: "a", feature: _POINT }));
        pushOperation(_op({ terradrawId: "b", feature: _POINT }));
        expect(getUndoDepth()).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// undo-stack — inverse application per type
// ---------------------------------------------------------------------------

describe("undo-stack — inverse application", () => {
    beforeEach(() => clearSelection());

    it("create: undo removes, redo re-adds", () => {
        const adapter = _mockAdapter();
        initUndoStack(adapter, _cfg());
        pushOperation(_op({ type: "create", terradrawId: "td-7", feature: _POINT }));
        undo();
        expect(adapter.removeFeatures).toHaveBeenCalledWith(["td-7"]);
        redo();
        expect(adapter.addFeature).toHaveBeenCalledWith(_POINT);
    });

    it("delete: undo re-adds, redo removes", () => {
        const adapter = _mockAdapter({ addFeature: vi.fn((): string | null => "td-7") });
        initUndoStack(adapter, _cfg());
        pushOperation(_op({ type: "delete", terradrawId: "td-7", feature: _POINT }));
        undo();
        expect(adapter.addFeature).toHaveBeenCalledWith(_POINT);
        redo();
        expect(adapter.removeFeatures).toHaveBeenCalledWith(["td-7"]);
    });

    it("move: undo restores oldGeom, redo applies newGeom", () => {
        const adapter = _mockAdapter();
        initUndoStack(adapter, _cfg());
        pushOperation(
            _op({ type: "move", terradrawId: "td-3", oldGeom: _POINT, newGeom: _POINT2 })
        );
        undo();
        expect(adapter.updateFeatureGeometry).toHaveBeenLastCalledWith("td-3", _POINT);
        redo();
        expect(adapter.updateFeatureGeometry).toHaveBeenLastCalledWith("td-3", _POINT2);
    });

    it("vertex-add / vertex-del also route through updateFeatureGeometry", () => {
        const adapter = _mockAdapter();
        initUndoStack(adapter, _cfg());
        pushOperation(
            _op({ type: "vertex-add", terradrawId: "v", oldGeom: _POINT, newGeom: _POINT2 })
        );
        undo();
        expect(adapter.updateFeatureGeometry).toHaveBeenCalledWith("v", _POINT);
    });

    it("attr-change is a no-op in S9 (reserved for S10)", () => {
        const adapter = _mockAdapter();
        initUndoStack(adapter, _cfg());
        pushOperation(_op({ type: "attr-change", terradrawId: "a" }));
        undo();
        expect(adapter.removeFeatures).not.toHaveBeenCalled();
        expect(adapter.addFeature).not.toHaveBeenCalled();
        expect(adapter.updateFeatureGeometry).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// undo-stack — Terra Draw ID remapping after re-add
// ---------------------------------------------------------------------------

describe("undo-stack — ID remapping", () => {
    beforeEach(() => clearSelection());

    it("remaps subsequent ops + selection when addFeature reassigns the ID", () => {
        const adapter = _mockAdapter({ addFeature: vi.fn((): string | null => "td-REASSIGNED") });
        initUndoStack(adapter, _cfg());

        // A delete of td-1, then a move that references the same td-1.
        pushOperation(_op({ type: "delete", terradrawId: "td-1", feature: _POINT }));
        pushOperation(
            _op({ type: "move", terradrawId: "td-1", oldGeom: _POINT, newGeom: _POINT2 })
        );
        setSelection({ terradrawId: "td-1", featureId: "f1", layerId: "l1", originalGeom: _POINT });

        // Undo the move first (top of stack), then the delete → triggers re-add + remap.
        undo();
        undo();

        expect(adapter.addFeature).toHaveBeenCalledWith(_POINT);
        // Selection pointing at the old ID was remapped by the re-add.
        expect(getSelection()?.terradrawId).toBe("td-REASSIGNED");
        // Redo replays the delete forward — it must target the reassigned ID,
        // proving the remap propagated across the stacks.
        redo();
        expect(adapter.removeFeatures).toHaveBeenLastCalledWith(["td-REASSIGNED"]);
    });

    it("create undo clears a matching selection", () => {
        const adapter = _mockAdapter();
        initUndoStack(adapter, _cfg());
        pushOperation(_op({ type: "create", terradrawId: "td-9", feature: _POINT }));
        setSelection({ terradrawId: "td-9", featureId: "", layerId: "", originalGeom: _POINT });
        undo();
        expect(getSelection()).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// undo-stack — onChange notifications
// ---------------------------------------------------------------------------

describe("undo-stack — onChange callback", () => {
    it("fires on init, push, undo, redo and clear", () => {
        const onChange = vi.fn();
        initUndoStack(_mockAdapter(), _cfg(), onChange); // 1 (init)
        onChange.mockClear();
        pushOperation(_op({ feature: _POINT })); // 1
        undo(); // 2
        redo(); // 3
        clearHistory(); // 4
        expect(onChange).toHaveBeenCalledTimes(4);
    });
});

// ---------------------------------------------------------------------------
// shortcuts
// ---------------------------------------------------------------------------

describe("shortcuts", () => {
    let onUndo: ReturnType<typeof vi.fn<() => void>>;
    let onRedo: ReturnType<typeof vi.fn<() => void>>;

    beforeEach(() => {
        detachShortcuts();
        onUndo = vi.fn<() => void>();
        onRedo = vi.fn<() => void>();
        attachShortcuts({ onUndo, onRedo });
    });

    function _key(opts: KeyboardEventInit, target?: EventTarget): boolean {
        const ev = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...opts });
        (target ?? document).dispatchEvent(ev);
        return ev.defaultPrevented;
    }

    it("Ctrl+Z triggers undo and preventDefault", () => {
        const prevented = _key({ key: "z", ctrlKey: true });
        expect(onUndo).toHaveBeenCalledOnce();
        expect(prevented).toBe(true);
    });

    it("Cmd+Z (metaKey) triggers undo", () => {
        _key({ key: "z", metaKey: true });
        expect(onUndo).toHaveBeenCalledOnce();
    });

    it("Ctrl+Shift+Z triggers redo", () => {
        _key({ key: "z", ctrlKey: true, shiftKey: true });
        expect(onRedo).toHaveBeenCalledOnce();
        expect(onUndo).not.toHaveBeenCalled();
    });

    it("Ctrl+Y triggers redo", () => {
        _key({ key: "y", ctrlKey: true });
        expect(onRedo).toHaveBeenCalledOnce();
    });

    it("plain Z (no modifier) is ignored", () => {
        _key({ key: "z" });
        expect(onUndo).not.toHaveBeenCalled();
        expect(onRedo).not.toHaveBeenCalled();
    });

    it("is ignored while an input has focus", () => {
        const input = document.createElement("input");
        document.body.appendChild(input);
        _key({ key: "z", ctrlKey: true }, input);
        expect(onUndo).not.toHaveBeenCalled();
        input.remove();
    });

    it("is ignored while a textarea has focus", () => {
        const ta = document.createElement("textarea");
        document.body.appendChild(ta);
        _key({ key: "z", ctrlKey: true }, ta);
        expect(onUndo).not.toHaveBeenCalled();
        ta.remove();
    });

    it("is ignored inside a contenteditable element", () => {
        const div = document.createElement("div");
        div.setAttribute("contenteditable", "true");
        Object.defineProperty(div, "isContentEditable", { value: true });
        document.body.appendChild(div);
        _key({ key: "z", ctrlKey: true }, div);
        expect(onUndo).not.toHaveBeenCalled();
        div.remove();
    });

    it("detachShortcuts removes the listener", () => {
        detachShortcuts();
        _key({ key: "z", ctrlKey: true });
        expect(onUndo).not.toHaveBeenCalled();
    });
});
