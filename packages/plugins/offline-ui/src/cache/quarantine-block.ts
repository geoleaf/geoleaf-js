/*!
 * @geoleaf-plugins/offline-ui
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The captures the drain set aside, by motive, with their two exits — in the cache modal.
 *
 * 🛑 **THE SYNC BLOCK ABOVE COUNTS THEM; THIS ONE LETS THE OPERATOR ACT.** A red count with
 * no gesture was all an application without the editor plugin offered: the two exits the
 * core publishes — requeue a motive once its cause is lifted, discard a capture for good —
 * were reachable from the editor's own window only.
 *
 * ## What it is NOT
 *
 * ⚠️ **Not a second rule.** Which motives can be requeued is the core's answer
 * (`Storage.requeueableReasons()`); what a requeue brought back, and what it left because
 * the cause is still there, is the core's count. This block shows both and decides neither.
 *
 * ⚠️ **Not a second writer of the queue.** Every gesture goes through the PUBLIC facade —
 * `Storage.requeueAll(reason)`, `Storage.discardQuarantined(id, localId)` — and the block
 * repaints from what the core then says (`geoleaf:offline:quarantine-exited`), not from what
 * it assumes its own gesture did.
 *
 * ## The discard
 *
 * It destroys work, so it is confirmed, and the confirmation says how many captures go. The
 * core demands each entry's `localId` AS LISTED: a capture cannot be discarded by something
 * that never enumerated it. This block lists, then discards what it listed.
 */

import { Log, confirmDialog, getUINotifications, tLabel as t } from "@geoleaf/host-runtime";
import { createElement } from "../utils/dom-helpers.js";

import type { CacheControlState } from "./cache-control-types.js";

/**
 * A queue entry, as `Storage.DB.listPendingEdits()` lists it — the element type of the
 * declaration `@geoleaf/core` publishes, not a shape rewritten here. `quarantine`, the motive
 * an entry was set aside for, is there from core 3.15.0.
 */
type AsideEntry = Awaited<ReturnType<NonNullable<GeoLeafStorageDB["listPendingEdits"]>>>[number];

/** The core's public facade, reduced to the quarantine's exits. All optional: older cores. */
interface QuarantineFacade {
    requeueableReasons?(): readonly string[];
    requeueAll?(
        reason?: string
    ): Promise<{ ok: boolean; requeued: number; skipped: number; refused?: string }>;
    discardQuarantined?(
        id: string,
        confirmedLocalId: string
    ): Promise<{ ok: boolean; refused?: string }>;
    DB?: Pick<GeoLeafStorageDB, "listPendingEdits">;
}

/** What makes the set of set-aside entries change: a drain, a capture, an exit. */
const REFRESH_EVENTS = [
    "geoleaf:offline:outbox-drained",
    "geoleaf:offline:outbox-queued",
    "geoleaf:offline:quarantine-exited",
];

/**
 * The label of each motive.
 *
 * 🛑 **A LITERAL TABLE, never `storage.quarantine.reason.${motive}`.** A key built at run
 * time is invisible to the catalogue guard, which reads string literals — and a missing key
 * comes back as the key itself, which no test can tell from a label.
 */
const REASON_LABELS: Record<string, string> = {
    retryBudgetExhausted: "storage.quarantine.reason.retryBudgetExhausted",
    notImplementedByServer: "storage.quarantine.reason.notImplementedByServer",
    authRequired: "storage.quarantine.reason.authRequired",
    layerNoLongerWritable: "storage.quarantine.reason.layerNoLongerWritable",
    dialectNotSupported: "storage.quarantine.reason.dialectNotSupported",
    rejectedByServer: "storage.quarantine.reason.rejectedByServer",
    deletedOnServer: "storage.quarantine.reason.deletedOnServer",
};

/** The facade, read at CALL time: this module may evaluate before `boot()` mounts it. */
function _facade(): QuarantineFacade | null {
    return (globalThis as { GeoLeaf?: { Storage?: QuarantineFacade } }).GeoLeaf?.Storage ?? null;
}

/** A label with its one number in place — appended when a language misses the key. */
function _counted(key: string, count: number): string {
    const label = t(key);
    return label.includes("{0}") ? label.replace("{0}", String(count)) : `${label} : ${count}`;
}

/** What a motive is called. A motive this version has no words for is named as it is. */
function _reasonLabel(reason: string): string {
    const key = REASON_LABELS[reason];
    return key ? t(key) : reason;
}

/** The set-aside entries, grouped by motive, in the order the queue lists them. */
async function _readGroups(): Promise<Map<string, AsideEntry[]>> {
    const groups = new Map<string, AsideEntry[]>();
    const listed = (await _facade()?.DB?.listPendingEdits?.()) ?? [];
    for (const entry of listed) {
        if (entry.state !== "quarantined") continue;
        const reason = entry.quarantine ?? "unknown";
        const group = groups.get(reason);
        if (group) group.push(entry);
        else groups.set(reason, [entry]);
    }
    return groups;
}

