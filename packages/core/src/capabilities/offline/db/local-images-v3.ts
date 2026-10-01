/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Offline database — the v3 migration of `local_images`.
 *
 * Rewrites `uploaded` from a boolean to `0`/`1`. Booleans are not valid IndexedDB keys, so
 * every record written by v2 stayed OUT of the `uploaded` index and `getPendingImages()`
 * rejected with `DataError`: queued images were unreachable, never uploaded, never cleaned.
 * Rewriting the value is what puts the records into the index — the index itself is unchanged
 * and needs no rebuild.
 */

import { Log } from "../../../utils/log/index.js";
import { guarded, spare } from "./upgrade-guards.js";

/** How the log names this step. */
const STEP = "v3 migration";

/**
 * Re-flags every `local_images` record inside the version-change transaction.
 *
 * Never throws and never aborts: a rejected upgrade leaves the whole database unopenable, which
 * is far worse than images that stay out of the index until their next write — a failed read
 * or rewrite is logged, its error event cancelled, and the upgrade goes on.
 *
 * @param tx - The upgrade's version-change transaction.
 * @example
 * const request = indexedDB.open("geoleaf-db", 3);
 * request.onupgradeneeded = (e) => {
 *     if (e.oldVersion > 0 && e.oldVersion < 3 && request.transaction) {
 *         reflagLocalImages(request.transaction);
 *     }
 * };
 */
export function reflagLocalImages(tx: IDBTransaction): void {
    let migrated = 0;
    const cursorRequest = tx.objectStore("local_images").openCursor();
    spare(cursorRequest, STEP, "read local_images");
    cursorRequest.onsuccess = guarded(STEP, () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
            if (migrated > 0) {
                Log.info(
                    `[StorageDB] ${STEP}: ${migrated} local image(s) re-flagged 0/1 and indexed`
                );
            }
            return;
        }
        const record = cursor.value as { id?: unknown; uploaded?: unknown };
        if (typeof record.uploaded !== "number") {
            record.uploaded = record.uploaded ? 1 : 0;
            spare(cursor.update(record), STEP, `rewrite image ${String(record.id)}`);
            migrated++;
        }
        cursor.continue();
    });
}
