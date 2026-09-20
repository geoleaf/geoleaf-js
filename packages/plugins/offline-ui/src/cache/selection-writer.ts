/*!
 * @geoleaf-plugins/offline-ui
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description The one door through which the saved download selection is written.
 *
 * 🛑 **TWO WRITERS, ONE KEY, AND A LOST UPDATE.** The download window keeps its selection in a
 * single preference — the layers and basemaps ticked in the list, and the zone drawn in the ZONE
 * accordion. Both halves were written by a read-modify-write of the WHOLE record, from two
 * places that do not wait for each other: the list reads at the start of its save and writes
 * after all its DOM work and its estimates, so a zone persisted in between was overwritten. And
 * the opening of the window is one of those writers, since the list saves its initial state when
 * a profile has none.
 *
 * What it cost, measured on the shipped bundle: a download whose zone had just been picked left
 * with NO extent — the pull asked for the whole collection, and the tiles for the whole map —
 * one run in two of `e2e/55`'s neighbour, `e2e/54`.
 *
 * Every read-modify-write goes through {@link updateSelection}, which runs them one after the
 * other: each one re-reads what the previous one wrote.
 *
 * ⚠️ **It serialises this tab, and only this tab.** Two tabs of the same profile can still
 * overwrite each other — the store has no compare-and-set — and nothing here pretends otherwise.
 * The writers this module serves all live in this window.
 */

import { StorageContract } from "../shared/storage-contract.js";

/** The saved selection, as the two writers and the download read it. */
type SavedSelectionRecord = Record<string, unknown>;

/** The seam this module needs from the core's cache storage. */
interface SelectionStore {
    loadLayerSelection: (profileId: string) => Promise<SavedSelectionRecord | null>;
    saveLayerSelection: (profileId: string, selection: SavedSelectionRecord) => Promise<void>;
}

/** The tail of the chain: what the next update waits for. */
let pending: Promise<unknown> = Promise.resolve();

/**
 * Reads the saved selection, applies `mutate` to it and writes the result — without
 * interleaving with another call.
 *
 * The mutator receives what the store holds at ITS turn, never a copy read earlier: a writer
 * that only changes its own half keeps whatever the previous one wrote.
 *
 * @param profileId - Profile whose selection is written; an empty id does nothing.
 * @param mutate - Builds the record to store from the one just read.
 * @returns When the write has landed, or immediately when there is nothing to write to.
 * @example
 * await updateSelection("tourism", (current) => ({ ...current, vectorZone: zone }));
 */
export function updateSelection(
    profileId: string,
    mutate: (current: SavedSelectionRecord) => SavedSelectionRecord
): Promise<void> {
    const run = pending.then(async () => {
        const store = StorageContract.Cache?.Storage as SelectionStore | undefined;
        if (!profileId || !store?.loadLayerSelection || !store?.saveLayerSelection) return;
        const current = (await store.loadLayerSelection(profileId)) ?? {};
        await store.saveLayerSelection(profileId, mutate(current));
    });
    // The chain must survive a failed write: a rejection kept here would refuse every later
    // update. The caller still receives the rejection through `run`.
    pending = run.catch(() => {});
    return run;
}
