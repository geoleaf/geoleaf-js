/*!
 * @geoleaf/host-runtime — Styled confirm dialog
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview Boîte de confirmation partagée — le remplaçant de `window.confirm()`.
 *
 * Modale thématisée (overlay + panneau + piège de focus) réutilisant les styles
 * `gl-form-modal-*`, pour que la confirmation ait la même apparence que la modale de
 * formulaire. Résout `true` au clic sur le bouton de confirmation, `false` à l'annulation,
 * à Échap et au clic sur le fond.
 *
 * ## Pourquoi ce fichier vit ici et non dans `field-renderer`
 *
 * Décision **W3 / A4″**, exécutée au Sprint 6 (S6b, B-144) : le partage se fait par RÔLE —
 * le core possède la lecture, `field-renderer` la **saisie**, `host-runtime` la **plomberie
 * UI**. Une boîte de confirmation n'est pas de la saisie attributaire : elle servait déjà
 * `offline-ui` et `editor`, qui n'ont rien à faire du reste de `field-renderer`.
 *
 * ⚠️ **Le gain n'est pas pondéral, et c'est mesuré.** `host-runtime` est privé et bundlé chez
 * chaque consommateur, exactement comme `field-renderer` : déplacer d'un inliné vers un autre
 * inliné ne fait pas gagner d'octets par soi-même. Le gain observé sur `offline-ui`
 * (**−9 % gz**) vient de ce qu'il n'inline plus la modale responsive qui accompagnait cet
 * import. La raison première reste l'architecture : `offline-ui` perd sa dépendance à
 * `field-renderer`, qui n'est plus inlinée que par `editor`.
 *
 * ⚠️ Ce fichier utilise `createEl` (`../dom-seam.js`) et non le `_el` de `field-renderer`
 * qu'il importait avant — `createEl` en est un sur-ensemble (il accepte des attributs).
 */
import { createEl } from "../dom-seam.js";
import { createFocusTrap } from "./focus-trap.js";

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
    return new Promise<boolean>((resolve) => {
        const overlay = createEl("div", "gl-form-modal-overlay");
        const panel = createEl("div", "gl-form-modal-panel gl-form-modal-confirm");
        panel.setAttribute("role", "alertdialog");
        panel.setAttribute("aria-modal", "true");

        if (opts.title) {
            const title = createEl("h2", "gl-form-modal__delete-title");
            title.textContent = opts.title;
            panel.appendChild(title);
        }

        const body = createEl("p", "gl-form-modal__delete-body");
        body.textContent = opts.message;
        panel.appendChild(body);

        const footer = createEl("div", "gl-form-modal__footer");

        const btnCancel = createEl(
            "button",
            "gl-form-modal__btn gl-form-modal__btn-cancel"
        ) as HTMLButtonElement;
        btnCancel.type = "button";
        btnCancel.textContent = opts.cancelLabel;

        const confirmClass =
            opts.destructive === false ? "gl-form-modal__btn-save" : "gl-form-modal__btn-delete";
        const btnConfirm = createEl(
            "button",
            `gl-form-modal__btn ${confirmClass}`
        ) as HTMLButtonElement;
        btnConfirm.type = "button";
        btnConfirm.textContent = opts.confirmLabel;

        footer.append(btnCancel, btnConfirm);
        panel.appendChild(footer);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        const trap = createFocusTrap(panel, () => settle(false));
        trap.activate();
        // Default focus on the non-destructive (cancel) action for safety.
        // ⚠️ REDONDANT et gardé comme tel : `trap.activate()` fait déjà `focusable[0].focus()`
        // et le bouton d'annulation EST le premier du panneau. Cette ligne ne protège donc
        // que d'un futur réordonnancement du DOM — elle ne porte pas le comportement
        // aujourd'hui. Mesuré à la tâche 5.2 : la retirer ne fait rougir aucun test.
        btnCancel.focus();

        let settled = false;
        function settle(result: boolean): void {
            if (settled) return;
            settled = true;
            trap.deactivate();
            overlay.remove();
            resolve(result);
        }

        btnCancel.addEventListener("click", () => settle(false));
        btnConfirm.addEventListener("click", () => settle(true));
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) settle(false);
        });
    });
}
