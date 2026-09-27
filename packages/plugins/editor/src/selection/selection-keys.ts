/*!
 * @geoleaf-plugins/editor — Selection keys
 * © 2026 Mattieu Pottier — MIT License
 *
 * Delete / Backspace on a selection → the editor's deletion, with its confirmation.
 * Enter in select mode → leave the select tool. The drawing modes bind Enter to "finish"
 * through their own `keyEvents` (`drawing/modes.ts`), so it is not intercepted there.
 *
 * Both listen on the whole document, and ignore a key typed in a text field — and a key
 * pressed inside a modal dialog: Enter on the delete confirmation's own button was taken for
 * "leave the select tool" — the activation cancelled, the selection dropped under a dialog
 * still open, whose confirmation then deleted nothing, without a word — and Delete pressed
 * in it stacked a second confirmation. Every modal of this plugin, of `host-runtime` and of
 * `field-renderer` carries `aria-modal`.
 *
 * Enter is also left to a button or a link, which it activates. The tools pill is a dialog
 * but not a modal one: Enter on its own buttons (Delete, Undo, Redo) was taken for "leave the
 * select tool", and the button never activated.
 * https://geoleaf.dev
 */

import { getSelection } from "./selection-state.js";

/** Callbacks wired by entry.ts. */
interface SelectionKeyHandlers {
    /** Asks for the deletion of the current selection (confirmation included). */
    onDelete: () => void;
    /** True while the select tool is the armed one. */
    isSelecting: () => boolean;
    /** Disarms the select tool. */
    leaveSelecting: () => void;
}

let _handler: ((e: KeyboardEvent) => void) | null = null;

/** True when the key belongs to something else: a text field, or a modal dialog. */
function _belongsElsewhere(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    const tag = el?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    return el?.closest?.('[aria-modal="true"]') != null;
}

/** True when Enter activates the focused element itself: a button or a link. */
function _activatesItself(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    return el?.closest?.('button, a[href], [role="button"]') != null;
}

/**
 * Attaches the document keydown listener for Delete, Backspace and Enter. Idempotent — a
 * second call without an intervening {@link detachSelectionKeys} is a no-op.
 *
 * @param handlers - What Delete and Enter do.
 */
export function attachSelectionKeys(handlers: SelectionKeyHandlers): void {
    if (_handler || typeof document === "undefined") return;
    _handler = (e: KeyboardEvent): void => {
        if (_belongsElsewhere(e.target)) return;
        if (e.key === "Delete" || e.key === "Backspace") {
            if (!getSelection()) return;
            // Also keeps Backspace from navigating back.
            e.preventDefault();
            handlers.onDelete();
        } else if (e.key === "Enter" && handlers.isSelecting() && !_activatesItself(e.target)) {
            e.preventDefault();
            handlers.leaveSelecting();
        }
    };
    document.addEventListener("keydown", _handler);
}

/** Removes the keydown listener. Safe to call when not attached. */
export function detachSelectionKeys(): void {
    if (_handler && typeof document !== "undefined") {
        document.removeEventListener("keydown", _handler);
    }
    _handler = null;
}
