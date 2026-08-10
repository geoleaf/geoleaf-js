/**
 * StorageDB — boot seam: init / _ensureModule / close (CAPACITÉS B.7)
 *
 * `sync-queue-compat-surface.test.js` and `images-idb-keys.test.js` reach the façade by
 * assigning `IndexedDB._db` by hand, so `init()` — the method every plugin call funnels
 * through — had never run in the core suite, and neither had the lazy `_ensureModule`
 * path nor `close()`. What is exercised here is the degradation contract: when IndexedDB
 * is unavailable the engine must keep the application alive rather than reject.
 *
 * ⚠️ ESM `import`, not `require()` — see the measurement note in
 * `storage-helper-validation.test.js`.
 */

import "fake-indexeddb/auto";
import { IndexedDB } from "../../../src/capabilities/offline/db/indexeddb.ts";
import { DBModulesRegistry } from "../../../src/capabilities/offline/db/db-modules-registry.ts";

const DB_NAME = "geoleaf-db"; // fixed by StorageDB._dbName — not a choice here.

// ⚠️ L'ÉCOUTEUR DE `geoleaf:storage:ready` A ÉTÉ RETIRÉ D'ICI (B-72, 03/08/2026) — le signal
// n'existe plus. Il n'avait aucune charge utile, partait à chaque ouverture de base et n'avait
// aucun écouteur de production ; ces tests étaient son seul consommateur au monde.
//
// 🛑 CE QU'IL SERVAIT À PROUVER RESTE PROUVÉ, par un instrument MEILLEUR : l'idempotence de
// `init()` se mesure désormais sur le nombre d'appels à `indexedDB.open`, ce qui dit « la base
// n'a pas été rouverte » plutôt que « un événement n'a pas été réémis ». Le second était une
// conséquence du premier, pas la propriété elle-même.

