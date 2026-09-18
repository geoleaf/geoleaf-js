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
 * 🛑 **It dispatched on `editor.save` / `editor.update` / `editor.delete`.**
 * That vocabulary lost its last writer: the entry now carries the contract's
 * `SyncOperationKind`. No test turned red, because the final `return kind`
 * yields a string — the modal thus listed raw `create` / `update` / `delete`,
 * in every language, and a fallback that displays something is
 * indistinguishable from a fallback that never served.
 *
 * ⚠️ The i18n KEYS keep their names (`editor.sync.kind.save`…): they are
 * catalogue addresses, not the queue's vocabulary. Renaming them would touch
 * six language files to make nothing truer.
 */
function _kindLabel(kind: string): string {
    if (kind === "create") return _getLabel("editor.sync.kind.save");
    if (kind === "update") return _getLabel("editor.sync.kind.update");
    if (kind === "delete") return _getLabel("editor.sync.kind.delete");
    return kind;
}

/**
 * Maps a queue state to its localised label — empty for `pending`, the ordinary case.
 *
 * ⚠️ `pending` says nothing the window does not already say by listing the entry, and a badge
 * on every row would drown the three states that carry information.
 */
function _stateLabel(state: string | undefined): string {
    if (state === "inFlight") return _getLabel("editor.sync.detail.state.inFlight");
    if (state === "failed") return _getLabel("editor.sync.detail.state.failed");
    if (state === "quarantined") return _getLabel("editor.sync.detail.state.quarantined");
    return "";
}

/**
 * Maps a quarantine motive to its localised explanation.
 *
 * 🛑 **A LITERAL TABLE, never `editor.sync.detail.reason.${motive}`.** The i18n catalogue
 * guard (`lang-catalogue.test.ts`) scans STRING LITERALS: a key built at runtime is invisible
 * to it, and would have to be excused in `DYNAMIC_PREFIXES` — i.e. exempted from the very
 * check that exists because `GeoLeaf.I18n.getLabel` returns the raw key on a miss, which no
 * test can tell from a correct label.
 *
 * ⚠️ An unknown motive yields the empty string, not the motive: the contract's vocabulary is
 * machine vocabulary, and showing it is the defect `_kindLabel` above records.
 */
function _reasonLabel(reason: string | undefined): string {
    switch (reason) {
        case "retryBudgetExhausted":
            return _getLabel("editor.sync.detail.reason.retryBudgetExhausted");
        case "notImplementedByServer":
            return _getLabel("editor.sync.detail.reason.notImplementedByServer");
        case "authRequired":
            return _getLabel("editor.sync.detail.reason.authRequired");
        case "layerNoLongerWritable":
            return _getLabel("editor.sync.detail.reason.layerNoLongerWritable");
        case "dialectNotSupported":
            return _getLabel("editor.sync.detail.reason.dialectNotSupported");
        case "rejectedByServer":
            return _getLabel("editor.sync.detail.reason.rejectedByServer");
        case "deletedOnServer":
            return _getLabel("editor.sync.detail.reason.deletedOnServer");
        default:
            return "";
    }
}

/**
 * What the window can do about one entry, beyond showing it.
 *
 * ⚠️ NOT exported: it is named only by {@link openPendingQueueModal}'s own signature, and
 * `queue-detail.ts` — its only caller — passes an object literal. Exporting it would add a
 * public name nobody imports, which `check-orphan-exports` counts as a regression; it was
 * seen doing exactly that.
 */
interface PendingQueueActions {
    /** Drain the queue now — `pending` and `failed` only, by the core's rule. */
    onRetry: () => void;
    /** Put every entry set aside under this motive back in the queue, then drain. */
    onRequeue?: (reason: string) => void;
    /** Destroy one entry no replay can repair, after the user confirmed. */
    onDiscard?: (entry: EditorQueueEntry) => void;
    /**
     * The motives an operator's gesture can lift.
     *
     * 🛑 **HANDED IN, never known here.** The rule lives in the core
     * (`write/quarantine-api.ts#requeueableReasons`), and this plugin cannot import the core
     * (`INV-NS`): a copy here would be free to diverge on the exact point the arbitration of
     * 07/08/2026 settled, and no gate could see it. Absent, the window offers no group —
     * which is the honest reading of "the engine did not tell me".
     */
    requeueable?: readonly string[];
}

/** Builds one list row: "{kind} — {layer} — {state}{, motive}". */
function _row(entry: EditorQueueEntry): HTMLElement {
    const row = _el("div", "gl-editor-queue-detail__row");
    const kind = _el("span", "gl-editor-queue-detail__kind");
    kind.textContent = _kindLabel(entry.kind);
    const layer = _el("span", "gl-editor-queue-detail__layer");
    layer.textContent = entry.layerId || "—";
    const state = _el("span", "gl-editor-queue-detail__state");
    const stateText = _stateLabel(entry.state);
    const reasonText = _reasonLabel(entry.quarantine);
    state.textContent = stateText && reasonText ? `${stateText} — ${reasonText}` : stateText;
    row.append(kind, layer, state);
    return row;
}

/**
 * The set-aside entries, grouped by motive, in first-seen order.
 *
 * ⚠️ An entry `quarantined` without a motive is left out: the group's whole purpose is to
 * name what to do about it, and "retry the ones with no reason" is not an offer.
 */
function _byReason(entries: EditorQueueEntry[]): Map<string, EditorQueueEntry[]> {
    const groups = new Map<string, EditorQueueEntry[]>();
    for (const entry of entries) {
        if (entry.state !== "quarantined" || !entry.quarantine) continue;
        const bucket = groups.get(entry.quarantine);
        if (bucket) bucket.push(entry);
        else groups.set(entry.quarantine, [entry]);
    }
    return groups;
}

