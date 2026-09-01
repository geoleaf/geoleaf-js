/*!
 * @geoleaf-plugins/editor — "Add a POI" capture flow
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * The capture-to-form path behind `GeoLeaf.Editor.AddForm`, and the orchestration that
 * feeds it: pick a position (GPS fix or a map tap), then open the attribute form on a
 * brand-new Point.
 *
 * ## Why this file exists
 *
 * The core's `poi-addform-seam.ts` seam had **two halves** — `PlacementMode`
 * and `AddForm`. The first was absorbed earlier; this writes the second, which
 * existed **nowhere** in `editor`: its form was only reachable through the
 * Terra Draw event bridge (`initEventsBridge`), on an incompatible signature.
 *
 * ⚠️ **Nothing is transferred from `addpoi`.** Its `AddForm` half is a
 * 2,373-line subsystem (orchestrator, controller, state manager, schema
 * adapter, modal bridge…) reimplementing what `responsive-modal` +
 * `_getSchemaForLayer` + `submitFeature` already do here. This module
 * **maps**, it carries no form: it is `_handleCreate`'s twin (`events.ts`),
 * for a geometry coming from a chosen point instead of a Terra Draw line.
 *
 * ## Three measured constraints this module must hold
 *
 * 1. **The persistence wiring cannot come from `events.ts`.** Its `_wiring` is
 *    only set by `initEventsBridge`, called at Terra Draw's **lazy** load.
 *    Placing a POI without ever arming a tool would have given a mute save.
 *    The wiring is therefore **injected** by `entry.ts`, which has it from
 *    `_initOnMapReady`.
 * 2. **The placement callback is REPEATED.** `placement-mode.ts` keeps the
 *    marker after the tap (`keepMarker: true`) and its `dragend` **replays the
 *    callback** so dragging corrects the position. The form must therefore
 *    **not** reopen: the pending geometry updates, read **at save time**.
 *    ⚠️ `addpoi` did not have this case — not because it handled it, but
 *    because its affordance was **dead**: its `deactivate()` removed the
 *    marker right after the callback (`poi-placement.ts`), while the
 *    comment two lines above announced "user can adjust with draggable
 *    marker".
 * 3. **The temporary marker does not belong to the form.** It survives the
 *    tap; closing the form — success **as well as** cancellation — is what
 *    must remove it, otherwise it stays on the map designating nothing.
 */
import type { Geometry } from "geojson";
import { getGeoLeaf } from "@geoleaf/host-runtime";
import type { ModalOpenOptions } from "../modal/editor-form-modal.js";
import type { EditorWiringContext } from "../events.js";
import { buildSubmitContext } from "../events.js";
import { submitFeature } from "../persistence/submit.js";
import { applyComputedFields } from "../drawing/geo-compute.js";
import { PlacementMode } from "../drawing/placement-mode.js";
import { buildPlacementApi } from "../drawing/placement-api.js";
import { getEditorConfig } from "../config.js";
import { _getLabel, _notify } from "../internal.js";

/** A geographic position, in the shape both the core and the placement mode use. */
export interface LatLng {
    lat: number;
    lng: number;
}

/** Collaborators injected by `entry.ts` — see constraint 1 in the module header. */
export interface AddFormDeps {
    /** Opens the attribute form modal (injected to avoid a circular import). */
    openForm: (options: ModalOpenOptions) => void;
    /**
     * Yields the live persistence wiring, or null when the map is unavailable.
     *
     * ⚠️ A provider, not a value: `entry.ts` rebuilds the wiring from module state that is
     * read at call time, so a snapshot taken at init would freeze a null.
     */
    getWiring: () => EditorWiringContext | null;
}

let _deps: AddFormDeps | null = null;

/**
 * The position the form will save, kept mutable so a marker drag corrects it without
 * reopening the modal (constraint 2). `null` when no capture is in flight.
 */
let _pending: LatLng | null = null;

/**
 * Wires the capture flow. Called from `entry.ts` at map-ready, before any tool is armed.
 *
 * @param deps - See {@link AddFormDeps}.
 */
export function initAddForm(deps: AddFormDeps): void {
    _deps = deps;
}