afterEach(async () => {
    vi.unstubAllGlobals();
    // Teardown deliberately does NOT call IndexedDB.close(): that method is under test here,
    // and a broken close would leave a live connection blocking deleteDatabase, turning one
    // failing assertion into a whole file of timeouts that says nothing about the cause.
    const handle = IndexedDB._db;
    if (handle && typeof handle.close === "function") handle.close();
    IndexedDB._db = null;
    IndexedDB._modules = {};
    await new Promise((resolve) => {
        const req = globalThis.indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
});

describe("StorageDB.init — success", () => {
    test("opens the database, keeps the handle and announces readiness", async () => {
        const db = await IndexedDB.init();

        expect(db).toBeInstanceOf(IDBDatabase);
        expect(db.name).toBe(DB_NAME);
        expect(db.version).toBe(4);
        expect(IndexedDB._db).toBe(db);
    });

    // La forme fine du schéma v4 (clés, index, unicité) est éprouvée par `schema-v4.test.js` ;
    // ici on ne garde que l'inventaire, qui appartient au contrat de boot.
    test("creates the six object stores the engine expects (v4)", async () => {
        // ⚠️ Huit jusqu'à la tâche 4.11 : `sync_queue` (B-124) et `sync_backups` (chaîne de
        // sauvegarde) ne sont plus créés. Le test qui garde leur ABSENCE vit dans
        // `schema-v4.test.js` — celui-ci compte ce qui existe, l'autre refuse ce qui revient.
        const db = await IndexedDB.init();

        expect([...db.objectStoreNames].sort()).toEqual([
            "features",
            "layers",
            "local_images",
            "metadata",
            "outbox",
            "preferences",
        ]);
    });

    test("eagerly initialises every module in the registry", async () => {
        await IndexedDB.init();

        expect(Object.keys(IndexedDB._modules).sort()).toEqual(
            Object.keys(DBModulesRegistry).sort()
        );
    });

    test("a second init is a no-op — same handle, and the base is NOT reopened", async () => {
        // L'identité du handle ne suffit pas : une seconde ouverture qui rendrait par hasard
        // le même objet passerait. Ce qui prouve le court-circuit est qu'`open` n'est appelé
        // qu'UNE fois — et c'est ce qui coûte, une ouverture pouvant expirer à 15 s.
        const openSpy = vi.spyOn(globalThis.indexedDB, "open");

        const first = await IndexedDB.init();
        const second = await IndexedDB.init();

        expect(second).toBe(first);
        expect(openSpy).toHaveBeenCalledTimes(1);
        openSpy.mockRestore();
    });
});

describe("StorageDB.init — degradation when IndexedDB is unavailable", () => {
    /** Reproduces a browser that refuses storage access (private mode, sandboxed frame). */
    function refuseIndexedDB() {
        vi.stubGlobal("indexedDB", {
            open: () => {
                throw new DOMException("storage is disabled", "SecurityError");
            },
        });
    }

    test("resolves to a stub instead of rejecting — the app keeps booting", async () => {
        refuseIndexedDB();

        await expect(IndexedDB.init()).resolves.toEqual({ _isStub: true });
        // ⚠️ L'assertion `readyEvents` est retirée avec le signal (B-72). Ce qu'elle gardait
        // — « un échec d'ouverture n'annonce pas une réussite » — est porté par la forme du
        // retour lui-même : un talon, pas une base. C'est plus direct qu'un événement absent.
    });

    test("the stub IS retained — `_db` holds it and the open is not retried", async () => {
        refuseIndexedDB();
        await IndexedDB.init();

        // Was pinned the other way round: the `.catch` returned the stub to the caller but
        // never assigned `this._db`, so the `if (this._db)` short-circuit never fired and
        // every later façade call paid another full open attempt — up to the 15 s timeout
        // each. Fixed as B.47b; the stub was always meant to live here, the three guards
        // that read `_db` already test `"_isStub" in this._db`.
        expect(IndexedDB._db).toEqual({ _isStub: true });
    });

    test("read/write façade calls become silent no-ops, returning undefined", async () => {
        refuseIndexedDB();

        await expect(IndexedDB.cacheLayer("l1", {}, "p1")).resolves.toBeUndefined();
        await expect(IndexedDB.getLayer("l1")).resolves.toBeUndefined();
        await expect(IndexedDB.storeImageLocally({ id: "i1" })).resolves.toBeUndefined();
    });

    test("the list-returning calls still answer with an empty list, never undefined", async () => {
        refuseIndexedDB();

        // ⚠️ Les deux appels `sync_queue` de ce cas sont retirés (4.11) avec la façade.
        // `listPendingEdits` prend leur place : c'est désormais LA lecture de liste qui doit
        // rendre `[]` plutôt que `undefined` quand la base refuse de s'ouvrir — un `undefined`
        // ici ferait planter le décompte d'`autoSync`, donc le rejeu au retour du réseau.
        await expect(IndexedDB.listPendingEdits()).resolves.toEqual([]);
        await expect(IndexedDB.getStorageStats()).resolves.toEqual({
            used: 0,
            quota: 0,
            percentage: 0,
            layersCount: 0,
            featuresCount: 0,
            outboxCount: 0,
        });
    });

    test("preferences are the exception — they throw instead of degrading", async () => {
        refuseIndexedDB();

        await expect(IndexedDB.setPreference("theme", "dark")).rejects.toThrow(
            "[StorageDB] Preferences module not available"
        );
        await expect(IndexedDB.getPreference("theme")).rejects.toThrow(
            "[StorageDB] Preferences module not available"
        );
    });
});

describe("StorageDB — cède la place sur versionchange (hygiène de connexion, préalable de 3.1)", () => {
    // ⚠️ Cette garde est INVISIBLE aujourd'hui et le devient au moment où le schéma bouge
    // (tâche 3.4) — c'est exactement pourquoi elle est posée AVANT la migration et pas avec.
    //
    // Une connexion vivante est la SEULE chose qui puisse bloquer une montée de schéma.
    // Sans `onversionchange`, le moteur qui détient la base fait pendre l'upgrade de l'autre
    // contexte jusqu'à son timeout, après quoi celui-ci retombe sur `_isStub` : plus de
    // stockage, en silence, sur un appareil qui peut porter des saisies non synchronisées.
    test("ferme sa connexion quand un autre contexte demande une montée de version", async () => {
        await IndexedDB.init();
        expect(IndexedDB._db).not.toBeNull();

        // Un second contexte demande la version suivante. Il ne doit PAS être bloqué.
        const upgraded = await new Promise((resolve, reject) => {
            const req = globalThis.indexedDB.open(DB_NAME, 5);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
            req.onblocked = () => reject(new Error("BLOQUÉ — le moteur n'a pas cédé la place"));
        });

        expect(upgraded.version).toBe(5);
        // Et le moteur a bien lâché : son handle est libéré, pas simplement fermé en douce.
        expect(IndexedDB._db).toBeNull();
        expect(IndexedDB._modules).toEqual({});

        upgraded.close();
    });
});

describe("StorageDB._ensureModule", () => {
    test("returns the module and memoises it — init runs once, not once per call", async () => {
        await IndexedDB.init();
        IndexedDB._modules = {}; // force the lazy path the eager init normally pre-empts
        const initSpy = vi.spyOn(DBModulesRegistry.Layers, "init");

        const first = IndexedDB._ensureModule("Layers");
        const second = IndexedDB._ensureModule("Layers");

        try {
            expect(first).not.toBeNull();
            expect(second).toBe(first);
            expect(IndexedDB._modules.Layers).toBe(first);
            // The call count is the only witness of the cache: every `db/*` module's init()
            // returns its own singleton, so a repeated init and a memoised lookup hand back
            // the very same object. Identity alone cannot tell them apart — and a mutation
            // deleting the cache lookup survived a test that only checked identity.
            expect(initSpy).toHaveBeenCalledTimes(1);
        } finally {
            initSpy.mockRestore();
        }
    });

    test("returns null for a name that is not in the registry", async () => {
        await IndexedDB.init();
        expect(IndexedDB._ensureModule("Nonexistent")).toBeNull();
    });

    test("returns null when there is no database", () => {
        IndexedDB._db = null;
        IndexedDB._modules = {};
        expect(IndexedDB._ensureModule("Layers")).toBeNull();
    });

    test("returns null when the database is the stub", () => {
        IndexedDB._db = { _isStub: true };
        IndexedDB._modules = {};

        expect(IndexedDB._ensureModule("Layers")).toBeNull();
        expect(IndexedDB._modules).toEqual({});
    });
});

describe("StorageDB.close", () => {
    test("closes the connection and clears the handle and the module cache", async () => {
        const db = await IndexedDB.init();
        expect(Object.keys(IndexedDB._modules).length).toBeGreaterThan(0);

        IndexedDB.close();

        expect(IndexedDB._db).toBeNull();
        expect(IndexedDB._modules).toEqual({});
        // A closed connection refuses to start a transaction — proof `db.close()` ran and
        // not merely that the reference was dropped.
        expect(() => db.transaction(["layers"], "readonly")).toThrow();
    });

    test("closing a stubbed connection resets state without throwing", () => {
        IndexedDB._db = { _isStub: true };
        IndexedDB._modules = { Layers: {} };

        IndexedDB.close();

        expect(IndexedDB._db).toBeNull();
        expect(IndexedDB._modules).toEqual({});
    });

    test("after close, the next façade call re-opens the database", async () => {
        await IndexedDB.init();
        IndexedDB.close();

        await IndexedDB.cacheLayer("l1", { type: "FeatureCollection", features: [] }, "p1");

        expect(IndexedDB._db).toBeInstanceOf(IDBDatabase);
        expect(await IndexedDB.getLayer("l1")).toMatchObject({ id: "l1", profileId: "p1" });
    });
});

describe("StorageDB — delegation through a live database", () => {
    test("cacheLayer / getLayer / removeLayer round-trip through DB.Layers", async () => {
        await IndexedDB.init();
        const geojson = { type: "FeatureCollection", features: [] };

        await IndexedDB.cacheLayer("l1", geojson, "tourism", { source: "test" });

        expect(await IndexedDB.getLayer("l1")).toMatchObject({
            id: "l1",
            profileId: "tourism",
            data: geojson,
        });
        expect(await IndexedDB.getLayersByProfile("tourism")).toHaveLength(1);

        await IndexedDB.removeLayer("l1");
        expect(await IndexedDB.getLayer("l1")).toBeNull();
    });

    test("clearProfile drops only the profile's layers", async () => {
        await IndexedDB.init();
        await IndexedDB.cacheLayer("a", {}, "p1");
        await IndexedDB.cacheLayer("b", {}, "p2");

        await IndexedDB.clearProfile("p1");

        expect(await IndexedDB.getLayersByProfile("p1")).toHaveLength(0);
        expect(await IndexedDB.getLayersByProfile("p2")).toHaveLength(1);
    });

    // ⚠️ RÉÉCRIT le 02/08/2026 (tâche 3.3). Ce test s'appelait « addToSyncQueue rewrites the
    // caller's payload into SyncDB's entry shape » et VERROUILLAIT le remap : il appelait la
    // façade à DEUX arguments avec `{endpoint, data}` et assertait la réécriture en
    // `{layerId, poiData}`. Or aucun appelant de production n'a jamais utilisé cette forme —
    // les trois passent UN argument. Le test prouvait donc qu'un chemin sans utilisateur
    // fonctionnait, pendant que le chemin réel écrivait `poiData: null` sur chaque saisie.

    // ⚠️ The `status === "pending"` fast path (indexeddb.ts:329) is REDUNDANT: deleting it
    // leaves this test green. `SyncDB.getSyncQueue(profileId, "pending")` filters on the same
    // field the `status` index selects, so both routes return the same records. They differ
    // only in that `getPendingSyncQueue` sorts by timestamp — and since the primary key is
    // `sync_<Date.now()>_<random>`, timestamp order and key order cannot be made to disagree
    // through the public API. The branch is exercised below; its mutation is a documented
    // survivor, not an untested path.
    // ⚠️ LE TEST DU ROUTAGE DE `getSyncQueue` EST RETIRÉ (clôture S3c). Il éprouvait une
    // branche de compatibilité — « si status === 'pending', déléguer à getPendingSyncQueue » —
    // d'une méthode elle-même legacy et sans appelant. La branche partait avec la méthode.

    test("preferences round-trip and fall back to the supplied default", async () => {
        await IndexedDB.init();

        await IndexedDB.setPreference("theme", "dark");

        expect(await IndexedDB.getPreference("theme")).toBe("dark");
        expect(await IndexedDB.getPreference("absent", "light")).toBe("light");
    });

    test("images round-trip through DB.Images, including the pending index", async () => {
        await IndexedDB.init();
        const image = {
            id: "img-1",
            blob: new Blob(["x"]),
            filename: "img-1.jpg",
            type: "image/jpeg",
            size: 1,
        };

        await IndexedDB.storeImageLocally(image);

        // ⚠️ Relu par l'index des « en attente » et non par `getLocalImage` — retiré à la
        // tâche 3.13, son seul consommateur (`addpoi/getLocalImageUrl`) étant redondant avec
        // la data-URL base64 que le même module écrit. L'index est de toute façon le bon
        // instrument : c'est LUI que le bug n° 2 de la classe B.6 rendait aveugle.
        expect((await IndexedDB.getPendingImages()).map((i) => i.id)).toEqual(["img-1"]);

        await IndexedDB.updateImageUploadStatus("img-1", {
            uploaded: true,
            url: "https://cdn.example.org/img-1.jpg",
        });
        expect(await IndexedDB.getPendingImages()).toHaveLength(0);

        await IndexedDB.deleteLocalImage("img-1");
        // Après suppression, l'image ne peut plus être en attente : la relecture par l'index
        // vaut ici la relecture par clé, et elle n'exige aucun accesseur supplémentaire.
        expect(await IndexedDB.getPendingImages()).toHaveLength(0);
    });

    test("getStorageStats counts what is actually stored", async () => {
        // ⚠️ Ce cas écrivait dans `sync_queue` et comptait `syncQueueCount` ; les deux sont
        // retirés (4.11). Il compte désormais l'outbox, par le point d'entrée qui l'alimente
        // vraiment — `applyEdit`, unique écrivain depuis 4.4b.
        await IndexedDB.init();
        await IndexedDB.cacheLayer("l1", {}, "p1");
        await IndexedDB.applyLocalEdit({
            layerId: "pois",
            kind: "create",
            localId: "l-1",
            feature: { type: "Feature", geometry: null, properties: {} },
        });

        expect(await IndexedDB.getStorageStats()).toMatchObject({
            layersCount: 1,
            featuresCount: 1,
            outboxCount: 1,
        });
    });
});

// ── B.47b — un échec d'ouverture n'est pas mémorisé ───────────────────────────
//
// `init()` court-circuite sur `this._db`, mais le chemin d'échec ne renseigne jamais
// `_db` : il rend le stub `{_isStub:true}` sans rien retenir. Chaque appel de façade
// suivant repart donc dans `StorageHelper.openDatabase` et repaie une tentative complète
// — jusqu'à 15 s de timeout chacune. Sur une base durablement inouvrable (quota dépassé,
// navigation privée, IDB désactivé), ce n'est pas un cas de bord : c'est l'état permanent.
describe("IndexedDB.init — un échec d'ouverture ne se retente pas indéfiniment (B.47b)", () => {
    let IndexedDB;
    let StorageHelper;
    let openSpy;

    beforeAll(async () => {
        await import("fake-indexeddb/auto");
        // Deferred on purpose — the modules load AFTER fake-indexeddb installs
        // `globalThis.indexedDB`. `await import()` preserves that order exactly.
        ({ IndexedDB } = await import("../../../src/capabilities/offline/db/indexeddb.js"));
        ({ StorageHelperModule: StorageHelper } = await import(
            "../../../src/capabilities/offline/db/storage-helper.js"
        ));
    });

    beforeEach(() => {
        IndexedDB._db = null;
        IndexedDB._modules = {};
        openSpy = vi
            .spyOn(StorageHelper, "openDatabase")
            .mockRejectedValue(new Error("QuotaExceededError"));
    });

    afterEach(() => {
        openSpy.mockRestore();
        IndexedDB._db = null;
        IndexedDB._modules = {};
    });

    test("n'ouvre la base qu'UNE fois même après plusieurs échecs", async () => {
        await IndexedDB.init();
        await IndexedDB.init();
        await IndexedDB.init();

        expect(openSpy).toHaveBeenCalledTimes(1);
    });

    test("rend le même stub à chaque appel, plutôt qu'un neuf à chaque tentative", async () => {
        const first = await IndexedDB.init();
        const second = await IndexedDB.init();

        expect(first).toMatchObject({ _isStub: true });
        expect(second).toBe(first);
    });

    test("une ouverture qui redevient possible n'est PAS masquée par l'échec mémorisé", async () => {
        // Le cache d'échec ne doit pas être définitif : `close()` remet à plat, et c'est
        // le point de reprise. Sans cette sortie, une base temporairement indisponible
        // resterait inaccessible pour toute la durée de la page.
        await IndexedDB.init();
        expect(openSpy).toHaveBeenCalledTimes(1);

        IndexedDB.close();
        openSpy.mockResolvedValue({ name: "ok", objectStoreNames: { contains: () => true } });
        await IndexedDB.init();

        expect(openSpy).toHaveBeenCalledTimes(2);
    });
});
