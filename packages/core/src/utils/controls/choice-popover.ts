/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The disclosure behind the language and palette buttons: a button that opens a short list of
 * choices, and says whether it is open.
 *
 * Both capabilities carried their own copy of this, and the copies shared two defects:
 *
 * - **A menu in name only.** `role="menu"` / `menuitem` promise the menu keyboard contract
 *   (arrows, focus on the active entry, Tab closing it) and none of it existed. The pattern is
 *   now a DISCLOSURE: the button carries `aria-expanded` and `aria-controls`, the list is a
 *   labelled `group` of plain buttons, and no role promises what the keyboard does not do.
 * - **Out of reach.** The list was appended at the end of the button's bar — several tabs away
 *   from it — and placed with the desktop geometry everywhere. It is now inserted right AFTER
 *   its button (DOM order is tab order), carries the button's `data-variant` so each layout
 *   places it (the mobile bar sits on the left edge of the screen), and receives the focus on
 *   its active entry when it opens.
 *
 * One list at a time: opening one closes the other. Escape closes it and returns the focus to
 * its button; a click outside, or the focus leaving both the button and the list, closes it.
 */

/** The open disclosure, if any — one at a time across every caller. */
let _open: {
    button: HTMLElement;
    list: HTMLElement;
    onDocument: (e: Event) => void;
    onFocusOut: (e: FocusEvent) => void;
} | null = null;

let _idCounter = 0;

/**
 * Closes the open list, if any, and tells its button so.
 *
 * @example
 * ```ts
 * closeChoicePopover();
 * ```
 */
export function closeChoicePopover(): void {
    if (!_open) return;
    const { button, list, onDocument, onFocusOut } = _open;
    _open = null;
    if (typeof document !== "undefined") {
        document.removeEventListener("click", onDocument, true);
        document.removeEventListener("keydown", onDocument, true);
    }
    list.removeEventListener("focusout", onFocusOut);
    list.remove();
    button.setAttribute("aria-expanded", "false");
    button.removeAttribute("aria-controls");
}

/** The entry the focus lands on when the list opens: the active one, else the first. */
function _initialFocus(list: HTMLElement): HTMLElement | null {
    return (
        list.querySelector<HTMLElement>('[aria-current="true"]') ??
        list.querySelector<HTMLElement>("button")
    );
}

/**
 * Prepares a button to drive a choice list: `aria-expanded="false"`, and no `aria-haspopup`
 * (a list of buttons is not a menu).
 *
 * @param button - The button that will toggle the list.
 *
 * @example
 * ```ts
 * const btn = document.createElement("button");
 * initChoiceButton(btn);
 * ```
 */
export function initChoiceButton(button: HTMLElement): void {
    button.setAttribute("aria-expanded", "false");
    button.removeAttribute("aria-haspopup");
}

/**
 * Opens the list `build()` returns under `button`, or closes it when it is already open.
 *
 * @param button - The button the list belongs to. Its `data-variant` is copied onto the list.
 * @param build - Builds the list: a container of `<button>` entries, the active one carrying
 *   `aria-current="true"`. It is given `role="group"` here; its `aria-label` is the caller's.
 *
 * @example
 * ```ts
 * btn.addEventListener("click", () => toggleChoicePopover(btn, () => buildMyList()));
 * ```
 */
export function toggleChoicePopover(button: HTMLElement, build: () => HTMLElement): void {
    const wasOpenHere = _open?.button === button;
    closeChoicePopover();
    if (wasOpenHere || typeof document === "undefined") return;

    const list = build();
    list.setAttribute("role", "group");
    list.id ||= `gl-choice-popover-${++_idCounter}`;
    if (button.dataset.variant) list.dataset.variant = button.dataset.variant;
    button.after(list);
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-controls", list.id);

    const onDocument = (e: Event) => {
        if (e.type === "keydown") {
            if ((e as KeyboardEvent).key !== "Escape") return;
            closeChoicePopover();
            button.focus(); // returning focus is what makes Escape usable by keyboard
            return;
        }
        const target = e.target as Node | null;
        if (target && (list.contains(target) || button.contains(target))) return;
        closeChoicePopover();
    };
    const onFocusOut = (e: FocusEvent) => {
        const next = e.relatedTarget as Node | null;
        if (next && (list.contains(next) || button.contains(next))) return;
        // Focus going nowhere (a click on a non-focusable spot) is the click handler's case.
        if (next) closeChoicePopover();
    };
    document.addEventListener("click", onDocument, true);
    document.addEventListener("keydown", onDocument, true);
    list.addEventListener("focusout", onFocusOut);
    _open = { button, list, onDocument, onFocusOut };

    _initialFocus(list)?.focus();
}
