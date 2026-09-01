/*!
 * @geoleaf-plugins/editor — Undo / redo operation stack
 * © 2026 Mattieu Pottier — MIT License
 *
 * Custom operation stack — the single source of truth for editor undo/redo.
 * Terra Draw's native undo only covers coordinate edits *during* drawing; it
 * does not track committed edits, deletions, or (later) attribute changes, so
 * the editor drives its own stack and applies inverses through the adapter
 * (`updateFeatureGeometry` / `addFeature` / `removeFeatures`). Native Terra
 * Draw undo is intentionally NOT used, to avoid desyncing the two histories.
 * https://geoleaf.dev
 */
import type { GeoJSONStoreFeatures, GeoJSONStoreGeometries } from "terra-draw";
import type { TerraDrawAdapterInstance } from "../drawing/terra-draw-adapter.js";
import type { EditorConfig } from "../types.js";
import { getSelection, setSelection, clearSelection } from "../selection/selection-state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Undoable mutation kinds.
 * `create` / `move` / `vertex-add` / `vertex-del` / `delete` are produced in
 * Sprint S9 (geometry mutations emitted by `events.ts`). `attr-change` is
 * declared but reserved for Sprint S10 — attribute rollback lands with the
 * form-save / persistence flow.
 */
export type OperationType =
    "create" | "move" | "vertex-add" | "vertex-del" | "attr-change" | "delete";

/**
 * A single undoable operation. The inverse is derived per-type at apply time
 * rather than stored as a closure (keeps operations plain-data and testable).
 */
