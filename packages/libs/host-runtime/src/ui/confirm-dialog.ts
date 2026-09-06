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
 * ## Two entry points, one dialog
 *
 * {@link chooseDialog} is the general one — N actions, resolving the id of the one
 * activated. {@link confirmDialog} is the two-action case expressed through it, and is kept
 * because it is what four call sites want and because a boolean reads better than an id
 * comparison at those sites.
 *
 * 🛑 THE GENERAL FORM EXISTS BECAUSE TWO OUTCOMES WERE NOT ENOUGH, and the case that showed
 * it is instructive: the editor's duplicate guard must offer "modify the existing one",
 * "create anyway" AND a way out. Folding the third onto a boolean means mapping DISMISSAL
 * (Escape, backdrop) onto one of the two real actions — so a gesture of renunciation would
 * have produced a duplicate. A dialog whose safe exit performs an action is not a dialog.
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

/** One action offered by {@link chooseDialog}. */
export interface DialogChoice {
    /** Value {@link chooseDialog} resolves with when this action is activated. */
    id: string;
    /** Button label, already translated. */
    label: string;
    /**
     * Visual weight. `neutral` is the dismiss-shaped action, `danger` the destructive one,
     * `primary` the ordinary commit. Defaults to `neutral`.
     */
    tone?: "neutral" | "primary" | "danger";
}

/** Options for {@link chooseDialog}. */
export interface ChooseDialogOptions {
    /** Optional heading. Omitted → message-only dialog. */
    title?: string;
    /** Body text (the question). */
    message: string;
    /**
     * The actions, in DOM order. The FIRST one takes the initial focus, so it must be the
     * safe one — Enter on an unread dialog must not commit anything.
     */
    choices: DialogChoice[];
    /**
     * Resolved on Escape, backdrop click and any other dismissal. Defaults to `null`.
     *
     * ⚠️ Point it at a real action only when that action is genuinely what "I did not
     * answer" means. Mapping a dismissal onto a commit is the defect this API exists to
     * make expressible — and therefore avoidable.
     */
    dismissValue?: string | null;
}

const _TONE_CLASS: Record<NonNullable<DialogChoice["tone"]>, string> = {
    neutral: "gl-form-modal__btn-cancel",
    primary: "gl-form-modal__btn-save",
    danger: "gl-form-modal__btn-delete",
};

/**
 * Shows a styled modal offering N actions and resolves with the id of the one taken.
 *
 * @param opts - Message, actions and dismissal value.
 * @returns the activated choice's `id`, or `dismissValue` (default `null`) when dismissed.
 * @throws {Error} When `choices` is empty — a dialog with no way out is a lock, and the
 *   failure would otherwise be a blank footer nobody can act on.
 * @example
 * const answer = await chooseDialog({
 *     message: nearbyMessage,
 *     choices: [
 *         { id: "cancel", label: cancelLabel },
 *         { id: "edit", label: editLabel, tone: "primary" },
 *         { id: "create", label: createLabel, tone: "danger" },
 *     ],
 * });
 */
export function chooseDialog(opts: ChooseDialogOptions): Promise<string | null> {
    if (opts.choices.length === 0) {
        throw new Error("[GeoLeaf/host-runtime] chooseDialog: `choices` must not be empty.");
    }
    // Adopted at CALL time — see `modal-shell.ts` and `csp-style-inject.mjs` for the defect
    // this closes.
    adoptStylesheet(css, "gl-host-confirm-dialog");
    const onDismiss = opts.dismissValue ?? null;
    return new Promise<string | null>((resolve) => {
        let settled = false;
        let firstButton: HTMLButtonElement | undefined;
        function settle(result: string | null): void {
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
            onDismiss: () => settle(onDismiss),
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
                for (const choice of opts.choices) {
                    // No cast: `createEl` is generic over the tag name and already returns
                    // `HTMLButtonElement`. An assertion here types nothing more — it MASKS a
                    // future signature change, the opposite of what one expects from it.
                    const btn = createEl(
                        "button",
                        `gl-form-modal__btn ${_TONE_CLASS[choice.tone ?? "neutral"]}`
                    );
                    btn.type = "button";
                    btn.textContent = choice.label;
                    btn.addEventListener("click", () => settle(choice.id));
                    footer.appendChild(btn);
                    firstButton ??= btn;
                }
                panel.appendChild(footer);
            },
        });

        // Default focus on the FIRST action, which callers must keep safe.
        // ⚠️ The button is CAPTURED at fill time rather than re-queried from
        // the panel: the selector lookup required a type assertion the
        // useless-assertion rule flags, and above all it re-coupled this code
        // to a CSS class name to find an object it had just created.
        // ⚠️ REDUNDANT and kept as such: activating the trap already does
        // `focusable[0].focus()` and this button IS the panel's first.
        // This line thus only protects against a future DOM reordering — it
        // does not carry the behaviour today. Measured: removing it turns no test red.
        firstButton?.focus();

        shell.overlay.addEventListener("click", (e) => {
            if (e.target === shell.overlay) settle(onDismiss);
        });
    });
}

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
 *
 * The two-action case of {@link chooseDialog}: cancel first (so it keeps the initial
 * focus), confirm second, and every dismissal reads as a cancel — which is sound HERE
 * precisely because "I did not answer" and "no" mean the same thing on a yes/no question.
 *
 * @param opts - Message, labels and destructive styling.
 * @returns `true` on the confirm button; `false` on cancel, Escape and backdrop click.
 * @example
 * if (await confirmDialog({ message: "Supprimer ?", confirmLabel: "Supprimer", cancelLabel: "Annuler" })) {
 *     await remove();
 * }
 */
export function confirmDialog(opts: ConfirmDialogOptions): Promise<boolean> {
    return chooseDialog({
        ...(opts.title !== undefined && { title: opts.title }),
        message: opts.message,
        choices: [
            { id: "cancel", label: opts.cancelLabel, tone: "neutral" },
            {
                id: "confirm",
                label: opts.confirmLabel,
                tone: opts.destructive === false ? "primary" : "danger",
            },
        ],
        dismissValue: "cancel",
    }).then((taken) => taken === "confirm");
}
