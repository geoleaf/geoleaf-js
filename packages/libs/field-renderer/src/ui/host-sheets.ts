/*!
 * @geoleaf/field-renderer — The sheets the form borrows
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @sideEffectGraft packages/libs/field-renderer/src/ui/responsive-modal.ts
 *
 * Adopts, at import, the two stylesheets of `@geoleaf/host-runtime` the form's modal is built
 * on: the shell (overlay and panel) and the dialog (footer and buttons).
 *
 * 🛑 A MODULE OF ITS OWN, AND IMPORTED FIRST, FOR THE ORDER. `ui/responsive-modal.ts` writes
 * those classes itself and then styles what it adds on top. Its own sheets are injected when
 * their modules are evaluated; this module is evaluated before them, so the borrowed rules
 * come first in the cascade and the form's come after.
 *
 * ⚠️ That order is the ordinary case, not a guarantee: another bundle's copy of the same
 * sheets can be adopted later. What the form adds on these classes is therefore written at a
 * higher specificity — see the head of `css/form-modal-base.css`.
 */
import { adoptConfirmDialogSheet, adoptModalShellSheet } from "@geoleaf/host-runtime";

adoptModalShellSheet();
adoptConfirmDialogSheet();
