/**
 * S1 regression tests — blocking-bug fixes (modernisation post-MapLibre).
 *
 * Covers:
 *  - ExportLogic.getPendingPOIs: lists the edits still owed to the server, read from
 *    the core outbox via `listPendingEdits()` (no legacy fallback).
 *    ⚠️ TÂCHE 4.10 — ce test filtrait `add_poi`/`update_poi` sur `sync_queue`. Son SUJET
 *    a déménagé, il n'a pas disparu : depuis 4.4b les deux plugins d'écriture passent par
 *    `Storage.applyEdit()` → outbox, et plus personne n'écrit ces types. Le test est donc
 *    re-pointé sur le magasin réel, pas supprimé.
 *  - SyncManager.updateBackupsList: keys off getBackups (the real DB method),
 *    not the non-existent listBackups.
 *
 * Note: cache-control.js and poi/sync-handler.js are stubbed to empty in the
 * vitest config, so these UI singletons load without their cross-plugin deps.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ExportLogic } from "../ui/cache-button/export-logic.js";

// API publique S4.4 — ce fichier teste du code DU PLUGIN (`ExportLogic`, `SyncManager`), qui
// lit desormais `GeoLeaf.Storage`. Il pilotait le contrat du CORE : le plugin ne lisait donc
// plus ce qu'il plantait, et les deux espions n'etaient jamais appeles. Seul
// `integration/storage-core-contract.integration.test.js` garde le cycle `init()` du core —
// son sujet EST le singleton lui-meme.
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
        // Le core ne rend QUE ce qui est encore dû : il n'y a plus de tri par statut à faire
        // ici, parce qu'une entrée d'outbox résolue n'existe plus. Le filtrage a changé de
        // propriétaire, ce que le test dit en n'en portant plus.
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
        // ⚠️ La géométrie DOIT partir avec : un export de saisies de terrain qui les rendrait
        // sans position ne serait pas une sauvegarde.
        expect(result[0]._geometry).toEqual({ type: "Point", coordinates: [1, 2] });
        // Une suppression est due au serveur comme le reste, et son entité n'existe plus.
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