export interface Operation {
    /** Mutation kind — selects how the inverse is applied. */
    type: OperationType;
    /** Terra Draw feature ID this op targets. Remapped if the feature is re-added. */
    terradrawId: string;
    /** Host-layer feature ID (for events / future persistence). */
    featureId?: string;
    /** Host MapLibre layer ID. */
    layerId?: string;
    /** Full feature snapshot — required for `create` / `delete` re-add. */
    feature?: GeoJSONStoreFeatures;
    /** Geometry before the change — used by `move` / `vertex-*` undo. */
    oldGeom?: GeoJSONStoreGeometries;
    /** Geometry after the change — used by `move` / `vertex-*` redo. */
    newGeom?: GeoJSONStoreGeometries;
    /** Creation timestamp (ms epoch) — supplied by the caller. */
    ts: number;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _adapter: TerraDrawAdapterInstance | null = null;
let _maxSize = 100;
let _onChange: (() => void) | null = null;
const _undo: Operation[] = [];
const _redo: Operation[] = [];

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Binds the stack to the active adapter and resets it.
 * @param adapter  - Active Terra Draw adapter used to apply inverses.
 * @param cfg      - Editor config (reads `undoStackSize`, min 1).
 * @param onChange - Called after every stack mutation so the UI can refresh
 *                   button states / tooltips.
 */
export function initUndoStack(
    adapter: TerraDrawAdapterInstance,
    cfg: EditorConfig,
    onChange?: () => void
): void {
    _adapter = adapter;
    _maxSize = Math.max(1, cfg.undoStackSize ?? 100);
    _onChange = onChange ?? null;
    _undo.length = 0;
    _redo.length = 0;
    _notify();
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Records a new operation, clearing the redo stack and enforcing the cap. */
export function pushOperation(op: Operation): void {
    _undo.push(op);
    if (_undo.length > _maxSize) _undo.shift(); // drop oldest
    _redo.length = 0; // a fresh action invalidates the redo branch
    _notify();
}

/** Undoes the most recent operation by applying its inverse. No-op if empty. */
export function undo(): void {
    const op = _undo.pop();
    if (!op) return;
    _applyInverse(op);
    _redo.push(op);
    _notify();
}

/** Re-applies the most recently undone operation. No-op if empty. */
export function redo(): void {
    const op = _redo.pop();
    if (!op) return;
    _applyForward(op);
    _undo.push(op);
    _notify();
}

/**
 * Drops the most recent operation WITHOUT applying its inverse.
 * Used when a just-created feature is discarded (e.g. form cancelled): the
 * caller already removes the geometry, so the stale `create` entry must be
 * popped to keep the stack consistent.
 */
export function discardLastOperation(): void {
    if (_undo.pop()) _notify();
}

/** Empties both stacks (called on plugin destroy). */
export function clearHistory(): void {
    _undo.length = 0;
    _redo.length = 0;
    _notify();
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Whether anything is available to undo.
 *
 * Cheap enough to call on every render — it reads a length, it does not inspect the entries.
 *
 * @returns `true` when the undo stack is non-empty.
 */
export function canUndo(): boolean {
    return _undo.length > 0;
}

/**
 * Whether anything is available to redo.
 *
 * ⚠️ The redo stack is cleared by any new operation, so this flips to `false` as soon as the
 * user draws again after an undo — the usual reason a redo button greys out unexpectedly.
 *
 * @returns `true` when the redo stack is non-empty.
 */
export function canRedo(): boolean {
    return _redo.length > 0;
}

/** Type of the operation that would be undone next, or null if none. */
export function topUndoType(): OperationType | null {
    // Branch on the value, not on the length: same single branch, and the narrowing is real.
    const top = _undo[_undo.length - 1];
    return top ? top.type : null;
}

/** Type of the operation that would be redone next, or null if none. */
export function topRedoType(): OperationType | null {
    const top = _redo[_redo.length - 1];
    return top ? top.type : null;
}

/**
 * Current undo depth.
 *
 * Deliberately exported with no production caller: `_undo` is module-private and
 * this is the only way a test can assert a *count* rather than the boolean
 * `canUndo()`. PLUGINS S4 flagged it as dead and kept it — dropping it would have
 * rewritten 13 assertions into weaker ones to satisfy a dead-export sweep.
 */
export function getUndoDepth(): number {
    return _undo.length;
}

/** Current redo depth. Same rationale as {@link getUndoDepth}. */
export function getRedoDepth(): number {
    return _redo.length;
}

// ---------------------------------------------------------------------------
// Apply — inverse (undo) and forward (redo)
// ---------------------------------------------------------------------------

function _applyInverse(op: Operation): void {
    if (!_adapter) return;
    switch (op.type) {
        case "create":
            _adapter.removeFeatures([op.terradrawId]);
            _clearSelectionIf(op.terradrawId);
            break;
        case "delete":
            _readd(op);
            break;
        case "move":
        case "vertex-add":
        case "vertex-del":
            if (op.oldGeom) _adapter.updateFeatureGeometry(op.terradrawId, op.oldGeom);
            break;
        case "attr-change":
            // Reserved for S10 — attribute rollback lands with the form-save flow.
            break;
    }
}

function _applyForward(op: Operation): void {
    if (!_adapter) return;
    switch (op.type) {
        case "create":
            _readd(op);
            break;
        case "delete":
            _adapter.removeFeatures([op.terradrawId]);
            _clearSelectionIf(op.terradrawId);
            break;
        case "move":
        case "vertex-add":
        case "vertex-del":
            if (op.newGeom) _adapter.updateFeatureGeometry(op.terradrawId, op.newGeom);
            break;
        case "attr-change":
            // Reserved for S10.
            break;
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Re-adds a feature and propagates the newly assigned Terra Draw ID across both
 * stacks (and the active selection), since `addFeature` reassigns IDs.
 */
function _readd(op: Operation): void {
    if (!_adapter || !op.feature) return;
    const oldId = op.terradrawId;
    const newId = _adapter.addFeature(op.feature);
    if (newId && newId !== oldId) {
        // The op is currently off-stack (being applied), so update it directly,
        // then propagate to any sibling ops / the selection still on the stacks.
        op.terradrawId = newId;
        _remapId(oldId, newId);
    }
}

function _remapId(oldId: string, newId: string): void {
    for (const o of _undo) if (o.terradrawId === oldId) o.terradrawId = newId;
    for (const o of _redo) if (o.terradrawId === oldId) o.terradrawId = newId;
    const sel = getSelection();
    if (sel && sel.terradrawId === oldId) setSelection({ ...sel, terradrawId: newId });
}

function _clearSelectionIf(terradrawId: string): void {
    const sel = getSelection();
    if (sel && sel.terradrawId === terradrawId) clearSelection();
}

function _notify(): void {
    _onChange?.();
}
