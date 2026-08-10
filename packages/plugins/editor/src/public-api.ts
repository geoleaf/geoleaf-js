/*!
 * @geoleaf-plugins/editor — Public API facade
 * © 2026 Mattieu Pottier — MIT License
 *
 * Façade only (INV-FACADE): thin wrappers over `editor-api.ts` and the floating menu.
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

export { setDestroyHook, toggleEditorMenu } from "./editor-api.js";

/** @public */
export function buildPublicApi(): Record<string, unknown> {
    return {
        /** Opens or closes the editor floating sub-menu. */
        toggleMenu: (anchorEl?: Element | null): void => toggleEditorMenu(anchorEl),
        /** Arms a drawing mode tool, or disarms all if null. */
        setActiveTool: setEditorActiveTool,
        /** Returns the currently armed tool identifier, or null. */
        getActiveTool: getEditorActiveTool,
        /** Updates the enabled state of undo/redo buttons. */
        updateUndoRedoState,
        /** Destroys the plugin DOM (menu + modals). */
        destroy: (): void => destroyEditor(),
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
         * ⚠️ La SECONDE moitié de l'ancien seam `poi-addform-seam.ts`, et la seule qui
         * n'existait nulle part ici : `editor` n'ouvrait son formulaire que par le pont
         * Terra Draw, sur une signature incompatible. Un simple repointage du seam vers
         * `.Editor` aurait donc rendu `isAddFormAvailable()` faux pour toujours.
         */
        get AddForm(): AddFormApi {
            return buildAddFormApi();
        },
    };
}