/** Requeues one motive, and says what the core answered. */
async function _requeue(reason: string): Promise<void> {
    const out = await _facade()?.requeueAll?.(reason);
    const notify = getUINotifications();
    if (!out || !out.ok) {
        notify?.error(`${t("storage.quarantine.failed")} (${out?.refused ?? "?"})`, 5000);
        return;
    }
    if (out.requeued > 0) {
        notify?.success(_counted("storage.quarantine.requeued", out.requeued), 4000);
    }
    // The core left these: their cause is still there. Said, not hidden behind the success.
    if (out.skipped > 0) {
        notify?.warning(_counted("storage.quarantine.notRequeued", out.skipped), 6000);
    }
}

/** Discards the entries of one motive, on confirmation, each under the identity listed. */
async function _discard(entries: readonly AsideEntry[]): Promise<void> {
    const confirmed = await confirmDialog({
        message: _counted("storage.quarantine.discard.confirm", entries.length),
        confirmLabel: t("storage.quarantine.discard.yes"),
        cancelLabel: t("storage.btn.cancel"),
        destructive: true,
    });
    if (!confirmed) return;
    const facade = _facade();
    let gone = 0;
    let kept = 0;
    for (const entry of entries) {
        const out = await facade?.discardQuarantined?.(entry.entryId, entry.localId);
        if (out?.ok) gone += 1;
        else kept += 1;
    }
    const notify = getUINotifications();
    if (gone > 0) notify?.success(_counted("storage.quarantine.discarded", gone), 4000);
    if (kept > 0) notify?.error(_counted("storage.quarantine.notDiscarded", kept), 6000);
}

/** One motive's row: its count and name, and the exits it has. */
function _paintGroup(
    list: HTMLElement,
    reason: string,
    entries: readonly AsideEntry[],
    requeueable: readonly string[],
    refresh: () => Promise<void>
): void {
    const group = createElement("li", "gl-cache-quarantine__group", list);
    group.setAttribute("data-gl-reason", reason);
    const label = createElement("span", "gl-cache-quarantine__label", group);
    label.textContent = `${entries.length} — ${_reasonLabel(reason)}`;

    const act = (button: HTMLButtonElement, gesture: () => Promise<void>): void => {
        button.type = "button";
        button.addEventListener("click", () => {
            button.disabled = true;
            gesture()
                .catch((error: unknown) => {
                    if (Log) Log.warn("[CacheControl] sortie de quarantaine en échec :", error);
                })
                // Repainted from the queue, whatever the gesture believes it did.
                .finally(() => void refresh());
        });
    };

    if (requeueable.includes(reason)) {
        const requeue = createElement("button", "gl-cache-quarantine__requeue", group);
        requeue.textContent = t("storage.quarantine.requeue");
        act(requeue, () => _requeue(reason));
    }
    const discard = createElement("button", "gl-cache-quarantine__discard", group);
    discard.textContent = t("storage.quarantine.discard");
    act(discard, () => _discard(entries));
}

/** Re-reads the queue and repaints. Never throws: a stale block beats a lost modal. */
async function _refresh(root: HTMLElement): Promise<void> {
    try {
        const groups = await _readGroups();
        const list = root.querySelector<HTMLElement>(".gl-cache-quarantine__list");
        if (!list) return;
        list.replaceChildren();
        root.hidden = groups.size === 0;
        if (groups.size === 0) return;
        const requeueable = _facade()?.requeueableReasons?.() ?? [];
        for (const [reason, entries] of groups) {
            _paintGroup(list, reason, entries, requeueable, () => _refresh(root));
        }
    } catch (error: unknown) {
        if (Log) Log.warn("[CacheControl] quarantaine illisible :", error);
    }
}

/**
 * Builds the block and appends it — right under the sync-status block, whose count it explains.
 *
 * Hidden while nothing is set aside. Its listeners go to `self._eventCleanups`, for the reason
 * the sync block gives: this body is rebuilt on every round trip through the Export tab, and a
 * listener left behind is one more database read per capture.
 *
 * @param self - The `CacheControl` instance being built.
 * @param bodyEl - `.gl-cache-control__body`.
 */
export function buildQuarantineBlock(self: CacheControlState, bodyEl: HTMLElement): void {
    const root = createElement("div", "gl-cache-quarantine", bodyEl);
    root.hidden = true;
    const title = createElement("div", "gl-cache-quarantine__title", root);
    title.textContent = t("storage.quarantine.title");
    createElement("ul", "gl-cache-quarantine__list", root);

    const onChange = () => void _refresh(root);
    for (const name of REFRESH_EVENTS) {
        document.addEventListener(name, onChange);
        self._eventCleanups.push(() => document.removeEventListener(name, onChange));
    }

    void _refresh(root);
}
