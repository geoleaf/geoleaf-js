/*!
 * Tests — selection keys (`selection/selection-keys.ts`): Delete deletes, Enter leaves the
 * select tool, and neither takes a key that belongs to a text field or a modal dialog — nor
 * Enter, a key that belongs to the button or the link it would activate.
 *
 * The dialog cases are the defect measured on the shipped bundle (27/09/2026): Enter on the
 * delete confirmation's own button disarmed the select tool under a dialog still open — its
 * confirmation then deleted nothing — and Delete pressed in it stacked a second confirmation.
 * `e2e/44` proves the chain in a browser; these pin the rule itself.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { attachSelectionKeys, detachSelectionKeys } from "../selection/selection-keys.js";
import { setSelection, clearSelection } from "../selection/selection-state.js";

const handlers = {
    onDelete: vi.fn(),
    isSelecting: vi.fn(() => true),
    leaveSelecting: vi.fn(),
};

/** Dispatches `key` on `target` as a bubbling keydown, and returns the event. */
function press(key: string, target: EventTarget = document.body): KeyboardEvent {
    const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    return e;
}

/** A button inside an `aria-modal` panel, attached to the document. */
function dialogButton(): HTMLButtonElement {
    const panel = document.createElement("div");
    panel.setAttribute("aria-modal", "true");
    const btn = document.createElement("button");
    panel.appendChild(btn);
    document.body.appendChild(panel);
    return btn;
}

beforeEach(() => {
    vi.clearAllMocks();
    handlers.isSelecting.mockReturnValue(true);
    setSelection({
        terradrawId: "td-1",
        featureId: "PT-1",
        layerId: "sites",
        originalGeom: { type: "Point", coordinates: [0, 0] },
    });
    attachSelectionKeys(handlers);
});

afterEach(() => {
    detachSelectionKeys();
    clearSelection();
    document.body.innerHTML = "";
});

describe("selection keys", () => {
    it("Delete and Backspace ask for the deletion of the selection, and take the key", () => {
        expect(press("Delete").defaultPrevented).toBe(true);
        expect(press("Backspace").defaultPrevented).toBe(true);
        expect(handlers.onDelete).toHaveBeenCalledTimes(2);
    });

    it("Delete does nothing without a selection", () => {
        clearSelection();
        expect(press("Delete").defaultPrevented).toBe(false);
        expect(handlers.onDelete).not.toHaveBeenCalled();
    });

    it("Enter leaves the select tool — only while it is armed", () => {
        press("Enter");
        handlers.isSelecting.mockReturnValue(false);
        press("Enter");
        expect(handlers.leaveSelecting).toHaveBeenCalledTimes(1);
    });

    it("a key typed in a text field is left to the field", () => {
        const input = document.createElement("input");
        document.body.appendChild(input);
        expect(press("Backspace", input).defaultPrevented).toBe(false);
        press("Enter", input);
        expect(handlers.onDelete).not.toHaveBeenCalled();
        expect(handlers.leaveSelecting).not.toHaveBeenCalled();
    });

    it("🛑 Enter on a dialog's button is the button's, not a way out of the select tool", () => {
        const e = press("Enter", dialogButton());
        expect(e.defaultPrevented).toBe(false);
        expect(handlers.leaveSelecting).not.toHaveBeenCalled();
    });

    it("🛑 Delete pressed in a dialog does not open another confirmation", () => {
        press("Delete", dialogButton());
        expect(handlers.onDelete).not.toHaveBeenCalled();
    });

    it("🛑 Enter on a button of the tools pill — a dialog, not a modal — presses the button", () => {
        // The pill is `role="dialog"` without `aria-modal`: Enter on its Delete, Undo or Redo
        // button was taken for "leave the select tool", and the button never activated.
        const pill = document.createElement("div");
        pill.setAttribute("role", "dialog");
        const btn = document.createElement("button");
        pill.appendChild(btn);
        document.body.appendChild(pill);
        const e = press("Enter", btn);
        expect(e.defaultPrevented).toBe(false);
        expect(handlers.leaveSelecting).not.toHaveBeenCalled();
    });

    it("🛑 Enter on a link is the link's", () => {
        const link = document.createElement("a");
        link.href = "#x";
        document.body.appendChild(link);
        press("Enter", link);
        expect(handlers.leaveSelecting).not.toHaveBeenCalled();
    });

    it('🛑 Enter on an element with `role="button"` is the element\'s', () => {
        const el = document.createElement("div");
        el.setAttribute("role", "button");
        document.body.appendChild(el);
        press("Enter", el);
        expect(handlers.leaveSelecting).not.toHaveBeenCalled();
    });

    it("🛑 Enter anywhere in a modal — not only on its buttons — is the modal's", () => {
        // Keeps the `aria-modal` guard itself to account: on a button, the button rule
        // alone would pass.
        const panel = document.createElement("div");
        panel.setAttribute("aria-modal", "true");
        const body = document.createElement("div");
        body.tabIndex = 0;
        panel.appendChild(body);
        document.body.appendChild(panel);
        press("Enter", body);
        expect(handlers.leaveSelecting).not.toHaveBeenCalled();
    });

    it("Delete on a button outside any modal still asks for the deletion", () => {
        const btn = document.createElement("button");
        document.body.appendChild(btn);
        press("Delete", btn);
        expect(handlers.onDelete).toHaveBeenCalledTimes(1);
    });

    it("attaches once, and detaches", () => {
        attachSelectionKeys(handlers);
        press("Delete");
        expect(handlers.onDelete).toHaveBeenCalledTimes(1);
        detachSelectionKeys();
        press("Delete");
        expect(handlers.onDelete).toHaveBeenCalledTimes(1);
    });
});
