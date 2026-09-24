/*!
 * Tests — abandoning a drawn shape that awaits its form (`GeoLeaf.Editor.discardDraft`).
 *
 * Three moments a host can abandon it at, and each once went wrong:
 *   • inside its `geoleaf:editor:feature-created` listener — BEFORE the form exists, since the
 *     event is dispatched synchronously ahead of it: the form must then never open;
 *   • while the form is open — the form closes and its cancel does the cleanup;
 *   • while the form's write is in flight — refused, or a saved shape would be wiped.
 * And the cancel itself must remove THIS shape's entries, not whatever tops the stack.
 * Same Terra Draw mock harness as `events.test.ts`.
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
    pushOperation,
    topUndoType,
    undo,
} from "../history/undo-stack.js";
import { clearSelection } from "../selection/selection-state.js";
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

/** The drawing engine holds `abc` until something removes it — as Terra Draw does. */
function _holdFeature(): void {
    let present = true;
    _mockDraw.getSnapshotFeature.mockImplementation((id: unknown) =>
        present && id === "abc" ? FEATURE : undefined
    );
    _mockDraw.removeFeatures.mockImplementation((ids: unknown[]) => {
        // Terra Draw throws on an id it does not hold.
        if (!present || !ids.includes("abc")) throw new Error("No feature with id abc");
        present = false;
    });
}

/** An `openForm` whose returned closer behaves as a forced modal close: it fires the cancel. */
function _formThatCloses() {
    return vi.fn((opts: ModalOpenOptions) => () => opts.onCancel?.());
}

describe("discardDraft — a drawn shape awaiting its form", () => {
    let adapter: Awaited<ReturnType<typeof createTerraDrawAdapter>>;

    beforeEach(async () => {
        vi.clearAllMocks();
        _mockDraw.getSnapshotFeature.mockReset();
        _mockDraw.removeFeatures.mockReset();
        clearSelection();
        discardDraft();
        adapter = await createTerraDrawAdapter(_mockMap(), _cfg(), adapterCallbacks);
        adapter.start();
        initUndoStack(adapter, _cfg());
        clearHistory();
        _holdFeature();
    });

    it("dans l'auditeur de feature-created : le formulaire ne s'ouvre pas, la forme part", () => {
        const openForm = _formThatCloses();
        initEventsBridge(adapter, openForm);
        let answered: boolean | undefined;
        const onCreated = (e: Event) => {
            answered = discardDraft((e as CustomEvent).detail.feature.id);
        };
        document.addEventListener("geoleaf:editor:feature-created", onCreated);
        try {
            adapterCallbacks.onFinish("abc", "Point", "draw");
        } finally {
            document.removeEventListener("geoleaf:editor:feature-created", onCreated);
        }
        expect(answered).toBe(true);
        expect(openForm).not.toHaveBeenCalled();
        expect(_mockDraw.removeFeatures).toHaveBeenCalledWith(["abc"]);
        expect(getUndoDepth()).toBe(0);
    });

    it("formulaire ouvert : il se ferme, la forme et son entrée d'historique partent", () => {
        const openForm = _formThatCloses();
        initEventsBridge(adapter, openForm);
        adapterCallbacks.onFinish("abc", "Point", "draw");
        expect(openForm).toHaveBeenCalledOnce();
        expect(discardDraft("abc")).toBe(true);
        expect(_mockDraw.removeFeatures).toHaveBeenCalledWith(["abc"]);
        expect(getUndoDepth()).toBe(0);
        expect(discardDraft()).toBe(false);
    });

    it("refuse un autre identifiant, et la forme reste", () => {
        initEventsBridge(adapter, _formThatCloses());
        adapterCallbacks.onFinish("abc", "Point", "draw");
        expect(discardDraft("xyz")).toBe(false);
        expect(_mockDraw.removeFeatures).not.toHaveBeenCalled();
    });

    // Ctrl+Z reaches the stack while the form is open (focus on a button of the modal): the
    // creation is undone — the shape already gone — then the user cancels.
    it("annuler après un Ctrl+Z ne lève pas, et ne retire que les entrées de CETTE forme", () => {
        const openForm = vi.fn();
        initEventsBridge(adapter, openForm);
        pushOperation({ type: "move", terradrawId: "td-2", ts: 1 } as never);
        adapterCallbacks.onFinish("abc", "Point", "draw");
        undo();
        const opts = openForm.mock.calls[0]?.[0] as ModalOpenOptions;
        expect(() => opts.onCancel?.()).not.toThrow();
        expect(getUndoDepth()).toBe(1);
        expect(topUndoType()).toBe("move");
        expect(getRedoDepth()).toBe(0);
    });

    it("refuse pendant l'écriture, et la forme enregistrée n'est plus un brouillon", async () => {
        let settle!: (v: unknown) => void;
        const wiring = {
            adapter: {
                save: vi.fn(() => new Promise((resolve) => (settle = resolve))),
                update: vi.fn(),
            },
            strategy: "server-wins",
            hideHost: vi.fn(),
            showHost: vi.fn(),
            commitHost: vi.fn(),
            removeHost: vi.fn(),
            reloadFeature: vi.fn(),
        } as unknown as EditorWiringContext;
        const openForm = vi.fn();
        initEventsBridge(adapter, openForm, wiring);
        adapterCallbacks.onFinish("abc", "Point", "draw");
        const opts = openForm.mock.calls[0]?.[0] as ModalOpenOptions;
        const write = opts.onSave?.({ name: "x" }, "layer-1");
        expect(discardDraft()).toBe(false);
        settle({ id: "srv-1", geometry: FEATURE.geometry, properties: {} });
        await write;
        expect(discardDraft()).toBe(false);
        expect(_mockDraw.removeFeatures).not.toHaveBeenCalled();
    });
});
