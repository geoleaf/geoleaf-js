/*!
 * @geoleaf-plugins/offline-ui
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The write queue, said in full and at all times, at the top of the cache modal.
 *
 * 🛑 **THIS IS THE HALF THE CORE'S STRIP DELIBERATELY GAVE UP.** That strip now shows itself
 * only when it carries information — owed captures, set-aside entries, or the network down —
 * because on a consultation profile it otherwise spent a whole session repeating "everything
 * sent" over ~43 px of chrome, on top of the theme pills. Something still has to answer the
 * question when the strip is silent, and "did everything of mine leave?" is exactly the
 * question one opens this modal to ask. So the same four facts live here, permanently, with
 * no dismiss button: this is the place one comes to look.
 *
 * ## What it is NOT
 *
 * ⚠️ **Not a second tally.** It calls `Storage.getSyncStatus()` — the core's single read —
 * and adds nothing up itself. Three counts of "what is owed" already existed here and they
 * disagreed, each having picked its own set of states; the core owns that set now.
 *
 * ⚠️ **Not the Export tab's sync section either.** That one (`sync/sync-manager.ts`,
 * `storage.sync.btn`) breaks the queue down by verb and goes through the handler registered
 * by `@geoleaf-plugins/editor` — without that plugin it shows `storage.sync.unavailable`.
 * This block depends on no plugin at all, which is the whole point of reading the core.
 *
 * ## Labels
 *
 * The `ui.sync.*` keys belong to the CORE's dictionaries, in six languages. `tLabel` resolves
 * flat against `GeoLeaf.I18n.getLabel`, so they are reused as they are — duplicating six
 * locales to say "Everything sent" twice would be six chances to drift.
 */

import { Log } from "@geoleaf/host-runtime";
import { createElement } from "../utils/dom-helpers.js";
import { StorageContract } from "../shared/storage-contract.js";

import type { CacheControlState } from "./cache-control-types.js";
import type { SyncStatus } from "@geoleaf/core/contracts/sync.contract.js";

/** The queue events the core emits, plus the native network pair. */
const QUEUE_EVENTS = ["geoleaf:offline:outbox-queued", "geoleaf:offline:outbox-drained"];

/**
 * Resolves a core label, interpolating `{0}`, `{1}`… from `args`.
 *
 * 🛑 **AND NOT `tLabel`, WHICH WOULD HAVE PRINTED `{0} en attente` VERBATIM.** The two seams
 * take a second argument of the same TYPE and opposite meaning: `getLabel(key, ...values)`
 * interpolates, `tLabel(key, fallback)` returns that string when the key misses and never
 * substitutes anything. Three of the five keys used here carry a `{0}` — the pending count,
 * the quarantine count and the elapsed time — so the wrong seam is not a style question, it
 * is the counter not being displayed.
 *
 * ⚠️ Read at CALL time: this module may evaluate before `boot()` mounts `GeoLeaf.I18n`.
 */
function t(key: string, ...args: string[]): string {
    const fn = (
        globalThis as {
            GeoLeaf?: { I18n?: { getLabel?(k: string, ...a: string[]): string } };
        }
    ).GeoLeaf?.I18n?.getLabel;
    // The key itself on a miss — the same signal the core uses, and a visible one.
    return fn ? fn(key, ...args) : key;
}

/** "3 min", "2 h", "4 j" — a duration, not a clock reading, same as the core's strip. */
function _ago(at: number, now: number): string {
    const minutes = Math.max(0, Math.round((now - at) / 60_000));
    if (minutes < 1) return t("ui.sync.last_at", "< 1 min");
    if (minutes < 60) return t("ui.sync.last_at", `${minutes} min`);
    const hours = Math.round(minutes / 60);
    if (hours < 24) return t("ui.sync.last_at", `${hours} h`);
    return t("ui.sync.last_at", `${Math.round(hours / 24)} j`);
}

