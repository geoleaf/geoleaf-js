/*!
 * @geoleaf/host-runtime — Modal shell (overlay + panel + focus trap + teardown)
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * The scaffolding every modal surface of this library shares: an overlay, a panel carrying its
 * ARIA role, a focus trap wired to dismissal, and a teardown that undoes them in the right
 * order.
 *
 * It exists because those eleven lines were written three times — twice inside one editor
 * module, once in the confirm dialog next door — and what repeated was not markup but an
 * accessibility contract. A fourth modal written by hand would get the markup right and drop
 * one of its five clauses, silently, because nothing compares modals with each other.
 *
 * Deliberately NOT a modal component: it neither lays out content nor owns buttons. Its callers
 * differ too much for that, and widening it would restart the divergence from the other end.
 */

// 🛑 The shell now SHIPS the rules for the classes it writes. It did not, and the two halves
// travelled separately: `.gl-form-modal-overlay` was emitted here while its CSS lived only in
// `@geoleaf/field-renderer`, so whether a modal was laid out depended on which OTHER bundle the
// page happened to load. Measured on a fresh deployed page: `position: static`, off screen.
import { adoptStylesheet } from "./css-adopt.js";
import css from "../css/modal-shell.lazy.css";

import { createEl } from "../dom-seam.js";

import { createFocusTrap } from "./focus-trap.js";

/** What a caller gets back: the panel to fill, and the one way to take it down. */
export interface ModalShell {
    /** The overlay, already attached to `document.body`. */
    readonly overlay: HTMLElement;
    /** The panel inside it — the element to fill, and the one the focus trap holds. */
    readonly panel: HTMLElement;
    /** Deactivates the trap and removes the overlay. Idempotent. */
    close(): void;
}

/** Shape of a modal: its ARIA role and the classes its panel carries. */
export interface ModalShellOptions {
    /**
     * Extra classes on the panel, beyond `gl-form-modal-panel`.
     * Space-separated, as the DOM helper expects.
     */
    panelClass?: string;
    /**
     * `"dialog"` by default. Use `"alertdialog"` when the modal interrupts to demand a
     * decision rather than to present one — the distinction is read aloud by screen readers.
     */
    role?: "dialog" | "alertdialog";
    /** Called when the focus trap requests dismissal (Escape). */
    onDismiss?: () => void;
    /**
     * Fills the panel. Called with the panel already attached, and BEFORE the focus trap is
     * activated.
     *
     * 🛑 **This is a callback and not a step the caller performs afterwards, and the reason is
     * an ordering bug this refactor nearly introduced.** Activating a trap on an empty panel
     * focuses nothing: the trap picks the first focusable element at activation time, and the
     * buttons do not exist yet. Handing the panel back for the caller to fill *and then* asking
     * it to activate would work — and would fail silently the first time someone forgot. Taking
     * the content as a callback makes both mistakes unrepresentable.
     */
    fill(panel: HTMLElement): void;
}

/**
 * Builds an accessible modal shell: overlay, panel, ARIA attributes, focus trap, teardown.
 *
 * ## Why this exists
 *
 * The same eleven lines were written **three times** — twice inside one editor module, once in
 * the confirmation dialog beside this file. They agreed, which is what made them invisible:
 * the duplicate-code gate passes on them because the clone is under its threshold, and each
 * copy reads as ordinary DOM assembly rather than as a repeated decision.
 *
 * 🛑 **What is repeated is not the markup, it is the ACCESSIBILITY CONTRACT.** Role,
 * `aria-modal`, a focus trap that dismisses, and a teardown that deactivates the trap *before*
 * removing the node. A fourth modal written by hand will get the markup right and drop one of
 * those four — and nothing would say so, because nothing compares modals with each other.
 *
 * ⚠️ **The order in `close()` is load-bearing.** Deactivating the trap after removing the
 * overlay leaves it restoring focus to a detached element; the copies all had it right, and a
 * fourth had every chance of not.
 *
 * 📌 **This is not a general modal component**, and it deliberately stops short of one: it
 * neither lays out content nor owns buttons. Callers differ too much for that — one resolves a
 * boolean, one dispatches three branches, one builds a per-field merge list. What they share is
 * exactly what is here, and widening it would start the divergence again from the other end.
 *
 * @param opts - Panel classes, ARIA role, the content filler, and the dismissal callback.
 * @returns The attached shell. The overlay is in the document when this returns.
 */
export function createModalShell(opts: ModalShellOptions): ModalShell {
    // 🛑 Adopted at CALL time, not at module scope. A module-scope injection is a side effect
    // rollup cannot remove, so the sheet reached nine bundles whose JS had been shaken away —
    // a dialog that was not there, styled on every page load.
    adoptStylesheet(css, "gl-host-modal-shell");
    const overlay = createEl("div", "gl-form-modal-overlay");
    const panel = createEl(
        "div",
        opts.panelClass ? `gl-form-modal-panel ${opts.panelClass}` : "gl-form-modal-panel"
    );
    panel.setAttribute("role", opts.role ?? "dialog");
    panel.setAttribute("aria-modal", "true");

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    opts.fill(panel);

    let closed = false;
    const close = (): void => {
        if (closed) return;
        closed = true;
        // ⚠️ THE ORDER CARRIES THE BEHAVIOUR: deactivating the trap AFTER
        // removing the overlay lets it return focus to a detached node. The
        // three copies had it right; a fourth written by hand had every
        // chance of not.
        trap.deactivate();
        overlay.remove();
    };

    const trap = createFocusTrap(panel, () => {
        opts.onDismiss?.();
        close();
    });
    trap.activate();

    return { overlay, panel, close };
}
