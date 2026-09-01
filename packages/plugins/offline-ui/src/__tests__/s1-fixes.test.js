/**
 * S1 regression tests — blocking-bug fixes (modernisation post-MapLibre).
 *
 * Covers:
 *  - ExportLogic.getPendingPOIs: lists the edits still owed to the server, read from
 *    the core outbox via `listPendingEdits()` (no legacy fallback).
 *    ⚠️ This test filtered `add_poi`/`update_poi` on `sync_queue`. Its SUBJECT
 *    moved, it did not disappear: both writing plugins go through
 *    `Storage.applyEdit()` → outbox, and nobody writes those types any more.
 *    The test is thus re-pointed at the real store, not deleted.
 *  - SyncManager.updateBackupsList: keys off getBackups (the real DB method),
 *    not the non-existent listBackups.
 *
 * Note: cache-control.js and poi/sync-handler.js are stubbed to empty in the
 * vitest config, so these UI singletons load without their cross-plugin deps.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ExportLogic } from "../ui/cache-button/export-logic.js";

// This file tests PLUGIN code (`ExportLogic`, `SyncManager`), which now reads
// `GeoLeaf.Storage`. It drove the CORE's contract: the plugin no longer read
// what it planted, and the two spies were never called. Only
// `integration/storage-core-contract.integration.test.js` keeps the core's
// `init()` cycle — its subject IS the singleton itself.
function _installGeoLeafStorage(api) {
    globalThis.GeoLeaf = globalThis.GeoLeaf ?? {};
    globalThis.GeoLeaf.Storage =
        api === null || api === undefined
            ? null
            : { isPluginLoaded: () => true, isAvailable: () => !!api.DB, ...api };
    return api;
}

describe("S1 — ExportLogic.getPendingPOIs", () => {
    beforeEach(() => {
        _installGeoLeafStorage(null);
    });

    it("returns [] when the Storage plugin is unavailable (no legacy fallback)", async () => {
        _installGeoLeafStorage(null);
        await expect(ExportLogic.getPendingPOIs()).resolves.toEqual([]);
    });

    it("rend les saisies dues, avec leurs attributs et leur géométrie", async () => {
        // The core returns ONLY what is still owed: there is no status sorting
        // left to do here, because a resolved outbox entry no longer exists.
        // Filtering changed owner, which the test says by no longer carrying
        // any.
        const listPendingEdits = vi.fn().mockResolvedValue([
            {
                entryId: "e1",
                kind: "create",
                layerId: "sites",
                localId: "a",
                state: "pending",
                createdAt: 1,
                feature: {
                    type: "Feature",
                    geometry: { type: "Point", coordinates: [1, 2] },
                    properties: { name: "A" },
                },
            },
            {
                entryId: "e2",
                kind: "delete",
                layerId: "sites",
                localId: "d",
                state: "failed",
                createdAt: 4,
                feature: null,
            },
        ]);
        _installGeoLeafStorage({ isAvailable: () => true, DB: { listPendingEdits } });

        const result = await ExportLogic.getPendingPOIs();

        expect(listPendingEdits).toHaveBeenCalledTimes(1);
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({
            name: "A",
            _syncOperation: "create",
            _syncStatus: "pending",
            _syncQueueId: "e1",
            _syncTimestamp: 1,
            _layerId: "sites",
            _localId: "a",
        });
        // ⚠️ The geometry MUST go along: an export of field captures rendering
        // them position-less would not be a backup.
        expect(result[0]._geometry).toEqual({ type: "Point", coordinates: [1, 2] });
        // A deletion is owed to the server like the rest, and its entity no longer exists.
        expect(result[1]).toMatchObject({ _syncOperation: "delete", _geometry: null });
    });

    it("returns [] when the DB call rejects", async () => {
        const listPendingEdits = vi.fn().mockRejectedValue(new Error("boom"));
        _installGeoLeafStorage({ isAvailable: () => true, DB: { listPendingEdits } });
        await expect(ExportLogic.getPendingPOIs()).resolves.toEqual([]);
    });

    it("no longer exposes the legacy openDatabase fallback", () => {
        expect(ExportLogic.openDatabase).toBeUndefined();
    });
});