/** Writes the four facts into an already-built block. */
function _paint(root: HTMLElement, status: SyncStatus): void {
    const { online, owed, quarantined, lastSyncAt } = status;
    const find = (cls: string) => root.querySelector<HTMLElement>(`.gl-cache-sync-status__${cls}`);
    // Spelled out literally, never `dataset.network`: purgecss extracts its tokens from the
    // SOURCE, so an attribute never written in full is a selector it reports as dead. Same
    // rule, and the same reason, as the core's strip.
    root.setAttribute("data-network", online ? "online" : "offline");
    const net = find("net");
    if (net) net.textContent = t(online ? "ui.sync.online" : "ui.sync.offline");
    const pending = find("pending");
    if (pending) {
        pending.textContent =
            owed === 0
                ? t("ui.sync.all_sent")
                : owed === 1
                  ? t("ui.sync.pending_one")
                  : t("ui.sync.pending_many", String(owed));
    }
    const quar = find("quarantine");
    if (quar) {
        quar.textContent = quarantined > 0 ? t("ui.sync.quarantined", String(quarantined)) : "";
        quar.hidden = quarantined === 0;
    }
    const last = find("last");
    if (last) {
        last.textContent =
            lastSyncAt === null ? t("ui.sync.last_never") : _ago(lastSyncAt, Date.now());
    }
    const action = find("action") as HTMLButtonElement | null;
    // A button that does nothing when pressed teaches the user to stop pressing it.
    if (action) action.disabled = owed === 0 || !online;
}

/** Re-reads the queue and repaints. Never throws: a stale panel beats a lost one. */
async function _refresh(root: HTMLElement): Promise<void> {
    try {
        _paint(root, await StorageContract.getSyncStatus());
    } catch (error: unknown) {
        if (Log) Log.warn("[CacheControl] statut de synchronisation illisible :", error);
    }
}

/**
 * Builds the block and appends it — call it FIRST, so it lands above the STATUT accordion.
 *
 * 🛑 **The listeners are registered in `self._eventCleanups`, and that is load-bearing.** This
 * package listened to no outbox event at all and ran no timer, so a block posted here would
 * simply never update. And the modal never calls `onRemove`: `ModalManager.destroy()` has no
 * caller, while a round trip through the Export tab rebuilds this whole body. Without the
 * unsubscribe entries, every such round trip would leave one more listener behind — one more
 * database read per capture, on a device that is short of both battery and patience.
 *
 * @param self - The `CacheControl` instance being built.
 * @param bodyEl - `.gl-cache-control__body`, still empty at this point.
 */
export function buildSyncStatusBlock(self: CacheControlState, bodyEl: HTMLElement): void {
    const root = createElement("div", "gl-cache-sync-status", bodyEl);
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "polite");

    createElement("span", "gl-cache-sync-status__dot", root);
    createElement("span", "gl-cache-sync-status__net", root);
    const sep = createElement("span", "gl-cache-sync-status__sep", root);
    sep.textContent = "·";
    createElement("span", "gl-cache-sync-status__pending", root);
    const quar = createElement("span", "gl-cache-sync-status__quarantine", root);
    quar.hidden = true;
    createElement("span", "gl-cache-sync-status__last", root);

    const action = createElement("button", "gl-cache-sync-status__action", root);
    action.type = "button";
    action.textContent = t("ui.sync.action");
    action.disabled = true;
    action.addEventListener("click", () => {
        // ⚠️ `_requestOutboxDrain` and NOT `SyncManager.handleSync()`: the latter goes through
        // the handler `@geoleaf-plugins/editor` registers, and this block exists precisely to
        // say the truth on an application that does not ship it.
        const storage = (
            globalThis as { GeoLeaf?: { Storage?: { _requestOutboxDrain?(c: string): void } } }
        ).GeoLeaf?.Storage;
        storage?._requestOutboxDrain?.("cache-modal");
    });

    const onQueueChange = () => void _refresh(root);
    for (const name of QUEUE_EVENTS) {
        document.addEventListener(name, onQueueChange);
        self._eventCleanups.push(() => document.removeEventListener(name, onQueueChange));
    }
    for (const name of ["online", "offline"]) {
        // Native events, not `geoleaf:online` — the detector emitting those is opt-in, and a
        // panel that goes blind because a profile turned a badge off would be worse than none.
        window.addEventListener(name, onQueueChange);
        self._eventCleanups.push(() => window.removeEventListener(name, onQueueChange));
    }

    void _refresh(root);
}
