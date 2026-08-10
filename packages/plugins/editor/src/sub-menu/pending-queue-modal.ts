/*!
 * @geoleaf-plugins/editor — Pending offline queue detail modal
 * © 2026 Mattieu Pottier — MIT License
 *
 * Lightweight modal listing the editor operations still waiting in the offline
 * sync queue, with a "retry now" button. Reuses the shared form-modal overlay
 * classes and the field-renderer focus trap (same pattern as the conflict modal).
 * https://geoleaf.dev
 */
import { _el, _getLabel } from "../internal.js";
import { createFocusTrap } from "@geoleaf/host-runtime";
import type { EditorQueueEntry } from "../persistence/editor-sync-replay.js";

/**
 * Maps a queue `kind` to its localised operation label.
 *
 * 🛑 **Il dispatchait sur `editor.save` / `editor.update` / `editor.delete` (tâche 4.9).** Ce
 * vocabulaire a perdu son dernier écrivain en 4.4b : l'entrée porte désormais le
 * `SyncOperationKind` du contrat. Aucun test ne rougissait, parce que le `return kind` final
 * rend une chaîne — la modale listait donc `create` / `update` / `delete` bruts, en toutes
 * langues, et un repli qui affiche quelque chose est indiscernable d'un repli qui n'a pas servi.
 *
 * ⚠️ Les CLÉS i18n gardent leur nom (`editor.sync.kind.save`…) : ce sont des adresses de
 * catalogue, pas le vocabulaire de la file. Les renommer toucherait six fichiers de langue
 * pour ne rien rendre plus vrai.
 */
function _kindLabel(kind: string): string {
    if (kind === "create") return _getLabel("editor.sync.kind.save");
    if (kind === "update") return _getLabel("editor.sync.kind.update");
    if (kind === "delete") return _getLabel("editor.sync.kind.delete");
    return kind;
}

/** Builds one list row: "{kind} — {layerId}". */
function _row(entry: EditorQueueEntry): HTMLElement {
    const row = _el("div", "gl-editor-queue-detail__row");
    const kind = _el("span", "gl-editor-queue-detail__kind");
    kind.textContent = _kindLabel(entry.kind);
    const layer = _el("span", "gl-editor-queue-detail__layer");
    layer.textContent = entry.layerId || "—";
    row.append(kind, layer);
    return row;
}

/**
 * Opens the pending-queue detail modal. `onRetry` is invoked when the user
 * presses "retry now"; the modal closes immediately after.
 */
export function openPendingQueueModal(
    entries: EditorQueueEntry[],
    opts: { onRetry: () => void }
): void {
    const overlay = _el("div", "gl-form-modal-overlay");
    const dialog = _el("div", "gl-form-modal-panel gl-editor-queue-detail");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");

    const title = _el("h2", "gl-form-modal__delete-title");
    title.textContent = _getLabel("editor.sync.detail.title");
    dialog.appendChild(title);

    if (entries.length === 0) {
        const empty = _el("p", "gl-form-modal__delete-body");
        empty.textContent = _getLabel("editor.sync.detail.empty");
        dialog.appendChild(empty);
    } else {
        const list = _el("div", "gl-editor-queue-detail__list");
        entries.forEach((e) => list.appendChild(_row(e)));
        dialog.appendChild(list);
    }

    const footer = _el("div", "gl-form-modal__footer");
    const btnClose = _btn("editor.sync.detail.close");
    footer.appendChild(btnClose);
    let btnRetry: HTMLButtonElement | null = null;
    if (entries.length > 0) {
        btnRetry = _btn("editor.sync.detail.retry");
        footer.appendChild(btnRetry);
    }
    dialog.appendChild(footer);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const trap = createFocusTrap(dialog, () => close());
    trap.activate();

    function close(): void {
        trap.deactivate();
        overlay.remove();
    }

    btnClose.addEventListener("click", close);
    btnRetry?.addEventListener("click", () => {
        close();
        opts.onRetry();
    });
}

function _btn(labelKey: string): HTMLButtonElement {
    const b = _el("button", "gl-form-modal__btn") as HTMLButtonElement;
    b.type = "button";
    b.textContent = _getLabel(labelKey);
    return b;
}
