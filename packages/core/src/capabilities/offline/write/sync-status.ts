/*!
 * GeoLeaf Core (offline capability) — Sync status
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * The four facts about the write queue, read once, in one place.
 *
 * 🛑 **THIS FILE EXISTS BECAUSE "WHAT IS STILL OWED" WAS ABOUT TO GET A FOURTH ANSWER.**
 * Three already existed: the sync strip's own private read (`ui/sync-banner.ts`), the
 * editor's `getSyncSummary()` — whose seam states outright that counting differently makes
 * the totals diverge — and `offline-ui`'s Export tab, which renders that summary broken down
 * by verb. A fourth was due the moment a second surface had to show the same numbers, and a
 * plugin cannot reach the strip's read: `@geoleaf/core` is externalised by a regex matching
 * the bare specifier only, so a deep import would be bundled as a COPY, with a
 * `StorageContract` singleton nothing in the plugin's graph ever initialises.
 *
 * So the read moves here and is published once, through the facade. Both surfaces call it;
 * neither owns it.
 *
 * ⚠️ **In the deferred chunk, and not in the boot graph.** It reads the outbox, so it belongs
 * where the outbox does — the facade holds a handle, exactly as it does for the drain.
 */

import { Log } from "../../../utils/log/index.js";
import { StorageContract } from "../../../kernel/shared/index.js";
import { LAST_SYNC_PREFERENCE } from "./push-engine.js";
import type { SyncStatus } from "../../../contracts/sync.contract.js";

/**
 * States that mean "still owed to the server" — the same set the drain replays.
 *
 * ⚠️ `quarantined` is deliberately NOT here: an entry set aside is no longer owed, it is
 * blocked, and folding the two would make a drain look like it had nothing to do while
 * captures sat unsent under a named motive.
 */
const OWED = new Set(["pending", "failed", "inFlight"]);

/** The outbox module, or `null` while the engine is not wired. */
function _outbox(): { list?(): Promise<{ state: string }[]> } | null {
    const db = StorageContract.DB as {
        _ensureModule?: (name: string) => { list?(): Promise<{ state: string }[]> } | null;
    } | null;
    return db?._ensureModule?.("Outbox") ?? null;
}

/**
 * The last instant the server accepted something, or `null`.
 *
 * ⚠️ Goes through `_ensureModule("Preferences")` and NOT `DB.getPreference()`, which THROWS
 * when the module is absent. A status read that can throw is a status read every caller has
 * to wrap, and one of them will forget.
 */
async function _lastSyncAt(): Promise<number | null> {
    const db = StorageContract.DB as {
        _ensureModule?: (
            name: string
        ) => { getPreference?(key: string, def?: unknown): Promise<unknown> } | null;
    } | null;
    const prefs = db?._ensureModule?.("Preferences");
    const value = await prefs?.getPreference?.(LAST_SYNC_PREFERENCE, null);
    return typeof value === "number" ? value : null;
}

/**
 * Reads the queue and says what it owes.
 *
 * Never throws, and never invents: with no engine wired it answers zeros and `null`, which
 * is what "there is no queue here" looks like — the caller then shows "nothing owed", which
 * is true.
 *
 * @returns The four facts, read in one pass.
 * @example
 * const s = await GeoLeaf?.Storage?.getSyncStatus?.();
 * if (s && s.owed > 0 && !s.online) console.warn(`${s.owed} écriture(s) en attente de réseau`);
 */
export async function readSyncStatus(): Promise<SyncStatus> {
    const online = typeof navigator === "undefined" || navigator.onLine !== false;
    try {
        const entries = (await _outbox()?.list?.()) ?? [];
        let owed = 0;
        let quarantined = 0;
        for (const entry of entries) {
            if (OWED.has(entry.state)) owed += 1;
            else if (entry.state === "quarantined") quarantined += 1;
        }
        return { online, owed, quarantined, lastSyncAt: await _lastSyncAt() };
    } catch (e) {
        // A status read that throws takes its caller with it; one that answers "nothing
        // known" is merely uninformative. Neither is good — only one of them loses the page.
        Log.warn("[Offline.SyncStatus] lecture en échec :", e);
        return { online, owed: 0, quarantined: 0, lastSyncAt: null };
    }
}
