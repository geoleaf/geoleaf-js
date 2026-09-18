/*!
 * @geoleaf/field-renderer — Visual viewport tracking for the form modal
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Keeps the form's overlay on the VISUAL viewport — the part of the page the user actually sees.
 *
 * ## Why the visual viewport, and not the window
 *
 * When a phone opens its keyboard, or the user pans a zoomed page, the browser shrinks or moves
 * the visual viewport and leaves the layout viewport alone. An overlay at `position: fixed;
 * inset: 0` is sized by the layout viewport, so a drawer anchored to its bottom stays under the
 * keyboard — Cancel and Save with it — and the field being typed in can end up behind it too.
 *
 * The overlay is therefore pinned to the visual viewport through four custom properties, and what
 * it holds follows without knowing a keyboard exists: the drawer sits at its bottom, the centred
 * panel in its middle. Tracking the overlay's box, rather than computing a keyboard height from
 * the window, never reads the layout viewport's height — the value mobile browsers disagree on.
 *
 * ⚠️ Without `window.visualViewport` (an old engine, a test DOM) nothing is tracked, and the
 * overlay keeps its `inset: 0`: exactly the layout that shipped before.
 */

/** The modifier `css/form-modal-base.css` keys the tracked layout on. */
const TRACKED_CLASS = "gl-form-modal-overlay--viewport";

/** Room kept between a revealed field and the edge of the scrolling body, in px. */
const REVEAL_MARGIN_PX = 8;

/**
 * Pins `overlay` to the visual viewport, and keeps the focused field of `scroller` in view.
 *
 * The focused field is brought back by scrolling `scroller` itself — never with
 * `scrollIntoView`, which on iOS also scrolls the document under the modal.
 *
 * @param overlay - The modal's overlay. Receives the modifier class and the custom properties
 *   `--gl-form-viewport-top`, `--gl-form-viewport-left`, `--gl-form-viewport-width` and
 *   `--gl-form-viewport-height`, in px.
 * @param scroller - The form's scrolling body.
 * @returns A release function that removes every listener added here. Calling it again does
 *   nothing.
 */
export function followVisualViewport(overlay: HTMLElement, scroller: HTMLElement): () => void {
    const viewport = window.visualViewport;
    if (!viewport) return () => {};

    overlay.classList.add(TRACKED_CLASS);

    const reveal = (): void => {
        const focused = document.activeElement;
        if (!(focused instanceof HTMLElement) || !scroller.contains(focused)) return;
        const box = scroller.getBoundingClientRect();
        const field = focused.getBoundingClientRect();
        if (field.bottom > box.bottom) {
            scroller.scrollTop += field.bottom - box.bottom + REVEAL_MARGIN_PX;
        } else if (field.top < box.top) {
            scroller.scrollTop -= box.top - field.top + REVEAL_MARGIN_PX;
        }
    };

    const sync = (): void => {
        overlay.style.setProperty("--gl-form-viewport-top", `${viewport.offsetTop}px`);
        overlay.style.setProperty("--gl-form-viewport-left", `${viewport.offsetLeft}px`);
        overlay.style.setProperty("--gl-form-viewport-width", `${viewport.width}px`);
        overlay.style.setProperty("--gl-form-viewport-height", `${viewport.height}px`);
        reveal();
    };

    sync();
    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    scroller.addEventListener("focusin", reveal);

    let released = false;
    return () => {
        if (released) return;
        released = true;
        viewport.removeEventListener("resize", sync);
        viewport.removeEventListener("scroll", sync);
        scroller.removeEventListener("focusin", reveal);
    };
}
