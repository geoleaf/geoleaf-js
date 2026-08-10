/*!
 * @geoleaf-plugins/editor — Terra Draw events bridge
 * © 2026 Mattieu Pottier — MIT License
 *
 * Pattern: `adapterCallbacks` is passed as the `callbacks` argument to
 * `createTerraDrawAdapter`. Terra Draw resolves these properties at event
 * fire time, not at registration time, so `initEventsBridge` can safely
 * update them after the adapter is created.
 * https://geoleaf.dev
 */
import type { Geometry } from "geojson";
// Point d'émission UNIQUE et typé — voir `editor-events.ts` pour le faux vert qui l'a
// rendu nécessaire (trois émetteurs sur neuf échappaient au typage).
import { dispatchEditorEvent } from "./editor-events.js";
import type { GeoJSONStoreGeometries } from "terra-draw";
import type { TerraDrawAdapterInstance } from "./drawing/terra-draw-adapter.js";
import type { TerraDrawAdapterCallbacks } from "./drawing/terra-draw-adapter.js";
import type { ModalOpenOptions } from "./modal/editor-form-modal.js";
import { getEditorConfig } from "./config.js";
import { _notify, _getLabel } from "./internal.js";
import {
    getSelection,
    setSelection,
    clearSelection,
    type SelectionSnapshot,
} from "./selection/selection-state.js";
import { vertexCount, applyComputedFields } from "./drawing/geo-compute.js";
import { pushOperation, discardLastOperation, type OperationType } from "./history/undo-stack.js";
import { submitFeature, type SubmitContext } from "./persistence/submit.js";
import type { ConflictStrategy } from "./persistence/conflict-resolution.js";
import type {
    ConflictEventDetail,
    EditorFeature,
    EditorPersistenceAdapter,
} from "./persistence/adapter-interface.js";

/**
 * Persistence + host-reconciliation collaborators, injected by entry.ts at
 * `initEventsBridge`. Absent in unit harnesses that only exercise geometry
 * events — every persistence path guards on its presence.
 */
export interface EditorWiringContext {
    adapter: EditorPersistenceAdapter;
    strategy: ConflictStrategy;
    /** Hides the host original while its copy is edited. */
    hideHost: (layerId: string, featureId: string) => void;
    /** Restores a hidden host original (clears the filter). */
    showHost: (layerId: string) => void;
    /** Commits a geometry to the host source feature. */
    commitHost: (layerId: string, featureId: string, geometry: unknown) => void;
    /** Removes the host source feature. */
    removeHost: (layerId: string, featureId: string) => void;
    /** Repaints the host feature from the server state (server-wins). */
    reloadFeature: (serverData: unknown, layerId: string) => void;
}

// ---------------------------------------------------------------------------
// Terra Draw FinishActions vocabulary
// ---------------------------------------------------------------------------
//
// These are the `action` values carried by Terra Draw's "finish" event
// (terra-draw `FinishActions`, common.d.ts). They are NOT the "change" event's
// store-change type ("create" | "update" | "delete" | "styling", store.d.ts):
// that type carries no gesture information and fires once per coordinate update
// — i.e. repeatedly while dragging. Undo therefore keys off "finish", which
// emits exactly once per completed gesture, so one drag = one undo entry.

/** Genuine drawing completion (creation flow). */
const ACTION_DRAW = "draw";

/**
 * Maps a select-mode finish action to the undo {@link OperationType} it
 * produces. `draw` is intentionally absent — it is the creation flow, handled
 * separately. Exported so the anti-drift test can cross-check these keys against
 * terra-draw's `FinishActions` enum and fail if the two ever diverge again.
 */
export const EDIT_ACTION_OP: Readonly<Record<string, OperationType>> = {
    dragFeature: "move",
    dragCoordinate: "move",
    dragCoordinateResize: "move",
    edit: "move",
    insertMidpoint: "vertex-add",
    deleteCoordinate: "vertex-del",
};

// ---------------------------------------------------------------------------
// Callback bridge — passed to createTerraDrawAdapter as the callbacks object.
// Properties are looked up dynamically at call time, so initEventsBridge can
// update them after the adapter is instantiated.
// ---------------------------------------------------------------------------

/**
 * The live callback set the Terra Draw adapter invokes, mutated in place by
 * `initEventsBridge`.
 *
 * ⚠️ Deliberately a mutable singleton rather than a value passed at construction: the adapter
 * is created lazily, before the bridge has anything to wire, so the four members start as
 * no-ops and are replaced later. Reassigning this binding instead of mutating its members
 * would leave the adapter holding the original object.
 */