/** Drops the injected collaborators and any capture in flight. Mirrors `destroy()`. */
export function destroyAddForm(): void {
    _deps = null;
    _pending = null;
}

/** Builds the GeoJSON Point the form will persist, from the pending position. */
function _pendingGeometry(): Geometry {
    const at = _pending;
    return { type: "Point", coordinates: [at?.lng ?? 0, at?.lat ?? 0] };
}

/** Retires the temporary placement marker and ends the capture. */
function _endCapture(): void {
    _pending = null;
    PlacementMode.clearMarker();
}

/**
 * Opens the attribute form for a new Point at `latlng`.
 *
 * Re-entrant by design: while a capture is in flight, a second call only moves the
 * pending position — which is what a marker drag produces (constraint 2).
 *
 * @param latlng - Where the new feature sits.
 *
 * @example
 * ```ts
 * const api = buildAddFormApi();
 * api.openAddForm({ lat: -21.11, lng: 55.53 });
 * ```
 */
export function openAddForm(latlng: LatLng): void {
    const wasCapturing = _pending !== null;
    _pending = { lat: latlng.lat, lng: latlng.lng };
    // A drag correction: the modal is already open on this capture, and reopening it
    // would discard whatever the user has typed.
    if (wasCapturing) return;

    const deps = _deps;
    if (!deps) {
        _notify("error", _getLabel("editor.addform.unavailable"));
        return;
    }

    deps.openForm({
        // Empty title and schema: both are resolved per target layer inside the modal, by
        // the layer dropdown and `getSchemaForLayer`. Same contract as a Terra Draw create.
        title: "",
        schema: [],
        geometryType: "Point",
        initialValues: {},
        computeValues: (schema) => applyComputedFields(schema, _pendingGeometry()),
        onSave: (values, layerId) => {
            const wiring = deps.getWiring();
            if (!wiring) {
                // Loud, never silent: the entry is still in the form, and the user can retry.
                _notify("error", _getLabel("editor.addform.unavailable"));
                return Promise.reject(new Error("[editor/add-form] No persistence wiring"));
            }
            // `_pendingGeometry()` is read HERE, not captured above: a marker dragged while
            // the form was open must save at its corrected position.
            return submitFeature(buildSubmitContext(wiring), {
                feature: { geometry: _pendingGeometry(), properties: values },
                layerId,
                isUpdate: false,
            }).then(_endCapture);
        },
        // Nothing was drawn on the map, so there is no Terra Draw feature to remove and no
        // undo entry to discard — only the temporary marker to retire.
        onCancel: _endCapture,
    });
}

/**
 * Starts the "add a POI" flow: resolve a position, then open the form on it.
 *
 * ⚠️ Moved down from the core (`kernel/ui/mobile/mobile-toolbar.ts`,
 * `_handlePoiAdd`). There it forced the kernel to know a plugin's geolocation
 * AND form; here it sits next to the placement mode it arms.
 *
 * @param map - Map instance to arm placement on; `null` lets the plugin resolve its own.
 * @param onSettled - Called when the flow ends without opening the form (cancelled tap),
 *                    so a caller can restore its button state.
 */
export function startPoiCapture(map?: unknown, onSettled?: () => void): void {
    const cfg = getEditorConfig();
    const userPosition = (
        getGeoLeaf()?.Geolocation as { getState?: () => { userPosition?: LatLng | null } }
    )?.getState?.()?.userPosition;

    if (userPosition && cfg.poiAddDefaultPosition === "geolocation") {
        openAddForm(userPosition);
        return;
    }

    buildPlacementApi().activate(map ?? null, (result) => {
        if (result?.latlng) openAddForm(result.latlng);
        else onSettled?.();
    });
}

/** The `GeoLeaf.Editor.AddForm` surface. */
export interface AddFormApi {
    openAddForm(latlng: LatLng): void;
}

/**
 * @returns the add-form slice mounted at `GeoLeaf.Editor.AddForm`.
 *
 * ⚠️ A built object, like `buildPlacementApi`: `check-facade-purity.cjs` only
 * accepts a thin delegate in `public-api.ts`, never a nested literal.
 */
export function buildAddFormApi(): AddFormApi {
    return { openAddForm };
}
