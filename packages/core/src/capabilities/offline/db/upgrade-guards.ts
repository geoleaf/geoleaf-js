/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Offline database — what keeps a migration step from aborting the upgrade.
 *
 * A step that runs inside the version-change transaction has two ways to abort it, and an
 * aborted upgrade fails the whole open: the engine then falls back on a store with no
 * persistence. That is far worse than what any step repairs — so a step may fail, never the
 * upgrade. Both guards are needed: one for the error EVENT of a request, one for an EXCEPTION
 * out of a success handler.
 */

import { Log } from "../../../utils/log/index.js";

/**
 * Keeps a failed request from aborting the upgrade: an error event left uncancelled aborts its
 * transaction — here the version-change one, so the whole open would fail.
 *
 * @param request - The request whose failure must stay its own.
 * @param step - The migration step, as the log names it — e.g. `"v7 repair"`.
 * @param what - What the request was doing, completing "could not …".
 * @example
 * spare(store.put(record), "v7 repair", "write the record");
 */
export function spare(request: IDBRequest, step: string, what: string): void {
    request.onerror = (event) => {
        event.preventDefault();
        Log.warn(`[StorageDB] ${step} could not ${what}: ${request.error}`);
    };
}

/**
 * Runs `handler` as a request's success handler: an exception out of it would abort the
 * transaction too.
 *
 * @param step - The migration step, as the log names it.
 * @param handler - The success handler to run.
 * @returns The handler to assign to `onsuccess` — it never throws.
 * @example
 * request.onsuccess = guarded("v7 repair", () => {
 *     store.put(request.result);
 * });
 */
export function guarded(step: string, handler: () => void): () => void {
    return () => {
        try {
            handler();
        } catch (err) {
            Log.warn(`[StorageDB] ${step} stopped: ${err}`);
        }
    };
}