export const adapterCallbacks: TerraDrawAdapterCallbacks = {
    onFinish: () => {},
    onChange: () => {},
    onSelect: () => {},
    onDeselect: () => {},
};

// Persistence wiring + per-selection dirty flag (set when a host feature's
// geometry is edited; drives commit-vs-restore on deselect).
let _wiring: EditorWiringContext | null = null;
let _editDirty = false;

// ---------------------------------------------------------------------------
// Initializer
// ---------------------------------------------------------------------------

/**
 * Wires Terra Draw adapter events to editor UI actions.
 * Must be called after `adapter.start()`.
 *
 * @param adapter  - The active TerraDrawAdapterInstance.
 * @param openForm - Opens the attribute form modal (injected from entry.ts to
 *                   avoid a circular import).
 * @param wiring   - Optional host hooks (layer resolution, persistence). When omitted the
 *                   bridge runs standalone: draws are handled, but nothing is written back
 *                   to a host layer.
 */
export function initEventsBridge(
    adapter: TerraDrawAdapterInstance,
    openForm: (options: ModalOpenOptions) => void,
    wiring?: EditorWiringContext
): void {
    _wiring = wiring ?? null;
    adapterCallbacks.onFinish = (id, geometryType, action) =>
        _handleFinish(adapter, openForm, id, geometryType, action);
    // Undo is finish-driven (see EDIT_ACTION_OP): the "change" event carries no
    // gesture type and fires per coordinate update, so it is not consumed here.
    adapterCallbacks.onChange = () => {};
    adapterCallbacks.onSelect = (id) => _handleSelect(adapter, id);
    adapterCallbacks.onDeselect = (_id) => _handleDeselect(adapter);
}

