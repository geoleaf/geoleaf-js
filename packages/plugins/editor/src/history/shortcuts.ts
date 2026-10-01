/*!
 * @geoleaf-plugins/editor — Undo / redo keyboard shortcuts
 * © 2026 Mattieu Pottier — MIT License
 *
 * Ctrl/Cmd+Z → undo · Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y → redo.
 * Ignored while a form field has focus, so the browser's native text undo
 * keeps working inside inputs — and while a modal dialog is open, so the
 * creation whose form is on screen is not undone under it.
 * https://geoleaf.dev
 */

/** Undo / redo callbacks wired by entry.ts. */
interface ShortcutHandlers {
    onUndo: () => void;
    onRedo: () => void;
}

let _handler: ((e: KeyboardEvent) => void) | null = null;

/** True when the event target is a text-editing element (skip the shortcut). */
function _isEditableTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    return el.isContentEditable === true;
}

/**
 * True while a modal dialog is in the document — the feature form, a confirmation.
 *
 * Asked of the DOCUMENT and not of the event target: after a click on the backdrop the focus
 * falls back on `body`, outside the dialog that is still open.
 */
function _modalIsOpen(): boolean {
    return document.querySelector('[aria-modal="true"]') !== null;
}

/**
 * Attaches the global keydown listener. Idempotent — a second call without an
 * intervening {@link detachShortcuts} is a no-op.
 */
export function attachShortcuts(handlers: ShortcutHandlers): void {
    if (_handler || typeof document === "undefined") return;

    _handler = (e: KeyboardEvent): void => {
        // Require the platform modifier (Ctrl on Win/Linux, Cmd on macOS).
        if (!e.ctrlKey && !e.metaKey) return;
        // Never hijack undo/redo while the user is typing in a field.
        if (_isEditableTarget(e.target)) return;
        // Nor while a dialog is open: what it shows would be undone under it.
        if (_modalIsOpen()) return;

        const key = e.key.toLowerCase();
        if (key === "z" && !e.shiftKey) {
            e.preventDefault();
            handlers.onUndo();
        } else if ((key === "z" && e.shiftKey) || key === "y") {
            e.preventDefault();
            handlers.onRedo();
        }
    };

    document.addEventListener("keydown", _handler);
}

/** Removes the keydown listener. Safe to call when not attached. */
export function detachShortcuts(): void {
    if (_handler && typeof document !== "undefined") {
        document.removeEventListener("keydown", _handler);
    }
    _handler = null;
}
