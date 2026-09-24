/*!
 * @geoleaf-plugins/editor — Public API facade
 * © 2026 Mattieu Pottier — MIT License
 *
 * Façade only (INV-FACADE): thin wrappers over `editor-api.ts`, the floating menu and the
 * draft state.
 * Mounted on `GeoLeaf.Editor` by `entry.ts`.
 * https://geoleaf.dev
 */
import {
    setEditorActiveTool,
    getEditorActiveTool,
    updateUndoRedoState,
} from "./sub-menu/floating-menu.js";
import { toggleEditorMenu, destroyEditor } from "./editor-api.js";
import { buildPlacementApi, type PlacementApi } from "./drawing/placement-api.js";
import { buildAddFormApi, type AddFormApi } from "./add-form/placement-form.js";
import { discardDraft } from "./draft-state.js";

export { setDestroyHook, toggleEditorMenu } from "./editor-api.js";

/** @public */
export function buildPublicApi(): Record<string, unknown> {
    return {
        /** Opens or closes the editor floating sub-menu. */
        toggleMenu: (anchorEl?: Element | null): void => toggleEditorMenu(anchorEl),
        /**
         * Highlights a tool in the menu, or clears the highlight with `null`. The menu STATE
         * only: the drawing engine is neither armed nor disarmed by this call.
         */
        setActiveTool: setEditorActiveTool,
        /** Returns the currently armed tool identifier, or null. */
        getActiveTool: getEditorActiveTool,
        /** Updates the enabled state of undo/redo buttons. */
        updateUndoRedoState,
        /** Destroys the plugin DOM (menu + modals). */
        destroy: (): void => destroyEditor(),
        /**
         * Abandons the draft awaiting its form — a shape just drawn, or an add-form capture:
         * the form closes, the geometry and its history go. `true` if one was abandoned —
         * see `draft-state.ts`.
         */
        discardDraft,
        /**
         * Programmatic point placement (task 5.1-a) — see `drawing/placement-api.ts`.
         *
         * ⚠️ A GETTER, not a plain property: INV-FACADE accepts a method, a function-valued
         * property or a getter, and this member is an object. It is the shape the gate
         * blesses for a read-only slice, and it keeps the façade a single delegating call.
         */
        get PlacementMode(): PlacementApi {
            return buildPlacementApi();
        },
        /**
         * Opens the attribute form on a new Point (task 5.1-f) — see
         * `add-form/placement-form.ts`.
         *
         * ⚠️ The SECOND half of the old `poi-addform-seam.ts` seam, and the only
         * one that existed nowhere here: `editor` only opened its form through
         * the Terra Draw bridge, on an incompatible signature. Simply
         * repointing the seam to `.Editor` would thus have made
         * `isAddFormAvailable()` false forever.
         */
        get AddForm(): AddFormApi {
            return buildAddFormApi();
        },
    };
}
