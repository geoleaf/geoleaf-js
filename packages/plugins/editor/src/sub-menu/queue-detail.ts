/*!
 * @geoleaf-plugins/editor — Pending-queue window wiring
 * © 2026 Mattieu Pottier — MIT License
 *
 * What the pending-operations window can DO, wired to the core's queue.
 *
 * ⚠️ **It lives beside the window rather than in `entry.ts`, and the reason is measured**:
 * `entry.ts` is a composition root, and the quarantine gestures took it to 721 lines against
 * the plugin contract's 700 (PC-08, seen red). A root that grows with every gesture it wires
 * stops being a root.
 * https://geoleaf.dev
 */
import { openPendingQueueModal } from "./pending-queue-modal.js";
import {
    discardEntry,
    flushNow,
    listPendingEditorEntries,
    requeueableReasons,
    requeueByReason,
} from "../persistence/editor-sync-replay.js";

/**
 * Opens the pending-operations window, wired to the three gestures the queue accepts.
 *
 * ⚠️ **The window is RE-OPENED after a quarantine gesture, never patched in place.** Both
 * gestures change the queue on the core's side, so the only honest way to show the result is
 * to re-read it — patching the DOM would make the window a second, divergent tally of what is
 * owed, which is the defect `offline-ui`'s status block records for its own ancestors.
 *
 * @returns Nothing — the window is appended to `document.body`.
 * @example
 * initEditorMenu(config, { onPendingBadgeClick: openQueueDetail });
 */
export function openQueueDetail(): void {
    void listPendingEditorEntries().then((entries) =>
        openPendingQueueModal(entries, {
            onRetry: () => void flushNow(),
            onRequeue: (reason) => void requeueByReason(reason).then(_reopen),
            onDiscard: (entry) => void discardEntry(entry).then(_reopen),
            requeueable: requeueableReasons(),
        })
    );
}

/** Closes the window and re-reads the queue behind it. */
function _reopen(): void {
    document.querySelector(".gl-form-modal-overlay")?.remove();
    openQueueDetail();
}