/** Emits `geoleaf:editor:feature-conflict`. Wired as the adapter's onConflict. */
export function dispatchFeatureConflict(detail: ConflictEventDetail): void {
    dispatchEditorEvent("geoleaf:editor:feature-conflict", detail);
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

/**
 * Terra Draw fires "finish" for BOTH a drawing completion (action "draw") and
 * every edit gesture in select mode (dragFeature / dragCoordinate /
 * dragCoordinateResize / insertMidpoint / deleteCoordinate). A genuine draw
 * completion opens the creation flow; every other action is a geometry edit
 * that is recorded on the undo stack.
 */
function _handleFinish(
    adapter: TerraDrawAdapterInstance,
    openForm: (options: ModalOpenOptions) => void,
    id: string,
    geometryType: string,
    action: string
): void {
    if (action === ACTION_DRAW) {
        _handleCreate(adapter, openForm, id, geometryType);
        return;
    }
    const opType = EDIT_ACTION_OP[action];
    if (opType) _handleEdit(adapter, opType);
}

function _handleCreate(
    adapter: TerraDrawAdapterInstance,
    openForm: (options: ModalOpenOptions) => void,
    id: string,
    geometryType: string
): void {
    const feature = adapter.getFeature(id);
    if (!feature || !feature.geometry) return;

    // Return cursor to normal immediately after the feature is closed.
    adapter.setMode(null);

    // Record the creation so it can be undone (geometry is already on the map).
    pushOperation({ type: "create", terradrawId: id, feature, ts: Date.now() });

    // Notify host-page listeners.
    // ⚠️ `id` est inséré CONDITIONNELLEMENT plutôt que passé tel quel. Le moteur de dessin
    // le déclare `id?: string | number | undefined` ; le transmettre en l'état obligerait le
    // contrat à élargir sa propre propriété, ce que `check-exact-optional-debt` refuse — une
    // clé présente valant `undefined` écrase un défaut dans un merge par spread. C'est aussi
    // ce que le round-trip JSON ferait de toute façon : `JSON.stringify` supprime la clé.
    const { id: drawnId, ...drawnRest } = feature;
    dispatchEditorEvent("geoleaf:editor:feature-created", {
        feature: { ...drawnRest, ...(drawnId !== undefined && { id: drawnId }) },
        geometryType,
    });

    // Open the attribute form so the user can fill in properties.
    // The layer dropdown header in the modal lets the user pick the target layer.
    openForm({
        title: "", // empty — modal title uses layer dropdown
        schema: [], // schema resolved per target layer by the modal's getSchemaForLayer
        geometryType,
        initialValues: {},
        // The schema is resolved per target layer inside the modal, so the ids of
        // the `computed` fields are not knowable here — the modal calls back with
        // the resolved schema instead, on open and on every layer change.
        computeValues: (schema) =>
            applyComputedFields(schema, feature.geometry as unknown as Geometry),
        // Returns the persistence promise so the modal stays open (spinner) until
        // it settles: closes on success, stays open on error for a retry.
        onSave: (values, layerId) => {
            if (!_wiring) return;
            return submitFeature(buildSubmitContext(_wiring), {
                feature: _toEditorFeature(feature, values),
                layerId,
                isUpdate: false,
            });
        },
        onCancel: () => {
            // Remove the drawn geometry from the map if user cancels the form,
            // and drop the now-stale create entry from the undo stack.
            adapter.removeFeatures([id]);
            discardLastOperation();
        },
    });
}

function _handleSelect(adapter: TerraDrawAdapterInstance, id: string): void {
    const feature = adapter.getFeature(id);
    if (!feature?.geometry) return;

    // A fresh selection starts clean — only later geometry edits mark it dirty.
    _editDirty = false;

    const geom = feature.geometry as unknown as Geometry;
    const existing = getSelection();

    if (existing) {
        // layer-picker already populated featureId/layerId — just sync terradrawId + geom snapshot.
        setSelection({ ...existing, terradrawId: id, originalGeom: geom });
    } else {
        // Native Terra Draw selection: feature was drawn this session (no host layer id).
        setSelection({ terradrawId: id, featureId: "", layerId: "", originalGeom: geom });
    }
}

/**
 * On deselect (Enter / click-away / mode switch), reconcile the host original:
 *  - dirty host feature → commit the geometry edit (update) + drop the copy;
 *  - clean host feature → restore the original + drop the copy;
 *  - session-drawn feature (no host id) → just clear the selection.
 * Always clears the selection and the dirty flag.
 */
function _handleDeselect(adapter: TerraDrawAdapterInstance): void {
    const snap = getSelection();
    if (snap && snap.featureId && _wiring) {
        const feature = adapter.getFeature(snap.terradrawId);
        if (_editDirty && feature?.geometry) {
            _commitEditedHost(adapter, snap, feature.geometry as unknown as Geometry);
        } else {
            adapter.removeFeatures([snap.terradrawId]);
            _wiring.showHost(snap.layerId);
        }
    }
    clearSelection();
    _editDirty = false;
}

/**
 * Persists an edited host feature on deselect: PUT update → commit host geometry
 * + drop the Terra Draw copy. On hard failure, optimistically commits locally so
 * the edit stays visible (durable offline retry lands in S11); on conflict the
 * resolution flow repaints the host.
 */
function _commitEditedHost(
    adapter: TerraDrawAdapterInstance,
    snap: SelectionSnapshot,
    geom: Geometry
): void {
    if (!_wiring) return;
    const { terradrawId, featureId, layerId } = snap;
    const editorFeature: EditorFeature = {
        id: featureId,
        geometry: geom,
        properties: _hostProps(adapter, terradrawId),
    };
    void submitFeature(buildSubmitContext(_wiring), {
        feature: editorFeature,
        layerId,
        isUpdate: true,
    })
        .then(() => adapter.removeFeatures([terradrawId]))
        .catch(() => {
            _wiring?.commitHost(layerId, featureId, geom);
            adapter.removeFeatures([terradrawId]);
        });
}

/**
 * Records a completed select-mode edit gesture on the undo stack and emits the
 * matching public event. Reads the post-gesture geometry from the store and the
 * pre-gesture geometry from the selection snapshot (advanced after each gesture
 * so chained edits stack correctly).
 */
function _handleEdit(adapter: TerraDrawAdapterInstance, opType: OperationType): void {
    const snap = getSelection();
    if (!snap) return;

    const feature = adapter.getFeature(snap.terradrawId);
    if (!feature?.geometry) return;

    const geom = feature.geometry as unknown as Geometry;

    // A vertex deletion that breaks the minimum-vertex invariant is rolled back
    // and not recorded (the coordinate is already gone from the store at finish).
    if (opType === "vertex-del" && _rollbackIfBelowMinVertices(adapter, snap, geom)) return;

    _pushGeomOp(opType, snap.terradrawId, snap.featureId, snap.layerId, snap.originalGeom, geom);
    _dispatchEditEvent(opType, snap, geom);

    // Mark the selection dirty so deselect commits the edit to the host source.
    if (snap.featureId) _editDirty = true;

    // Advance the snapshot so the next gesture compares against the latest geometry.
    setSelection({ ...snap, originalGeom: geom });
}

/**
 * Restores the snapshot geometry when a coordinate deletion would drop the
 * feature below its minimum vertex count. Returns true when a rollback happened
 * (so the caller skips recording an undo entry), false otherwise.
 */
function _rollbackIfBelowMinVertices(
    adapter: TerraDrawAdapterInstance,
    snap: SelectionSnapshot,
    geom: Geometry
): boolean {
    if (geom.type === "Point") return false;
    const cfg = getEditorConfig();
    const min =
        geom.type === "LineString"
            ? (cfg.minVerticesLineString ?? 2)
            : (cfg.minVerticesPolygon ?? 3);
    if (vertexCount(geom) >= min) return false;

    adapter.updateFeatureGeometry(
        snap.terradrawId,
        snap.originalGeom as unknown as Parameters<
            TerraDrawAdapterInstance["updateFeatureGeometry"]
        >[1]
    );
    _showMinVerticesWarning();
    return true;
}

/** Emits the public event matching a recorded edit operation. */
function _dispatchEditEvent(opType: OperationType, snap: SelectionSnapshot, geom: Geometry): void {
    const { featureId, layerId } = snap;
    if (opType === "vertex-add") {
        dispatchEditorEvent("geoleaf:editor:vertex-added", {
            featureId,
            layerId,
            vertexCount: vertexCount(geom),
            newGeom: geom,
        });
    } else if (opType === "vertex-del") {
        dispatchEditorEvent("geoleaf:editor:vertex-deleted", {
            featureId,
            layerId,
            vertexCount: vertexCount(geom),
            newGeom: geom,
        });
    } else {
        // "move" — whole-feature drag or single-vertex drag.
        dispatchEditorEvent("geoleaf:editor:feature-moved", {
            featureId,
            layerId,
            oldGeom: snap.originalGeom,
            newGeom: geom,
        });
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds the persistence {@link SubmitContext} from the injected wiring. */
/**
 * Projects a wiring context onto the narrower {@link SubmitContext} the persistence
 * layer consumes.
 *
 * ⚠️ Exported for `add-form/placement-form.ts` — the placement path submits the very same
 * way as a Terra Draw create, but it must NOT read this module's `_wiring`: that field is
 * only set by {@link initEventsBridge}, which runs when the drawing engine is lazily
 * loaded on first tool use. A user who taps "add a POI" without ever arming a tool would
 * hit a null wiring and lose the entry in silence — the class B-128 already cost once.
 * The placement path therefore builds its wiring from `entry.ts`, which has it at boot.
 *
 * @param wiring - The live wiring context.
 * @returns the submit context bound to it.
 */
export function buildSubmitContext(wiring: EditorWiringContext): SubmitContext {
    return {
        adapter: wiring.adapter,
        strategy: wiring.strategy,
        commitHost: wiring.commitHost,
        reloadFeature: wiring.reloadFeature,
        dispatchSaved: (detail) => dispatchEditorEvent("geoleaf:editor:feature-saved", detail),
    };
}

/** Maps a Terra Draw feature + form values to an {@link EditorFeature} (create). */
function _toEditorFeature(
    feature: { geometry: unknown; properties?: Record<string, unknown> },
    values: Record<string, unknown>
): EditorFeature {
    return { geometry: feature.geometry as Geometry, properties: values };
}

/** Reads a host feature's persisted attributes, stripping the internal `mode` key. */
function _hostProps(
    adapter: TerraDrawAdapterInstance,
    terradrawId: string
): Record<string, unknown> {
    const feature = adapter.getFeature(terradrawId);
    const props = { ...(feature?.properties ?? {}) } as Record<string, unknown>;
    delete props["mode"];
    return props;
}

/**
 * Records a geometry mutation on the undo stack. Called only after the
 * guard-rail check passes, so a vertex deletion rolled back for violating the
 * minimum-vertex invariant never produces an undo entry (no double rollback).
 */
function _pushGeomOp(
    type: OperationType,
    terradrawId: string,
    featureId: string,
    layerId: string,
    oldGeom: Geometry,
    newGeom: Geometry
): void {
    pushOperation({
        type,
        terradrawId,
        featureId,
        layerId,
        oldGeom: oldGeom as unknown as GeoJSONStoreGeometries,
        newGeom: newGeom as unknown as GeoJSONStoreGeometries,
        ts: Date.now(),
    });
}

function _showMinVerticesWarning(): void {
    _notify("warn", _getLabel("editor.error.minVertices"));
}
