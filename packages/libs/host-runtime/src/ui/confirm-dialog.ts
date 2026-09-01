/*!
 * @geoleaf/host-runtime — Styled confirm dialog
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview Shared confirmation box — `window.confirm()`'s replacement.
 *
 * A themed modal (overlay + panel + focus trap) reusing the `gl-form-modal-*`
 * styles, so the confirmation looks like the form modal. Resolves `true` on
 * the confirm button, `false` on cancel, Escape and backdrop click.
 *
 * ## Why this file lives here and not in `field-renderer`
 *
 * Executed on 06/08/2026: sharing is by ROLE — the core owns reading,
 * `field-renderer` **input**, `host-runtime` the **UI plumbing**. A
 * confirmation box is not attribute input: it already served `offline-ui`
 * and `editor`, which have no use for the rest of `field-renderer`.
 *
 * ⚠️ **The gain is not weight, and that is measured.** `host-runtime` is
 * private and bundled at each consumer, exactly like `field-renderer`: moving
 * from one inlined package to another gains no bytes by itself. The gain
 * observed on `offline-ui` (**−9% gz**) comes from it no longer inlining the
 * responsive modal that accompanied this import. The primary reason stays
 * architecture: `offline-ui` loses its dependency on `field-renderer`, which
 * is now only inlined by `editor`.
 *
 * ⚠️ This file uses `createEl` (`../dom-seam.js`) and not the `field-renderer`
 * `_el` it used to import — `createEl` is a superset of it (it accepts attributes).
 */
import { createEl } from "../dom-seam.js";
// Its own eight classes, styled here for the same reason as the shell above: `offline-ui`
// calls this at four sites and does not depend on field-renderer, so the dialog rendered
// unstyled AND off screen there.
import { adoptStylesheet } from "./css-adopt.js";
import css from "../css/confirm-dialog.lazy.css";

import { createModalShell } from "./modal-shell.js";

/** Options for {@link confirmDialog}. */
export interface ConfirmDialogOptions {
    /** Optional heading. Omitted → message-only dialog. */
    title?: string;
    /** Body text (the question). */
    message: string;
    /** Confirm (action) button label. */
    confirmLabel: string;
    /** Cancel (dismiss) button label. */
    cancelLabel: string;
    /** Confirm button uses the destructive (red) style when true (default). */
    destructive?: boolean;
}

/**
 * Shows a styled confirmation dialog and resolves with the user's choice.
 */
export function confirmDialog(opts: ConfirmDialogOptions): Promise<boolean> {
    // Adopted at CALL time — see `modal-shell.ts` and `csp-style-inject.mjs` for the defect
    // this closes.
    adoptStylesheet(css, "gl-host-confirm-dialog");
    return new Promise<boolean>((resolve) => {
        let settled = false;
        let cancelButton: HTMLButtonElement | undefined;
        function settle(result: boolean): void {
            if (settled) return;
            settled = true;
            shell.close();
            resolve(result);
        }

        // The role is `alertdialog` and not `dialog`: this modal INTERRUPTS
        // to demand a decision, it does not present. The distinction is read aloud.
        const shell = createModalShell({
            panelClass: "gl-form-modal-confirm",
            role: "alertdialog",
            onDismiss: () => settle(false),
            fill(panel) {
                if (opts.title) {
                    const title = createEl("h2", "gl-form-modal__delete-title");
                    title.textContent = opts.title;
                    panel.appendChild(title);
                }

                const body = createEl("p", "gl-form-modal__delete-body");
                body.textContent = opts.message;
                panel.appendChild(body);

                const footer = createEl("div", "gl-form-modal__footer");

                // No cast: `createEl` is generic over the tag name and
                // already returns `HTMLButtonElement`. An assertion here types
                // nothing more — it MASKS a future signature change, the
                // opposite of what one expects from it.
                const btnCancel = createEl(
                    "button",
                    "gl-form-modal__btn gl-form-modal__btn-cancel"
                );
                btnCancel.type = "button";
                btnCancel.textContent = opts.cancelLabel;

                const confirmClass =
                    opts.destructive === false
                        ? "gl-form-modal__btn-save"
                        : "gl-form-modal__btn-delete";
                const btnConfirm = createEl("button", `gl-form-modal__btn ${confirmClass}`);
                btnConfirm.type = "button";
                btnConfirm.textContent = opts.confirmLabel;

                footer.append(btnCancel, btnConfirm);
                panel.appendChild(footer);

                cancelButton = btnCancel;
                btnCancel.addEventListener("click", () => settle(false));
                btnConfirm.addEventListener("click", () => settle(true));
            },
        });

        // Default focus on the non-destructive (cancel) action for safety.
        // ⚠️ The button is CAPTURED at fill time rather than re-queried from
        // the panel: the selector lookup required a type assertion the
        // useless-assertion rule flags, and above all it re-coupled this code
        // to a CSS class name to find an object it had just created.
        // ⚠️ REDUNDANT and kept as such: activating the trap already does
        // `focusable[0].focus()` and the cancel button IS the panel's first.
        // This line thus only protects against a future DOM reordering — it
        // does not carry the behaviour today. Measured: removing it turns no test red.
        cancelButton?.focus();

        shell.overlay.addEventListener("click", (e) => {
            if (e.target === shell.overlay) settle(false);
        });
    });
}