/**
 * Builds the quarantine section: one "retry all" per requeueable motive, and a confirmed
 * discard for every entry no replay can repair.
 *
 * 🛑 **THE TWO HALVES ARE NOT SYMMETRIC, AND THAT IS THE SUBJECT.** A requeueable motive
 * takes a BATCH gesture — what produces quarantines is never one entry, it is a dead token or
 * a maintenance window setting a whole tour aside. A non-requeueable one takes a PER-ENTRY
 * gesture, because its only exit destroys a field capture: `discardQuarantined` demands
 * `confirmedLocalId` exactly so the capture is enumerated before being lost.
 *
 * @param entries - The whole queue, as the window reads it.
 * @param opts - What the window can do, and the rule it was handed.
 * @returns The section, or `null` when nothing is set aside.
 */
function _quarantineSection(
    entries: EditorQueueEntry[],
    opts: PendingQueueActions
): HTMLElement | null {
    const groups = _byReason(entries);
    if (groups.size === 0) return null;
    const requeueable = new Set(opts.requeueable ?? []);

    const section = _el("div", "gl-editor-queue-detail__quarantine");
    const title = _el("h3", "gl-editor-queue-detail__quarantine-title");
    title.textContent = _getLabel("editor.sync.detail.quarantined.title");
    section.appendChild(title);

    for (const [reason, group] of groups) {
        const block = _el("div", "gl-editor-queue-detail__group");
        section.appendChild(block);
        const label = _el("span", "gl-editor-queue-detail__group-label");
        label.textContent = `${_reasonLabel(reason)} (${group.length})`;
        block.appendChild(label);

        // 🛑 THE BRANCH IS DECIDED BY THE MOTIVE, never by which handler was supplied. Gating
        // it on `onRequeue` made a requeueable motive fall through to the DESTRUCTIVE half as
        // soon as the caller omitted that handler — offering to discard captures a retry
        // would have brought back. Seen red: three discard buttons where one was expected.
        if (requeueable.has(reason)) {
            if (!opts.onRequeue) continue;
            const retry = _el("button", "gl-form-modal__btn gl-editor-queue-detail__requeue");
            (retry as HTMLButtonElement).type = "button";
            retry.textContent = _getLabel("editor.sync.detail.requeueAll");
            // Spelled in full, never `dataset.glReason = …` alone: purgecss extracts its
            // tokens from the SOURCE, and the E2E reads the attribute to name the group.
            retry.setAttribute("data-gl-reason", reason);
            retry.addEventListener("click", () => opts.onRequeue?.(reason));
            block.appendChild(retry);
            continue;
        }

        // No replay repairs this motive: its only exit destroys the capture, so it is offered
        // per entry and behind a confirmation.
        if (!opts.onDiscard) continue;
        for (const entry of group) {
            block.appendChild(_discardControl(entry, opts));
        }
    }
    return section;
}

/**
 * The discard control of one entry: a button that asks, then a button that does.
 *
 * ⚠️ **Two clicks, and the second one is a DIFFERENT button.** A confirm swapped onto the
 * same node is a control whose meaning changed under the pointer — the classic double-click
 * destroy. The second button carries its own class, which is what the harness and the E2E
 * assert on.
 */
function _discardControl(entry: EditorQueueEntry, opts: PendingQueueActions): HTMLElement {
    const wrap = _el("span", "gl-editor-queue-detail__discard-wrap");
    const ask = _el("button", "gl-form-modal__btn gl-editor-queue-detail__discard");
    (ask as HTMLButtonElement).type = "button";
    ask.textContent = _getLabel("editor.sync.detail.discard");
    ask.setAttribute("data-gl-entry", entry.id);
    wrap.appendChild(ask);

    ask.addEventListener("click", () => {
        if (wrap.querySelector(".gl-editor-queue-detail__discard-confirm")) return;
        ask.hidden = true;
        const warn = _el("span", "gl-editor-queue-detail__discard-warn");
        wrap.appendChild(warn);
        warn.textContent = _getLabel("editor.sync.detail.discard.confirm");
        const yes = _el("button", "gl-form-modal__btn gl-editor-queue-detail__discard-confirm");
        (yes as HTMLButtonElement).type = "button";
        yes.textContent = _getLabel("editor.sync.detail.discard.yes");
        yes.setAttribute("data-gl-entry", entry.id);
        yes.addEventListener("click", () => opts.onDiscard?.(entry));
        wrap.appendChild(yes);
    });
    return wrap;
}

/**
 * Opens the pending-queue detail modal. `onRetry` is invoked when the user
 * presses "retry now"; the modal closes immediately after.
 *
 * ⚠️ **The quarantine gestures do NOT close it.** Requeueing a motive or discarding an entry
 * leaves the window open: they are the reason it was opened, and closing after each one would
 * make clearing a tour a sequence of re-openings.
 *
 * @param entries - Everything owed to the server, set-aside entries included.
 * @param opts - What the window can do about them.
 * @example
 * openPendingQueueModal(await listPendingEditorEntries(), {
 *     onRetry: () => void flushNow(),
 *     onRequeue: (reason) => void requeueByReason(reason),
 *     requeueable: requeueableReasons(),
 * });
 */
export function openPendingQueueModal(
    entries: EditorQueueEntry[],
    opts: PendingQueueActions
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
        const quarantine = _quarantineSection(entries, opts);
        if (quarantine) dialog.appendChild(quarantine);
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
    const b = _el("button", "gl-form-modal__btn");
    b.type = "button";
    b.textContent = _getLabel(labelKey);
    return b;
}
